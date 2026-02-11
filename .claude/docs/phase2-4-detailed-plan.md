# PCM Phase 2~4 상세 기획

> Phase 1 (핵심 편집 MVP) 완료 후 순차 진행
> 각 Phase는 독립 배포 가능한 단위

---

## Phase 2: 데이터 입력 자동화

**목표**: 수작업 데이터 입력을 최소화
**전제조건**: Phase 1 완료 (프로젝트 생성, 조건표 편집, 기본 검증)

### 2.1 기능 목록

| # | 기능 | 설명 | 우선순위 |
|---|------|------|----------|
| 2-1 | 레이어별 backbone 교체 | 특정 레이어에 다른 제품의 조건을 적용 | 필수 |
| 2-2 | 신규 레이어 추가/삭제 | 빈 행 추가 또는 backbone에서 가져오기 | 필수 |
| 2-3 | Recipe XML 업로드 | 단일/다중 XML 파일 업로드 | 필수 |
| 2-4 | Recipe 파싱 + diff | XML → 컬럼 매핑 후 현재값과 비교 | 필수 |
| 2-5 | Recipe diff 선택 적용 | 항목별 적용/무시 + 일괄 적용 | 필수 |
| 2-6 | 관리자: XML 매핑 설정 | XPath ↔ 컬럼명 매핑 CRUD | 필수 |
| 2-7 | 관리자: 검증 규칙 설정 | 컬럼별 검증 규칙 편집 UI | 필수 |
| 2-8 | 관리자: 카테고리 그룹핑 | 컬럼 → 카테고리 배정 관리 | 선택 |
| 2-9 | 조건부 필수 검증 | Adhesion Use=Y → Type 필수 등 | 필수 |
| 2-10 | Revision 생성 | Approved → 새 버전(v2,v3) Draft 생성 | 필수 |
| 2-11 | Archived 상태 | 이전 버전 읽기전용 보존 | 필수 |
| 2-12 | 목록 최신 버전 필터 | 제품별 최신 버전만 목록에 표시 | 필수 |

> **Revision 상세 설계**: `revision-feature-design.md` 참조

### 2.2 신규 API 엔드포인트

```
# Backbone 교체
PUT   /api/projects/{id}/layers/{layerId}/backbone
      Body: { "source_product_id": 5, "source_layer_name": "AA_PHOTO" }
      → 해당 레이어의 conditions + backbone_conditions 교체
      → change_log에 change_type='backbone' 기록

# 레이어 추가/삭제
POST  /api/projects/{id}/layers
      Body: { "layer_name": "NEW_LAYER", "source_product_id": 5, "source_layer_name": "AA_PHOTO" }
      → 빈 레이어 또는 backbone에서 복사하여 추가

DELETE /api/projects/{id}/layers/{layerId}
      → 삭제 (Draft 상태에서만)

# Recipe XML
POST  /api/projects/{id}/recipe/upload
      Body: multipart/form-data (XML 파일 1~N개)
      → 파싱 결과 반환 (diff 목록)

POST  /api/projects/{id}/recipe/apply
      Body: { "changes": [
        { "project_layer_id": 1, "column_name": "SP_PREBAKE_TEMP_C", "new_value": 115 },
        ...
      ]}
      → 선택된 항목만 conditions에 반영 + change_log(change_type='recipe')

# 관리자: XML 매핑
GET   /api/admin/recipe-mappings
POST  /api/admin/recipe-mappings
PUT   /api/admin/recipe-mappings/{id}
DELETE /api/admin/recipe-mappings/{id}

# 관리자: 검증 규칙
GET   /api/admin/columns                        # 전체 컬럼 + 검증 규칙
PUT   /api/admin/columns/{id}/validations       # 검증 규칙 업데이트
POST  /api/admin/columns/validations/bulk       # Excel 업로드로 일괄 설정
```

### 2.3 Recipe diff 화면 설계

```
┌─────────────────────────────────────────────────────────┐
│  Recipe 반영 — AA_PHOTO                    [전체적용] [닫기] │
├─────────┬────────────┬────────────┬────────┬───────────┤
│ 컬럼명   │ 현재값      │ Recipe값    │ 차이    │ 적용      │
├─────────┼────────────┼────────────┼────────┼───────────┤
│ PR Type │ KrF-A01    │ KrF-A01    │ 동일    │ —         │
│ Spin1   │ 1500       │ 1800  ▲    │ +300   │ [✓ 적용]  │
│ Prebake │ 110        │ 115   ▲    │ +5     │ [✓ 적용]  │
│ Energy  │ 35.5       │ 33.8  ▼    │ -1.7   │ [  무시]  │
│ Focus   │ 0.025      │ 0.025      │ 동일    │ —         │
└─────────┴────────────┴────────────┴────────┴───────────┘
  ℹ 매핑된 20개 파라미터 중 3개 차이 발견
  [선택 항목 적용] [전체 적용] [취소]
```

