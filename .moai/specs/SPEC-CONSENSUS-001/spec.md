# SPEC-CONSENSUS-001: Config Change Consensus (설정 변경 합의 절차)

---
id: SPEC-CONSENSUS-001
title: Config Change Consensus - Line Manager Approval for System Settings
status: Draft
priority: High
created: 2026-03-02
lifecycle: spec-anchored
tags: [consensus, approval, config, column, validation, line-manager, workflow]
---

## 1. Environment

### 1.1 Current System State

- PCM 시스템에서 컬럼 정의/검증 규칙 등 시스템 설정은 developer 역할이 즉시 변경 가능
- 설정 변경에 대한 라인별 관리자 합의/승인 절차가 없음
- User 모델에 소속 라인(line_id) 정보가 없음
- 기존 프로젝트 승인 워크플로우(draft->review->approved)는 프로젝트 단위에만 적용

### 1.2 Affected Components

**Backend (신규 파일):**
- `backend/app/models/config_change.py` - ConfigChangeRequest, ConfigChangeVote 모델
- `backend/app/schemas/config_change.py` - 요청/응답 Pydantic 스키마
- `backend/app/routers/config_change.py` - 변경 요청 API 엔드포인트
- `backend/app/services/config_change_service.py` - 합의 비즈니스 로직
- `backend/alembic/versions/021_add_config_change_consensus.py` - DB 마이그레이션
- `backend/tests/test_config_change.py` - 테스트

**Backend (수정 파일):**
- `backend/app/models/user.py` - User에 line_id FK 추가
- `backend/app/models/__init__.py` - 신규 모델 import
- `backend/app/constants.py` - 변경 요청 상태/타입 상수 추가
- `backend/app/schemas/user.py` - UserResponse에 line_id 추가
- `backend/app/seed/users.py` - 시드 데이터에 line_id 추가

**Frontend (신규 파일):**
- `frontend/src/pages/config-change/` - 변경 요청 페이지
- `frontend/src/services/configChangeApi.ts` - API 클라이언트
- `frontend/src/types/configChange.ts` - TypeScript 타입

**Frontend (수정 파일):**
- `frontend/src/types/user.ts` - User 타입에 line_id 추가
- `frontend/src/components/layout/Header.tsx` - 네비게이션에 변경 요청 메뉴 추가

### 1.3 Technology Stack

- Backend: FastAPI, SQLAlchemy 2.x (async), PostgreSQL, Pydantic v2
- Frontend: React 18 + TypeScript, Vite
- DB: PostgreSQL 16

## 2. Assumptions

- A1: 각 유저는 정확히 하나의 라인에 소속된다 (1:1 관계). line_id는 nullable로 하여 기존 유저 호환성 유지.
- A2: "라인 관리자"란 해당 라인에 소속된 reviewer 또는 admin 역할의 유저를 의미한다.
- A3: 컬럼 정의(column_definitions)와 검증 규칙(column_validations) 변경만 합의 대상이다. 다른 시스템 설정(XML 매핑, 내보내기 등)은 대상이 아니다.
- A4: 합의는 "모든 라인의 관리자 전원"이 승인해야 통과한다 (전원 합의 방식).
- A5: 관리자가 요청서에 기술적 구현 내용을 작성하지 않는다. "무엇이 필요한지"만 자연어로 기술한다.
- A6: Developer/Admin이 합의 완료 후 실제 구현을 수행하고, "적용 완료" 버튼으로 요청을 종료한다.
- A7: 라인이 1개도 없거나, 관리자가 없는 라인이 있는 경우의 예외 처리가 필요하다.
- A8: 변경 요청은 삭제할 수 없고, 완료/거부/취소 상태로만 종료된다 (감사 추적).

## 3. Requirements

### 3.1 User-Line Association

**[REQ-CONS-001] Ubiquitous:**
User 모델은 소속 라인을 나타내는 `line_id` 필드를 **가져야 한다** (FK to lines, nullable).

