# SPEC-PASTE-001: Excel Clipboard Paste (조건표 편집기 Excel 붙여넣기)

## 메타데이터

| 항목 | 값 |
|------|-----|
| SPEC ID | SPEC-PASTE-001 |
| 제목 | Excel Clipboard Paste (조건표 편집기 Excel 붙여넣기) |
| 상태 | Planned |
| 우선순위 | High |
| 생성일 | 2026-02-20 |
| 선행 SPEC | 없음 (기존 편집 기능 위에 구축) |
| Phase | Enhancement |

---

## 1. Environment (환경)

### 1.1 현재 시스템 상태

- **조건표 편집기**: AG Grid Community Edition 기반, React 18 + TypeScript + Zustand 상태 관리
- **그리드 컴포넌트**: `ConditionGrid.tsx`에 `processDataFromClipboard` 콜백과 `onPasteEnd` 콜백이 이미 존재하나, 최소한의 구현만 되어 있음 (데이터를 그대로 반환)
- **셀 편집 훅**: `useEditorCellEdit.ts`에서 `handleCellChanged`가 개별 셀 단위로 검증 + dirty 추적을 수행
- **컬럼 정의**: `buildColumnDefs.ts`에서 고정 컬럼(`layerName`, `stepSeq`)은 `editable: false`, 동적 컬럼은 `readOnly` prop에 따라 편집 가능/불가 결정
- **데이터 타입 처리**: `select` 타입 컬럼은 `agSelectCellEditor`, `integer`/`float` 타입 컬럼은 `valueParser`로 숫자 변환 처리
- **검증 시스템**: 클라이언트 측 `validateCellValue` (required, range, conditional_required) + 서버 측 cross-layer 검증
- **Dirty Cell 추적**: Zustand store의 `dirtyCells: Map<string, DirtyCell>`에서 `setCellValue`로 개별 관리
- **자동 저장**: `useAutoSave` 훅이 30초 간격으로 dirty cell이 있을 때 자동 저장
- **AG Grid Community 제약**: Enterprise의 Clipboard 모듈, Undo/Redo 모듈 사용 불가. 브라우저 네이티브 paste 이벤트 + `processDataFromClipboard` 콜백만 사용 가능

### 1.2 한계점

- 현재 `processDataFromClipboard`는 AG Grid가 전달한 `string[][]`을 그대로 반환하여, **read-only 컬럼 필터링, 데이터 타입 변환, select 옵션 검증** 등이 수행되지 않음
- AG Grid Community의 paste는 `CellValueChanged` 이벤트를 각 셀마다 발생시키지만, **배치 최적화**가 없어 300개 셀 붙여넣기 시 300번의 개별 검증이 발생할 수 있음
- **Undo/Redo** 기능이 없어 대량 붙여넣기 후 실수 시 복구 방법이 없음
- Excel에서 복사한 데이터의 **소수점 정밀도, 로케일별 숫자 형식**(쉼표 vs 점), **빈 셀 처리** 등에 대한 전처리가 없음
- 붙여넣기 범위가 그리드 경계를 **초과**할 때의 동작이 정의되지 않음
- 붙여넣기 후 **사용자 피드백**(성공/실패/경고 토스트)이 없음

### 1.3 기술 스택

- Frontend: React 18 + TypeScript + Vite, AG Grid Community, Zustand
- 편집기 컴포넌트: `ConditionGrid.tsx`, `buildColumnDefs.ts`, `GridContextMenu.tsx`
- 편집기 훅: `useEditorCellEdit.ts`, `useEditorNavigation.ts`, `useEditorModals.ts`
- 상태 관리: `useEditorStore.ts` (Zustand)
- 검증: `lib/validation.ts` (클라이언트 측), 서버 측 `/api/projects/{id}/validate`
- Backend: 변경 없음 (기존 벌크 저장 API 활용)

---

## 2. Assumptions (가정)

