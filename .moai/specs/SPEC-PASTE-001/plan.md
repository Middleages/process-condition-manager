# SPEC-PASTE-001 구현 계획

**SPEC ID**: SPEC-PASTE-001
**추적 태그**: SPEC-PASTE-001

---

## 1. 마일스톤 개요

| 마일스톤 | 설명 | 우선순위 | 상대 복잡도 | 의존성 |
|----------|------|----------|-------------|--------|
| M1 | Core Paste Functionality (핵심 붙여넣기 기능) | Primary Goal | Medium (3/5) | 없음 |
| M2 | Paste UX Enhancement (붙여넣기 UX 개선) | Secondary Goal | Low-Medium (2/5) | M1 |

---

## 2. M1: Core Paste Functionality (Primary Goal)

### 2.1 기술 접근

**`processDataFromClipboard` 강화 (ConditionGrid.tsx):**
- 현재: 데이터를 그대로 반환 (line 265-276)
- 변경: read-only 컬럼 필터링, 데이터 타입 변환, select 옵션 검증, 빈 값 null 변환, 범위 초과 trim 로직 추가
- `gridApi.getFocusedCell()`로 시작 위치 확인
- `columns` props와 `readOnly` props를 활용하여 컬럼별 편집 가능 여부 + 데이터 타입 판별
- 가공 결과를 `pasteResultRef`에 저장 (onPasteEnd에서 참조)

**`onPasteEnd` 강화 (ConditionGrid.tsx):**
- 현재: `gridApi.refreshCells({ force: true })` 1회 호출 (line 279-285)
- 변경: 일괄 검증 실행 + 결과 토스트 표시 + Undo 스택 저장

**배치 검증 모드 (useEditorCellEdit.ts):**
- `isPasting` 플래그를 Zustand store에 추가
- `isPasting=true` 동안 `handleCellChanged`에서 개별 검증을 건너뛰고 dirty 등록만 수행
- `onPasteEnd`에서 일괄 검증 수행 후 `isPasting=false`

**Zustand Store 확장 (useEditorStore.ts):**
- `isPasting: boolean` 상태 추가
- `setIsPasting: (pasting: boolean) => void` 액션 추가
- `setBatchDirty: (cells: Array<{projectLayerId, columnName, value, originalValue}>) => void` 배치 dirty 등록 액션 추가 (선택사항: 최적화 필요 시)

**컬럼 정보 접근:**
- `processDataFromClipboard` 내에서 컬럼 메타데이터(data_type, select_options, editable)에 접근해야 함
- `columns` props를 ref로 유지하거나, 콜백 클로저에서 접근

### 2.2 구현 순서

1. **useEditorStore.ts**: `isPasting` 상태 + `setIsPasting` 액션 추가
2. **ConditionGrid.tsx**: `processDataFromClipboard` 로직 강화
   - read-only 컬럼 skip 로직 구현
   - 숫자형 컬럼 변환 로직 구현
   - select 타입 컬럼 검증 로직 구현
   - 빈 문자열 → null 변환
   - 범위 초과 데이터 trim
   - skipped cells 카운트 추적
3. **ConditionGrid.tsx**: `onPasteEnd` 로직 강화
   - 일괄 검증 실행 (변경된 셀 목록에 대해 `validateCellValue` 호출)
   - validationErrors 상태 업데이트
   - 결과 토스트 표시 (적용/건너뜀 셀 수)
   - `gridApi.refreshCells({ force: true })` 호출
4. **useEditorCellEdit.ts**: `isPasting` 연동
   - `handleCellChanged`에서 `isPasting=true`이면 개별 검증 skip, dirty 등록만 수행
5. **통합 테스트**: Excel 데이터 시뮬레이션으로 paste 동작 검증

### 2.3 read-only 컬럼 처리 전략

AG Grid Community의 paste 동작 분석:
- `editable: false`인 컬럼은 AG Grid가 paste 데이터를 적용하지 않고 **해당 열을 건너뜀**
- 따라서 `processDataFromClipboard`에서 별도의 read-only 필터링이 불필요할 수 있음
- 단, 확실한 동작 보장을 위해 `processDataFromClipboard`에서 명시적으로 read-only 컬럼의 데이터를 제거하는 방어적 처리 권장
- readOnly prop이 true인 경우 (review/approved/archived 상태): `processDataFromClipboard`에서 null 반환하여 전체 paste 차단

