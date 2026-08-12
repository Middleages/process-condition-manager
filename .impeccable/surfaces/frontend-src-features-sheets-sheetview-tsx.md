---
version: 1
slug: "frontend-src-features-sheets-sheetview-tsx"
primary_target: "frontend/src/features/sheets/SheetView.tsx"
related_targets: ["frontend/src/features/sheets/SheetWorkbench.tsx"]
---

# Condition sheet redesign surface brief

- Scope: `/projects/:projectId/sheet`, desktop web only.
- Visitor mode: Operate.
- Audience: 공정 엔지니어.
- Job: 약 100개 Layer를 한 번 클릭으로 전환하며 약 200개 Parameter 조건표를 편집하고 검증 오류와 변경 이력을 확인한다.
- Constraints: 폐쇄망, 기존 URL/API/Glide 가상화, WCAG 2.2 AA, 한국어 문체, 모바일 제외.
- Chosen direction: Drafting Table.
- Approved comp: `.impeccable/mocks/drafting-table/option-2c-layer-navigator-no-rail.png`.
- Memorable moment: 검증 오류에서 대응 셀로 이어지는 제도식 연결과 현재 Layer 문맥을 보존하는 우측 증빙 레일.
- Layer navigation contract: persistent 210–230px virtualized list, search, recent three, status/error counts, one-click immediate switch, keyboard navigation, collapsible; no top dropdown.
- History contract: no bottom revision ruler or global cross-Layer timeline; right inspector defaults to current Layer and can narrow to current cell.
- Unresolved decisions: none for the approved primary flow.
