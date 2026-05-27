# CLAUDE.md — Transilvania Times Project Reference

> **Last updated:** May 27, 2026
> **Author:** Claude (Opus 4.6) for Daniel Dobos / ADD Individual Solutions Ltd.
> **Purpose:** Master reference so every Claude session starts with full project knowledge.
> **Location:** Commit to repo root as `CLAUDE.md`.

---

## 1. Project Overview

**Transilvania Times** is a bilingual (Romanian + English) AI-powered news publication covering Transylvanian and Romanian affairs. The site uses AI for article generation, editorial voice differentiation, RSS content processing, cover image generation, newsletter composition, and comment moderation.

- **Domain:** transilvaniatimes.com
- **Owner:** Daniel Dobos, ADD Individual Solutions Ltd. (Cyprus/Romania)
- **Contact:** daniel.dobos@add-individual-solutions.com, +357 96 919 606

---

## 2. Tech Stack

| Layer | Technology | Details |
|---|---|---|
| Frontend | Next.js 15 App Router | React 18, TypeScript, Tailwind CSS 3 |
| UI components | shadcn/ui + Radix UI | Full component library in `src/components/ui/` |
| Backend | Supabase | PostgreSQL DB + Edge Functions (Deno) + Auth + Storage |
| Hosting | Netlify | `bespoke-unicorn-cefa67`, `@netlify/plugin-nextjs` |
| DNS | Cloudflare | SSL + CDN |
| Email | Resend | Newsletter + contact replies |
| AI Models | Gemini 2.5 Flash, GPT-4o, Claude Sonnet 4.6, Claude Haiku 4.5 | Multi-model pipeline |
| Image Gen | HuggingFace FLUX, Pollinations FLUX, Unsplash, DALL-E 3 | Cover images |
| GitHub | DanielPierre2023/transilvania-times-news-hub | PUBLIC repo |
| Supabase | Project ID: `zimpimoierpsocnmnizm` | EU region |

### Brand Colors
- Primary red: `#C41E3A`
- Navy: `#0D1B4B`
- Amber: `#F0A500`
- Cream: `#F5F4F0`
- Near-black: `#1A1A1A`
- Fonts: **Lora** (serif/headlines) + **Inter** (sans/body)

---

## 3. Repo Structure