**동작 흐름**:
1. XML 업로드 → 백엔드에서 파싱 + 매핑
2. 매핑 실패 항목 경고 표시 (알 수 없는 XPath 등)
3. diff 테이블에서 변경 항목만 하이라이트
4. "동일"인 항목은 기본 숨김 (토글로 전체 표시 가능)
5. 적용 클릭 → `POST /recipe/apply` → 그리드 즉시 반영 + 초록색 셀

### 2.4 Backbone 교체 화면 설계

```
┌──────────────────────────────────────────────┐
│  Backbone 교체 — POLY_PHOTO                   │
├──────────────────────────────────────────────┤
│                                              │
│  현재 backbone: PROD-2024X                    │
│                                              │
│  새 backbone 제품: [검색/선택 ▼]               │
│  ┌─ PROD-2024X (45 layers) — 현재            │
│  │  PROD-2024Y (52 layers)                   │
│  │  PROD-2024Z (38 layers)                   │
│  └──────────────────────────                 │
│                                              │
│  소스 레이어: [POLY_PHOTO ▼]                   │
│  (자동 매칭, 수동 변경 가능)                     │
│                                              │
│  ⚠ 현재 편집 중인 변경사항 3건이 덮어쓰기됩니다   │
│                                              │
│            [취소]  [교체 실행]                  │
└──────────────────────────────────────────────┘
```

**동작 흐름**:
1. 레이어 네비게이션에서 우클릭 → "Backbone 교체" 메뉴
2. 제품 검색 → 동일 이름 레이어 자동 매칭
3. 매칭 실패 시 수동 레이어 선택 드롭다운
4. 교체 시 conditions + backbone_conditions 모두 갱신
5. 기존 편집분(dirty cells)은 경고 후 덮어쓰기

### 2.5 관리자 설정 화면

**2.5.1 XML 매핑 관리**

```
┌─────────────────────────────────────────────────────────┐
│  관리자 > Recipe XML 매핑                    [+ 추가] │
├─────────────────┬─────────────────┬──────┬─────┬───────┤
│ XML XPath        │ 조건표 컬럼      │ 카테고리│ 타입 │ 액션  │
├─────────────────┼─────────────────┼──────┼─────┼───────┤
│ /Recipe/Coat...  │ SP_PR_TYPE      │ SP   │ STR │ [편집]│
│ /Recipe/Coat...  │ SP_SPIN1_SPEED  │ SP   │ INT │ [편집]│
│ /Recipe/Bake...  │ SP_PREBAKE_TEMP │ SP   │ INT │ [편집]│
│ ...              │                 │      │     │       │
└─────────────────┴─────────────────┴──────┴─────┴───────┘
  총 45개 매핑 | [Excel 다운로드] [Excel 업로드]
```

**2.5.2 검증 규칙 관리**

```
┌─────────────────────────────────────────────────────────┐
│  관리자 > 검증 규칙                     [Excel 일괄 설정] │
├──────────────┬──────┬──────┬──────┬──────────┬──────────┤
│ 컬럼명        │ 타입  │ 필수 │ 범위  │ 조건부 필수 │ 에러 메시지│
├──────────────┼──────┼──────┼──────┼──────────┼──────────┤
│ SP_PR_TYPE   │ select│ ✓   │ —    │ —        │ PR Type… │
│ SP_PREBAKE_  │ int  │ ✓   │ 0~300│ —        │ Prebake… │
│ SP_ADHESION_ │ select│     │ —    │ ADHESION │ Adhesion…│
│              │      │     │      │ _USE=Y   │          │
└──────────────┴──────┴──────┴──────┴──────────┴──────────┘
```

### 2.6 태스크 리스트

