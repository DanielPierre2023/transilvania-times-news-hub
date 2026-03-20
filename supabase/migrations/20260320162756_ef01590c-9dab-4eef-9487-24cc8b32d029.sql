
-- blog_posts: rename to bilingual columns, add new fields
ALTER TABLE blog_posts RENAME COLUMN title TO title_en;
ALTER TABLE blog_posts ADD COLUMN title_ro text;
ALTER TABLE blog_posts RENAME COLUMN content TO content_en;
ALTER TABLE blog_posts ADD COLUMN content_ro text;
ALTER TABLE blog_posts RENAME COLUMN excerpt TO excerpt_en;
ALTER TABLE blog_posts ADD COLUMN excerpt_ro text;
ALTER TABLE blog_posts RENAME COLUMN seo_title TO seo_title_en;
ALTER TABLE blog_posts ADD COLUMN seo_title_ro text;
ALTER TABLE blog_posts RENAME COLUMN seo_description TO seo_description_en;
ALTER TABLE blog_posts ADD COLUMN seo_description_ro text;
ALTER TABLE blog_posts RENAME COLUMN hero_image TO cover_image;
ALTER TABLE blog_posts RENAME COLUMN author TO author_name;
ALTER TABLE blog_posts ADD COLUMN tags text[] DEFAULT '{}';
ALTER TABLE blog_posts ADD COLUMN reading_time_min integer DEFAULT 1;
ALTER TABLE blog_posts ADD COLUMN summary_en text;
ALTER TABLE blog_posts ADD COLUMN summary_ro text;
ALTER TABLE blog_posts DROP COLUMN IF EXISTS language;

-- scraped_articles: add bilingual columns
ALTER TABLE scraped_articles RENAME COLUMN title TO original_title;
ALTER TABLE scraped_articles ADD COLUMN title_en text;
ALTER TABLE scraped_articles ADD COLUMN title_ro text;
ALTER TABLE scraped_articles ADD COLUMN rewritten_en text;
ALTER TABLE scraped_articles ADD COLUMN rewritten_ro text;
ALTER TABLE scraped_articles ADD COLUMN excerpt_en text;
ALTER TABLE scraped_articles ADD COLUMN excerpt_ro text;
ALTER TABLE scraped_articles ADD COLUMN summary_en text;
ALTER TABLE scraped_articles ADD COLUMN summary_ro text;
ALTER TABLE scraped_articles ADD COLUMN seo_title_en text;
ALTER TABLE scraped_articles ADD COLUMN seo_title_ro text;
ALTER TABLE scraped_articles ADD COLUMN seo_description_en text;
ALTER TABLE scraped_articles ADD COLUMN seo_description_ro text;
ALTER TABLE scraped_articles ADD COLUMN rewrite_tags text[] DEFAULT '{}';

-- site_analytics: add session_id
ALTER TABLE site_analytics ADD COLUMN session_id text;

-- storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('blog-images', 'blog-images', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('reports', 'reports', true) ON CONFLICT DO NOTHING;

-- storage RLS for blog-images
CREATE POLICY "Public read blog images" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'blog-images');
CREATE POLICY "Admins upload blog images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'blog-images' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete blog images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'blog-images' AND public.has_role(auth.uid(), 'admin'));

-- storage RLS for reports
CREATE POLICY "Public read reports" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'reports');
CREATE POLICY "Admins upload reports" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'reports' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete reports" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'reports' AND public.has_role(auth.uid(), 'admin'));
