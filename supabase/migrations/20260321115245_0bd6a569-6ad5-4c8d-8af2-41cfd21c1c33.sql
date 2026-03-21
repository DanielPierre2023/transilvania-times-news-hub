ALTER TABLE rss_sources ADD COLUMN IF NOT EXISTS category text DEFAULT 'technology';
ALTER TABLE rss_sources ADD COLUMN IF NOT EXISTS source_language text DEFAULT 'en';