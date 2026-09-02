# tt-anti-ai-pack

Kills the "written by a machine" tells across **all three** text flows you named
— the rich *Birou editorial* translation, the auto-scraped RSS pipeline, and the
**AI rescrie** button — and adds a pre-publish **AI-tell score** in the editor so
you can see the tells before you hit *Publică*.

Per your approved scope: **shared module + ALL-CAPS fix + arm the translator +
detector.**

---

## Why it read like AI (root cause)

1. **No single source of truth.** The anti-AI logic was copy-pasted into some
   functions, weaker in others, and **absent** in one. Each flow behaved
   differently, so "we already ban em dashes" was true in one place and false in
   another.
2. **ALL-CAPS titles had no deterministic fix anywhere.** `sanitizeTitle()` only
   stripped markdown and trailing punctuation — it never touched case. If the
   model shouted a title, it shipped shouting. The English title prompt had **no
   sentence-case rule** at all.
3. **The rich-Birou translator (`tt-translate-html`) had ZERO anti-AI defense.**
   No dash handling, no case rule, no lexicon — it translated verbatim, em dashes
   and all. This is almost certainly the "**english translation for scrapped
   articles**" you were seeing: the scraper's own English body *is* already
   de-dashed, but a rich article translated through this function was not.

---

## The fix: one module, inlined everywhere

`supabase/functions/_shared/tt-anti-ai.ts` is now the **single source of truth**:

- **`ttDeShoutTitle`** — ALL-CAPS / shouted-word titles → clean sentence case.
  Keeps real acronyms (**PSD, PNL, UE, SUA, NATO, TVA, PNRR** …) and restores
  proper nouns (Romania, the 41 counties + major cities, world capitals) from a
  built-in gazetteer.
- **`ttStripDashes`** — em/en dashes **and their HTML entities** (`&mdash;`) →
  commas / hyphens. Numeric ranges (`2019–2021`) become `2019-2021`, never a comma.
