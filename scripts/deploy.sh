#!/bin/bash

################################################################################
# PCM 통합 배포 스크립트
#
# 용도: .env 검증 → 백업 → 빌드 → 마이그레이션 → 순차 재시작 → 헬스 체크
# 사용법:
#   ./scripts/deploy.sh              # 전체 배포 플로우
#   ./scripts/deploy.sh --quick      # 빌드 + 재시작만 (백업/마이그레이션 생략)
#   ./scripts/deploy.sh --rollback   # 이전 이미지로 롤백
#   ./scripts/deploy.sh --help       # 도움말
################################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="${PROJECT_ROOT}/.env"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
HEALTH_URL="http://localhost/api/health"
HEALTH_TIMEOUT=30

# .env 파일 로드
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

################################################################################
# 함수: 도움말
################################################################################
show_help() {
    echo ""
    echo "PCM 통합 배포 스크립트"
    echo ""
    echo "사용법: $0 [옵션]"
    echo ""
    echo "옵션:"
    echo "  (없음)       전체 배포 (검증 → 백업 → 빌드 → 마이그레이션 → 재시작 → 헬스 체크)"
    echo "  --quick      빌드 + 재시작만 (백업/마이그레이션 생략)"
    echo "  --rollback   이전 빌드 이미지로 롤백"
    echo "  --help       이 도움말 표시"
    echo ""
}

################################################################################
# 함수: .env 검증
################################################################################
validate_env() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] .env 파일 검증 중..."

    if [ ! -f "$ENV_FILE" ]; then
        echo "✗ 오류: .env 파일이 없습니다"
        echo "  cp .env.prod.example .env 로 생성 후 값을 수정하세요"
        return 1
    fi

    ERRORS=0

    # SECRET_KEY 검증
    SECRET="${SECRET_KEY:-}"
    if [ -z "$SECRET" ] || [ "$SECRET" = "change-this-secret-key" ]; then
        echo "  ✗ SECRET_KEY가 설정되지 않았거나 기본값입니다"
        ERRORS=$((ERRORS + 1))
    fi

    # DB_PASSWORD 검증
    DBPW="${DB_PASSWORD:-}"
    if [ -z "$DBPW" ] || [ "$DBPW" = "pcm_pass" ]; then
        echo "  ✗ DB_PASSWORD가 설정되지 않았거나 기본값입니다"
        ERRORS=$((ERRORS + 1))
    fi

    if [ $ERRORS -gt 0 ]; then
        echo "✗ .env 검증 실패 ($ERRORS 건)"
        return 1
    fi

    echo "✓ .env 검증 통과"
    return 0
}

################################################################################
# 함수: 이미지 빌드
################################################################################
build_images() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Docker 이미지 빌드 중..."

    docker-compose -f "$DOCKER_COMPOSE_FILE" build --parallel

    if [ $? -eq 0 ]; then
        echo "✓ 빌드 완료"
    else
        echo "✗ 빌드 실패"
        return 1
    fi
}

################################################################################
# 함수: 순차 재시작 (다운타임 최소화)
################################################################################
rolling_restart() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 순차 재시작 시작..."

    for SERVICE in backend frontend nginx; do
        echo "  재시작: $SERVICE"
        docker-compose -f "$DOCKER_COMPOSE_FILE" up -d --no-deps "$SERVICE"
        sleep 2
    done

    echo "✓ 순차 재시작 완료"
}

################################################################################
# 함수: 헬스 체크
################################################################################
health_check() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 헬스 체크 대기 중 (최대 ${HEALTH_TIMEOUT}초)..."

    for i in $(seq 1 "$HEALTH_TIMEOUT"); do
        RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || true)

        if [ "$RESPONSE" = "200" ]; then
            echo "✓ 헬스 체크 통과 (${i}초)"

            # 상세 상태 출력
            curl -s "$HEALTH_URL" 2>/dev/null | python3 -m json.tool 2>/dev/null || true
            return 0
        fi

        sleep 1
    done

    echo "✗ 헬스 체크 실패 (${HEALTH_TIMEOUT}초 타임아웃)"
    echo "  로그 확인: docker-compose -f $DOCKER_COMPOSE_FILE logs backend --tail=50"
    return 1
}

################################################################################
# 함수: 롤백
################################################################################
rollback_deploy() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 롤백 시작..."
    echo ""
    echo "⚠ 현재 실행 중인 컨테이너를 이전 이미지로 되돌립니다"
    echo ""
    read -p "계속하시겠습니까? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo "롤백이 취소되었습니다"
        exit 0
    fi

    # 이전 이미지로 재시작 (빌드 없이)
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d --no-build

    health_check
}

################################################################################
# 함수: 전체 배포
################################################################################
full_deploy() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          PCM 전체 배포 시작                                    ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    # 1. .env 검증
    if ! validate_env; then
        exit 1
    fi
    echo ""

    # 2. 백업
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 배포 전 백업..."
    if [ -x "${SCRIPT_DIR}/backup-db.sh" ]; then
        "${SCRIPT_DIR}/backup-db.sh"
    else
        echo "⚠ backup-db.sh를 찾을 수 없습니다. 백업을 건너뜁니다."
    fi
    echo ""

    # 3. 빌드
    if ! build_images; then
        exit 1
    fi
    echo ""

    # 4. 마이그레이션
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 마이그레이션 실행..."
    if [ -x "${SCRIPT_DIR}/migrate-db.sh" ]; then
        "${SCRIPT_DIR}/migrate-db.sh"
    else
        echo "⚠ migrate-db.sh를 찾을 수 없습니다. 마이그레이션을 건너뜁니다."
    fi
    echo ""

    # 5. 순차 재시작
    if ! rolling_restart; then
        exit 1
    fi
    echo ""

    # 6. 헬스 체크
    if ! health_check; then
        echo ""
        echo "⚠ 헬스 체크 실패. 롤백하려면: $0 --rollback"
        exit 1
    fi

    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          배포 완료 ✓                                          ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
}

################################################################################
# 함수: 빠른 배포 (빌드 + 재시작만)
################################################################################
quick_deploy() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          PCM 빠른 배포 (빌드 + 재시작)                        ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""

    if ! build_images; then
        exit 1
    fi
    echo ""

    if ! rolling_restart; then
        exit 1
    fi
    echo ""

    if ! health_check; then
        echo ""
        echo "⚠ 헬스 체크 실패. 롤백하려면: $0 --rollback"
        exit 1
    fi

    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          빠른 배포 완료 ✓                                      ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
}

################################################################################
# 메인 실행
################################################################################

case "${1:-full}" in
    --help|-h)
        show_help
        ;;
    --quick)
        quick_deploy
        ;;
    --rollback)
        rollback_deploy
        ;;
    full|"")
        full_deploy
        ;;
    *)
        echo "✗ 알 수 없는 옵션: $1"
        show_help
        exit 1
        ;;
esac