### 2.4 데이터 타입 변환 상세

| 컬럼 data_type | 변환 규칙 | 실패 시 동작 |
|----------------|-----------|-------------|
| `text` | 변환 없음 (문자열 그대로) | N/A |
| `integer` | `Number()` 후 `Math.round()`, NaN이면 실패 | 원래 값 유지, skip 카운트 증가 |
| `float` | `Number()`, NaN이면 실패 | 원래 값 유지, skip 카운트 증가 |
| `select` | `select_options` 배열에 포함 여부 확인 | 원래 값 유지, skip 카운트 증가 |
| 빈 문자열 | `null`로 변환 | N/A |

### 2.5 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| AG Grid Community paste 동작의 내부 구현 변경 | Medium | AG Grid 버전 고정, processDataFromClipboard 콜백 방어적 구현 |
| 대량 셀 붙여넣기 시 성능 저하 (CellValueChanged N회 발생) | Medium | isPasting 플래그로 개별 검증 skip, onPasteEnd에서 일괄 처리 |
| processDataFromClipboard에서 컬럼 메타데이터 접근 구조 | Low | columns를 ref로 유지하여 콜백에서 안전하게 접근 |
| 포커스 셀이 없는 상태에서 paste 시도 | Low | getFocusedCell() null 체크, 포커스 없으면 paste 무시 |

---

## 3. M2: Paste UX Enhancement (Secondary Goal)

### 3.1 기술 접근

**Undo 스택 (useEditorStore.ts):**
- `PasteUndoEntry` 타입: 최근 paste의 모든 셀 이전값/이후값 기록
- `pasteUndoStack: PasteUndoEntry | null` 상태 (최근 1회만)
- `undoLastPaste` 액션: 각 셀의 이전 값으로 `setCellValue` 호출
- 개별 셀 편집 시 `clearPasteUndo` 호출

**키보드 단축키 (ConditionGrid.tsx 또는 ConditionEditorPage.tsx):**
- `keydown` 이벤트 리스너에서 `Ctrl+Z` / `Cmd+Z` 감지
- `pasteUndoStack`이 존재하면 `undoLastPaste` 실행
- Undo 실행 후 일괄 검증 + dirty 상태 갱신

**하이라이트 피드백 (Optional):**
- 붙여넣기 직후 적용된 셀에 `bg-cell-paste-highlight` CSS 클래스 적용
- 2초 후 fade-out으로 제거
- `cellClassRules`에 추가하거나, 임시 set으로 관리

### 3.2 구현 순서

1. **types/editor.ts**: `PasteUndoEntry` 타입 정의
2. **useEditorStore.ts**: `pasteUndoStack`, `setPasteUndo`, `clearPasteUndo`, `undoLastPaste` 추가
3. **ConditionGrid.tsx (onPasteEnd)**: paste 직전 값을 수집하여 `setPasteUndo` 호출
4. **ConditionGrid.tsx 또는 ConditionEditorPage.tsx**: Ctrl+Z 키보드 이벤트 리스너 추가
5. **useEditorCellEdit.ts (handleCellChanged)**: 개별 편집 시 `clearPasteUndo` 호출
6. **(Optional)** CSS + 임시 상태로 paste 하이라이트 피드백 구현

### 3.3 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Ctrl+Z가 AG Grid 내부 동작과 충돌 | Medium | AG Grid Community에는 built-in undo가 없으므로 충돌 가능성 낮음. event.preventDefault()로 제어 |
| Undo 후 검증 상태 불일치 | Low | undoLastPaste 후 일괄 검증 재실행으로 해결 |
| 대량 셀 Undo 시 성능 | Low | setCellValue를 배치로 호출하되, 50개 이상이면 requestAnimationFrame 분할 고려 |
| 하이라이트 피드백과 기존 cellClassRules 충돌 | Low | CSS 우선순위 조정 또는 별도 overlay 방식 |

---

## 4. 아키텍처 설계 방향

### 4.1 컴포넌트 수정 범위

