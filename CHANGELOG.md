# Transilvania Times — edge-function corrections (voice · asymmetry · length · anti-plagiarism)

> **Addendum (9th pass — Phase 2: async columnist engine). APPROVED build. Defaults: Opus 5 draft · 3 passes · 5-second poll.**
> The reliability lever. Column-class generation moves OFF the ~200s synchronous edge kill onto
> a queued worker that runs ONE phase per invocation, so an **Opus draft + up to 3 craft-enforce
> passes + a faithful translate** each run as their own sub-200s call. Opt-in and additive: your
> synchronous `generate()` route, the scraper cron, and every other function run **exactly as
> before**. Off the toggle = today's pipeline, unchanged.
>
> **Single source of truth for the voices (the key design choice).** Rather than copy the
> registers into a second function (which would drift), the engine is a **thin pump** plus an
> **additive branch inside `tt-generate-article`**:
> - **`tt-generate-article` — new `mode:'column_phase'` branch** (runs BEFORE the brief-length
>   validation, since a phase request carries no prompt). It executes ONE phase against a
>   `column_jobs` row using this function's OWN `stageResearch` / `stageContent` / `enforceRhythm` /
>   `stageMetadata` / `measureCraft` — no duplicated registers. Phases: **draft** (Opus, draft_lang
>   only — a new `columnMode` flag flips `stageContent`'s draft model to Opus) → **revise** (one
>   craft+humanness enforcement pass per tick, looping until clean or 3 passes) → **translate**
>   (faithful, via the existing preserve-mode translator) → metadata both languages → assemble the
>   result in the **exact shape the admin already consumes** → `done`. The default (no `mode`)
>   entry — your Editor-AI `generate()` call — is **byte-for-byte unchanged**.
> - **`tt-column-worker` (NEW, ~90 lines)** — pumped by pg_cron every minute. Claims ONE job with
>   an **atomic conditional PATCH** (two ticks can't both win), invokes the generator's phase, and
>   returns. Deploy with **Verify JWT OFF** (it authenticates via `x-worker-secret`, like your
>   flights-sync function).
> - **`column_jobs` table** — the isolated queue (`sql/column_jobs.sql`). RLS mirrors your
>   `public.has_role(auth.uid(),'admin')` pattern; the worker/generator use the service role
>   (bypasses RLS).
> - **Cron** — `supabase/migrations/20260904120000_column_worker_cron.sql`, mirroring flights-sync
>   exactly (pg_cron + pg_net, **Vault**-stored URL + secret, idempotent unschedule).
> - **Admin toggle** — `app/admin/editor/page.tsx`: an opt-in "Mod columnă (înaltă calitate,
>   asincron)" switch shown only for the seven voice-class types. ON → inserts a `column_jobs` row
>   (same body you already build) and polls every 5s; on `done` it fills the **same field setters**
>   your sync path uses, then runs the same cover-image step. OFF → your sync `generate()` untouched.
>   A second, **untyped** browser client (`queue`) is used only for `column_jobs` (a new table not
>   yet in `Database` types) so the typed client and `next build` are unaffected.
>
> **Reliability (enterprise-grade):** claim lock via `claimed_at` + a 3-min stale-reclaim; each
> phase ≤200s by construction; retry with `attempts` and a dead-letter `error` status that never
> blocks the queue; **nothing auto-publishes** — the editor reviews and publishes as today; the
> input is persisted at enqueue so nothing is lost.
>
> **Cost & latency:** ~$0.35–0.45 per bilingual column (Opus draft + Sonnet enforce/translate),
> opt-in, so it never touches your daily-600 economics. ~2–4 min behind the async status.
>
> **Verified:** `tt-generate-article` and `tt-column-worker` pass `deno check` (Deno 2.9.6);
> `app/admin/editor/page.tsx` passes a full-project `tsc --noEmit` clean. Nothing written to your
> repo or DB.
>
> **Deploy order (dashboard + GitHub web UI; no CLI, no deploy MCP):**
> 1. Run `sql/column_jobs.sql` in the SQL editor.
> 2. Create the `tt-column-worker` function (paste `index.ts`), set **Verify JWT OFF**, set the
>    `COLUMN_WORKER_SECRET` function secret, and set `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
>    (usually auto-present).
> 3. Redeploy `tt-generate-article` (now carries the `column_phase` branch).
> 4. Run the Vault prereqs listed atop the cron migration, then run the cron migration.
> 5. Commit `app/admin/editor/page.tsx` (Netlify builds the toggle).
>
> **Bonus fix (approved) — sync editor selection.** The synchronous serve handler read
> `body.editor`, but the admin sends `body.editor_key`, so the Editor-AI dropdown was silently
> ignored and every sync article defaulted to `andrei_popescu`. Now reads `editor_key` first, with
> `body.editor` kept as a legacy fallback — one line in `tt-generate-article`, backward-compatible.
> (The async column path already used `editor_key` correctly.)

> **Addendum (8th pass — Phase 1 of the columnist-grade upgrade). APPROVED build.**
> The goal you set: generated analysis / editorial / opinion / pamflet / blog / reportage
> prose reaches top-masthead columnist **craft**, not merely "clean, no AI tells", on every
> tone, RO + EN — while the working pipeline stays unbroken. This ships the reliability
> backbone. `deno check` clean on all three; nothing written to your repo or DB.
>
> **The verified root cause.** `measureHumanness` starts at 100 and only ever **subtracts**
> for AI tells. There is no term anywhere that **adds** for craft — so the whole system is
> tuned to eliminate *bad*, never to reward *good*. "No tells" is as far as it can reach.
> Clean is the absence of bad; columnist is the presence of craft. They are different targets.
>
> **1. `measureCraft` — the missing half (new, in `tt-generate-article` + `tt-rewrite-blog-post`).**
> A companion scorer that rewards the PRESENCE of columnist craft on **safe, countable**
> signals: a concrete open, concrete-detail density (numbers + named entities + real quotes),
> a structural turn ("dar/însă" · "but/yet"), a woven quote, a landing kicker. Every signal
> rewards **USING facts already in the piece — never inventing them**; `FABRICATION_HARD_STOP`,
> `ZERO_COPY` and the 110–130 sanitizer rules are unchanged and remain authoritative. Only the
> seven voice-class types are scored; everything else (news) returns a perfect 100, so the gate
> **never fires for wire copy**. A companion `buildCraftFixInstructions` turns each craft deficit
> into a targeted, fabrication-guarded repair line.
>
> **2. Wired into the existing enforcement — fire on low craft OR low humanness.**
> `enforceRhythm` (generator) and `humannessEnforceLoop` (rewriter) now also compute craft,
> enter on a craft deficit as well as an AI-tell deficit, append the craft repairs to the
> revision prompt, and accept a craft-only gain **only when humanness does not regress** (the
> anti-AI gate can never be traded away). **200s-safe by construction:** craft adds only *more
> reasons to fire the same single budget-gated pass* — never an additional pass — so the
> worst-case wall-clock is unchanged. Preserve/editor mode still skips all of it (the author's
> craft is untouched).
>
> **3. Per-tone craft + guardrails in every voice-class register (all three files, RO + EN).**
> Each of pamflet, editorial, opinie, analiza, blog, reportaj, cultura gains a compact
> **CRAFT DE VÂRF / TOP CRAFT** line naming its signature peak moves, plus the safety guardrail
> its tone needs: **pamflet** strikes ideas and public conduct, never a private person or family,
> and every barb rides on a real fact; **blog** keeps any personal detail real or plainly
> hypothetical; **reportaj** carries the **strictest fabrication guard of all** — every scene and
> sensory detail must come from the real material, because invented colour is both an AI tell and
> an ethics breach. (Registers are otherwise unchanged — voices were not rewritten.)
>
> **4. Angle commitment (`tt-generate-article`, column-class only).** A column is craft *plus a
> claim*. For editorial/opinie the compose prompt now forces one defended thesis; for analiza,
> one central tension carried through fact and mechanism — the fix for "clean but says nothing".
> Prompt-only; not applied to news or scraped wire (forcing a thesis on a 4-fact brief is wrong).
>
> **Two deliberate, transparent scoping calls (enterprise-grade, risk-weighted):**
> - **The scraper's `humannessEnforceLoop` hot path was left UNTOUCHED.** The M4 fix balanced its
>   20s gates precisely against the ~200s batch wall; adding a second scorer there risks the exact
>   overrun M4 removed, for little gain (the scraper's corpus is mostly news, which craft-scoring
>   intentionally ignores). So the scraper gets the **proactive craft registers** (zero runtime
>   risk); the **reactive craft enforcement** lives where the long-form voice-class work happens —
>   the generator and rewriter.
> - **Full annotated few-shot EXEMPLARS are deferred to a Drive-calibrated pass.** Exemplars are
>   the one lever that is materially better built from *your own best pieces* than from invented
>   ones. Connect Drive, point me at 2–3 of your strongest per register, and I'll build the
>   per-tone exemplars from those and drop them into these same register blocks.
>
> **Cost & latency:** Phase 1 is ~cost-neutral (a few % more input tokens from the per-tone
> lines; `measureCraft` is local, no API call) and the latency ceiling is unchanged. **Files
> changed:** `tt-generate-article` (+112 lines), `tt-rewrite-blog-post` (+99), `tt-process-scraped-article`
> (+14, registers only). All pass `deno check` (Deno 2.9.6). Deploy order unchanged from below.

> **Addendum (7th pass) — preserve/editor mode + stricter symmetry enforcement (all tones).**
> Two changes aimed at the persistent "flat, symmetric, obviously-AI" output on every type.
>
> **1. PRESERVE / EDITOR MODE in `tt-generate-article` (v19).** New request flag
> `mode:"preserve"` (plus optional `draft_lang`, default `ro`). When set, the pipeline does
> NOT rebuild from atomized facts to a word target — the design that flattens rich drafts.
> Instead it **copy-edits** the author's draft in its language and **translates it faithfully**
> into the other, keeping every fact, thread, section and roughly the same length; the
> compress/atomize/extend/polish/guard/rhythm stages are all skipped so the author's voice and
> structure survive. This is the workflow for a human-written analysis or editorial: the
> machine cleans and translates, it never summarizes. (Send `{ mode:"preserve", draft_lang:"ro",
> prompt:"<your full RO draft>", editor:"andrei_popescu", article_type:"editorial" }`.)
>
> **2. Stricter symmetry enforcement on EVERY tone, both languages (generator, scraper, rewriter).**
> The honest mechanism: prompt rules only nudge an LLM toward varied rhythm; the thing that
> forces it is measure-and-enforce. The detectors were too lenient, so "flat but not terrible"
> passed. Tightened in all three `measureHumanness` copies: `MODERATE_BURSTINESS` 7→9 (−12),
> `UNIFORM_PARAGRAPHS` paragraph-stdDev 10→14 (−12); the generator's enforcement now fires below
> 85 (was 80), the scraper/rewriter loops already fire below 90. Net: analiza, blog, reportaj,
> pamflet, editorial, opinie that come out even and flat now score lower, trip the loop, and get
> one targeted de-symmetrizing revision — on every type, RO and EN.
>
> **Straight talk on the ceiling:** tightened enforcement reliably moves generated content from
> "obviously AI" to "clean and professional, mostly passing detection." It does not turn the
> generator into a top human columnist — an LLM's prior for tidy, complete, balanced paragraphs
> is strong, and one revision pass bounded by the 200s limit can only push so far. The top tier
> is what PRESERVE mode is for: you write the sharp piece, the machine cleans and translates it.
> Budget-safe: preserve skips the heavy stages; the enforcement stays behind the same 200s gates.


> **Addendum (6th pass) — pipeline-wide parity: every voice, every writing function, both languages.**
> Audited all 10 editor voices (daniel_dobos, andrei_popescu, elena_vasilescu, lucian_bratu,
> mihai_ionescu, sofia_marinescu, victor_simon, mihai_isac, marcus_webb, anamaria_florea).
> **Verdict: the voices are already high-level and distinct** (each cites a real tradition —
> ProPublica, FT, STAT News, Recorder, DoR, McPhee — with concrete mechanics, banned lists,
> and full RO+EN parity). They were NOT rewritten. The real systemic risk was **instruction
> literalization** — the model printing a cue as text (the "Cine câștigă?" bug from
> andrei_popescu's *ask "who benefits"* line). Applied to ALL THREE writing functions
> (`tt-generate-article`, `tt-process-scraped-article`, `tt-rewrite-blog-post`):
> - **Anti-instruction-echo rule** added to `MASTER_HUMANIZING` (injected into every compose/
>   polish prompt): the editor signature and type register are METHOD, never phrases to print;
>   apply a cue's intent, never quote it. This protects every voice at once.
> - The andrei_popescu **"who benefits" / "cine câștigă"** line reworded to a reporting method,
>   not a quotable question.
> - The **`analiza` rewrite + `cultura` closer fix + the four missing rhythm registers**
>   (opinie/pamflet/reportaj/tehnologie) — previously only in the generator/scraper — brought
>   into `tt-rewrite-blog-post` too, so all three share identical registers.
> - The **new AI-tell detectors** (ANALYTIC_SCAFFOLD / ENUM_SCAFFOLD / QUESTION_OPENER, plus
>   SUMMARY_CLOSER where missing) added to the scraper's and rewriter's `measureHumanness`, and
>   matching **repair instructions** added to their `buildHumannessRevisionPrompt`, so their
>   existing enforcement loops now catch and fix the scaffold family in both languages.
>
> Net: all three writing functions now share the same high-level voices, the same anti-AI
> register discipline, the same scorer, and an enforcement backstop — in RO and EN. All pass
> `deno check`. (Plagiarism: the ZERO_COPY rules were already present in every compose prompt;
> AdSense depth: still governed by sourcing + the publish-depth gate, unchanged here.)


> **Addendum (5th pass) — honest scorer + bounded rhythm enforcement (`tt-generate-article`).**
> Two additions that turn `measureHumanness` from a lying telemetry number into a real gate.
> - **New AI-tell detectors** (RO + EN): `ANALYTIC_SCAFFOLD` (the "Întrebarea analitică
>   de la care pornește această analiză / what this reading misses" family, −20),
>   `ENUM_SCAFFOLD` ("în primul rând … în al doilea rând", −12), `QUESTION_OPENER`
>   (first paragraph ends on "?", −10), and a RO `SUMMARY_CLOSER` (−12). Verified on the
>   real Turda text: these alone drop it from the old **100/100 to 56/100** (13 scaffold
>   hits + enum + closer). The scorer no longer passes obvious AI prose.
> - **`enforceRhythm` (STAGE 4b)** — a single, optional, budget-gated Sonnet pass. When a
>   finished draft scores < 80, it makes ONE targeted revision fixing exactly the flagged
>   patterns (scaffold removal, de-enumeration, summary-closer deletion, aggressive sentence/
>   paragraph burstiness), via the XML `<content>` contract (never JSON — the old JSON loop
>   failed and was removed). **200s-safe by design:** skipped unless ≥45s of budget remains,
>   the call aborts at 40s, it is never a required stage, and the two languages already run
>   in parallel — worst realistic wall-clock stays ~145s, well under the ~200s kill.
> Belt-and-suspenders with the 4th-pass register rewrite: the registers now *forbid* the
> scaffold phrases at generation time; the scorer+enforcement *catch and fix* anything that
> slips through. Passes `deno check`. (The scraper has its own humanness loop; teaching it the
> same new detectors is the last sync step, offered next.)


> **Addendum (4th pass) — tone-register overhaul (`tt-generate-article` AND `tt-process-scraped-article`).**
> Root cause of the "stupid-AI" output (e.g. the Turda piece opening *"Întrebarea
> analitică de la care pornește această analiză…"*): the **`analiza` register was
> literally instructing the model to do it** — *"Open by formulating the exact
> analytical question"* and *"Mark the moves: 'Întrebarea mai dificilă rămâne',
> 'Ceea ce această lectură ratează'."* The model obeyed verbatim. Fixes, applied to
> BOTH functions (the registers are shared, byte-identical):
> - **`analiza` rewritten** — concrete-fact lead, mandatory sentence/paragraph
>   rhythm, hard consequence-close, and an explicit ban on every AI tell it used to
>   emit (self-reference to "this analysis/reading", question openers, "the harder
>   question remains", firstly/secondly, rhetorical-question closes).
> - **`cultura`** — its *"close on a new question"* (the same rhetorical-question
>   tell) changed to close on a concrete critical judgment.
> - **`opinie`, `pamflet`, `reportaj`, `tehnologie`** — each gained an explicit
>   mandatory-rhythm line (alternate short <8-word and long >25-word sentences;
>   visibly unequal paragraphs), fixing the flat/symmetric output.
> - `news`, `editorial`, `blog` were already well-built (rhythm + hard close) and
>   left unchanged.
>
> Prompt-only changes — zero runtime/latency risk; both files pass `deno check`.
> **Honest limit:** this makes the register *demand* rhythm and *forbid* the scaffold
> phrases (the phrase bans are deterministic). Guaranteeing paragraph asymmetry on
> every run still needs a measured enforcement pass; `tt-generate-article` has none
> (its humanness score is telemetry only and did not catch these RO tells — it rated
> the Turda piece 100/100). Teaching the scorer these RO patterns + a bounded
> enforcement pass is the offered next step.


> **Hotfix (3c) — Opus was too SLOW; draft moved to Sonnet 5.** Production logs
> showed the real cause of the "non-2xx" error: not a bad model ID or access, but
> **latency**. This function writes RO and EN as two full native pipelines; two
> ~1,400-word **Opus** drafts plus the Sonnet polish exceeded the ~200s edge
> wall-clock limit and the request was killed (one run finished on GPT-4.1 in 70s;
> the Opus run logged START then `shutdown` exactly 200s later with no content).
> Fix: **draft on Sonnet 5, not Opus.** Sonnet 5 is much faster (the scraper runs
> Sonnet within a similar budget daily), fits 200s the way the old GPT-4.1 draft
> did, and is still a large voice upgrade over GPT-4.1. `OPUS_MODEL` is retained
> for a future async / single-language-then-translate path where Opus's latency is
> affordable, but is not used on this synchronous route. A GPT-4.1 fallback on the
> draft remains for any clean Claude error (it cannot rescue a slow call — hence
> the model choice matters).
>
> **Addendum (3rd pass) — model migration + voice-first writer (`tt-generate-article`), Sep 3.**
>
> **URGENT model migration (all three Claude-writing functions).** `claude-sonnet-4-5-20250929`
> retires as early as **2026-09-29**. Migrated `SONNET_MODEL` → **`claude-sonnet-5`**
> in `tt-process-scraped-article`, `tt-rewrite-blog-post`, and `tt-generate-article`.
> Sonnet 5 is both newer and **cheaper** ($2/$10 per MTok vs 4.5's $3/$15), safe to
> ≥2027-06-30. (`tt-translate-html` was already on `claude-sonnet-4-6` — safe to
> ≥2027-02, left as-is. Haiku 4.5 retires ≥2026-10-15 — near-term, flagged in-code.)
>
> **`tt-generate-article` — voice-first drafting (the fix for flat pamflet/editorial/opinion).**
> Root cause found by reading the model-per-stage wiring: the **draft (stage 2) was
> written by GPT-4.1**, which sets uniform paragraphs and a generic-competent voice;
> Sonnet then only *polished over that skeleton* (told to "preserve facts, keep length
> ±15%"), so the uniformity and painted-on voice survived, and the removed humanness
> loop meant nothing caught it. Changes:
> - **Draft now runs on Claude, not GPT-4.1.** Voice-class types (pamflet, editorial,
>   opinie, blog, reportaj, cultură, analiză) draft on **Opus 5**; news-class on
>   **Sonnet 5**. The editor's voice now drives the bones instead of being applied later.
> - **Polish (Sonnet 5) is told to preserve the author's hand** — keep paragraph-length
>   variation and sentence-rhythm burstiness, never regularize into uniform paragraphs
>   (the #1 way a polish pass makes writing read as AI).
> - `callAnthropic` extended to an `opus | sonnet | haiku` tier; `PRICE` table corrected
>   to real rates (Opus **$5/$25**, Sonnet 5 **$2/$10**).
>
> **Verified cost (real prices):** news-class articles are ~cost-neutral (~$0.21/bilingual
> article, Sonnet 5 being cheaper offsets the change); voice-class articles are ~$0.31
> (+$0.10) with Opus drafting. At ~30 Editor-AI articles/month that is **+$1.50–3/month**.
> (An earlier estimate of "$0.67/article, +195%" was wrong — it used $15/$75 for Opus;
> the real Opus rate is $5/$25.)
>
> **Deliberately NOT bundled yet (offered as validated next steps, to avoid shipping
> untested control-flow):** a measured burstiness *enforcement* pass and an
> anti-plagiarism *overlap* gate. The Opus voice-first draft should largely fix the
> flatness on its own; generate one pamflet/editorial/opinie after deploying and
> confirm before adding the enforcement loops. The "Citește și…" archive cross-linking
> is a separate follow-up build.
>
> ---
>
> **Addendum (2nd pass) — editor roster fix in `tt-process-scraped-article`.**
> Invited editors write their own articles by hand and must never be auto-assigned
> to scraped articles. Added `INVITED_EDITORS = {anamaria_florea}` and a
> `SCRAPER_ROUTABLE_EDITORS` pool (all staff editors minus invited). The Gemini
> classifier is now offered only the routable pool, a stray pick of an invited
> byline falls back to the category's staff editor, and Anamaria Florea was
> removed from the `EDITOR_TONE_DESCRIPTORS` text. Adriana Alexandru and Andreea
> Tomuța were never backend editor keys, so they needed no change. The
> category→editor map (`EDITOR_BY_CATEGORY`) already matched Editor AI exactly
> (politics→andrei_popescu, technology→mihai_ionescu, **business→daniel_dobos**,
> opinion→daniel_dobos) — Dobos was never mapped to politics; the mis-assignments
> came from the free-form classifier, which the M3 change + this exclusion now
> constrain. `tt-generate-article` was left unchanged pending your decision on the
> quality rework discussed separately (its draft stage runs on GPT-4.1; polish/
> extend on Sonnet).


**Prepared for:** Daniel Dobos · **Date:** 3 Sep 2026
**Scope:** the 6 deployed edge functions you supplied, read line by line from the
actual deployed source (not the repo — the deployed `tt-process-scraped-article`
is **v72.3/v73**, well ahead of the repo copy, so every line/offset here is from
YOUR uploaded source).

Every file in this package is the **complete, paste-ready function**. All six were
type-checked with `deno check` (Deno 2.9.6) against the live `@supabase/supabase-js@2`
types — **all six pass clean**. Nothing here was written to your repo or database.

---

## The one-paragraph diagnosis

Your three complaints — no distinct editor voice, symmetric paragraphs, short
articles — trace to **two enforcement gaps in the scraper**, not to missing
features. The 10 editor voices, the burstiness/asymmetry rules, the anti-plagiarism
rules and the archetype length ranges are all present and correctly written. But
(1) the editor **auto-selector funnels almost all scraped wire to `victor_simon`**,
whose own signature is explicitly *"wire register … short 400–700 words … BANNED:
artificial length"* — so over-routing to him produces both the flat voice AND the
thin length; and (2) the **rhythm/asymmetry enforcement loop is gated off** exactly
when it's needed (batch pressure and the 85–90 score band), so symmetric drafts
ship unfixed. The fixes below close both gaps. The other four functions were read
in full and are **sound for these goals** — changing them would add risk, not
remove it.

---

## What changed, per file

### 1. `tt-process-scraped-article/index.ts` — the bulk producer (2 fixes)

This is the twice-daily cron writer and the source of the 61%-under-450-word
corpus. Two surgical fixes, both verified safe.

**M3 — Editor routing (voice diversity + indirect length).** *Prompt-only, zero
runtime risk.* Rewrote the `EDITOR_TONE_DESCRIPTORS` block that Gemini uses to pick
the byline (used at the classifier in `enrichSource`):

- Added a **SELECTION PRINCIPLE** header instructing the classifier to match each
  story to the editor whose **subject specialty** fits, and to treat `victor_simon`
  as a last resort rather than the default for anything wire-shaped.
- Rewrote the **`victor_simon`** descriptor from *"Routine news, factual
  announcements, administrative updates, sports results, transport, weather …
  Wire-service material"* (which almost every scraped item matched) to a **narrow
  last-resort** definition, with explicit re-routes (cultural event → `lucian_bratu`,
  transport/infrastructure → `mihai_ionescu`, sport-with-a-person → `anamaria_florea`,
  health → `sofia_marinescu`, science/environment → `elena_vasilescu`).
- Added a **TIE-BREAK** line: prefer the subject-specific editor; spread bylines.

*Why this also helps length:* `victor_simon`'s voice caps length at 400–700w and
bans "artificial length." Routing richer stories to editors whose registers support
depth (Vasilescu long-form, Popescu/Elena `analiza`, Dobos `reportaj`) lets honest
length rise without padding.

**M4 — Rhythm/asymmetry enforcement runs under load (safely).** The
`humannessEnforceLoop` measures burstiness/paragraph-uniformity and asks Sonnet for
one targeted rewrite. It was skipped whenever `score ≥ 85` **or** `budgetMs < 30000`
— and under the batch the 30s budget is exactly what runs out, so batch articles
shipped un-humanized. Note there were **two** identical guards (one inside the loop,
one at the call site in `processOne`); the earlier plan named only the internal one
— **changing only that would have left the call-site guard still blocking the loop.**
Both were updated together:

| Location | Before | After |
|---|---|---|
| `callSonnetForRevision` timeout | `abort(), 45000` | `abort(), 20000` |
| `humannessEnforceLoop` internal gate | `score >= 85 \|\| budgetMs < 30000` | `score >= 90 \|\| budgetMs < 20000` |
| `processOne` EN call-site guard | `score < 85 && budgetRemainingEn > 30000` | `score < 90 && budgetRemainingEn > 20000` |
| `processOne` RO call-site guard | `score < 85 && budgetRemainingRo > 30000` | `score < 90 && budgetRemainingRo > 20000` |

*Effect:* the pass now runs on batch articles and on the 85–89 band (one lone
`UNIFORM_LENGTHS`/`MODERATE_BURSTINESS` flag) that previously shipped as-is.

*Safety (this is why the timeout was bounded, not just the gate dropped):* the loop
runs **before** the unguarded DB save, and the platform kills the function at ~200s.
The loop can now begin with as little as 20s of the article's own budget left, so I
hard-capped the revision at 20s. Worst case for a single article:
`~120s own-elapsed + 20s revision + ~3s save ≈ 145s` — a >50s margin under the
~200s kill, even for the last article in a batch. The budget math also prevents two
loops stacking near the deadline (after one 20s pass the other's budget goes
negative). Naively dropping the gate to 12000 with the old 45s timeout — the earlier
sketch — could have pushed a late article past 200s and **lost its save**; this
version cannot.

### 2. `tt-rewrite-blog-post/index.ts` — anti-plagiarism rewrite (1 fix)

Read in full. Your worry was that it "flattens editor voice or trims length while
de-duplicating." **It does neither:** `writeOneLanguage` and `polishOneLanguage`
both inject the editor voice and MASTER_HUMANIZING, and `getTargetWordCount` targets
**longer** output (700–1400w non-Victor; it expands, never trims). Anti-plagiarism
comes from MASTER_HUMANIZING's *"never reuse more than 3 consecutive words from the
source"* plus a full narrative restructure, applied across two passes.

One consistency fix only: the humanness gate `score >= 85` → **`score >= 90`** so a
mildly-symmetric rewrite also gets the rhythm pass. The **budget floor stays 30000**
and the revision cap stays 45s **on purpose** — this function does **one** post per
request with a **240s** soft limit, so there is no batch starvation and no timeout
risk to engineer around (unlike the scraper).

*Note (documentation drift, not a bug):* the v8 banner says the loop triggers at
"score < 75"; the actual deployed code was `>= 85`. Left the banner as-is to keep
the file byte-faithful except for the one logic line.

### 3. `tt-improve-for-adsense/index.ts` — 1 type-only hardening

Read in full. It **protects** length (`articleTooShort` rejects any improvement
below ~70% RO / ~65% EN of the original or under 6 paragraphs) and **bakes in the
same burstiness/asymmetry rules** in its system prompt. No behavioral change needed.
Applied one **type-only** fix: `data as BlogPost` → `data as unknown as BlogPost` at
the `.single()` result (line 739). This is TypeScript's own recommended remedy for a
pre-existing `TS2352` and is **erased at runtime** — no behavior change; it just
makes the file pass `deno check` clean.

### 4. `tt-adsense-quality-check/index.ts` — 1 type-only hardening

Read in full. **Read-only evaluator** — it never writes content, so it cannot affect
voice/length/asymmetry. Same single `as unknown as BlogPost` hardening (line 1482).
No behavioral change.

### 5. `tt-generate-article/index.ts` — delivered **unchanged** (verified sound)

Read in full (v17.4). This is your manual Editor-AI writer. It injects editor voice,
`ZERO_COPY` (explicit anti-plagiarism), and MASTER_HUMANIZING across its
compose/polish/extend stages, and the **length is the admin-specified word count**
enforced at ±15%. It deliberately removed the old humanness loop because it
"frequently failed JSON parsing and added latency" — re-adding it would reintroduce
that failure. Byte-for-byte identical to your deployed source; passes `deno check`.

### 6. `tt-translate-html/index.ts` — delivered **unchanged** (verified sound)

Read in full. Structure-preserving RO↔EN translator for rich (Word-imported)
articles; it doesn't author original prose, so it's outside the voice/length/
asymmetry concern. Byte-for-byte identical; passes `deno check`.

---

## What I deliberately did NOT change in code (and why)

**Length is not force-expanded in the scraper — on purpose.** The deployed v73 code
already documents (at `getArchetypeBudget`/`inferArticleType`/`judgeLength`) that
earlier versions *did* enforce numeric floors, that this fought `ANTI_PADDING`, and
that "used as a hard reject, that number destroyed good work." Archetype length is
now evidence-driven (fact count), which is correct: you cannot turn a 4-fact wire
brief into 1,200 honest words without padding, and AdSense penalises padding harder
than brevity. The real length levers are **(a)** the M3 routing change above,
**(b)** richer/local/multi-source input, and **(c)** the **publish-depth SQL gate**
already delivered (`sql/publish-depth-gate.sql`) that stops thin drafts reaching the
public site. Re-forcing length here would have reintroduced the exact padding the
code was tuned to remove.

**Anti-plagiarism overlap gate — recommended, not silently added.** `tt-rewrite-blog-post`
trusts the LLM (via the "no 3+ consecutive words from source" rule) to diverge, but
does not *measure* overlap against the original. Adding a `checkSourceOverlap()`
reject-and-reroll (the scraper already has that helper) would harden the guarantee —
but it's a new feature with its own retry/latency profile, so I've flagged it here
for your decision rather than bolting it on unrequested.

---

## Deploy

Paste each file's full contents into its Supabase dashboard function editor and
Deploy, then commit the same files to the repo at the paths in this package so
Netlify and Supabase stay in sync. Suggested order: `tt-process-scraped-article`
first (biggest impact), then `tt-rewrite-blog-post`, then the two type-only ones at
your convenience; `tt-generate-article` and `tt-translate-html` are unchanged and
need no redeploy.

After the next cron batch, watch the logs for `humanness-loop-en/ro starting` and
`lifted N → M` lines (M4 is working) and for a spread of `editor=` values other than
`victor_simon` (M3 is working).