| ID | 가정 | 신뢰도 | 근거 |
|----|------|--------|------|
| A1 | Excel에서 복사한 클립보드 데이터는 TSV (Tab-Separated Values) 형식이다 | High | Excel/Google Sheets 표준 클립보드 포맷, AG Grid가 `string[][]`로 파싱하여 전달 |
| A2 | AG Grid Community의 `processDataFromClipboard` 콜백이 paste 데이터를 가로채어 가공할 수 있다 | High | 현재 코드에 이미 구현되어 있음 (ConditionGrid.tsx line 265) |
| A3 | AG Grid Community는 paste 시 각 셀마다 `CellValueChanged` 이벤트를 발생시킨다 | High | AG Grid 공식 문서 확인, 현재 코드 주석에도 명시 (line 281) |
| A4 | `editable: false`로 설정된 고정 컬럼(layerName, stepSeq)에는 AG Grid가 paste 데이터를 적용하지 않는다 | Medium | AG Grid 기본 동작이지만, processDataFromClipboard에서 명시적 처리가 더 안전 |
| A5 | 붙여넣기 대상 셀의 최대 규모는 약 60행(레이어) x 300열(파라미터) = 18,000셀이다 | High | PRD의 그리드 크기 정의 (레이어 30~60개, 파라미터 ~300개) |
| A6 | Backend 변경은 불필요하며, 기존 벌크 저장 API(`PUT /api/projects/{id}/conditions`)로 붙여넣기 데이터를 저장할 수 있다 | High | 붙여넣기 후 dirty cell로 추적되고, 기존 저장 플로우를 그대로 사용 |
| A7 | Excel의 빈 셀은 빈 문자열("")로 전달되며, 이를 null로 변환해야 한다 | Medium | Excel 클립보드 동작 관찰 기반, PCM에서 빈 값은 null로 처리하는 패턴 |
| A8 | AG Grid Community에는 built-in Undo/Redo가 없으므로, 커스텀 구현이 필요하다 | High | AG Grid Enterprise 전용 기능, Community에서는 직접 구현 필요 |

---

## 3. Requirements (요구사항)

### M1: Core Paste Functionality (핵심 붙여넣기 기능)

**REQ-PASTE-001** [Event-Driven]
**WHEN** 사용자가 Excel에서 셀 범위를 복사(Ctrl+C)한 후 AG Grid 편집기에서 붙여넣기(Ctrl+V)를 실행하면 **THEN** 클립보드의 TSV 데이터를 파싱하여 현재 포커스된 셀 위치부터 그리드에 적용해야 한다.

**REQ-PASTE-002** [Unwanted]
시스템은 read-only 컬럼(layerName, stepSeq)에 클립보드 데이터를 **적용하지 않아야 한다**. read-only 컬럼에 해당하는 열은 건너뛰고 다음 편집 가능한 컬럼에 값을 적용한다.

**REQ-PASTE-003** [State-Driven]
**IF** 프로젝트 상태가 review, approved, archived 중 하나이면 (readOnly=true) **THEN** 붙여넣기 동작을 차단하고, "읽기 전용 상태에서는 붙여넣기할 수 없습니다" 토스트 메시지를 표시해야 한다.

**REQ-PASTE-004** [Event-Driven]
**WHEN** 붙여넣기 데이터에 숫자형 컬럼(integer, float) 대상 값이 포함되어 있으면 **THEN** 해당 값을 숫자로 변환해야 한다. 변환 실패 시 원래 셀 값을 유지하고, 해당 셀을 경고 대상으로 기록한다.

**REQ-PASTE-005** [Event-Driven]
**WHEN** 붙여넣기 데이터에 select 타입 컬럼 대상 값이 포함되어 있으면 **THEN** 해당 값이 허용된 select_options에 포함되는지 검증해야 한다. 허용되지 않는 값은 적용하지 않고, 해당 셀을 경고 대상으로 기록한다.

**REQ-PASTE-006** [Event-Driven]
**WHEN** 붙여넣기가 완료되면 **THEN** 적용된 모든 셀에 대해 기존 클라이언트 측 검증(`validateCellValue`)을 일괄 실행하고, 검증 오류를 `validationErrors` 상태에 반영해야 한다.

**REQ-PASTE-007** [Event-Driven]
**WHEN** 붙여넣기가 완료되면 **THEN** 적용된 모든 셀을 Zustand store의 `dirtyCells`에 dirty로 등록하여 변경 추적이 이루어져야 한다. 기존 `setCellValue` 로직을 활용하되, 값이 서버 원본과 동일한 경우 dirty에서 제외한다.

