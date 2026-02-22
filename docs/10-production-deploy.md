# 프로덕션 배포 가이드

## 개요

이 가이드는 PCM(Process Condition Manager) 시스템을 사내 서버에 배포하고 운영하는 방법을 설명합니다.

---

## 1단계: 사전 준비

### 서버 요구사항

배포 전에 서버가 다음을 만족하는지 확인하세요.

**운영체제**
- Linux (Ubuntu 20.04 이상 권장) 또는 CentOS 8 이상
- Windows Server 2019 이상 (WSL2 포함)

**소프트웨어**
- Docker 20.10 이상
- Docker Compose 2.0 이상
- Git (코드 업데이트용)

**하드웨어**
- CPU: 최소 2코어 (4코어 권장)
- RAM: 최소 4GB (8GB 권장)
- 디스크: 최소 20GB (SSD 권장)

**네트워크**
- 인터넷 연결 (첫 배포 시 Docker 이미지 다운로드)
- 포트 80, 443 (프로덕션), 5432 (데이터베이스 - 내부 사용)

### Git에서 코드 가져오기

```bash
# 프로젝트 디렉토리로 이동
cd /opt
git clone <repository-url> process-condition-manager
cd process-condition-manager
```

또는 파일을 직접 복사하는 경우:

```bash
# 프로젝트 파일 복사
scp -r /local/path/process-condition-manager /opt/
cd /opt/process-condition-manager
```

### 권한 설정

```bash
# 적절한 소유권 설정
sudo chown -R appuser:appuser /opt/process-condition-manager

# 스크립트 실행 권한
chmod +x scripts/backup-db.sh
```

---

## 2단계: .env 파일 설정

### 프로덕션용 환경 변수 설정

```bash
# .env 파일 생성 (프로덕션용)
cat > .env << 'EOF'
# 데이터베이스 설정
DB_NAME=pcm_prod
DB_USER=pcm_prod_user
DB_PASSWORD=<강력한 비밀번호 입력>

# FastAPI 설정
SECRET_KEY=<32자 이상 무작위 문자열>
EOF
```

### SECRET_KEY 생성

강력한 SECRET_KEY를 생성합니다:

```bash
# Python으로 생성
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# 또는 OpenSSL 사용
openssl rand -base64 32
```

생성된 값을 위의 .env 파일에 입력합니다.

### .env 파일 보안 설정

```bash
# .env 파일 권한 설정 (소유자만 읽기)
chmod 600 .env

# 소유권 확인
ls -la .env
# 출력: -rw------- 1 appuser appuser 200 Feb 22 14:00 .env
```

### 각 설정값 설명

| 변수 | 용도 | 예시 |
|------|------|------|
| `DB_NAME` | PostgreSQL 데이터베이스 이름 | `pcm_prod` |
| `DB_USER` | PostgreSQL 사용자명 | `pcm_prod_user` |
| `DB_PASSWORD` | PostgreSQL 비밀번호 | `Secure@Pass123!` |
| `SECRET_KEY` | JWT 토큰 암호화 키 | `lJ7x8kP9mQ2wL3vN4zC5bD6eF7gH8j` |

---

## 3단계: Docker 이미지 빌드

### 프로덕션 이미지 빌드

```bash
# 데이터베이스 디렉토리 확인 및 생성
mkdir -p /data/pcm/postgres

# 이미지 빌드
docker-compose -f docker-compose.prod.yml build

# 또는 특정 서비스만 빌드
docker-compose -f docker-compose.prod.yml build backend
docker-compose -f docker-compose.prod.yml build frontend
```

### 빌드 진행 상황 확인

빌드 중 다음과 같은 메시지가 표시됩니다:

```
Building backend
[+] Building 12.5s (25/25) FINISHED
...
Building frontend
[+] Building 45.3s (18/18) FINISHED
...
```

---

## 4단계: 서비스 시작

### 첫 번째 배포

