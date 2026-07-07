# 05. UI 와이어프레임 계획

## 1. 목적

Phase 1에 들어가기 전에 PCM의 핵심 화면 흐름을 먼저 고정한다. 여기서의 와이어프레임은 시각 디자인이 아니라 **수천 개 process 후보 중 하나를 찾고, 100개 미만 layer 구조를 확인한 뒤, 약 200개 parameter 조건표를 편집 가능한 형태로 이해하는 정보 구조**를 의미한다.

## 2. 도메인 해석 반영

- **Process**: 적재로 들어오는 **구조(뼈대)** — partid, processid, stepseq, area 같은 컬럼으로 된 layer/step 목록. 조건 값이 없고 읽기 전용이다 (D-14).
- **Layer**: process 내부의 개별 제조 step이며 조건표의 행이다. `photo`, `etch`, `계측` 등은 layer의 이름/유형(area)으로 표현한다.
- **Parameter**: 전 process 공통 컬럼 세트이며 200개 부근에서 움직이는 것을 기준으로 한다.
- **Project**: process 하나를 골라 만든 조건표(구조 사본 + 셀 값 + 상태/버전). 값의 원천은 **백본 프로젝트**(기존 프로젝트)이며, 백본을 layer 매칭하는 순간 "프로세스가 프로젝트로 변신"한다. 장기적으로 process당 활성 프로젝트 1개로 수렴한다.

## 3. 규모 가정

| 항목 | 와이어프레임 기준 |
|------|------------------|
| process 수 | 수천 개 이상 가능 |
| layer 수 | process당 100개 미만 |
| parameter 수 | 약 200개 |
| 조건표 셀 수 | process/project당 최대 약 20,000개 |

이 규모에서는 backend narrow table 전략은 유지 가능하지만, UI는 목록 검색과 그리드 가상 스크롤을 전제로 설계한다.

## 4. 1차 화면 지도

```text
App Shell
├─ Process Catalog
│  ├─ Process 검색/필터
│  ├─ Process 결과 테이블
│  └─ 선택 Process Preview
├─ Project List
│  ├─ Draft/Review/Approved 상태 목록
│  └─ 최근 작업/잠금 상태
├─ Project Create
│  ├─ 선택 process 요약
│  ├─ layer 구조 확인
│  └─ 백본 복사 미리보기
├─ Project Detail
│  ├─ layer 백본 구성 (Main/교체 상태)
│  └─ 레이어별 백본 교체 modal (소스 검색 → layer 선택 → diff 미리보기)
├─ Sheet Editor
│  ├─ layer × parameter grid
│  ├─ parameter category tabs
│  ├─ 검색/점프/필터
│  ├─ Excel paste staging
│  └─ validation panel
└─ Parameter Admin
   ├─ parameter registry
   └─ category/options
```

Phase 1에서는 `Process Catalog`, `Project Create`, `Project List`, `Project Detail(백본 교체)`를 우선 잡고, `Sheet Editor`는 그리드 PoC 화면으로 별도 검증한다.

## 5. Process Catalog 와이어프레임

### 5.1 목적

외부 적재 영역에 존재하는 process 중 프로젝트 생성 기준이 될 process를 찾고, 선택한 process의 layer 구조가 기대와 맞는지 빠르게 확인한다.

### 5.2 레이아웃

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Process Catalog                                                       │
│ [검색어: partid/processid] [Area] [최근 적재일] [☐ 조건표 없는 것만]  │
├──────────────────────────────┬───────────────────────────────────────┤
│ Process 결과 테이블           │ Process 구조 Preview                  │
│ ┌──────────────────────────┐ │ ┌───────────────────────────────────┐ │
│ │ partid·processid | steps │ │ │ 구조 요약                          │ │
│ │ | 적재 | 조건표 유무      │ │ │ step count, area 목록, 조건표 유무│ │
│ └──────────────────────────┘ │ └───────────────────────────────────┘ │
│ [페이지/더보기]              │ ┌───────────────────────────────────┐ │
│                              │ │ Layer 구조 (값 없음 — 구조만)      │ │
│                              │ │ stepseq | layer | area             │ │
│                              │ └───────────────────────────────────┘ │
│                              │ [이 구조로 프로젝트 생성]            │
└──────────────────────────────┴───────────────────────────────────────┘
```

### 5.3 동작

- process 목록은 검색/필터/페이지네이션을 전제로 한다.
- 결과 테이블은 수천 개 process를 한 번에 렌더링하지 않는다.
- process 선택 시 오른쪽 preview에서 layer 목록을 보여준다.
- layer 목록은 100개 미만이므로 전체 표시가 가능하지만, 검색/유형 필터는 제공한다.
- `프로젝트 생성` 버튼은 Phase 1의 project create flow로 연결한다.

## 6. Project Create 와이어프레임

### 6.1 목적

선택한 process(구조)를 `sheet_layer`로 파생하고, **백본 프로젝트(값)를 layer 매칭**해 복사하기 전에 사용자가 매칭 결과를 확인하게 한다 (D-14).

### 6.2 레이아웃

```text
┌──────────────────────────────────────────────────────────────┐
│ 새 프로젝트 생성  ① Process 확인 → ② 백본 선택 → ③ 매칭 확인  │
├──────────────────────────────────────────────────────────────┤
│ ① Process(구조): 제품 Alpha Main / ALPHA-01 · P-MAIN          │
│    Steps: 87 | 조건표: 없음 → 신규                             │
├──────────────────────────────────────────────────────────────┤
│ ② 백본 프로젝트(값): 기존 프로젝트 검색 (Approved 우선)       │
│    - Beta Memory 조건표 v3  [layer 매칭 79/87]  ← 선택         │
│    - Delta Pilot 조건표 v2  [매칭 61/87]                       │
│    - 백본 없이 시작 (모든 셀 빈 값)                            │
├──────────────────────────────────────────────────────────────┤
│ 프로젝트 이름/설명 [________________________]                  │
├──────────────────────────────────────────────────────────────┤
│ ③ 매칭 확인 (dry-run) — 자동 키: stepseq + layer_no (D-15)     │
│ - sheet_layer 파생 87 | 자동 매칭 78 + 수동 매칭 1             │
│ - 백본 복사 15,642 cells | 미매칭 8 layer → 빈 값 시작 (P1-D1) │
│ Layer 매칭 미리보기: step·no | layer | 자동/수동/미매칭         │
│  └ 자동 실패 layer에는 [수동 매칭 ▾] 백본 layer 검색 드롭다운  │
├──────────────────────────────────────────────────────────────┤
│ [취소]                                      [프로젝트 생성]    │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 Phase 1 완료 기준 연결

