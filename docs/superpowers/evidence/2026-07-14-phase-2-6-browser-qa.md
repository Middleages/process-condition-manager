# Phase 2.6 Browser QA Evidence

Phase 2.6의 완료 판정은 Project Profile·Managed Choice 화면의 인상만으로 하지 않는다.
고정된 소스에서 새로 만든 production build, 같은 SHA를 label로 고정한 mount 없는 backend,
reset-only migration, 실제 PostgreSQL 동시성, 12개 브라우저 시나리오, 세 viewport,
keyboard·접근성 및 독립 시각·evidence 감사를 함께 근거로 한다.

## Environment and provenance

- **검증일:** 2026-07-15 (Asia/Seoul)
- **source-under-test:** `87b9c8e8b710540fa017de79aa70de87f1f9eb50`
  - git tree: `78568ca46019e329d768bfd5cd9d4e51e6918afe`
  - frontend tree: `279e87b33150955fb9558f9976cc83e7d1bdbb11`
  - 브라우저 시작과 종료 시 evidence 디렉터리를 제외한 worktree가 깨끗함을 다시 확인했다.
  - 이 문서와 evidence를 추가하는 후속 completion commit은 제품 소스나 위 tree를 바꾸지
    않는다. 따라서 검증 대상은 후속 문서 commit이 아니라 위 source-under-test다.
- **production build manifest:**
  [`phase-2-6/build-manifest.json`](./phase-2-6/build-manifest.json), canonical manifest identity
  `e59631a29d27e15324667bfaa01f8acb459ca928b72872931de4b4b122a45d4d`
  (serialized file SHA-256
  `6bb4217a9b63532daa1050d7e799be4bcc3ef30fb127991589b9fac21b380159`)
  - fresh `npm ci --include=dev`와 기존 `frontend/dist`/`tsconfig.tsbuildinfo` 삭제 후 build했다.
  - source/tree, lockfile, Node/npm, TypeScript/Vite, 정규화한 build 환경, 세 QA script,
    dist의 모든 파일과 body hash를 manifest에 결속했다.
  - dist identity: `dca7bf2e43cfc926beed6629422a4caa6c67aa2187f1c40cd87bbb23e6caa981`
- **Browser:** Playwright `1.57.0`, 실제 Chromium `143.0.7499.4`, Node `v22.22.0`
- **격리 스택:** Compose project `pcm-phase26-qa`; app DB `15432`, ingest DB `15433`,
  backend `127.0.0.1:18000`, Vite smoke `15173`, 검증한 production dist와 `/api` proxy
  `127.0.0.1:15174`. 별도 backend test DB는 `127.0.0.1:15442`였다.
- **backend-under-test:** container
  `aa7f26529db156cbb9d4bcd18f7a4e68af8296444279cbcdf612a692ab3245bd`, image
  `sha256:0c22484b7fc849fe6d3b6d9b494bff0bda7e3a47c9b51c4ce77d5948e94e903b`
  - image label `org.process-condition-manager.phase26.git-sha`가 source-under-test와 같았다.
  - read-only root filesystem, mount 0개, 공개 endpoint는 loopback `18000`뿐이었다.
- **브라우저 실행:** `2026-07-15T04:59:34.430Z`–`05:01:16.421Z`;
  [`results.json`](./phase-2-6/results.json)의 `fatal=null`, required `12`, passed `12`,
  failed `0`, skipped `0`을 확인했다.

운영 label은 운영자가 넣는 값이므로 서명된 공급망 증명은 아니다. 이번 판정은 clean source,
fresh dependency install/build, manifest body hash, mount 없는 image ID, 실행 전·후 container 검사를
함께 사용해 잘못된 소스나 산출물이 섞이는 false-green 위험을 줄였다.

## Delivered scope and preserved boundaries

- 프로젝트마다 고정 1:1 Profile을 생성하고 Device Type·Category·Comment를 생성 흐름에서 받는다.
  identity는 읽기 전용이며 나머지 Profile은 기존 프로젝트 lock/fencing token 아래 편집한다.
- `device_type`, `project_category`, `active_direction`, `gate_direction`의 고정 choice와
  parameter choice를 stable code·mutable label의 공유 ChoiceSet으로 관리한다.