**[REQ-CONS-002] Event-Driven:**
**When** 관리자가 유저를 생성/수정할 때, **then** 시스템은 소속 라인을 선택할 수 있는 드롭다운을 **제공해야 한다**.

**[REQ-CONS-003] Unwanted Behavior:**
시스템은 존재하지 않는 라인 ID를 유저에게 할당하는 것을 **허용하지 않아야 한다**.

### 3.2 Config Change Request

**[REQ-CONS-010] Event-Driven:**
**When** reviewer 또는 admin 역할의 유저가 변경 요청을 작성하면, **then** 시스템은 ConfigChangeRequest를 `pending` 상태로 **생성해야 한다**.

**[REQ-CONS-011] Ubiquitous:**
변경 요청은 다음 필드를 **포함해야 한다**: 제목(title), 설명(description), 변경 유형(change_type: column_add, column_modify, validation_change), 요청자(requested_by).

**[REQ-CONS-012] Event-Driven:**
**When** 변경 요청이 생성되면, **then** 시스템은 모든 라인에 대해 투표 레코드(ConfigChangeVote)를 **자동 생성해야 한다**.

**[REQ-CONS-013] Unwanted Behavior:**
시스템은 `completed` 또는 `rejected` 또는 `cancelled` 상태의 요청에 대한 투표를 **허용하지 않아야 한다**.

### 3.3 Voting Workflow

**[REQ-CONS-020] Event-Driven:**
**When** 라인 관리자(해당 라인 소속 reviewer/admin)가 투표하면, **then** 시스템은 해당 라인의 투표를 approve 또는 reject로 **기록해야 한다**.

**[REQ-CONS-021] Event-Driven:**
**When** 모든 라인이 approve 투표를 완료하면, **then** 시스템은 요청 상태를 `approved`로 **자동 전환해야 한다**.

**[REQ-CONS-022] Event-Driven:**
**When** 하나 이상의 라인이 reject 투표를 하면, **then** 시스템은 요청 상태를 `rejected`로 **전환해야 한다**.

**[REQ-CONS-023] State-Driven:**
**If** 요청 상태가 `pending`이면, **then** 시스템은 투표를 **수락해야 한다**.

**[REQ-CONS-024] Unwanted Behavior:**
시스템은 다른 라인 소속 유저가 해당 라인의 투표에 참여하는 것을 **허용하지 않아야 한다**.

**[REQ-CONS-025] Event-Driven:**
**When** 라인 관리자가 reject 투표를 하면, **then** 시스템은 거부 사유(reason)를 **필수로 요구해야 한다**.

**[REQ-CONS-026] Event-Driven:**
**When** 라인 관리자가 approve 투표를 하면, **then** 시스템은 사유(reason)를 **선택적으로 입력할 수 있게 해야 한다** (optional).

### 3.4 Implementation & Completion

**[REQ-CONS-030] Event-Driven:**
**When** developer/admin이 승인된 요청에 대해 "작업 시작"을 누르면, **then** 시스템은 상태를 `in_progress`로 **전환해야 한다**.

**[REQ-CONS-031] Event-Driven:**
**When** developer/admin이 "적용 완료"를 누르면, **then** 시스템은 상태를 `completed`로 **전환하고** 완료 시간을 **기록해야 한다**.

**[REQ-CONS-032] State-Driven:**
**If** 요청 상태가 `approved`이면, **then** developer/admin만 `in_progress`로 **전환할 수 있어야 한다**.

**[REQ-CONS-033] State-Driven:**
**If** 요청 상태가 `in_progress`이면, **then** developer/admin만 `completed`로 **전환할 수 있어야 한다**.

### 3.5 Line Profile Notification

**[REQ-CONS-035] Event-Driven:**
**When** line_id가 설정되지 않은 유저가 로그인하면, **then** 시스템은 프로필에서 소속 라인을 설정하라는 안내 배너를 **표시해야 한다**.