**REQ-PASTE-008** [Event-Driven]
**WHEN** 붙여넣기 범위가 그리드의 행(레이어) 수를 초과하면 **THEN** 초과하는 행 데이터를 무시하고, 그리드 범위 내의 데이터만 적용해야 한다.

**REQ-PASTE-009** [Event-Driven]
**WHEN** 붙여넣기 범위가 현재 카테고리 탭의 컬럼 수를 초과하면 **THEN** 초과하는 열 데이터를 무시하고, 현재 표시된 컬럼 범위 내의 데이터만 적용해야 한다.

**REQ-PASTE-010** [Event-Driven]
**WHEN** 붙여넣기가 완료되면 **THEN** 결과 요약 토스트를 표시해야 한다:
- 성공: "N개 셀에 데이터를 붙여넣었습니다."
- 부분 성공: "N개 셀 적용, M개 셀 건너뜀 (읽기 전용/유효하지 않은 값)"
- 실패: "붙여넣기할 수 없습니다. (사유)"

**REQ-PASTE-011** [Event-Driven]
**WHEN** Excel에서 빈 셀이 포함된 범위를 붙여넣으면 **THEN** 빈 문자열("")을 null로 변환하여 적용해야 한다. 이는 PCM의 빈 값 = null 처리 패턴과 일관성을 유지한다.

**REQ-PASTE-012** [Ubiquitous]
시스템은 **항상** 붙여넣기로 변경된 셀에 대해 기존 dirty cell 스타일링(`bg-cell-changed`)이 즉시 반영되도록 해야 한다.

### M2: Paste UX Enhancement (붙여넣기 UX 개선)

**REQ-PASTE-020** [Event-Driven]
**WHEN** 사용자가 붙여넣기 직후 Ctrl+Z를 누르면 **THEN** 직전 붙여넣기로 변경된 모든 셀을 이전 값으로 복원해야 한다 (단일 Undo 스택, 가장 최근 붙여넣기 1회만 복원 가능).

**REQ-PASTE-021** [Event-Driven]
**WHEN** Undo가 실행되면 **THEN** 복원된 셀의 dirty 상태와 검증 상태도 함께 원복해야 한다. 원본 값으로 돌아간 셀은 dirty에서 제거된다.

**REQ-PASTE-022** [Event-Driven]
**WHEN** 붙여넣기 후 사용자가 다른 셀을 개별 편집하면 **THEN** Undo 스택이 초기화되어 이전 붙여넣기 Undo가 불가능해진다 (단순 구현).

**REQ-PASTE-023** [Optional]
**가능하면** 붙여넣기 대상 영역을 시각적으로 하이라이트하여, 어떤 셀에 데이터가 적용되었는지 사용자가 즉시 확인할 수 있도록 한다 (잠시 표시 후 fade-out).

**REQ-PASTE-024** [Event-Driven]
**WHEN** 붙여넣기 과정에서 건너뛴 셀이 있으면 **THEN** 토스트에 세부 사유를 포함해야 한다:
- "N개 셀 건너뜀: read-only 컬럼 X개, 유효하지 않은 값 Y개"

---

## 4. Specifications (사양)

### 4.1 Paste 데이터 흐름

```
[Excel 복사] → [Ctrl+V in AG Grid]
    → processDataFromClipboard(params) 호출
    → clipboardData: string[][] 수신
    → 전처리:
        1. 포커스 셀 위치(시작 row/col) 확인
        2. 각 셀별 대상 컬럼 매핑
        3. read-only 컬럼 건너뛰기
        4. 데이터 타입 변환 (숫자, select 검증)
        5. 빈 문자열 → null 변환
        6. 범위 초과 데이터 trim
    → 가공된 데이터 반환 (AG Grid가 셀에 적용)
    → CellValueChanged 이벤트 발생 (셀마다)
    → onPasteEnd 호출
        7. 일괄 검증 실행
        8. 결과 토스트 표시
        9. Undo 스택에 이전 값 저장
```

### 4.2 processDataFromClipboard 로직 상세

현재 구현 (`ConditionGrid.tsx` line 265-276):
```typescript
// 현재: 데이터를 그대로 반환
const processDataFromClipboard = useCallback(
  (params: ProcessDataFromClipboardParams): string[][] | null => {
    const { data } = params
    if (!data || data.length === 0) return null
    return data
  }, []
)
```

