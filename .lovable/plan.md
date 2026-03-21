
I reviewed the code, the current admin editor state, and the live data flow. The user is right to be angry: the Romanian SEO issue is not reliably solved end to end.

## What is actually wrong

There are 3 separate layers, and they are not aligned:

1. Front-end article page SEO (`src/pages/BlogPost.tsx`)
   - The page component now prefers Romanian SEO fields correctly.
   - But it does not set `document.documentElement.lang`, so the page language itself is not synchronized.
   - It also uses one fallback order on the page and a different one in the OG proxy.

2. Social / crawler SEO (`supabase/functions/og-proxy/index.ts`)
   - The OG proxy only switches to Romanian if `?lang=ro` exists in the URL.
   - Your route is `/blog/:slug` with no language segment, and the site language switcher is client-side only.
   - So bots and previews default to English unless a `lang=ro` param is present.
   - This is one major reason the user still sees English SEO.

3. Content generation / admin saving pipeline
   - The database does contain Romanian SEO fields for many posts, so the issue is not only missing data.
   - But generated `tags` are still English-only in `ai-generate-article`, because it returns `tags: enArticle.tags || []`.
   - The editor UI uses a single shared `tags` input for both languages, so Romanian keyword pills/keywords cannot be localized independently.
   - For RSS rewrites, tags come from `rewrite_tags`, also shared, so the Romanian side still inherits English keywords.

## CTO conclusion

This is not one bug. It is an architecture inconsistency:
- page SEO logic,
- social sharing SEO logic,
- and admin/generated metadata storage
all use different assumptions.

That is why the problem keeps “coming back”.

## High-level enterprise solution

I would fix this as one coherent SEO architecture, not patches:

### 1. Make Romanian SEO deterministic on the article page
Update `src/pages/BlogPost.tsx` so the article page:
- sets `document.documentElement.lang` to `ro`/`en`
- uses one centralized localized metadata resolver for:
  - title
  - description
  - OG title/description
  - Twitter title/description
  - JSON-LD `inLanguage`
- uses the exact Romanian fallback order everywhere:
  - title: `seo_title_ro -> title_ro -> title_en`
  - description: `seo_description_ro -> summary_ro -> excerpt_ro -> summary_en -> excerpt_en`

### 2. Fix the real root cause in the OG proxy
Update `supabase/functions/og-proxy/index.ts` so Romanian metadata is not dependent only on `?lang=ro`.

Recommended enterprise approach:
- detect requested language from, in order:
  1. explicit `lang=ro` query param
  2. `Accept-Language` header if present
  3. fallback to English
- pass the bot request `Accept-Language` through `netlify/edge-functions/og-rewrite.ts`
- use the same fallback resolver in OG proxy as on the React page
- add `og:locale` and alternate locale in the generated HTML too

This makes crawler/social previews consistent with the live page.

### 3. Separate language-specific tags/keywords properly
The current model uses one `tags` array for both languages. That is not enterprise-grade for bilingual SEO.

Best solution:
- add `tags_en text[]` and `tags_ro text[]` to `blog_posts`
- add `rewrite_tags_en text[]` and `rewrite_tags_ro text[]` to `scraped_articles`
- keep old `tags` temporarily for backward compatibility during migration
- update generators:
  - `ai-generate-article` returns both `tags_en` and `tags_ro`
  - `process-rewrite-job` and `ai-rewrite-article` store both language-specific tag sets
- update admin editor to edit EN and RO tags separately
- update `BlogPost.tsx` to display Romanian pills from `tags_ro` when RO is active

This is the only clean fix for “Romanian SEO tags still in English”.

### 4. Normalize admin editor behavior
Update `src/pages/admin/BlogEditor.tsx` so:
- SEO EN and SEO RO are visually separated and clearly labeled
- tags become two inputs:
  - Tags (EN)
  - Tags (RO)
- when importing from RSS, Romanian SEO fields and Romanian tags are loaded into the Romanian inputs only
- when saving, all localized metadata is persisted explicitly without cross-language leakage

### 5. Verify the full pipeline for newly created articles
The current user example is a new article created seconds ago. So the plan must explicitly cover the “just created now” case:
- RSS rewrite populates `title_ro`, `summary_ro`, `seo_title_ro`, `seo_description_ro`, `rewrite_tags_ro`
- Blog editor loads them correctly
- publish action maps them into `blog_posts`
- article page renders them
- OG proxy outputs them for bots

## Files to change

- `src/pages/BlogPost.tsx`
  - centralize localized SEO resolver
  - set `<html lang>`
  - unify page metadata fallback order
  - optionally localize visible hashtag pills from language-specific tags

- `netlify/edge-functions/og-rewrite.ts`
  - forward `Accept-Language`
  - preserve language context for bots

- `supabase/functions/og-proxy/index.ts`
  - detect Romanian from query/header
  - unify fallback order with page SEO
  - emit localized OG/Twitter/article meta consistently

- `src/pages/admin/BlogEditor.tsx`
  - split EN/RO tags
  - keep SEO fields language-specific and isolated

- `supabase/functions/ai-generate-article/index.ts`
  - return `tags_en` and `tags_ro`

- `supabase/functions/process-rewrite-job/index.ts`
  - store `rewrite_tags_en` and `rewrite_tags_ro`

- `supabase/functions/ai-rewrite-article/index.ts`
  - store separate EN/RO tags if still used in the pipeline

- `supabase/migrations/*`
  - add bilingual tag columns and backward-compatible defaults

## Database / migration plan

Add:
- `blog_posts.tags_en text[] default '{}'::text[]`
- `blog_posts.tags_ro text[] default '{}'::text[]`
- `scraped_articles.rewrite_tags_en text[] default '{}'::text[]`
- `scraped_articles.rewrite_tags_ro text[] default '{}'::text[]`

Backfill strategy:
- copy existing `tags` into `tags_en`
- leave `tags_ro` empty until regenerated or manually edited
- copy `rewrite_tags` into `rewrite_tags_en`

This avoids breaking existing pages while enabling proper Romanian SEO going forward.

## Why this is the best solution

Because it fixes the real architectural gap:
- client SEO
- bot SEO
- generated metadata
- editor persistence
all become language-aware in the same way.

Anything smaller will keep producing English leakage into Romanian SEO.

## Acceptance criteria

After implementation, a newly created Romanian article must satisfy all of these:
- browser tab title is Romanian
- `meta[name="description"]` is Romanian
- `og:title` and `og:description` are Romanian
- `twitter:title` and `twitter:description` are Romanian
- JSON-LD `headline`, `description`, and `inLanguage` are Romanian
- page `<html lang="ro">`
- Romanian keyword/tag pills are Romanian
- social preview endpoint returns Romanian metadata when the request language is Romanian
- admin editor shows separate EN and RO tags and preserves them on save
