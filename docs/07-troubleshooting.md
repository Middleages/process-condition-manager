# 문제 해결 가이드

Process Condition Manager 개발 중 자주 발생하는 문제와 해결 방법입니다.

## Docker 관련 문제

### 문제: 컨테이너가 시작되지 않음

**증상:**
```
docker-compose up
ERROR: Service 'backend' failed to start
Error response from daemon: driver failed programming external connectivity
```

**원인:**
- 포트가 이미 사용 중
- Docker daemon이 실행되지 않음
- 이미지 빌드 실패

**해결:**

1. Docker daemon 확인:
```bash
# Docker 상태 확인
docker ps

# Docker daemon 재시작 (Mac/Linux)
sudo systemctl restart docker

# Docker Desktop 재시작 (Windows)
# Docker Desktop 앱을 완전히 종료했다 다시 시작
```

2. 컨테이너 정리 후 재시작:
```bash
# 실행 중인 모든 컨테이너 중지
docker-compose down

# 이미지 재빌드
docker-compose up -d --build

# 로그 확인
docker-compose logs -f
```

3. 특정 서비스만 재시작:
```bash
# 백엔드만 재시작
docker-compose restart backend

# 프론트엔드만 재시작
docker-compose restart frontend
```

### 문제: 포트 충돌

**증상:**
```
Error response from daemon:
Bind for 0.0.0.0:5173 failed: port is already in use
```

**원인:**
- 다른 애플리케이션이 포트를 사용 중
- 이전에 실행한 컨테이너가 종료되지 않음

**해결:**

1. 포트 사용 프로세스 확인:
```bash
# Linux/Mac: 포트 5173 사용하는 프로세스 찾기
lsof -i :5173

# Windows: 포트 8000 사용하는 프로세스 찾기
netstat -ano | findstr :8000

# 프로세스 종료 (PID는 위에서 확인)
kill -9 <PID>
```

2. Docker 컨테이너 정리:
```bash
# 모든 Docker 컨테이너 중지
docker-compose down

# 전체 시스템 정리 (이미지 제외)
docker system prune

# 사용하지 않는 모든 이미지/컨테이너 정리
docker system prune -a
```

3. 포트 변경:
```bash
# docker-compose.yml에서 포트 변경
# services:
#   frontend:
#     ports:
#       - "5174:5173"  # 5173 → 5174로 변경
```

**포트 사용 현황:**
- 5173: 프론트엔드 (Vite)
- 8000: 백엔드 (FastAPI)
- 5432: 데이터베이스 (PostgreSQL)
- 80: Nginx (리버스 프록시)

### 문제: 볼륨/데이터 초기화 필요

**증상:**
- 데이터베이스 스키마가 손상됨
- 데이터가 필요 없고 처음부터 시작하려고 함

**해결:**

1. 볼륨 삭제 후 재시작 (데이터 손실):
```bash
# 모든 컨테이너와 볼륨 삭제
docker-compose down -v

# 전체 시스템 정리
docker system prune -a --volumes

# 처음부터 시작
docker-compose up -d --build
```

2. 데이터베이스만 초기화:
```bash
# 데이터베이스 컨테이너만 재시작
docker-compose down db
docker volume rm process-condition-manager_pgdata

docker-compose up -d db

# 마이그레이션과 시드 실행
docker-compose exec backend alembic upgrade head
docker-compose exec backend python -m app.seed
```

3. 특정 테이블만 초기화:
```bash
# PostgreSQL 접속
docker-compose exec db psql -U pcm_user -d pcm

# SQL에서 테이블 삭제
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS change_logs CASCADE;

# 종료
\q

# 마이그레이션 다시 실행
docker-compose exec backend alembic upgrade head
```

### 문제: Docker 로그 확인

**증상:**
- 컨테이너가 실행되지만 뭔가 잘못됨
- 어떤 오류가 발생하는지 모름

**해결:**

1. 모든 서비스 로그 확인:
```bash
# 실시간 모든 서비스 로그
docker-compose logs -f

# 마지막 100줄만 보기
docker-compose logs --tail=100

# 특정 서비스만 로그 확인
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f db
```

