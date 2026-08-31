# Newsroom v3.2 — deploy pack

Everything is applied through the **Supabase dashboard** and the **GitHub web UI**.
No terminal, no CLI.

---

## 1 · Edge functions — Dashboard → Edge Functions → *(function)* → Code → paste → Deploy

| function | action |
|---|---|
| `generate-voiceover` | replace — this is your **deployed 641-line source** + the Romanian speech layer. **2 lines removed**, both deliberate. |
| `newsroom-anchor` | replace — your **deployed 665-line source** + 3 additions. **4 lines removed**, all deliberate. |
| `tt-social-seo` | **new** — deploy a new function with exactly this name. |

No new secrets. `tt-social-seo` uses `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`
and the two `SUPABASE_*` values you already have.

`_ORIGINALS/` holds the exact deployed files these were built from. Diff against them
and you will see only the changes listed below.

---

## 2 · SQL — Dashboard → SQL Editor

`supabase/sql/02_export_baseline_migration.sql` → paste → Run. **Read-only, changes nothing.**
It returns one cell, `migration_sql`. Expand it, copy the value, and save it in the repo as
`supabase/migrations/20260830100000_baseline_from_production.sql`.

That closes the finding that 22 of your 43 tables exist only in the SQL editor and the repo
cannot rebuild the database. (`01_newsroom_upgrade.sql` you already ran — it is not repeated here.)

---

## 3 · Frontend — GitHub → commit these paths

```
app/admin/newsroom/page.tsx        (replaced)
app/sitemap-news.xml/route.ts      (replaced)
app/buletin/page.tsx               (new)
app/buletin/[slug]/page.tsx        (new)
lib/bulletin.ts                    (new)
```

---

# What changed

## `generate-voiceover` — Ioana speaks proper Romanian

This is the piece you asked for. It lives here and nowhere else for one reason: this
function is the **last place the bulletin exists as words** before it becomes audio, and
all seven TTS engines are fed from the same string. Fix it here and the anchor is right
whichever engine answers. Fix it in a script-generating function and it only works when
that function wrote the text — a hand-edited script would still reach the voice raw.

**It costs nothing.** Pure TypeScript. No model call, no network.

The order of passes is unchanged in spirit from your own 28–29 Aug design:

```
1. roCleanup()             characters only — cedilla ş/ţ → ș/ț, smart quotes,
                           dashes, NBSP, markdown residue.  BEFORE the lexicon,
                           so a row written with proper diacritics matches text
                           that arrived with cedillas.
2. public.apply_lexicon()  YOUR table. Always wins.
3. expandRoLegalRefs()     law citations (unchanged).
4. roSpeech()              everything below.
```

The lexicon still runs **before** any digit becomes a word — deliberately, and for the
reason your own comment gives: a row keyed on "Legea 55/2020" could never match text
whose digits had already been spelled out. **A mispronunciation heard on air stays one
INSERT, no deploy.**

What `roSpeech()` handles:

- **Dates** — `12.03.2026`, `12/03/2026`, and `23 august 2026`.
- **Clock** — `14:30` → *paisprezece și treizeci*; `ora 14`; `:00` drops the minutes.
- **Phone numbers** — Romanian 4-3-3 shapes, read digit by digit.
- **Roman numerals**, in explicit contexts only — `secolul XX`, `clasa a VIII-a`,
  `al III-lea`. Never global: a bare *I*, *C* or *M* in Romanian copy is far more often
  a letter than a numeral.
- **Abbreviations** — `nr.`, `art.`, `alin.`, `lit.`, `jud.`, `str.`, `bd.`, `dr.`,
  `prof.`, `mil.`, `mld.`, `etc.`
- **Acronyms** — ANAF, ISU, DSU, DSP, DNA, SRI, CFR, TVA, BNR, INS, ANM, UMF, UBB,
  CNAIR, SMURD, UE, ONU, OMS, PSD, PNL, USR, AUR, UDMR and more.
- **Foreign names** the Romanian TTS reliably mangles — Google → *Gugăl*,
  YouTube → *Iutiub*, Facebook → *Feisbuc*, Schengen → *Șenghen*, Bruxelles → *Brusel*,
  Airbus → *Erbas*, and others.
- **Units** — km/h, m/s, kWh, MW, km², mp, kg, ha, RON, EUR, USD.
- **Percent, degrees, currency symbols** — `%`, `°C`, `€`, `$`.
- **Thousands and decimals** — `12.500` and `12 500` are one number, not two;
  `7,5` → *șapte virgulă cinci*.
- **Ranges** — `10-15 grade`.
- **Symbols** that would otherwise be read as punctuation or swallowed — `&`, `+`, `=`, `×`, `§`, `№`.

And the part that actually makes it sound Romanian rather than translated:

- **Gender agreement.** `2 ore` → *două ore*, but `2 lei` → *doi lei*. Romanian neuters
  are masculine in the singular and feminine in the plural, so `1 miliard` → *un miliard*
  while `2 miliarde` → *două miliarde*.
