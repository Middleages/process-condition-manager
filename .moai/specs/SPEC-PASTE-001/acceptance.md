# SPEC-PASTE-001 수용 기준

**SPEC ID**: SPEC-PASTE-001
**추적 태그**: SPEC-PASTE-001

---

## M1: Core Paste Functionality

### AC-M1-01: 기본 Excel 붙여넣기

```gherkin
Given 편집 가능한 Draft 상태의 프로젝트 조건표가 열려 있고
  And Excel에서 3행 x 4열 데이터를 복사한 상태이고
  And 그리드의 동적 컬럼 영역(첫 번째 편집 가능 컬럼)의 3번째 행 셀에 포커스가 있을 때
When Ctrl+V를 실행하면
Then 3번째 행부터 5번째 행까지, 포커스 컬럼부터 4개 컬럼에 데이터가 적용되고
  And 적용된 셀들이 dirty (bg-cell-changed)로 표시되고
  And "12개 셀에 데이터를 붙여넣었습니다." 토스트가 표시된다
```

### AC-M1-02: read-only 컬럼 건너뛰기

```gherkin
Given Excel에서 Layer 컬럼, Step Seq 컬럼, 그리고 첫 동적 컬럼 데이터를 포함한 3열 데이터를 복사한 상태이고
  And 그리드의 Layer 컬럼(layerName, editable:false)에 포커스가 있을 때
When Ctrl+V를 실행하면
Then Layer 컬럼과 Step Seq 컬럼의 값은 변경되지 않고
  And 첫 번째 편집 가능 동적 컬럼부터 데이터가 적용되고
  And 토스트에 "N개 셀 적용, M개 셀 건너뜀 (읽기 전용)" 메시지가 포함된다
```

### AC-M1-03: read-only 프로젝트 상태에서 붙여넣기 차단

```gherkin
Given 프로젝트 상태가 "review"인 조건표가 열려 있을 때 (readOnly=true)
When 사용자가 Ctrl+V를 실행하면
Then 셀 값이 변경되지 않고
  And "읽기 전용 상태에서는 붙여넣기할 수 없습니다" 에러 토스트가 표시된다
```

### AC-M1-04: 숫자형 컬럼 데이터 변환

```gherkin
Given Excel에서 "42.5", "abc", "100" 값이 포함된 1행 x 3열 데이터를 복사한 상태이고
  And 대상 컬럼이 모두 float 타입일 때
When Ctrl+V를 실행하면
Then 첫 번째 셀에 42.5 (숫자)가 적용되고
  And 두 번째 셀은 "abc"가 숫자 변환에 실패하여 건너뛰어지고
  And 세 번째 셀에 100 (숫자)가 적용되고
  And 토스트에 "2개 셀 적용, 1개 셀 건너뜀 (유효하지 않은 값)" 메시지가 표시된다
```

### AC-M1-05: select 타입 컬럼 검증

```gherkin
Given select 타입 컬럼의 select_options가 ["POS", "NEG", "N/A"]이고
  And Excel에서 "POS", "INVALID", "NEG" 값을 복사한 상태일 때
When 해당 select 컬럼에 붙여넣기를 실행하면
Then "POS"와 "NEG"는 적용되고
  And "INVALID"는 허용되지 않는 값이므로 건너뛰어지고
  And 토스트에 건너뛴 셀 정보가 포함된다
```

### AC-M1-06: 빈 셀 null 변환

```gherkin
Given Excel에서 "값1", "", "값3" 데이터가 포함된 1행 x 3열을 복사한 상태일 때
When Ctrl+V를 실행하면
Then 첫 번째 셀에 "값1"이 적용되고
  And 두 번째 셀에 null이 적용되고 (빈 문자열 → null 변환)
  And 세 번째 셀에 "값3"이 적용된다
```

### AC-M1-07: 행 범위 초과 (그리드 하단 넘침)

```gherkin
Given 현재 그리드에 30개 레이어가 표시되어 있고
  And 28번째 행에 포커스가 있고
  And Excel에서 10행 데이터를 복사한 상태일 때
When Ctrl+V를 실행하면
Then 28, 29, 30번째 행(3개 행)에만 데이터가 적용되고
  And 나머지 7행 데이터는 무시되고
  And 적용된 셀 수만 토스트에 표시된다
```

