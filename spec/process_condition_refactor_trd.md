# TRD: 공정 조건표 도메인 전환 기술 설계

## 1. 설계 원칙
1. **Single Source of Truth**: 생성 후보(공정/Part/레이어)는 `step_current`만 사용.
2. **Natural-Key First**: 도메인 식별은 `(line_id, process_id, part_id)`.
3. **Backbone by Approved Document**: Backbone 소스는 승인된 공정조건표.
4. **Safe Cutover**: 구 경로와 신 경로를 병행 운영 후 제거.

## 2. 대상 컴포넌트
- Backend
  - Models: `project.py`, `change_log.py`, `step_master.py`
  - Services: `project/service.py`, `project/status_service.py`, `backbone_repository.py`, `step_master/query_service.py`
  - Routers: `projects/*`, `device_masters.py`, `products.py`
  - Schemas: `project.py`, `device_master.py`
- Frontend
  - API/Hooks: `api/projects.ts`, `api/products.ts`, `api/deviceMaster.ts`, `hooks/useProjects.ts`, `hooks/useStepCurrent.ts`
  - UI: `components/projects/ProjectCreateModalV2.tsx`, `pages/ProjectListPage.tsx`, 에디터 헤더/배지/문구

## 3. 데이터 모델 (To-Be)
> 명칭은 logical target이며, 실제 물리 변경은 단계별로 수행.

### 3.1 process_condition (구 projects)
- id (PK)
- line_id (FK lines)
- process_id (string)
- part_id (string)
- status, revision, is_latest
- parent_process_condition_id (self FK)
- main_backbone_condition_id (FK process_condition.id, nullable)
- created_by/reviewed_by/timestamps

권장 제약:
- UNIQUE(line_id, process_id, part_id, revision)
- latest 단일성 보장 제약(Partial Unique): is_latest=true는 natural key 당 1건

### 3.2 process_condition_layers (구 project_layers)
- id (PK)
- process_condition_id (FK process_condition)
- layer_id, layer_name, step_seq, sort_order
- conditions, backbone_conditions
- backbone_source_condition_id (nullable FK)
- backbone_source_layer_id (nullable FK or logical ref)

### 3.3 process_condition_status_logs (구 project_status_logs)
- id, process_condition_id, from_status, to_status, changed_by, comment, changed_at

### 3.4 step_current
- line_id, process_id, step_seq, layer_id, descript, ...
- **part_id 추가**

권장 인덱스:
- (line_id, process_id)
- (line_id, process_id, part_id)
- (line_id, process_id, part_id, layer_id, step_seq)

## 4. API 설계

### 4.1 생성 옵션 조회
- `GET /device-masters/step-current/processes?line_id=`
  - response: process_ids[]
- `GET /device-masters/step-current/parts?line_id=&process_id=`
  - response: part_ids[]
- `GET /device-masters/step-current/layers?line_id=&process_id=&part_id=`
  - response: layers[]

### 4.2 공정조건표 생성/조회
- 신규 canonical prefix: `/process-conditions`
- 기존 `/projects`는 호환 alias로 유지 후 제거

생성 요청 예시:
```json
{
  "line_id": 1,
  "process_id": "PHOTO",
  "part_id": "P-001",
  "device_type": "full",
  "backbone_condition_id": 123
}
```

생성 규칙:
- 레이어는 `step_current(line, process_id, part_id)` 조회 결과 전체 자동 포함.
- `selected_layer_ids`/자유입력 레이어 파라미터는 제거.

### 4.3 Backbone 조회
- `GET /process-conditions/backbones?line_id=`
  - 조건: `status=approved`, `is_latest=true`

## 5. 서비스 로직 변경

### 5.1 create_process_condition
1. line/process/part 유효성 검증.
2. `step_current`에서 레이어 조회(없으면 400).
3. natural key 활성중복 검사(`draft|review` + is_latest).
4. Backbone 선택 시 approved 조건표 검증.
5. process_condition 생성 + 레이어 자동 생성.

### 5.2 revise
- 분기 기준에서 `device_master_id` 제거.
- natural key 기준으로 latest 교체 + revision 증가.
- 기존 approved 문서를 archived 처리하고 신규 draft 생성.

### 5.3 status transition
- 로그 테이블 참조만 rename 반영.
- 상태머신 규칙은 유지.

## 6. 프론트엔드 설계

### 6.1 생성 모달
- 드롭다운 체인: line -> process -> part
- Part 입력 컴포넌트를 Input에서 Combobox/Select로 교체.
- 레이어 패널은 읽기전용 요약(전체 자동 포함 수량)으로 단순화.

### 6.2 네이밍
- 사용자 노출 텍스트: "프로젝트" -> "공정 조건표"
- 컴포넌트/타입/라우트명도 단계적으로 변경.

## 7. 전환 전략

### Phase A (호환 모드)
- 신 API/신 스키마 추가.
- 구 API(`/projects`) 유지, 내부적으로 신 서비스 호출 가능.

### Phase B (기본 전환)
- 프론트 기본 경로를 `/process-conditions`로 전환.
- product/device_master 의존 코드 제거.

### Phase C (정리)
- 구 엔드포인트/구 필드 완전 제거.
- 문서/운영 스크립트/모니터링 명칭 정리.

## 8. 검증 항목
1. 생성 E2E: line->process->part->create 성공.
2. Part 자유입력 차단 검증.
3. Backbone 후보가 approved+latest 문서만 반환되는지 검증.
4. 동일 natural key의 active 중복 생성 방지(409).
5. revise 시 revision 증가 및 latest 단일성 보장.
6. 구 `/projects` 호환 경로 동작(전환 기간).

## 9. 롤백 전략
- Feature flag로 생성 경로를 구 V2(`/projects/v2`)로 즉시 전환 가능하게 유지.
- 신 API 문제 시 프론트에서 구 API fallback 허용.
- 스키마 변경은 단계적 적용(읽기 호환 우선)으로 역호환성 확보.