```bash
# 모든 서비스 시작
docker-compose -f docker-compose.prod.yml up -d

# 서비스 상태 확인
docker-compose -f docker-compose.prod.yml ps
```

출력 예시:

```
NAME                           COMMAND                  SERVICE      STATUS       PORTS
process-condition-manager-db-1          "docker-entrypoint.s…"   db           Up 2 seconds (healthy)
process-condition-manager-backend-1     "python -m uvicorn a…"   backend      Up 1 second
process-condition-manager-frontend-1    "npm run build && npm…"   frontend     Up 1 second
process-condition-manager-nginx-1       "nginx -g 'daemon of…"   nginx        Up 1 second   0.0.0.0:80→80/tcp
```

### 서비스 포트 확인

- 프론트엔드: http://localhost 또는 http://<server-ip>
- API 엔드포인트: http://localhost/api
- 데이터베이스: localhost:5432 (내부용)

---

## 5단계: 데이터베이스 마이그레이션

### 마이그레이션 적용

```bash
# 백엔드 컨테이너에 접속
docker-compose -f docker-compose.prod.yml exec -T backend bash

# 마이그레이션 실행
alembic upgrade head

# 마이그레이션 상태 확인
alembic current
```

성공 메시지:

```
INFO  [alembic.runtime.migration] Running upgrade cdef0e0c1234 -> 1234f5e6c7d89, add new columns
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
Context include_statement False
Upgrading database to alembic 1234f5e6c7d89
```

---

## 6단계: 시드 데이터 투입 (최초 1회)

### 초기 마스터 데이터 생성

```bash
# 백엔드 컨테이너에서 시드 데이터 실행
docker-compose -f docker-compose.prod.yml exec -T backend python -m seed

# 또는
docker-compose -f docker-compose.prod.yml exec -T backend python seed/__main__.py
```

생성되는 데이터:

- 사용자 계정 (admin, editor, reviewer)
- 제품 마스터 (제품명, 레이어 수)
- 기본 컬럼 정의
- 검증 규칙
- 전산 출력 시스템 설정

**주의**: 데이터 투입은 최초 배포 시에만 실행합니다. 이후 배포에서는 실행하면 안 됩니다.

---

## 7단계: 정상 동작 확인

### 헬스 체크

```bash
# API 헬스 체크
curl -s http://localhost/api/health | jq .

# 성공 응답
{
  "status": "ok",
  "timestamp": "2026-02-22T14:00:00Z"
}
```

### 데이터베이스 연결 확인

```bash
# 데이터베이스 접속 테스트
docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod -c "SELECT 1;"

# 성공 응답
 ?column?
----------
        1
(1 row)
```

### 로그 확인

```bash
# 최근 100줄 로그 확인
docker-compose -f docker-compose.prod.yml logs --tail=100

# 특정 서비스 로그만 확인
docker-compose -f docker-compose.prod.yml logs backend
docker-compose -f docker-compose.prod.yml logs frontend
```

---

## Nginx 설정

### 현재 설정 설명

프로덕션 환경의 Nginx 설정은 다음과 같이 동작합니다:

**포트 80으로 들어온 요청:**
- `/api/` 경로: 백엔드 (포트 8000)로 라우팅
- 그 외: 프론트엔드 (포트 5173)로 라우팅

**프록시 헤더:**
- X-Real-IP: 클라이언트 실제 IP 기록
- X-Forwarded-For: 프록시 체인 추적
- Host: 원본 호스트명 전달

### 도메인/포트 변경

#### 1. 포트 변경 (80 이외)

`nginx/nginx.prod.conf` 수정:

```nginx
server {
    listen 8080;  # 포트 변경
    server_name localhost;
    ...
}
```

`docker-compose.prod.yml` 수정:

```yaml
nginx:
  ports:
    - "8080:80"  # 호스트 포트 변경
```

#### 2. 도메인 추가

`nginx/nginx.prod.conf` 수정:

