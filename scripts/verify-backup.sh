#!/bin/bash

################################################################################
# PCM 백업 무결성 검증 스크립트
#
# 용도: 백업 파일을 임시 DB에 복원하여 무결성을 검증합니다
# 사용법: ./scripts/verify-backup.sh [백업파일경로]
#
# 인자 없이 실행하면 가장 최근 백업 파일을 자동 선택합니다
################################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

ENV_FILE="${PROJECT_ROOT}/.env"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
BACKUP_DIR="${PCM_BACKUP_DIR:-${PROJECT_ROOT}/backup}"
TEMP_DB="pcm_verify_temp"

# .env 파일 로드
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

DB_USER="${DB_USER:-pcm_user}"
DB_NAME="${DB_NAME:-pcm}"

# 주요 테이블 목록 (존재 여부 확인용)
REQUIRED_TABLES=("users" "projects" "lines" "columns" "products" "equipments")

################################################################################
# 함수: 백업 파일 결정
################################################################################
resolve_backup_file() {
    if [ $# -ge 1 ] && [ -n "$1" ]; then
        BACKUP_FILE="$1"
    else
        # 가장 최근 백업 자동 선택
        BACKUP_FILE=$(ls -t "$BACKUP_DIR"/backup_*.sql 2>/dev/null | head -1)
        if [ -z "$BACKUP_FILE" ]; then
            echo "✗ 오류: $BACKUP_DIR 에서 백업 파일을 찾을 수 없습니다"
            exit 1
        fi
        echo "자동 선택된 백업: $(basename "$BACKUP_FILE")"
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
        echo "✗ 오류: 백업 파일을 찾을 수 없습니다: $BACKUP_FILE"
        exit 1
    fi
}

################################################################################
# 함수: 임시 DB 생성
################################################################################
create_temp_db() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 임시 검증 DB 생성 중..."

    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$DB_NAME" -c "DROP DATABASE IF EXISTS $TEMP_DB;" 2>/dev/null

    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$DB_NAME" -c "CREATE DATABASE $TEMP_DB;" 2>/dev/null

    if [ $? -ne 0 ]; then
        echo "✗ 임시 DB 생성 실패"
        return 1
    fi
    echo "✓ 임시 DB 생성 완료: $TEMP_DB"
}

################################################################################
# 함수: 백업 복원
################################################################################
restore_to_temp() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업을 임시 DB에 복원 중..."

    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$TEMP_DB" \
        < "$BACKUP_FILE" > /dev/null 2>&1

    if [ $? -ne 0 ]; then
        echo "✗ 복원 실패"
        return 1
    fi
    echo "✓ 복원 완료"
}

################################################################################
# 함수: 무결성 검증
################################################################################
verify_integrity() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 무결성 검증 중..."

    # 테이블 수 확인
    TABLE_COUNT=$(docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$TEMP_DB" -t -c \
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null | tr -d ' ')

    if [ -z "$TABLE_COUNT" ] || [ "$TABLE_COUNT" -eq 0 ]; then
        echo "✗ 테이블이 없습니다"
        return 1
    fi
    echo "  - 테이블 수: ${TABLE_COUNT}개"

    # 주요 테이블 존재 확인
    MISSING=0
    for TABLE in "${REQUIRED_TABLES[@]}"; do
        EXISTS=$(docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
            psql -U "$DB_USER" -d "$TEMP_DB" -t -c \
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '$TABLE';" 2>/dev/null | tr -d ' ')

        if [ "$EXISTS" = "1" ]; then
            ROW_COUNT=$(docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
                psql -U "$DB_USER" -d "$TEMP_DB" -t -c \
                "SELECT COUNT(*) FROM $TABLE;" 2>/dev/null | tr -d ' ')
            echo "  - $TABLE: ${ROW_COUNT}행"
        else
            echo "  - $TABLE: ✗ 누락"
            MISSING=$((MISSING + 1))
        fi
    done

    if [ $MISSING -gt 0 ]; then
        echo "⚠ ${MISSING}개 주요 테이블 누락"
        return 1
    fi

    echo "✓ 무결성 검증 통과"
    return 0
}

################################################################################
# 함수: 임시 DB 삭제
################################################################################
cleanup_temp_db() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 임시 DB 삭제 중..."

    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        psql -U "$DB_USER" -d "$DB_NAME" -c "DROP DATABASE IF EXISTS $TEMP_DB;" 2>/dev/null

    echo "✓ 임시 DB 삭제 완료"
}

################################################################################
# 메인 실행
################################################################################

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          PCM 백업 무결성 검증                                  ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

resolve_backup_file "$@"

VERIFY_RESULT=0

if ! create_temp_db; then
    exit 1
fi

if ! restore_to_temp; then
    cleanup_temp_db
    exit 1
fi

if ! verify_integrity; then
    VERIFY_RESULT=1
fi

cleanup_temp_db

echo ""
if [ $VERIFY_RESULT -eq 0 ]; then
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          검증 통과 ✓                                          ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    exit 0
else
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          검증 실패 ✗                                          ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    exit 1
fi