| # | 태스크 | 의존 | 예상 공수 |
|---|--------|------|----------|
| 2.1 | Backbone 교체 API (`PUT /layers/{id}/backbone`) | Phase 1 | 1일 |
| 2.2 | Backbone 교체 UI (컨텍스트 메뉴 + 모달) | 2.1 | 1일 |
| 2.3 | 레이어 추가/삭제 API + UI | Phase 1 | 1일 |
| 2.4 | Recipe XML 파싱 서비스 (lxml + 매핑 조회) | Phase 1 | 2일 |
| 2.5 | Recipe 업로드 API (`POST /recipe/upload`) | 2.4 | 0.5일 |
| 2.6 | Recipe diff UI (모달 + diff 테이블) | 2.5 | 2일 |
| 2.7 | Recipe 적용 API (`POST /recipe/apply`) | 2.4 | 0.5일 |
| 2.8 | Recipe 적용 → 그리드 반영 + 초록 셀 | 2.6, 2.7 | 1일 |
| 2.9 | 관리자 라우트 + 레이아웃 | Phase 1 | 0.5일 |
| 2.10 | XML 매핑 CRUD API | Phase 1 | 1일 |
| 2.11 | XML 매핑 관리 UI | 2.9, 2.10 | 1일 |
| 2.12 | 검증 규칙 CRUD API | Phase 1 | 1일 |
| 2.13 | 검증 규칙 관리 UI (인라인 편집) | 2.9, 2.12 | 1.5일 |
| 2.14 | 검증 규칙 Excel 일괄 업로드 | 2.12 | 1일 |
| 2.15 | 조건부 필수 검증 로직 (프론트+백엔드) | 2.12 | 1.5일 |
| 2.16 | 통합 테스트 + 버그 수정 | 전체 | 2일 |
| 2.17 | DB 마이그레이션 (revision, parent_project_id, is_latest) | Phase 1 | 0.5일 |
| 2.18 | Revision 생성 API (`POST /projects/{id}/revise`) | 2.17 | 1일 |
| 2.19 | 프로젝트 목록 API 수정 (is_latest 필터) | 2.17 | 0.5일 |
| 2.20 | 프로젝트 목록 UI (버전 표시 + 히스토리 링크) | 2.19 | 0.5일 |
| 2.21 | 개정판 만들기 모달 | 2.18 | 0.5일 |
| 2.22 | Archived 상태 처리 (읽기전용) | 2.17 | 0.5일 |
| | **합계** | | **~21.5일** |

### 2.7 DB 변경사항

Phase 1 스키마 기준 추가/변경 없음. 이미 다음 테이블이 존재:
- `recipe_xml_mappings` — XML 매핑
- `column_validations` — 검증 규칙 (JSONB rule_config)
- `change_logs.change_type` — 'manual' | 'backbone' | 'recipe'

**조건부 필수 검증 rule_config 예시**:
```json
{
  "rule_type": "conditional_required",
  "rule_config": {
    "condition_column": "SP_ADHESION_USE",
    "condition_value": "Y",
    "operator": "equals"
  },
  "error_message": "Adhesion Use가 Y일 때 Adhesion Type은 필수입니다"
}
```

---

## Phase 3: 워크플로우 및 출력

**목표**: 업무 프로세스 전체를 시스템화
**전제조건**: Phase 2 완료

### 3.1 기능 목록

| # | 기능 | 설명 | 우선순위 |
|---|------|------|----------|
| 3-1 | Review 요청 | Draft → Review 상태 전환 (검증 0건 필수) | 필수 |
| 3-2 | 승인/반려 | 검토자의 Approved/Rejected 처리 | 필수 |
| 3-3 | 반려 코멘트 | 셀/레이어 단위 코멘트 + 위치 연동 | 필수 |
| 3-4 | Review 읽기전용 모드 | Review 상태에서 편집 비활성화 | 필수 |
| 3-5 | 변경 이력 패널 | 전체 타임라인 + 셀 단위 이력 조회 | 필수 |
| 3-6 | 전산 출력 — Type A | 1행 1레이어 가로형 Excel 생성 | 필수 |
| 3-7 | 전산 출력 — Type B | 설비구분 다행 Excel 생성 | 필수 |
| 3-8 | 전산 출력 — Type C | 키-밸류 세로전치 Excel 생성 | 필수 |
| 3-9 | 전산 출력 UI | 전산 선택 + 미리보기 + 다운로드 | 필수 |
| 3-10 | 상태 전환 이력 | Draft→Review→Approved 이력 기록 | 필수 |
| 3-11 | 알림 (선택) | Review 요청/승인/반려 시 알림 | 선택 |

### 3.2 신규 API 엔드포인트