- 비활성 기존 code는 label/경고와 함께 읽히고 unchanged/no-op은 보존된다. 신규 single/paste
  write는 active code만 허용하며 숫자값은 decimal string 문법으로 검증·정규화한다.
- 자동 metadata는 생성 시 Profile seed를 한 번 복사하는 provider 경계에만 있다. 현재 provider는
  외부 I/O가 없는 manual 구현이고, 생성 후 Profile 변경과 모든 조건표 셀은 수동 입력이다.
- Device Ref와 동적 Profile field, 쉼표 기반 parameter option, SheetOut의 embedded option array를
  제거했다. 기존 백본·조건 행·POR·잠금·자동저장·붙여넣기 계약은 유지했다.
- Phase 3가 추가 option-model migration 없이 choice 검증을 구현할 기반까지 완료했다. Phase 3
  검증 엔진과 Phase 5 승인 snapshot/Revision 자체를 선행 구현한 것은 아니다.

## Automated gates

| Gate | Result | Evidence |
|---|---|---|
| Backend Ruff | PASS | `uv run ruff check .` — all checks passed |
| Backend Pyright | PASS | 0 errors, 0 warnings, 0 informations |
| Backend full tests | PASS | 327 passed, 1 skipped, 30 warnings; total coverage 96%; 58.11s |
| Migration + seed PostgreSQL tests | PASS | 21 passed |
| Targeted concurrency + atomicity | PASS | 110 passed |
| Sheet performance | PASS | 279.7ms, 493,659 bytes, SQL 8회; shared set 1개/choice column 66개/embedded option 0개 |
| Frontend clean install | PASS with recorded audit risk | fresh `npm ci --include=dev`; dependency audit 위험은 아래에 별도 기록 |
| Frontend `npm run lint` | PASS | 현재 script는 `npm run typecheck` alias이며 **ESLint 검사가 아니라** `tsc -b --pretty false`임 |
| Frontend explicit typecheck | PASS | `npm run typecheck`, exit 0 |
| Frontend tests | PASS | Vitest 67 files, 684 tests |
| Frontend production build | PASS | Vite 6.4.1, 2,185 modules; manifest가 산출물 전체를 고정 |
| QA support tests | PASS | Node test 29/29; blank ARIA·AX ownership·provenance·static proxy false-green 방어 포함 |
| Browser required matrix | PASS | Playwright 12/12, failed 0, skipped 0, fatal 없음 |
| Independent visual verdict | PASS | 92/100, category match, blocking finding 0 |
| Independent evidence audit | PASS | 41개 artifact의 provenance, 시나리오 수, screenshot/ARIA/network 상호 일치; blocking finding 0 |

## Reset-only migration and PostgreSQL atomicity

Revision `0004_project_profile_managed_choices`는 호환 backfill이 아닌 의도적인 fresh-start
전환이다. PostgreSQL migration/seed 테스트는 다음 경계를 실제 DB에서 고정했다.

- 빈 base DB와 빈 revision `0003` DB 모두 `0004` head로 올라간다.
- `project_profile`, `choice_set`, `choice_option`, `parameter.choice_set_id`가 최종 ORM
  schema와 일치하고 obsolete `project.description`과 `parameter_option`은 남지 않는다.
- 첫 DDL 전에 `parameter_category`, `parameter`, `parameter_option`, `project`,
  `sheet_layer`, `layer_condition`, `cell_value`, `change_event`, `edit_lock` 9개 mutable table을
  각각 검사하며, 하나라도 row가 있으면 전환을 거부한다.
- offline 실행도 명시적으로 거부하고, 관리되는 seed가 ChoiceSet → parameter → project 순서로
  clean schema를 구성한다.
- 테스트 helper는 `pcm_phase26_test_<uuid>` DB만 생성·삭제하며 기준 `pcm_test`, ingest DB,
  기본 개발 volume을 downgrade/reset하지 않는다.

따라서 보존할 데이터가 존재하는 환경에는 `0004`를 그대로 적용해서는 안 된다. 별도
preservation migration을 승인·검증하거나, disposable app DB에만 문서화된 reset을 수행해야 한다.

