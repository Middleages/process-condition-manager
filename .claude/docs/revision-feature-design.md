# PCM Revision(개정) 기능 설계

> Phase 2~4 기획 보충 문서
> 기존 phase2-4-detailed-plan.md와 함께 참조

---

## 1. 개념

### 1.1 핵심 규칙

- Approved 조건표를 수정해야 할 때 → **새 Revision(v2, v3, ...) 생성**
- 원본은 그대로 보존 (수정 불가, 읽기전용)
- **프로젝트 목록에는 제품별 최신 버전만 표시**
- 이전 버전은 "버전 히스토리"에서 조회

### 1.2 상태 흐름 (확장)

```
신규 프로젝트 생성 (backbone 복사)
         │
         ▼
      Draft (v1) ──────► Review ──────► Approved (v1)
         ▲                  │                 │
         │                  ▼                 │
         └──────────── Rejected               │
                                              │
         ┌────────── "개정판 만들기" ◄──────────┘
         │
         ▼
      Draft (v2) ──────► Review ──────► Approved (v2)
         ▲                  │                 │
         │                  ▼                 │ (v1은 archived)
         └──────────── Rejected               │
                                              │
         ┌────────── "개정판 만들기" ◄──────────┘
         ▼
      Draft (v3) ...
```

### 1.3 버전 간 관계

```
PROD-2025A
├── v1 (Approved → Archived)  ← 최초 생성, backbone: PROD-2024X
├── v2 (Approved → Archived)  ← v1 기반 개정, Recipe 최신화
└── v3 (Draft)                ← v2 기반 개정, 진행 중 ★ 목록에 표시
```

- `v1 Approved` → v2 생성 시 → v1 상태가 **Archived**로 변경
- 목록에는 v3(Draft)만 표시
- Archived 버전은 읽기전용, 삭제 불가, 히스토리에서만 조회

---

## 2. DB 변경

### 2.1 projects 테이블 수정

```sql
ALTER TABLE projects
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN parent_project_id INTEGER REFERENCES projects(id),
  ADD COLUMN is_latest BOOLEAN NOT NULL DEFAULT TRUE;

-- status enum에 'archived' 추가
-- 기존: draft, review, approved, rejected
-- 변경: draft, review, approved, rejected, archived

-- 제품별 최신 버전 빠르게 조회
CREATE INDEX idx_projects_product_latest
  ON projects(product_id, is_latest) WHERE is_latest = TRUE;

-- 제품별 버전 목록
CREATE INDEX idx_projects_product_revision
  ON projects(product_id, revision DESC);
```

### 2.2 필드 설명

| 필드 | 설명 |
|------|------|
| `revision` | 버전 번호 (1, 2, 3, ...). 제품 내에서 순차 증가 |
| `parent_project_id` | 이전 버전의 project_id. v1은 NULL |
| `is_latest` | 제품별 최신 버전 여부. 제품당 1개만 TRUE |

### 2.3 데이터 예시

| id | product_id | revision | status | is_latest | parent_project_id |
|----|-----------|----------|--------|-----------|-------------------|
| 1 | 10 | 1 | archived | FALSE | NULL |
| 5 | 10 | 2 | archived | FALSE | 1 |
| 12 | 10 | 3 | draft | TRUE | 5 |
| 3 | 11 | 1 | approved | TRUE | NULL |

---

## 3. API

### 3.1 Revision 생성

```
POST /api/projects/{id}/revise
     조건: 현재 프로젝트 status = 'approved'
     응답: 새 프로젝트 (revision = N+1, status = draft)

동작:
  1. 기존 프로젝트의 project_layers → 새 project_layers로 복사
     - conditions = 기존 approved의 conditions (편집용)
     - backbone_conditions = 기존 approved의 conditions (diff 기준 = 이전 승인본)
  2. 기존 프로젝트: status → 'archived', is_latest → FALSE
  3. 새 프로젝트: revision = N+1, is_latest → TRUE, parent_project_id = 기존 ID
  4. 응답으로 새 프로젝트 ID 반환 → 편집 페이지로 이동
```

**핵심 포인트**: 새 Revision에서의 backbone_conditions는 **직전 승인본의 conditions**. 이렇게 하면 "v2에서 뭐가 바뀌었는지"를 노란 하이라이트로 바로 볼 수 있음.

### 3.2 프로젝트 목록 (수정)