```
transilvania-times-news-hub/
├── app/                          # Next.js 15 App Router (PRODUCTION)
│   ├── layout.tsx                # Root layout (fonts, metadata, providers)
│   ├── page.tsx                  # Homepage
│   ├── globals.css               # Global styles
│   ├── admin/                    # Admin panel (protected)
│   │   ├── layout.tsx            # Admin sidebar layout
│   │   ├── page.tsx              # Admin redirect
│   │   ├── login/page.tsx        # Admin login
│   │   ├── dashboard/page.tsx    # Dashboard overview
│   │   ├── editor/page.tsx       # ★ AI EDITOR — generates articles with 7 tones
│   │   ├── articles/page.tsx     # Article listing
│   │   ├── articles/[id]/edit/   # Article editor (existing articles)
│   │   ├── new/page.tsx          # New article form
│   │   ├── scraper/page.tsx      # RSS scraper management
│   │   ├── comments/page.tsx     # Comment moderation
│   │   ├── newsletter/page.tsx   # Newsletter composer
│   │   ├── subscribers/page.tsx  # Subscriber management
│   │   ├── inbox/page.tsx        # Contact message inbox
│   │   ├── sponsors/page.tsx     # Ad/sponsor management
│   │   ├── settings/page.tsx     # Site settings
│   │   └── components/
│   │       └── ArticleEditor.tsx # Shared article editing component
│   ├── api/                      # Next.js API routes
│   │   ├── admin/publish/route.ts
│   │   ├── advertising/send-mediakit/route.ts
│   │   ├── contact/route.ts
│   │   ├── newsletter/subscribe/route.ts
│   │   └── revalidate/route.ts   # ISR revalidation endpoint
│   ├── autor/[slug]/page.tsx     # Author profile page
│   ├── blog/[slug]/page.tsx      # Article detail page
│   ├── categorie/[category]/     # Category listing page
│   ├── cautare/page.tsx          # Search results
│   ├── components/               # App-level components
│   │   ├── ArticleCard.tsx
│   │   ├── ArticleContent.tsx    # ★ formatContent() paragraph formatter
│   │   ├── ArticleLangToggle.tsx # RO/EN language switcher
│   │   ├── AuthorByline.tsx
│   │   ├── CommentSection.tsx
│   │   ├── CookieBanner.tsx
│   │   ├── LayoutShell.tsx       # Header + Footer wrapper
│   │   ├── NewsletterSignup.tsx
│   │   ├── ShareButtons.tsx
│   │   ├── SiteHeader.tsx
│   │   ├── SiteFooter.tsx
│   │   ├── SponsorBanner.tsx     # Ad display component
│   │   └── WeatherWidget.tsx
│   ├── rss.xml/route.ts          # RSS feed
│   ├── atom.xml/route.ts         # Atom feed
│   ├── sitemap.ts                # Dynamic sitemap
│   └── sitemap-news.xml/route.ts # Google News sitemap
├── src/                          # ★ LEGACY Vite SPA — DO NOT USE for new features
│   ├── views/admin/              # Old admin pages (legacy, not rendered)
│   ├── components/               # Old components
│   ├── hooks/                    # React hooks (some still imported)
│   ├── integrations/supabase/
│   │   ├── client.ts             # Old Supabase client
│   │   └── types.ts              # ★ DB TYPES — STALE (missing authors, sponsors tables)
│   └── lib/                      # Shared utilities
├── lib/
│   ├── supabase/
│   │   ├── client.ts             # Browser Supabase client (Next.js)
│   │   └── server.ts             # Server Supabase client (Next.js)
│   └── image/generate.ts         # Image generation utilities
├── supabase/
│   ├── config.toml               # Supabase local config
│   ├── migrations/               # 15 SQL migrations (March 2026)
│   └── functions/                # Edge Functions (see §5 below)
├── netlify/
│   └── edge-functions/og-rewrite.ts  # OG meta rewriting for social sharing
├── i18n/                         # next-intl routing/request config
├── messages/                     # Translation files (en.json, ro.json)
├── public/                       # Static assets, logos, favicons
├── netlify.toml                  # Build + redirect + header config
├── next.config.ts                # Next.js config (image domains)
├── tailwind.config.ts            # Tailwind with brand colors
└── package.json                  # Dependencies
```

### Critical note: Two frontend architectures

The repo contains **both** a legacy Vite SPA (`src/`) and the production Next.js App Router (`app/`). **All new frontend work goes in `app/`.** The `src/` directory exists for legacy reasons; it is not served in production. The `src/integrations/supabase/types.ts` file is the only actively-referenced file from `src/` and it is STALE — missing `authors`, `ad_banners`, `ad_pricing`, `cover_image_credit`, `word_count` columns.

---

## 4. Database Schema (Supabase PostgreSQL)

### Core tables