```
frontend/src/
  components/editor/
    ConditionGrid.tsx        (M1: processDataFromClipboard 강화, onPasteEnd 강화)
                             (M2: Undo 키보드 리스너, 하이라이트 피드백)
  hooks/
    useEditorCellEdit.ts     (M1: isPasting 연동, 배치 검증 모드)
    useEditorPaste.ts        (M1, M2: 신규 - paste 로직 분리, Optional)
  stores/
    useEditorStore.ts        (M1: isPasting, M2: pasteUndoStack)
  types/
    editor.ts                (M2: PasteUndoEntry 타입)
```

### 4.2 신규 훅 도입 검토 (useEditorPaste.ts)

paste 관련 로직이 복잡해질 경우, 별도 훅으로 분리하는 것을 권장:

```typescript
// useEditorPaste.ts
export function useEditorPaste({
  columns,
  readOnly,
  project,
  gridApiRef,
}: UseEditorPasteProps) {
  // processDataFromClipboard 로직
  // onPasteEnd 로직
  // Undo 관리
  // 결과 토스트
  return {
    processDataFromClipboard,
    onPasteEnd,
    handlePasteUndo,
  }
}
```

기존 편집기 훅 패턴 참고:
- `useEditorCellEdit` - 셀 편집/저장/오토세이브
- `useEditorNavigation` - 레이어/에러/셀 네비게이션
- `useEditorModals` - 모달 상태 관리
- `useEditorPaste` - **붙여넣기 처리** (신규)

### 4.3 기존 코드 패턴 준수

- **Zustand Store**: 기존 `useEditorStore` 패턴에 따라 상태와 액션을 추가
- **커스텀 훅**: 기존 `useEditorCellEdit` 패턴에 따라 props → 로직 → return 구조
- **AG Grid 콜백**: 기존 `useMemo`/`useCallback` + ref 패턴 유지
- **토스트**: 기존 `useToastStore`의 `addToast(message, type)` 패턴 사용
- **타입 정의**: `types/editor.ts`에 관련 타입 추가 (기존 패턴: DirtyCell, GridRowData와 동일 위치)

### 4.4 AG Grid Community Paste 동작 상세

AG Grid Community의 클립보드 처리 흐름:
1. 사용자 Ctrl+V → 브라우저 paste 이벤트 발생
2. AG Grid가 `event.clipboardData.getData('text/plain')` 호출
3. TSV 파싱하여 `string[][]` 생성
4. `processDataFromClipboard(params)` 콜백 호출 → 가공된 데이터 반환
5. 포커스 셀부터 순서대로 셀에 값 적용
6. 각 셀마다 `CellValueChanged` 이벤트 발생
7. 모든 셀 적용 완료 후 `onPasteEnd` 이벤트 발생

주요 참고:
- `processDataFromClipboard`에서 `null` 반환 시 paste 취소
- 반환된 `string[][]`의 빈 행(trailing empty rows)은 AG Grid가 무시
- AG Grid의 `suppressClipboardPaste` prop으로 paste 완전 비활성화 가능

---

## 5. 마일스톤 간 의존성

```
M1 (Core Paste Functionality)
  |
  +---> M2 (Paste UX Enhancement) - M1의 paste 기반 인프라 필요
```

- M1은 독립적으로 먼저 구현 가능
- M2는 M1의 paste 결과 추적 인프라(어떤 셀이 변경되었는지)가 필요
- 두 마일스톤은 순차적 진행 권장

---

## 6. 전체 리스크 요약

| 리스크 | 마일스톤 | 심각도 | 대응 전략 |
|--------|----------|--------|-----------|
| 대량 셀 paste 성능 저하 (CellValueChanged N회) | M1 | Medium | isPasting 플래그로 개별 검증 skip, onPasteEnd 일괄 처리 |
| AG Grid Community paste 내부 동작 변경 | M1 | Medium | AG Grid 버전 고정, processDataFromClipboard 방어적 구현 |
| Ctrl+Z 키보드 충돌 | M2 | Low | AG Grid Community에 built-in undo 없음, event.preventDefault()로 제어 |
| 포커스 셀 없이 paste 시도 | M1 | Low | getFocusedCell() null 체크, paste 무시 |
| Excel 로케일별 숫자 형식 (쉼표 소수점) | M1 | Low | Number() 변환 후 NaN 체크, 필요 시 로케일 감지 로직 추가 |
