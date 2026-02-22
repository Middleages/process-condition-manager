#!/bin/bash

################################################################################
# PCM 데이터베이스 복구 스크립트
#
# 용도: 백업 파일에서 데이터베이스를 복구합니다
# 사용법: ./scripts/restore-db.sh <백업파일경로>
#
# 예시: ./scripts/restore-db.sh ./backup/backup_2026-02-22_020000.sql
#
# 주의: 기존 데이터가 모두 덮어씌워집니다!
################################################################################

# 스크립트가 위치한 디렉토리 확인
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 환경 설정
ENV_FILE="${PROJECT_ROOT}/.env"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"

# 매개변수 확인
if [ $# -lt 1 ]; then
    echo ""
    echo "사용법: $0 <백업파일경로>"
    echo ""
    echo "예시:"
    echo "  $0 ./backup/backup_2026-02-22_020000.sql"
    echo "  $0 /backup/pcm/backup_2026-02-22_020000.sql"
    echo ""
    exit 1
fi

BACKUP_FILE="$1"

# .env 파일이 없으면 기본값 사용
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

# 환경변수 설정 (기본값)
DB_USER="${DB_USER:-pcm_user}"
DB_NAME="${DB_NAME:-pcm}"
DB_HOST="db"

################################################################################
# 함수: 백업 파일 확인
################################################################################
check_backup_file() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 파일 확인 중..."

    if [ ! -f "$BACKUP_FILE" ]; then
        echo "✗ 오류: 백업 파일을 찾을 수 없습니다"
        echo "  경로: $BACKUP_FILE"
        return 1
    fi

    if [ ! -r "$BACKUP_FILE" ]; then
        echo "✗ 오류: 백업 파일을 읽을 수 없습니다"
        echo "  경로: $BACKUP_FILE"
        echo "  권한 확인 필요"
        return 1
    fi

    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✓ 백업 파일 확인"
    echo "  - 파일: $BACKUP_FILE"
    echo "  - 크기: $FILE_SIZE"

    return 0
}

################################################################################
# 함수: 데이터베이스 연결 확인
################################################################################
check_database() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 데이터베이스 연결 확인 중..."

    # Docker Compose 파일 존재 확인
    if [ ! -f "$DOCKER_COMPOSE_FILE" ]; then
        echo "✗ 오류: $DOCKER_COMPOSE_FILE 파일을 찾을 수 없습니다"
        return 1
    fi

    # 데이터베이스 컨테이너 실행 확인
    if ! docker-compose -f "$DOCKER_COMPOSE_FILE" ps db | grep -q "db.*Up"; then
        echo "✗ 오류: 데이터베이스 컨테이너가 실행 중이 아닙니다"
        return 1
    fi

    # 데이터베이스 연결 테스트
    if ! docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        pg_isready -U "$DB_USER" &> /dev/null; then
        echo "✗ 오류: 데이터베이스에 연결할 수 없습니다"
        return 1
    fi

    echo "✓ 데이터베이스 연결 확인"
    echo "  - 데이터베이스: $DB_NAME"
    echo "  - 사용자: $DB_USER"

    return 0
}

################################################################################
# 함수: 복구 실행
################################################################################
perform_restore() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          데이터베이스 복구 시작                                ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "⚠️  주의: 기존의 모든 데이터가 삭제되고 백업 데이터로 복원됩니다!"
    echo ""

    # 사용자 확인
    read -p "계속하시겠습니까? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo "복구가 취소되었습니다"
        return 1
    fi

    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 복구 시작..."

    # 복구 실행
    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$DB_NAME" \
        < "$BACKUP_FILE" 2>/tmp/restore_error.log

    RESTORE_RESULT=$?

    if [ $RESTORE_RESULT -eq 0 ]; then
        echo ""
        echo "✓ 복구 완료"
        echo "  - 시간: $(date '+%Y-%m-%d %H:%M:%S')"
        return 0
    else
        echo ""
        echo "✗ 복구 실패"
        echo "  - 오류:"
        cat /tmp/restore_error.log | sed 's/^/    /'
        rm -f /tmp/restore_error.log
        return 1
    fi
}

################################################################################
# 함수: 복구 확인
################################################################################
verify_restore() {
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 복구 확인 중..."

    # 테이블 수 확인
    TABLE_COUNT=$(docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null)

    if [ -n "$TABLE_COUNT" ] && [ "$TABLE_COUNT" -gt 0 ]; then
        echo "✓ 복구 확인 완료"
        echo "  - 테이블 수: $TABLE_COUNT 개"
        return 0
    else
        echo "✗ 복구 확인 실패"
        echo "  - 테이블이 발견되지 않았습니다"
        return 1
    fi
}

################################################################################
# 메인 실행
################################################################################

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          PCM 데이터베이스 복구 스크립트                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# 백업 파일 확인
if ! check_backup_file; then
    exit 1
fi

echo ""

# 데이터베이스 연결 확인
if ! check_database; then
    exit 1
fi

echo ""

# 복구 실행
if ! perform_restore; then
    exit 1
fi

# 복구 확인
if ! verify_restore; then
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          복구 완료                                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"

exit 0