```
GET /api/projects
    기존: 전체 프로젝트 반환
    변경: is_latest = TRUE인 것만 반환 (제품별 최신 버전)

    응답에 revision 정보 추가:
    {
      "id": 12,
      "product_name": "PROD-2025A",
      "revision": 3,
      "status": "draft",
      "previous_versions": 2,   // 이전 버전 수 (히스토리 진입점)
      ...
    }
```

### 3.3 버전 히스토리

```
GET /api/products/{productId}/revisions
    → 해당 제품의 전체 버전 목록 (최신순)

    응답:
    [
      { "project_id": 12, "revision": 3, "status": "draft",
        "created_at": "2025-02-10", "created_by": "김엔지니어",
        "change_summary": "M1~M3 Energy 재설정" },
      { "project_id": 5,  "revision": 2, "status": "archived",
        "created_at": "2025-01-15", "created_by": "김엔지니어",
        "change_summary": "Recipe 최신화 반영" },
      { "project_id": 1,  "revision": 1, "status": "archived",
        "created_at": "2024-12-01", "created_by": "이엔지니어",
        "change_summary": null }
    ]
```

### 3.4 버전 간 비교

```
GET /api/projects/{id}/diff?compare_with={otherId}
    → 두 버전 간 차이 (레이어별 변경 셀 목록)

    응답:
    {
      "source": { "project_id": 12, "revision": 3 },
      "target": { "project_id": 5, "revision": 2 },
      "diff_count": 8,
      "layers": [
        {
          "layer_name": "M1_PHOTO",
          "changes": [
            { "column": "SC_ENERGY", "source_value": 38.0, "target_value": 35.5 },
            { "column": "SC_FOCUS", "source_value": 0.030, "target_value": 0.025 }
          ]
        }
      ]
    }
```

---

## 4. UI 변경

### 4.1 프로젝트 목록 — 버전 표시

```
┌────┬──────────────┬───────┬──────────┬───────┬─────┬──────────┬─────────┐
│ #  │ 제품명        │ 버전   │ Backbone │ 상태   │ 오류│ 수정일    │         │
├────┼──────────────┼───────┼──────────┼───────┼─────┼──────────┼─────────┤
│ 1  │ PROD-2025A   │ v3    │ PROD-24X │ Draft │ 3  │ 02-10    │ 편집 →  │
│    │              │ ⏱ v1,v2│          │       │    │          │         │
│ 2  │ PROD-2025B   │ v1    │ PROD-24X │ Appr. │ 0  │ 02-09    │ 보기 →  │
│ 3  │ PROD-2025C   │ v2    │ PROD-24Y │ Review│ 0  │ 02-08    │ 보기 →  │
│    │              │ ⏱ v1  │          │       │    │          │         │
└────┴──────────────┴───────┴──────────┴───────┴─────┴──────────┴─────────┘

  ⏱ = 이전 버전 있음 (클릭 시 히스토리 패널 열기)
```

- 버전 컬럼에 현재 revision 번호 (v1, v2, v3)
- 이전 버전이 있으면 아래에 작게 "⏱ v1,v2" 링크
- 클릭 시 히스토리 패널 또는 별도 페이지

### 4.2 편집기 상단바 — 개정판 만들기 버튼

```
┌─────────────────────────────────────────────────────────────────┐
│ ← 목록  PROD-2025A  v2 Approved  Backbone: PROD-2024X          │
│                                         [📋 개정판 만들기] [출력]│
└─────────────────────────────────────────────────────────────────┘
```

- Approved 상태일 때만 "개정판 만들기" 버튼 표시
- 클릭 → 확인 모달 → POST /revise → 새 버전 편집 페이지로 이동

### 4.3 개정판 생성 모달

```
┌──────────────────────────────────────────────┐
│  개정판 만들기                                 │
├──────────────────────────────────────────────┤
│                                              │
│  현재 버전: PROD-2025A v2 (Approved)          │
│  → 새 버전: PROD-2025A v3 (Draft)             │
│                                              │
│  현재 승인본을 기반으로 새 Draft를 생성합니다.   │
│  기존 v2는 읽기전용으로 보존됩니다.             │
│                                              │
│  개정 사유 (선택):                             │
│  ┌──────────────────────────────────────┐    │
│  │ M1~M3 Energy 값 Recipe 최신화 반영    │    │
│  └──────────────────────────────────────┘    │
│                                              │
│            [취소]  [생성]                      │
└──────────────────────────────────────────────┘
```

### 4.4 버전 히스토리 패널

