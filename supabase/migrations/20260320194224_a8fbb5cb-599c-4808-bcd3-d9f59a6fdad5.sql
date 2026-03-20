-- rewrite_jobs: add columns for enqueue/process workflow
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES scraped_articles(id);
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS editor text DEFAULT 'marcus_webb';
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS max_retries integer DEFAULT 3;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS error_message text;

-- newsletter_subscribers: add name column
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS name text;

-- scraped_articles: add rewrite timing and quality columns
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS rewrite_started_at timestamptz;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS rewrite_finished_at timestamptz;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS plagiarism_score integer;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz;