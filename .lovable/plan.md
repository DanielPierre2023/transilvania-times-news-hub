

## Plan: Phase 2 — Dashboard, Blog Manager, Blog Editor & Analytics

### Schema Gap Analysis

The source code references columns that don't exist in this project's database. A migration is required before these pages will work.

**blog_posts** — Source uses bilingual columns (`title_en`, `title_ro`, `content_en`, `content_ro`, `excerpt_en`, `excerpt_ro`, `seo_title_en`, `seo_title_ro`, `seo_description_en`, `seo_description_ro`, `cover_image`, `author_name`, `tags`, `reading_time_min`, `summary_en`, `summary_ro`). Current table has single columns (`title`, `content`, `excerpt`, `seo_title`, `seo_description`, `hero_image`, `author`, `language`).

**scraped_articles** — Source uses bilingual columns (`title_en`, `title_ro`, `rewritten_en`, `rewritten_ro`, `excerpt_en/ro`, `summary_en/ro`, `seo_title_en/ro`, `seo_description_en/ro`, `rewrite_tags`, `original_title`). Current has only `title`, `original_content`, `rewritten_content`.

**site_analytics** — Source references `session_id`, `device`, `visit_duration_seconds`. Current has `device_type`, `session_duration`. No `session_id`.

**Dashboard queries** — Source queries `newsletter_subscribers.eq('subscribed', true)` but column is `is_active`. Source queries `blog_comments.eq('is_approved', false)` but column uses `status`. Source reads `msg.sender_name`/`msg.sender_email` but columns are `name`/`email`.

### Step 1: Database Migration

Restructure `blog_posts` for bilingual content and add missing columns to `scraped_articles` and `site_analytics`:

```sql
-- blog_posts: rename single columns to _en, add _ro variants, add new columns
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
DROP COLUMN language; -- no longer needed with bilingual columns

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
CREATE POLICY "Admins upload blog images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'blog-images' AND has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete blog images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'blog-images' AND has_role(auth.uid(), 'admin'));
```

### Step 2: Files to Create

| File | Purpose |
|------|---------|
| `src/pages/admin/BlogManager.tsx` | Post list with search, status filter, delete, navigate to editor |
| `src/pages/admin/BlogEditor.tsx` | Full editor with bilingual tabs, AI generator/assistant (calls edge functions), image upload, SEO fields, quality check, markdown preview |
| `src/pages/admin/Analytics.tsx` | Charts (daily visits, top pages, browsers, devices, referrers, countries) using Recharts |
| `src/pages/admin/analytics/UserBehaviorInsights.tsx` | Placeholder for engagement data |
| `src/pages/admin/analytics/GeoEngagement.tsx` | Country-to-city drill-down |
| `src/pages/admin/analytics/RankedList.tsx` | Reusable ranked bar component |

### Step 3: Files to Modify

| File | Change |
|------|--------|
| `src/pages/admin/Dashboard.tsx` | Replace placeholder with live stats from Supabase, adapted to actual column names (`is_active` not `subscribed`, `status` not `is_approved`, `name`/`email` not `sender_name`/`sender_email`) |
| `src/App.tsx` | Replace `ComingSoon` with real components for `analytics`, `blog`, `blog/new`, `blog/edit/:id` routes |

### Adaptation Details

**Dashboard** — Queries adapted: `newsletter_subscribers.eq('is_active', true)`, `blog_comments.eq('status', 'pending')`, recent messages use `name`/`email` columns.

**BlogManager** — Source queries `title_en` which will exist after migration. Filter by `status`. Delete with confirmation dialog. Click row to navigate to `/admin/blog/edit/:id`.

**BlogEditor** — Adapted to use `title_en`/`title_ro`, `content_en`/`content_ro`, etc. The AI edge functions (`ai-blog-assistant`, `ai-generate-article`, `check-content-quality`) are called via `supabase.functions.invoke()` — these won't work until the edge functions are deployed in a later phase, but the UI will be ready. Image upload to `blog-images` bucket. Categories adapted to news site: `politics`, `world`, `technology`, `business`, `culture`, `opinion`. Editors list adapted for Transilvania Times journalists.

**Analytics** — Column mapping: `device_type` (not `device`), `session_duration` (not `visit_duration_seconds`). Remove `session_id` unique count if column doesn't populate. Remove CSS variable references (`var(--ink)` etc.) and use Tailwind classes.

### Dependencies

- `date-fns` — already installed
- `recharts` — already installed (chart.tsx exists)
- No new npm dependencies needed

### Edge Functions Note

The BlogEditor references these edge functions which don't exist yet: `ai-blog-assistant`, `ai-generate-article`, `check-content-quality`. The buttons will show errors when clicked. These will be implemented in a later phase when the user provides the edge function code. The editor remains fully functional for manual writing and saving.