110개 targeted test는 단순 mock이 아니라 격리 PostgreSQL에서 다음 경합을 검증했다.

- 같은 `expected_version`의 동시 ChoiceSet mutation 두 개 중 하나만 성공하고 다른 하나는
  `choice_set_changed`; version은 정확히 1회 증가한다.
- reorder/import는 stale version이나 오류에서 부분 반영되지 않는다.
- option deactivate와 consumer write가 경합해도 비활성 code가 신규 값으로 저장되지 않는다.
- Profile PATCH는 올바른 fencing token을 요구하고 conflict/loss에서 draft를 덮어쓰지 않는다.
- cell batch 오류와 provider failure는 전체 rollback하며 부분 row를 남기지 않는다.

## Required browser scenario matrix

| Scenario | Result | Observed evidence |
|---|---|---|
| `project.wizard-required-choice-retry-create` | PASS | required set loading과 2회 503 retry, no-active 관리 링크, stale Process/backbone reconciliation, submit당 POST 1회, untouched Comment omit와 touched-empty `null`, project 2·3 생성. [screenshots](./phase-2-6/screenshots/wizard-required-empty-1440x900.png) |
| `project.list-history-collapse` | PASS | 60 rows, query/status/Device/Category URL·API filter 복원, Back/Forward와 scroll `1632`·focus 복원, direct detail reload, Profile 값 31개, Device Ref 0개, viewport별 column collapse. [screenshot](./phase-2-6/screenshots/project-list-history-1440x900.png) |
| `project.profile-lock-fencing-recovery` | PASS | hostile PATCH 409 `lock_conflict`, holder retry, validation/network 회복 후 동일 draft 재시도, `001.5000→1.5`, nullable choice 명시적 clear, dirty guard와 focus return, lock loss에서 recovery copy 유지. [screenshots](./phase-2-6/screenshots/profile-save-recovery-1440x900.png) |
| `choice.lifecycle-search-reorder-warning` | PASS | list URL/direct detail, code+label 검색, case-only code 경고는 비차단, add/edit, 전체 5개 reorder, inactive filter, 사용 중 `MODE_002` 비활성 전 blast-radius 확인. [screenshot](./phase-2-6/screenshots/choice-lifecycle-deactivated-1440x900.png) |
| `choice.csv-preview-atomic-conflict` | PASS | preview 전후 version `5→5`, invalid/수정된 preview Apply 차단, 두 admin의 version 6 conflict에서 stale draft 보존, 명시적 reload/retry 후 atomic import version 7과 `QA_IMPORT_NEW`. [screenshot](./phase-2-6/screenshots/choice-csv-version-conflict-1440x900.png) |
| `choice.pagination-version-restart` | PASS | page 사이 mutation으로 version 3 cursor가 409를 받은 뒤 version 4의 page 1부터 재시작; mixed-version success 0, expected unique option 541개, terminal page 도달. [screenshot](./phase-2-6/screenshots/choice-pagination-restart-1440x900.png) |
| `sheet.choice-keyboard-focus-a11y` | PASS | 200 columns/121 rows 중 choice 66 columns가 set aggregate 1회를 공유; Enter open, code/label filter, Arrow/Home/End/Enter/Escape, grid focus return, 저장·복사 code `MODE_010`, tooltip `code · label`, embedded options 0. [screenshot](./phase-2-6/screenshots/sheet-choice-keyboard-1440x900.png) |
| `sheet.fail-closed-cache-version-refresh` | PASS | mandatory summary 503 두 번에도 stored display 유지·PATCH 0, retry 후 readiness 복구; background version 변경 중 commit 차단·PATCH 0, 정확한 version aggregate 뒤 복구. [screenshots](./phase-2-6/screenshots/sheet-summary-failure-display-only-1440x900.png) |
| `sheet.inactive-raw-decimal-paste` | PASS | inactive `MODE_002`는 읽히나 신규 목록에는 없음; raw `MISSING_CODE`, raw/inactive paste mismatch 2; `1e3`, `1,5`, 과장 길이 거부; single `1.5`, paste `0.5/TXT/1.5` canonical persistence; option 503 retry. [screenshots](./phase-2-6/screenshots/sheet-decimal-paste-canonical-1440x900.png) |
| `sheet.shared-resource-live-discovery` | PASS | 같은 set의 66 columns/embedded 0; 두 번째 admin mutation을 editor open `5→6`, window focus `6→7`, focused-sheet 60초 interval `7→8`에서 발견; version별 aggregate 시작은 정확히 1회. [screenshot](./phase-2-6/screenshots/sheet-live-discovery-1440x900.png) |
| `responsive.three-viewports` | PASS | project list/Profile drawer/sheet를 1024×768, 1440×900, 1920×1080에서 확인; body/document horizontal overflow 0, focus escape 0, drawer 폭 409.59/480/480px, choice listbox clipping 없음. [screenshots](./phase-2-6/screenshots/responsive-project-list-1024x768.png) |
| `accessibility.aria-focus-overflow` | PASS | skip link→main, current nav, combobox ownership/active descendant, selected code·label announcement, Enter/Escape grid focus 복귀; Chromium CDP AX tree가 Canvas-owned grid와 실제 header/cell을 노출하고 병렬 fake table은 0개. [AX artifact](./phase-2-6/aria/sheet-grid-chromium-ax.json) |

