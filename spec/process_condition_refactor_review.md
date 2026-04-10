# Process Condition Refactor 리뷰/제안 메모

본 문서는 아래 3개 문서를 기준으로, **실행 전 반드시 합의가 필요한 디테일**과 **바로 적용 가능한 제안**을 정리한 실행 보조 문서다.

- `spec/process_condition_refactor_prd.md`
- `spec/process_condition_refactor_tasks.md`
- `spec/process_condition_refactor_trd.md`

---

## 진행 현황 스냅샷 (2026-04-09)

- 완료(대표):
  - `step_current.part_id` 기반 조회 체인(process/part/layers) 반영.
  - `/process-conditions` 백엔드 라우터 적용.
  - backbone 후보 조회를 approved/latest process-condition 기준으로 전환.
  - cutover/rollback 문서 추가.
  - 프론트 핵심 진입/이동/호출 경로(`/projects/...`)를 `/process-conditions/...`로 1차 전환.
  - revise 생성 시 legacy `device_master_id` 복제를 제거해 natural-key 경로 의존성 축소.
  - cutover 검증 테스트 추가: `/api/projects`는 404, `/api/process-conditions`는 활성(비404) 확인.
  - backbone 참조 이행 컬럼 추가: `projects.main_backbone_condition_id`, `project_layers.backbone_source_condition_id` (`028_add_process_condition_backbone_refs`).
  - 통합 테스트 보강: 생성/중복(409)/리비전(revise) 자연키 시나리오 추가.
  - 물리 테이블 리네이밍 반영: `projects`/`project_layers`/`project_status_logs` -> `process_conditions`/`process_condition_layers`/`process_condition_status_logs`.
  - legacy backbone product API(`/products/backbones`, `/products/{id}/backbone-layers`) 및 repository 경로 제거.
  - 프론트 빌드 경고 정리(T7-4): Vite chunk warning 임계치 조정 후 경고 0건으로 빌드 확인.
  - 프론트 사용자 노출 문구의 "프로젝트"를 "공정 조건표"로 일괄 교체(T5-5).
  - 프론트 생성 모달 로직 테스트 추가: cascading reset/part 필수/short 레이어 선택 강제 검증(T8-3).
  - E2E(API) 시나리오 추가: line -> process -> part -> create -> detail(편집 진입) 검증(T8-4).
  - 생성 API 관측성 로그 보강(T6-1): 성공/4xx/5xx(outcome, status_code) 및 생성 지연(duration_ms) 구조화 로그 추가.
  - Epic 0 정리 완료(T0-1~T0-3): 레거시 의존 인벤토리/직접 컷오버 정책/삭제 기준을 본 문서 기준으로 확정.
- 미완료(핵심):
  - (없음) 현재 task checklist 기준 미완료 항목 없음.

### Epic 0 확정 메모 (T0-1~T0-3)

- 인벤토리 범위(T0-1): `project`/`product`/`device_master` 의존 지점은 라우터, 서비스, repository, 스키마/타입, 프론트 API/hook/컴포넌트를 모두 포함해 추적 완료.
- 컷오버 정책(T0-2): 무호환 직접 전환 원칙 확정.
  - `/api/projects` 및 legacy backbone product API는 복구/호환 레이어 없이 제거.
  - canonical read/write 경로는 `/api/process-conditions` 계열로 단일화.
- 삭제 기준(T0-3): 다음 중 하나라도 만족하면 제거 대상으로 확정.
  - 신 도메인(`process_condition`) 경로에서 더 이상 참조되지 않는 라우터/서비스/모델/타입/훅/컴포넌트.
  - legacy product/device_master 분기 전용 로직.
  - 테스트 커버리지 없이 잔존한 dead import/dead type/dead query key.

---

## 1) 현재 스펙의 강점 요약

- 도메인 식별자를 `(line_id, process_id, part_id)`로 고정한 점이 명확함.
- 생성 소스를 `step_current`로 단일화해서 입력 오차를 줄이는 방향이 일관됨.
- backbone 소스를 "승인된 조건표"로 변경하는 정책이 운영/품질 관점에서 타당함.
- direct cutover(구 경로 미유지) 원칙이 기술부채 억제에 효과적임.

---

## 2) 반드시 확정해야 할 오픈 포인트 (우선순위 높음)

### A. 상태/중복 정책의 정확한 범위

현재 문서에는 "active 중복(draft|review)"로 되어 있으나, 아래를 명시적으로 확정해야 한다.

1. `rejected` 상태에서 동일 natural key 신규 생성 허용 여부.
2. `approved` 최신본이 있을 때 허용되는 경로가 `revise`만인지 여부.
3. 중복 체크 시 `is_latest=true` 조건을 항상 포함할지 여부.

**권장안**
- `rejected`도 동일 natural key 신규 생성 불가(삭제 전제 없이 기존 건을 수정/승인으로 끌고 가는 운영).
- `approved` 최신본이 있을 때 신규 생성은 불가, `revise`만 허용.
- 중복 금지 대상은 `status in ('draft', 'review') and is_latest=true`를 포함해 “개정 중 개정”을 차단.

### B. Backbone 무결성 규칙

`main_backbone_condition_id`를 허용할 때 최소 검증 규칙을 확정해야 한다.

1. backbone 대상은 `approved + is_latest=true` 고정.
2. 같은 `line_id` 내에서만 backbone 선택 가능.
3. 신규 생성(create)에서 backbone과 생성 대상 간 별도 동일성 검증이 필요한지 여부.

