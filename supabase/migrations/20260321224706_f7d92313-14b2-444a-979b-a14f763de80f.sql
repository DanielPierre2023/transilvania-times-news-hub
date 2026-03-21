-- Add editorial tracking columns to scraped_articles
ALTER TABLE public.scraped_articles ADD COLUMN IF NOT EXISTS assigned_editor text;
ALTER TABLE public.scraped_articles ADD COLUMN IF NOT EXISTS source_word_count integer DEFAULT 0;
ALTER TABLE public.scraped_articles ADD COLUMN IF NOT EXISTS original_content_full text;

-- Add ai_editor to blog_posts
ALTER TABLE public.blog_posts ADD COLUMN IF NOT EXISTS ai_editor text;

-- Update rewrite_jobs default editor from marcus_webb to null
ALTER TABLE public.rewrite_jobs ALTER COLUMN editor SET DEFAULT null;