2. 컨테이너가 시작되자마자 실패하는 경우:
```bash
# 상세 정보 확인
docker-compose logs backend 2>&1 | tail -50

# 컨테이너 검사
docker-compose ps

# 컨테이너 상태 상세 확인
docker inspect <container_id>
```

3. 오류 로그 저장:
```bash
# 로그를 파일에 저장
docker-compose logs > docker-logs.txt 2>&1

# 특정 시간 이후의 로그만
docker-compose logs --since 30m
```

## 데이터베이스 관련 문제

### 문제: 데이터베이스 연결 실패

**증상:**
```
sqlalchemy.exc.OperationalError:
(psycopg2.OperationalError) could not connect to server
```

**원인:**
- PostgreSQL 서버가 실행되지 않음
- 연결 정보가 잘못됨
- 데이터베이스가 초기화되지 않음

**해결:**

1. 데이터베이스 서버 확인:
```bash
# DB 컨테이너 상태 확인
docker-compose ps db

# DB 로그 확인
docker-compose logs db

# DB 연결 테스트
docker-compose exec db psql -U pcm_user -d pcm -c "SELECT 1"
```

2. 환경 변수 확인:
```bash
# .env 파일 확인
cat .env

# 또는 .env.example 복사
cp .env.example .env

# 백엔드의 DATABASE_URL 확인
docker-compose exec backend python -c "from app.config import settings; print(settings.DATABASE_URL)"
```

3. 컨테이너 재시작:
```bash
# DB와 백엔드 재시작
docker-compose down
docker-compose up -d db

# DB가 준비될 때까지 대기
docker-compose exec db pg_isready -U pcm_user

# 백엔드 시작
docker-compose up -d backend
```

### 문제: 마이그레이션 오류

**증상:**
```
sqlalchemy.exc.OperationalError: (psycopg2.ProgrammingError)
relation "alembic_version" does not exist
```

**원인:**
- 마이그레이션이 처음 실행됨
- 데이터베이스가 리셋됨
- 마이그레이션 파일이 손상됨

**해결:**

1. 마이그레이션 상태 확인:
```bash
# 현재 마이그레이션 버전
docker-compose exec backend alembic current

# 마이그레이션 히스토리
docker-compose exec backend alembic history
```

2. 마이그레이션 다시 실행:
```bash
# head(최신)까지 모든 마이그레이션 실행
docker-compose exec backend alembic upgrade head

# 진행 상황 확인
docker-compose exec backend alembic current
```

3. 마이그레이션 리셋:
```bash
# 모든 마이그레이션 되돌리기 (위험!)
docker-compose exec backend alembic downgrade base

# 처음부터 다시 실행
docker-compose exec backend alembic upgrade head
```

### 문제: 마이그레이션 충돌

**증상:**
```
alembic.util.exc.CommandError: Multiple bases found in the target metadata
```

**원인:**
- 두 명의 개발자가 동시에 마이그레이션을 생성함
- 마이그레이션 파일의 depends_on이 잘못됨

**해결:**

1. 마이그레이션 파일 확인:
```bash
# 파일 목록 확인
ls -la backend/alembic/versions/

# 각 파일의 depends_on 확인
grep "depends_on" backend/alembic/versions/*.py
```

2. 마이그레이션 파일 수정:
```python
# 파일: backend/alembic/versions/013_xxx.py
revision = '013_xxx'
down_revision = '012_extend_export_column_mappings'  # 이전 버전을 명시
```

3. Git에서 충돌 해결:
```bash
# 마이그레이션 파일 병합
git add backend/alembic/versions/
git commit -m "Resolve migration conflict"

# 마이그레이션 다시 실행
docker-compose exec backend alembic upgrade head
```

### 문제: 시드 데이터 중복 오류

**증상:**
```
IntegrityError: (psycopg2.IntegrityError)
duplicate key value violates unique constraint "users_username_key"
```

**원인:**
- 시드가 여러 번 실행됨
- 시드 데이터가 이미 존재함

**해결:**

1. 시드 전 확인:
```bash
# 데이터베이스에 데이터 있는지 확인
docker-compose exec db psql -U pcm_user -d pcm -c "SELECT count(*) FROM users"

# 데이터가 있으면 리셋
docker-compose exec backend alembic downgrade base
docker-compose exec backend alembic upgrade head
docker-compose exec backend python -m app.seed
```