**권장안**
- 1번 필수.
- 2번 필수(교차 라인 오적용 방지).
- 3번은 create 경로에서 별도 동일성 검증을 두지 않음(신규 생성 중복은 natural key active 중복 체크로 이미 차단됨). 동일 natural key 관계는 revise 경로에서만 의미가 있음.

### C. StepCurrent part_id 품질 규칙

`part_id` 기반 체인으로 전환하려면 `step_current.part_id` 데이터 품질 기준이 필요하다.

1. null/blank part_id row 허용 여부.
2. 동일 `(line, process, part, layer)` 다건 충돌 시 처리 정책.
3. 대소문자/공백 정규화 규칙.

**권장안**
- `part_id`는 null/blank 모두 불가.
- `(line, process, part, layer)`는 중복 불가(중복 발견 시 에러로 명시).
- 비교/저장은 공백 제거 + 대문자 정규화 기준.

---

## 3) 스키마/마이그레이션 제안 (실행 순서)

Direct cutover라도, DB 변경은 2단계가 안전하다.

1. **Expand**: 새 컬럼/새 FK/새 인덱스 추가 + 백필.
2. **Switch**: 코드가 새 컬럼/테이블명만 사용하도록 전환.
3. **Contract**: 구 컬럼/구 인덱스/구 FK 삭제.

### 필수 DDL 체크리스트

- `step_current.part_id` 추가 (+ 인덱스 `(line_id, process_id, part_id)`).
- `projects.main_backbone_condition_id` 추가(FK self).
- `project_layers.backbone_source_condition_id` 추가.
- partial unique: natural key별 `is_latest=true` 1건 보장.
- unique: `(line_id, process_id, part_id, revision)`.

> 주의: 테이블 rename(`projects -> process_condition`)는 앱 코드/마이그레이션 순서 충돌이 잦다. 운영 안정성을 위해 **한 릴리즈에서는 alias/view 전략 없이 rename+코드 동시 반영**을 하되, migration 스크립트에서 index/constraint 이름도 함께 정리해야 한다.

---

## 4) API 계약 제안 (breaking change 명확화)

### 생성 옵션 API

- `GET /device-masters/step-current/processes?line_id=`
- `GET /device-masters/step-current/parts?line_id=&process_id=`
- `GET /device-masters/step-current/layers?line_id=&process_id=&part_id=`

**권장 응답 규칙**
- `parts`: 빈값/중복 제거 후 정렬.
- `layers`: `part_id` 미전달 시 422(필수 파라미터).
- stale 정보(`last_successful_sync_at`, `stale`)는 유지하되, stale일 때 생성 API에서 최종 차단 여부를 정책화.

### 생성 API

- `POST /process-conditions`
- 요청에서 `selected_layer_ids` 제거.

**권장 에러 코드 합의**
- 400: 입력 조합이 step_current에 없음.
- 409: active 중복.
- 422: 스키마 위반(필수값 누락).
- 503: freshness SLA 위반(정책 ON일 때).

---

## 5) 서비스 로직 제안

### create_process_condition

1. line/process/part 유효성 확인.
2. `step_current(line, process, part)` 조회.
3. `draft/review + is_latest=true` 중복 확인.
4. backbone 승인본 검증.
5. header + layers 일괄 생성(트랜잭션).

### revise

- product/device_master 분기를 제거하고 natural key 단일 경로로 통합.
- 기존 최신 approved를 archived 처리하고 신규 draft를 `revision+1`로 생성.
- 트랜잭션 내에서 latest 단일성 보장(잠금 또는 unique constraint 기반).

---

## 6) 테스트 보강 제안 (최소 세트)

1. `list_part_ids(line, process)` 단위테스트(중복/정렬/빈값 제외).
2. `layers` API의 `part_id` 필수 검증(422).
3. 생성 API가 레이어 전체 자동 포함하는지 검증.
4. 동일 natural key active 중복 409.
5. revise 시 revision 증가 + latest 단일성.
6. backbone 후보가 `approved + latest`만 노출되는지 검증.

---

## 7) 즉시 실행 권장 순서 (개발 단위)

### Milestone A (생성 입력 안정화)
- StepCurrent에 part 체인 완성(`parts` endpoint + `layers` 필수 part).
- create에서 수동 레이어 선택 제거(전체 자동).
- 중복 체크를 natural key 기준으로 통일.

### Milestone B (백본/리비전 정합화)
- backbone FK를 condition 기준으로 전환.
- revise 로직 단일화 + latest 제약 적용.

### Milestone C (리네이밍/정리)
- `/projects` 제거, `/process-conditions`만 유지.
- 모델/서비스/프론트 네이밍 정리.
- dead code 삭제 + 테스트 그린.

---

## 8) 운영/디버깅 제안

배포 당일 최소 모니터링 항목:

- 생성 API 성공률, p95 latency
- 4xx(400/409/422) 비율
- 503(stale) 발생 건수
- natural key 충돌 로그(라인/공정/part 태깅)

장애 시 롤백은 TRD 원칙대로 **같은 process_condition 도메인 내 이전 커밋 복귀**만 허용하고, legacy `/projects` 복구는 금지.

---

## 9) 결론

현재 PRD/TASK/TRD 방향은 적절하며, 구현 리스크의 대부분은 다음 3가지에서 발생한다.

1. natural key + latest 제약을 DB 레벨에서 강제하지 않는 경우
2. part_id 데이터 품질(빈값/중복/정규화) 규칙을 미확정한 경우
3. backbone 무결성 조건(approved/latest/line 범위)을 코드에서 강제하지 않는 경우

위 3가지를 먼저 확정하면, 이후 리네이밍/코드삭제는 상대적으로 기계적으로 진행 가능하다.
