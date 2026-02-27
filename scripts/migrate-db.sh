#!/bin/bash

################################################################################
# PCM 데이터베이스 마이그레이션 스크립트
#
# 용도: Alembic 마이그레이션을 Docker 환경에서 실행합니다
# 사용법:
#   ./scripts/migrate-db.sh              # upgrade head (기본)
#   ./scripts/migrate-db.sh --status     # 현재 마이그레이션 상태 확인
#   ./scripts/migrate-db.sh --dry-run    # SQL 미리보기 (실행하지 않음)
#   ./scripts/migrate-db.sh --rollback   # 한 단계 롤백
#   ./scripts/migrate-db.sh --help       # 도움말
################################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="${PROJECT_ROOT}/.env"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"

# .env 파일 로드
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

################################################################################
# 함수: 도움말
################################################################################
show_help() {
    echo ""
    echo "PCM 데이터베이스 마이그레이션"
    echo ""
    echo "사용법: $0 [옵션]"
    echo ""
    echo "옵션:"
    echo "  (없음)       upgrade head 실행 (마이그레이션 적용)"
    echo "  --status     현재 마이그레이션 상태 확인"
    echo "  --dry-run    적용할 SQL 미리보기 (실행하지 않음)"
    echo "  --rollback   한 단계 롤백 (downgrade -1)"
    echo "  --help       이 도움말 표시"
    echo ""
}

################################################################################
# 함수: Alembic 명령 실행
################################################################################
run_alembic() {
    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T backend \
        alembic "$@"
}

################################################################################
# 함수: 마이그레이션 상태 확인
################################################################################
migration_status() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 마이그레이션 상태 확인..."
    echo ""
    echo "--- current ---"
    run_alembic current
    echo ""
    echo "--- history ---"
    run_alembic history --verbose -r -5:
}

################################################################################
# 함수: SQL 미리보기
################################################################################
migration_dry_run() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 적용할 마이그레이션 SQL 미리보기..."
    echo ""
    run_alembic upgrade head --sql
}

################################################################################
# 함수: 마이그레이션 적용
################################################################################
migration_upgrade() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 마이그레이션 적용 시작..."

    # 적용 전 백업
    echo ""
    echo "마이그레이션 적용 전 백업을 실행합니다..."
    if [ -x "${SCRIPT_DIR}/backup-db.sh" ]; then
        "${SCRIPT_DIR}/backup-db.sh"
        echo ""
    else
        echo "⚠ backup-db.sh를 찾을 수 없습니다. 백업 없이 계속합니다."
    fi

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] alembic upgrade head 실행 중..."
    run_alembic upgrade head

    if [ $? -eq 0 ]; then
        echo ""
        echo "✓ 마이그레이션 적용 완료"
        echo ""
        echo "--- 현재 상태 ---"
        run_alembic current
    else
        echo ""
        echo "✗ 마이그레이션 적용 실패"
        echo "  롤백이 필요하면: $0 --rollback"
        exit 1
    fi
}

################################################################################
# 함수: 롤백
################################################################################
migration_rollback() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 한 단계 롤백 시작..."
    echo ""
    echo "⚠ 주의: 마지막 마이그레이션 1개를 되돌립니다"
    echo ""
    read -p "계속하시겠습니까? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo "롤백이 취소되었습니다"
        exit 0
    fi

    run_alembic downgrade -1

    if [ $? -eq 0 ]; then
        echo ""
        echo "✓ 롤백 완료"
        echo ""
        echo "--- 현재 상태 ---"
        run_alembic current
    else
        echo ""
        echo "✗ 롤백 실패"
        exit 1
    fi
}

################################################################################
# 메인 실행
################################################################################

case "${1:-upgrade}" in
    --help|-h)
        show_help
        ;;
    --status)
        migration_status
        ;;
    --dry-run)
        migration_dry_run
        ;;
    --rollback)
        migration_rollback
        ;;
    upgrade|"")
        migration_upgrade
        ;;
    *)
        echo "✗ 알 수 없는 옵션: $1"
        show_help
        exit 1
        ;;
esac