```
# 상태 전환 (Phase 1에서 PATCH /status 존재, 여기서 확장)
PATCH /api/projects/{id}/status
      Body: { "new_status": "review", "changed_by": 1 }
      → review: 검증 0건 체크
      → approved: reviewer 권한 체크
      → rejected: 코멘트 필수

# 코멘트
POST  /api/projects/{id}/comments
      Body: {
        "user_id": 2,
        "project_layer_id": 5,        // optional (레이어 지정)
        "column_name": "SP_PREBAKE_TEMP_C",  // optional (셀 지정)
        "content": "이 온도 확인 필요합니다",
        "comment_type": "rejection"    // rejection | general
      }

GET   /api/projects/{id}/comments
      → 전체 코멘트 목록 (위치 정보 포함)

# 변경 이력
GET   /api/projects/{id}/changelog
      Query: ?layer_id=5&column_name=SP_PREBAKE_TEMP_C&page=1&limit=50
      → 필터링 가능한 변경 이력

GET   /api/projects/{id}/changelog/timeline
      → 시간순 전체 이력 (상태 전환 + 셀 변경 통합)

# 전산 출력
GET   /api/export/systems
      → 전산 시스템 목록 + 포맷 유형

POST  /api/projects/{id}/export
      Body: { "system_ids": [1, 2, 3] }
      → Excel 파일 생성 + 다운로드 URL 반환

GET   /api/projects/{id}/export/preview/{systemId}
      → 변환 결과 미리보기 (JSON, 첫 5행)
```

### 3.3 승인 프로세스 화면

**3.3.1 Review 요청 (편집자)**

```
┌──────────────────────────────────────────────┐
│  Review 요청                                  │
├──────────────────────────────────────────────┤
│                                              │
│  ✅ 검증 결과: 오류 0건                        │
│  📊 변경 요약:                                │
│     • 변경된 레이어: 8 / 45                    │
│     • 변경된 셀: 23개                          │
│     • Backbone 교체: 3개 레이어                 │
│     • Recipe 반영: 2개 레이어                   │
│                                              │
│  메모 (선택):                                  │
│  ┌──────────────────────────────────────┐     │
│  │ M1~M3 레이어 Energy 값 재확인 부탁드립니다 │     │
│  └──────────────────────────────────────┘     │
│                                              │
│            [취소]  [Review 요청]               │
└──────────────────────────────────────────────┘
```

**3.3.2 검토자 뷰**

```
┌─────────────────────────────────────────────────────────┐
│  PROD-2025A  상태: Review       검토자: 박엔지니어        │
│  ← 목록                         [승인] [반려]            │
├──────────┬──────────────────────────────────────────────┤
│          │  [SP] [SC] [OVL] [DEV]  |  📝 코멘트 3건     │
│ Layers   ├──────────────────────────────────────────────┤
│          │                                              │
│ AA_PHOTO │  (읽기 전용 그리드 — 셀 클릭 시 코멘트 추가)   │
│ GATE     │  노란색=변경, 초록=Recipe, 빨간=검토코멘트     │
│ POLY  📝1│                                              │
│ ...      │                                              │
├──────────┴──────────────────────────────────────────────┤
│  코멘트 패널:                                             │
│  📝 POLY_PHOTO → SP_PREBAKE_TEMP: "이 온도 확인 필요"    │
│  📝 M1_PHOTO → SC_ENERGY: "Recipe와 5mJ 차이 확인"      │
│  📝 전체: "OVL Spec 전반적으로 재확인 부탁"                │
└─────────────────────────────────────────────────────────┘
```

**검토자 동작**:
- 그리드는 읽기 전용 (셀 편집 불가)
- 셀 우클릭 → "코멘트 추가" → 해당 위치에 코멘트 생성
- 코멘트가 있는 셀: 빨간 삼각형 마커 표시
- 코멘트 패널에서 클릭 → 해당 셀로 이동

**반려 시**:
1. 코멘트 1건 이상 필수 (또는 전체 코멘트)
2. 상태 → Rejected → 편집자에게 코멘트 위치 하이라이트
3. 편집자가 Draft로 돌아가서 코멘트 확인 + 수정

### 3.4 변경 이력 패널