```nginx
server {
    listen 80;
    server_name pcm.company.com;  # 도메인 추가
    ...
}
```

변경 후 재배포:

```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### HTTPS 설정 (선택)

#### Let's Encrypt 무료 인증서 사용

```bash
# Certbot 설치 (호스트 서버)
sudo apt-get install certbot python3-certbot-nginx

# 인증서 발급
sudo certbot certonly --standalone -d pcm.company.com

# 인증서 경로
# /etc/letsencrypt/live/pcm.company.com/fullchain.pem
# /etc/letsencrypt/live/pcm.company.com/privkey.pem
```

#### Nginx 설정 수정

`nginx/nginx.prod.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name pcm.company.com;

    ssl_certificate /etc/letsencrypt/live/pcm.company.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pcm.company.com/privkey.pem;

    # SSL 최적화
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
}

# HTTP → HTTPS 리다이렉트
server {
    listen 80;
    server_name pcm.company.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 업데이트 배포

### 코드 업데이트 절차

#### 1. 최신 코드 다운로드

```bash
# 현재 상태 확인
git status

# 최신 코드 다운로드
git fetch origin
git pull origin main
```

#### 2. 변경사항 확인

```bash
# 변경된 파일 확인
git diff HEAD~1 HEAD

# 마이그레이션 파일 확인
ls -la backend/alembic/versions/
```

#### 3. 이미지 재빌드 (필요한 경우)

```bash
# 의존성 변경이 있으면 재빌드
docker-compose -f docker-compose.prod.yml build backend frontend
```

#### 4. 마이그레이션 적용 (필요한 경우)

```bash
# 새 마이그레이션 파일이 있으면 적용
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

# 마이그레이션 실행
docker-compose -f docker-compose.prod.yml exec -T backend alembic upgrade head
```

#### 5. 서비스 재시작

```bash
# 서비스 재시작 (자동으로 새 이미지 사용)
docker-compose -f docker-compose.prod.yml restart backend frontend
```

#### 6. 정상 동작 확인

```bash
# 서비스 상태 확인
docker-compose -f docker-compose.prod.yml ps

# 로그 확인
docker-compose -f docker-compose.prod.yml logs --tail=50
```

### 다운타임 최소화

**무중단 배포 방법:**

1. 새 버전의 백엔드 이미지 빌드
2. 로드 밸런서 헬스 체크 설정 (필요한 경우)
3. 구버전과 신버전 동시 실행 (Docker Swarm/Kubernetes 환경)
4. 트래픽을 신버전으로 점진적 이전
5. 구버전 중지

**간단한 환경의 다운타임 배포:**

```bash
# 서비스 내려도 괜찮으면 이렇게 단순하게 수행
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### 롤백 방법

#### 코드 버전 롤백

```bash
# 이전 커밋으로 돌아가기
git log --oneline | head -10
git revert <commit-hash>  # 또는 git reset --hard <commit-hash>

# 이미지 재빌드
docker-compose -f docker-compose.prod.yml build

# 서비스 재시작
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

# 마이그레이션 되돌리기 (필요한 경우)
docker-compose -f docker-compose.prod.yml exec -T backend alembic downgrade -1
```

#### 데이터베이스 롤백

```bash
# 방법 1: 복구 스크립트 사용 (권장)
# 가장 최근 백업 찾기
ls -t /backup/pcm/backup_*.sql | head -1

# 해당 백업으로 복구
./scripts/restore-db.sh /backup/pcm/backup_2026-02-22_140000.sql

# 방법 2: 이전 백업으로 복구 (예: 이틀 전)
BACKUP_FILE=$(find /backup/pcm -name "backup_*.sql" -mtime +1 -mtime -2 | head -1)
./scripts/restore-db.sh "$BACKUP_FILE"
```

#### 부분 롤백 (특정 테이블만)

```bash
# 특정 테이블만 복구하려면 (고급)
# 백업에서 특정 테이블만 추출 후 복구 가능
pg_restore --data-only --table=projects /backup/pcm/backup_2026-02-22_140000.sql | \
    docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod
```

---

## 운영 관리

### 서비스 상태 확인

#### 서비스 목록 조회

```bash
# 현재 실행 중인 서비스
docker-compose -f docker-compose.prod.yml ps

# 상세 정보
docker-compose -f docker-compose.prod.yml ps -a
```

#### 개별 서비스 상태

```bash
# 특정 서비스 상태
docker-compose -f docker-compose.prod.yml ps backend
docker-compose -f docker-compose.prod.yml ps frontend
docker-compose -f docker-compose.prod.yml ps db
```

### 로그 확인

#### 실시간 로그

```bash
# 모든 서비스 로그 (실시간)
docker-compose -f docker-compose.prod.yml logs -f

# 특정 서비스만
docker-compose -f docker-compose.prod.yml logs -f backend

# 마지막 N줄
docker-compose -f docker-compose.prod.yml logs --tail=100 backend
```

#### 타임스탬프와 함께 확인

```bash
# 타임스탬프 표시
docker-compose -f docker-compose.prod.yml logs -t backend

# 시간대별 필터링
docker-compose -f docker-compose.prod.yml logs --since=2h backend
```

### 디스크 정리

#### Docker 이미지 정리

```bash
# 사용하지 않는 이미지 삭제
docker image prune -a -f

# 용량 확인
docker system df

# 상세 정리
docker system prune -a --volumes
```

#### 로그 정리

```bash
# Docker 로그 최대 크기 설정
# /etc/docker/daemon.json 에 추가:
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}

