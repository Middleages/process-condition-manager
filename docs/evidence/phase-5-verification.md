# Phase 5 verification evidence

Verified on 2026-07-20 KST from `feat/phase-5-approval-revision`.

## Automated gates

| Surface | Command | Result |
|---|---|---|
| Backend lint | `cd backend && uv run ruff check app tests` | Pass |
| Backend types | `cd backend && uv run pyright` | Pass, 0 errors/warnings |
| Backend suite | `cd backend && uv run pytest -q --ignore=tests/migrations --ignore=tests/scripts/test_seed_dev_pg.py` | Pass, 737 passed / 57 skipped |
| Final SSO boundary regression | `cd backend && uv run pytest -q tests/test_auth.py` | Pass, 36 passed; includes invalid UTF-8 and escaped lone-surrogate normalization |
| Phase 5 migration suite | `cd backend && uv run pytest -q tests/migrations/test_phase_5_migration.py` | 3 skipped because `APP_TEST_DATABASE_URL` is not configured |
| Frontend type/lint gate | `cd frontend && npm run typecheck && npm run lint` | Pass |
| Frontend suite | `cd frontend && npm test -- --run` | Pass, 95 files / 1008 tests |
| Production bundle | `cd frontend && npm run build` | Pass; existing Glide/Rollup annotation and >500 KiB chunk warnings remain |
| Distribution scripts | `node --test scripts/qa/*.test.mjs` | Pass, 29 passed |
| Browser QA | Commands in `docs/evidence/phase-5-approval-revision/README.md` | Pass, 8/8 checks at 1024/1440/1920 widths |
| Patch hygiene | `git diff --check` | Pass |

The backend suite excludes only tests that require an external PostgreSQL URL. The seed test is
also excluded because it attempts to connect to the configured PostgreSQL service; neither a
PostgreSQL service nor Docker is available in this execution environment.

## Review evidence

- Current-model architecture review challenged the SSO trust boundary, immutable Approval truth,
  revision transaction ownership, comment pagination, frozen readers, and payload-size limits.
- Current-model final code review returned **APPROVE** with no remaining P0/P1 findings.
- The final reviewer's focused verification passed 68 backend tests, 83 frontend tests, frontend
  typecheck, Ruff, and Pyright; four hostile boundary cases for SSO, Review-gate payload sizing, and
  Unicode comment pagination also passed.

## Browser evidence boundary

`docs/evidence/phase-5-approval-revision/results.json` records 8/8 passing checks, no unexpected
requests, and no unexpected console errors. The browser used the production Vite build and
deterministic Playwright route mocks. It proves UI behavior but does not claim live PostgreSQL or
real-tenant IdP integration.

## External gates still pending

1. Run `docs/phase-5-sso-gateway-runbook.md` against the production-equivalent OIDC gateway and
   update `docs/evidence/phase-5-sso-tenant-conformance.json` from `pending` to `pass`.
2. Set `APP_TEST_DATABASE_URL` to a disposable PostgreSQL database, then run the migration suite,
   PostgreSQL revision race tests, and the 20k/10k performance gates described by the Phase 5 test
   specification.

These are explicitly pending infrastructure conformance gates, not simulated successes.