```
┌─────────────────────────────────────────────────────────┐
│  변경 이력                             [필터 ▼] [닫기]  │
├─────────────────────────────────────────────────────────┤
│  ─── 2025-02-10 ───                                     │
│                                                         │
│  14:30  김엔지니어  상태 변경                              │
│         Draft → Review                                   │
│                                                         │
│  14:25  김엔지니어  수동 편집  AA_PHOTO                    │
│         SP_PREBAKE_TEMP: 110 → 115                       │
│         SP_SPIN1_SPEED: 1500 → 1800                      │
│                                                         │
│  13:50  김엔지니어  Recipe 반영  AA_PHOTO                  │
│         SP_PR_THICK: 800 → 850                           │
│         SC_ENERGY: 35.5 → 33.8                           │
│                                                         │
│  11:00  김엔지니어  Backbone 교체  VIA2_PHOTO              │
│         PROD-2024X → PROD-2024Y (전체 컬럼 교체)          │
│                                                         │
│  10:30  김엔지니어  프로젝트 생성                           │
│         Backbone: PROD-2024X (45 layers)                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.5 전산 출력 화면

```
┌─────────────────────────────────────────────────────────┐
│  전산 입력용 테이블 출력          PROD-2025A (Approved)   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  출력 대상 선택:                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ ☑ MES-TRACK    (Type A, SP+DEV, 12컬럼)         │    │
│  │ ☑ EQP-SCANNER  (Type B, SC, 8컬럼×3설비)        │    │
│  │ ☑ SPC-OVL      (Type C, OVL, 14파라미터)        │    │
│  │ ☐ MES-COATER   (Type A, SP) — 포맷 미정         │    │
│  │ ☐ ...                                           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  미리보기: MES-TRACK (Type A)                            │
│  ┌─────────┬──────────┬───────────┬──────────┬────┐    │
│  │ LAYER_ID│RESIST_CODE│COAT_SPEED1│PAB_TEMP  │... │    │
│  ├─────────┼──────────┼───────────┼──────────┼────┤    │
│  │AA_PHOTO │KrF-A01   │1800       │115       │... │    │
│  │GATE_    │ArF-C01   │2000       │120       │... │    │
│  └─────────┴──────────┴───────────┴──────────┴────┘    │
│  ... 45행 중 2행 표시                                    │
│                                                         │
│         [선택 전산 일괄 다운로드 (Excel)]                  │
└─────────────────────────────────────────────────────────┘
```

**출력 로직** (백엔드 서비스):

```python
# services/export_service.py 핵심 로직

class ExportService:
    def generate(self, project_id, system_id) -> bytes:
        system = get_export_system(system_id)
        mappings = get_column_mappings(system_id)
        layers = get_project_layers(project_id)

        if system.format_type == "TYPE_A":
            return self._type_a(layers, mappings)
        elif system.format_type == "TYPE_B":
            return self._type_b(layers, mappings)
        elif system.format_type == "TYPE_C":
            return self._type_c(layers, mappings)

    def _type_a(self, layers, mappings):
        # 1행 = 1레이어, 컬럼 = 매핑된 컬럼만
        # source_column → target_column 변환
        rows = []
        for layer in layers:
            row = {"LAYER_ID": layer.name, "PRODUCT_ID": ...}
            for m in mappings:
                row[m.target_column] = layer.conditions.get(m.source_column)
            rows.append(row)
        return to_excel(rows)

    def _type_b(self, layers, mappings):
        # 1레이어 × N설비 = N행
        # equipment_assignments 테이블에서 설비 목록 조회
        # 설비별 파라미터 차이 적용

    def _type_c(self, layers, mappings):
        # 1레이어의 컬럼을 행으로 전치
        # LAYER_ID | PARAM_KEY | PARAM_VALUE | UNIT
