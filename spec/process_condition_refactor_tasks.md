# TASK: 공정 조건표 도메인 전환 실행 항목

## Epic 0 — 준비/정렬
- [x] T0-1. 기존 `project`/`product`/`device_master` 의존 지점 인벤토리 확정.
- [x] T0-2. 무호환 직접 전환 정책 확정 (`/projects` 제거, `/process-conditions` 단일화).
- [x] T0-3. 미사용 코드 삭제 기준 확정(라우터/서비스/모델/타입/훅/컴포넌트).

## Epic 1 — Step Current 조회 체인 강화
- [x] T1-1. `StepCurrent` 모델에 `part_id` 필드 반영.
- [x] T1-2. `step_master/query_service.py`에 `list_part_ids(line_id, process_id)` 추가.
- [x] T1-3. `device_masters.py`에 `/step-current/parts` 라우트 추가.
- [x] T1-4. `/step-current/layers`에 `part_id` 필터를 필수화.
- [x] T1-5. process/part/layer 조회 쿼리 인덱스 점검 및 보강.

## Epic 2 — 생성 로직 단순화 (자유입력/수동레이어 제거)
- [x] T2-1. 생성 요청 스키마에서 `selected_layer_ids` 잔존 경로 제거.
- [x] T2-2. `create_project_v2` 미정의 변수 참조(`selected_layer_ids`, `product_name`) 제거.
- [x] T2-3. 생성 시 step_current 조회 레이어 전체 자동 반영 로직 적용.
- [x] T2-4. Part 자유입력 금지 검증(백엔드 유효성 + 프론트 UI 차단).

## Epic 3 — Backbone 참조 전환 (product FK 제거)
- [x] T3-1. `main_backbone_id(FK products)` -> `main_backbone_condition_id(FK process_condition)` 설계 반영.
- [x] T3-2. layer backbone 출처 필드(`backbone_source_condition_id` 등) 설계/적용.
- [x] T3-3. backbone repository 조회 기준을 approved process_condition으로 교체.
- [x] T3-4. 프론트 backbone 드롭다운 API를 신 endpoint로 전환.

## Epic 4 — Natural key 기반 리비전/중복 정책 통일
- [x] T4-1. 리비전 분기에서 `device_master_id` 의존 제거.
- [x] T4-2. natural key `(line_id, process_id, part_id)` 기준 active 중복 체크 공통화.
- [x] T4-3. revise 시 latest 교체 + revision 증가 규칙 통일.
- [x] T4-4. 버전 히스토리 조회 API를 product_id 기준에서 natural key 기준으로 확장/전환.

## Epic 5 — 도메인 리네이밍
- [x] T5-1. 테이블명 리네이밍: `projects` -> `process_condition`.
- [x] T5-2. 테이블명 리네이밍: `project_layers` -> `process_condition_layers`.
- [x] T5-3. 테이블명 리네이밍: `project_status_logs` -> `process_condition_status_logs`.
- [x] T5-4. 백엔드 라우터 prefix `/projects` -> `/process-conditions` (구 경로 즉시 제거).
- [x] T5-5. 프론트 화면/컴포넌트/문구에서 "프로젝트" -> "공정 조건표" 일괄 교체.

## Epic 6 — 전환/디버깅 운영
- [x] T6-1. 모니터링 지표를 신 경로 기준으로 추가(성공률, 4xx/5xx, 생성 지연).
- [x] T6-2. 전환 체크리스트 문서화(배포 전/중/후 확인 항목).
- [x] T6-3. 롤백 절차 문서화(같은 도메인 내 이전 커밋 복귀 + 데이터 검증, legacy 복구 금지).

## Epic 7 — 미사용 코드 제거(필수)
- [x] T7-1. 백엔드에서 `/projects` 라우터 및 project 네이밍 전용 코드 삭제.
- [x] T7-2. 백엔드에서 product/device_master 기반 생성/중복/리비전 분기 삭제.
- [x] T7-3. 프론트에서 project 전용 API/hook/type/component 경로 삭제 또는 process_condition으로 완전 교체.
- [x] T7-4. dead import, dead type, dead query key 정리 및 빌드 경고 0건 확인.

## Epic 8 — 테스트/검증
- [x] T8-1. 백엔드 단위테스트: process/part/layer 옵션 조회.
- [x] T8-2. 백엔드 통합테스트: 생성(create), 중복(409), 리비전(revise) 시나리오.
- [x] T8-3. 프론트 컴포넌트 테스트: 생성 모달 cascading + part 드롭다운 강제.
- [x] T8-4. E2E: "라인 선택 -> 공정 선택 -> Part 선택 -> 생성 -> 편집 진입".
- [x] T8-5. 제거 검증: `/projects` 호출 시 미노출/404, `/process-conditions`만 동작 검증.

## 마일스톤 제안
- [x] M1: Epic 1~2 완료 (생성 안정화)
- [x] M2: Epic 3~4 완료 (도메인 핵심 로직 전환)
- [x] M3: Epic 5~8 완료 (리네이밍 + 즉시 전환 + 미사용 코드 삭제 + 디버깅 안정화)