**[REQ-CONS-036] State-Driven:**
**If** 유저의 line_id가 null이면, **then** 시스템은 해당 유저의 변경 요청 투표 참여를 **차단해야 한다**.

### 3.6 Request Cancellation

**[REQ-CONS-040] Event-Driven:** (번호 유지, 섹션 3.6)
**When** 요청 작성자 또는 admin이 pending 상태의 요청을 취소하면, **then** 시스템은 상태를 `cancelled`로 **전환해야 한다**.

**[REQ-CONS-041] Unwanted Behavior:**
시스템은 `approved`, `in_progress`, `completed` 상태의 요청 취소를 **허용하지 않아야 한다**.

### 3.7 List & Filter

**[REQ-CONS-050] Event-Driven:**
**When** 인증된 유저가 변경 요청 목록을 조회하면, **then** 시스템은 상태별 필터링, 최신순 정렬, 페이지네이션을 **지원해야 한다**.

**[REQ-CONS-051] Event-Driven:**
**When** 유저가 변경 요청 상세를 조회하면, **then** 시스템은 요청 정보와 함께 각 라인의 투표 현황(라인명, 투표 상태, 투표자, 사유)을 **표시해야 한다**.

## 4. Technical Approach

### 4.1 DB Schema Changes

#### User 테이블 변경

```sql
ALTER TABLE users ADD COLUMN line_id INTEGER REFERENCES lines(id) ON DELETE SET NULL;
CREATE INDEX ix_users_line_id ON users (line_id);
```

#### 신규 테이블: config_change_requests

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, autoincrement | |
| title | VARCHAR(200) | NOT NULL | 요청 제목 |
| description | TEXT | NOT NULL | 변경 요구 사항 설명 |
| change_type | VARCHAR(30) | NOT NULL | column_add, column_modify, validation_change |
| status | VARCHAR(20) | NOT NULL, default='pending' | pending, approved, rejected, in_progress, completed, cancelled |
| requested_by | INTEGER | FK(users.id), NOT NULL | 요청자 |
| implemented_by | INTEGER | FK(users.id), nullable | 구현 담당자 |
| created_at | TIMESTAMP(tz) | server_default=now() | |
| updated_at | TIMESTAMP(tz) | server_default=now() | |
| approved_at | TIMESTAMP(tz) | nullable | 전원 합의 완료 시간 |
| completed_at | TIMESTAMP(tz) | nullable | 적용 완료 시간 |

**Indexes:**
- `ix_config_change_requests_status` ON (status)
- `ix_config_change_requests_requested_by` ON (requested_by)

#### 신규 테이블: config_change_votes

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PK, autoincrement | |
| request_id | INTEGER | FK(config_change_requests.id, CASCADE), NOT NULL | 변경 요청 |
| line_id | INTEGER | FK(lines.id), NOT NULL | 투표 대상 라인 |
| vote | VARCHAR(10) | nullable | approve, reject (null = 미투표) |
| voted_by | INTEGER | FK(users.id), nullable | 투표자 |
| reason | TEXT | nullable | 투표 사유 (reject 시 필수, approve 시 선택) |
| voted_at | TIMESTAMP(tz) | nullable | 투표 시간 |

**Constraints:**
- UNIQUE(request_id, line_id) - 라인당 1표
- INDEX on (request_id)

### 4.2 State Machine

```
pending ──→ approved ──→ in_progress ──→ completed
   │            ↑
   │       (전원 approve)
   │
   ├──→ rejected (1명이라도 reject)
   │
   └──→ cancelled (요청자/admin 취소)
```

**Valid Transitions:**
```python
CONFIG_CHANGE_STATUSES = ("pending", "approved", "rejected", "in_progress", "completed", "cancelled")

VALID_CONFIG_CHANGE_TRANSITIONS = {
    "pending": ["approved", "rejected", "cancelled"],  # approved/rejected는 시스템 자동 전환
    "approved": ["in_progress"],
    "in_progress": ["completed"],
}
```

### 4.3 Service Layer