### AC-M1-08: 열 범위 초과 (컬럼 우측 넘침)

```gherkin
Given 현재 카테고리 탭에 10개 컬럼이 표시되어 있고
  And 8번째 컬럼에 포커스가 있고
  And Excel에서 5열 데이터를 복사한 상태일 때
When Ctrl+V를 실행하면
Then 8, 9, 10번째 컬럼(3개 컬럼)에만 데이터가 적용되고
  And 나머지 2열 데이터는 무시된다
```

### AC-M1-09: 붙여넣기 후 검증 오류 반영

```gherkin
Given "required" 검증 규칙이 설정된 컬럼에
  And Excel에서 빈 값("")을 포함한 데이터를 복사한 상태일 때
When Ctrl+V를 실행하면
Then 빈 값이 null로 적용되고
  And required 검증에 실패한 셀에 에러 스타일(bg-cell-error)이 적용되고
  And ValidationPanel에 해당 오류가 표시된다
```

### AC-M1-10: 붙여넣기 후 dirty cell 추적

```gherkin
Given 서버에 저장된 원본 값이 {"SP_COL1": "원본값"}이고
  And Excel에서 "새값"을 복사하여 해당 셀에 붙여넣기를 실행하면
Then 해당 셀이 dirtyCells에 등록되고 (bg-cell-changed 스타일 표시)
  And 저장 버튼 활성화 / beforeunload 경고가 활성화된다
```

### AC-M1-11: 원본과 동일한 값 붙여넣기

```gherkin
Given 서버에 저장된 원본 값이 {"SP_COL1": "100"}이고
  And Excel에서 "100"을 복사하여 해당 셀에 붙여넣기를 실행하면
Then 해당 셀은 dirtyCells에 등록되지 않고 (값이 원본과 동일)
  And dirty 스타일이 표시되지 않는다
```

### AC-M1-12: 대량 데이터 붙여넣기 성능

```gherkin
Given 30행 x 20열 = 600셀 규모의 데이터를 Excel에서 복사한 상태일 때
When Ctrl+V를 실행하면
Then 모든 셀에 데이터가 적용되고
  And dirty 스타일 갱신까지 2초 이내에 완료되고
  And 검증 오류가 ValidationPanel에 반영된다
```

### AC-M1-13: 자동 저장 연동

```gherkin
Given 붙여넣기로 dirty cell이 생성된 상태에서
When 자동 저장 타이머(30초)가 만료되면
Then 기존 자동 저장 로직이 정상 작동하여 dirty cell이 서버에 벌크 저장된다
```

---

## M2: Paste UX Enhancement

### AC-M2-01: 붙여넣기 Undo (Ctrl+Z)

```gherkin
Given Excel에서 3행 x 3열 데이터를 붙여넣기하여 9개 셀이 변경된 상태에서
When Ctrl+Z (또는 Mac에서 Cmd+Z)를 누르면
Then 9개 셀 모두 붙여넣기 이전 값으로 복원되고
  And 복원된 셀의 dirty 상태가 원복되고 (원본 값으로 돌아간 셀은 dirty 해제)
  And 검증 상태도 이전 상태로 갱신되고
  And "붙여넣기를 취소했습니다 (9개 셀 복원)" 토스트가 표시된다
```

### AC-M2-02: Undo 후 재 Undo 불가 (단일 스택)

```gherkin
Given 붙여넣기 Undo를 실행한 직후에
When 다시 Ctrl+Z를 누르면
Then pasteUndoStack이 비어있으므로 아무 동작도 하지 않고
  And 브라우저 기본 Ctrl+Z 동작이 허용된다
```

### AC-M2-03: 개별 편집 후 Undo 스택 초기화

```gherkin
Given 붙여넣기로 9개 셀이 변경된 상태에서
When 사용자가 마우스로 특정 셀을 클릭하여 개별 편집하면
Then pasteUndoStack이 초기화되고
When 이후 Ctrl+Z를 누르면
Then 이전 붙여넣기 Undo는 실행되지 않는다
```