| Table | Purpose | Key columns |
|---|---|---|
| `blog_posts` | Published/draft articles | slug, title_ro/en, content_ro/en, excerpt_ro/en, summary_ro/en, category, subcategory, author_name, status (draft/published/pending_review/rejected), cover_image, cover_image_credit, tags_ro/en, seo_title_ro/en, seo_description_ro/en, word_count, ai_quality_score, ai_editor, scraped_article_id, is_breaking, published_at |
| `scraped_articles` | RSS-scraped source articles | original_title, original_content, original_content_full, source_word_count, source_id (→rss_sources), status (scraped/rewriting/processed/failed/used), category, subcategory, assigned_editor, rewritten_en/ro, title_en/ro, excerpt_en/ro, summary_en/ro, rewrite_tags_en/ro, ai_score, plagiarism_score, rewrite_error, rewrite_finished_at |
| `rss_sources` | RSS feed configurations | name, url, category (often 'auto-detect'), source_language, source_type, scope, county, output_limit, is_active |
| `rewrite_jobs` | Rewrite queue | article_id (→scraped_articles), scraped_article_id, editor, status (queued/processing/succeeded/failed), retry_count |
| `authors` | Editor profiles (NOT in types.ts) | slug, name_ro/en, title_ro/en, bio_ro/en, avatar_url, avatar_style, specialties[] |
| `blog_comments` | Reader comments | post_id (→blog_posts), author_name, author_email, content, ai_reply, status |
| `contact_messages` | Contact form submissions | name, email, subject, message, admin_reply, status, replied_at |
| `newsletter_subscribers` | Newsletter list | email, language, is_confirmed, token |
| `newsletter_campaigns` | Sent newsletters | subject, html_content, target_language, sent_count, status |
| `profiles` | Auth user profiles | id (→auth.users), full_name, avatar_url |
| `user_roles` | Admin role assignments | user_id (→auth.users), role (admin/moderator/user) |
| `site_settings` | Key-value site config | key, value |
| `site_analytics` | Analytics events | page_path, event_type, country, referrer |
| `section_views` | Section view counts | section_name, view_count |
| `contacts` | CRM contacts | email, name, language, tags[], newsletter_subscribed |
| `county_quotas` | RSS source quotas per county | county, quota |
| `ad_banners` | Sponsor/ad banners (NOT in types.ts) | advertiser_name, headline_ro/en, body_ro/en, cta_ro/en, url, image_url, slot, weight, is_active, impressions, clicks |
| `ad_pricing` | Ad slot pricing (NOT in types.ts) | slot, label_ro/en, format, price |

### Views
- `blog_comments_public` — public-facing comment view (filters approved only)

### Functions
- `has_role(user_id, role)` — checks user role

---

## 5. Supabase Edge Functions

### ⚠ CRITICAL: Repo names ≠ Deployed names

Functions deployed via **Supabase MCP** use a `tt-` prefix. Functions deployed via **CLI** use the folder name from the repo. Some functions exist ONLY as deployed (not in repo) and vice versa.

