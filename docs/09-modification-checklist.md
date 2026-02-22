# 코드 수정 체크리스트

코드를 수정하기 전, 수정하면서, 수정한 후에 따라야 할 체크리스트입니다.

한 장으로 프린트해서 모니터 옆에 붙여두고 사용하세요.

---

## 수정 전 (Before)

코드를 수정하기 전에 아래 항목들을 확인하세요.

### [ ] Git에서 최신 코드 pull

```bash
git pull origin main
```

다른 팀원의 변경사항이 없는지 확인하세요. Merge conflict가 있으면 먼저 해결하세요.

---

### [ ] Docker 서비스 실행 확인

```bash
docker ps
```

아래 4개 서비스가 모두 `Up` 상태인지 확인하세요:
- `backend` (포트 8000)
- `frontend` (포트 5173)
- `nginx` (포트 80)
- `db` (포트 5432)

서비스가 없으면 이 명령어로 실행하세요:
```bash
docker-compose up -d
```

---

### [ ] 수정할 파일 위치 파악

[03-common-modifications.md](./03-common-modifications.md)를 읽고:
- 수정할 파일들의 정확한 위치를 파악하세요
- 관련된 파일들(함수 호출처, import 문 등)을 파악하세요

예시:
- 프론트엔드 컴포넌트 수정: `frontend/src/components/...`
- 백엔드 API 수정: `backend/app/routers/...` 또는 `backend/app/services/...`
- DB 변경: `backend/app/models/...` + Alembic 마이그레이션

---

### [ ] 현재 동작 확인

브라우저에서 PCM을 열고 수정할 기능을 테스트하세요:

```
http://localhost:5173
```

또는 nginx를 통해:
```
http://localhost
```

**테스트할 항목들**:
- [ ] 로그인 가능한가?
- [ ] 관련 화면이 로드되는가?
- [ ] 현재 에러는 없는가?

이 정보는 수정 후 비교 기준이 됩니다.

---

## 수정 중 (During)

### [ ] 프론트엔드 수정: npm run dev로 실시간 확인

파일을 저장할 때마다 자동으로 브라우저가 새로고침됩니다.

```bash
cd frontend
npm run dev
```

**모니터링할 항목들**:
- [ ] 터미널: TypeScript 컴파일 에러
- [ ] 브라우저 콘솔: JavaScript 에러
- [ ] 화면: UI가 올바르게 표시되는가?

**유용한 개발 도구**:
- React DevTools (브라우저 확장)
- TypeScript strict mode (에러 조기 발견)
- 브라우저 DevTools (F12)

---

### [ ] 백엔드 수정: Docker auto reload 확인

백엔드 파일을 저장하면 Docker가 자동으로 재시작합니다 (약 2초).

```bash
docker logs -f backend
```

**모니터링할 항목들**:
- [ ] "Application startup complete" 메시지 표시?
- [ ] 에러 메시지는 없는가?
- [ ] API 응답이 변경되었는가?

**문제 해결**:
- reload 안 되면: `docker-compose restart backend`
- 여전히 안 되면: `docker-compose down && docker-compose up -d`

---

### [ ] DB 변경: Alembic 마이그레이션 생성

SQLAlchemy 모델을 변경했으면 **반드시** Alembic 마이그레이션을 생성하세요.

```bash
docker-compose exec backend alembic revision --autogenerate -m "설명"
```

**마이그레이션 생성 후**:
1. `backend/alembic/versions/` 폴더에 새 파일이 생성되었는지 확인
2. 생성된 마이그레이션 파일 내용이 맞는지 수동 검토
3. 아래 명령어로 마이그레이션 적용:

```bash
docker-compose exec backend alembic upgrade head
```

**중요한 이유**:
- 마이그레이션이 없으면 다른 환경에서 DB 스키마가 일치하지 않음
- 프로덕션 배포 시 DB 구조가 꼬일 수 있음

---

### [ ] 시드 데이터 변경: 시드 재실행