2. 시드 스크립트 Idempotency:
```python
# runner.py의 시드 함수는 이미 체크를 포함
# 하지만 수동으로 재실행 시 문제 발생 가능

# 더 안전한 방법:
docker-compose down -v  # 모든 볼륨 삭제
docker-compose up -d    # 처음부터 시작
```

### 문제: 테이블이 없다는 오류

**증상:**
```
relation "projects" does not exist
```

**원인:**
- 마이그레이션이 실행되지 않음
- 데이터베이스가 초기화되지 않음

**해결:**

```bash
# 현재 마이그레이션 상태 확인
docker-compose exec backend alembic current

# head까지 마이그레이션 실행
docker-compose exec backend alembic upgrade head

# 테이블 확인
docker-compose exec db psql -U pcm_user -d pcm -c "\dt"
```

## 프론트엔드 관련 문제

### 문제: npm install 오류

**증상:**
```
npm ERR! 404  Not Found - GET https://registry.npmjs.org/package-name
npm ERR! 404
npm ERR! 404  'package-name' is not in this registry.
```

**원인:**
- 패키지명이 잘못됨
- npm 레지스트리 연결 불가
- package.json이 손상됨

**해결:**

1. npm 캐시 초기화:
```bash
# 백엔드 컨테이너 진입
docker-compose exec frontend bash

# npm 캐시 정리
npm cache clean --force

# node_modules 삭제
rm -rf node_modules package-lock.json

# 다시 설치
npm install
```

2. 호스트에서 설치 (Docker 외부):
```bash
cd frontend

# npm 버전 확인
npm -v

# 패키지 설치
npm install

# 또는 yarn 사용
yarn install
```

3. package.json 확인:
```bash
# package.json 유효성 검사
npm list

# 손상된 패키지 찾기
npm ls --depth=0

# 호환되지 않는 버전 수정
npm audit
npm audit fix
```

### 문제: 빌드 실패 (TypeScript 오류)

**증상:**
```
error TS2339: Property 'xyz' does not exist on type '{}'
error TS2307: Cannot find module '@types/react'
```

**원인:**
- TypeScript 타입 정의 누락
- 컴파일 오류
- 의존성 충돌

**해결:**

1. 타입 정의 설치:
```bash
docker-compose exec frontend bash

# 누락된 타입 설치
npm install --save-dev @types/react @types/react-dom @types/node

# 또는 전체 타입 업데이트
npm install
```

2. TypeScript 설정 확인:
```bash
# tsconfig.json 확인
cat frontend/tsconfig.json

# strict mode 비활성화 (임시)
# "strict": false
```

3. 타입 오류 무시 (임시):
```typescript
// 파일 상단에 주석 추가
// @ts-nocheck

// 또는 특정 라인
// @ts-ignore
const value = someValue as any;
```

4. 의존성 문제 해결:
```bash
# 호환되지 않는 버전 체크
npm ls react react-dom

# 특정 버전 설치
npm install react@18.2.0 react-dom@18.2.0

# 의존성 문제 수정
npm audit fix --force
```

### 문제: 화면이 안 뜸 (빈 화면)

**증상:**
- 브라우저 http://localhost:5173 접속 시 빈 화면
- 콘솔에 오류 메시지 없음

**원인:**
- 빌드 오류
- 모듈 로딩 실패
- API 서버 연결 실패

**해결:**

1. 브라우저 콘솔 확인:
```
F12 → Console 탭 확인
"Cannot GET /", "404 Not Found" 등의 오류 확인
```

2. 프론트엔드 로그 확인:
```bash
docker-compose logs -f frontend
```

3. 빌드 상태 확인:
```bash
# 프론트엔드 컨테이너 진입
docker-compose exec frontend bash

# 빌드 시도
npm run build

# 개발 서버 로그 확인
npm run dev
```

4. API 서버 확인:
```bash
# 백엔드가 실행 중인가?
docker-compose exec frontend curl http://backend:8000/api

# 또는 브라우저에서
curl http://localhost:8000/api
```

### 문제: 로딩이 무한히 계속됨

