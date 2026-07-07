# 05. UI 와이어프레임 계획

## 1. 목적

Phase 1에 들어가기 전에 PCM의 핵심 화면 흐름을 먼저 고정한다. 여기서의 와이어프레임은 시각 디자인이 아니라 **수천 개 process 후보 중 하나를 찾고, 100개 미만 layer 구조를 확인한 뒤, 약 200개 parameter 조건표를 편집 가능한 형태로 이해하는 정보 구조**를 의미한다.

## 2. 도메인 해석 반영

- **Process**: `photo`, `etch`, `계측` 같은 단일 제조공정 종류가 아니라, 하나의 제품/route가 완성될 때까지 통과하는 전체 layer/step 집합이다.
- **Layer**: process 내부의 개별 제조 step이며 조건표의 행이다. `photo`, `etch`, `계측`, `deposition`, `clean` 등은 layer의 이름이나 유형으로 표현한다.
- **Parameter**: 전 process 공통 컬럼 세트이며 200개 부근에서 움직이는 것을 기준으로 한다.
- **Project**: 적재된 process 구조를 선택해 생성하는 편집/검토/승인 대상 조건표다.

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
├─ Sheet Editor
│  ├─ layer × parameter grid
│  ├─ parameter category tabs
│  ├─ 검색/점프/필터
│  ├─ Excel paste staging
│  └─ validation panel
└─ Parameter Admin
   ├─ parameter registry
   ├─ category/options
   └─ source parameter mapping
```

Phase 1에서는 `Process Catalog`, `Project Create`, `Project List`를 우선 잡고, `Sheet Editor`는 그리드 PoC 화면으로 별도 검증한다.

## 5. Process Catalog 와이어프레임

### 5.1 목적

외부 적재 영역에 존재하는 process 중 프로젝트 생성 기준이 될 process를 찾고, 선택한 process의 layer 구조가 기대와 맞는지 빠르게 확인한다.

### 5.2 레이아웃

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Process Catalog                                                       │
│ [검색어: 제품명/process key/route] [제품군] [최근 적재일] [상태]       │
├──────────────────────────────┬───────────────────────────────────────┤
│ Process 결과 테이블           │ Process Preview                       │
│ ┌──────────────────────────┐ │ ┌───────────────────────────────────┐ │
│ │ key | 이름 | layer | 적재 │ │ │ 제품/route 요약                   │ │
│ │ ...                      │ │ │ layer count, parameter coverage   │ │
│ └──────────────────────────┘ │ └───────────────────────────────────┘ │
│ [페이지/더보기]              │ ┌───────────────────────────────────┐ │
│                              │ │ Layer 구조                         │ │
│                              │ │ order | layer | type | 주요 조건   │ │
│                              │ └───────────────────────────────────┘ │
│                              │ [프로젝트 생성]                      │
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

선택한 process 구조를 프로젝트의 `sheet_layer`로 파생하고, 적재 조건 값을 백본으로 복사하기 전에 사용자가 생성 결과를 확인하게 한다.

### 6.2 레이아웃

```text
┌──────────────────────────────────────────────────────────────┐
│ 새 프로젝트 생성                                              │
├──────────────────────────────────────────────────────────────┤
│ Process: 제품 Alpha Main Route / product_alpha_main           │
│ Layer: 87개 | Parameter: 198개 | 예상 셀: 17,226개             │
├──────────────────────────────────────────────────────────────┤
│ 프로젝트 이름 [________________________]                       │
│ 설명           [________________________]                       │
├──────────────────────────────────────────────────────────────┤
│ Layer Preview                                                 │
│ order | layer key | layer name | type | source value status    │
├──────────────────────────────────────────────────────────────┤
│ Mapping/Backbone Check                                        │
│ - source parameter mapping 누락 n건                            │
│ - 조건 값 없음 n건                                             │
│ - 생성 후 draft 상태로 시작                                    │
├──────────────────────────────────────────────────────────────┤
│ [취소]                                      [프로젝트 생성]    │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 Phase 1 완료 기준 연결

- 서로 다른 process로 프로젝트를 만들면 서로 다른 layer 구조가 `sheet_layer`로 복사되어야 한다.
- 백본 복사 결과가 `cell_value`에 반영되어야 한다.
- source parameter mapping 누락이 있으면 생성 가능/불가 정책을 명시한다.

## 7. Sheet Editor 그리드 PoC 와이어프레임

### 7.1 목적

100개 미만 layer × 약 200 parameter 규모에서 편집, 스크롤, 검색, Excel 붙여넣기가 가능한지 검증한다.

### 7.2 레이아웃

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Project: 제품 Alpha 조건표                         [저장] [검증]     │
│ 상태: Draft | Lock: 내가 편집 중 | 변경 n건                          │
├──────────────────────────────────────────────────────────────────────┤
│ [전체] [Photo] [Etch] [계측] [Deposition]   검색 [layer/parameter]    │
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
GET /processes?query=&limit=&cursor=
GET /processes/{process_key}
GET /processes/{process_key}/layers
POST /projects
GET /projects
GET /projects/{project_id}
```

Phase 2에서는 sheet editor를 위해 다음 계약을 추가한다.

```text
GET /projects/{project_id}/sheet
PATCH /projects/{project_id}/cells
POST /projects/{project_id}/paste-preview
POST /projects/{project_id}/validate
```

## 9. 결정 보류 항목

- `Layer` 명칭을 계속 쓸지, UI에서는 `Step`을 병기할지 결정한다.
- process 검색 필터의 실제 속성은 적재 DB 스키마 확정 후 정한다.
- source parameter mapping 누락 시 프로젝트 생성을 막을지, 경고 후 생성할지 정한다.
- 그리드 라이브러리는 Phase 1 PoC 결과로 확정한다.