시드 데이터(더미 데이터)를 변경했으면 다시 실행하세요:

```bash
docker-compose exec backend python -m app.seed
```

또는 새로 시작하려면:

```bash
# DB 모든 데이터 삭제 (주의!)
docker-compose exec db psql -U postgres -d process_condition -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# 마이그레이션 다시 적용
docker-compose exec backend alembic upgrade head

# 시드 데이터 다시 입력
docker-compose exec backend python -m app.seed
```

---

### [ ] 코드 스타일 확인

Python (백엔드):
```bash
docker-compose exec backend python -m black --check backend/app
docker-compose exec backend python -m ruff check backend/app
```

TypeScript (프론트엔드):
```bash
cd frontend
npm run lint
```

---

## 수정 후 (After)

### [ ] 브라우저에서 기능 테스트

수정한 화면/기능을 실제로 사용해보세요:

**테스트 체크리스트**:
- [ ] 화면이 올바르게 표시되는가?
- [ ] 클릭, 입력이 반응하는가?
- [ ] 저장, 조회 등 주요 기능이 동작하는가?
- [ ] 이전에 동작하던 기능이 깨지지 않았는가? (회귀 테스트)

**테스트 중 찾을 수 있는 문제들**:
- 레이아웃 깨짐
- 버튼 비활성화
- API 호출 실패
- 데이터 표시 오류

---

### [ ] 콘솔/터미널 에러 확인

**브라우저 콘솔 (F12 → Console 탭)**:
```
에러 메시지나 경고가 있는가?
```

**백엔드 로그**:
```bash
docker logs backend
```

```
[ERROR], [WARNING] 메시지가 있는가?
```

**에러가 있으면**:
- 에러 메시지를 읽고 원인 파악
- [07-troubleshooting.md](./07-troubleshooting.md)에서 해결책 검색
- 여전히 문제 있으면 코드 다시 검토

---

### [ ] Git Commit (변경 내용 메모)

변경사항을 Git에 저장하세요:

```bash
git add .
git commit -m "변경 내용을 명확하게 설명"
```

**Commit 메시지 작성 규칙**:
- 영어 또는 한국어로 작성
- 첫 글자는 대문자
- 무엇을 변경했는지 명확하게
- "fix:", "feat:", "refactor:" 등 prefix 사용 (선택)

**좋은 Commit 메시지 예시**:
```
feat: 조건표 편집기에서 셀 드래그 기능 추가
fix: 프론트엔드 AG Grid 렌더링 오류 수정
refactor: 백엔드 project_service.py 코드 정리
docs: README.md 업데이트
```

**나쁜 Commit 메시지 예시**:
```
수정함
fix bugs
updated
작업 중
```

---

### [ ] (선택) 프로덕션 배포

테스트가 완료되고 문제가 없으면 프로덕션에 배포할 수 있습니다:

```bash
git push origin main
```

**배포 전 체크리스트**:
- [ ] 모든 테스트 완료?
- [ ] 팀원 리뷰 완료?
- [ ] 데이터 마이그레이션 필요 없나? (필요하면 먼저 실행)
- [ ] 환경 변수 설정은 맞나?
- [ ] 배포 시간은 적절한가? (야근 시간 피하기)

자세한 배포 방법은 [10-deployment-guide.md](./10-deployment-guide.md)를 참조하세요.

---

## 자주 하는 실수 방지

### ❌ 프론트엔드 수정 후 빌드 안 함

**문제**: 브라우저에서 변경사항이 보이지 않음

**해결책**:
```bash
cd frontend
npm run dev
```

`npm run dev` 없이 파일만 수정하면 변경사항이 자동 반영되지 않습니다.

---

### ❌ DB 모델 변경 후 마이그레이션 안 만듦

**문제**: 다른 환경에서 DB 스키마가 맞지 않음, 프로덕션 배포 시 충돌

**해결책**:
```bash
docker-compose exec backend alembic revision --autogenerate -m "설명"
docker-compose exec backend alembic upgrade head
```