### AC-M2-04: 상세 건너뜀 사유 토스트

```gherkin
Given 붙여넣기 데이터 중 read-only 컬럼 2개, 유효하지 않은 값 3개가 포함되어 있을 때
When 붙여넣기를 실행하면
Then 토스트에 "10개 셀 적용, 5개 셀 건너뜀: 읽기 전용 컬럼 2개, 유효하지 않은 값 3개" 메시지가 표시된다
```

### AC-M2-05: 붙여넣기 하이라이트 피드백 (Optional)

```gherkin
Given 붙여넣기로 9개 셀에 데이터가 적용된 직후
Then 적용된 9개 셀에 하이라이트 스타일이 잠시 표시되고
  And 2초 후 하이라이트가 fade-out되어 사라지고
  And 기존 dirty cell 스타일(bg-cell-changed)만 남는다
```

---

## 품질 게이트 기준

### Definition of Done

- [ ] 모든 EARS 요구사항(REQ-PASTE-001~024)이 구현됨
- [ ] 모든 Acceptance Criteria(AC-M1~M2)가 통과됨
- [ ] Excel에서 복사한 TSV 데이터가 그리드에 정확히 적용됨
- [ ] read-only 컬럼(layerName, stepSeq)에 데이터가 적용되지 않음
- [ ] readOnly 프로젝트 상태에서 paste가 차단됨
- [ ] 숫자형/select 타입 컬럼의 데이터 변환 및 검증이 정상 동작함
- [ ] 빈 셀이 null로 변환됨
- [ ] 범위 초과 데이터가 안전하게 trim됨
- [ ] 붙여넣기 후 dirty cell 추적이 정상 동작함
- [ ] 붙여넣기 후 클라이언트 측 검증이 일괄 실행됨
- [ ] 결과 토스트가 적절한 메시지로 표시됨
- [ ] 자동 저장이 붙여넣기 dirty cell과 연동됨
- [ ] (M2) Undo가 최근 1회 붙여넣기를 정확히 복원함
- [ ] (M2) 개별 편집 후 Undo 스택이 초기화됨
- [ ] 30행 x 20열 규모 붙여넣기가 2초 이내 완료됨
- [ ] Backend 변경 없이 기존 벌크 저장 API로 정상 저장됨
- [ ] 기존 편집 기능(단일 셀 편집, 검증, dirty 추적)에 영향 없음 (회귀 테스트)

### 검증 방법

| 항목 | 방법 |
|------|------|
| 기본 붙여넣기 동작 | Excel/Google Sheets에서 데이터 복사 후 그리드에 paste, 값 확인 |
| read-only 컬럼 보호 | layerName/stepSeq 컬럼 영역에 paste 시도, 값 미변경 확인 |
| readOnly 상태 차단 | review/approved/archived 프로젝트에서 paste 시도, 차단 확인 |
| 데이터 타입 변환 | 숫자/문자 혼합 데이터 paste, 컬럼 타입별 변환 결과 확인 |
| select 검증 | 유효/무효 옵션 혼합 paste, 유효 값만 적용 확인 |
| 빈 셀 처리 | 빈 셀 포함 데이터 paste, null 변환 확인 |
| 범위 초과 | 그리드보다 큰 데이터 paste, trim 동작 확인 |
| dirty 추적 | paste 후 dirtyCells 상태 확인, 저장 버튼 활성화 확인 |
| 검증 반영 | paste 후 ValidationPanel 오류 표시 확인 |
| Undo 동작 | paste 후 Ctrl+Z, 이전 값 복원 + dirty 상태 원복 확인 |
| 성능 | 600셀(30x20) paste, 완료 시간 측정 (2초 이내 기준) |
| 자동 저장 연동 | paste 후 30초 대기, 자동 저장 정상 실행 확인 |
| 회귀 테스트 | 기존 단일 셀 편집, 검증, 저장 동작 정상 확인 |
| 크로스 브라우저 | Chrome, Edge에서 동일 동작 확인 |
