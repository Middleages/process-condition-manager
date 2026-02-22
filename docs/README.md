# 문서 안내

PCM (Process Condition Manager) 문서에 오신 것을 환영합니다.

이 폴더는 PCM 프로젝트를 이해하고 유지보수하기 위한 모든 문서를 포함하고 있습니다. 상황에 맞는 문서를 찾아 읽으세요.

---

## 전체 문서 목록

| # | 제목 | 내용 | 읽는 시간 |
|---|------|------|---------|
| **01** | [빠른 시작 가이드](./01-quick-start.md) | PCM을 처음 실행하기까지의 모든 단계 (Docker 설치, 서비스 실행, 로그인) | 10분 |
| **02** | [아키텍처 개요](./02-architecture-overview.md) | PCM의 전체 구조, 기술 스택, 데이터 흐름 | 15분 |
| **03** | [코드 수정 가이드](./03-common-modifications.md) | 프로젝트 코드의 주요 위치, 파일 구조, 수정 방법 | 12분 |
| **04** | [프론트엔드 가이드](./04-frontend-guide.md) | React UI 개발, AG Grid 편집기, 상태 관리 (Zustand) | 15분 |
| **05** | [백엔드 가이드](./05-backend-guide.md) | FastAPI API 개발, 라우터, 서비스 레이어, 권한 인증 | 15분 |
| **06** | [데이터베이스 가이드](./06-database-guide.md) | PostgreSQL 설계, 마이그레이션, 테이블 구조 | 12분 |
| **07** | [트러블슈팅](./07-troubleshooting.md) | 자주 나는 에러, 해결 방법, 디버깅 팁 | 10분 |
| **08** | [용어 사전](./08-glossary.md) | 도메인 용어, 기술 용어, 약어 설명 | 8분 |
| **09** | [코드 수정 체크리스트](./09-modification-checklist.md) | 코드 수정 전/중/후 체크리스트 | 3분 |
| **10** | [배포 가이드](./10-deployment-guide.md) | 프로덕션 배포, 환경 설정, CI/CD | 10분 |

---

## 상황별 가이드

### 처음 프로젝트를 받았을 때

1. [01-quick-start.md](./01-quick-start.md) - 5~10분 만에 PCM을 실행하세요
2. [02-architecture-overview.md](./02-architecture-overview.md) - 전체 구조를 이해하세요
3. [08-glossary.md](./08-glossary.md) - 용어를 배우세요

**예상 시간**: 35분

---

### 코드를 수정하고 싶을 때

1. [03-common-modifications.md](./03-common-modifications.md) - 수정할 파일의 위치를 찾으세요
2. 필요한 특정 가이드:
   - **프론트엔드 수정**: [04-frontend-guide.md](./04-frontend-guide.md)
   - **백엔드 수정**: [05-backend-guide.md](./05-backend-guide.md)
   - **DB 스키마 변경**: [06-database-guide.md](./06-database-guide.md)
3. [09-modification-checklist.md](./09-modification-checklist.md) - 수정 전후 체크리스트를 따르세요
4. [07-troubleshooting.md](./07-troubleshooting.md) - 에러가 나면 여기서 해결책을 찾으세요

**예상 시간**: 수정 내용에 따라 15분~1시간

---

### UI 화면을 바꾸고 싶을 때

1. [04-frontend-guide.md](./04-frontend-guide.md) - React 컴포넌트 구조를 이해하세요
2. [03-common-modifications.md](./03-common-modifications.md) - 수정할 파일 위치를 확인하세요
3. [09-modification-checklist.md](./09-modification-checklist.md) - 체크리스트를 따르세요

**팁**: `npm run dev`로 실시간 화면 변화를 확인하면서 작업할 수 있습니다.

**예상 시간**: 30분~2시간

---

### API를 수정/추가하고 싶을 때

1. [05-backend-guide.md](./05-backend-guide.md) - FastAPI 라우터와 서비스 구조를 이해하세요
2. [02-architecture-overview.md](./02-architecture-overview.md) - 데이터 흐름을 확인하세요
3. [06-database-guide.md](./06-database-guide.md) - 필요한 DB 변경사항이 있으면 참조하세요
4. [09-modification-checklist.md](./09-modification-checklist.md) - 체크리스트를 따르세요

**예상 시간**: 30분~2시간

---

### DB를 변경하고 싶을 때

1. [06-database-guide.md](./06-database-guide.md) - 테이블 구조와 마이그레이션을 이해하세요
2. [09-modification-checklist.md](./09-modification-checklist.md) - 특히 "수정 중" 섹션의 "DB 변경" 항목을 확인하세요

**중요**: Alembic 마이그레이션을 반드시 생성해야 합니다.

**예상 시간**: 30분~1시간

---

### 에러가 났을 때

1. [07-troubleshooting.md](./07-troubleshooting.md) - 먼저 여기서 해결책을 찾으세요
2. [02-architecture-overview.md](./02-architecture-overview.md) - 필요하면 전체 흐름을 다시 확인하세요
3. [09-modification-checklist.md](./09-modification-checklist.md) - "자주 하는 실수" 섹션을 읽으세요

**예상 시간**: 5분~30분 (문제의 복잡도에 따라)

---

### 용어가 헷갈릴 때

**[08-glossary.md](./08-glossary.md)** - 모든 도메인 용어와 기술 용어를 찾을 수 있습니다.

예시:
- Backbone이 뭐예요? → 용어 사전 참조
- 상태(Status)가 뭐예요? → 상태 용어 섹션
- 레이어(Layer)는? → 도메인 용어 섹션

**예상 시간**: 1분~5분

---

### 서버에 배포할 때

1. [10-deployment-guide.md](./10-deployment-guide.md) - 배포 절차를 따르세요
2. [01-quick-start.md](./01-quick-start.md) - 필요시 서비스 실행 명령어 참조
3. [07-troubleshooting.md](./07-troubleshooting.md) - 배포 중 문제 발생 시 참조

**예상 시간**: 15분~1시간

---

## 빠른 명령어 참조

```bash
# 전체 서비스 실행
docker-compose up -d

# 백엔드 hot reload로 실행
docker-compose up backend

# 프론트엔드 개발 서버
cd frontend && npm run dev

# DB 마이그레이션 생성
docker-compose exec backend alembic revision --autogenerate -m "설명"

# DB 마이그레이션 적용
docker-compose exec backend alembic upgrade head
```

---

## 문서 정보

| 항목 | 내용 |
|------|------|
| **최종 업데이트** | 2026-02-22 |
| **버전** | v1.0 (초판) |
| **생성 도구** | Claude Code (AI 자동 생성) |
| **언어** | 한국어 |
| **대상** | PCM 유지보수 개발자 |

---

## 주의사항

이 문서들은 **Claude Code로 자동 생성**되었습니다.

- 문서가 최신 코드와 일치하지 않을 수 있습니다
- 특정 버전의 라이브러리에 맞게 작성되었습니다
- 프로젝트가 변경되면 문서도 함께 업데이트하세요

---

## 도움말

- **용어가 불명확한 경우**: [08-glossary.md](./08-glossary.md)를 참조하세요
- **명령어를 잊어버린 경우**: [09-modification-checklist.md](./09-modification-checklist.md)의 명령어 섹션을 확인하세요
- **에러 메시지를 만난 경우**: [07-troubleshooting.md](./07-troubleshooting.md)를 검색해보세요
- **기술 스택 이해가 필요한 경우**: [02-architecture-overview.md](./02-architecture-overview.md)를 읽으세요

---

행운을 빕니다! 문제가 있거나 피드백이 있으면 프로젝트 유지보수 팀에 연락하세요.