| Deployed Name | Repo Folder | Status | Purpose |
|---|---|---|---|
| `tt-process-scraped-article` | *(not in repo)* | ✅ ACTIVE (v4) | ★ Main pipeline: RSS → bilingual article with editor voice. 1633 lines. 4-pass: Gemini facts → GPT-4o EN draft → parallel Sonnet [EN voice + RO native] → title validation. Deployed via MCP only. |
| `tt-generate-article` | `ai-generate-article/` | ⚠ NEEDS REWRITE | ★ Admin AI Editor: generates article from brief + type. Currently uses OLD architecture (GPT-4o only, no editor identity, no calque sanitizer, RO translated from EN). 207 lines. Frontend calls this from `app/admin/editor/page.tsx`. |
| `tt-generate-cover` | *(not in repo)* | ✅ ACTIVE | Cover image generation for admin editor. HuggingFace FLUX + DALL-E 3 + Unsplash fallback. Deployed via MCP only. |
| `tt-scrape-rss` | `scrape-rss/` | ✅ ACTIVE | RSS feed scraping. Deployed version may differ from repo. 137 lines in repo. |
| `generate-cover-image` | `generate-cover-image/` | ✅ ACTIVE | Cover image for scraped articles. 185 lines. HuggingFace + DALL-E + Unsplash. Updated with Gemini visual keyword generation. |
| `process-rewrite-job` | `process-rewrite-job/` | ✅ ACTIVE | Rewrite pipeline for admin "AI Rewrite" button. 418 lines. Uses `_shared/sanitize.ts` + `_shared/gemini.ts`. GPT-4o synthesis. Writes to `scraped_articles` only (NOT `blog_posts`). |
| `check-content-quality` | `check-content-quality/` | ✅ ACTIVE | AI quality scoring. 182 lines. Penalizes high sentence variance, semicolons, adverb density. Used by tt-process-scraped-article (Desk 3). |
| `enqueue-rewrite-article` | `enqueue-rewrite-article/` | ✅ ACTIVE | Creates rewrite_jobs entries for process-rewrite-job. 61 lines. |
| `ai-rewrite-article` | `ai-rewrite-article/` | 🚫 DEPRECATED | Stub that redirects to enqueue-rewrite-article. 48 lines. |
| `ai-blog-assistant` | `ai-blog-assistant/` | ✅ ACTIVE | In-editor AI helpers (improve, translate, suggest titles, SEO). 57 lines. Uses Gemini. |
| `ai-comment-reply` | `ai-comment-reply/` | ✅ ACTIVE | AI-generated comment replies. 55 lines. Uses Gemini. |
| `ai-newsletter-composer` | `ai-newsletter-composer/` | ✅ ACTIVE | AI newsletter content generation. 68 lines. Uses Gemini. |
| `confirm-newsletter` | `confirm-newsletter/` | ✅ ACTIVE | Double opt-in confirmation. 83 lines. Uses Resend. |
| `send-newsletter` | `send-newsletter/` | ✅ ACTIVE | Sends newsletter to subscribers. 116 lines. Uses Resend. |
| `generate-weekly-newsletter` | `generate-weekly-newsletter/` | ✅ ACTIVE | Auto-generates weekly newsletter from recent articles. 182 lines. |
| `send-inbox-reply` | `send-inbox-reply/` | ✅ ACTIVE | Sends admin reply to contact messages. 81 lines. Uses Resend. |
| `og-proxy` | `og-proxy/` | ✅ ACTIVE | OpenGraph meta proxy for social sharing. 161 lines. |
| `competitor-analysis` | `competitor-analysis/` | ✅ ACTIVE | GEO competitor analysis tool. 55 lines. Uses Gemini. |
| `geo-lookup` | `geo-lookup/` | ✅ ACTIVE | IP geolocation lookup. 83 lines. |
| `geo-optimize` | `geo-optimize/` | ✅ ACTIVE | GEO page optimization analyzer. 59 lines. Uses Gemini. |
| `scrape-rss` | `scrape-rss/` | ⚠ UNCLEAR | In repo but may be superseded by deployed `tt-scrape-rss`. |

### Shared modules (`supabase/functions/_shared/`)

| File | Lines | Purpose |
|---|---|---|
| `sanitize.ts` | 472 | `sanitizeContent()`, `humanizeContent()` (GPT-4o/Haiku neutralizing pass), `normalizeTags()`, `sanitizeTitle()`, `countWords()`. **⚠ `humanizeContent()` STRIPS voice** — flattens personality with temperature 0.4. Used by `process-rewrite-job` and `ai-generate-article`. |
| `claude.ts` | 114 | Claude API helper. Exports `CLAUDE_HAIKU`, `CLAUDE_SONNET`, `callClaude()`. |
| `gemini.ts` | 62 | Gemini API helper. Exports `callGemini()`. |
| `brandedEmail.ts` | 63 | HTML email template with TT branding. |

### ⚠ MCP deployment limitation

Supabase MCP's `deploy_edge_function` bundles each function as a self-contained file. It does **NOT** resolve local relative imports like `../_shared/sanitize.ts`. Functions deployed via MCP must inline all dependencies. Functions in the repo that import from `_shared/` can only be deployed via CLI (`supabase functions deploy`).

### Cron jobs (pg_cron)

| Job ID | Schedule | Function | Auth |
|---|---|---|---|
| 8 | Every 3 hours | `tt-scrape-rss` | Service role key hardcoded in pg_cron SQL |
| 9 | Every 3 hours (offset) | `tt-process-scraped-article` | Service role key hardcoded in pg_cron SQL |

---

## 6. AI Pipeline Architecture

### Pipeline A: Scraped Article Processing (`tt-process-scraped-article`, v4)

```
RSS Source → tt-scrape-rss → scraped_articles (status: scraped)
                                    ↓
         tt-process-scraped-article (1633 lines, deployed via MCP)
                                    ↓
┌─── Desk 1: Gemini 2.5 Flash ─────────────────────────────────┐
│  • Fact extraction (numbered list)                            │
│  • Category classification (if auto-detect)                   │
│  • Smart editor selection via RECOMMENDED_EDITOR              │
│  Input: scraped_articles.original_content                     │
│  Output: facts list + CATEGORY + SUBCATEGORY + editor key     │
└───────────────────────────────────────────────────────────────┘
                                    ↓
┌─── Desk 2A: GPT-4o ──────────────────────────────────────────┐
│  produceEnglishDraft() — ENGLISH ONLY                         │
│  • Rich EDITOR_IDENTITY prompt (role + craft, no fake CV)     │
│  • TT_STANDARDS (attribution, format, banned words)           │
│  • Adaptive length via getTargetWordCount()                   │
│  Output: title_en, content_en, excerpt_en, summary_en, etc.  │
└───────────────────────────────────────────────────────────────┘
                                    ↓
┌─── Desk 2B: Claude Sonnet 4.6 × 2 (PARALLEL) ────────────────┐
│  Promise.all([                                                │
│    refineEnglishInVoice() — EN draft → editor-voiced EN       │
│    composeRomanianNatively() — facts → native RO              │
│      (system prompt IN ROMANIAN, never sees EN as template)   │
│  ])                                                           │
│  Safety checks: word count ±30%, title length, content length │
│  Fallback: if RO fails, flags for review                      │
└───────────────────────────────────────────────────────────────┘
                                    ↓
┌─── Desk 2C: Claude Sonnet 4.6 (conditional) ─────────────────┐
│  regenerateTitleIfGeneric() — fires ~30% of articles          │
│  • isTitleGeneric() with editor-specific structural checks    │
│  • Popescu: needs strong verb + institution                   │
│  • Bratu: needs Transylvanian place reference                 │
│  • Marinescu: needs number or research term                   │
│  • Ionescu: needs system/protocol/year                        │
│  • Dobos: needs person or company name                        │
└───────────────────────────────────────────────────────────────┘
                                    ↓
┌─── Desk 3: check-content-quality ─────────────────────────────┐
│  AI quality scoring                                           │
└───────────────────────────────────────────────────────────────┘
                                    ↓
         blog_posts (status: draft) + scraped_articles (status: processed)
```

### Pipeline B: Admin AI Editor (`tt-generate-article`)

**⚠ NEEDS REWRITE — currently uses OLD architecture:**
- No EDITOR_IDENTITY, no TT_STANDARDS
- Romanian generated from English (translation, not native)
- No calque sanitizer
- Uses `humanizeContent()` which strips voice
- 207 lines, GPT-4o only, no Sonnet voice pass

**Frontend contract** (`app/admin/editor/page.tsx`, 718 lines):

Input (sent to function):
```json
{
  "prompt": "<constructed by buildPrompt() with article type instructions>",
  "word_count": 800 | 1200 | 1800,
  "category": "news" | "politics" | etc.
}
```

The `prompt` field includes the full article type instructions (Editorial, Analiză, Pamflet, Blog, Reportaj, Cultură, Tehnologie) built client-side via `buildPrompt()`.

Expected output:
```json
{
  "title_ro": "", "title_en": "",
  "excerpt_ro": "", "excerpt_en": "",
  "summary_ro": "", "summary_en": "",
  "content_ro": "", "content_en": "",
  "tags_ro": [], "tags_en": [],
  "seo_title_ro": "", "seo_title_en": "",
  "seo_description_ro": "", "seo_description_en": "",
  "slug": "",
  "author_name": ""
}
```

