# Signal Grid 조건표 핵심 편집 구조 설계

**작성일:** 2026-08-13  
**상태:** 사용자 승인안  
**대상:** `/projects/:projectId/sheet`

## 1. 목적과 범위

공정 엔지니어가 모든 Layer의 조건을 하나의 연속된 조건표에서 읽고 편집하면서도 현재 Layer, POR, Backbone 맥락을 잃지 않게 한다. 이번 작업은 기존 Glide Data Grid의 가상화·키보드 편집·붙여넣기·잠금·저장·검증·이력 기능을 보존하면서 조건표의 정보 구조와 Layer 이동 방식을 Signal Grid 기준으로 교체한다.

이번 범위는 다음을 포함한다.

- 고정 컬럼 `STEP SEQ / LAYER / 조건 / POR`와 Parameter별 독립 데이터 컬럼
- 전체 Layer 연속 표시를 기본값으로 하는 단일 Glide Grid
- Layer 탐색기 선택 시 필터가 아닌 해당 Layer 위치 이동
- Layer 탐색기 헤더의 `현재만` 명시적 필터
- 그리드 셀·탐색기·현재 좌표·Layer별 Backbone·증거 패널 범위 동기화
- 조건 행 추가·복제·삭제와 Layer당 정확히 하나인 POR 불변식
- 대량 데이터, 포커스 복원, 오류·잠금·저장 실패의 기존 복구 계약 유지

검증·이력·백본 비교 패널 내부 UI의 재설계, Project 상세·생성, Parameter Registry와 Choice Set 활성화 관리는 후속 작업이다. 조건 행에는 `is_active`를 추가하지 않는다.

## 2. 핵심 설계 결정

### 2.1 단일 연속 그리드

모든 Layer의 조건 행을 하나의 Glide Grid에 Layer와 조건 순서대로 제공한다. Layer마다 별도 그리드를 만들거나 전체 보기 전용 화면을 추가하지 않는다. 단일 그리드는 다음 기존 계약을 유지한다.

- 행·열 가상화와 200개 안팎 Parameter 성능
- Layer 경계를 넘는 키보드 이동과 범위 선택
- 복사·붙여넣기와 dirty cell 배치 저장
- 검증·댓글·이력 셀 좌표 이동
- 기존 Grid adapter 뒤에 Glide 구현을 격리하는 구조

기본 모드는 항상 전체 Layer다. 현재 Layer는 표시 범위를 결정하는 값이 아니라 탐색·좌표·증거 범위를 동기화하는 현재 문맥이다.

### 2.2 고정 컬럼과 Layer 그룹

고정 컬럼은 다음 순서다.

1. `STEP SEQ`: 실제 정렬값을 고정폭 숫자로 표시
2. `LAYER`: 사용자용 Layer ID 또는 라벨 표시
3. `조건`: 조건 행 라벨 표시
4. `POR`: Layer 안의 단일 POR를 나타내는 불린 선택 컨트롤

이후 활성 Parameter 정의를 각각 독립 컬럼으로 표시한다. Parameter 이름은 헤더의 주 표기이며 단위가 존재하면 보조 표기로 제공한다. 기존 Category는 Parameter 컬럼을 찾거나 가시성을 좁히는 도구일 수 있지만 데이터 행이나 Parameter 값을 세로로 전치하지 않는다.

같은 Layer의 두 번째 조건부터 `STEP SEQ`와 `LAYER` 셀은 비워 반복 노이즈를 줄인다. 각 Layer의 첫 행에는 강한 그룹 경계를 표시하고, 현재 Layer 그룹은 색상만이 아니라 경계·선택 상태로도 구분한다. 행 높이는 현재 밀도 계약을 유지한다.

## 3. Layer 탐색과 현재만

### 3.1 현재 Layer의 결정

