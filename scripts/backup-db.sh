#!/bin/bash

################################################################################
# PCM 데이터베이스 자동 백업 스크립트
#
# 용도: PostgreSQL 데이터베이스를 자동으로 백업합니다
# 사용법: ./scripts/backup-db.sh
#
# 주요 기능:
# - 타임스탬프가 있는 SQL 파일로 백업 생성
# - 7일 이상 된 백업 자동 삭제
# - 백업 성공/실패 상태 출력
# - Cron 작업으로 정기 실행 가능
################################################################################

# 스크립트가 위치한 디렉토리 확인
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# 환경 설정
BACKUP_DIR="${PCM_BACKUP_DIR:-${PROJECT_ROOT}/backup}"
ENV_FILE="${PROJECT_ROOT}/.env"
DOCKER_COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"

# .env 파일이 없으면 기본값 사용
if [ -f "$ENV_FILE" ]; then
    # .env 파일에서 환경변수 읽기
    export $(grep -v '^#' "$ENV_FILE" | xargs)
else
    # 기본값 사용
    DB_USER="pcm_user"
    DB_NAME="pcm"
fi

# 환경변수 설정 (기본값)
DB_USER="${DB_USER:-pcm_user}"
DB_NAME="${DB_NAME:-pcm}"
DB_HOST="db"  # Docker Compose에서의 데이터베이스 호스트명

# 백업 파일명 설정 (타임스탬프 포함)
TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.sql"

# 백업 디렉토리 생성
if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 디렉토리 생성: $BACKUP_DIR"
fi

################################################################################
# 함수: 백업 실행
################################################################################
perform_backup() {
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          PCM 데이터베이스 백업 시작                            ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 백업 시작"
    echo "  - 데이터베이스: $DB_NAME"
    echo "  - 사용자: $DB_USER"
    echo "  - 백업 파일: $BACKUP_FILE"
    echo ""

    # Docker Compose를 사용하여 백업 실행
    docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T db \
        pg_dump -U "$DB_USER" -d "$DB_NAME" \
        > "$BACKUP_FILE" 2>/tmp/backup_error_$TIMESTAMP.log

    BACKUP_RESULT=$?

    if [ $BACKUP_RESULT -eq 0 ]; then
        # 백업 성공
        BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        echo "✓ 백업 성공"
        echo "  - 파일 크기: $BACKUP_SIZE"
        echo "  - 생성 시간: $(date '+%Y-%m-%d %H:%M:%S')"
        return 0
    else
        # 백업 실패
        echo "✗ 백업 실패"
        echo "  - 오류 로그:"
        cat /tmp/backup_error_$TIMESTAMP.log | sed 's/^/    /'
        rm -f "$BACKUP_FILE"  # 손상된 백업 파일 삭제
        rm -f /tmp/backup_error_$TIMESTAMP.log
        return 1
    fi
}

################################################################################
# 함수: 오래된 백업 삭제
################################################################################
cleanup_old_backups() {
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 오래된 백업 정리 중..."

    # 보관 기간 지난 백업 찾기 및 삭제
    DELETED_COUNT=0

    if [ -d "$BACKUP_DIR" ]; then
        # 7일 이전의 파일 찾기
        while IFS= read -r old_file; do
            if [ -n "$old_file" ]; then
                rm -f "$old_file"
                DELETED_COUNT=$((DELETED_COUNT + 1))
                FILE_NAME=$(basename "$old_file")
                echo "  - 삭제: $FILE_NAME"
            fi
        RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
        done < <(find "$BACKUP_DIR" -name "backup_*.sql" -type f -mtime +"$RETENTION_DAYS")
    fi

    if [ $DELETED_COUNT -eq 0 ]; then
        echo "  - 삭제할 오래된 백업 없음"
    else
        echo "  - $DELETED_COUNT 개의 오래된 백업 삭제 완료"
    fi
}

################################################################################
# 함수: 백업 목록 표시
################################################################################
show_backup_list() {
    echo ""
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 현재 백업 목록:"
    echo ""

    if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR")" ]; then
        ls -lh "$BACKUP_DIR"/backup_*.sql 2>/dev/null | awk '{
            printf "  %s  %8s  %s\n", $6" "$7, $5, $9
        }'

        # 백업 통계
        TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
        FILE_COUNT=$(ls -1 "$BACKUP_DIR"/backup_*.sql 2>/dev/null | wc -l)

        echo ""
        echo "  총 백업 파일: $FILE_COUNT 개"
        echo "  전체 크기: $TOTAL_SIZE"
    else
        echo "  백업 파일 없음"
    fi
}

################################################################################
# 함수: 에러 핸들링
################################################################################
check_prerequisites() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 필수 사항 확인 중..."

    # Docker Compose 설치 확인
    if ! command -v docker-compose &> /dev/null; then
        echo "✗ 오류: docker-compose가 설치되지 않았습니다"
        return 1
    fi
    echo "✓ docker-compose 확인"

    # Docker 실행 확인
    if ! docker ps &> /dev/null; then
        echo "✗ 오류: Docker 데몬이 실행 중이 아닙니다"
        return 1
    fi
    echo "✓ Docker 실행 중"

    # docker-compose.prod.yml 파일 존재 확인
    if [ ! -f "$DOCKER_COMPOSE_FILE" ]; then
        echo "✗ 오류: $DOCKER_COMPOSE_FILE 파일을 찾을 수 없습니다"
        return 1
    fi
    echo "✓ docker-compose.prod.yml 확인"

    # 데이터베이스 컨테이너 실행 확인
    if ! docker-compose -f "$DOCKER_COMPOSE_FILE" ps db | grep -q "db.*Up"; then
        echo "✗ 오류: 데이터베이스 컨테이너가 실행 중이 아닙니다"
        echo "  실행 중인 컨테이너:"
        docker-compose -f "$DOCKER_COMPOSE_FILE" ps
        return 1
    fi
    echo "✓ 데이터베이스 컨테이너 실행 중"

    return 0
}

################################################################################
# 메인 실행 시작
################################################################################

# 필수 사항 확인
if ! check_prerequisites; then
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          백업 실패 - 필수 사항 미충족                          ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    exit 1
fi

echo "✓ 모든 필수 사항 확인 완료"
echo ""

# 백업 실행
if perform_backup; then
    BACKUP_SUCCESSFUL=1
else
    BACKUP_SUCCESSFUL=0
fi

# 오래된 백업 정리
cleanup_old_backups

# 현재 백업 목록 표시
show_backup_list

# 최종 결과 표시
echo ""
if [ $BACKUP_SUCCESSFUL -eq 1 ]; then
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          백업 완료                                             ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    exit 0
else
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║          백업 실패                                             ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    exit 1
fi
