# 프로젝트 생성 화면 명료화 설계

- **Status:** Approved
- **Approved:** 2026-07-16
- **Selected direction:** A — 작업 집중형 3단계
- **Design authority:** [`DESIGN.md`](../../../DESIGN.md)
- **Implementation scope:** `/projects/new`

## 1. 배경과 문제

프로젝트 생성 기능은 Process 선택, 백본 선택, Layer 매칭 확인, Project Profile 입력을
안전하게 수행하지만 기능별 UI를 카드와 테두리로 계속 감싸면서 정보의 우선순위가
약해졌다. 1440×900 증거 화면에서는 다음 문제가 확인된다.

1. 페이지 제목, 큰 3단계 카드, 현재 단계 제목이 같은 내용을 반복한다.
2. 현재 단계 안에서 요약, 네 개 통계, 매칭표, 필수 입력이 모두 동일한 시각 무게를 갖는다.
3. 전체 폭의 2열 입력은 시선 이동 거리가 길고 필드 간 관계가 약하다.
4. Layer 매칭표 높이에 따라 `프로젝트 생성` 행동과 비활성 이유가 화면 아래로 밀린다.
5. surface 안에 surface, stat 카드, input 테두리가 중첩되어 실제 선택과 상태가 눈에 띄지 않는다.
6. 사용자는 생성 직전에도 “무엇을 검토하고 무엇을 입력해야 하는지”를 한 번 더 해석해야 한다.

검토 근거:

- `DESIGN.md`
- `docs/superpowers/specs/2026-07-13-phase-2-5-ui-ux-design.md`
- `frontend/src/features/projects/ProjectCreatePage.tsx`
- `frontend/src/features/projects/ProjectCreateWizard.tsx`
- `docs/superpowers/evidence/phase-2-6/screenshots/wizard-required-loading-1440x900.png`
- `docs/superpowers/evidence/phase-2-6/screenshots/responsive-project-list-1440x900.png`

## 2. 목표와 비목표

### 목표

1. 한 단계에서 사용자가 내려야 할 결정 하나를 가장 먼저 보이게 한다.
2. 기존 3단계 흐름과 URL 복원 계약을 유지하면서 반복 제목과 중첩 surface를 줄인다.
3. 생성 직전 화면에서 매칭 결과와 필수 프로젝트 정보를 명확히 분리한다.
4. 1440px 이상에서 필수 입력과 생성 행동을 안정적으로 찾을 수 있게 한다.
5. 1024px에서도 본문 수평 overflow 없이 순서대로 검토하고 생성할 수 있게 한다.
6. 기존 오류 복구, 선택지 관리 이동, 중복 프로젝트 유도, dirty 경고를 회귀시키지 않는다.

### 비목표

- 백엔드 API, payload, 검증 규칙, 매칭 알고리즘 변경
- 생성 초안의 브라우저 영속 저장
- App Shell 전체 재설계
- 프로젝트 목록·상세·조건표의 동시 시각 개편
- 새로운 UI 라이브러리, 폰트, 아이콘 의존성 추가
- 모바일 프로젝트 생성 최적화

프로젝트 목록·상세와 조건표/그리드는 이 작업의 결과를 검증한 뒤 별도 slice로 다룬다.

## 3. 선택한 방향

기존 **Process → 백본 → 매칭 확인·프로젝트 정보** 3단계를 유지한다. 단계 수나 데이터
흐름을 바꾸지 않고 각 단계의 레이아웃 위계만 고친다.

기각한 대안:

- **단일 스크롤 화면:** 모든 선택을 한 화면에서 수정하기 쉽지만 Process 결과, 백본 후보,
  매칭표, Profile 입력이 다시 같은 화면에 쌓인다.
- **좁은 중앙 Wizard:** 입력에는 적합하지만 긴 Process 식별자와 Layer 매칭표를 검토할
  공간이 부족하다.

## 4. 공통 화면 구조

### 4.1 페이지 프레임

- `/projects/new`만 읽기 폭을 제한하는 중앙 작업 프레임을 사용한다.
- App Shell의 전역 폭은 바꾸지 않는다.
- 페이지 머리에는 `프로젝트 목록` 복귀 행동, `새 프로젝트 만들기` 제목, 한 줄 설명만 둔다.
- 제목 아래 Wizard와 본문 사이 간격은 20px 리듬을 유지한다.

