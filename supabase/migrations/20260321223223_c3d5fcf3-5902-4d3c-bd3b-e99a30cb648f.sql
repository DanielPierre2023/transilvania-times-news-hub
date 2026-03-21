-- Add bilingual tag columns to blog_posts
ALTER TABLE public.blog_posts ADD COLUMN IF NOT EXISTS tags_en text[] DEFAULT '{}'::text[];
ALTER TABLE public.blog_posts ADD COLUMN IF NOT EXISTS tags_ro text[] DEFAULT '{}'::text[];

-- Add bilingual tag columns to scraped_articles
ALTER TABLE public.scraped_articles ADD COLUMN IF NOT EXISTS rewrite_tags_en text[] DEFAULT '{}'::text[];
ALTER TABLE public.scraped_articles ADD COLUMN IF NOT EXISTS rewrite_tags_ro text[] DEFAULT '{}'::text[];

-- Backfill: copy existing tags into tags_en
UPDATE public.blog_posts SET tags_en = COALESCE(tags, '{}'::text[]) WHERE tags_en = '{}'::text[] AND tags IS NOT NULL AND array_length(tags, 1) > 0;

-- Backfill: copy existing rewrite_tags into rewrite_tags_en
UPDATE public.scraped_articles SET rewrite_tags_en = COALESCE(rewrite_tags, '{}'::text[]) WHERE rewrite_tags_en = '{}'::text[] AND rewrite_tags IS NOT NULL AND array_length(rewrite_tags, 1) > 0;