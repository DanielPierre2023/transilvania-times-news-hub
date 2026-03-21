

## Combined Plan: Article Typography + SEO Tags + Pagination Labels

### What's Being Fixed

1. **Article body renders as wall of text** — `mdToHtml()` splits on `\n\n` but wraps poorly; `<li>` items never get `<ul>` containers
2. **No SEO meta tags on BlogPost** — zero OG/Twitter/JSON-LD/hreflang injection for DB articles; Romanian articles show no `og:locale`
3. **Pagination "Previous"/"Next" hardcoded in English** — not translated for Romanian users
4. **No justified text** — article body is left-aligned, not broadcast-grade
5. **AI prompt lacks paragraph formatting instruction** — LLM may output single-newline paragraphs that `mdToHtml()` can't parse
6. **No "View All" link on homepage**

### Files & Changes

| File | Change |
|------|--------|
| `src/lib/markdown.ts` | Rewrite: split on `\n\n`, wrap each block in `<p>`, group `<li>` in `<ul>`, process inline formatting per block |
| `src/pages/BlogPost.tsx` | Add `useEffect` for bilingual SEO injection (OG, Twitter, JSON-LD, hreflang, `og:locale`, `document.title`). Add `text-justify` + `hyphens:auto` to article body. Fix drop-cap lede CSS. |
| `src/index.css` | Add `.article-body` styles: `text-align: justify`, `hyphens: auto`, proper `p` margin spacing |
| `src/components/ui/pagination.tsx` | Make "Previous"/"Next" text configurable via children props |
| `src/pages/Blog.tsx` | Pass translated Previous/Next labels to pagination |
| `src/pages/Category.tsx` | Same translated pagination labels |
| `src/pages/Index.tsx` | Add "View All Articles →" link below latest stories |
| `src/i18n.ts` | Add `pagination_previous`, `pagination_next`, `view_all_articles` translations (EN + RO) |
| `supabase/functions/process-rewrite-job/index.ts` | Add to synthesis prompt: "Separate paragraphs with blank lines (`\n\n`). Each paragraph 2-4 sentences. No single newlines within paragraphs." |
| `supabase/functions/ai-generate-article/index.ts` | Same paragraph formatting instruction |

### `mdToHtml()` Rewrite Logic

```text
1. Split input on /\n\n+/
2. For each block:
   - If all lines start with "- ", wrap each in <li>, group in <ul>
   - If starts with "### ", wrap in <h3>
   - If starts with "## ", wrap in <h2>
   - Otherwise: process inline markdown (bold, italic, links, code), wrap in <p>
3. Join all blocks
```

### SEO Injection in BlogPost.tsx

```text
useEffect([post, i18n.language]):
  document.title = localizedTitle + " | Transilvania Times"
  Inject:
    og:title, og:description, og:image (toPublicMediaUrl), og:url, og:type, og:site_name
    og:locale = "ro_RO" | "en_US"
    twitter:card, twitter:title, twitter:description, twitter:image
    JSON-LD NewsArticle schema (headline, datePublished, author, publisher, image)
    hreflang: en, ro, x-default
  Cleanup on unmount: remove all injected elements
```

### Article Typography

- Article body div: `text-align: justify; hyphens: auto; -webkit-hyphens: auto;`
- Paragraph spacing: `margin-bottom: 1.25em`
- Body font: `1.125rem` (18px) for long-form readability
- Lede drop-cap: refined `first-letter` with proper `line-height` and `padding`