- 최초 진입 시 첫 번째 Layer를 현재 Layer로 설정하고 전체 조건표를 표시한다.
- Layer 탐색기 항목을 선택하면 해당 Layer의 첫 조건 행으로 스크롤하고 포커스를 옮긴다.
- 그리드의 셀이나 식별 셀을 선택하면 해당 행의 Layer가 현재 Layer가 된다.
- 검증·이력·백본 비교에서 좌표로 이동하면 목적 셀의 Layer가 현재 Layer가 된다.
- 현재 Layer가 바뀌면 탐색기 선택, 현재 좌표, Layer별 Backbone 문구, 증거 패널의 기본 Layer 범위가 함께 갱신된다.

탐색기 클릭은 기본 모드에서 행 필터링을 일으키지 않는다. 검색 결과나 최근 Layer에서 선택해도 동일한 위치 이동 규칙을 쓴다.

### 3.2 현재만 모드

`현재만`은 Layer 탐색기 헤더에 배치한 토글 버튼이며 `aria-pressed`로 상태를 노출한다.

- 켜기: 현재 Layer의 조건 행만 그리드에 제공한다.
- 켠 상태에서 다른 Layer 선택: 현재만을 유지하고 새 Layer 행으로 표시 대상을 교체한다.
- 끄기: 전체 행을 복원하고 현재 Layer 첫 행으로 스크롤한 뒤 가능한 최근 좌표에 포커스를 복원한다.
- Layer 검색 결과가 0개여도 현재 그리드와 선택 상태는 지우지 않는다.

현재 Layer와 현재만 상태는 URL 계약에 추가하지 않는다. 이 값은 화면 세션 상태이며 기존 저장된 탐색기 상태와 충돌하지 않게 관리한다.

### 3.3 가상화 이동 계약

Layer별 첫 행 index를 파생한 이동 인덱스를 단일 상태 계산 모듈에서 관리한다. Grid handle은 Layer 이동을 위한 행 스크롤 명령을 제공하되 Glide API가 SheetView로 새어나오지 않게 한다. 스크롤 후 포커스와 활성 좌표는 같은 행을 가리켜야 한다.

재조회 뒤 목적 행이 사라지면 다음 순서로 복구한다.

1. 같은 Layer에 남은 첫 조건 행
2. 원래 Layer 다음에 있는 Layer의 첫 행
3. 앞선 Layer의 첫 행
4. 데이터가 없으면 그리드 빈 상태

## 4. Layer별 Backbone 문맥

그리드 상단의 현재 Layer 설명 영역은 선택된 Layer의 Backbone 출처를 표시한다. 프로젝트 전체 Backbone 하나로 요약하지 않는다.

- 연결됨: 원본 프로젝트의 `LINE / Process / Part ID`와 원본 `STEP SEQ / LAYER`
- 연결 없음: `백본 없음`
- 출처가 삭제되었거나 접근 불가: `백본 정보를 불러올 수 없음`

전체 보기에서도 이 영역은 현재 Layer 하나만 설명한다. 현재 Layer 변경과 동시에 갱신되며 로딩 중 이전 Layer의 Backbone을 새 Layer 정보인 것처럼 보여주지 않는다. 현재 `ProjectLayerOut`의 `source_project_id`와 `source_layer_key`를 출처 좌표로 사용하고, source project를 TanStack Query에서 project ID별로 한 번 조회해 `LINE / Process / Part ID`와 source Layer의 `STEP SEQ / LAYER`를 조합한다. 여러 Layer가 같은 source project를 참조하면 Query cache를 공유한다. source project 또는 source Layer를 찾지 못하거나 권한 때문에 읽지 못하면 제한 상태로 매핑한다.

## 5. 조건 행과 POR 불변식

### 5.1 조건 행 관리

사용자가 조건 식별 셀을 선택하면 현재 도구 영역에 선택 행과 다음 작업을 노출한다.

- `빈 행 추가`: 선택 Layer 마지막에 빈 non-POR 행 추가
- `선택 행 복제`: 셀 값을 복사해 Layer 마지막에 non-POR 행 추가
- `삭제`: 확인 후 선택 행과 셀 값 삭제

기존 잠금·권한·paste review 제한을 그대로 적용한다. 구조 변경 전 dirty cell 저장을 완료해야 하며 저장이 실패하면 구조 API를 호출하지 않는다. 진행 중에는 중복 실행을 막고, 실패 시 선택 행·현재 Layer·스크롤 위치·입력 상태를 보존한다.

