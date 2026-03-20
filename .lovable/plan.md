

## Plan: Phase 4 — InboxPage, Newsletter & RssScraper

### Schema Gaps

**`newsletter_campaigns`** — Source references `content_html` and `target_language` and `sent_count`. Actual table has `content` (not `content_html`), `recipient_count` (not `sent_count`), and no `target_language`. Need to add `target_language text DEFAULT 'all'`.

**`contact_messages`** — Source references `sender_name`, `sender_email`, `replied_at`. Actual columns are `name`, `email`. No `replied_at`. Need to add `replied_at timestamptz`.

**`rss_sources`** — Source references `feed_url`. Actual column is `url`. Will adapt code to use `url`.

**`scraped_articles`** — Source references `rewrite_error`, `ai_score`, `last_rewrite_job_id`. None exist. Need to add all three columns.

### Step 1: Database Migration

```sql
ALTER TABLE newsletter_campaigns ADD COLUMN IF NOT EXISTS target_language text DEFAULT 'all';
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS rewrite_error text;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS ai_score integer;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS last_rewrite_job_id uuid REFERENCES rewrite_jobs(id);
```

### Step 2: Files to Create

| File | Purpose |
|------|---------|
| `src/pages/admin/InboxPage.tsx` | Message inbox with split view (list + detail). Adapted: `sender_name` → `name`, `sender_email` → `email`. Reply calls `send-inbox-reply` edge function. |
| `src/pages/admin/Newsletter.tsx` | Campaign manager with composer dialog, AI compose, send, weekly digest. Adapted: `content_html` → `content`, `sent_count` → `recipient_count`, `subscribed` → `is_active`. |
| `src/pages/admin/RssScraper.tsx` | RSS source management + scrape + AI rewrite queue. Adapted: `feed_url` → `url`. Uses `rewrite_error`, `ai_score`, `last_rewrite_job_id` columns (added by migration). |

### Step 3: Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Replace `ComingSoon` with `InboxPage`, `Newsletter`, `RssScraper` for `/admin/inbox`, `/admin/newsletter`, `/admin/rss` routes |

### Key Adaptations

- **InboxPage**: `m.sender_name` → `m.name`, `m.sender_email` → `m.email`, `selectedMsg.replied_at` used only if column exists (added by migration)
- **Newsletter**: Insert uses `content` not `content_html`, display uses `recipient_count` not `sent_count`, subscriber query uses `is_active` not `subscribed`
- **RssScraper**: All `feed_url` references → `url`. Editors list adapted for Transilvania Times. CSS variable references removed, using Tailwind classes. Edge functions (`scrape-rss`, `enqueue-rewrite-article`) will error until deployed.

### Edge Functions Note

These pages call edge functions not yet deployed: `send-inbox-reply`, `send-newsletter`, `generate-weekly-newsletter`, `ai-newsletter-composer`, `scrape-rss`, `enqueue-rewrite-article`. Buttons will show errors until those are implemented.