**증상:**
- 페이지 로딩 중 계속 대기
- "Loading..." 메시지만 표시

**원인:**
- API 요청이 응답하지 않음
- 데이터 조회 쿼리가 느림
- 타임아웃 설정 필요

**해결:**

1. 네트워크 요청 확인:
```
F12 → Network 탭
API 요청이 Pending인지 확인
요청의 Headers/Response 확인
```

2. 백엔드 상태 확인:
```bash
# 백엔드가 응답하는가?
curl http://localhost:8000/docs

# 백엔드 로그 확인
docker-compose logs -f backend

# 특정 엔드포인트 테스트
curl http://localhost:8000/api/projects
```

3. 데이터 쿼리 최적화:
```bash
# 데이터베이스 쿼리 성능 확인
docker-compose exec backend alembic current

# 대용량 데이터 확인
docker-compose exec db psql -U pcm_user -d pcm -c "SELECT count(*) FROM projects"
```

4. 타임아웃 설정:
```typescript
// src/api/client.ts에서
const API_TIMEOUT = 30000; // 30초

axiosInstance.defaults.timeout = API_TIMEOUT;
```

### 문제: API 호출 실패 (CORS, 401, 404)

**증상:**

CORS 오류:
```
Access to XMLHttpRequest at 'http://localhost:8000/api/...'
from origin 'http://localhost:5173' has been blocked by CORS policy
```

401 인증 오류:
```
Unauthorized
```

404 엔드포인트 없음:
```
Not Found
```

**원인:**

CORS: 백엔드가 프론트엔드 요청을 허용하지 않음
401: 토큰이 없거나 만료됨
404: API 엔드포인트가 잘못됨

**해결:**

1. CORS 오류:
```bash
# 백엔드 CORS 설정 확인
docker-compose exec backend cat app/config.py | grep CORS

# 프론트엔드 API URL 확인
# .env에서 VITE_API_URL 확인

# 모든 origin 허용 (개발용, 프로덕션 금지)
# backend/app/main.py에서
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

2. 401 인증 오류:
```bash
# 로컬 스토리지에 토큰이 있는가?
# 브라우저 개발자 도구 → Application → Local Storage 확인

# 로그인 시도
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'

# JWT 토큰 저장 확인
# 백엔드에서 토큰이 발급되는가?
```

3. 404 엔드포인트 오류:
```bash
# 모든 엔드포인트 확인
curl http://localhost:8000/api/docs

# 또는 http://localhost:8000/docs 에 들어가 확인

# 엔드포인트 경로 확인
# 예: /api/projects vs /projects
```

4. API 키 설정:
```typescript
// src/api/client.ts에서 Authorization 헤더 추가
const token = localStorage.getItem('access_token');
if (token) {
  axiosInstance.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}
```

### 문제: Hot reload가 안 될 때

**증상:**
- 파일 수정 후 브라우저가 자동 새로고침되지 않음
- 수동으로 F5 눌러야 변경사항이 적용됨

**원인:**
- Vite 파일 감시 실패
- Docker 볼륨 마운트 문제

**해결:**

1. 프론트엔드 컨테이너 재시작:
```bash
docker-compose restart frontend

# 로그 확인
docker-compose logs -f frontend
```

2. Vite 설정 확인:
```javascript
// vite.config.ts
export default defineConfig({
  server: {
    watch: {
      usePolling: true,  // Docker에서 파일 감시 활성화
    },
  },
})
```

3. 홀드 리셋:
```bash
# 파일 시스템 캐시 정리
docker-compose exec frontend bash
rm -rf node_modules/.vite

# 개발 서버 재시작
docker-compose restart frontend
```

## 백엔드 관련 문제

### 문제: FastAPI 시작 실패

**증상:**
```
ERROR:    Application startup failed.
TypeError: __init__() got an unexpected keyword argument
```

**원인:**
- Python 패키지 버전 호환성 문제
- Import 오류
- 설정 오류

**해결:**

1. 백엔드 로그 확인:
```bash
docker-compose logs -f backend
```

2. Python 패키지 재설치:
```bash
# 요구사항 확인
docker-compose exec backend cat requirements.txt

# 패키지 재설치
docker-compose exec backend pip install -r requirements.txt

