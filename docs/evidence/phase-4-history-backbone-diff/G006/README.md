# G006 Phase 4 최종 마감 증거

상태: **PASS**. 구조화된 정본 수치는 [`run.json`](run.json)이다.

## 검증 대상

- 최종 delivery 검증 parent: `14455c3ae2867e15927f1403bf595a36a7bc78f2`
- Backend frozen runtime: Python 3.14.3
- PostgreSQL 검증은 guard가 만든 `pcm_phase26_test_<uuid>` disposable DB에서만 실행했다.
- 기준선 `G003/README.md`와 `G003/run.json`의 내용은 변경하지 않았다.

위 parent는 remote PR branch에서 조회할 수 있는, 이 evidence-only 후속 변경의 직접 부모다.
최종 full suite와 최적화 후 controlled sample 2회가 같은 clean parent를 검증했다. 이
parent는 stored snapshot을 한 번만 검증하고 동일 column graph를 request-local로만 재사용해
CI에서 드러난 latency 회귀를 제거한다. 기준, fixture, sample, query/response 계약은 바꾸지
않았다.

## Backend / frontend 기준선

- Backend: frozen sync, Ruff, Pyright 통과; 최종 guarded full suite
  `742 passed, 1 skipped, 64 warnings in 735.11s`.
- Frontend: `npm ci`, typecheck, production build 통과; 93 files / 984 tests 통과.
- Browser: available/unavailable production fixture를 각각 1024/1440/1920 viewport에서
  확인했다. 계층 drill-down, 셀 이동, lazy detail, Shift+F10/Escape focus, unavailable action
  차단이 모두 정상이고 console/network/runtime/loading 오류와 horizontal overflow, H1 ring이
  없었다.
- CI 정의는 PostgreSQL 16 backend frozen sync/Ruff/Pyright/Pytest와 frontend
  install/typecheck/build/test를 모두 포함한다. Browser viewport QA는 local release gate로
  수행했으며 CI 자동화 범위에는 포함되지 않는다.

PR CI는 기준을 완화하지 않은 채 latency red 2회를 보존했다. `29630137199`는 backend
`2 failed, 737 passed, 1 skipped`, `29630283047`은 `1 failed, 738 passed, 1 skipped`였다.
중복 snapshot parse를 제거한 parent의 `29631000932`는 backend
`742 passed, 1 skipped`와 frontend gate가 모두 통과했다.

## History gate — 실패를 포함한 연속 실행

검증은 warmup 1회, measured sample 5회와 overhead ceiling `0.20`을 유지했다.

1. 최초 focused migration/capture/concurrency/history suite는
   `1 failed, 35 passed, 22 warnings in 554.79s`였다. 유일한 실패는 paste overhead
   `0.268353`; pre/post samples는 각각
   `[90.864, 156.993, 93.99, 97.366, 98.091]`,
   `[121.743, 123.719, 182.448, 123.495, 95.864]`였다.
2. 독립 standalone attempt 1도 `0.36203861369010976`으로 실패했다. pre/post는
   `[33.355, 32.863, 33.407, 34.53, 34.737]`,
   `[50.638, 45.501, 76.317, 38.976, 42.102]`였다.
3. 마지막 실패 뒤 standalone attempt 2와 3이 연속 통과했다. 비율은
   `0.082221474953739`, `-0.020004114015582018`이고 두 실행 모두 `failures=[]`였다.
4. 그 뒤 focused suite도 독립적으로 2회 연속 통과했다:
   `36 passed, 22 warnings in 231.89s`,
   `36 passed, 22 warnings in 206.14s`.

Standalone 비율은 focused pytest 재실행의 수치로 간주하지 않는다. 실행 종류와 결과를
[`run.json`](run.json)에 분리했다.

## Index / plan 계약

Head에는 `change_event_pkey`와 10개 required composite/partial index가 정확히 존재했다.
대체된 `ix_change_event_project_id`, `ix_change_event_event_type`은 없었다. 계획 검증 대상
query는 예상 composite index를 사용했고 `change_event` sequential scan은 없었다.

## Backbone diff 연속 실행

동일한 고정 fixture와 예산으로 기존 2회 및 최적화 후 clean parent 2회가 모두
`failures=[]`였다. 마지막 2회는 CI와 같은 Python 3.13 계열에서 실행했다.

| run | pure p95 | root p95 | condition p95 | cell p95 |
|---|---:|---:|---:|---:|
| 1 | 188.488 ms | 525.351945 ms | 451.111564 ms | 505.627053 ms |
| 2 | 180.278295 ms | 489.203253 ms | 457.734004 ms | 531.924766 ms |
| 3 (`14455c3`) | 172.828378 ms | 427.216757 ms | 377.486606 ms | 429.662717 ms |
| 4 (`14455c3`) | 175.141968 ms | 431.531921 ms | 385.822654 ms | 445.704138 ms |

Pure budget는 p95 `<=250 ms`, 각 HTTP path budget은 p95 `<=600 ms`로 유지했다.

## 종료 안전성과 해석

- orphan `pcm_phase26_test_*` DB: 0
- admin non-system table/view: 없음
- 사전에 실행 중이던 보호 서비스는 그대로 유지했고, 사전에 unavailable이던 browser
  debug port도 새 회귀로 계산하지 않았다.
- 보호 SQLite review data count는 `project=1`, `parameter=60`, `change_event=198`,
  `choice_set=5`로 동일했다.

초기 history red와 두 PR CI performance red는 host 부하와 작은 sample의 분산만으로
delivery를 판정할 수 없음을 보여 줬다. 실패를 숨기거나 rerun으로 덮지 않고 실제 중복 parse
hot path를 줄인 뒤 clean parent controlled run 2회와 PR CI green을 확보했다. 기준·fixture·
표본 수·예상 plan은 변경하지 않았다.