세부 request 순서, assertion, body hash와 전체 screenshot/ARIA 목록은
[`results.json`](./phase-2-6/results.json)에 있다.

## Network, static integrity, and evidence audit

- evidence leaf는 총 41개 파일, 4,543,114 bytes다: screenshot 30개, ARIA/AX 7개와
  manifest/results/network/console 4개다.
- [`network.jsonl`](./phase-2-6/network.jsonl)은 request/response/resource 960건을 기록한다.
  status는 200=532, 201=7, 204=26, 404=5, 409=6, 422=1, 503=6이며 static integrity error는 0이다.
- 브라우저가 받은 production asset은 manifest path, response body SHA-256, source SHA와
  manifest SHA를 대조했다. 누락 asset을 SPA shell로 위장하지 않았고 시작·종료 provenance가 같다.
- 404/409/422/503과 한 번의 failed PATCH는 missing entity, lock/version conflict, validation,
  fail-closed retry를 시험하기 위해 의도적으로 유발했다. [`console.jsonl`](./phase-2-6/console.jsonl)의
  error 17건은 모두 `expected=true`이며 unexpected page error나 fatal harness error는 없다.
- browser 종료 후 QA app DB의 `edit_lock`은 0건, test helper의 임시 DB도 0개였다. fixture와
  destructive migration은 격리 QA/test DB에만 쓰였고 기본 Compose volume은 대상이 아니었다.

## Responsive, keyboard, and Chromium AX evidence

| Viewport/state | Result | Observation |
|---|---|---|
| Project list 1024×768 | PASS | 6개 핵심 column 유지, body/document x-overflow 0 |
| Project list 1440×900 | PASS | Updated 포함 7개 column, URL filter/history와 dense row 유지 |
| Project list 1920×1080 | PASS | Layer Total 포함 8개 column, 남는 가로 폭 사용 |
| Profile drawer 1024×768 | PASS | width `409.59px`(40vw), tabbable control 31개, focus escape 없음 |
| Profile drawer 1440/1920 | PASS | width `480px`, full-height, 31개 control keyboard 순회 |
| Sheet 1024/1440/1920 | PASS | body/document x-overflow 0; choice listbox가 viewport 안에 유지 |
| Skip links/navigation | PASS | `본문으로 건너뛰기`, `조건표로 건너뛰기`, main focus와 current project nav 확인 |
| Combobox semantics | PASS | combobox/listbox/option ownership, active descendant, 선택 announcement 확인 |
| Focus return | PASS | Enter commit과 Escape cancel 모두 grid로 복귀; 전체 scenario focus escape 0 |
| Glide DOM boundary | PASS | Canvas fallback의 semantic table/`role=grid` 정확히 1개, Canvas 밖/앱 병렬 table 또는 grid 0개 |
| Chromium accessibility tree | PASS | CDP `Accessibility.getFullAXTree`에서 non-ignored grid 1개가 정확한 Canvas child로 노출; `aria-rowcount=122`, `aria-colcount=203`, rowgroup 2, exposed row 24, columnheader 11, gridcell 253 |