```

### 3.6 태스크 리스트

| # | 태스크 | 의존 | 예상 공수 |
|---|--------|------|----------|
| 3.1 | Review 읽기전용 모드 (그리드 편집 비활성화) | Phase 2 | 0.5일 |
| 3.2 | 상태 전환 API 확장 (권한 체크, 검증 체크) | Phase 2 | 1일 |
| 3.3 | Review 요청 모달 (변경 요약 + 메모) | 3.2 | 1일 |
| 3.4 | 코멘트 API (CRUD) | Phase 2 | 1일 |
| 3.5 | 코멘트 UI — 셀 우클릭 추가 + 마커 표시 | 3.4 | 2일 |
| 3.6 | 코멘트 패널 (목록 + 클릭→셀 이동) | 3.5 | 1일 |
| 3.7 | 승인/반려 UI + 반려 시 코멘트 필수 | 3.4 | 1일 |
| 3.8 | 반려 후 편집자 뷰 (코멘트 하이라이트) | 3.7 | 1일 |
| 3.9 | 변경 이력 API (타임라인 + 필터) | Phase 2 | 1일 |
| 3.10 | 변경 이력 패널 UI | 3.9 | 1.5일 |
| 3.11 | 상태 전환 이력 기록 + 표시 | 3.2 | 0.5일 |
| 3.11b | 버전 히스토리 API + 패널 UI | 3.9 | 1.5일 |
| 3.12 | 전산 출력 서비스 — Type A | Phase 2 | 1.5일 |
| 3.13 | 전산 출력 서비스 — Type B | 3.12 | 2일 |
| 3.14 | 전산 출력 서비스 — Type C | 3.12 | 1.5일 |
| 3.15 | 전산 출력 API + Excel 생성 (openpyxl) | 3.12~14 | 1일 |
| 3.16 | 전산 출력 UI (선택 + 미리보기 + 다운로드) | 3.15 | 2일 |
| 3.17 | 통합 테스트 + 버그 수정 | 전체 | 2일 |
| | **합계** | | **~21일** |

### 3.7 DB 변경사항

Phase 1 스키마에 이미 포함된 테이블:
- `review_comments` — 코멘트 (project_layer_id, column_name, content)
- `project_status_logs` — 상태 전환 이력
- `export_systems` / `export_column_mappings` — 전산 출력 설정

**추가 필요**:
```sql
-- review_comments에 comment_type 컬럼 추가 (이미 존재하면 스킵)
-- 'rejection' | 'general' | 'resolved'
ALTER TABLE review_comments
  ADD COLUMN IF NOT EXISTS comment_type VARCHAR(20) DEFAULT 'general';

-- 코멘트 해결 상태 추가
ALTER TABLE review_comments
  ADD COLUMN IF NOT EXISTS is_resolved BOOLEAN DEFAULT FALSE;
  ADD COLUMN IF NOT EXISTS resolved_by INTEGER REFERENCES users(id);
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;
```

---

## Phase 4: 고도화

**목표**: 전체 커버리지 및 운영 안정화
**전제조건**: Phase 3 완료

### 4.1 기능 목록

| # | 기능 | 설명 | 우선순위 |
|---|------|------|----------|
| 4-1 | 레이어 간 논리적 모순 검증 | 크로스 레이어 규칙 엔진 | 필수 |
| 4-2 | 전산 출력 포맷 확장 | 나머지 7개 전산 config 완성 | 필수 |
| 4-3 | 사용자 인증 | JWT 또는 세션 기반 로그인 | 필수 |
| 4-4 | 역할 기반 권한 관리 | editor/reviewer/admin 분리 | 필수 |
| 4-5 | 사용자 관리 UI | 관리자의 사용자 CRUD | 필수 |
| 4-6 | 대시보드 | 프로젝트 현황, 통계 | 선택 |
| 4-7 | 데이터 비교 뷰 | 2개 제품 조건표 나란히 비교 | 선택 |
| 4-8 | 감사 로그 강화 | 로그인, API 호출 기록 | 선택 |
| 4-9 | 백업/복원 | 프로젝트 스냅샷 저장/복원 | 선택 |

### 4.2 레이어 간 검증 (Cross-Layer Validation)

**규칙 유형 예시**:

| 규칙 | 설명 | 예시 |
|------|------|------|
| 참조 레이어 존재 | OVL의 REF_LAYER가 실제 존재하는 레이어인지 | OVL_REF_LAYER = "AA_PHOTO" → AA_PHOTO 레이어 존재 확인 |
| 상위 레이어 의존 | 하위 레이어가 상위보다 큰 값 불가 | M2_ENERGY > M1_ENERGY 이면 경고 |
| 설비 호환성 | 동일 설비에 배정된 레이어 간 조건 호환 | 같은 Scanner에 배정된 레이어의 Illum Mode 동일 확인 |

**rule_config 구조**:
```json
{
  "rule_type": "cross_layer",
  "rule_config": {
    "check_type": "reference_exists",
    "source_column": "OVL_REF_LAYER",
    "target": "layer_names"
  },
  "error_message": "참조 레이어 '{value}'가 프로젝트에 존재하지 않습니다"
}
```

```json
{
  "rule_type": "cross_layer",
  "rule_config": {
    "check_type": "compare_layers",
    "column": "SC_EXPOSE_ENERGY_mJ",
    "operator": "<=",
    "reference_layer_column": "OVL_REF_LAYER",
    "threshold_ratio": 1.5
  },
  "error_message": "Energy가 참조 레이어 대비 1.5배를 초과합니다"
}
```

### 4.3 인증/권한 시스템

**인증 방식**: JWT (사내망 전용이므로 간단하게)

```
POST /api/auth/login
     Body: { "employee_id": "A12345", "password": "..." }
     → { "access_token": "...", "user": { "id": 1, "name": "김엔지니어", "role": "editor" } }