```
┌─────────────────────────────────────────────────────────┐
│  PROD-2025A 버전 히스토리                        [닫기]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  v3  Draft      김엔지니어  2025-02-10                   │
│  │   "M1~M3 Energy 값 Recipe 최신화"                     │
│  │   변경: 8셀  │  [편집 →]  [v2와 비교]                  │
│  │                                                      │
│  v2  Archived   김엔지니어  2025-01-15  ── 2025-01-20    │
│  │   "Recipe 최신화 반영"                                │
│  │   변경: 15셀  │  [보기]  [v1과 비교]                   │
│  │                                                      │
│  v1  Archived   이엔지니어  2024-12-01  ── 2025-01-14    │
│      최초 생성 (Backbone: PROD-2024X)                    │
│      [보기]                                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- 각 버전의 상태, 생성자, 기간(승인일~다음 버전 생성일)
- "보기" → 읽기전용 편집기에서 해당 버전 열기
- "vN과 비교" → diff 뷰로 이동

### 4.5 편집기 — 이전 버전 대비 diff

새 Revision(v3)의 편집기에서:
- **backbone_conditions = v2의 최종 conditions**
- 따라서 노란 하이라이트 = "이전 승인본(v2) 대비 변경"
- 기존 Phase 1 diff 로직 그대로 활용, 추가 구현 거의 없음

---

## 5. 비즈니스 규칙

| 규칙 | 설명 |
|------|------|
| 제품당 Draft/Review는 1개만 | v2가 Approved 안 됐으면 v3 생성 불가 |
| Archived는 수정 불가 | 읽기전용, 상태 변경 불가, 삭제 불가 |
| Revision 생성은 Approved에서만 | Draft/Review/Rejected에서는 불가 |
| is_latest는 제품당 1개 | Revision 생성 시 트랜잭션으로 보장 |
| Rejected → Draft 복귀는 유지 | 같은 버전 내에서의 반려→수정은 기존과 동일 |
| 개정 사유는 선택 | 입력하면 히스토리에 표시, 안 해도 진행 가능 |

---

## 6. Phase 배치

| 기능 | Phase | 이유 |
|------|-------|------|
| Revision 생성 API + is_latest 필터 | **Phase 2** | backbone 교체와 함께 "기존 조건표 수정" 지원 |
| 프로젝트 목록 최신 버전 필터 | **Phase 2** | API 변경과 함께 |
| 개정판 만들기 버튼 + 모달 | **Phase 2** | 간단한 UI 추가 |
| Archived 상태 + 읽기전용 | **Phase 2** | 상태 추가만 하면 됨 |
| 버전 히스토리 패널 | **Phase 3** | 변경 이력과 함께 구현 |
| 버전 간 diff 비교 | **Phase 4** | 데이터 비교 뷰와 통합 |

### Phase 2에 추가되는 태스크

| # | 태스크 | 의존 | 예상 공수 |
|---|--------|------|----------|
| 2.17 | DB 마이그레이션 (revision, parent_project_id, is_latest) | Phase 1 | 0.5일 |
| 2.18 | Revision 생성 API (`POST /projects/{id}/revise`) | 2.17 | 1일 |
| 2.19 | 프로젝트 목록 API 수정 (is_latest 필터) | 2.17 | 0.5일 |
| 2.20 | 프로젝트 목록 UI (버전 표시 + 히스토리 링크) | 2.19 | 0.5일 |
| 2.21 | 개정판 만들기 모달 | 2.18 | 0.5일 |
| 2.22 | Archived 상태 처리 (읽기전용) | 2.17 | 0.5일 |
| | **추가 합계** | | **~3.5일** |

**Phase 2 총 예상**: 18일 → **21.5일 (~4.5주)**

---

## 7. 상태 전이 다이어그램 (최종)

```
                    ┌──────────┐
          ┌────────►│ Archived │ (읽기전용, 이전 버전 보존)
          │         └──────────┘
          │
┌───────┐ │  ┌────────┐    ┌──────────┐
│ Draft │──►│ Review │───►│ Approved │
└───────┘    └────────┘    └──────────┘
    ▲            │               │
    │            ▼               │ POST /revise
    │       ┌──────────┐        │
    └───────│ Rejected │        ▼
            └──────────┘   ┌───────┐
                           │ Draft │ (v+1, 새 프로젝트)
                           └───────┘
```

전이 규칙:
- Draft → Review: 검증 오류 0건
- Review → Approved: 검토자 권한
- Review → Rejected: 검토자 권한, 코멘트 필수
- Rejected → Draft: 편집자 (같은 프로젝트)
- Approved → Archived: Revision 생성 시 자동 (직접 전환 불가)
- Approved → Draft(새 프로젝트): POST /revise
