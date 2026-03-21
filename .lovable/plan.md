

## CTO Analysis: End-to-End Category/Subcategory/Language Integrity

### Critical Gaps Found

**1. `blog_posts` table has NO `subcategory` column**
The DB schema shows `blog_posts` has `category text` but no `subcategory`. Articles cannot be published with geographic scope until this column exists.

**2. `scraped_articles` table has NO `category` or `subcategory` columns**
The pipeline has nowhere to store AI-classified results. The current code reads category from `rss_sources.category` via join — which is source-level, not article-level.

**3. Category page only queries by `category` — no subcategory filtering**
`Category.tsx` line 28: `.eq("category", name?.toLowerCase())` — no subcategory support. No route exists for `/category/:name/:sub`.

**4. Category is passed as a URL param, not from the article record**
`RssScraper.tsx` line 183-184: `editAndPublish()` reads `rss_sources.category` and passes it as `?category=X` URL param. `BlogEditor.tsx` line 154: reads `searchParams.get('category')`. This means category comes from the RSS source, not from the AI classifier. If a generalist source scrapes politics + sports articles, they all get the same source-level category.

**5. "News" category missing everywhere**
Header, Footer, BlogEditor, RssScraper, ai-generate-article — all have hardcoded `CATEGORIES` arrays with 10 items. None include "news". The Header nav has no link for it. The i18n has no `cat_news` translation.

**6. Category labels on frontend are raw English slugs**
`Blog.tsx` line 62: `{post.category || "news"}` — displays raw slug. `Category.tsx` line 107: same. These should use i18n translations based on current language. A `politics` article should show "Politică" when in Romanian.

**7. `process-rewrite-job` doesn't classify or store category**
The edge function updates `scraped_articles` with rewritten content but never sets `category` or `subcategory`. Even after we add classification to Desk 1, the pipeline must save these values.

**8. `ai-generate-article` doesn't output subcategory**
Line 50: has CATEGORIES array but no subcategory concept. Generated articles via the AI Article Generator won't have geographic scope.

**9. No route for subcategory filtering**
`App.tsx` line 48: only `/category/:name`. No `/category/:name/:sub` route.

**10. Duplicated category lists in 6+ files**
Categories are defined separately in: Header.tsx, Footer.tsx, RssScraper.tsx, BlogEditor.tsx, ai-generate-article/index.ts, process-rewrite-job/index.ts. Adding "news" means editing all 6. This will drift.

### Enterprise-Grade Plan

#### Phase 1: Database Schema

**Migration**:
```sql
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE scraped_articles ADD COLUMN IF NOT EXISTS subcategory text;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS subcategory text;
```

#### Phase 2: Single Source of Truth — Taxonomy File

Create `src/lib/categories.ts`:
```typescript
export const CATEGORIES = [
  'politics', 'world', 'technology', 'business', 'culture',
  'opinion', 'travel', 'education', 'sports', 'health', 'news'
] as const;

export const SUBCATEGORIES = ['regional', 'national', 'international'] as const;

// For normalizing LLM output
export const CATEGORY_ALIASES: Record<string, string> = {
  tech: 'technology', sport: 'sports', economia: 'business',
  economie: 'business', politica: 'politics', /* etc. */
};

export function normalizeCategory(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return CATEGORY_ALIASES[lower] || (CATEGORIES.includes(lower as any) ? lower : 'news');
}

export function normalizeSubcategory(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return SUBCATEGORIES.includes(lower as any) ? lower : 'international';
}
```

#### Phase 3: AI Classification in `process-rewrite-job` (Desk 1)

Update the Gemini extraction prompt to also output category + subcategory:

```text
"Extract facts as a numbered list. On the LAST two lines:
CATEGORY: {politics|world|technology|business|culture|opinion|travel|education|sports|health|news}
SUBCATEGORY: {regional|national|international}

regional = about Transilvania, Cluj, Sibiu, Brașov, Transylvanian cities/counties
national = about Romania (Bucharest, national government, countrywide)
international = everything else"
```

After extraction, parse category/subcategory from the response. Use `normalizeCategory()` / `normalizeSubcategory()`. If `scraped_articles.category` is already set (from a fixed-category source), keep it but still detect subcategory.

