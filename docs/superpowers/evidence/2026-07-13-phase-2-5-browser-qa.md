# Phase 2.5 Browser QA Evidence

Phase 2.5의 구현 완료 판정은 화면 인상만이 아니라, 고정된 소스 커밋에 대한 저장소 게이트,
독립 URL/history, 실제 API를 통한 업무 회귀, 다중 브라우저 잠금, 세 viewport의 렌더링,
키보드·접근성 및 독립 시각 판정을 함께 근거로 한다.

## Environment

- **검증일:** 2026-07-14 (Asia/Seoul)
- **source-under-test:** `2ecf33d2ede065eecf94d6d605f6f1eec1b3e2d3`
  - 이 문서와 로드맵만 후속 documentation commit에 포함되므로, 위 해시가 브라우저와 자동화
    게이트가 실제로 실행된 애플리케이션 소스 해시다.
- **Browser:** headless Chromium `145.0.7632.6`, Playwright `1.57.0`
- **격리 스택:** Compose project `pcm-phase25-qa`; 전용 volume
  `pcm-phase25-qa_app-db-data`, `pcm-phase25-qa_ingest-db-data`,
  `pcm-phase25-qa_frontend-node-modules`
- **Ports:** app DB `15432`, ingest DB `15433`, backend `18000`, Vite health smoke `15173`,
  검증한 `frontend/dist` 정적 파일과 `/api` proxy `15174`
- **실행 경계:** `INGEST_READER=pg`; backend health와 Vite dev server를 smoke 확인한 뒤,
  실제 배포 산출물인 production build를 `15174`에서 브라우저 검증했다. 개발 React
  StrictMode의 effect 재실행이 잠금 수명주기를 왜곡하지 않도록 업무 회귀 판정에는 production
  build를 사용했다.
- **Fixtures:** Process `QA::PROC_001`–`QA::PROC_205`; 페이지 복원용 프로젝트 60개;
  `SEED_PROJECT_ID=1`, `INACTIVE_PARAMETER_ID=1`, `CHOICE_PARAMETER_ID=3`,
  `AUTO_SOURCE_PROJECT_ID=62`. 목록 API의 첫 200개 밖에 있는 `QA::PROC_205`도 direct detail로
  조회되는 것을 확인했다.
- **대형 시트:** 201 live parameter columns, 80 layers, 검증 시작 시 98 condition rows. 구조 변경
  QA로 add/duplicate/delete를 수행했고 모든 상태는 격리 volume 안에서만 변경했다.
