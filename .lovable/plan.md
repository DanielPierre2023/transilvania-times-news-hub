
## CTO diagnosis: what is actually broken

I checked the code and the live data. Your criticism is justified. This is not one small bug. It is a broken editorial architecture in 4 places.

### 1. Daniel Dobos is still the default in the workflow
This happens in two separate places:

- `src/pages/admin/RssScraper.tsx`
  - rewrite uses `editorSelection[article.id] || 'daniel_dobos'`
  - the per-row select also defaults to `daniel_dobos`
- `src/pages/admin/BlogEditor.tsx`
  - when opening an article from RSS, `author_name` is set to `'Daniel Dobos'`

So even if the rewrite job used another persona, the publish form still assigns Daniel by default unless changed manually.

### 2. The six voices are being flattened into one generic voice
I found two causes:

- `supabase/functions/process-rewrite-job/index.ts`
  - starts with editor persona correctly
  - but then runs `humanizeContent(...)` afterward
- `supabase/functions/_shared/sanitize.ts`
  - `humanizeContent` is generic, not editor-specific

That second pass rewrites the article again without preserving persona. Result: different editors start differently, then end up sounding similar.

### 3. There is still a legacy rewrite pipeline with weaker prompt quality
`supabase/functions/ai-rewrite-article/index.ts` still exists and uses:
- simpler prompt
- direct source rewriting
- high temperature (`0.85`)
- no extraction-first discipline like the main pipeline

That creates inconsistency and weaker output if it is used anywhere now or later.

### 4. Source material is too thin, so the articles cannot have depth
`scrape-rss/index.ts` stores:
- RSS `content:encoded` / `description` / `summary`
- truncated to `8000` chars
- in many cases this is just a feed snippet, not the full article body

Live DB samples confirm some `original_content` values are just short summaries. If the source is shallow, the rewrite becomes shallow. That is one of the biggest reasons the articles feel empty and repetitive.

## What the data shows

### The rewrite jobs are not all Daniel
Recent `rewrite_jobs` include:
- `lucian_bratu`
- `andrei_popescu`
- `sofia_marinescu`
- `elena_vasilescu`
- `mihai_ionescu`
- `daniel_dobos`

So the problem is not only rotation. The bigger issue is:
- UI defaults still push Daniel
- published bylines often become Daniel in the editor
- final prose gets flattened by generic post-processing

### The output still has the same opening rhythm
Recent Romanian samples repeat the same formula:
- “Sâmbătă, 21 martie 2026...”
- “Astăzi, 21 martie 2026...”
- similar neutral explanatory cadence

That is evidence of prompt convergence and persona loss.

### Romanian tags are still incomplete in places
Several recent records still have empty `rewrite_tags_ro` / `tags_ro`, so metadata generation is also inconsistent.

---

## Enterprise fix plan

### A. Separate 3 concepts that are currently mixed together
Right now the app mixes:
1. rewrite persona
2. published byline
3. manual author

That must be split cleanly.

#### New model
- **AI editor/persona** = who rewrote the article
- **Byline** = what appears publicly
- **Manual author** = only for real journalists creating original pieces

#### Implementation
- Add persistent `assigned_editor` to `scraped_articles`
- Add `ai_editor` to `blog_posts`
- Keep `author_name` for public byline
- For RSS articles:
  - default byline should be `Redacția Transilvania Times` or the selected AI editor, per your preference
  - never default to Daniel Dobos
- For manual articles:
  - default author options only: Daniel Dobos, Cristina Erika, Corina Bugner

### B. Remove local-state editor selection and replace with persistent editorial assignment
Current editor selection in RSS is only local React state, so it is fragile and resets.

#### Fix
- Persist selected editor on each scraped article before rewrite
- Show current assigned editor in the table even after refresh
- Add optional bulk action:
  - “Auto-rotate editors”
  - “Assign editor manually”

### C. Replace naive defaults with a real rotation engine
Need an editorial dispatcher, not a hardcoded fallback.

#### Rotation rules
- Auto-scraped articles rotate only among the 6 agreed personas:
  - Daniel Dobos
  - Andrei Popescu
  - Elena Vasilescu
  - Lucian Bratu
  - Sofia Marinescu
  - Mihai Ionescu
- Manual authors:
  - Daniel Dobos
  - Cristina Erika
  - Corina Bugner
- Optional category weighting:
  - Mihai / Daniel stronger for technology
  - Lucian / Elena stronger for culture/features
  - Andrei stronger for politics/investigative
  - Sofia for analytical/science
- Rotation should avoid repeating the same editor in consecutive jobs

### D. Unify the rewrite pipeline into one authoritative enterprise pipeline
There should be one source of truth.

#### Fix
- Keep `process-rewrite-job` as the only rewrite pipeline
- Decommission or hard-disable `ai-rewrite-article`
- Ensure all UI buttons and backend flows enqueue only `process-rewrite-job`

### E. Preserve persona during humanization
This is critical.

#### Current problem
A generic humanizer rewrites the already-persona-shaped article and erases voice.

#### Fix
Replace generic `humanizeContent(text, language, apiKey)` with:
- `humanizeContent(text, language, apiKey, editorPersona)`
- or remove the second pass entirely and fold humanization into the main synthesis prompt

