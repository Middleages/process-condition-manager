# 빠른 시작 가이드

PCM (Process Condition Manager)를 처음 받았을 때 프로젝트를 실행하기까지의 모든 단계를 설명합니다.

## 목표

이 가이드를 따라 약 **5-10분 내**에 PCM을 로컬에서 실행하고, 웹 브라우저로 접속하여 시스템이 정상 작동하는지 확인합니다.

## 1단계: 사전 요구사항 설치

PCM을 실행하기 위해 아래 소프트웨어들이 설치되어 있어야 합니다.

### Docker와 Docker Compose 설치

**Docker**는 PCM의 모든 서비스(데이터베이스, 백엔드, 프론트엔드)를 컨테이너로 실행합니다.

- **Windows/Mac**: Docker Desktop 다운로드 및 설치
  - https://www.docker.com/products/docker-desktop
  - 설치 후 시스템 재부팅
  - 명령줄에서 `docker --version` 확인

- **Linux**: 패키지 관리자로 설치
  ```bash
  sudo apt update
  sudo apt install docker.io docker-compose -y
  ```

설치 확인:
```bash
docker --version
docker-compose --version
```

### Node.js 설치 (선택사항)

프론트엔드를 Docker 없이 로컬에서만 개발하려는 경우에만 필요합니다.

- https://nodejs.org/ (LTS 20 이상)
- 설치 확인: `node --version` 및 `npm --version`

### Git 설치 (권장)

```bash
git --version  # 이미 설치되어 있는지 확인
```

- **Windows**: Git Bash 다운로드
  - https://git-scm.com/download/win

- **Mac/Linux**: 일반적으로 미리 설치됨

## 2단계: 프로젝트 다운로드

프로젝트를 로컬 컴퓨터에 복제합니다.

```bash
# 프로젝트 폴더 생성 (원하는 위치)
cd ~/projects  # 또는 선호하는 디렉토리

# GitHub에서 복제
git clone https://github.com/Middleages/process-condition-manager.git

# 프로젝트 디렉토리로 이동
cd process-condition-manager
```

## 3단계: 환경 변수 설정

프로젝트에는 `.env.example` 파일이 있습니다. 이를 `.env` 파일로 복사하여 환경을 설정합니다.

### 환경 파일 생성

```bash
# 프로젝트 루트 디렉토리에서
cp .env.example .env
```

### .env 파일 내용 확인 및 필요시 수정

`.env` 파일을 텍스트 에디터로 열어서 다음 내용을 확인합니다:

```
DB_NAME=pcm
DB_USER=pcm_user
DB_PASSWORD=pcm_pass
SECRET_KEY=change-this-secret-key

VITE_API_URL=
```

**설명**:
- `DB_NAME`: 데이터베이스 이름 (기본값 `pcm`)
- `DB_USER`: 데이터베이스 사용자 (기본값 `pcm_user`)
- `DB_PASSWORD`: 데이터베이스 비밀번호 (기본값 `pcm_pass`)
- `SECRET_KEY`: JWT 토큰 생성 비밀키. 보안을 위해 별도의 값으로 변경 권장
- `VITE_API_URL`: 프론트엔드 API URL
  - **로컬 개발 (Docker 이용)**: 비워두기 (기본값, Nginx를 통한 프록시)
  - **로컬 개발 (Docker 미사용)**: `http://localhost:8000`

대부분의 로컬 개발은 기본값으로 충분합니다.

## 4단계: Docker Compose로 전체 서비스 실행

프로젝트 루트 디렉토리에서 다음 명령을 실행합니다:

```bash
docker-compose up -d
```

**옵션 설명**:
- `-d`: 데몬 모드 (백그라운드에서 실행)
- 생략하면 로그가 터미널에 나타나고 Ctrl+C로 중지 가능

### 서비스 시작 확인

모든 서비스가 정상 시작되는지 확인합니다:

```bash
docker-compose ps
```

출력 예시:
```
NAME        STATUS
db          Up (healthy)
backend     Up (started)
frontend    Up
nginx       Up
```

**상태별 의미**:
- `Up (healthy)`: 정상 작동
- `Up (started)`: 시작되었으나 아직 완전히 준비되지 않음 (보통 수 초 내에 healthy 됨)
- `Exited` 또는 `Dead`: 에러 발생, 로그 확인 필요

### 첫 시작 시 주의사항

첫 실행 시에는 다음과 같은 단계가 자동으로 진행됩니다:

1. **Docker 이미지 다운로드**: 처음 실행 시 5-10분 소요
2. **데이터베이스 초기화**: PostgreSQL 컨테이너 구동
3. **백엔드 준비**: FastAPI 서버 시작
4. **프론트엔드 번들링**: Vite 번들 생성

전체 준비에 보통 1-2분 소요됩니다.

## 5단계: 웹 브라우저에서 접속

웹 브라우저를 열어서 다음 주소들에 접속합니다.

### 프론트엔드 (메인 애플리케이션)

```
http://localhost
```

또는

```
http://localhost:80
```

**예상 화면**:
- 로그인 페이지가 나타납니다
- 기본 사용자 계정으로 로그인 가능

### 백엔드 API 문서 (개발자용)

```
http://localhost/api/docs
```

**특징**:
- Swagger UI로 모든 API 엔드포인트 조회 가능
- API 직접 테스트 가능
- 요청/응답 구조 확인 가능

### PostgreSQL 관리 (선택사항)

pgAdmin을 설치한 경우, 데이터베이스 상태 확인:

```
http://localhost:5050  (별도 설치 필요)
```

기본 설치에는 포함되지 않으므로 별도 설정 필요합니다.

## 6단계: 기본 사용자 계정으로 로그인

PCM에는 초기 테스트 사용자 계정이 시드 데이터로 제공됩니다.