- **`ttScrubLexicon`** — the AI lexicon → plain words: *delve, boasts, nestled,
  tapestry, "a testament to", "stands as a", underscores, showcases, "it's worth
  noting", "plays a crucial role", moreover/furthermore* … and the Romanian set
  (*„joacă un rol crucial", „merită menționat că", „o gamă largă de"* …).
- **`ttHumanizeHtml`** — the same, but **only on text nodes**, so the translator's
  HTML structure stays 1:1 with the Romanian source.
- **`ttScoreAiTells`** — the deterministic detector behind the new admin button.

Because your functions are pasted into the Supabase dashboard as a single file
(where `../_shared/…` imports don't resolve), the module is **inlined verbatim**
into each function between clear markers. Edit the module, re-run
`python3 build/inject.py`, and every function regenerates from that one source.

---

## What's in the box

| File (repo-relative) | New/Mod | What | Apply |
|---|---|---|---|
| `supabase/functions/_shared/tt-anti-ai.ts` | **New** | Canonical module (source of truth). **Reference only — NOT deployed, NOT imported** by anything; its code is already inlined into each function below. Lives in the repo as the one place to edit the logic. | *(commit, optional)* |
| `supabase/functions/tt-translate-html/index.ts` | Mod | **Armed.** Anti-AI rules in the translation prompt **and** a deterministic text-node safety net (`ttHumanizeHtml`) on the output — the big one, it had no defense before. **`callClaude` is now inlined too**, so it is fully self-contained (no more `../_shared/claude.ts` import). | **Deploy** |
| `supabase/functions/tt-process-scraped-article/index.ts` | Mod | Titles now **de-shouted**; content gets the shared lexicon scrub; English title prompt gets a sentence-case rule. ⚠️ **Built on top of your cover-image-pack version — see note below.** | **Deploy** |
| `supabase/functions/tt-rewrite-blog-post/index.ts` | Mod | Same three hooks (de-shout titles, lexicon scrub, sentence-case rule). Existing admin gate preserved. | **Deploy** |
| `supabase/functions/tt-ai-tell-score/index.ts` | **New** | The detector edge function. Deterministic (no LLM → instant, free). Admin-gated, same posture as `tt-adsense-quality-check`. | **Deploy** |
| `app/admin/components/ArticleEditor.tsx` | Mod | New **"Verifică AI"** button + score panel next to *Verifică AdSense*. ⚠️ **Supersedes the fan-out and cover packs' ArticleEditor — see note.** | **Commit** |
| `supabase/functions/_shared/tt-anti-ai.test.ts` | **New** | 12-case behavioural harness (`deno run …test.ts`). Proves the logic; not deployed. | *(optional)* |
| `build/inject.py` | **New** | Regenerates the function files from the module. For maintenance. | *(optional)* |

### Where each file goes (deployment)

**The `_shared/` folder is NOT deployed anywhere.** `_shared/tt-anti-ai.ts` is a
plain library, not an edge function — it has no `serve()` handler, and Supabase
never deploys a folder whose name starts with `_`. You do **not** paste it into
the dashboard. Its code is already copy-pasted inside each of the four functions,
so the deployed functions do not depend on it at all. Keep it (and the `.test.ts`
and `build/inject.py`) in your **GitHub repo** only, as the single place to edit
the logic. Committing it is optional — nothing breaks if you skip it.

**The four functions are now each ONE self-contained file** (only import is
`serve` from deno.land, which the dashboard resolves). So:

1. **Supabase → Edge Functions → paste each `index.ts`** into its function of the
   same name, Deploy. Order doesn't matter. This is exactly your usual single-file
   paste — no `../_shared` anywhere in any of the four now (I inlined `callClaude`
   into `tt-translate-html` so it stopped needing `_shared/claude.ts`).
   - `tt-process-scraped-article`, `tt-rewrite-blog-post`, `tt-translate-html` ->
     paste over the existing functions.
   - `tt-ai-tell-score` is **new** -> create the function, paste, Deploy. It is
     admin-gated like `tt-adsense-quality-check`; the editor calls it with your
     signed-in session, so no special deploy flags.
2. **Commit `app/admin/components/ArticleEditor.tsx`.** Netlify builds it.

- **No SQL.** The detector reads existing columns (`title_en/ro`, `content_en/ro`).
- **No new secrets.** Uses `CLAUDE_API_KEY` + the Supabase URL/keys already set.

---

## ⚠️ Two supersession notes (so nothing gets lost)

- **The scraper here contains BOTH the cover-image work and this work.** I built
  it on the exact `tt-process-scraped-article` you exported from the cover-image
  pack, so deploying **this** file gives you the grounded cover picks *and* the
  anti-AI title/lexicon fixes. Deploy this one; it replaces the scraper in the
  cover-image pack.
- **`ArticleEditor.tsx` here is the cumulative version:** fan-out (IG/LinkedIn
  auto-post) **+** the `<CoverImagePicker/>` **+** the new *Verifică AI* button. It
  supersedes the ArticleEditor in both the fan-out and the cover-image packs — use
  this one. *(If you've hand-edited your editor since the cover pack, tell me and
  I'll give you just the ~30 added lines to merge instead.)*

---

## How it behaves now

**Rich Birou (translated).** The translator is told to write plain, human prose —
no dashes, sentence-case headings, no AI lexicon — and then, whatever the model
does, the output is run through the deterministic net that strips dashes, calms
ALL-CAPS headings and swaps AI words, **touching only the text between tags** so
your bold/italic/tables/links stay exactly in place.

**Auto-scraped (RSS).** Every title already funnels through `sanitizeTitle()`, so
de-shouting there fixes **all** scraped titles at once. The body picks up the
lexicon scrub on top of your existing 110+/130+ rules. The English title prompt
now carries an explicit sentence-case rule.

**AI rescrie.** Same three hooks, same chokepoints — so a rewrite can't ship a
SHOUTING title or an em-dashed paragraph either.

**The detector (new "Verifică AI" button).** One click scores the article's
Romanian **and** English, and lists the exact tells with a sample of each:

> **RIDICAT · 86/100**
> ● ALL-CAPS title ×4 — "ROMANIA, BOASTS, NEW, ERA"
> ● AI lexicon (delve, boasts, tapestry…) ×3 — "…boasts a rich tapestry of cult…"
> ● Em/en dash ×1 · ● "It's worth noting" ×1 · ● "not only … but also" ×1 …

0 = clean, ≤15 low, 16–40 medium, 41+ high. It's a *review aid*, not a gate — it
never blocks publishing.

---

## Deliberate calls (so nothing surprises you)

- **De-shout is a safety net, not the primary fix.** The prompts were fixed so
  titles come out right at the source; the deterministic pass only rescues the
  occasional slip. Its one limit: a **surname not in the gazetteer**, in a title
  that was fully SHOUTED, gets lower-cased (e.g. an obscure name). That's rare
  (the prompt prevents most shouting) and still far better than a SHOUTING
  headline. Common proper nouns — Romania, every county, the parties, world
  capitals — are restored correctly.
- **English Title Case is flagged, not auto-rewritten.** Blindly lower-casing
  "Klaus Iohannis Meets Macron" would wreck the surnames, so the detector *flags*
  Title-Case English headlines (low severity, since your house style is sentence
  case) and the prompt steers new ones — but nothing auto-rewrites them.
- **A few Romanian constructions are flagged, not auto-rewritten.** Regex can't
  safely re-case Romanian morphology — rewriting *"reprezintă o dovadă **a
  progresului**"* would produce broken grammar — so those (and adjective-agreement
  cases like *robustă*) are **flagged by the detector** for the editor, not
  silently mangled. Only the safe, meaning-preserving swaps run automatically.
- **The detector is deterministic on purpose.** No model call means it's instant,
  free, and gives the *same* answer every time — you can trust the score.

---

## Verified here

- **`deno check`** — clean on all four edge functions as **fully standalone**
  dashboard files (real dependency download; none of the four import `../_shared`
  any more — `callClaude` was inlined into `tt-translate-html`).
- **`tsc --noEmit`** — **0 errors project-wide** (TS 5.8.3, full `npm install`),
  including the rewired editor.
- **`eslint`** on `ArticleEditor.tsx` — **0 errors, 0 warnings**.
- **12/12 behavioural tests** on the module (`tt-anti-ai.test.ts`) — de-shout with
  acronyms/proper-nouns, dash + entity handling, EN & RO lexicon (grammar checked),
  HTML structure preservation, and clean-vs-dirty detector scores (0 vs 86).
- Every function was regenerated by `build/inject.py` with a **match-count assert
  on each hook**, so a drifted source would fail the build loudly rather than
  silently no-op.

## Needs your live environment to see end-to-end (I can't from here)

Deploy the four functions, open an article, hit **Verifică AI**, and you'll see
the score + named tells. Re-run the scraper / a rescrie / a rich-article
translation and the em dashes and ALL-CAPS titles should be gone. If any specific
tell still slips through on a real article, send me the sentence and I'll add it
to the module — it's now one file to update.