# 데몬 재시작
sudo systemctl restart docker
```

#### PostgreSQL 데이터 정리

```bash
# 데이터베이스 사용 공간 확인
docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod -c "\l+"

# 데이터베이스 최적화
docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod -c "VACUUM ANALYZE;"
```

### 모니터링 팁

#### CPU/메모리 사용량

```bash
# 실시간 모니터링
docker stats

# 특정 컨테이너만
docker stats process-condition-manager-backend-1
```

#### 디스크 사용량

```bash
# 전체 디스크 사용량
docker system df

# 볼륨 사용량
docker volume ls
docker volume inspect <volume-name>
```

#### 네트워크 상태

```bash
# 네트워크 목록
docker network ls

# 네트워크 상세 정보
docker network inspect pcm-network
```

---

## 보안 체크리스트

### 1. 기본 비밀번호 변경

```bash
# .env 파일 확인
grep PASSWORD .env
# 출력: DB_PASSWORD=<강력한 비밀번호>

# 기본값 사용 여부 확인
grep "pcm_pass\|change-this" .env
# 기본값이 있으면 변경 필요
```

### 2. .env 파일 권한 설정

```bash
# 권한 확인
ls -la .env
# 예상: -rw------- (600) 권한

# 권한 수정 (필요한 경우)
chmod 600 .env
```

### 3. 방화벽 포트 설정

```bash
# UFW 사용 (Ubuntu)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5432/tcp from <내부-ip>  # 내부 접근만 허용
sudo ufw enable

# firewalld 사용 (CentOS)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=5432/tcp --source=<내부-ip>
sudo firewall-cmd --reload
```

### 4. JWT Secret 변경

```bash
# 강력한 SECRET_KEY 생성
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# .env 파일 수정
nano .env
# SECRET_KEY=<생성된 값으로 변경>

# 서비스 재시작
docker-compose -f docker-compose.prod.yml restart backend
```

### 5. 데이터베이스 접근 제한

```bash
# PostgreSQL 비밀번호 인증 설정
docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod -c "ALTER USER pcm_prod_user WITH PASSWORD '<새-비밀번호>';"

# pg_hba.conf 수정 (호스트별 접근 제한)
# md5 또는 scram-sha-256 인증 사용
```

### 6. CORS 설정 확인

```bash
# 백엔드 config.py 확인
grep CORS_ORIGINS backend/app/config.py