### 5.2 POR 규칙

POR는 조건 행의 불린값이지만 Layer 단위로 정확히 하나만 참이어야 한다.

- 조건 행이 하나인 Layer: 해당 행은 항상 POR이며 POR를 해제할 수 없다.
- 조건 행이 여러 개인 Layer: 다른 행의 POR 컨트롤을 선택하면 기존 POR에서 새 행으로 원자적으로 이양한다.
- 현재 POR를 다시 선택하면 상태와 이력을 바꾸지 않는다.
- 추가·복제된 행은 non-POR다.
- 마지막 조건 행은 삭제할 수 없다.
- POR 행은 다른 행을 POR로 지정하기 전에는 삭제할 수 없다.

POR 컨트롤은 라디오 성격의 버튼으로 구현하고 `aria-pressed` 또는 동등한 단일 선택 semantics와 Layer·조건을 포함한 접근 가능한 이름을 제공한다. 색상만으로 POR를 표시하지 않는다.

백엔드는 POR 삭제 금지를 검증하고, UI와 관계없이 Layer별 POR 불변식을 보호한다. 배포 migration은 POR가 없는 기존 Layer마다 `condition_index`가 가장 작은 조건 행을 POR로 지정한다. 조건 행이 하나인 Layer도 같은 규칙으로 그 한 행이 POR가 된다. 기존 partial unique index는 POR 최대 1개를 보장하고, 서비스의 추가·삭제·이양 규칙은 최소 1개를 보장한다. migration 이후 POR 누락이 다시 관측되면 UI는 이를 자동 추정하지 않고 명시적 정합성 오류로 표시하며 구조 변경을 막는다.

### 5.3 변경 후 포커스

- 추가·복제 성공: 새 행의 조건 셀로 이동
- non-POR 삭제 성공: 같은 Layer의 다음 행, 없으면 이전 행으로 이동
- POR 이양 성공: 새 POR 컨트롤 또는 해당 조건 셀에 포커스 유지
- 외부 변경으로 선택 행 소실: Layer 이동 복구 계약 적용

## 6. 상태와 오류 처리

- 조건표 로딩·오류·빈 상태는 기존 route와 Query 복구 계약을 유지한다.
- 잠금이 없거나 권한이 없는 사용자는 이동·검색·증거 열람은 가능하지만 편집·붙여넣기·조건 구조·POR 변경은 할 수 없다.
- autosave 실패 시 dirty 값을 유지하고 문제·영향·다음 행동 순서로 안내한다.
- 구조 변경 실패는 행과 Layer 선택을 유지하며 재시도 가능한 오류를 작업 도구 가까이에 표시한다.
- Backbone 표시 실패는 조건표 전체를 막지 않고 현재 Layer 출처 영역만 제한 상태로 표시한다.
- 현재만 전환이나 Layer 이동은 진행 중 편집값을 버리지 않는다.
- Parameter가 0개여도 네 고정 컬럼과 조건 행 관리는 유지된다.
- Layer가 많거나 조건 행이 많은 경우에도 DOM에 전체 행을 직접 렌더하지 않고 Grid 가상화를 유지한다.

## 7. 구성 요소와 책임

- `SheetView`: 서버 데이터, 편집·잠금·저장·구조 mutation과 현재 Layer 문맥을 조합한다.
- `LayerNavigator`: Layer 검색·최근 항목·선택·현재만 입력을 제공하며 그리드 행을 직접 필터링하지 않는다.
- Layer viewport state 모듈: 현재 Layer, 현재만, Layer별 첫 행, 전환 후 복구 좌표를 순수 계산한다.
- `sheetAdapter`: API의 Layer/조건/Parameter를 고정 컬럼과 Parameter 컬럼을 갖는 Grid 계약으로 변환한다.
- `GlideConditionGrid`: 연속 그룹 렌더링, 고정 컬럼, POR 컨트롤, Layer/셀 활성화와 명령형 스크롤을 담당한다.
- 조건 서비스: 최소 한 행, 단일 POR, POR 행 삭제 금지와 이벤트 기록을 트랜잭션으로 보장한다.