Save both to `scraped_articles` in the final update block.

#### Phase 4: i18n Translations

Add to both EN and RO translation blocks:
- `cat_news` → "News" / "Știri"
- `subcat_regional` → "Regional" / "Regional"
- `subcat_national` → "National" / "Național"
- `subcat_international` → "International" / "Internațional"

#### Phase 5: Frontend Components — Use Taxonomy + i18n

**Header.tsx** and **Footer.tsx**: Import from `categories.ts`, add "news" to nav.

**Category.tsx**:
- Accept optional subcategory: route `/category/:name/:sub?`
- Query: `.eq('category', name)` + optionally `.eq('subcategory', sub)`
- Display category label using i18n (`t("cat_" + category)`) instead of raw slug
- Show subcategory filter tabs (Regional | National | International | All)

**Blog.tsx**: Replace raw `{post.category || "news"}` with `t("cat_" + post.category)` for bilingual display.

**BlogPost.tsx**: Same — show translated category + subcategory badge.

**App.tsx**: Add route `<Route path="/category/:name/:sub" element={<Category />} />`

#### Phase 6: Admin — RssScraper.tsx

- Add "🤖 Auto-Detect" to CATEGORIES dropdown (value: `auto-detect`)
- When inserting scraped articles: if source.category !== "auto-detect", set `scraped_articles.category = source.category`. Else leave NULL for pipeline classification
- Display article's own `category` + `subcategory` badges (editable inline dropdowns)
- `editAndPublish()`: read category/subcategory from the article record, pass both as URL params

#### Phase 7: Admin — BlogEditor.tsx

- Import from `categories.ts` (remove local CATEGORIES)
- Add subcategory dropdown next to category dropdown
- When loading from RSS: read `category` + `subcategory` from article record
- Save `subcategory` to `blog_posts` on publish

#### Phase 8: Edge Functions

**`process-rewrite-job/index.ts`**: Import taxonomy normalization logic (inline, since edge functions can't import from `src/`). Add classification parsing after Desk 1. Save `category` + `subcategory` to `scraped_articles`.

**`ai-generate-article/index.ts`**: Add subcategory to the generation prompt. Accept `subcategory` param. Return it in the response.

### Complete File List

| File | Change |
|------|--------|
| **Migration** | Add `category`, `subcategory` to `scraped_articles`; `subcategory` to `blog_posts` |
| `src/lib/categories.ts` | **New** — master taxonomy, normalization, aliases |
| `src/i18n.ts` | Add `cat_news`, `subcat_*` translations (EN + RO) |
| `src/components/Header.tsx` | Import from taxonomy, add "News" |
| `src/components/Footer.tsx` | Import from taxonomy, add "News" |
| `src/pages/Category.tsx` | Support `:sub` param, subcategory tabs, use i18n for labels |
| `src/pages/Blog.tsx` | Use `t("cat_" + category)` for translated labels |
| `src/pages/BlogPost.tsx` | Show translated category + subcategory |
| `src/App.tsx` | Add `/category/:name/:sub` route |
| `src/pages/admin/RssScraper.tsx` | "Auto-Detect" option, article-level category/subcategory display + override |
| `src/pages/admin/BlogEditor.tsx` | Import taxonomy, add subcategory dropdown, read from article record |
| `supabase/functions/process-rewrite-job/index.ts` | Desk 1 classification, normalization, save to DB |
| `supabase/functions/ai-generate-article/index.ts` | Add "news" to categories, accept/return subcategory |

### Data Flow Verification

```text
SCRAPE → scraped_articles.category = source.category or NULL
  ↓
DESK 1 (Gemini) → classify if NULL, always detect subcategory
  ↓
scraped_articles.category = "politics", subcategory = "regional"
  ↓
ADMIN reviews → can override both via inline dropdowns
  ↓
PUBLISH → blog_posts.category = "politics", subcategory = "regional"
  ↓
FRONTEND:
  Header nav → "Politics" (EN) / "Politică" (RO)
  /category/politics → all politics articles
  /category/politics/regional → only regional politics
  Blog listing → shows "Politică" (RO) or "Politics" (EN)
  Article page → category + subcategory badges, both translated
```

