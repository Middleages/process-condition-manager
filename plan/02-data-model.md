# 02. 데이터 모델

## 1. 개념 모델

```mermaid
erDiagram
    INGEST_PROCESS ||--o{ INGEST_LAYER_DATA : "적재 영역 (읽기 전용)"
    PARAMETER ||--o{ PARAMETER_OPTION : "선택지 타입일 때"
    PROJECT ||--o{ SHEET_LAYER : "생성 시 구조 파생"
    SHEET_LAYER ||--o{ CELL_VALUE : ""
    PROJECT ||--o{ CHANGE_EVENT : "append-only"
    PROJECT ||--o| EDIT_LOCK : ""
    PROJECT ||--o| PARAMETER_SNAPSHOT : "승인 시점 동결"
```

두 세계로 나뉜다.

- **적재 영역(읽기 전용)**: 외부 시스템 → Prefect가 만든 process 구조와 조건 데이터. layer 구성의 원천. PCM은 판독만 한다.
- **PCM 앱 영역(Alembic 소유)**: 파라미터 레지스트리, 프로젝트, 조건표(시트), 이벤트, 잠금.

## 2. 파라미터 레지스트리 (시스템의 축)

전 process 공통 컬럼 세트. 관리자가 제어하며, 지속적으로 추가/변경된다.

```
parameter
  id            PK
  code          UNIQUE  -- 시스템 내부 식별자. 생성 후 불변
  display_name          -- 사용자에게 보이는 컬럼명. 변경 가능
  description           -- 헤더 툴팁 등 UI 노출용 설명
  value_type            -- number | text | choice
  category_id   FK      -- 카테고리 (관리자 설정 가능)
  unit, min, max        -- number 타입 부가 속성 (검증 엔진이 사용)
  sort_order
  is_active             -- soft delete. 하드 삭제 금지
  created_at, updated_at

parameter_category
  id, code, display_name, sort_order, is_active

parameter_option        -- choice 타입의 선택지
  id, parameter_id FK, value, display_name, sort_order, is_active
```

설계 규칙:

- **`code`는 불변, `display_name`은 가변.** 셀 값과 이벤트는 전부 `code`로 파라미터를 참조한다. 컬럼명 변경이 데이터에 영향을 주지 않는다. (기존 "컬럼명이 꼬이는" 문제의 구조적 차단)
- **하드 삭제 금지.** `is_active=false`로 비활성화만 한다. 과거 스냅샷·이력이 항상 정의를 역참조할 수 있어야 한다.
- 검증 규칙 중 파라미터 단독 규칙(range, required, pattern)은 레지스트리 속성으로 두고, cross-layer 규칙은 Phase 3에서 별도 테이블로 확장한다.

## 3. 파라미터 스냅샷 정책 (결정 D-08, 정책 a)

| 프로젝트 상태 | 파라미터 세트 |
|---------------|----------------|
| Draft / Review | **live** — 항상 현재 레지스트리(`is_active=true`)를 따른다. 새 파라미터가 추가되면 즉시 빈 컬럼으로 나타난다 |
| Approved / Archived | **frozen** — 승인 시점에 레지스트리 전체(정의+선택지)를 `parameter_snapshot`(JSONB)으로 동결. 이후 레지스트리가 어떻게 바뀌어도 당시 모습 그대로 렌더링 |

- 조회 API는 프로젝트 상태에 따라 live 레지스트리 또는 스냅샷 중 하나를 컬럼 정의로 반환한다. 프론트는 구분할 필요 없이 받은 정의로 그리드를 구성한다.
- Revision 생성(Approved → 새 Draft) 시 새 Draft는 다시 live를 따른다.

## 4. 프로젝트와 조건표

```
project
  id PK
  process_key           -- 적재 영역의 process 식별자 (판독기 통해 해석)
  name, status          -- draft | review | approved | archived
  version               -- Revision 번호
  parameter_snapshot    -- JSONB, 승인 시점에만 기록 (그 전 NULL)
  created_by, approved_at, ...

sheet_layer             -- 프로젝트 생성 시 적재 데이터의 layer 구성에서 파생
  id PK, project_id FK
  layer_key, layer_name, sort_order

cell_value              -- 조건표 본문: narrow(long) 테이블
  id PK
  layer_id FK
  parameter_code        -- parameter.code 참조 (FK 아님: 스냅샷 독립성)
  value                 -- TEXT 저장, value_type에 따라 해석
  updated_by, updated_at
  UNIQUE (layer_id, parameter_code)
```

### narrow 테이블 vs JSONB 트레이드오프