# 프로덕션에서는 특정 도메인만 허용하도록 설정
# CORS_ORIGINS="https://pcm.company.com"
```

### 7. HTTPS 설정 (필수)

- Let's Encrypt 인증서 설치 (위의 "HTTPS 설정" 섹션 참조)
- HTTP 트래픽을 HTTPS로 리다이렉트
- HSTS 헤더 설정

### 8. 로그 보안

```bash
# 민감한 정보가 로그에 기록되지 않는지 확인
docker-compose -f docker-compose.prod.yml logs | grep -i password
docker-compose -f docker-compose.prod.yml logs | grep -i secret

# 결과가 없으면 안전함
```

---

## 자동 백업 설정

### 백업 및 복구 스크립트 준비

두 가지 스크립트가 포함되어 있습니다:

- `scripts/backup-db.sh` - 데이터베이스 자동 백업 (7일 자동 보관)
- `scripts/restore-db.sh` - 백업 파일에서 복구

```bash
# 스크립트 실행 권한 확인
ls -la scripts/backup-db.sh scripts/restore-db.sh

# 권한이 없으면 설정
chmod +x scripts/backup-db.sh scripts/restore-db.sh

# 백업 디렉토리 생성
mkdir -p /backup/pcm
chmod 750 /backup/pcm

# 백업 스크립트 테스트 (수동 실행)
./scripts/backup-db.sh
```

각 스크립트의 기능:

**백업 스크립트 (`backup-db.sh`)**
- Docker Compose를 사용하여 PostgreSQL 데이터베이스 백업
- 타임스탐프가 포함된 SQL 파일로 저장 (예: `backup_2026-02-22_120000.sql`)
- 7일 이상 된 백업 자동 삭제
- 성공/실패 상태를 명확하게 표시

**복구 스크립트 (`restore-db.sh`)**
- 지정된 백업 파일에서 데이터베이스 복구
- 복구 전 확인 메시지 표시 (데이터 손실 경고)
- 복구 후 테이블 수를 확인하여 정상 여부 검증

### 정기 백업 (Cron)

#### Cron 작업 설정

```bash
# Cron 작업 편집
crontab -e

# 다음 줄 추가 (매일 새벽 2시 백업)
# 형식: 분(0-59) 시간(0-23) 일(1-31) 월(1-12) 요일(0-6)
0 2 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1

# Cron 작업 확인
crontab -l

# 로그 확인
tail -f /var/log/pcm-backup.log
```

#### Cron 설정 예시

여러 가지 백업 전략을 선택할 수 있습니다:

**1. 매일 새벽 2시 (권장)**
```bash
0 2 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1
```

**2. 매 6시간마다 (중요한 데이터인 경우)**
```bash
0 0,6,12,18 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1
```

**3. 매일 여러 번 (오전, 오후, 저녁)**
```bash
0 2 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1
0 14 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1
```

**4. 주중에만 (비용 절감)**
```bash
0 2 * * 1-5 /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1
```

**5. 월요일마다 (주단위 전체 백업)**
```bash
0 3 * * 1 /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup-weekly.log 2>&1
```

#### Cron 백업 로그 확인

```bash
# 실시간 로그 확인
tail -f /var/log/pcm-backup.log

# 최근 50줄 확인
tail -50 /var/log/pcm-backup.log

# 특정 날짜의 로그 확인
grep "2026-02-22" /var/log/pcm-backup.log

# 백업 성공/실패 통계
grep "✓ 백업 성공" /var/log/pcm-backup.log | wc -l  # 성공 횟수
grep "✗ 백업 실패" /var/log/pcm-backup.log | wc -l  # 실패 횟수
```

#### Cron 백업 이메일 알림 (옵션)

```bash
# mailutils 설치
sudo apt-get install mailutils

