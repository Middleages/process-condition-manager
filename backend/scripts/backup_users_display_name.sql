-- Backup script for migration 025_users_userid_and_drop_display_name
-- Purpose: archive users.display_name values before the column is dropped.

BEGIN;

CREATE TABLE IF NOT EXISTS users_display_name_backup (
    user_id INTEGER PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    backed_up_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO users_display_name_backup (user_id, username, display_name)
SELECT id, username, display_name
FROM users
ON CONFLICT (user_id) DO UPDATE
SET
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    backed_up_at = now();

COMMIT;