- **The linking "de".** 1–19 attach directly, from 20 the noun takes *de*, and for
  compounds it is the last two digits that decide: `115 lei` → *o sută cincisprezece lei*,
  but `120 lei` → *o sută douăzeci **de** lei*. A round hundred or thousand always takes it.
- **"1" is an article, not a numeral** — *un leu*, *o oră*. Never *unu leu*.
- Nouns are matched **without diacritics too**, so a headline typed as `2 scoli` still
  produces *două scoli*.

### Verified, not assumed

Fifteen real Romanian sentences were run through the whole chain. A sample:

```
IN : ANAF a dat amenzi de 1.250.000 lei in judetul Cluj.
OUT: Anaf a dat amenzi de un milion două sute cincizeci de mii de lei in judetul Cluj.

IN : Temperaturile ajung la 21°C, iar vantul bate cu 45 km/h.
OUT: Temperaturile ajung la douăzeci și una de grade Celsius, iar vantul bate cu
     patruzeci și cinci de kilometri pe oră.

IN : 1 leu, 1 oră, 12 lei, 12 ore, 20 lei, 100 lei, 115 lei.
OUT: un leu, o oră, doisprezece lei, douăsprezece ore, douăzeci de lei,
     o sută de lei, o sută cincisprezece lei.

IN : Secolul XX si clasa a VIII-a.
OUT: Secolul al douăzecilea si clasa a opta.
```

Four bugs were found by those tests and fixed before this file was written:
*doi scoli* (diacritics), *două sute cincizeci mii* (missing *de*), *o miliard*
(neuter singular), and `clasa a VIII-a` not matching at all.

### A latent bug in your existing code, NOT touched

`roNumber()` — the helper added for the legal citations — joins thousands as
`${roUnder1000(th, true)} mii`, which drops the linking *de*: 250 000 comes out
*două sute cincizeci mii* instead of *două sute cincizeci **de** mii*.

It never shows on the legal-citation path, because law numbers and four-digit years both
land under twenty thousand. So **your function is left exactly as it is** and the new path
does its own joining. Worth knowing it is there if you ever reuse `roNumber()` elsewhere.

### Also

The function now returns `lexicon_applied` and `speech_normalised`. The newsroom page
already has a *"corecții de pronunție aplicate"* indicator reading the first of those —
it could never light up before, because the function never sent it.

**Lines removed from your deployed source: 2.** Both are lines I rewrote in place
(the lexicon log line, and one comment). Diff against `_ORIGINALS/` to confirm.

---

## `newsroom-anchor` — 3 additions, 4 lines removed

- **`max_tokens` sizing.** Both engines were pinned at a hard-coded **1800**. A
  300-second Romanian bulletin is roughly 750 spoken words, and Romanian tokenises at
  about 4.2 tokens per word (the diacritics are multi-byte and split), so the words alone
  are ~3 100 tokens before the JSON envelope. 1800 could not hold it and **nothing
  reported the shortfall** — the model simply stopped mid-bulletin. Now sized from the
  real target, ceiling 16 000 so a bad `target_seconds` cannot run up a bill.
- **Lipsync ladder.** `pro` and `bun` both pointed at `sync-lipsync/v2`, so a fallback
  re-POSTed the model that had just refused. De-duplicated. `economic` had a ladder of
  exactly one entry — the *default* tier had no fallback at all; it now falls to `veed`
  then `standard`, and the response reports the tier actually used.
- **Kling avatar length guard.** Refuses audio over 90 s with the real remedy rather than
  billing $3.37/min against a UI estimate of $0.30/min. Segmenting would need ffmpeg,
  which the Deno edge runtime does not have — so it is refused honestly instead of faked.
- **New `sectionize` action** — re-derives lower-thirds from a hand-edited script without
  rewriting a word of it.
- Paid calls write to `ai_spend_log`.

The 4 removed lines are the two `max_tokens: 1800` lines and the two ladder lines that
were replaced. Nothing else.

---

## `tt-social-seo` (new)

Admin-gated with your own `requireAdmin()`, copied verbatim rather than reinvented.

Picks **one lead story** by specificity (hard numbers, named institutions, local county,
consequence verbs) — scored in code, so it is reproducible. Per-platform native specs
enforced in code after generation: FB / IG / TikTok / YouTube / X / LinkedIn / Threads,
plus a Discover headline, RO **and** EN. YouTube chapters built from the story start times
the compositor already computes — never asked of the model, because a hallucinated
timestamp is worse than no chapter. Tiered hashtags. Links point at the **article**, with
`utm_campaign=buletin-YYYY-MM-DD` so the A/B is measurable in `site_analytics`.
Publish-hour guidance from your own `site_analytics`, omitted entirely below 200 visits
rather than invented.

No search-volume numbers anywhere: there is no paid keyword source in this stack, and
quoting a volume I cannot source would be fabrication.

> One bug was caught here by the compiler before shipping: `String(v ?? fb || '')` is not
> valid JavaScript (`??` cannot mix with `||` unparenthesised). It would have failed at
> deploy. Fixed.

---

# Not in this pack, deliberately

