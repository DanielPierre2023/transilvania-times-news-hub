ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS target_language text DEFAULT 'all';
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS rewrite_error text;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS ai_score integer;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS last_rewrite_job_id uuid REFERENCES rewrite_jobs(id);