**7 Article Types (tones):**
1. `editorial` — thesis-driven opinion piece (authoritative, lucid)
2. `analiza` — multi-perspective analysis (expert, data-driven)
3. `pamflet` — satire in Swift/Voltaire/Caragiale tradition (ironic praise → progressive dismantling → absurd revelation)
4. `blog` — personal voice blog post (warm, direct, practical)
5. `reportaj` — narrative reportage (scene, voices, tension)
6. `cultura` — cultural criticism (interpretation, context, contemporary value)
7. `tehnologie` — tech journalism (demystification, real impact, healthy skepticism)

### Pipeline C: Admin AI Rewrite (`enqueue-rewrite-article` → `process-rewrite-job`)

Triggered from admin article editor. Creates a `rewrite_jobs` entry, then `process-rewrite-job` picks it up. Uses `_shared/sanitize.ts` including `humanizeContent()`. Writes to `scraped_articles` only, NOT `blog_posts`.

---

## 7. Editor System (7 editors)

| Key | Name | Role | Category mapping |
|---|---|---|---|
| `andrei_popescu` | Andrei Popescu | Accountability correspondent | politics, news |
| `lucian_bratu` | Lucian Bratu | Cultural correspondent for Transylvania | culture, travel |
| `elena_vasilescu` | Elena Vasilescu | Science and ideas correspondent | education |
| `sofia_marinescu` | Sofia Marinescu | Data and health correspondent | health |
| `daniel_dobos` | Daniel Dobos | Technology and business storyteller | business, opinion |
| `mihai_ionescu` | Mihai Ionescu | Technical critic | technology |
| `victor_simon` | Victor Simon | General news wire correspondent | sports, news (fallback) |

Author slugs in `authors` table: `daniel-dobos`, `andrei-popescu`, `elena-vasilescu`, `lucian-bratu`, `sofia-marinescu`, `mihai-ionescu`, `victor-simon`, `mihai-isac`, `marcus-webb`.

**⚠ CV claims removed (May 2026):** All fabricated credentials (Reuters, Nature, EPFL, Ars Technica, Mediafax, Columbia, Fulbright, Max Planck) were stripped from both the edge function prompts AND the `authors` table bios. Replaced with role-only descriptions.

---

## 8. Supabase Secrets (Edge Function Environment)

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini 2.5 Flash |
| `OPENAI_API_KEY` | GPT-4o |
| `CLAUDE_API_KEY` | Claude Sonnet 4.6 / Haiku 4.5 (⚠ NOT `ANTHROPIC_API_KEY`) |
| `HUGGING_FACE_API_KEY` | HuggingFace FLUX image gen |
| `UNSPLASH_ACCESS_KEY` | Unsplash photo API |
| `POLLINATIONS_API_KEY` | Pollinations FLUX image gen |
| `RESEND_API_KEY` | Resend email service |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role for DB operations |
| `SUPABASE_URL` | Supabase project URL |

---

## 9. Critical Gotchas

1. **Supabase MCP is read-restricted** on this project — `execute_sql`, `list_tables`, `list_edge_functions`, `get_edge_function` all return "no permission". Only `deploy_edge_function` and `apply_migration` work. Read live data from the website instead.

2. **`_shared/` imports don't work via MCP deploy.** Functions deployed through Supabase MCP must be self-contained (all dependencies inlined). The MCP bundler does not resolve relative imports.

3. **`humanizeContent()` in `_shared/sanitize.ts` STRIPS editorial voice.** It runs a GPT-4o pass at temperature 0.4 that neutralizes personality. It's used by `process-rewrite-job` and the repo's `ai-generate-article`. The v4 `tt-process-scraped-article` does NOT use it.