# 또는 컨테이너 재빌드
docker-compose down
docker-compose up -d --build backend
```

3. Python 버전 확인:
```bash
docker-compose exec backend python --version

# Dockerfile의 Python 버전 확인
cat backend/Dockerfile | grep "FROM python"
```

### 문제: Import 오류

**증상:**
```
ModuleNotFoundError: No module named 'app.models'
ImportError: cannot import name 'get_db' from 'app.database'
```

**원인:**
- 파일이 없거나 경로가 잘못됨
- `__init__.py` 파일 누락
- Python 경로 설정 문제

**해결:**

1. 파일 구조 확인:
```bash
# 모델 파일 확인
ls -la backend/app/models/

# __init__.py 확인
ls -la backend/app/__init__.py
ls -la backend/app/models/__init__.py
```

2. Import 경로 확인:
```bash
# 백엔드 진입
docker-compose exec backend bash

# Python 경로 확인
python -c "import sys; print(sys.path)"

# 직접 임포트 시도
python -c "from app.models import Project"
```

3. `__init__.py` 생성:
```bash
# 누락된 파일 생성
touch backend/app/__init__.py
touch backend/app/models/__init__.py
touch backend/app/routers/__init__.py

# 컨테이너 재시작
docker-compose restart backend
```

### 문제: 마이그레이션 후 스키마 불일치

**증상:**
```
ProgrammingError: column "xyz" does not exist
AttributeError: 'NoneType' object has no attribute 'id'
```

**원인:**
- 모델과 DB 스키마가 동기화되지 않음
- 마이그레이션을 적용하지 않음

**해결:**

1. 현재 상태 확인:
```bash
# 모델 정의 확인
grep -n "mapped_column" backend/app/models/project.py

# DB 스키마 확인
docker-compose exec db psql -U pcm_user -d pcm -c "\d projects"

# 마이그레이션 상태
docker-compose exec backend alembic current
```

2. 마이그레이션 확인:
```bash
# 새로운 마이그레이션이 필요한가?
docker-compose exec backend alembic history --verbose

# 누락된 마이그레이션이 있는가?
# 있으면 upgrade head
docker-compose exec backend alembic upgrade head
```

3. 모델 수정 후 마이그레이션:
```bash
# 1. 모델 수정 (backend/app/models/project.py)
# 2. 마이그레이션 생성
docker-compose exec backend alembic revision --autogenerate -m "add xyz column"

# 3. 마이그레이션 파일 검토
cat backend/alembic/versions/XXX_add_xyz_column.py

# 4. 적용
docker-compose exec backend alembic upgrade head

# 5. 확인
docker-compose exec db psql -U pcm_user -d pcm -c "\d projects"
```

### 문제: JWT 토큰 만료/인증 오류

**증상:**
```
401 Unauthorized
Invalid token or token expired
```

**원인:**
- 토큰이 만료됨
- 토큰이 잘못됨
- SECRET_KEY가 변경됨

**해결:**

1. 토큰 재발급:
```bash
# 로그인으로 새 토큰 발급
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}'
```

2. 브라우저 localStorage 확인:
```
F12 → Application → Local Storage → localhost:5173
access_token 확인
```

3. SECRET_KEY 확인:
```bash
# .env의 SECRET_KEY 확인
cat .env | grep SECRET_KEY

# 변경 전에 기존 토큰 모두 무효화
# 또는 환경변수 되돌림
```

4. Refresh Token:
```bash
# Refresh token으로 새 access token 획득
curl -X POST http://localhost:8000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"..."}'
```

## Git 관련 문제

### 문제: 머지 충돌

**증상:**
```
CONFLICT (content conflict): Merge conflict in backend/alembic/versions/...
Auto-merging failed
```

**원인:**
- 같은 파일을 두 브랜치에서 수정
- 마이그레이션 파일 충돌

**해결:**

1. 충돌 파일 확인:
```bash
# 충돌 파일 확인
git status

# 충돌 내용 보기
git diff backend/alembic/versions/...
```

2. 충돌 해결:
```bash
# 충돌 내용 편집
vim backend/alembic/versions/...

# 충돌 마크 제거 후 저장

# 파일 추가
git add backend/alembic/versions/...