- **종료:** 브라우저, 임시 정적 서버, Compose container/network/volume 및 임시 Playwright
  harness를 제거했고, 마지막 lock row는 0건이었다.

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| Clean pre-gate tree | PASS | source-under-test에서 `git status --short` 출력 없음 |
| Frontend `npm run lint` | PASS | 현재 script는 `npm run typecheck` alias이며 **ESLint 검사가 아니라** `tsc -b --pretty false`임을 확인 |
| Frontend explicit typecheck | PASS | `npm run typecheck`, exit 0 |
| Frontend tests | PASS | Vitest 43 files, 339 tests 통과 |
| Frontend production build | PASS | Vite 6.4.1, 2,161 modules, build 완료 |
| Backend Ruff | PASS | `uv run ruff check .` — all checks passed |
| Backend Pyright | PASS | 0 errors, 0 warnings, 0 informations |
| Backend tests | PASS | 150 collected; 147 passed, 3 environment-scoped marks; total coverage 97%, exit 0 |
| Frozen scope | PASS | baseline `32b4de4b696051147fe440f2ff97b53061029931` 대비 `backend`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/api/types.ts` 변경 없음 |
| Phase 2 persistence seams | PASS | cells/locks/conditions API, `useSheetEditing`, edit store, autosave, paste staging, grid type 계약 변경 없음 |
| Diff hygiene | PASS | pre-documentation `git diff --check` 출력 없음 |

## Route and history matrix

| Scenario | Result | Observed URL/focus/scroll |
|---|---|---|
| 프로젝트 검색 direct/reload | PASS | `/projects?query=PROC_SEED&status=draft`; 1 row, reload 뒤 query/status와 page title focus 유지 |
| Load-more → detail → native Back | PASS | 50→60 rows; `/projects/2`에서 Back 후 cached 60 rows, scroll `1462→1582`, `A[data-project-id=2]` focus 복원 |
| 첫 200개 밖 Process direct | PASS | `/projects/new?step=1&process=QA%3A%3APROC_205`; picker는 limit 50이나 exact detail 선택은 유지 |
| Wizard valid step 3 | PASS | `/projects/new?step=3&process=QA%3A%3APROC_205&backbone=1`을 그대로 복원 |
| Wizard stale/invalid query | PASS | stale Process는 step 1, stale backbone은 step 2로 정규화; invalid `step/backbone`은 안전한 step 1 렌더 |
| Project detail direct/reload | PASS | `/projects/1` 유지, 독립 detail 책임과 title focus 확인 |
| Sheet direct/reload | PASS | `/projects/1/sheet` 유지, Focus Shell 1개와 production reload 후 `편집 잠금` 유지 |
| Parameter inactive direct/reload | PASS | `/parameters?query=param_000&active=inactive&edit=1`; 비활성 row와 drawer 복원, `H2 파라미터 수정` focus |
| Invalid project ID | PASS | invalid token은 명시적 오류를 렌더하고 API mutation/lock을 만들지 않음 |
| Missing project/detail/sheet | PASS | 404 detail과 sheet가 각각 명시적 not-found 상태를 렌더하고 editor를 열지 않음 |
| Invalid/missing parameter edit | PASS | invalid edit token과 404 entity가 filter URL을 보존한 drawer 오류를 렌더 |
| Wizard Back/Forward | PASS | step 3→2→3 native history에서 Process 선택 유지 |
| Wizard dirty navigation | PASS | 첫 confirm 취소는 현 URL 유지, 진행 선택은 `/processes` 이동 |
| Drawer Back/Forward + dirty navigation | PASS | edit open→closed→open 복원; dirty 취소는 drawer 유지, 진행은 filtered list로 복귀 |

## Business regression matrix

| Scenario | Result | Network/state evidence |
|---|---|---|
| Project create — no backbone | PASS | `POST /api/projects` 201, project `70`; `backbone=null`, target layer와 base condition 생성 |
| Project create — automatic + manual match | PASS | project `71`; auto match 유지, `015/WELL` manual override 1건, source-backed layer 2개 |
| Duplicate pre-block | PASS | `has_project=true`에서 mutation 0건, existing project `70` link 노출 |
| Duplicate 409 with existing ID | PASS | raced stale state의 POST 409가 `/projects/70` link를 제공하고 draft 유지 |
| Duplicate 409 search fallback | PASS | usable ID가 없는 409는 `/projects?query=PROC_202`로 안내하고 false detail link 없음 |
| Layer backbone replacement | PASS | `POST /api/projects/71/layers/.../backbone-replace` 200; source project `62`, modal trigger `교체`로 focus 복원 |
| Process Catalog actions | PASS | unused Process는 `/projects/new?step=1&process=QA%3A%3APROC_204`, existing Process는 `/projects?query=PROC_203` |
| Parameter create/edit/deactivate | PASS | parameter `201` POST/PATCH 후 deactivate POST 200; server `is_active=false` |
| Unsupported nullable clear | PASS | backend가 지원하지 않는 unit clear는 경고와 `aria-disabled=true`; PATCH 0건 |
| Choice partial save + retry | PASS | parameter PATCH 1회 성공, intercepted options PUT만 실패; draft 유지 후 retry가 PUT 1회만 보내고 두 번째 PATCH 없음 |
| CSV dry-run/apply/error row | PASS | preview 200 `신규1/오류1`; apply 200 `created1/error1`, 오류 row와 완료 status 동시 표시 |
| Category create-only | PASS | `POST /api/parameters/categories` 201; dialog close 후 category list refetch |
| Same-user tab fencing | PASS | A/B 모두 `dev-admin`이나 서로 다른 token; A만 편집, B는 `읽기 전용 · 편집 중: dev-admin`, condition manager 없음 |
| Read-only mutation boundary | PASS | B의 hostile Canvas edit/paste 동안 business mutation 0건; holder를 guide에 명시 |
| Lock release/reacquire | PASS | A unload 후 B가 server heartbeat 주기(45s)에 reload/remount 없이 자동 획득; window/Canvas marker와 URL 유지 |
| Choice single-click | PASS | condition 1 / `param_002` 한 번 클릭으로 select overlay; low/mid/high/auto 및 live options 확인 |
| Canvas copy | PASS | focused `param_001` cell에서 clipboard TSV `val-0-1` 확인 |
| Paste review cancel | PASS | 2×2 4 cells staging; `적용 또는 취소 후 계속`, condition manager 제거; Cancel 뒤 server mutation 없음 |
| Paste review apply | PASS | 동일 2×2 apply가 `PATCH /api/projects/1/cells` 200을 정확히 1회 전송; 4 values persisted |
| Condition add/duplicate/delete | PASS | POST 201, POST 201, DELETE 204; 행 수 net +1과 deleted ID 부재 확인 |
| POR transfer | PASS | `PUT /api/projects/1/conditions/2/por` 200; base `true→false`, C2 `false→true`, `POR (○ 선택)` 96px |
| Hidden-category search/jump | PASS | photo에서 `param_196` 검색 후 etch commit, `scrollLeft=4930`, search focus 유지, polite status 발표 |
| Cell autosave | PASS | `qa_csv_task11=AUTOSAVE-TASK11`; debounce PATCH 200, header `저장됨` |
| Dirty unload | PASS | `qa_csv_task11_b=UNLOAD-FLUSH-TASK11`; network 순서가 cell PATCH 200 → lock DELETE 204 |

의도적으로 발생시킨 lock acquire 409 한 건은 B의 읽기 전용 전환 계약에 해당한다. 그 외 최종
browser page error는 0건이며, 마지막 backend/frontend log scan에서 traceback, exception,
의도하지 않은 5xx를 찾지 못했다.

## Responsive and accessibility matrix

| Viewport/state | Result | Observation |
|---|---|---|
| Projects 1024×768 | PASS | 52px header, 36px rows, body x-overflow 0, sidebar/max-w-6xl 0, primary action unclipped |
| Projects 1440×900 | PASS | full-width table, 36px rows, body x-overflow 0, horizontal space 사용 |
| Projects 1920×1080 | PASS | full-width table, 36px rows, action와 filter clipping 없음 |
| Wizard 1024×768 | PASS | 3-step indicator와 Process picker/primary action이 document width 안에 있고 x-overflow 0 |
| Wizard 1440×900 | PASS | dense content hierarchy, stepper/selection/status association 유지 |
| Wizard 1920×1080 | PASS | full-width shell에서 정보 밀도와 primary action 정렬 유지 |
| Parameter drawer 1024×768 | PASS | drawer 409.59px = inclusive `lg`의 `max-width:40vw`; 8/8 visible controls labelled, footer visible |
| Parameter drawer 1440×900 | PASS | 480px drawer, native modal/accessible title, 36px registry rows |
| Parameter drawer 1920×1080 | PASS | 480px drawer, full-height, table/action clipping 없음 |
| Parameter drawer below 1024 | PASS | 별도 800×700 probe에서 800px full-width drawer, x-overflow 0 |
| Sheet 1024×768 | PASS | 40px Focus Header + 137px controls + 591px grid = viewport 768px, double scroll 없음 |
| Sheet 1440×900 | PASS | 40 + 137 + 723 = 900px, body/document overflow 없음 |
| Sheet 1920×1080 | PASS | 40 + 137 + 903 = 1080px, remaining viewport 전부 Canvas가 사용 |
| Empty workbench | PASS | 세 viewport 모두 `[data-sheet-workbench]` node 0, 예약 height 0 |
| Skip links and nav | PASS | keyboard focus 시 skip link visible 2px outline; activation 후 `main#main-content`, 다음 action도 2px outline; current nav `aria-current=page` |
| Wizard keyboard/stepper | PASS | keyboard selection 후 step 2 URL/heading focus, selection 보존, atomic polite status |
| Drawer focus/Escape/restore | PASS | native modal 내부 forward/backward wrap, Escape로 URL edit 제거, original row trigger에 2px focus 복원 |
| Sheet keyboard toolbar | PASS | sheet skip link→main; search label/description, category `aria-pressed`, 2px focus outline 확인 |
| Live semantics | PASS | interaction/search/save에 `role=status`; validation/API state에는 `role=alert`; labelled form controls 확인 |
| Reduced motion | PASS | `prefers-reduced-motion: reduce`에서 transition/animation 최대 `0.01ms`, scroll behavior auto |