| 기준 | narrow 테이블 (채택) | layer당 JSONB |
|------|---------------------|----------------|
| 파라미터 추가/삭제 | 스키마 무변경, 행 추가만 | 스키마 무변경 |
| 셀 단위 이력/잠금/검증 상태 | 셀이 행이므로 자연스러움 | 별도 구조 필요 |
| 부분 업데이트(셀 몇 개 저장) | UPSERT로 정확히 그 셀만 | 문서 전체 재기록 |
| 시트 전체 로드 | 1 프로젝트 = 100개 미만 layer × 약 200 param = 최대 약 20,000행. 단일 쿼리로 시작하되 그리드 PoC에서 체감 성능을 확인한다 | 더 빠르나 차이 미미 |
| 규모 | 프로젝트당 최대 약 2만 행. 수천 프로젝트여도 수천만 행 수준 — PostgreSQL 인덱스와 bulk I/O 전략으로 관리 가능 | — |

**채택: narrow 테이블.** 셀 단위 이력(Phase 4)과 검증(Phase 3)이 셀=행 구조와 정확히 맞물린다. 시트 로드는 `(project) → layers → cell_values` 단일 조인 쿼리로 처리하고, API는 그리드가 쓰기 좋은 layer×parameter 매트릭스로 변환해 반환한다.

## 5. 변경 이벤트 (append-only)

```
change_event
  id PK (bigserial)
  project_id FK
  event_type            -- cell_update | backbone_copy | backbone_layer_replace
                        --  | status_change | revision_create | ...
  layer_key, parameter_code   -- 셀 이벤트일 때
  old_value, new_value
  source                -- manual | backbone | recipe | system
  actor, created_at
  payload JSONB         -- 이벤트별 부가 정보
```

- UPDATE/DELETE 금지. 변경 이력 화면(Phase 4), 감사 추적, Revision 비교가 전부 이 테이블 하나를 조회한다.
- 벌크 작업(백본 복사, 엑셀 붙여넣기)은 셀 이벤트를 배치 insert하되 `payload`에 배치 식별자를 남겨 묶어 볼 수 있게 한다.

## 6. 편집 잠금 (결정 D-09)

```
edit_lock
  project_id PK/FK
  locked_by, locked_at, expires_at   -- TTL + 하트비트 갱신
```

- 프로젝트 단위 단일 잠금. 편집 화면 진입 시 획득, 주기적 하트비트로 연장, 이탈/만료 시 해제.
- 잠금 보유자가 아니면 편집 API는 409를 반환하고, UI는 읽기 전용 + "누가 편집 중" 표시.

## 7. 적재 영역 판독 (ingest reader 계약)

적재 데이터는 **구조만** 담는다 — process별 layer/step 목록(partid, processid, stepseq, area 같은 컬럼). **조건 값은 적재에 존재하지 않으며, 값의 원천은 기존 프로젝트(백본)다** (D-14). 적재 스키마의 실제 형태는 Prefect 파이프라인 확정 시 반영하고, 판독 계약만 먼저 고정한다:

| 판독 기능 | 반환 |
|-----------|------|
| process 목록 조회 | process_key(partid+processid 조합 등), 표시 속성, 최종 적재 시각 |
| process의 layer 구성 조회 | layer_key, layer_name, stepseq(순서), area 등 구조 속성 |

- ~~조건 값 조회 (백본 소스)~~ — **D-14로 폐기.** 백본 복사는 기존 프로젝트의 `cell_value` → 신규 프로젝트의 `cell_value` 복사이며 적재 영역과 무관하다. 원천 파라미터 매핑 테이블도 백본 용도로는 불필요하다 (Recipe XML 매핑은 별개 주제로 후속 Phase에서 다룸).
- 신규 process의 layer ↔ 백본 프로젝트의 layer **매칭 규칙**(매칭 키: 이름/stepseq/area 조합 여부)은 미확정 — Phase 1 착수 전 확정 필요.
- 접근은 읽기 전용 커넥션(별도 engine, 같은 인스턴스의 타 DB 허용 — D-11)으로만 한다.

## 8. 백본 (D-14)

- **백본 = 기존 프로젝트.** 신규 프로젝트 생성 시 (a) process에서 구조(`sheet_layer`)를 파생하고, (b) 선택한 백본 프로젝트의 `cell_value`를 layer 매칭으로 복사한다. 파라미터 축은 전 프로젝트 공통(레지스트리)이므로 파라미터 매핑은 필요 없다 — 매칭은 layer 축에서만 일어난다.
- 매칭 실패 layer는 빈 값으로 시작한다. 이후 레이어별 백본 교체(소스: 다른 프로젝트의 layer) 또는 엑셀 붙여넣기로 채운다.
- 백본 프로젝트가 하나도 없는 부트스트랩 상황은 "백본 없이 시작"(전체 빈 값)으로 처리한다.