# Cron 작업 수정 (MAILTO 추가)
MAILTO=admin@company.com
0 2 * * * /opt/process-condition-manager/scripts/backup-db.sh >> /var/log/pcm-backup.log 2>&1

# 실패만 알림하려면 별도 스크립트 작성
```

### 백업 확인

```bash
# 백업 파일 목록
ls -lh /backup/pcm/

# 최근 백업 확인
ls -lt /backup/pcm/ | head -5
```

### 복구 절차

#### 복구 스크립트 사용 (권장)

```bash
# 백업 파일 확인
ls -l /backup/pcm/backup_*.sql

# 가장 최근 백업으로 복구
./scripts/restore-db.sh /backup/pcm/backup_2026-02-22_020000.sql

# 상세 출력 예시:
# ╔════════════════════════════════════════════════════════════════╗
# ║          데이터베이스 복구 시작                                ║
# ╚════════════════════════════════════════════════════════════════╝
#
# ✓ 백업 파일 확인
#   - 파일: /backup/pcm/backup_2026-02-22_020000.sql
#   - 크기: 156M
#
# ✓ 데이터베이스 연결 확인
#   - 데이터베이스: pcm_prod
#   - 사용자: pcm_prod_user
#
# 계속하시겠습니까? (yes/no): yes
```

#### 수동 복구 (고급)

직접 pg_dump 명령어로 복구하려면:

```bash
# 데이터베이스 백업 파일이 있는 경우
docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod < /backup/pcm/backup_2026-02-22_020000.sql

# 진행 상황 보기
docker-compose -f docker-compose.prod.yml exec -T db psql -U pcm_prod_user -d pcm_prod -f /backup/pcm/backup_2026-02-22_020000.sql
```

#### 특정 시점으로 복구

백업에서 특정 날짜의 데이터를 복구하려면:

```bash
# 5일 전 백업으로 복구
BACKUP_FILE=$(find /backup/pcm -name "backup_*.sql" -mtime +4 -mtime -5 | head -1)

# 복구 실행
./scripts/restore-db.sh "$BACKUP_FILE"
```

---

## 문제 해결

### 컨테이너 시작 안 됨

```bash
# 로그 확인
docker-compose -f docker-compose.prod.yml logs backend

# 일반적인 원인:
# 1. 환경 변수 누락: .env 파일 확인
# 2. 포트 중복: sudo lsof -i :8000 으로 확인
# 3. 이미지 빌드 실패: docker-compose build --no-cache
```

### 데이터베이스 연결 실패

```bash
# 데이터베이스 상태 확인
docker-compose -f docker-compose.prod.yml ps db

# 데이터베이스 로그 확인
docker-compose -f docker-compose.prod.yml logs db

# 데이터베이스 재시작
docker-compose -f docker-compose.prod.yml restart db

# 연결 확인
docker-compose -f docker-compose.prod.yml exec -T db pg_isready
```

### API 응답 안 됨

```bash
# 백엔드 상태 확인
curl -v http://localhost/api/health

# 로그 확인
docker-compose -f docker-compose.prod.yml logs backend

# 포트 확인
sudo netstat -tlnp | grep 8000

# 재시작
docker-compose -f docker-compose.prod.yml restart backend
```

### 메모리 부족

```bash
# 메모리 사용량 확인
free -h
docker stats

# 불필요한 컨테이너 정리
docker container prune -f

# 불필요한 이미지 정리
docker image prune -a -f

# 디스크 공간 확인
df -h
```

---

## 지원 및 문의

배포 중 문제가 발생하면 다음을 확인하세요:

1. 로그 파일: `docker-compose -f docker-compose.prod.yml logs`
2. .env 파일: 모든 필수 변수가 설정되었는지 확인
3. 권한 설정: 파일 및 디렉토리 권한 확인
4. 포트 확인: 필요한 포트가 열려있는지 확인
5. 네트워크: 방화벽 및 DNS 설정 확인

기술 문제는 개발팀에 문의하세요.

---

**마지막 업데이트**: 2026-02-22