Best enterprise option:
- keep one synthesis pass with extraction-first + persona + anti-plagiarism constraints
- add a **persona-aware refinement pass**, not a generic one

That refinement must explicitly say:
- preserve this editor’s linguistic fingerprint
- do not normalize tone
- do not rewrite the opening into generic date hooks

### F. Stop rewriting from RSS snippets; ingest full article bodies
This is the other major root cause.

#### Fix
Upgrade the ingestion pipeline:
1. RSS feed gives URL + teaser
2. fetch the actual article URL
3. extract main body with readability-style extraction
4. store:
   - `original_excerpt`
   - `original_content_full`
   - `source_word_count`

#### Quality gates
- if source body is below a threshold, mark as `needs_source_review`
- do not run premium rewrite on teaser-only input
- display “snippet only” warning in admin

### G. Improve editorial depth rules
Right now “1200+ words” is not enough. It can still become padded fluff.

#### Fix prompt architecture
For scraped articles, require:
- first 3 paragraphs = hard news
- then evidence/context
- then counterpoint / implications
- then background
- explicit instruction: no generic scene-setting unless directly relevant
- no “calendar hook” unless tied to the event itself
- no filler metaphors for hard news

Also add category-specific depth modules:
- politics: actors, stakes, policy consequences
- business: numbers, market impact, institutions
- culture: historical context, critical framing
- technology: systems, versions, infra, tradeoffs

### H. Fix publish flow so byline and editor are coherent
`BlogEditor` currently imports RSS articles with `author_name: 'Daniel Dobos'`.

#### Fix
For RSS imports:
- prefill `ai_editor` from scraped article assignment
- prefill `author_name` as:
  - `Redacția Transilvania Times`, or
  - selected AI editor name if you want persona bylines
- show both fields separately:
  - AI Editor
  - Public Byline

For manual articles:
- AI editor optional
- author defaults to the real journalist creating/editing it

### I. Add admin visibility so the editorial team can actually trust the system
On RSS/Admin tables add columns:
- Assigned editor
- Last rewrite editor
- Source depth score / word count
- Prompt pipeline used
- Quality flags:
  - thin source
  - missing RO tags
  - repeated opening pattern
  - needs human review

### J. Backfill and cleanup
After architecture changes:
- backfill `assigned_editor` from latest `rewrite_jobs.editor`
- backfill `ai_editor` in `blog_posts`
- identify published posts where:
  - `author_name = Daniel Dobos`
  - but latest rewrite job used another editor
- review and correct those records

---

## Files that need to change

### Frontend admin
- `src/pages/admin/RssScraper.tsx`
  - remove Daniel fallback
  - persist editor assignment
  - add rotation controls and source-depth indicators

- `src/pages/admin/BlogEditor.tsx`
  - separate AI editor from byline author
  - stop defaulting RSS imports to Daniel
  - restrict manual-author defaults appropriately

- `src/pages/admin/BlogManager.tsx`
  - show byline vs AI editor distinctly

### Edge functions
- `supabase/functions/process-rewrite-job/index.ts`
  - preserve editor fingerprint end-to-end
  - remove generic flattening
  - strengthen depth rules
  - consume full article body, not snippet-only input

- `supabase/functions/_shared/sanitize.ts`
  - replace generic humanizer with persona-aware refinement
  - stop normalizing all editors into one neutral cadence

- `supabase/functions/ai-rewrite-article/index.ts`
  - retire or redirect to main pipeline

- `supabase/functions/scrape-rss/index.ts`
  - extend feed ingestion to fetch full article pages

### Database
- new migration for:
  - `scraped_articles.assigned_editor`
  - `scraped_articles.source_word_count`
  - `scraped_articles.original_excerpt`
  - `scraped_articles.original_content_full`
  - `blog_posts.ai_editor`

---

## Acceptance criteria

After implementation:

1. Scraped articles no longer default to Daniel Dobos.
2. Editor assignment survives refresh and is visible in admin.
3. Manual journalists remain only:
   - Daniel Dobos
   - Cristina Erika
   - Corina Bugner
4. Auto-scraped rewrites rotate across the 6 personas consistently.
5. Published byline is no longer accidentally Daniel unless explicitly chosen.
6. Two articles rewritten by different editors have clearly different openings, cadence, framing, and lexical choices.
7. Rewrite pipeline uses full extracted article body, not just RSS teaser text.
8. Thin-source articles are flagged instead of being turned into padded pseudo-depth.
9. Legacy weaker rewrite path is removed from production behavior.

## Priority order

### Phase 1 — stop the damage
- remove Daniel defaults
- persist assigned editor
- separate byline from AI editor
- disable legacy `ai-rewrite-article`

### Phase 2 — restore voice quality
- make humanization persona-aware or remove generic pass
- strengthen prompt structure by category
- add editor rotation logic

### Phase 3 — restore depth
- ingest full article bodies
- add thin-source detection
- backfill and clean already-misassigned records

## Bottom line

The core problem is not “just the prompt.”  
It is that the system currently:
- defaults to Daniel in the UI,
- mixes persona with byline,
- rewrites shallow RSS snippets,
- and then flattens editor voice with a generic post-pass.

That combination is exactly why the articles feel shallow, repetitive, and off-brief.
