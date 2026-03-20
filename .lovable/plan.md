

## Plan: Phase 3 — CommentsManager, ContactsPage & GeoToolsPage

### Schema Gaps

The `contacts` table is missing columns that `ContactsPage.tsx` references:
- `language text` — not present (source filters by it)
- `tags text[]` — not present (source displays/exports them)
- `newsletter_subscribed boolean` — not present (source toggles it)

The `blog_comments` table uses `status` column (values: `pending`, `approved`) but the source code references `is_approved` boolean. Must adapt the source code to use `status` instead.

### Step 1: Database Migration

Add missing columns to `contacts`:

```sql
ALTER TABLE contacts ADD COLUMN language text DEFAULT 'en';
ALTER TABLE contacts ADD COLUMN tags text[] DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN newsletter_subscribed boolean DEFAULT false;
```

### Step 2: Files to Create

| File | Purpose |
|------|---------|
| `src/pages/admin/CommentsManager.tsx` | Comment moderation — adapted to use `status` column instead of `is_approved`. Approve sets `status = 'approved'`, pending check uses `status = 'pending'`. AI reply regeneration calls `ai-comment-reply` edge function (will error until deployed). |
| `src/pages/admin/ContactsPage.tsx` | Unified CRM with search, source/language filters, bulk select, CSV export, newsletter toggle. Adapted to match actual `contacts` table schema. |
| `src/pages/admin/GeoToolsPage.tsx` | Tabs wrapper for GEO Analyzer and Competitor Analysis. |
| `src/pages/admin/geo/GeoAnalyzerTab.tsx` | Placeholder tab — calls `geo-optimize` edge function (not yet deployed). Simple form with URL input and results display. |
| `src/pages/admin/geo/CompetitorTab.tsx` | Placeholder tab — calls `competitor-analysis` edge function (not yet deployed). Simple form with topic input and results display. |

### Step 3: Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Replace `ComingSoon` with real components for `comments`, `contacts`, `geo` routes |

### Key Adaptations

**CommentsManager** — All `is_approved` references changed to `status` checks:
- `c.is_approved` → `c.status === 'approved'`
- `.update({ is_approved: true })` → `.update({ status: 'approved' })`
- `.order('is_approved', ...)` → `.order('status', ...)`

**ContactsPage** — Interface simplified to match actual columns. Remove references to `configurator` source (not relevant to news site).

**GeoToolsPage** — Thin wrapper. The two sub-tabs will have functional UI but edge functions aren't deployed yet, so they'll show errors on submit.

