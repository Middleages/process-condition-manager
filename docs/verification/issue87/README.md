# Issue #87 verification evidence

Review artifacts for the LINE-first 제품 목록 implementation. The browser run tested runtime commit `f4b28c81f7c002f8e57de7507a6e7539e918f458`. These files preserve completed browser and scale observations; the full backend gate was still running when this evidence was assembled. The PR is the source of final checks and review status.

## Browser behavior and rendered inspection

The isolated local application used real API responses backed by PostgreSQL: six LINEs × 2,003 Process/Part combinations × three revisions = 36,054 projects. Latest revisions covered Draft, Review, Approved and Rejected; earlier revisions were archived. Browser fixtures had no sheet layers. Database and ingest dependencies pointed to the dedicated fixture database, with no production deployment involved.

Playwright with cached Chromium inspected 1440×1000 and 1024×1000 viewports. The browser verification child opened all 12 screenshots with an image-capable viewer. Its recorded observations were:

- Process and Part ID dominate the rows; version/date text is quieter. Blue LINE selection and rectangular 열기 actions clearly distinguish scope and navigation.
- Long identifiers wrap inside their columns. No clipping, overlap or horizontal page overflow appeared at either width.
- Status badges measured 14px/700 with a noninteractive cursor and no cell overflow. Gray, red, amber and green badges remained distinct from the rectangular actions.
- Empty, loading and error states retain readable context. Loading/error states show no stale rows; retry is visible. At 1024px, catalog-error text and its retry button wrap in the sidebar but remain readable and operable.

The interaction run passed explicit button Process search and Enter Part ID search, no request during typing, and an empty result for a name-only query. Changing LINE preserved the applied query, discarded unsubmitted draft input and reset pagination. Initial/reset pages contained 25 rows. Both top and bottom previous/next controls worked; first/last boundaries disabled appropriately. Bottom pagination focused the LINE heading and scrolled it into view. Keyboard Enter opened detail; browser Back and detail 목록으로 restored the exact later-page URL and original row focus. Detail displayed 제품 공정조건.

Loading used a delayed real L3 response. List and LINE-catalog error states used injected HTTP 503 responses; retries recovered through the live API to 25 L4 rows and six LINE choices respectively. Other API responses were real. The separate normal-run console check recorded no warnings, errors or page errors; the interaction run had no page errors.

| State | 1440px | 1024px |
| --- | --- | --- |
| Normal list | [Screenshot](normal-1440.png) | [Screenshot](normal-1024.png) |
| Empty search | [Screenshot](empty-1440.png) | [Screenshot](empty-1024.png) |
| Loading | [Screenshot](loading-1440.png) | [Screenshot](loading-1024.png) |
| List error | [Screenshot](error-1440.png) | [Screenshot](error-1024.png) |
| Initial LINE selection | [Screenshot](select-1440.png) | — |
| LINE catalog error | — | [Screenshot](line-error-1024.png) |
| Later-page focus | — | [Screenshot](page2-focus-1024.png) |

Additional capture: [detail](detail.png). Raw observations: [browser results](browser-results.json), [console/focus supplement](browser-supplement.json).

## API volume and query cost

The separate PostgreSQL scale test passed on the same six-LINE, 2,003-combinations, three-revision shape, with 72,108 layers and 288,432 cells. It traversed 486 pages (81 per LINE) and checked the exact ordered 12,018 latest-revision IDs, detecting missing or duplicate boundaries. All selected revisions were version 3 in Draft or Review, with two layers/eight cells each; older revisions did not reappear. Process and Part ID queries each selected the expected identity.

The [raw scale report](scale-report.json) retains full `EXPLAIN (ANALYZE, BUFFERS)` plans. First-page response size was 12,766 bytes with two SELECTs; related aggregate subplans ran at most 26 times, including the lookahead row. First-page plan execution was 20.166ms. Across traversal, local request median was 24.78ms, maximum 287.34ms and aggregate request time 17.49s.

LINE discovery returned only 31 bytes but still incurred catalog materialization: two SELECTs, 24,036 source rows and 12,018 distinct LINE/Process pairs, taking 354.13ms locally. Its captured catalog plan executed in 47.958ms. The small response therefore does not imply constant-cost discovery.

The reproducible scale test is [test_project_list_performance_pg.py](../../../backend/tests/performance/test_project_list_performance_pg.py). The report itself has no embedded commit SHA; the exact SHA above identifies the browser run. Browser and scale fixtures differ in status distribution and layer population as described above.

## Evidence limits

These are local static-fixture timings, not production capacity or latency guarantees. Concurrent revisions are not snapshot-isolated across cursor requests. The browser did not traverse all 81 pages per LINE; the API scale test covered the full traversal. Browser coverage is Chromium desktop only, with no mobile or screen-reader run. HTTP 503 injection verifies error presentation and live recovery, not an actual infrastructure outage. Existing detail-internal Project/lineage wording remains outside the default-list cleanup scope.