**config_change_service.py:**

| Function | Description | Auth |
|----------|-------------|------|
| `create_request(db, data, user)` | 변경 요청 생성 + 라인별 투표 레코드 자동 생성 | reviewer/admin |
| `vote(db, request_id, user, vote, reason)` | 라인 투표 (유저 소속 라인 자동 감지) | reviewer/admin (해당 라인) |
| `start_implementation(db, request_id, user)` | approved -> in_progress 전환 | developer/admin |
| `complete_implementation(db, request_id, user)` | in_progress -> completed 전환 | developer/admin |
| `cancel_request(db, request_id, user)` | pending -> cancelled 전환 | 요청자/admin |
| `list_requests(db, status, offset, limit)` | 목록 조회 (필터/페이지네이션) | 인증된 유저 |
| `get_request_detail(db, request_id)` | 상세 + 투표 현황 조회 | 인증된 유저 |

### 4.4 API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/config-changes` | 변경 요청 생성 | require_reviewer |
| GET | `/api/config-changes` | 목록 조회 | require_active_user |
| GET | `/api/config-changes/{id}` | 상세 + 투표 현황 | require_active_user |
| POST | `/api/config-changes/{id}/vote` | 라인 투표 | require_reviewer |
| PATCH | `/api/config-changes/{id}/start` | 작업 시작 | require_admin_or_developer |
| PATCH | `/api/config-changes/{id}/complete` | 적용 완료 | require_admin_or_developer |
| PATCH | `/api/config-changes/{id}/cancel` | 요청 취소 | require_active_user (요청자/admin) |

### 4.5 Consensus Logic (핵심 알고리즘)

```python
async def _check_and_update_consensus(db, request_id):
    """투표 후 합의 상태 자동 확인"""
    votes = await _get_all_votes(db, request_id)

    # 0. 투표 레코드가 없으면(라인 0개) pending 유지
    if not votes:
        return

    # 1. reject가 하나라도 있으면 즉시 rejected
    if any(v.vote == "reject" for v in votes):
        await _update_status(db, request_id, "rejected")
        return

    # 2. 모든 라인이 approve면 approved
    if all(v.vote == "approve" for v in votes):
        await _update_status(db, request_id, "approved")
        return

    # 3. 아직 미투표 라인이 있으면 pending 유지
    # (관리자 없는 라인도 미투표 상태로 유지 = 합의 불가 = 대기)
```

### 4.6 Frontend Pages

1. **변경 요청 목록 페이지** (`/config-changes`)
   - 상태별 탭/필터
   - 요청 카드 리스트 (제목, 유형, 상태, 투표 진행률)
   - "새 요청" 버튼 (reviewer/admin만)

2. **변경 요청 상세 페이지** (`/config-changes/:id`)
   - 요청 정보 (제목, 설명, 유형, 요청자)
   - 라인별 투표 현황 테이블
   - 투표 버튼 (해당 라인 관리자만)
   - "작업 시작" / "적용 완료" 버튼 (developer/admin, 상태에 따라)

## 5. Acceptance Criteria

