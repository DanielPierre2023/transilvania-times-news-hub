

## CTO-Level Analysis: Enterprise Article Quality + Pagination

### Problems Identified

**1. No pagination anywhere** — Blog listing (`Blog.tsx`), Category page (`Category.tsx`), and the Index page load ALL articles at once. No server-side or client-side pagination. As content scales, this is a performance and UX failure.

**2. Article body renders as a raw text wall** — `BlogPost.tsx` line 117 uses `dangerouslySetInnerHTML` but the content stored is markdown, not HTML. The `mdToHtml()` converter in `BlogEditor.tsx` is only used for editor preview — it is never applied when rendering the published article. The content is dumped raw.

**3. Summary field is a redundant display element** — The summary is displayed as a block quote before the article. For a professional news site, this should be a proper **lead paragraph** (lede) integrated into the article flow, not a separate italic block that feels amateur.

**4. AI prompt quality is insufficient for broadcast-grade journalism** — The synthesis prompt in `process-rewrite-job` (line 130-151) gives vague persona instructions. It says "1200+ words of continuous prose" but gives no guidance on:
   - Professional lead paragraph structure (inverted pyramid)
   - Attribution standards
   - Active voice mandate
   - Sentence rhythm requirements
   - Factual density per paragraph
   - No guidance on title quality (the Romanian title "Adrian Zvîncă's Digital Push in Cluj" is a literal translation pattern, not native Romanian headline writing)

**5. Title generation has no Romanian headline conventions** — Romanian news headlines follow different grammatical structures than English. The prompt doesn't instruct the model to write Romanian titles natively (with proper case, verb placement, and journalistic convention).

**6. Content is stored as markdown but rendered as HTML** — The pipeline stores markdown in `content_en`/`content_ro`, but `BlogPost.tsx` renders it with `dangerouslySetInnerHTML` expecting HTML. The `mdToHtml()` function exists but is only used in editor preview, not in the published article renderer.

### Enterprise-Grade Plan

#### 1. Fix Content Rendering Pipeline

`BlogPost.tsx` must convert markdown to HTML before rendering. Extract the `mdToHtml()` utility from `BlogEditor.tsx` into a shared `src/lib/markdown.ts` and use it in both the editor preview and the public article page.

**Files**: New `src/lib/markdown.ts`, update `BlogPost.tsx`, update `BlogEditor.tsx` to import from shared.

#### 2. Add Pagination — Blog + Category Pages

Implement cursor-based pagination using Supabase `.range()`:
- 12 articles per page
- "Load More" button (not infinite scroll — editorial sites use explicit pagination)
- URL-driven page state (`?page=2`) for SEO crawlability
- Server-side count query for total pages

**Files**: `Blog.tsx`, `Category.tsx`

#### 3. Professional Article Layout

Replace the current flat article body with a broadcast-grade layout:
- **Lede**: First paragraph styled as a drop-cap lead (larger font, distinct styling) — derived from summary or first paragraph
- **Body**: Proper paragraph spacing, pull quotes capability, reading progress indicator
- **Related articles**: Show 3 articles from same category at bottom
- **Previous/Next navigation**: Links to adjacent articles by publish date

**Files**: `BlogPost.tsx`

#### 4. Upgrade AI Prompts to Broadcast-Grade

Update both `process-rewrite-job` and `ai-generate-article` with NBC/Reuters-tier prompt engineering:

**Title rules**:
- EN: Active voice, present tense for breaking news, sentence case, max 10 words, no clickbait
- RO: Native Romanian headline grammar — subject-verb inversion where appropriate, no literal translation from English, Romanian journalistic conventions (e.g., "Zvîncă anunță digitalizarea ANOFM în Cluj" not "Adrian Zvîncă's Digital Push in Cluj")

**Lead paragraph rules**:
- Must answer Who/What/Where/When in the first 2 sentences
- Maximum 35 words for the opening sentence
- Active voice mandatory

**Body rules**:
- Inverted pyramid structure: most newsworthy facts first
- One idea per paragraph, 2-4 sentences each
- Direct quotes attributed with "said" (not "stated", "expressed", "noted")
- Vary paragraph length: 1-sentence paragraphs for impact, 4-sentence for context
- Specific numbers, dates, proper nouns — no vague language

**Summary rules**:
- 2-3 sentences maximum
- Written as a news wire abstract (who did what, where, when, why it matters)
- Not a "hook" — a factual abstract

**Model consideration**: GPT-4o is adequate. The issue is prompt quality, not model capability. The temperature of 0.85 is too high for news writing — lower to 0.6 for factual accuracy with sufficient variation.

**Files**: `process-rewrite-job/index.ts`, `ai-generate-article/index.ts`

#### 5. Sanitize Output for Professional Standards

Update `sanitize.ts` to also catch:
- Excessive exclamation marks
- Questions in news copy (unless direct quotes)
- Passive voice patterns
- Redundant attributions

**File**: `supabase/functions/_shared/sanitize.ts`

### File List

| File | Change |
|------|--------|
| `src/lib/markdown.ts` | **New** — shared `mdToHtml()` utility |
| `src/pages/BlogPost.tsx` | Apply `mdToHtml()`, add lede styling, related articles, prev/next navigation |
| `src/pages/Blog.tsx` | Add pagination (12 per page, Load More, URL-driven) |
| `src/pages/Category.tsx` | Add pagination (same pattern) |
| `src/pages/admin/BlogEditor.tsx` | Import `mdToHtml` from shared, remove local copy |
| `supabase/functions/process-rewrite-job/index.ts` | Broadcast-grade prompt rewrite, lower temperature to 0.6, title/lede/body rules |
| `supabase/functions/ai-generate-article/index.ts` | Same prompt upgrade, temperature adjustment |
| `supabase/functions/_shared/sanitize.ts` | Add passive voice and exclamation mark sanitization |

### Pagination Data Flow

```text
Blog.tsx / Category.tsx
  → Supabase query with .range(page*12, (page+1)*12 - 1)
  → Count query: .select('id', { count: 'exact', head: true })
  → Display: "Page 1 of 5" + numbered page buttons
  → URL: /blog?page=2, /category/politics?page=3
  → SEO: <link rel="next"> and <link rel="prev"> meta tags
```

### Article Rendering Flow

```text
DB: content_en (markdown) → mdToHtml() → dangerouslySetInnerHTML
First paragraph → extract as lede → drop-cap + larger font
Rest → standard prose with proper spacing
Bottom → related articles query (.eq('category', post.category).neq('id', post.id).limit(3))
```