마지막 항목은 DOM에 role이 있다는 사실만 검사한 것이 아니다. pinned Chromium 143의 실제
accessibility tree에서 `Layer / Step`, `조건`, `POR (○ 선택)` 및 visible parameter header와
sample cell 값을 확인했다. Playwright `ariaSnapshot()`은 zero-layout Canvas fallback을
필터링하므로 grid 증거에는 원자적인 CDP AX tree를 사용했다. 제품에 off-screen proxy나 보이는
셀을 복제한 fake HTML table을 추가하지 않았고, 그 중복이 없다는 DOM 계약도 함께 고정했다.
다만 이 증거는 pinned Chromium 계약이며 다른 browser/screen reader 조합의 동작까지 주장하지 않는다.

## Visual verdict

Task 9–14의 독립 시각 판정은 각각 `97`, `96`, `94`, `92`, `94`, `94`점으로 모두
`pass`/`category_match=true`였다. 최종 screenshot 30개를 다시 검토한 Task 15 통합 판정은
**92/100, PASS, blocking finding 0**이다.
[판정 JSON](./visual/2026-07-14-phase-2-6-task-15.json)은 runtime state와 byte-identical하다.

남은 시각 차이는 차단 결함이 아니라 후속 polishing 대상으로 기록했다: 의도적 503에서 영문
transport 원문이 보이는 오류 문구, 1024px 프로젝트 목록 초기 위치의 상태 badge 일부 가림,
검색 결과 1개에도 유지되는 choice overlay 빈 높이, 1024px Profile drawer의 긴 choice 값 축약이다.

## Known warnings and explicitly deferred work

- 별도 `npm ci` audit output은 **11 vulnerabilities**(low 1, moderate 2, high 7, critical 1)를
  보고했다. 새 dependency를 추가하지 않았지만 도달 가능성이나 exploitability는 이번 범위에서
  평가하지 않았으므로 **보안 승인 또는 security clearance를 주장하지 않는다**. 회귀 검증 없이
  `npm audit fix`도 실행하지 않았다.
- production build에는 기존 Glide/Rollup의 misplaced `/*#__PURE__*/` annotation 제거 경고와
  minified chunk `>500 kB` 경고가 남는다. build/runtime는 통과했지만 tooling/performance
  advisory로 유지한다.
- `npm run lint`는 TypeScript typecheck alias다. ESLint coverage를 주장하지 않는다.
- Backend full suite의 유일한 skip은 `INGEST_TEST_DATABASE_URL`이 설정되지 않은 외부 ingest
  PostgreSQL environment gate다. 30개 warning은 Alembic `path_separator` deprecation이다.
- manifest는 자체 SHA-256이며 서명된 artifact가 아니다. backend Git-SHA label도 운영자 입력이다.
  source/runtime 다중 결속은 이 위험을 완화하지만 cryptographic attestation을 대신하지 않는다.

[승인된 설계 §14](../specs/2026-07-14-phase-2-6-project-profile-managed-choice-design.md#14-explicitly-deferred-contracts)에
따라 다음은 누락이 아니라 명시적 이연이다.

1. 실제 PARTID metadata source database, credentials, tables, joins, cardinality
2. source-to-Profile field mapping
3. field units and domain bounds
4. Layer/Shot automatic calculations
5. provider refresh/re-sync after creation
6. legacy production-data migration
7. version conflict와 project/cell event를 넘어서는 ChoiceSet audit-history UI
8. approved-project snapshot persistence와 Revision behavior

## Completion decision

고정 source의 build/runtime provenance, static integrity, backend/database/frontend gate, required
browser 12/12, 실제 Chromium AX tree, 독립 시각 판정과 evidence audit에 blocking finding이 없다.
승인된 이연과 위 잔여 위험을 명시한 상태로 **Phase 2.6 구현 완료**로 판정한다. 이 판정은
Project Profile·Managed Choice 및 Phase 3 option-model 전제에 한정되며 Phase 3 이후 기능이나
보안 승인을 포함하지 않는다.