4. **`check-content-quality` penalizes personality.** It scores DOWN for high sentence-length variance, semicolons, adverb density, and "repetitive structure" — all of which can be legitimate editorial style. Treat its score as advisory, not gating.

5. **`types.ts` is stale.** Missing tables: `authors`, `ad_banners`, `ad_pricing`. Missing columns: `word_count`, `cover_image_credit` on `blog_posts`. Regenerate via `npx supabase gen types typescript`.

6. **Category compound bug (historical).** Old articles (pre-April 2026) have compound category strings like `"STIRI|POLITICA|ADMINISTRATIE"`. A cleanup SQL migration was prepared but may not have been run yet.

7. **Deployed function names use `tt-` prefix**, repo folder names do not. Mapping: `tt-generate-article` → `ai-generate-article/`, `tt-generate-cover` → (not in repo), `tt-scrape-rss` → `scrape-rss/`, `tt-process-scraped-article` → (not in repo).

---

## 10. Development Standards (Daniel's rules)

1. **Plan first, get approval before implementing.**
2. **Enterprise-grade solutions only** — no patches, no partial files.
3. **Deliver complete files** — never snippets.
4. **Never deploy without explicit instruction.**
5. **Never hallucinate schema or data** — verify before assuming.
6. **Argue when technically correct** — Daniel prefers critical engagement.
7. **Code delivered as text in chat** with full file paths.
8. **Daniel deploys manually** — do not use Supabase MCP `deploy_edge_function` unless explicitly instructed.

---

## 11. Current Issues & Improvement Roadmap

### Issues

| Priority | Issue | Status |
|---|---|---|
| 🔴 Critical | `tt-generate-article` (Admin AI Editor) uses OLD architecture — no editor identity, no native RO, no calque sanitizer, uses `humanizeContent()` which strips voice | NEEDS REWRITE |
| 🟡 Medium | Compound categories in old blog_posts (STIRI\|POLITICA) — SQL cleanup prepared but may be pending | PENDING SQL RUN |
| 🟡 Medium | `types.ts` stale — missing authors, ad_banners, ad_pricing tables and recent columns | NEEDS REGENERATION |
| 🟡 Medium | `process-rewrite-job` uses old editor personas and `humanizeContent()` | NEEDS V4 ALIGNMENT |
| 🟢 Low | FCP 8.68s (original CSR SPA concern) — likely resolved by Next.js App Router migration | VERIFY |

### Improvements (recommended)

1. **Rewrite `tt-generate-article`** with v4 architecture: ARTICLE_TYPE_IDENTITY for 7 tones, parallel Sonnet EN/RO, calque sanitizer, title validation.
2. **Enable Anthropic prompt caching** on EDITOR_IDENTITY + TT_STANDARDS (~$15-25/month savings).
3. **Use Haiku 4.5 for title regeneration** (Desk 2C) — 67% cheaper for this simple task.
4. **Evaluate Batch API** for non-urgent scraped article processing (50% savings, 24h turnaround).
5. **Align `process-rewrite-job`** with v4 editor identity and sanitizer improvements.
6. **Regenerate `types.ts`** to reflect current DB schema including authors and ad tables.

---

## 12. Cost Reference (May 2026)

| Model | Input $/M tokens | Output $/M tokens |
|---|---|---|
| Gemini 2.5 Flash | ~$0.10 | ~$0.40 |
| GPT-4o | $2.50 | $10.00 |
| GPT-5 | $1.25 | $10.00 |
| GPT-5.4 | $2.50 | $15.00 |
| Claude Sonnet 4.6 | $3.00 | $15.00 |
| Claude Haiku 4.5 | $1.00 | $5.00 |
| Claude Opus 4.7 | $5.00 | $25.00 |

**Estimated pipeline cost:** ~$0.124 per article via `tt-process-scraped-article`, ~$75/month at 600 articles.

**Cost levers:** Prompt caching (90% off cached input), Batch API (50% off, 24h), Haiku for simple tasks (67% cheaper).