# 커밋
git commit -m "Resolve merge conflict"
```

3. 마이그레이션 특화 충돌 해결:
```bash
# 마이그레이션 파일의 depends_on 수정
# 각 파일이 올바른 이전 버전을 depends하도록 수정

# 예:
# 기존: down_revision = '012_xxx'
# 수정: down_revision = '012_extend_export_column_mappings'

# 마이그레이션 검증
docker-compose exec backend alembic history
```

### 문제: 브랜치 전환 시 오류

**증상:**
```
error: Your local changes to the following files would be overwritten by checkout:
    backend/app/models/user.py
    frontend/src/App.tsx

Please commit your changes or stash them before you switch branches.
```

**원인:**
- 수정 중인 파일이 있음
- 커밋하지 않은 변경사항이 있음

**해결:**

1. 변경사항 저장:
```bash
# 현재 변경사항 확인
git status

# 변경사항 커밋
git add .
git commit -m "WIP: in progress work"

# 또는 임시 저장 (나중에 복원)
git stash

# 브랜치 전환
git checkout feature/xxx

# 저장된 변경사항 복원
git stash pop
```

2. 모든 변경사항 버리기 (위험!):
```bash
# 변경사항 버리기
git checkout -- .

# 또는
git reset --hard HEAD

# 추적하지 않는 파일도 삭제
git clean -fd
```

### 문제: .env 파일 관리

**증상:**
- .env 파일이 커밋됨
- 각 개발자의 .env가 다름
- 프로덕션 비밀키가 유출됨

**해결:**

1. .env 무시 설정:
```bash
# .gitignore에 추가 (이미 되어 있을 것)
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
echo "*.key" >> .gitignore

git add .gitignore
git commit -m "Update gitignore for .env"
```

2. .env.example 사용:
```bash
# .env.example에는 기본값만 포함
cp .env.example .env

# 필요에 따라 .env 수정 (로컬에만 유지)
```

3. 이미 커밋된 .env 제거:
```bash
# 파일을 Git에서만 제거 (로컬은 유지)
git rm --cached .env

git commit -m "Remove .env from version control"

# 또는 이력에서도 제거 (filter-branch)
git filter-branch --tree-filter 'rm -f .env' HEAD
```

## 일반 디버깅 팁

### 전체 시스템 상태 확인

```bash
# 모든 컨테이너 상태
docker-compose ps

# 모든 로그 확인
docker-compose logs

# 특정 컨테이너 상세 확인
docker-compose exec backend python -c "from app.config import settings; print(settings.DATABASE_URL)"
```

### 문제 해결 체크리스트

1. **Docker 상태 확인**
   ```bash
   docker ps
   docker-compose logs -f
   ```

2. **포트 확인**
   ```bash
   lsof -i :5173
   lsof -i :8000
   lsof -i :5432
   ```

3. **DB 연결 확인**
   ```bash
   docker-compose exec db psql -U pcm_user -d pcm -c "SELECT 1"
   ```

4. **마이그레이션 확인**
   ```bash
   docker-compose exec backend alembic current
   docker-compose exec backend alembic history
   ```

5. **API 테스트**
   ```bash
   curl http://localhost:8000/api/docs
   curl http://localhost:5173
   ```

6. **로그 파일 저장**
   ```bash
   docker-compose logs > debug.log 2>&1
   ```

## 더 이상 막혀 있다면?

1. **Docker 전체 정리 (최후의 수단)**
   ```bash
   # 모든 컨테이너/이미지/볼륨 삭제
   docker-compose down -v
   docker system prune -a

   # 처음부터 시작
   docker-compose up -d --build

   # 마이그레이션과 시드 확인
   docker-compose exec backend alembic upgrade head
   docker-compose exec backend python -m app.seed
   ```

2. **로그 저장 후 공유**
   ```bash
   docker-compose logs > full-logs.txt 2>&1
   # full-logs.txt를 팀과 공유
   ```

3. **해당 문제 섹션 다시 읽기**
   - 증상 확인
   - 원인 확인
   - 해결 단계 따라 실행

이 가이드에 없는 문제가 발생하면, 로그를 자세히 읽고 오류 메시지의 핵심 부분을 검색해보세요.
