# Phase 4 변경 이력 / 백본 비교 검증 인덱스

상태: **Phase 4 기능·성능 검증 완료** (2026-07-18). PR 병합 판단은 별도의 최종
changed-file review와 CI 결과를 따른다.

이 디렉터리는 변경 이력과 immutable backbone 기준 전체 비교의 재현 가능한 검증 근거를
모은다. 성능 기준, fixture, 표본 수, 예상 실행 계획은 검증 과정에서 완화하지 않았다.

## 정본 증거

| 증거 | 범위 | 결과 |
|---|---|---|
| [`G003/README.md`](G003/README.md) · [`G003/run.json`](G003/run.json) | 20,000-coordinate backbone diff 최초 기준선 | PASS |
| [`G006/README.md`](G006/README.md) · [`G006/run.json`](G006/run.json) | 최종 backend/frontend/browser, history index·성능, 재시도 및 안전성 | PASS |

`G003` 파일은 최초 성능 기준선으로 고정되어 있으며 G006 마감 과정에서 변경하지 않았다.
`G006`은 실패 시도도 삭제하지 않고, 마지막 실패 뒤 연속 성공한 실행을 별도로 기록한다.

## 완료된 계약

- Phase 1~3의 append-only event를 타임라인, 필터, batch detail, 셀 이력에서 조회한다.
- 생성·layer 교체 당시의 backbone snapshot은 source 프로젝트의 이후 변경과 독립적이다.
- baseline/current의 모든 조건 행과 셀을
  `added/changed/cleared/removed/unchanged`로 비교한다.
- 신뢰할 수 없는 기존 행은 live source로 대체하지 않고 `baseline_unavailable`로 표시한다.
- history head schema는 primary key와 10개 composite/partial index만 유지하고, 대체된 두
  legacy 단일-column index는 제거한다.
- history write overhead와 20k backbone diff는 고정된 예산과 측정 규약을 통과했다.

## 최종 검증 요약

- Backend broad suite: `733 passed, 1 skipped`; Ruff와 Pyright 통과.
- Frontend: 93 test files / 984 tests, typecheck와 production build 통과.
- Production browser QA: available/unavailable fixture 각각 1024/1440/1920 viewport에서
  drill-down, 셀 이동, keyboard/focus, 오류·overflow·H1 ring 부재를 확인했다.
- History gate: 변동으로 인한 실패를 보존한 뒤 standalone gate 2회 연속 성공, focused
  PostgreSQL suite 2회 연속 성공.
- Backbone diff gate: 두 controlled run 모두 통과; `cell_limit_100` p95는
  `505.627053 ms`, `531.924766 ms`로 `600 ms` 예산 이내였다.
- 종료 안전성: disposable DB orphan 0, admin non-system table/view 없음, 보호 서비스와
  SQLite review data가 사전 기준에서 변하지 않았다.

정확한 표본, 비율, index 목록과 실행별 수치는 [`G006/run.json`](G006/run.json)에 있다.

## Phase 5 handoff

Phase 4 완료는 Phase 5의 무조건적인 착수를 의미하지 않는다. 결정 D-10의 **SSO 인증 구조
상세(방식, IdP 연동, 사용자/권한 식별 계약)**가 아직 확정되지 않았으므로, 이를 먼저
결정한 뒤 Phase 5 T6 RBAC을 구현한다. 이 외의 Phase 4 history/backbone 계약은 후속 단계가
재사용할 수 있도록 고정됐다.
