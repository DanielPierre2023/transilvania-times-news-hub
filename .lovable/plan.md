

## Updated Plan: Three-Desk Pipeline with Bidirectional Translation

### The Gap

The current `process-rewrite-job` doesn't track source language. It sends raw content to GPT-4o with "Rewrite in BOTH English and Romanian" — but if the source is Romanian (e.g., Digi24, HotNews), the LLM tends to preserve Romanian phrasing and produce weaker English. Vice versa for English sources producing weak Romanian.

### Fix: Language-Aware Three-Desk Pipeline

**Database**: Add `source_language text DEFAULT 'en'` to `rss_sources` table (alongside the `category` column already planned).

**Desk 1 (Gemini Flash Extraction)**: The extraction prompt will auto-detect and declare source language, plus extract facts in a language-neutral numbered list.

```text
"Detect the language of this article (output 'en' or 'ro' on line 1).
Then extract ONLY factual claims as a numbered list in English.
No opinions, no prose, no original phrasing."
```

**Desk 2+3 (GPT-4o Synthesis + Style)**: Language-aware instructions:

```text
"Source language: {detected_lang}.
Build an ORIGINAL article from these facts.
- English version: write as a native English journalist. If source was EN, 
  do NOT reuse any original phrasing — rebuild completely.
- Romanian version: write NATIVELY in Romanian, not translated from English. 
  If source was RO, do NOT reuse any original phrasing — rebuild completely.
Both versions must be independently structured (different paragraph order, 
different opening hooks, different narrative flow)."
```

This ensures:
- EN source → original EN article (no copy) + native RO article (not translated)
- RO source → native RO article (no copy) + original EN article (not translated)

**Desk 3 (Humanization)**: Unchanged — parallel `humanizeContent()` for EN and RO.

### RssScraper UI

Add a "Language" dropdown (EN/RO) per RSS source alongside the category dropdown. This value is stored in `rss_sources.source_language` and passed through to `scraped_articles` for the pipeline to use.

### Complete File Changes

| File | Change |
|------|--------|
| **Migration** | Add `category text DEFAULT 'technology'` and `source_language text DEFAULT 'en'` to `rss_sources` |
| `supabase/functions/scrape-rss/index.ts` | Increase snippet limit 3000→8000 |
| `supabase/functions/process-rewrite-job/index.ts` | Three-Desk: Gemini extraction (with language detection) → GPT-4o synthesis with language-aware prompts → parallel humanization |
| `src/pages/admin/RssScraper.tsx` | Add category + language dropdowns per source, "Scrape All" button, category badges |
| `src/pages/admin/BlogEditor.tsx` | Auto-populate category from URL params |

### Pipeline Flow

```text
RSS Source (lang: en/ro, category: politics)
  ↓
scrape-rss (8000 char snippets)
  ↓
scraped_articles (source_language stored)
  ↓
Desk 1: Gemini Flash — extract facts in English (language-neutral)
  ↓
Desk 2+3: GPT-4o — build EN article (original) + RO article (native, not translated)
  ↓
Desk 3: Parallel humanization (EN + RO simultaneously)
  ↓
Quality gate → Save to scraped_articles → Ready for blog publish
```

