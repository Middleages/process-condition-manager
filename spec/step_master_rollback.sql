-- Step Master rollback SQL (service DB)
-- Updated: 2026-04-05
-- NOTE:
-- 1) Execute only after application rollback/cutover disable.
-- 2) Run in lower env first.
-- 3) Keep backups before production execution.

BEGIN;

-- Drop child tables first (FK dependency order)
DROP TABLE IF EXISTS etl_run_line_status;
DROP TABLE IF EXISTS step_event_audit;
DROP TABLE IF EXISTS sync_watermark;
DROP TABLE IF EXISTS step_current;
DROP TABLE IF EXISTS etl_run_log;

COMMIT;
