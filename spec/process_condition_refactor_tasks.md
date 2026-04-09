# TASK: 공정 조건표 도메인 전환 실행 항목

## Epic 0 — 준비/정렬
- [ ] T0-1. 기존 `project`/`product`/`device_master` 의존 지점 인벤토리 확정.
- [ ] T0-2. 호환 기간 정책 확정 (`/projects` 유지 기간, 제거 일정).
- [ ] T0-3. feature flag 이름/기본값 확정 (`USE_PROCESS_CONDITION_API` 등).

## Epic 1 — Step Current 조회 체인 강화
- [ ] T1-1. `StepCurrent` 모델에 `part_id` 필드 반영.
- [ ] T1-2. `step_master/query_service.py`에 `list_part_ids(line_id, process_id)` 추가.
- [ ] T1-3. `device_masters.py`에 `/step-current/parts` 라우트 추가.
- [ ] T1-4. `/step-current/layers`에 `part_id` 필터를 필수화.
- [ ] T1-5. process/part/layer 조회 쿼리 인덱스 점검 및 보강.

## Epic 2 — 생성 로직 단순화 (자유입력/수동레이어 제거)
- [ ] T2-1. 생성 요청 스키마에서 `selected_layer_ids` 잔존 경로 제거.
- [ ] T2-2. `create_project_v2` 미정의 변수 참조(`selected_layer_ids`, `product_name`) 제거.
- [ ] T2-3. 생성 시 step_current 조회 레이어 전체 자동 반영 로직 적용.
- [ ] T2-4. Part 자유입력 금지 검증(백엔드 유효성 + 프론트 UI 차단).

## Epic 3 — Backbone 참조 전환 (product FK 제거)
- [ ] T3-1. `main_backbone_id(FK products)` -> `main_backbone_condition_id(FK process_condition)` 설계 반영.
- [ ] T3-2. layer backbone 출처 필드(`backbone_source_condition_id` 등) 설계/적용.
- [ ] T3-3. backbone repository 조회 기준을 approved process_condition으로 교체.
- [ ] T3-4. 프론트 backbone 드롭다운 API를 신 endpoint로 전환.

## Epic 4 — Natural key 기반 리비전/중복 정책 통일
- [ ] T4-1. 리비전 분기에서 `device_master_id` 의존 제거.
- [ ] T4-2. natural key `(line_id, process_id, part_id)` 기준 active 중복 체크 공통화.
- [ ] T4-3. revise 시 latest 교체 + revision 증가 규칙 통일.
- [ ] T4-4. 버전 히스토리 조회 API를 product_id 기준에서 natural key 기준으로 확장/전환.

## Epic 5 — 도메인 리네이밍
- [ ] T5-1. 테이블명 리네이밍: `projects` -> `process_condition`.
- [ ] T5-2. 테이블명 리네이밍: `project_layers` -> `process_condition_layers`.
- [ ] T5-3. 테이블명 리네이밍: `project_status_logs` -> `process_condition_status_logs`.
- [ ] T5-4. 백엔드 라우터 prefix `/projects` -> `/process-conditions` (호환 alias 제공).
- [ ] T5-5. 프론트 화면/컴포넌트/문구에서 "프로젝트" -> "공정 조건표" 일괄 교체.

## Epic 6 — 호환/전환 운영
- [ ] T6-1. 구 API alias + deprecation header 추가.
- [ ] T6-2. 모니터링 지표를 신 경로 기준으로 추가(성공률, 4xx/5xx, 생성 지연).
- [ ] T6-3. 컷오버 체크리스트 문서화(배포 전/중/후 확인 항목).
- [ ] T6-4. 롤백 절차 문서화(플래그 되돌림 + 트래픽 우회).

## Epic 7 — 테스트/검증
- [ ] T7-1. 백엔드 단위테스트: process/part/layer 옵션 조회.
- [ ] T7-2. 백엔드 통합테스트: 생성(create), 중복(409), 리비전(revise) 시나리오.
- [ ] T7-3. 프론트 컴포넌트 테스트: 생성 모달 cascading + part 드롭다운 강제.
- [ ] T7-4. E2E: "라인 선택 -> 공정 선택 -> Part 선택 -> 생성 -> 편집 진입".
- [ ] T7-5. 호환테스트: `/projects`와 `/process-conditions` 동시 운영 검증.

## 마일스톤 제안
- [ ] M1: Epic 1~2 완료 (생성 안정화)
- [ ] M2: Epic 3~4 완료 (도메인 핵심 로직 전환)
- [ ] M3: Epic 5~7 완료 (리네이밍 + 컷오버)