현재 거대한 `SheetView`에 이동 계산과 POR 규칙을 더 쌓지 않는다. 파생·전환 로직은 순수 모듈로 분리하고 기존 controller/hook 경계를 재사용한다.

## 8. 접근성과 키보드

- Layer 탐색기는 기존 listbox/option 키보드 이동을 유지한다.
- `현재만`은 명명된 toggle이며 상태를 보조기술에 전달한다.
- Layer 선택 후 Grid 목적 행 또는 셀에 실제 포커스를 둔다.
- 고정 컬럼 헤더와 Parameter 헤더는 스크린리더가 구분할 수 있는 이름을 제공한다.
- POR 컨트롤은 `Layer + 조건 + POR 지정 상태`를 포함한 이름을 제공한다.
- 현재 좌표 변경과 이동 성공·실패는 과도하지 않은 live status로 알린다.
- 포커스, 현재 Layer, POR, 오류, dirty 상태는 색상만으로 전달하지 않는다.
- `prefers-reduced-motion`에서는 스크롤 이동을 즉시 수행한다.

## 9. 검증 전략

### 9.1 순수 로직과 어댑터

- Layer별 첫 행 index, 전체/현재만 행 선택, 전환 후 복구 좌표
- `STEP SEQ / LAYER / 조건 / POR` 고정 컬럼 순서와 Parameter별 컬럼
- 같은 Layer의 반복 Step Seq/Layer 표기 억제
- Layer별 Backbone 세 상태 매핑
- 기존 dirty/status/choice/paste overlay의 좌표 보존

### 9.2 컴포넌트와 통합

- 탐색기 Layer 선택이 필터가 아니라 Grid scroll 명령을 발생시킴
- 셀 선택이 현재 Layer·탐색기·Backbone·증거 범위를 동기화함
- 현재만 on/off, 다른 Layer 선택, 검색 0건, 재조회 후 복구
- 단일 조건 POR 고정, 복수 조건 POR 이양, 동일 POR no-op
- 추가·복제·삭제 성공과 실패의 포커스·상태 보존
- 읽기 전용·잠금 상실·paste review 중 구조 작업 차단

### 9.3 백엔드

- 마지막 조건 행 삭제 거부
- POR 행 삭제 거부 및 다른 행 POR 지정 후 삭제 성공
- POR 이양의 원자성과 동시 요청 방어
- 동일 POR 재지정의 이벤트 없는 no-op
- migration이 POR 누락 Layer의 첫 조건 행을 결정적으로 보정함

### 9.4 브라우저 증거

1024×768, 1440×900, 1920×1080에서 다음을 확인한다.

- 고정 컬럼과 수평 Parameter 스크롤, body overflow 없음
- Layer 선택 위치 이동과 현재만 전환
- 셀 선택에 따른 현재 Layer·Backbone 동기화
- 키보드 이동, 포커스 표시, reduced motion
- 행 추가·복제·삭제와 POR 이양
- dirty 저장 실패, 구조 변경 실패, 잠금 상실 후 복구
- 검증·이력·백본 비교의 기존 좌표 이동 회귀 없음

## 10. 완료 기준

- 기본 진입에서 모든 Layer 조건 행이 한 그리드에 연속 표시된다.
- Layer 선택은 전체 보기에서 해당 위치로 이동하며 다른 Layer 행을 숨기지 않는다.
- `현재만`만 현재 Layer 필터 역할을 하고 선택·포커스·증거 문맥을 보존한다.
- 고정 컬럼 네 개와 Parameter별 독립 컬럼이 승인된 순서로 표시된다.
- 현재 Layer의 Backbone 출처가 프로젝트 전체 요약이 아니라 Layer 단위로 표시된다.
- 정상 쓰기 이후 모든 Layer는 조건 행을 하나 이상, POR를 정확히 하나 가진다.
- 기존 편집·paste·autosave·잠금·검증·이력·백본 비교 계약과 대규모 Grid 성능이 유지된다.
- 전체 테스트, 타입 검사, 린트, 빌드, 기계적 디자인 검사와 세 데스크톱 viewport 증거가 통과한다.