### 기본 테스트 계정

| 역할 | 이메일 | 비밀번호 |
|------|--------|----------|
| Admin | admin@example.com | admin123 |
| Reviewer | reviewer@example.com | reviewer123 |
| Editor | editor@example.com | editor123 |

로그인 후 대시보드가 나타나면 시스템이 정상 작동하는 것입니다.

## 7단계: 시드 데이터 확인

프로젝트에는 테스트용 마스터 데이터가 포함되어 있습니다.

### 시드 데이터 내용

시스템이 처음 시작될 때 다음 데이터가 자동으로 생성됩니다:

- **제품 (Product)**: 샘플 제품 3-5개 (예: ProductA, ProductB, ProductC)
- **레이어 (Layer)**: 각 제품당 30-60개의 레이어
- **컬럼 (Column)**: 약 250개의 공정 파라미터
- **사용자 (User)**: admin, reviewer, editor 등 기본 계정
- **라인 (Line)**: 반도체 공정 라인 정보

### 시드 데이터 수동 재투입 (필요시)

데이터베이스를 초기화하고 다시 시드 데이터를 투입하려면:

```bash
# 컨테이너 중지 및 볼륨 삭제 (데이터 초기화)
docker-compose down -v

# 다시 시작
docker-compose up -d
```

이 명령어는 모든 데이터를 삭제하고 초처음부터 시작합니다.

## 개발 중 유용한 명령어

### 개별 서비스만 실행하기

**프론트엔드만 실행** (백엔드는 별도):

```bash
docker-compose up frontend -d
```

**백엔드만 실행** (프론트엔드는 별도):

```bash
docker-compose up backend -d
```

**로그 확인**:

```bash
# 모든 서비스 로그
docker-compose logs -f

# 특정 서비스 로그만
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db
```

### 서비스 중지 및 재시작

**모든 서비스 중지** (데이터 보존):

```bash
docker-compose down
```

**모든 서비스 중지 및 데이터 삭제**:

```bash
docker-compose down -v
```

**서비스 재시작**:

```bash
docker-compose restart
```

**특정 서비스 재시작**:

```bash
docker-compose restart backend
```

### 백엔드만 로컬에서 개발

Docker를 사용하지 않고 백엔드만 로컬에서 직접 실행하려면:

```bash
# 1. 데이터베이스는 Docker에서만 실행
docker-compose up db -d

# 2. 백엔드 디렉토리로 이동
cd backend

# 3. Python 가상환경 생성
python -m venv venv

# 4. 가상환경 활성화
# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate

# 5. 의존성 설치
pip install -r requirements.txt

# 6. 백엔드 실행
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 프론트엔드만 로컬에서 개발

```bash
# 1. 백엔드는 Docker에서만 실행
docker-compose up backend -d

# 2. 프론트엔드 디렉토리로 이동
cd frontend

# 3. 의존성 설치
npm install

# 4. .env 또는 .env.local 파일에서 API URL 설정
# VITE_API_URL=http://localhost:8000

# 5. 개발 서버 실행
npm run dev
```

## 자주 묻는 질문 (FAQ)

### 포트가 이미 사용 중이라는 에러가 나옵니다

다른 애플리케이션이 같은 포트를 사용하고 있습니다.

**해결방법**:

```bash
# 해당 포트를 사용하는 프로세스 찾기 (Mac/Linux)
lsof -i :5173  # 프론트엔드 포트
lsof -i :8000  # 백엔드 포트
lsof -i :5432  # 데이터베이스 포트
lsof -i :80    # Nginx 포트

# 프로세스 종료
kill -9 <PID>
```

또는 `docker-compose.yml`의 포트 번호를 변경합니다:

```yaml
services:
  frontend:
    ports:
      - "5174:5173"  # 5173 대신 5174 사용
```

### 데이터베이스 연결 에러

```
Error: Unable to connect to database
```

**해결방법**:

```bash
# 데이터베이스 상태 확인
docker-compose logs db

# 데이터베이스 헬스체크 확인
docker-compose ps db
```

### "Cannot find module" 에러

프론트엔드 의존성이 없는 경우:

```bash
cd frontend
npm install
cd ..
docker-compose up frontend -d
```

### 로그인 후 자꾸 로그인 페이지로 돌아갑니다

JWT 토큰 문제일 수 있습니다:

```bash
# 브라우저 개발자 도구 (F12) → Application → Cookies에서
# 모든 쿠키 삭제 후 다시 로그인

# 또는
docker-compose down -v
docker-compose up -d
```

## 문제 해결 가이드

### 1단계: 서비스 상태 확인

```bash
docker-compose ps
```

모든 서비스가 `Up` 상태인지 확인합니다.

### 2단계: 로그 확인

```bash
# 전체 로그
docker-compose logs

# 특정 서비스의 최근 50줄 로그
docker-compose logs --tail=50 backend
```

### 3단계: 컨테이너 재구축

캐시 문제로 인한 에러:

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### 4단계: 전체 초기화

모든 데이터를 삭제하고 처음부터 시작:

```bash
docker-compose down -v
docker system prune -a
docker-compose up -d
```

## 다음 단계

PCM이 정상 작동하면 다음 문서들을 참고하세요:

- **02-architecture-overview.md**: 시스템 아키텍처 및 폴더 구조 이해
- **CLAUDE.md**: 프로젝트 상세 기술 문서
- **.claude/docs/**: 추가 참고 문서들

## 추가 리소스

- **FastAPI 문서**: https://fastapi.tiangolo.com/
- **React 문서**: https://react.dev/
- **Docker 문서**: https://docs.docker.com/
- **PostgreSQL 문서**: https://www.postgresql.org/docs/

---

**마지막 수정**: 2026-02-22
**문서 버전**: 1.0.0