개선 후 로직:
1. `params.data`에서 `string[][]` 수신 (각 inner array = 한 행, 값 = TSV 파싱 결과)
2. 포커스 셀의 column index 확인 (`gridApi.getFocusedCell()`)
3. 현재 표시된 컬럼 목록에서 시작 index부터 순회
4. 각 열에 대해:
   - `editable === false`인 컬럼은 skip (열 인덱스만 이동, 데이터는 다음 editable 컬럼으로)
   - `data_type === 'integer'` / `'float'`: Number 변환, NaN이면 skip
   - `data_type === 'select'`: `select_options`에 포함되는지 확인, 미포함이면 skip
   - 빈 문자열 → null 변환
5. 행 범위: `data.length`와 그리드 rowCount 중 작은 값까지만 처리
6. 열 범위: 가공된 열 수와 남은 컬럼 수 중 작은 값까지만 처리
7. 가공된 `string[][]` 반환

### 4.3 Undo 스택 설계

Zustand store 확장:
```typescript
// useEditorStore에 추가
interface PasteUndoEntry {
  cells: Array<{
    projectLayerId: number
    columnName: string
    previousValue: unknown
    pastedValue: unknown
  }>
}

// 상태
pasteUndoStack: PasteUndoEntry | null  // 최근 1회만 저장

// 액션
setPasteUndo: (entry: PasteUndoEntry) => void
clearPasteUndo: () => void
undoLastPaste: () => void
```

- `undoLastPaste`: stack의 각 셀에 대해 `setCellValue(projectLayerId, columnName, previousValue, serverValue)` 호출
- 개별 셀 편집 시 `clearPasteUndo` 호출로 스택 초기화

### 4.4 키보드 이벤트 처리

Undo 단축키 (Ctrl+Z) 처리:
- `ConditionGrid` 또는 `ConditionEditorPage`에 `keydown` 이벤트 리스너 등록
- `Ctrl+Z` (또는 `Cmd+Z` on Mac) 감지 시:
  - `pasteUndoStack`이 존재하면: `undoLastPaste` 실행
  - 존재하지 않으면: 기본 브라우저 동작 허용 (개별 셀 편집 Undo)

### 4.5 성능 고려사항

- **배치 검증**: `onPasteEnd`에서 변경된 모든 셀을 한 번에 검증하되, 개별 `CellValueChanged`에서는 검증을 건너뛸 수 있도록 `isPasting` 플래그 사용
- **Refresh 최적화**: 붙여넣기 완료 후 `gridApi.refreshCells({ force: true })` 1회 호출로 일괄 스타일 갱신
- **대량 데이터**: 60행 x 50열 = 3,000셀 규모까지 즉시 반응(16ms 이내) 목표. 그 이상은 비동기 처리 고려

### 4.6 영향받는 파일 목록

#### 수정 파일

**Frontend:**
- `frontend/src/components/editor/ConditionGrid.tsx` - `processDataFromClipboard` 로직 강화, `onPasteEnd` 로직 강화, Undo 키보드 이벤트 리스너 (M1, M2)
- `frontend/src/hooks/useEditorCellEdit.ts` - 붙여넣기 시 배치 검증 모드 지원, `isPasting` 플래그 연동 (M1)
- `frontend/src/stores/useEditorStore.ts` - `pasteUndoStack`, `isPasting` 상태 + 액션 추가 (M1, M2)
- `frontend/src/types/editor.ts` - `PasteUndoEntry` 타입 추가 (M2)

#### 신규 파일 (Optional)

**Frontend:**
- `frontend/src/hooks/useEditorPaste.ts` - 붙여넣기 전용 훅 (processDataFromClipboard 로직, Undo 관리, 결과 토스트 로직을 분리할 경우) (M1, M2)

#### 변경 없음

**Backend:** 기존 벌크 저장 API를 그대로 활용하므로 Backend 변경 없음

### 4.7 추적 태그 (Traceability)

| 태그 | 범위 |
|------|------|
| SPEC-PASTE-001 | 전체 SPEC |
| SPEC-PASTE-001-M1 | Core Paste Functionality |
| SPEC-PASTE-001-M2 | Paste UX Enhancement |
