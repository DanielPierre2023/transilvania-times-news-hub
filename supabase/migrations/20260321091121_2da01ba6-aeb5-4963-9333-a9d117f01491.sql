
-- Drop orphaned tables not used by any frontend code
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS report_requests CASCADE;

-- Drop redundant column from rewrite_jobs (code only uses finished_at)
ALTER TABLE rewrite_jobs DROP COLUMN IF EXISTS completed_at;
