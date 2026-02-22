# PCM 프로덕션 배포 및 운영 가이드

이 디렉토리에는 PCM(Process Condition Manager) 시스템을 사내 서버에 배포하고 운영하기 위한 한국어 문서와 스크립트가 있습니다.

## 문서 개요

### 📘 10-production-deploy.md

사내 서버에 PCM을 배포하고 운영하는 전체 가이드입니다.

**포함 내용:**

1. **사전 준비 (1단계)**
   - 서버 요구사항 (OS, Docker, 메모리, 디스크)
   - Git에서 코드 다운로드
   - 권한 설정

2. **.env 파일 설정 (2단계)**
   - 프로덕션 환경변수 설정
   - SECRET_KEY 생성 방법
   - 보안 권한 설정

3. **Docker 빌드 및 시작 (3-5단계)**
   - 프로덕션 이미지 빌드
   - 서비스 시작
   - 데이터베이스 마이그레이션
   - 시드 데이터 투입

4. **Nginx 설정**
   - 현재 설정 설명
   - 도메인/포트 변경
   - HTTPS 설정 (Let's Encrypt)

5. **업데이트 배포**
   - 코드 업데이트 절차
   - 다운타임 최소화
   - 롤백 방법

6. **운영 관리**
   - 서비스 상태 확인
   - 로그 확인
   - 디스크 정리
   - 모니터링

7. **보안 체크리스트**
   - 비밀번호 변경
   - 권한 설정
   - 방화벽 구성
   - HTTPS 설정

8. **자동 백업 설정**
   - 백업 스크립트 사용
   - Cron 작업 설정
   - 복구 절차

## 스크립트 개요

### 🔐 backup-db.sh

PostgreSQL 데이터베이스를 자동으로 백업하는 스크립트입니다.

**기능:**
- Docker Compose를 통해 안전하게 백업 수행
- 타임스탐프가 있는 SQL 파일로 저장
- 7일 이상 된 백업 자동 삭제
- 백업 성공/실패 명확한 상태 표시
- Cron 작업으로 정기 실행 가능

**사용법:**
```bash
# 수동 실행
./scripts/backup-db.sh

# Cron으로 정기 실행
0 2 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1
```

**출력 예시:**
```
╔════════════════════════════════════════════════════════════════╗
║          PCM 데이터베이스 백업 시작                            ║
╚════════════════════════════════════════════════════════════════╝

[2026-02-22 14:00:00] 백업 시작
  - 데이터베이스: pcm
  - 사용자: pcm_user
  - 백업 파일: ./backup/backup_2026-02-22_140000.sql

✓ 백업 성공
  - 파일 크기: 156M
  - 생성 시간: 2026-02-22 14:02:30

[2026-02-22 14:02:30] 오래된 백업 정리 중...
  - 삭제: backup_2026-02-15_020000.sql
  - 1 개의 오래된 백업 삭제 완료
```

### 🔄 restore-db.sh

백업 파일에서 데이터베이스를 복구하는 스크립트입니다.

**기능:**
- 지정된 백업 파일에서 안전하게 복구
- 복구 전 확인 메시지 표시
- 데이터 손실 경고
- 복구 후 정상 여부 자동 검증

**사용법:**
```bash
# 복구 스크립트 실행
./scripts/restore-db.sh ./backup/backup_2026-02-22_020000.sql

# 절대 경로 사용
./scripts/restore-db.sh /backup/pcm/backup_2026-02-22_020000.sql
```

**주의:** ⚠️ 기존의 모든 데이터가 삭제되고 백업 데이터로 복원됩니다!

## 빠른 시작

### 첫 배포

```bash
# 1. 프로젝트 디렉토리로 이동
cd /opt/process-condition-manager

# 2. 환경 파일 설정
cp .env.example .env
# .env 파일 수정 (SECRET_KEY, 비밀번호 등)
nano .env

# 3. 이미지 빌드
docker-compose -f docker-compose.prod.yml build

# 4. 서비스 시작
docker-compose -f docker-compose.prod.yml up -d

# 5. 마이그레이션 적용
docker-compose -f docker-compose.prod.yml exec -T backend alembic upgrade head

# 6. 시드 데이터 투입 (최초 1회만)
docker-compose -f docker-compose.prod.yml exec -T backend python -m seed

# 7. 정상 동작 확인
curl http://localhost/api/health
```

### 정기 백업 설정

```bash
# 1. 백업 디렉토리 생성
mkdir -p /backup/pcm

# 2. Cron 작업 추가
crontab -e
# 다음 줄 추가:
# 0 2 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1

# 3. 백업 확인
ls -lh /backup/pcm/backup_*.sql
```

### 응급 복구

```bash
# 1. 사용 가능한 백업 확인
ls -lt /backup/pcm/backup_*.sql | head -5

# 2. 복구 실행
./scripts/restore-db.sh /backup/pcm/backup_2026-02-22_020000.sql

# 3. 복구 확인
curl http://localhost/api/health
```

## 파일 구조

```
/home/appuser/process-condition-manager/
├── docs/
│   ├── 10-production-deploy.md      # 프로덕션 배포 전체 가이드 (한국어)
│   └── README-PRODUCTION.md         # 이 파일
├── scripts/
│   ├── backup-db.sh                 # 데이터베이스 자동 백업
│   └── restore-db.sh                # 백업에서 복구
├── docker-compose.prod.yml          # 프로덕션 Docker 설정
├── .env                             # 환경 설정 (프로덕션용)
└── ... (다른 파일들)
```

## 주요 문제 해결

### Q: 백업 스크립트가 Docker 오류를 표시합니다

```bash
# docker-compose 명령어 경로 확인
which docker-compose

# Docker 상태 확인
docker ps

# 백업 디렉토리 권한 확인
ls -ld /backup/pcm
chmod 750 /backup/pcm
```

### Q: 복구 중 "기존 데이터가 삭제됩니다" 경고를 무시하고 싶습니다

```bash
# 스크립트는 안전성을 위해 확인을 요구합니다
# yes 입력으로 진행할 수 있습니다
echo "yes" | ./scripts/restore-db.sh /backup/pcm/backup_2026-02-22_020000.sql
```

### Q: 백업 파일이 너무 커집니다

```bash
# 오래된 백업 자동 정리는 7일 주기입니다
# 더 짧은 주기로 정리하려면 스크립트 수정
# 현재 백업 확인
du -sh /backup/pcm/*

# 수동 삭제
rm /backup/pcm/backup_2026-02-15_*.sql
```

## 지원

배포 및 운영 중 문제가 발생하면:

1. 📖 **10-production-deploy.md** 문서의 "문제 해결" 섹션 확인
2. 🔍 로그 파일 확인: `docker-compose -f docker-compose.prod.yml logs`
3. 💬 개발팀에 문의

## 라이센스

PCM 프로젝트 라이센스를 따릅니다.

---

**마지막 업데이트**: 2026-02-22
**한국어 문서**: 비 개발자 운영자를 위한 친화적인 설명
