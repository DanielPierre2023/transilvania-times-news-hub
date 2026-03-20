

## Plan: Deploy All Edge Functions

### Database Migration

The `rewrite_jobs` table needs columns for the enqueue/process workflow:

```sql
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS article_id uuid REFERENCES scraped_articles(id);
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS editor text DEFAULT 'marcus_webb';
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS max_retries integer DEFAULT 3;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE rewrite_jobs ADD COLUMN IF NOT EXISTS error_message text;

-- newsletter_subscribers missing 'name' column (used by send-newsletter, generate-weekly-newsletter)
ALTER TABLE newsletter_subscribers ADD COLUMN IF NOT EXISTS name text;

-- scraped_articles missing rewrite timing columns (used by process-rewrite-job)
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS rewrite_started_at timestamptz;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS rewrite_finished_at timestamptz;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS plagiarism_score integer;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz;
```

### Secrets Required (3 new)

Before deploying, these must be added:
- **GEMINI_API_KEY** — for ai-blog-assistant, ai-comment-reply, ai-newsletter-composer, check-content-quality, competitor-analysis, geo-optimize
- **OPENAI_API_KEY** — for ai-generate-article, ai-rewrite-article, process-rewrite-job, generate-weekly-newsletter
- **RESEND_API_KEY** — for confirm-newsletter, send-newsletter, generate-weekly-newsletter, send-inbox-reply

### Edge Functions to Create (16 files)

| File | Key Adaptations |
|------|----------------|
| `_shared/gemini.ts` | As-is |
| `_shared/sanitize.ts` | As-is |
| `_shared/brandedEmail.ts` | Update LOGO_URL and SITE_URL to Transilvania Times branding |
| `ai-blog-assistant/index.ts` | As-is (uses Gemini) |
| `ai-comment-reply/index.ts` | Change "Alex" / "ADD.IS" persona to Transilvania Times editor |
| `ai-generate-article/index.ts` | Update EDITORS for TT journalists, CATEGORIES to `politics, world, technology, business, culture, opinion` |
| `ai-newsletter-composer/index.ts` | Update company refs from ADDIS to Transilvania Times |
| `ai-rewrite-article/index.ts` | Update EDITORS, adapt for TT |
| `check-content-quality/index.ts` | As-is |
| `confirm-newsletter/index.ts` | Update from/reply_to, SITE URL, welcome content for TT |
| `competitor-analysis/index.ts` | Update company context to Transilvania Times |
| `enqueue-rewrite-article/index.ts` | Change `article_id` field to match new column name |
| `process-rewrite-job/index.ts` | Update EDITORS for TT, adapt column refs |
| `scrape-rss/index.ts` | Update User-Agent to Transilvania Times |
| `send-newsletter/index.ts` | Map `content_html` → `content`, `sent_count` → `recipient_count`, `subscribed` → `is_active`. Update branding/URLs/footer. |
| `send-inbox-reply/index.ts` | Map `sender_name` → `name`, `sender_email` → `email`. Update branding/URLs. |
| `geo-optimize/index.ts` | As-is |
| `geo-lookup/index.ts` | Update User-Agent |
| `generate-weekly-newsletter/index.ts` | Map `content_html` → `content`, `sent_count` → `recipient_count`, `subscribed` → `is_active`. Update branding. |

### Column Mapping Summary (source code → actual DB)

These adaptations apply across multiple functions:

- `newsletter_subscribers.subscribed` → `is_active`
- `newsletter_subscribers.name` → added by migration
- `newsletter_campaigns.content_html` → `content`
- `newsletter_campaigns.sent_count` → `recipient_count`
- `contact_messages.sender_name` → `name`
- `contact_messages.sender_email` → `email`
- `rss_sources.feed_url` → `url`
- `rewrite_jobs.article_id` → added by migration

### Branding Changes

All email templates, AI system prompts, and User-Agent strings updated from "ADD Individual Solutions" / "ADDIS" to "Transilvania Times". The branded email template gets TT logo URL, site URL, and colors.

### Deployment Order

1. Add secrets (GEMINI_API_KEY, OPENAI_API_KEY, RESEND_API_KEY)
2. Run migration
3. Create all edge function files
4. Deploy all functions
5. Test a representative function