- **`newsroom-script-v7` is parked**, per your decision. Its broadcast audit enforces
  "no claim without a source" and flags `unsupported_claim` at high severity — which for a
  newsroom that writes its own articles would mean paying a fourth model call to have your
  own reporting argued with. The two things worth having from it are in this pack: the
  `max_tokens` sizing, and the Romanian speech work.
- **The repo function sync.** Supabase's Edge Functions dashboard is currently degraded
  ("Deploy status unavailable"); I got 2 of the 6 pristine sources I needed before it
  stopped serving. Separately, 8 functions are gated in production but have **no gate at
  all** in the repo — `newsroom-anchor`, `generate-voiceover`, `voice-lab`,
  `publish-social`, `tt-proof-article`, `tt-translate-html`, `align-subtitles`,
  `generate-image-edit`. Two of those eight are fixed by this pack. The rest still need
  their real source pulled before the repo is safe to deploy from.
- **A `claude-sonnet-4-5-20250929` retirement.** Tentative retirement is **not sooner than
  29 September 2026**, and it is hard-coded in six places across your functions. Not
  changed here — swapping a model is a behaviour change and I am not making it silently.

---

# v3.1 — the Netlify build failure, fixed

v3.0 broke your build:

```
./app/buletin/[slug]/page.tsx:59:7
Type error: Object literal may only specify known properties, and
'publishedTime' does not exist in type 'OpenGraphMetadata | OpenGraphVideoOther'.
```

`publishedTime` is only valid when `openGraph.type === 'article'`. That page is a
**video** object (`type: 'video.other'`), which does not accept it. The timestamp is now
emitted as plain meta tags instead — `article:published_time` and `og:video:release_date`.
Nothing is lost: Google takes the publication date from the `VideoObject` / `NewsArticle`
JSON-LD on the page, which was always the primary signal.

**Why it got through.** I ran `tsc` and then filtered the output for `TS2304` (undefined
names) only, so every other class of type error was invisible to me. That was a bad check
dressed up as a good one. It has been replaced: v3.1 was verified by installing your repo's
real dependencies and running your actual `next build`.

### And one thing the real build exposed that I then hardened

Your existing `/sitemap.xml` dies during prerender when a Supabase env var is missing
(`Error: supabaseUrl is required`) — `createClient()` throws synchronously, and an
unguarded throw in a prerendered route fails the whole deploy. My new `/buletin` pages had
the same shape. They no longer do:

- `publicClient()` returns `null` instead of throwing when the env vars are absent.
- `getBulletin()`, `listBulletins()` and `getBulletinStories()` each catch and degrade —
  empty list, or story titles without their article links.

**A bulletin page can now never take your site build down.** Proven, not asserted: the
full build was run with `NEXT_PUBLIC_SUPABASE_URL` pointed at an unreachable host and
completed green, with `/buletin`, `/buletin/[slug]` and `/admin/newsroom` all built.

(Your `/sitemap.xml` still has the original unguarded pattern. It is not mine to change in
this pack, but it is the same latent failure and worth a two-line guard.)

---

# v3.2 — duplicated sentences in the SEO/social pack, fixed

Reported: the Facebook post repeated its own closing question, and the Instagram
caption repeated the headline.

**Cause.** Every caption is assembled from *separate* model fields — a hook, a body, a
closing question — and the model very often puts the hook back at the top of the body,
or answers "caption" with the headline it already gave as `hooks[0]`. Concatenating them
then prints the same sentence twice. Three composers were affected: `facebook.text`,
`instagram.caption`, `linkedin.text`.

**Fix, in code rather than in the prompt.** A prompt cannot guarantee this away — the
fields genuinely overlap in meaning, which is why they exist separately. So a new
`dedupeSentences()` runs after generation, like every other per-platform rule in this
file: it drops any sentence already printed earlier in the same post, comparing without
diacritics or punctuation (so *"Opt morți, 17 dispăruți"* and *"Opt morti, 17 disparuti"*
count as the same). Hashtag and URL lines pass through untouched, sentences under 12
characters are left alone as too short to judge, and each part keeps its own leading
newline so paragraph breaks survive.

Verified on both of the reported cases plus a diacritic-mismatch case and a control where
nothing should be removed — the control comes through unchanged, paragraph breaks intact.

---

# Verification run before shipping

```
npm install + npx next build against your real repo — PASSED
   ✓ Compiled successfully
   ✓ Generating static pages (71/71)
   ƒ /admin/newsroom     built
   ƒ /buletin            built
   ƒ /buletin/[slug]     built
   — and repeated with Supabase pointed at an unreachable host: still green

tsc --noEmit -p tsconfig.json (your config, full output, not filtered) — 0 errors

esbuild  generate-voiceover  OK
esbuild  newsroom-anchor     OK
esbuild  tt-social-seo       OK
node     4 caption-dedupe cases (2 reported bugs + diacritics + control) — all correct
diff     generate-voiceover  vs deployed:  2 deletions (both deliberate)
diff     newsroom-anchor     vs deployed:  4 deletions (all deliberate)
node     15 Romanian sentences through the full chain — all correct
```

# Rollback

Functions: paste the matching `_ORIGINALS/*.DEPLOYED-BEFORE.ts` back and Deploy.
Frontend: revert the commit.
