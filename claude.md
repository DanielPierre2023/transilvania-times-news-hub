# Transilvania Times — Project Reference

**Owner:** Daniel Dobos, ADD Individual Solutions Ltd (Cyprus/Romania)
**Site:** [transilvaniatimes.com](https://transilvaniatimes.com) — bilingual RO/EN AI news platform
**Editor stack:** Next.js 15 App Router (`app/`) + Supabase Postgres + Deno Edge Functions
**Last major refactor:** v6 — May 29, 2026

---

## v6 EDITORIAL PIPELINE (current)

### Why v6 exists

v5 articles failed quality audits with five recurring problems: `ai_editor` field was always NULL (no editor persisted), Romanian text was back-translated from English (with truncated sentences as a visible tell), lexical poverty (the same content noun repeating 5-7× in 600 words), structural monotony (every paragraph the same length, same opening pattern), and zero on-the-ground reporting (every quote vague, every source unattributed).

v6 addresses each:

| Failure | v6 fix |
|---|---|
| `ai_editor = NULL` | Persisted by Desk 1 into both `scraped_articles.assigned_editor` AND `blog_posts.ai_editor` |
| Back-translation | Desks 2A and 2B are SEPARATE Claude Sonnet calls. RO writes Romanian natively from English facts. EN writes English natively from English facts. Neither sees the other's draft. |
| Lexical poverty | Desk 2C (Haiku 4.5) audits content noun frequencies. >4× in <800w or >5× in 800-1500w triggers a single targeted revision pass. |
| Structural monotony | Desk 2D (Haiku 4.5) checks burstiness, sentence completeness, banned-phrase compliance. |
| No reporting | Desk 1 outputs named sources and exact quotes; writers MUST attribute by name + title. |

### Pipeline diagram

```
SCRAPED ARTICLE
       │
       ▼
┌───────────────────────────────────────────────┐
│ DESK 1   Gemini 2.5 Flash                     │
│ - Extract facts (numbered list)               │
│ - Identify named sources                      │
│ - Pull exact quotes                           │
│ - Detect category                             │
│ - SELECT EDITOR (one of 7)  ← persisted       │
└───────────────────┬───────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────────┐
│ DESK 1.5 Gemini 2.5 Flash                     │
│ - Background context enrichment               │
└───────────────────┬───────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────────┐  ┌──────────────────┐
│ DESK 2A   Sonnet │  │ DESK 2B   Sonnet │
│ Romanian writer  │  │ English writer   │
│ (native voice)   │  │ (native voice)   │
│ Editor profile_RO│  │ Editor profile_EN│
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│ DESK 2C   Haiku  │  │ DESK 2C   Haiku  │
│ Lexical audit RO │  │ Lexical audit EN │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│ DESK 2D   Haiku  │  │ DESK 2D   Haiku  │
│ Structural check │  │ Structural check │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
              INSERT/UPDATE
              blog_posts row
              (ai_editor SET)
```

### Editor roster

| Key | Name | Beat |
|---|---|---|
| `andrei_popescu` | Andrei Popescu | Accountability (politics, public money) |
| `lucian_bratu` | Lucian Bratu | Transylvanian culture & communities |
| `elena_vasilescu` | Elena Vasilescu | Science, education, environment |
| `sofia_marinescu` | Sofia Marinescu | Data & health |
| `daniel_dobos` | Daniel Dobos | Technology & business storytelling |
| `mihai_ionescu` | Mihai Ionescu | Technical critique (cyber, infra) |
| `victor_simon` | Victor Simon | Wire (fires, arrests, scores) |

Each editor has **five concrete components** per language:

1. **Role** — one line, what desk they run
2. **Working vocabulary** — actual content nouns and synonyms they use, organized by topic
3. **Signature openings** — three sample openings (RO+EN)
4. **Forbidden phrases** — specific tells they must never produce (differs per editor)
5. **Calibration paragraph** — ~80-word native-voice sample for the model to anchor on

### Models

- **Writers** (Desk 2A, 2B): `claude-sonnet-4-5-20250929`, temperature 0.85
- **Quality gates** (Desk 2C, 2D): `claude-haiku-4-5-20251001`
- **Facts + enrichment** (Desk 1, 1.5): `gemini-2.5-flash`, temperature 0.2

### Cost per article

| Pass | Tokens (in/out) | Cost |
|---|---|---|
| Desk 1 Gemini    | 2k / 600 | $0.003 |
| Desk 1.5 Gemini  | 1k / 400 | $0.002 |
| Desk 2A Sonnet RO | 5k / 2k  | $0.045 |
| Desk 2B Sonnet EN | 5k / 2k  | $0.045 |
| Desk 2C Haiku × 2 | 4k / 1k  | $0.003 |
| Desk 2D check     | n/a (regex) | $0 |
| **Total**         |          | **~$0.10** |

At 600 articles/month: **~$60/month** for the pipeline. v5 was $0.124/article = $75/month — v6 is cheaper.

---

## AUTOMATION CONTROL

### `automation_settings` (single-row table, id=1)

Three booleans, all default FALSE on first deploy:

| Flag | Effect when ON |
|---|---|
| `scraper_enabled` | Cron at 06:00 & 18:00 UTC calls `tt-scrape-rss` to fetch all active sources |
| `processor_enabled` | Cron at 06:30 & 18:30 UTC calls `tt-process-scraped-article` to rewrite up to 2 pending articles |
| `auto_publish` | Articles processed by cron get `status='published'` immediately (vs. `draft` requiring manual review) |

When all three are OFF, the platform is fully manual. Daniel toggles from `/admin/automation`.

### Cron jobs (after applying `01_migration_v6.sql`)

| Job | Schedule | Target | Self-gated |
|---|---|---|---|
| 7  | `0 8 * * 1`       | `tt-newsletter-digest` | No (always runs Mondays) |
| 8  | `0 6,18 * * *`    | `tt-scrape-rss` | Yes (scraper_enabled) |
| 9  | `30 6,18 * * *`   | `tt-process-scraped-article` | Yes (processor_enabled) |

Cron sends `{"source": "cron"}` in the POST body. Functions read `automation_settings` and exit early if disabled.

---

## NEWSLETTER ARCHITECTURE

### Double opt-in flow

```
User submits email on /newsletter or footer signup
         │
         ▼
POST /api/newsletter/subscribe
{ email, language }
         │
         ▼
INSERT newsletter_subscribers
(confirmed=false, token=uuid)
         │
         ▼
invoke tt-newsletter-confirm
{ action: 'send_confirm' }
         │
         ▼
[ User receives email with link ]
         │
         ▼
User clicks https://transilvaniatimes.com/newsletter/confirm?token=<uuid>
         │
         ▼
Server-side: invoke tt-newsletter-confirm
{ action: 'verify', token }
         │
         ▼
UPDATE newsletter_subscribers
SET confirmed=true, confirmed_at=now(), token=null
         │
         ▼
[ User receives WELCOME email with red template ]
```

### Two send paths

**Weekly digest** (`tt-newsletter-digest`) — automated, Monday 08:00 UTC:
- ~80-word editorial intro per language (Claude Sonnet)
- Up to 3 articles each for Regional Transylvania, National Romania, International
- Up to 3 most-read articles (ranked by `view_count`)
- Each article: title + 1-sentence excerpt + link
- Supports `{ preview: true }` (returns HTML without sending) and `{ preview_email: 'x@y.com' }` (single-recipient test)

**Manual campaign** (`send-newsletter`) — from `/admin/newsletter`:
- Admin composes subject + HTML body OR uses AI composer (Claude Sonnet via `ai-newsletter-composer`)
- INSERT into `newsletter_campaigns` with `status='draft'`
- Invoke `send-newsletter` with `{ campaignId }`
- Function wraps body in red template and broadcasts to confirmed subscribers in target language

### Recipient pool

**Newsletters go to `newsletter_subscribers` ONLY.** The `contacts` table is no longer in the recipient pool — contacts get replies, mediakits, and banner pricing emails, never newsletters. This was the v6 architectural decision.

Filter applied universally:
```sql
WHERE confirmed = true
  AND is_active = true
  AND unsubscribed_at IS NULL
```

---

## CONTACTS CRM

Located at `/admin/contacts`. Replaces the v5 admin/inbox-only flow.

**Per-row actions:**
- Reply (modal → calls `send-inbox-reply` with red template)
- Send mediakit (full brochure via `/api/advertising/send-mediakit`)
- Send banner pricing (lean pricing-only email via `send-banner-pricing`)
- Edit / Delete

**Contact types:** general, advertising_prospect, press, partner, sponsor

**Tracked fields beyond v5:**
- `phone`, `company`, `contact_type`, `tags[]`
- `last_email_sent_at`, `last_email_type` — auto-updated by every send action

---

## SCRAPER

`tt-scrape-rss` — runs from cron OR per-source from admin.

**Dedup:** unique index on `scraped_articles.original_url` (created by migration). Pre-check via bulk `SELECT WHERE original_url IN (...)`. Race-condition fallback: catch 23505 unique violation, count as duplicate. Migration also flags existing duplicates with `marked_for_deletion=true` (kept oldest).

**Per-source mode:** `{ source_id: <uuid> }` — used by per-source "Scrape acum" buttons on `/admin/scraper`.

**Batch mode:** `{}` or `{ source: 'cron' }` — used by admin "Scrape all" and the cron.

**Output limit:** honored from `rss_sources.output_limit` (max 50). v5 was hardcoded to 20.

---

## REWRITE (AI Rescrie)

From the article editor, the "AI Rescrie" button calls `tt-rewrite-blog-post` with `{ blog_post_id }`. This is a thin wrapper:

1. Looks up `scraped_article_id` from the blog_post
2. Returns error if no scraped article linked (manual posts can't be rewritten)
3. Invokes `tt-process-scraped-article` with `{ article_id, rewrite_existing_post_id, mode: 'manual' }`
4. The processor UPDATES the existing blog_post in place (preserving slug, cover_image, status, published_at)

---

## EMAIL TEMPLATE — `brandedEmailV2`

Single canonical design. Red header (#C41E3A), italic serif title, uppercase preheader, white card body, optional red-arrow bullets, optional italic red-border quote, optional red CTA button, cream footer.

**Inlined** verbatim into every email-sending function — MCP bundler does not resolve `_shared/` imports.

Applied consistently across:
- Welcome email (`tt-newsletter-confirm`)
- Confirmation request email (`tt-newsletter-confirm`)
- Weekly digest (`tt-newsletter-digest`)
- Manual newsletter campaigns (`send-newsletter`)
- Mediakit (`/api/advertising/send-mediakit`, kept as-is per Daniel's direction)
- Banner pricing (`send-banner-pricing`)
- Inbox reply (`send-inbox-reply`)

---

## DATABASE SCHEMA (relevant tables)

**newsletter_subscribers** — `id, email, is_active, confirmed, language, name, created_at, confirmation_token, confirmation_sent_at, confirmed_at, unsubscribed_at`

**newsletter_campaigns** — `id, subject, content, status, sent_at, recipient_count, target_language, created_at`

**contacts** — `id, email, name, source, notes, language, tags[], newsletter_subscribed, phone, company, contact_type, last_email_sent_at, last_email_type, created_at, updated_at`

**blog_posts** — full bilingual content + `ai_editor` (CRITICAL, v6 fix), `scraped_article_id`, `word_count`, bilingual SEO. UPDATE-in-place during rewrite.

**scraped_articles** — full source content + `assigned_editor`, `marked_for_deletion`, `original_url` (UNIQUE INDEX), `scope`, `county`.

**automation_settings** — single row (id=1) — `scraper_enabled`, `processor_enabled`, `auto_publish`, `updated_at`, `updated_by`.

**ad_pricing** — `slot, label_ro, label_en, format, weekly_eur, monthly_eur, yearly_eur`

**ad_inquiries** — `recipient_name, recipient_email, language, slots_offered ('full_mediakit' | 'banner_pricing_only'), sent_at`

---

## DEVELOPMENT RULES (Daniel's non-negotiables)

1. **Plan first → get explicit approval → THEN build.**
2. Read the code before acting. No assumptions about schema or function signatures.
3. Enterprise-grade only. Complete files, never snippets.
4. **Daniel deploys edge functions manually.** Migrations run in Supabase SQL Editor. Never auto-deploy.
5. Argue when technically correct.

---

## DEPLOYMENT ORDER (v6)

1. **Apply migration** `01_migration_v6.sql` in Supabase SQL Editor with `<<<PASTE_SERVICE_ROLE_KEY_HERE>>>` replaced (3 places).

2. **Deploy 8 edge functions** (in this order — `tt-newsletter-confirm` is `verify_jwt=FALSE`; everything else is `verify_jwt=true`):
   - `tt-process-scraped-article` (overwrite v5)
   - `tt-scrape-rss` (overwrite v5)
   - `tt-newsletter-confirm` (NEW, **verify_jwt=FALSE**)
   - `tt-newsletter-digest` (NEW)
   - `tt-rewrite-blog-post` (NEW or overwrite legacy)
   - `send-newsletter` (overwrite v5)
   - `send-banner-pricing` (NEW)
   - `send-inbox-reply` (overwrite v5)

3. **Mark deprecated functions for deletion** (don't delete yet — verify v6 works first):
   - `confirm-newsletter` (replaced by `tt-newsletter-confirm`)
   - `generate-weekly-newsletter` (replaced by `tt-newsletter-digest`)
   - `enqueue-rewrite-article`, `process-rewrite-job`, `ai-rewrite-article` (replaced by `tt-rewrite-blog-post`)

4. **Commit + Netlify-deploy frontend files**:
   - `app/api/newsletter/subscribe/route.ts`
   - `app/api/admin/contacts/route.ts`
   - `app/admin/contacts/page.tsx`
   - `app/admin/automation/page.tsx`
   - `app/admin/newsletter/page.tsx`
   - `app/admin/subscribers/page.tsx`
   - `app/newsletter/confirm/page.tsx`
   - `app/components/NewsletterSignup.tsx`
   - Apply the two `.patch.txt` files (scraper page, ArticleEditor)

5. **Smoke test:**
   - Subscribe → confirm email arrives → click link → welcome email arrives → row shows `confirmed=true` in admin/subscribers
   - Manually scrape one source → articles appear, dedup count visible
   - Process one article → editor voice differs by category, `ai_editor` populated in blog_posts
   - Click "AI Rescrie" on existing post → returns success message with editor name
   - `/admin/newsletter` → preview digest → looks correct in modal
   - Send test digest to own email → renders correctly in Gmail
   - Send mediakit + banner pricing to test contact → both arrive

6. **Turn on automation switches** (one at a time) from `/admin/automation`:
   - Start with `scraper_enabled` ON for one cron cycle. Watch logs. Confirm scrape runs.
   - Then `processor_enabled` ON for one cron cycle. Watch. Confirm articles are written as drafts.
   - Then (only when confident) `auto_publish` ON.
