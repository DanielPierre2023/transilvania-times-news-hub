

## CTO Analysis: Enterprise Implementation Plan

### Scope — 6 Deliverables

After thorough codebase review, the plan is sound but needs these refinements for enterprise quality.

---

### 1. Breaking News — DB-Driven

**Migration**: Add `is_breaking boolean default false` to `blog_posts`.

**`src/components/Header.tsx`**: Replace hardcoded `breakingHeadlines` (line 29) with a Supabase query fetching `blog_posts` where `is_breaking = true` and `status = 'published'`, ordered by `published_at desc`, limit 5. Use localized title. Fallback to i18n strings if no results. Use `useQuery` with a 60s stale time to avoid excessive fetches on a sticky header.

**`src/pages/admin/BlogEditor.tsx`**: Add a "Breaking News" `Switch` toggle in the form that maps to `is_breaking`. Save it alongside other fields.

**`src/pages/admin/BlogManager.tsx`**: Show a `⚡ Breaking` badge next to title when `is_breaking = true`. Add a quick-toggle Switch in the table row.

---

### 2. Footer Fixes

**`src/components/Footer.tsx`**:
- Line 77: Change `str. Memorandumului nr 2` → `str. Frunzișului nr. 89`
- Line 159: Remove the VAT line (`<p className="mt-0.5">VAT: CY10439793M</p>`)

---

### 3. Romanian Editorial Team

Replace English-sounding names across 4 files. Keep Daniel Dobos, Elena Vasilescu, Sofia Marinescu (already Romanian). Replace the 3 English names:

| Old | New | Style |
|-----|-----|-------|
| Marcus Webb | Andrei Popescu | Investigative, punchy, cynical — "The Hard-Hitter" |
| James Chen | Lucian Bratu | Philosophical, metaphor-rich, Romanian cultural refs — "The Philosopher" |
| Daniel Novak | Mihai Ionescu | Architecture-focused, sardonic, specs-driven — "The Tech Guru" |

**Add 2 real journalists** (manual authors only, NOT in scraper rotation):
- Cristina Erika
- Corina Bugner

**Files to update**:
- `src/pages/admin/BlogEditor.tsx` — Replace EDITORS + EDITOR_NAMES (lines 18-30). Add separate "Author" list with Daniel Dobos, Cristina Erika, Corina Bugner for manual articles.
- `src/pages/admin/RssScraper.tsx` — Replace EDITORS (lines 23-29)
- `supabase/functions/process-rewrite-job/index.ts` — Replace EDITORS dict (lines 12-19)
- `supabase/functions/ai-rewrite-article/index.ts` — Replace EDITORS dict (lines 11-18)
- `supabase/functions/ai-generate-article/index.ts` — Replace EDITORS dict

---

### 4. Enhanced Humanizer Prompt

**`supabase/functions/process-rewrite-job/index.ts`** — Enhance the synthesis prompt with the Master Humanizing instructions:

- Max 3 consecutive words from source
- BURSTINESS: Mix 3-word sentences with 25+ word complex ones
- PERPLEXITY: Industry jargon, idiomatic expressions, Romanian-isms
- Date hook: Reference current date context
- Map each editor to their Linguistic Fingerprint (Hard-Hitter, Philosopher, Tech Guru, Localist, Skeptic, Storyteller)
- Explicit anti-pattern: "Do NOT follow the original article's sentence structure"

---

### 5. Social Sharing OG Proxy

**New files**:
- `netlify/edge-functions/og-rewrite.ts` — Bot UA detection → proxies to Supabase function
- `supabase/functions/og-proxy/index.ts` — Fetches blog post from DB, generates full HTML with OG/Twitter/article meta tags. `verify_jwt = false`.
- `netlify.toml` — SPA routing rules + edge function registration for `/blog/*`

**`supabase/config.toml`** — Add `[functions.og-proxy]` section with `verify_jwt = false`.

Adapted for this project: domain `https://transilvaniatimes.com`, Supabase URL `https://zimpimoierpsocnmnizm.supabase.co`, correct column names from schema.

---

### 6. Newsletter — Footer Only (Confirmed)

**`src/pages/Index.tsx`**: Newsletter is already NOT imported on the homepage. No change needed. ✓

**`src/components/Newsletter.tsx`**: Keep as standalone component (used nowhere currently on homepage — correct). No change.

---

### File Summary

| File | Change |
|------|--------|
| **Migration** | `ALTER TABLE blog_posts ADD COLUMN is_breaking boolean DEFAULT false` |
| `src/components/Header.tsx` | DB-driven breaking news marquee with useQuery |
| `src/components/Footer.tsx` | Remove VAT, update address |
| `src/pages/admin/BlogEditor.tsx` | Romanian editors, breaking toggle, real journalist authors |
| `src/pages/admin/BlogManager.tsx` | Breaking badge + toggle |
| `src/pages/admin/RssScraper.tsx` | Romanian editor names |
| `supabase/functions/process-rewrite-job/index.ts` | Romanian editors + enhanced humanizer prompt |
| `supabase/functions/ai-rewrite-article/index.ts` | Romanian editors |
| `supabase/functions/ai-generate-article/index.ts` | Romanian editors |
| `netlify/edge-functions/og-rewrite.ts` | New: bot detection + proxy |
| `supabase/functions/og-proxy/index.ts` | New: OG meta generation |
| `netlify.toml` | New: SPA routing + edge function |
| `supabase/config.toml` | Add og-proxy config |