POST /api/auth/logout

GET  /api/auth/me
     → 현재 사용자 정보
```

**권한 매트릭스**:

| 기능 | editor | reviewer | admin |
|------|--------|----------|-------|
| 프로젝트 생성 | ✅ | ❌ | ✅ |
| 조건표 편집 (Draft) | ✅ | ❌ | ✅ |
| Review 요청 | ✅ | ❌ | ✅ |
| 승인/반려 | ❌ | ✅ | ✅ |
| 코멘트 추가 | ✅ | ✅ | ✅ |
| 전산 출력 | ✅ | ✅ | ✅ |
| 관리자 설정 | ❌ | ❌ | ✅ |
| 사용자 관리 | ❌ | ❌ | ✅ |

**구현 방식**:
```python
# FastAPI 미들웨어
from fastapi import Depends

def require_role(*roles):
    async def checker(user = Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(403, "권한 없음")
        return user
    return checker

@router.patch("/projects/{id}/status")
async def change_status(
    ...,
    user = Depends(require_role("editor", "admin"))  # review 요청
):
    if new_status in ("approved", "rejected"):
        require_role("reviewer", "admin")(user)  # 승인/반려
```

### 4.4 대시보드

```
┌─────────────────────────────────────────────────────────┐
│  PCM 대시보드                                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ Draft   │ │ Review  │ │Approved │ │Rejected │      │
│  │   12    │ │    3    │ │   45    │ │    1    │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│                                                         │
│  내 프로젝트 (최근 활동)                                  │
│  ┌──────────┬────────┬─────────┬──────────────┐        │
│  │ 제품명    │ 상태   │ 오류    │ 마지막 수정   │        │
│  │PROD-2025A│ Draft  │ 3건    │ 5분 전        │        │
│  │PROD-2025B│ Review │ 0건    │ 2시간 전      │        │
│  └──────────┴────────┴─────────┴──────────────┘        │
│                                                         │
│  Review 대기 (검토자용)                                   │
│  ┌──────────┬────────┬──────────┬──────────────┐       │
│  │ 제품명    │ 요청자  │ 변경 셀  │ 요청일        │       │
│  │PROD-2025C│ 이엔지  │ 15건    │ 오늘 14:00   │       │
│  └──────────┴────────┴──────────┴──────────────┘       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.5 데이터 비교 뷰

```
┌─────────────────────────────────────────────────────────┐
│  제품 비교: PROD-2025A vs PROD-2024X                     │
│  필터: [차이 있는 셀만] [카테고리: SP ▼]                   │
├────────┬──────────────────┬──────────────────┬──────────┤
│ Layer  │ PROD-2025A       │ PROD-2024X       │ 차이     │
│ /Column│ (신규)            │ (backbone)       │          │
├────────┼──────────────────┼──────────────────┼──────────┤
│AA_PHOTO│                  │                  │          │
│ Prebake│ 115              │ 110              │ +5       │
│ Spin1  │ 1800             │ 1500             │ +300     │
│GATE    │                  │                  │          │
│ Energy │ 42.0             │ 42.0             │ 동일     │
└────────┴──────────────────┴──────────────────┴──────────┘
  차이 요약: 45개 레이어 중 8개 레이어에서 23개 셀 변경
```

### 4.6 태스크 리스트

| # | 태스크 | 의존 | 예상 공수 |
|---|--------|------|----------|
| 4.1 | JWT 인증 미들웨어 + 로그인 API | Phase 3 | 1.5일 |
| 4.2 | 로그인 UI + 토큰 관리 | 4.1 | 1일 |
| 4.3 | 역할 기반 권한 미들웨어 | 4.1 | 1일 |
| 4.4 | 사용자 관리 API + UI | 4.3 | 2일 |
| 4.5 | 기존 API에 권한 체크 적용 | 4.3 | 1일 |
| 4.6 | Cross-layer 검증 엔진 | Phase 3 | 3일 |
| 4.7 | Cross-layer 규칙 설정 UI | 4.6 | 2일 |
| 4.8 | 전산 출력 Config #4~#10 작성 | Phase 3 | 3일 |
| 4.9 | Type B 설비 배정 데이터 관리 | 4.8 | 2일 |
| 4.10 | 대시보드 API (집계 쿼리) | Phase 3 | 1일 |
| 4.11 | 대시보드 UI | 4.10 | 2일 |
| 4.12 | 데이터 비교 뷰 API + UI | Phase 3 | 3일 |
| 4.13 | 프로젝트 스냅샷 백업/복원 | Phase 3 | 2일 |
| 4.14 | 감사 로그 미들웨어 | 4.1 | 1일 |
| 4.15 | 통합 테스트 + 버그 수정 | 전체 | 3일 |
| | **합계** | | **~28일** |

### 4.7 DB 추가 테이블

```sql
-- 프로젝트 스냅샷 (백업용)
CREATE TABLE project_snapshots (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id),
    snapshot_data JSONB NOT NULL,        -- 전체 project_layers 스냅샷
    description VARCHAR(200),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 설비 배정 (Type B 출력용)
CREATE TABLE equipment_assignments (
    id SERIAL PRIMARY KEY,
    product_layer_id INTEGER REFERENCES product_layers(id),
    equipment_id VARCHAR(50) NOT NULL,
    equipment_params JSONB,              -- 설비별 파라미터 오버라이드
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 감사 로그
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,         -- login, api_call, export, etc.
    resource_type VARCHAR(50),           -- project, layer, etc.
    resource_id INTEGER,
    details JSONB,
    ip_address INET,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
```

---

## 전체 로드맵 요약

| Phase | 목표 | 태스크 수 | 예상 공수 (1인) | 누적 |
|-------|------|----------|----------------|------|
| **1** | 핵심 편집 MVP | 25 | ~4주 | 4주 |
| **2** | 데이터 입력 자동화 + Revision | 22 | ~4.5주 | 8.5주 |
| **3** | 워크플로우 + 출력 | 17 | ~4주 | 12.5주 |
| **4** | 고도화 | 15 | ~5.5주 | 18주 |

**총 예상**: 약 4.5~5개월 (1인 기준, 풀타임 개발 시)

### Phase별 완료 기준 (DoD)

**Phase 2 DoD**:
- 레이어 네비게이션에서 우클릭 → backbone 교체 동작
- Recipe XML 업로드 → diff 확인 → 선택 적용 → 초록 셀 표시
- 관리자 페이지에서 XML 매핑 / 검증 규칙 편집 가능
- 조건부 필수 검증 동작 (Adhesion Use=Y → Type 필수)
- Approved 조건표에서 "개정판 만들기" → 새 버전 Draft 생성
- 프로젝트 목록에 제품별 최신 버전만 표시, 이전 버전 Archived

**Phase 3 DoD**:
- Draft → Review → Approved 전체 플로우 동작
- 검토자가 셀에 코멘트 → 반려 → 편집자 코멘트 위치 확인
- 주요 3개 전산 (MES-TRACK, EQP-SCANNER, SPC-OVL) Excel 다운로드
- 변경 이력 타임라인 조회
- 제품별 버전 히스토리 패널 (v1, v2, v3 조회 + 이전 버전 읽기)

**Phase 4 DoD**:
- 로그인/로그아웃 + 역할별 접근 제어 동작
- Cross-layer 검증 규칙 최소 3개 적용
- 10개 전산 시스템 config 완성 + 출력 동작
- 대시보드에서 전체 현황 한눈에 파악
- 버전 간 diff 비교 뷰 (v2 vs v1 차이 확인)

---

## 미결 사항 (Phase 진행 중 결정)

| 항목 | 관련 Phase | 결정 시점 |
|------|-----------|----------|
| 인증 방식 (JWT vs Session) | 4 | Phase 3 완료 시점 |
| Type B 설비 배정 데이터 소스 | 3~4 | Phase 3 전산 출력 구현 시 |
| Cross-layer 검증 규칙 구체 케이스 | 4 | 현장 케이스 수집 후 |
| 알림 방식 (이메일 vs 웹 알림) | 3~4 | Phase 3 승인 구현 시 |
| 상태관리 라이브러리 (Zustand vs Redux) | 1~2 | Phase 1 PoC 후 |