모든 화면에서 persistent sidebar 0, global `.max-w-6xl` 0, body horizontal overflow 0을
측정했다. General Shell header는 52px, Sheet Focus Header는 40px였다.

## Visual verdict

| Iteration | Score | Result | Blocking findings | Resolution |
|---|---:|---|---:|---|
| Final independent review | 98/100 | PASS | 0 | 12 final screenshots에서 A2/V1/P1/W1/M1/S1-C와 clipping·density·responsive hierarchy 확인 |

1440/1920 Sheet는 viewport resize 뒤 Glide repaint가 지연된 최초 harness 캡처를 폐기하고, 각각 독립 fresh-load에서 Canvas `1440×723`/`1920×903`을 재측정·재캡처했다. 이는 제품 결함이 아닌 캡처 절차 수정이다.

시각 판정 JSON은 `.omx/state/phase-2-5/ralph-progress.json`에도 byte-identical하게 보존했다.

## Known warnings and explicit boundaries

- Vite build에는 baseline부터 있던 Glide/Rollup `/*#__PURE__*/` annotation 위치 경고와
  minified chunk `>500 kB` 경고가 남는다. build는 성공했고 브라우저 runtime 실패는 없었다.
- `npm run lint`는 현재 TypeScript typecheck alias다. 이 문서는 ESLint coverage를 주장하지 않는다.
- `GridDemoPage`는 D-18의 **DEV-only 그리드 평가 route**라 raw evaluation styling과 legacy
  button을 일부 유지한다. Phase 2.5 production business surface 판정에서 제외했으며,
  Projects/Wizard/Processes/Parameters/Sheet에는 V1 semantic token을 확인했다.
- Glide는 Canvas grid다. semantic grid/column/cell role을 노출하지만, screen reader를 위해
  보이는 모든 셀을 복제한 병렬 HTML table을 만들지는 않는다. 이는 승인된 adapter/library
  경계이며 keyboard toolbar, focus, status와 read-only 안내를 별도로 검증했다.
- 현 API는 nullable clear 일부를 지원하지 않고 parameter 본문 PATCH와 choice options PUT을
  원자적 단일 요청으로 제공하지 않는다. UI는 unsupported clear를 전송 전에 막고, 부분 성공을
  사실대로 알린 뒤 options-only retry를 제공한다.
- Backend, API schema, dependencies와 lockfile은 변경하지 않았다. 검증을 위해 만든 Process,
  project, parameter, category와 sheet mutation은 제거한 격리 QA volume에만 존재했다.
