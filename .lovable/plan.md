

## Plan: Elevate to NYT/WaPo-Grade Journalism — Tags, Titles, Prompts

### Root Causes Identified

1. **Tags not hyphenated**: The prompt says "lowercase hyphenated" but the JSON schema example shows `["6-9 English SEO tags"]` without enforcing the format. The AI outputs `"Cluj foundation"` instead of `"cluj-foundation"`. There is no post-processing to enforce hyphenation.

2. **Titles end with a period**: No explicit rule bans trailing punctuation on titles. The AI adds dots.

3. **Titles are flat and provincial**: The current rule is just "Active voice, present tense, sentence case, max 10 words, no clickbait." That is not enough. NYT/WaPo titles follow specific patterns — they use strong verbs, name actors, imply stakes, and create tension. The current prompts produce descriptive labels, not headlines.

4. **Article depth is generic**: The category depth modules exist but the core synthesis prompt lacks the structural rigor that separates elite journalism from content generation.

### Changes

#### 1. `supabase/functions/_shared/sanitize.ts` — Add tag post-processing

Add a new exported function `normalizeTags(tags: string[]): string[]` that enforces:
- lowercase
- spaces → hyphens
- strip trailing/leading punctuation
- deduplicate
- max 50 chars per tag

Add a new function `sanitizeTitle(title: string): string` that:
- removes trailing period, comma, semicolon
- removes trailing ellipsis
- trims whitespace
- ensures sentence case (first letter uppercase, rest preserved)

Apply `sanitizeTitle` inside `sanitizeContent` when called on titles (add optional `isTitle` parameter), or export separately for use in the pipeline.

#### 2. `supabase/functions/process-rewrite-job/index.ts` — Upgrade prompts to elite level

**Title rules** — replace the current 1-line instruction with NYT/WaPo headline craft:

```
TITLE RULES (NEW YORK TIMES / WASHINGTON POST STANDARD):
- EN: Active verb, present tense, sentence case, 6-10 words. NO period at the end. NO question marks.
- Name the actor and the action. Bad: "New developments in healthcare." Good: "Romania slashes hospital wait times by 40%"
- Use strong, specific verbs: launches, cuts, blocks, faces, reveals, expands, warns, defies. Avoid: announces, discusses, addresses, focuses, highlights.
- Imply stakes or conflict. Bad: "City council meets about budget." Good: "Cluj council cuts transit funding despite rider surge"
- RO: Native Romanian headline grammar. Subject-verb inversion where natural. NO period. NO literal translation from English.
- Bad RO: "Noi dezvoltări în domeniul sănătății." Good RO: "România reduce timpii de așteptare în spitale cu 40%"
```

**Tag format rules** — make explicit in JSON schema:

```
Tags format: Each tag is a lowercase hyphenated slug. Example: ["digital-health-romania", "hospital-reform-2026", "cluj-medical-center"]. NOT: ["Digital Health", "Hospital Reform"]. Every tag must be hyphenated, lowercase, 2-5 words.
```

**Depth upgrade** — add structural requirements to synthesis prompt:

```
ARTICLE STRUCTURE (NYT/WAPO STANDARD):
- Paragraph 1-2: The lede. Most newsworthy fact. Who did what, with what consequence. No throat-clearing.
- Paragraph 3-4: The "nut graf." Why this matters NOW. What changed. What is at stake.
- Paragraph 5-7: Evidence. Specific data, quotes, institutional reactions.
- Paragraph 8-10: Context. Historical precedent, comparable situations, expert analysis.
- Paragraph 11+: Background, methodology, caveats, opposing viewpoints.
- EVERY paragraph must contain at least one specific fact (name, number, date, or place).
- NO filler paragraphs. NO generic context that could apply to any article on the topic.
- If you cannot add a specific fact to a paragraph, cut the paragraph.
```

#### 3. `supabase/functions/ai-generate-article/index.ts` — Same prompt upgrades

Apply the same title, tag, and depth rules to the manual article generation pipeline. Also apply `normalizeTags` to the output.

#### 4. `supabase/functions/process-rewrite-job/index.ts` — Post-process tags and titles

After parsing the JSON response, apply:
- `normalizeTags(parsed.tags_en)` and `normalizeTags(parsed.tags_ro)`
- `sanitizeTitle(parsed.title_en)` and `sanitizeTitle(parsed.title_ro)` — strip trailing dots
- Same for `seo_title_en` and `seo_title_ro`

### Files

| File | Change |
|------|--------|
| `supabase/functions/_shared/sanitize.ts` | Add `normalizeTags()` and `sanitizeTitle()` exports |
| `supabase/functions/process-rewrite-job/index.ts` | Upgrade title/tag/depth prompts to NYT standard. Post-process tags and titles. |
| `supabase/functions/ai-generate-article/index.ts` | Same prompt upgrades. Post-process tags and titles. |