DB 스키마 변경은 반드시 마이그레이션 파일로 기록해야 합니다.

---

### ❌ .env 파일을 Git에 커밋

**문제**: 프로덕션 API 키, 데이터베이스 비밀번호가 노출됨

**해결책**:
1. `.gitignore`에 `.env` 추가 (이미 추가되어 있음)
2. 실수로 커밋했으면:
   ```bash
   git rm --cached .env
   git commit -m "Remove .env from git history"
   ```

**규칙**:
- `.env` 파일은 절대 Git에 추가하지 마세요
- 환경변수는 배포 환경에서만 설정하세요

---

### ❌ node_modules를 Git에 커밋

**문제**: Git 저장소 크기가 엄청 커짐, 다른 팀원이 Pull 받을 때 오래 걸림

**해결책**:
1. `.gitignore`에 `node_modules/` 추가 (이미 추가되어 있음)
2. 팀원이 Pull 받으면:
   ```bash
   npm install
   ```

**규칙**:
- 프로젝트 폴더의 `node_modules/`는 Git에 추가하지 마세요
- `package-lock.json`만 버전 관리하세요

---

### ❌ API 응답 형식 변경 후 프론트엔드 안 업데이트

**문제**: 프론트엔드가 새 API 응답을 파싱하지 못해 에러 발생

**해결책**:
1. 백엔드 API 응답 형식을 변경하면
2. 프론트엔드 API 호출 코드도 함께 수정하세요
3. 타입 정의(`frontend/src/types/...`)도 업데이트하세요

**팁**: 백엔드 API 변경 시 프론트엔드 담당자에게 알려주세요.

---

### ❌ Docker 서비스 안 띄고 개발

**문제**: 브라우저에서 서비스를 볼 수 없음, API 호출 실패

**해결책**:
```bash
docker-compose up -d
```

개발을 시작하기 전에 항상 Docker를 실행하세요.

---

### ❌ 마이그레이션 없이 프로덕션 배포

**문제**: 프로덕션에서 DB 스키마가 로컬과 다름, 서비스 장애

**해결책**:
1. 로컬에서 Alembic 마이그레이션 생성 및 테스트
2. 파일을 Git에 커밋
3. 프로덕션에서 배포 전 마이그레이션 실행:
   ```bash
   alembic upgrade head
   ```

---

## 유용한 명령어 모음

### Docker

```bash
# 모든 서비스 시작
docker-compose up -d

# 모든 서비스 종료
docker-compose down

# 특정 서비스 재시작
docker-compose restart backend

# 로그 확인
docker logs -f backend

# DB 접속 (psql)
docker-compose exec db psql -U postgres -d process_condition
```

### 프론트엔드

```bash
# 개발 서버 시작
cd frontend && npm run dev

# 번들 빌드
npm run build

# 코드 스타일 검사
npm run lint
```

### 백엔드

```bash
# 마이그레이션 생성
docker-compose exec backend alembic revision --autogenerate -m "설명"

# 마이그레이션 실행
docker-compose exec backend alembic upgrade head

# 시드 데이터 실행
docker-compose exec backend python -m app.seed

# 코드 스타일 검사
docker-compose exec backend python -m black backend/app
docker-compose exec backend python -m ruff check backend/app
```

### Git

```bash
# 최신 코드 가져오기
git pull origin main

# 변경사항 커밋
git add .
git commit -m "메시지"

# 원격 저장소에 푸시
git push origin main

# 현재 브랜치 상태 확인
git status

# 변경사항 보기
git diff
```

---

## 인쇄 팁

이 체크리스트를 A4 종이에 프린트하려면:

1. PDF로 변환 또는 브라우저 인쇄 (Ctrl+P 또는 Cmd+P)
2. "여백 없음(Borderless)" 설정
3. 흑백 또는 컬러로 프린트
4. 모니터 옆에 붙여두기

---

**마지막 확인**: 모든 항목을 완료했나요? 네, 그럼 수정이 완료된 것입니다!