### 4.2 단계 표시

- 현재의 세 개 큰 카드형 버튼을 얇은 진행 표시로 바꾼다.
- 각 단계는 번호/완료 아이콘, 짧은 제목, 현재 상태를 제공한다.
- 현재 단계만 brand 색을 강하게 사용하고 완료/미완료는 중립 색으로 낮춘다.
- 완료 단계는 계속 키보드로 돌아갈 수 있어야 하며 `aria-current="step"` 계약을 유지한다.
- 단계 표시가 이미 순서를 말하므로 본문의 `1단계`, `2단계`, `3단계` 반복 표시는 제거한다.
- 단계가 바뀌면 현재 단계의 `h2`로 focus를 보내는 기존 동작을 유지한다.

### 4.3 surface와 강조 규칙

- Wizard 전체에는 한 개의 주 surface만 사용한다.
- 목록 행과 통계는 기본적으로 구분선과 여백을 사용하고 독립 카드 남발을 피한다.
- 선택됨, 경고, 오류, 현재 단계만 색 있는 배경을 쓴다.
- 그림자는 overlay가 아닌 본문 surface에서 제거한다.
- 제어 높이, 색, focus ring은 기존 semantic token과 공통 컴포넌트를 재사용한다.

## 5. 단계별 설계

### 5.1 Process 확인

- 검색과 결과 목록을 주 영역으로 둔다.
- 결과는 카드 grid 대신 구분선 기반 선택 목록으로 표시한다.
- 행의 첫 줄은 `LINE / Process`, 둘째 줄은 안정 식별자, 오른쪽은 프로젝트 존재 여부와
  선택 상태다.
- 선택한 Process 요약은 데스크톱에서 오른쪽 sticky 보조 영역으로 유지한다.
- 아직 선택하지 않았을 때는 안내 한 문장만 보여준다.
- 다음 단계 버튼은 선택 요약 하단에서 `백본 선택으로` 한 개만 강조한다.

### 5.2 백본 선택

- `백본 없이 시작`을 후보와 동일한 선택 행으로 제공하되 첫 번째에 고정한다.
- 후보는 프로젝트명, Part ID, Layer 매칭률, 미매칭 수를 한 번에 비교할 수 있는 조밀한
  목록으로 표시한다.
- 선택한 행만 brand subtle 배경을 사용한다.
- 이전/다음 행동은 본문 하단의 한 줄 action bar에 둔다.

### 5.3 매칭 확인·프로젝트 정보

1440px 이상에서 두 개의 책임 영역으로 나눈다.

- **왼쪽 `매칭 검토`:** 선택한 Process/백본, 매칭·미매칭·복사 규모, Layer 매칭표.
- **오른쪽 `프로젝트 필수 정보`:** Part ID, 프로젝트명, Device Type, Project Category,
  Comment, 비활성 이유, 생성 오류, `프로젝트 생성` 행동.

세부 계약:

1. 오른쪽 영역은 360–420px 범위로 고정하고 viewport 안에서 sticky로 유지한다.
2. 왼쪽 매칭표는 자체 세로/가로 scroll을 가지며 페이지의 생성 행동을 아래로 밀지 않는다.
3. 네 개의 독립 통계 카드는 하나의 compact summary strip으로 합친다.
4. `프로젝트 생성` 버튼과 비활성 이유는 오른쪽 영역 하단에서 서로 붙여 표시한다.
5. 선택지 loading/error/inactive 안내는 해당 필드 바로 아래에 유지한다.
6. 생성 오류가 발생해도 입력과 매칭 선택을 유지한다.
7. 1024–1439px에서는 영역을 한 열로 쌓되 매칭 요약 → 프로젝트 정보 → Layer 상세 순으로
   읽히게 한다. Layer 표만 내부 수평 scroll을 허용한다.

## 6. 콘텐츠 규칙