- 서로 다른 process로 프로젝트를 만들면 서로 다른 layer 구조가 `sheet_layer`로 복사되어야 한다.
- 백본 프로젝트 복사(layer 매칭) 결과가 `cell_value`에 반영되어야 한다.
- 매칭률은 process 단독 속성이 아니라 **(process, 백본 프로젝트) 쌍**에서 계산됨을 UI가 표현해야 한다.
- 자동 매칭(stepseq + layer_no) 실패분은 사용자가 **수동 매칭**으로 보완할 수 있어야 한다 (D-15).
- 최종 미매칭 layer는 빈 값으로 시작하고, 그 사실이 생성 전에 표시되어야 한다 (P1-D1).

## 7. Sheet Editor 그리드 PoC 와이어프레임

### 7.1 목적

100개 미만 layer × 약 200 parameter 규모에서 편집, 스크롤, 검색, Excel 붙여넣기가 가능한지 검증한다.

### 7.2 레이아웃

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Project: 제품 Alpha 조건표                         [저장] [검증]     │
│ 상태: Draft | Lock: 내가 편집 중 | 변경 n건                          │
├──────────────────────────────────────────────────────────────────────┤
│ [전체] [SP·Spin/PR] [SC·Scanner] [OVL] [DEV] …   검색 [layer/parameter]│
│  ※ 탭은 파라미터 카테고리(레지스트리)에서 동적 생성 — layer 유형 아님  │
├───────────────┬──────────────────────────────────────────────────────┤
│ Layer 고정열   │ Parameter columns                                    │
│ order/name/type│ PR_TYPE | SPIN_SPEED | EXPOSURE | ETCH_RATE | ...    │
├───────────────┼──────────────────────────────────────────────────────┤
│ 001 Clean      │ ...                                                  │
│ 010 Photo      │ ...                                                  │
│ 020 Etch       │ ...                                                  │
│ ...            │ ...                                                  │
└───────────────┴──────────────────────────────────────────────────────┘
│ 하단 패널: 선택 셀 상세 | validation | paste staging | 변경 이력 요약 │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.3 PoC 체크리스트

- 100개 layer × 200 parameter = 20,000셀 렌더링/스크롤이 쾌적한가?
- 좌측 layer 식별 컬럼 고정이 가능한가?
- parameter category별 탭/필터가 가능한가?
- Excel TSV 붙여넣기 후 적용 전 staging 표시가 가능한가?
- 셀 타입별 editor와 validation 표시가 가능한가?
- 저장 payload를 dirty cell batch로 만들 수 있는가?

## 8. API 영향

와이어프레임 기준으로 Phase 1에서 다음 API 계약을 구체화한다.

```text
GET  /processes?query=&limit=&cursor=          # 구조 검색 (조건표 유무 포함)
GET  /processes/{process_key}                  # 구조 요약
GET  /processes/{process_key}/layers           # layer 구성 (stepseq/area)
GET  /projects/backbone-candidates?process_key=  # 백본 후보 + 매칭률
POST /projects/create-preview                  # (process, 백본) 매칭 dry-run
POST /projects                                 # 생성 (구조 파생 + 백본 복사)
POST /projects/{id}/layers/{layer_key}/backbone-replace
GET  /projects
GET  /projects/{project_id}
```

Phase 2에서는 sheet editor를 위해 다음 계약을 추가한다.

```text
GET /projects/{project_id}/sheet
PATCH /projects/{project_id}/cells
POST /projects/{project_id}/paste-preview
POST /projects/{project_id}/validate
```

## 9. 결정 보류 항목

- `Layer` 명칭을 계속 쓸지, UI에서는 `Step`을 병기할지 결정한다. (→ [phase-1-tasks.md](./phase-1-tasks.md) P1-D3)
- process 검색 필터의 실제 속성(partid/processid/area 등)은 적재 DB 스키마 확정 후 정한다. (→ P1-D2)
- ~~layer 매칭 키~~ — **확정 (D-15)**: 자동 = stepseq + layer_no 조합, 자동 실패분은 수동 매칭.
- 조건표가 이미 있는 process의 중복 프로젝트 생성 정책을 정한다. (→ P1-D6)
- 그리드 라이브러리는 Phase 1 PoC 결과로 확정한다. (→ phase-1-tasks T7)

HTML 와이어프레임(v3, light theme)은 위 화면 지도 기준 5개 화면(Project List / Process Catalog / Project Create / Project Detail·백본 교체 / Sheet Editor PoC)을 담고 있으며, 화면 간 버튼 이동으로 실제 flow를 시뮬레이션한다.
