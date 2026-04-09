# PRD: 공정 조건표(Process Condition) 도메인 전환

## 1. 배경
현재 시스템은 프로젝트(`projects`) + 제품(`products`) 중심으로 공정 조건표를 생성/운영한다. 그러나 실제 업무 흐름은 라인/공정/Part 조합과 `step_current` 최신 스냅샷을 중심으로 이루어지며, 제품 마스터/디바이스 마스터 의존은 생성 안정성과 데이터 정합성을 저해한다.

본 PRD는 다음 전환을 목표로 한다.
- 제품(`products`) 의존 제거
- 공정조건표 생성 소스의 `step_current` 일원화
- Backbone 소스의 공정조건표(승인본) 중심화
- 도메인 명칭 `project` → `process_condition` 전환

## 2. 문제 정의
1. 생성 입력이 제품/자유입력 Part에 의존하여 오입력 가능성이 높다.
2. Backbone 후보가 제품 단위로 노출되어, 실제 기준(승인된 조건표)과 불일치한다.
3. 리비전/중복 체크가 product/device_master 혼합 기준으로 분기되어 유지보수 복잡도가 높다.
4. 테이블/API/UI 용어가 project 중심이라 도메인 의미 전달이 약하다.

## 3. 목표
1. 생성 플로우를 `line -> process_id -> part_id` 조회형으로 고정한다.
2. 생성 시 선택 가능한 레이어는 `step_current(line, process_id, part_id)` 조회 결과 전체를 사용한다.
3. Backbone은 승인된 공정조건표에서만 선택한다.
4. 공정조건표 정체성을 `(line_id, process_id, part_id)` natural key로 관리한다.
5. 리비전 체계를 natural key 기반으로 단일화한다.
6. 전 계층 명칭을 `process_condition`으로 통일한다.

## 4. 비목표(Non-Goals)
- 외부 원천 시스템 스키마 변경.
- Airflow 파이프라인 재설계.
- 대시보드/권한 모델 전면 개편.

## 5. 사용자 시나리오 (To-Be)
1. 사용자가 "공정 조건표 생성" 버튼 클릭.
2. 라인 선택 (`lines` 조회).
3. 선택 라인 기준 `step_current`에서 `process_id` 목록 조회 후 선택.
4. 선택 `(line, process_id)` 기준 `part_id` 목록 조회 후 선택.
5. 선택 `(line, process_id, part_id)` 기준 레이어 목록을 조회하고, 기본은 전체 자동 포함.
6. 선택적으로 Backbone(승인된 공정조건표) 선택.
7. 생성 후 편집 화면으로 이동, 이후 편집/검증/승인 흐름은 기존 유지.

## 6. 기능 요구사항
### FR-1. 생성 입력 제약
- Part ID는 자유입력 금지, 조회형 선택만 허용.
- 레이어 선택은 기본 전체이며, short/full 정책은 후속 옵션으로 유지 가능.

### FR-2. Step Current 조회 API
- `line_id` 기준 `process_id` 옵션 제공.
- `(line_id, process_id)` 기준 `part_id` 옵션 제공.
- `(line_id, process_id, part_id)` 기준 레이어 목록 제공.

### FR-3. Backbone 정책
- Backbone 후보는 "승인된 공정조건표"만 노출.
- Backbone 참조 FK는 제품이 아닌 공정조건표를 가리킨다.

### FR-4. 리비전 정책
- 정체성 키: `(line_id, process_id, part_id)`.
- 리비전은 해당 정체성 그룹 내에서 증가.
- 최신본 포인터(`is_latest`)는 그룹당 1개 유지.

### FR-5. 도메인 리네이밍
- 테이블/모델/API/UI에서 project 용어를 process_condition으로 교체.
- 사용자 노출 문구는 "프로젝트" 대신 "공정 조건표" 사용.

## 7. 데이터 요구사항
- `step_current`에 `part_id` 컬럼이 존재해야 한다.
- `process_condition` 엔티티는 `line_id`, `process_id`, `part_id`, `revision`, `is_latest`, `status`를 포함한다.
- `process_condition_layers`는 레이어 스냅샷과 backbone 출처(조건표/레이어)를 추적해야 한다.

## 8. 성공 지표
1. 생성 실패율 감소 (Part 오입력 관련 실패 0건 목표).
2. 생성 API에서 product/device_master 참조 제거율 100%.
3. backbone 소스 조회의 승인본 일치율 100%.
4. 리비전 충돌(동일 key active 중복) 0건.

## 9. 리스크 및 대응
- 리네이밍 범위가 커서 회귀 위험 증가 → 통합 테스트/시나리오 테스트 선행 후 일괄 전환.
- 기존 product 기반 히스토리 조회 영향 → 관련 API/쿼리를 natural key 기준으로 즉시 교체.
- 데이터 무결성 제약 전환 시 배포 리스크 → 디버깅 가능한 개발 단계에서 제약을 초기에 강제 적용.

## 10. 오픈 이슈
1. short 모드(부분 레이어 선택) UX를 1차 릴리즈에 포함할지 여부.
2. Backbone 선택 기본값(없음/권장본 자동선택) 정책.
3. 리네이밍 시점의 모니터링/디버깅 체크포인트(로그, 에러코드, 검증 시나리오) 상세 기준.