- AC-001: User 모델에 line_id FK가 추가되고, 유저 관리 화면에서 소속 라인을 선택할 수 있다.
- AC-002: reviewer/admin이 변경 요청(제목, 설명, 유형)을 작성할 수 있다.
- AC-003: 요청 생성 시 모든 라인에 대한 투표 레코드가 자동 생성된다.
- AC-004: 라인 관리자(해당 라인 소속 reviewer/admin)가 투표(approve/reject)할 수 있다.
- AC-005: 다른 라인 소속 유저는 해당 라인의 투표에 참여할 수 없다 (403 Forbidden).
- AC-006: 모든 라인이 approve하면 상태가 자동으로 approved로 전환된다.
- AC-007: 1개 라인이라도 reject하면 상태가 자동으로 rejected로 전환된다.
- AC-008: reject 투표 시 거부 사유가 필수이다 (사유 없이 reject 시 400 Bad Request).
- AC-009: developer/admin이 approved 요청에 대해 "작업 시작" -> "적용 완료" 흐름을 수행할 수 있다.
- AC-010: 요청 상세 페이지에서 각 라인의 투표 현황(라인명, 투표 상태, 투표자, 사유)을 확인할 수 있다.
- AC-011: 요청자 또는 admin이 pending 상태의 요청을 취소할 수 있다.
- AC-012: 목록 페이지에서 상태별 필터링, 페이지네이션이 동작한다.
- AC-013: line_id 미설정 유저가 로그인하면 "프로필에서 소속 라인을 설정하세요" 안내 배너가 표시된다.
- AC-014: line_id 미설정 유저는 투표할 수 없다 (403 Forbidden).
- AC-015: approve 투표 시에도 사유를 선택적으로 입력할 수 있다.
- AC-016: 라인이 0개이거나 관리자 없는 라인이 있으면, 해당 투표가 완료될 때까지 요청은 pending 상태로 유지된다.

## 6. Constraints

- C1: User.line_id는 nullable (기존 유저 호환). 단, line_id가 없는 유저는 투표할 수 없다.
- C2: 라인이 0개일 때 변경 요청을 생성하면 투표 레코드 없이 pending 상태로 대기한다. 라인이 추가된 후 수동으로 투표 레코드를 생성하거나 admin이 처리해야 한다.
- C3: 특정 라인에 reviewer/admin이 없는 경우, 해당 라인의 투표는 미투표(pending) 상태로 유지된다. 관리자가 배정될 때까지 합의가 완료되지 않는다.
- C4: ConfigChangeRequest는 삭제(DELETE) API를 제공하지 않는다 (감사 추적).
- C5: 투표는 라인당 1표 (UNIQUE constraint). 한번 투표하면 변경 불가.
- C6: pending -> approved/rejected 전환은 투표 결과에 의한 자동 전환만 가능 (수동 전환 불가).

## 7. Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| 라인에 관리자(reviewer/admin)가 없어 투표 불가 | Medium | High | C3에 따라 관리자 없는 라인은 자동 approve |
| 기존 유저에 line_id 미설정으로 투표 불가 | High | Medium | 마이그레이션 후 admin이 기존 유저에 라인 배정 필요 (안내 공지) |
| 많은 라인 수 시 전원 합의 지연 | Low | Medium | 투표 현황을 대시보드에 표시하여 미투표 라인 식별 |
| 동시 투표 시 race condition | Low | Low | DB UNIQUE constraint + SELECT FOR UPDATE로 방지 |

## 8. Implementation Milestones

### M1: Backend - DB & Models (Migration + Models)
1. Alembic migration 021: User.line_id 추가, config_change_requests/votes 테이블 생성
2. ConfigChangeRequest, ConfigChangeVote 모델 작성
3. constants.py에 상태/유형 상수 추가

### M2: Backend - Service & API
1. config_change_service.py 핵심 로직 구현
2. Pydantic 스키마 작성
3. config_change router 구현
4. User 스키마/시드 데이터 line_id 추가

### M3: Backend - Tests
1. 모델/서비스 단위 테스트
2. API 통합 테스트
3. 합의 로직 edge case 테스트

### M4: Frontend (별도 SPEC 또는 후속 작업)
1. 타입 정의
2. API 클라이언트
3. 목록/상세 페이지
4. 유저 관리 화면 line_id 드롭다운

## 9. Traceability

| Requirement | Milestone | Acceptance Criteria |
|-------------|-----------|-------------------|
| REQ-CONS-001~003 | M1, M2 | AC-001 |
| REQ-CONS-010~013 | M1, M2 | AC-002, AC-003 |
| REQ-CONS-020~025 | M2 | AC-004~AC-008 |
| REQ-CONS-030~033 | M2 | AC-009 |
| REQ-CONS-040~041 | M2 | AC-011 |
| REQ-CONS-050~051 | M2 | AC-010, AC-012 |
