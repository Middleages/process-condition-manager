# Phase 5 browser QA evidence

Run on 2026-07-20 KST against the production Vite build with cached Playwright Chromium 1200.
The API boundary was intentionally deterministic (`page.route`) because this environment has no
PostgreSQL service or real IdP tenant. This evidence proves browser/UI behavior; it does not replace
backend integration, PostgreSQL race, or real-tenant SSO evidence.

## Commands

```bash
cd frontend && npm run build
cd frontend && npm run preview -- --host 127.0.0.1 --port 4175
PHASE5_QA_BASE_URL=http://127.0.0.1:4175 \
PHASE5_QA_OUTPUT=docs/evidence/phase-5-approval-revision \
node docs/evidence/phase-5-approval-revision/phase5_browser_qa.mjs
```

## Result

- `results.json`: **pass**, 8/8 checks.
- Covered auth bootstrap, deterministic Review-gate 409/no state change, successful Review,
  project comment, approval/read-only frozen sheet, no lock/live-ChoiceSet traffic, keyboard column
  navigation, selected-cell comment, Revision lineage/live Draft v2, and 1024/1440/1920 layouts.
- `unexpected_requests`: empty; unexpected browser console errors: empty. The one recorded expected
  console message is the deliberately injected Review-gate HTTP 409.
- Six screenshots are in `screenshots/`; artifact hashes are in `artifact-manifest.sha256`.