- 페이지 제목은 `새 프로젝트 만들기`로 행동을 분명히 한다.
- 본문 단계 제목은 `Process 선택`, `백본 선택`, `매칭 검토 및 프로젝트 정보`로 맞춘다.
- 도메인 식별자인 Process, Part ID, Device Type, Project Category, Layer는 기존 표기를 유지한다.
- 설명은 한 문장으로 제한하고 이미 보이는 상태를 반복하지 않는다.
- 비활성 사유는 버튼과 인접한 위치에서 `문제 + 다음 행동` 순으로 보여준다.
- 새로고침 시 Profile과 수동 매칭 입력이 초기화된다는 기존 안내는 Wizard 하단에 한 번만 둔다.

## 7. 접근성과 반응형

- WCAG 2.2 AA와 `DESIGN.md`의 focus/contrast 계약을 유지한다.
- 단계 navigation, 선택 목록, Process 요약, 매칭 검토, 프로젝트 필수 정보에 명시적
  accessible name 또는 landmark heading을 제공한다.
- 선택 행은 `aria-pressed`, 현재 단계는 `aria-current="step"`을 유지한다.
- sticky는 시각 배치에만 사용하며 DOM 읽기 순서와 키보드 순서를 왜곡하지 않는다.
- 1024×768, 1440×900, 1920×1080에서 body horizontal overflow가 없어야 한다.
- 1440×900의 정상 fixture에서 생성 행동과 비활성 사유가 최초 viewport 안에 보여야 한다.
- `prefers-reduced-motion`과 기존 focus ring token을 그대로 사용한다.

## 8. 기능 보존 계약

다음 동작은 레이아웃 변경 전후가 동일해야 한다.

1. query string의 step/process/backbone 복원과 잘못된 route reconciliation
2. 선택 변경 시 수동 override 초기화 및 preview fingerprint 갱신
3. 이미 프로젝트가 있는 Process의 생성 차단과 기존 프로젝트 이동
4. 백본 없이 시작, 자동 매칭 유지, 수동 매칭 선택
5. Device Type/Project Category loading/error/inactive/empty 복구
6. Part ID, 프로젝트명, Profile 필수 선택이 완료될 때만 생성 허용
7. 중복 submit 방지, 생성 성공 이동, 실패 시 입력 보존
8. unsaved-change navigation/browser 경고

## 9. 구현 경계

- 수정 중심 파일:
  - `frontend/src/features/projects/ProjectCreatePage.tsx`
  - `frontend/src/features/projects/ProjectCreateWizard.tsx`
  - `frontend/src/features/projects/ProjectCreateWizard.test.tsx`
- 필요하면 Wizard 내부 presentational section만 같은 feature 폴더의 작은 파일로 추출한다.
- `wizardState.ts`, API 모듈, backend는 기능 회귀가 발견되지 않는 한 수정하지 않는다.
- 새 dependency나 전역 raw color를 추가하지 않는다.
- 반복되지 않는 단발 wrapper를 shared component로 승격하지 않는다.

## 10. 검증과 완료 조건

### 자동 검증

- 현재 Wizard route/state/choice 테스트가 모두 통과한다.
- 레이아웃 landmark와 단계 의미를 고정하는 회귀 테스트를 먼저 실패시킨다.
- 전체 frontend Vitest, typecheck, lint, production build를 통과한다.
- `git diff --check`를 통과한다.

### 브라우저 검증

- 1024×768: 한 열 흐름, body overflow 없음, 모든 필수 행동 접근 가능
- 1440×900: 매칭 검토/필수 정보 2열, 생성 행동 최초 viewport 내 노출
- 1920×1080: 작업 프레임이 과도하게 벌어지지 않고 필드 폭이 안정적
- 키보드: 단계 복귀, Process/백본 선택, 필수 입력, 생성 행동 접근
- loading/error/empty/duplicate 상태에서 입력·선택 문맥 보존
- 변경 전후 스크린샷을 현재 branch의 재현 가능한 증거로 저장

## 11. 후속 slice

이 작업을 완료하고 같은 시각 규칙이 실제 사용성을 개선하는지 확인한 뒤 다음 순서로 진행한다.

1. 프로젝트 목록·상세의 정보 밀도와 빈 공간 정리
2. 공통 PageHeader와 App Shell의 계층 일관성 정리
3. 조건표 헤더·카테고리 선택·검증 워크벤치의 시각 소음 정리
4. Glide grid의 고정 열, 상태 표시, 선택/오류 대비 재검토

