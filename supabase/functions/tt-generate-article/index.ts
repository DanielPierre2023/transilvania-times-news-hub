// supabase/functions/tt-generate-article/index.ts
//
// ============================================================================
// ADMIN AI EDITOR — Enterprise Editorial Pipeline v17.4 (June 22, 2026)
// ============================================================================
//
// v17.4 — CALLOPENAI RETRY + TIMEOUT FIX.
//
//   Production failures: 3 consecutive opinie articles failed at stage2-content-en
//   with "OpenAI exception: The signal has been aborted". Root cause:
//
//     A. CALL_TIMEOUT_MS was 45s. GPT-4.1 EN content generation for 1200w
//        opinie with ~5000-token system prompt intermittently exceeds 45s
//        (API latency variance). RO pipeline succeeds in ~20s (same model,
//        parallel call). EN pipeline times out → function returns failure.
//        FIX: raised CALL_TIMEOUT_MS from 45000 to 90000. The function's
//        totalBudgetMs is 240s, so 90s per call is safe.
//
//     B. callOpenAI had ZERO retry logic. A single timeout = total failure.
//        The scraper (tt-process-scraped-article) has fetchWithRetry with
//        maxRetries=2 and exponential backoff — same resilience now added
//        to callOpenAI. Retries on: timeout/AbortError, 429 rate limit,
//        5xx server errors. Backoff: 1s, 2s.
//
// ============================================================================
//
// ADMIN AI EDITOR — Enterprise Editorial Pipeline v17.3 (June 16, 2026)
// ============================================================================
//
// v17.3 — RULE PATCHES FROM PRODUCTION FAILURE ANALYSIS (Veștea/240 voturi article).
//
//   Output analysis flagged 4 real defects in published article. Patches:
//
//     A. FABRICATION_BAN_RO + EN now explicitly forbid:
//        - Inventing titles/credentials for named persons (caught Neacșu case
//          where brief said "Marian Neacșu (PSD)" and output fabricated
//          "secretar general adjunct al PSD")
//        - Promoting paraphrased material to direct quotes with quote marks
//          (caught Mihail Veștea case where output wrote „nimeni nu vrea să
//          scindeze partidul" with substituted word, presented as quote)
//        - Adding editorial interpretation attributed to a source via
//          "sugerând că…", "indicating that…" (caught case where output
//          inferred motivation Mihail Veștea never stated)
//
//     B. HUMANIZATION_RO + EN now forbid:
//        - Repetitive attribution verbs (MAX 2 "potrivit"/article — output
//          had 4 near-identical attribution phrases)
//        - Uniform paragraph length (all paragraphs 3-4 sentences = AI marker)
//        - Consecutive paragraphs with same opening pattern
//
//     C. FABRICATION_HARD_STOP block (previously orphaned in source — defined
//        but never wired into any stage) is now applied in stageContent,
//        stagePolish, stageExtend. This block contains the precise
//        "verbatim test" for quote marks that catches paraphrase-to-quote
//        promotion.
//
// ============================================================================
//
// ADMIN AI EDITOR — Enterprise Editorial Pipeline v17.2 (June 16, 2026)
// ============================================================================
//
// v17.2 — VOICE-TYPE PARITY ACROSS ALL STAGES.
//
//   Audit caught three remaining gaps after v17.1:
//
//     A. stagePolish used fixed temperature 0.5 — should be per-type.
//        Pamflet and blog get 0.75 (satire/personal voice need creative freedom).
//        News and analiza get 0.5 (factual rigor). Others get 0.6.
//        Same logic now wired in stageContent + stagePolish + stageExtend via
//        a single temperatureForType(articleType) helper.
//
//     B. stageExtend used fixed temperature 0.5 — same fix.
//
//     C. stageExtend referenced editorName ("You are X...") but did NOT inject
//        the editor's voice signature into the extend prompt. Extension was
//        running voice-blind. Now stageExtend includes both TYPE REGISTER
//        (TONE_VOICE) and EDITOR SIGNATURE (EDITOR_VOICE) explicitly.
//
//   Every article type — news, tehnologie, pamflet, editorial, opinie, blog,
//   reportaj, cultura, analiza — now gets identical rule coverage in
//   stageContent (minus news-only RULES + STRUCTURE_FIRST), stagePolish, and
//   stageExtend. The differentiator is the TONE_VOICE register and
//   EDITOR_VOICE signature, not the rule blocks.
//
// ============================================================================
//
// ADMIN AI EDITOR — Enterprise Editorial Pipeline v17.1 (June 16, 2026)
// ============================================================================
//
// v17.1 — RULE COVERAGE PARITY WITH v16.5 (full audit of preserved blocks).
//
//   v17.0 dropped four things v16.5 had wired in. Restored:
//
//     A. stageContent (news class only): adds RULES (NYT/WaPo absolute rules)
//        + STRUCTURE_FIRST (non-negotiable news structure: lead → context →
//        quotes → consequence). Voice class still skips these to let the
//        writer's argument breathe.
//
//     B. stagePolish: full rule stack now wired — TT_STANDARDS / ROMANIAN_NATIVE,
//        MASTER_HUMANIZING, HUMANIZATION, ZERO_COPY (anti-plagiarism),
//        FABRICATION_BAN, ANTI_PADDING, LOCAL_AUDIENCE_DISCIPLINE,
//        FIRST_PERSON_BAN. Polish can no longer invent facts.
//
//     C. stageExtend: FABRICATION_BAN + ZERO_COPY + HUMANIZATION + ANTI_PADDING
//        + explicit "extension discipline" rules. Extension is the highest-risk
//        stage for invented facts; now it has the same guardrails as draft.
//
//     D. measureHumanness wired as final telemetry — measures the score and
//        logs it on every run, both languages, for production visibility.
//        No retry loop (the old humannessEnforceLoop frequently failed JSON
//        parsing and added latency for marginal gains). Telemetry only.
//
//   All five accumulation principles from v17.0 preserved:
//     1. Result<T, Error> on every external call (no silent fallbacks)
//     2. XML tags for free-form prose, JSON only for short metadata fields
//     3. Defensive toStr() coercion at every boundary
//     4. Type guards inside sanitizers (no "r.replace is not a function")
//     5. Fail loud with stage name in error response
//
// ============================================================================
//
// ADMIN AI EDITOR — Enterprise Editorial Pipeline v17.0 (June 16, 2026)
// ============================================================================
//
// COMPLETE STRUCTURAL REWRITE. All accumulated patches (v14 → v16.5) discarded.
// All linguistic infrastructure preserved verbatim: editor voices, tone
// registers, sanitizers, humanization rules, fabrication bans, Romanian
// native rules — none of that changes. What's new is the ORCHESTRATION layer.
//
// ARCHITECTURE (clean, structured, fail-loud):
//
//   ┌────────────────────────────────────────────────────────────────┐
//   │ Deno.serve handler                                             │
//   │  - Parse + validate request body                               │
//   │  - Catch all errors, format structured JSON response           │
//   └────────────────────────────────────────────────────────────────┘
//                              ↓
//   ┌────────────────────────────────────────────────────────────────┐
//   │ generateArticle(input, budget) → GenerationResult              │
//   │  - Coordinate stages                                           │
//   │  - Track cost + telemetry                                      │
//   │  - Enforce length contract (input-proportional cap)            │
//   └────────────────────────────────────────────────────────────────┘
//                              ↓
//   ┌────────────────────────────────────────────────────────────────┐
//   │ Stage 1: research (Gemini, news class only)                    │
//   └────────────────────────────────────────────────────────────────┘
//                              ↓
//                  ┌───────────┴───────────┐
//                  ↓                       ↓
//         runPipelineForLanguage      runPipelineForLanguage
//              ('en')                       ('ro')
//                  ↓                       ↓
//      Stage 2: content (GPT-4.1, XML output)
//      Stage 5: extend (Sonnet, XML, if short)
//      Stage 4: polish (Sonnet, XML)
//      Stage 6: semantic guard (Haiku, JSON short fields)
//      Stage 3: metadata (GPT-4.1, JSON short fields)
//                  ↓                       ↓
//                  └───────────┬───────────┘
//                              ↓
//   ┌────────────────────────────────────────────────────────────────┐
//   │ Assemble unified response                                      │
//   │  - Write telemetry row                                         │
//   │  - Return JSON to client                                       │
//   └────────────────────────────────────────────────────────────────┘
//
// CORE DESIGN PRINCIPLES (non-negotiable):
//
//   1. Result<T,E> everywhere — every external call returns typed Result.
//      No silent fallbacks. No `as string` casts. No swallowed errors.
//      When a stage fails, the user gets a specific error naming the stage.
//
//   2. CONTENT (free-form prose) uses XML tags <content>...</content>.
//      METADATA (short fields: title, tags, SEO) uses JSON.
//      Never mix. JSON cannot reliably encode multi-paragraph text with
//      smart quotes and diacritics; XML tags can.
//
//   3. Defensive coercion via toStr(). GPT-4.1 in json_object mode sometimes
//      returns fields as arrays/objects instead of strings. toStr() coerces
//      and logs which field misbehaved.
//
//   4. Type guards at the top of every sanitizer. Even if toStr() is bypassed,
//      sanitize functions detect non-string input and return empty + warning,
//      never crash with "r.replace is not a function".
//
//   5. One linear pipeline. Six stages. Each stage is one function with one
//      job, clear input, clear Result<T> output. No mutation of shared state
//      across stages. No global retries hidden inside helpers.
//
//   6. Length contract: input-proportional cap. effectiveTarget = min(requested,
//      briefWords * multiplier). multiplier = 2.5 voice / 3.0 news. Below
//      target by >15%? One Sonnet extend pass. No infinite retry loops.
//
//   7. Telemetry per run. Every stage logs entry + result + duration. Final
//      telemetry row persisted to generation_logs with all flags so we can
//      audit production behavior without guessing.
//
// MODEL ROUTING:
//   - Gemini 2.5 Flash → research enrichment (cheap, fast)
//   - GPT-4.1-2025-04-14 → content draft (instruction-following), metadata JSON
//   - Sonnet 4.5 → polish + extend (better at follow-the-structure)
//   - Haiku 4.5 → semantic guard (cheap title/closer checks)
//
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GEMINI_MODEL = 'gemini-2.5-flash'
const SONNET_MODEL = 'claude-sonnet-4-5-20250929'
const HAIKU_MODEL  = 'claude-haiku-4-5'

const PRICE = {
  gemini: { in: 0.10, out: 0.40 },
  openai: { in: 2.00, out: 8.00 },  // GPT-4.1 launch pricing
  sonnet: { in: 3.00, out: 15.00 },
  haiku:  { in: 1.00, out: 5.00 },
}

const CALL_TIMEOUT_MS    = 90000
const SONNET_BUDGET_MS   = 35000
const TOTAL_SOFT_LIMIT_MS = 130000

// v16: article-type classification ─────────────────────────────────────────
// NEWS_CLASS  — factual reporting, inverted pyramid, attributed sources.
// VOICE_CLASS — voice-driven (opinion, narrative, criticism, analysis).
// The class decides which system-prompt assembly path runs and whether
// Desk 1.5 enrichment is applied.
const VOICE_CLASS_TYPES = ['pamflet', 'editorial', 'opinie', 'blog', 'reportaj', 'cultura', 'analiza']
const NEWS_CLASS_TYPES  = ['news', 'tehnologie']

function isVoiceClass(t: string): boolean {
  return VOICE_CLASS_TYPES.includes(t)
}

interface CostTracker { usd: number }


// ═══════════════════════════════════════════════════════════════════════════════
// TT SHARED PROMPTS & HELPERS — preserved BYTE-FOR-BYTE from v14
// ═══════════════════════════════════════════════════════════════════════════════

const TT_STANDARDS = `TRANSILVANIA TIMES NEWSROOM STANDARDS

ATTRIBUTION
- Use "said" for quoted speech. Never "stated", "noted", "emphasized", "expressed", "highlighted".
- In Romanian: "a declarat". Never "a subliniat", "a evidențiat", "a menționat".
- Attribute every claim. First mention: full name and title. Later: family name only.
- Vary attribution verbs across the article — never repeat "said" or "a declarat" more than twice consecutively. Alternate with "told reporters / a spus / a precizat / a anunțat / a confirmat / potrivit lui X / conform Y".

FORMAT
- No subheadings (no ## or ###). Continuous prose.
- No bold-on-own-line. No conclusion paragraph.
- Paragraphs separated by two newlines.

LANGUAGE
- Active voice unless passive required for emphasis.
- Specific over vague. No "many", "significant", "various", "several".
- BANNED (EN): delve, landscape, game-changer, revolutionize, cutting-edge, leverage, navigate, paradigm, holistic, robust, comprehensive, essential, crucial, vital, pivotal, foster, bolster, harness, streamline, synergy, ecosystem, spearhead, underpin, unlock, empower, testament, realm, tapestry, beacon, treasure trove, stark reminder, plays a role, sheds light, it is worth noting, watershed moment, nestled in, vibrant, thriving.
- BANNED (RO): crucial, esențial, robust, vital, paradigmă, ecosistem, sinergie, peisajul, fundamental, semnificativ, remarcabil, notabil, considerabil, substanțial, deosebit de important, rezilient, reziliență, în cadrul, în cazul în care, în vederea, în încercarea de a, navighează complexitățile.

OUTPUT FORMAT
- Valid JSON only. No preamble. No markdown wrappers.
- Tags: 6-9 per language, lowercase, hyphenated. Romanian tags are native Romanian SEO terms.
- SEO title under 60 chars. SEO description under 160 chars.
- Excerpt: 1-2 sentence hook. Summary: 3-5 bullet-style sentences.
- Title itself: craft is defined separately (see TITLE_CRAFT block). Do not re-derive title rules here.`


const RULES = `ABSOLUTE RULES FOR NYT/WaPo-GRADE JOURNALISM:
1. ZERO subheadings (no ## or ###). The article flows as continuous prose.
2. No bold-on-own-line. NO labeled conclusion. The piece ends on its strongest remaining fact or the next decision point.
3. INVERTED PYRAMID: the most newsworthy fact in the first 3 paragraphs; supporting detail follows; background last.
4. LEAD: answer Who/What/Where/When in the first 2 sentences. Opening sentence max 35 words. Active voice.
5. One idea per paragraph, 2-4 sentences. Vary length deliberately — a 1-sentence paragraph for impact, a 4-sentence one for context.
6. ATTRIBUTION: use "said" for quotes. Never "stated", "expressed", "noted", "emphasized", "highlighted".
7. Active voice throughout; passive only to emphasize the object.
8. EVERY number gets context — out of how many, compared to what, over what period. A bare statistic is a failure.
9. Specific over vague. Never "many", "significant", "various", "several" — name the number or the entity.
10. SHOW, DON'T ASSERT. Do not call something important, shocking, or controversial — present the fact that makes the reader conclude it.
11. Concrete nouns over abstractions. Kill an adverb whenever a stronger verb exists ("ran fast" → "sprinted").
12. EVERY direct quote must earn its place — it carries information or emotion a paraphrase cannot. If it merely restates a fact, paraphrase and attribute instead.
13. ZERO AI fingerprints. BANNED words: delve, landscape, game-changer, revolutionize, cutting-edge, leverage, navigate, paradigm, holistic, robust, comprehensive, essential, crucial, vital, pivotal, foster, bolster, harness, streamline, synergy, ecosystem, spearhead, underpin, unlock, empower, testament, realm, tapestry, beacon, treasure trove, stark reminder, plays a role, sheds light, it is worth noting.
14. SUMMARY: 2-3 sentences, wire-abstract — who did what, where, when, why it matters. Not a hook.
15. EXCERPT: 1-2 sentence hook for preview cards.
16. Do NOT open with a date reference ("On March 21..."). Open with the news, a provocative claim, or a vivid concrete detail.
17. Tags: lowercase hyphenated slugs
18. Title craft is defined separately (see TITLE_CRAFT block) — do NOT re-derive title rules here., 2-5 words each.

ARTICLE STRUCTURE (NYT/WaPo STANDARD):
- Para 1-2: the lede. Most newsworthy fact, who did what, with what consequence. No throat-clearing.
- Para 3-4: the nut graf. Why this matters now, what changed, what is at stake.
- Para 5-7: evidence. Specific data, quotes, institutional reactions.
- Para 8-10: context. Historical precedent, comparable situations, expert analysis.
- Para 11+: background, methodology, caveats, opposing viewpoints.
- EVERY paragraph carries at least one specific fact: a name, number, date, or place.
- NO filler. No generic context that could apply to any article on the topic.
- If you cannot add a specific fact to a paragraph, CUT THE PARAGRAPH.`


// ─── v15 NEW: NON-NEGOTIABLE STRUCTURE BLOCK (placed FIRST in Desk 2A) ────────

const STRUCTURE_FIRST = `NON-NEGOTIABLE NEWS STRUCTURE (READ THIS TWICE BEFORE WRITING):

1. LEDE (paragraph 1): First 25 words name WHO did WHAT with WHAT CONSEQUENCE.
   NOT history. NOT founding. NOT background. NOT "the case began when".
   The lede is THE NEWS — the most recent, most consequential, most attributable fact.

2. NUT GRAF (paragraph 2): Why this matters NOW. What changed. What is at stake.
   Stakes quantified: how much money, how many people, what authority is acting.

3. EVIDENCE (paragraphs 3-5): Named quotes, hard numbers, institutional reactions,
   document citations. Attribution by full name + title + institution on first
   mention, family name only after.

4. CONTEXT (paragraphs 6+): Historical precedent, comparable situations,
   timeline of decisions, background — ONLY after the news and stakes are clear.

5. CLOSE: Last verifiable fact or last attributed statement. NEVER a speculation,
   summary, or "what's next" paragraph.

YOU ARE WRITING A NEWS ARTICLE, NOT SUMMARIZING THE BRIEF.
- Develop every fact in the research telegrams.
- Add context that journalism requires: institutional roles, regulatory framework,
  comparable cases — but only what the facts support, never invented.
- AIM for the target word count IF the facts support it. If they only support
  600 words of honest development, write 600 well-crafted words. NEVER PAD.
  NEVER INVENT. Quality of journalism over length.`


const ROMANIAN_NATIVE = `REGULI PENTRU ROMÂNĂ NATIVĂ (OBLIGATORII):

PRINCIPIU: Articolul în română NU este o traducere. Gândești în română de la primul cuvânt. Un cititor român trebuie să simtă că textul a fost scris de un jurnalist român, nu trecut printr-un traducător automat.

1. STRUCTURĂ: Zero subtitluri. Proză continuă. Fără paragraf de concluzie. Sentence case în titluri.

2. CALCHII INTERZISE (anglicisme și traduceri mecanice) — folosește varianta corectă:
   - "stă ca un testament" / "este un testament al" → "dovedește", "arată", "confirmă"
   - "rezidă în" → "se află în", "constă în"
   - "se traduce în / prin" → "duce la", "înseamnă", "are ca efect"
   - "imersiune" / "imersiv" → "cufundare", "experiență directă"
   - "dansul dintre" → "relația dintre", "jocul dintre" (doar dacă e literal)
   - "se aventurează în" → "intră în", "abordează", "pătrunde în"
   - "fără egal" / "fără pereche" → "unic", "neegalat", "cum nu s-a mai văzut"
   - "peisajul" (figurat: "peisajul politic") → "scena politică", "mediul", "domeniul"
   - "câmpul investițional / educațional / academic / cultural" → "mediul / domeniul X" (RO "câmp" este teren agricol; pentru "field of work" se spune "domeniul")
   - "a naviga prin / navighează complexitățile" → "a gestiona", "a face față", "a se descurca cu"
   - "la sfârșitul zilei" → "în cele din urmă", "în esență"
   - "un schimbător de joc" / "game-changer" → "o schimbare majoră", "un punct de cotitură"
   - "de ultimă generație" abuzat → numește tehnologia concretă
   - "în era digitală" / "în lumea de azi" → elimină sau numește momentul concret
   - "o mărturie a" → "o dovadă a", sau reformulează
   - "țese o poveste" / "țese împreună" → "leagă", "combină", "împletește" (cu grijă)
   - "într-o lume în care" → începe direct cu faptul
   - "rezilient" / "reziliență" → "rezistent" / "rezistență"
   - "paradigmă investițiilor" → "modelul investițiilor"
   - "acomodări / acomodare specială" → "facilități / facilitate specială" (RO "acomodare" = lodging, NU adjustments)
   - "prima instanță în care" → "primul caz în care" (RO "instanță" = court, NU occurrence)
   - "angajamente academice" → "obligații academice"
   - "libertatea de mișcare" → "libera circulație"
   - "așa cum stă decizia / așa cum se prezintă decizia" → "potrivit deciziei"

3. CONECTORI BIROCRATICI INTERZIȘI (semnătură AI #1 în română) — folosește varianta colocvială:
   - "în cazul în care" → "dacă"
   - "în cadrul (unei/unui/acestei) întâlniri" → "la o întâlnire", "într-o întâlnire"
   - "în vederea + substantiv" → "pentru + substantiv"
   - "în scopul de a / în încercarea de a" → "ca să" sau "pentru a"
   - "care vizează + substantiv" → "pentru + substantiv"
   - "alocările de fonduri" → "fondurile"
   - "deosebit de important" / "de o importanță majoră" → "important"
   - "la acea vreme" → "atunci"

4. VERBE DE ATRIBUIRE: folosește "a declarat", "a spus", "a precizat", "a explicat". INTERZIS ca tic AI: "a subliniat", "a evidențiat", "a accentuat", "a ținut să menționeze", "a punctat", "a atras atenția asupra", "a reamintit".
   VARIETATE: niciodată același verb de atribuire de două ori la rând. Alternează între "a declarat" / "a spus" / "a transmis" / "potrivit lui X" / "conform Y".

5. CUVINTE-AMBALAJ INTERZISE (fără conținut): crucial, esențial, vital, fundamental, paradigmă, ecosistem, sinergie, robust, semnificativ, remarcabil, notabil, considerabil, substanțial, deosebit de important, de o importanță majoră, rezilient, reziliență. ATENȚIE: toate formele flexionate sunt interzise (semnificativă, semnificative, semnificativi; remarcabilă, remarcabili).

6. "PE MĂSURĂ CE" — LIMITĂ DURĂ: maximum O DATĂ pe articol. Alte ocurențe: rescrie ca "în timp ce", "odată ce", "pe când", sau restructurează propoziția.

7. "ACEST/ACEASTĂ/ACESTE" CA ÎNCEPUT DE PROPOZIȚIE — maximum DE DOUĂ ORI pe articol. Alte ocurențe: folosește numele specific, un pronume, sau restructurează.

8. REGISTRU NATIV — capcane de traducere:
   - NU "oficialii au spus că" pentru orice sursă; în română: "reprezentanții instituției au declarat", "potrivit Ministerului", "surse din cadrul...".
   - Genitiv corect, nu construcția "of": "decizia guvernului", nu "decizia a guvernului".
   - Numerale: "12 milioane de euro" (cu "de"), "47 de contracte" (cu "de" după numere mari).
   - Folosește diacritice corecte peste tot: ă, â, î, ș, ț.
   - Evită calcul topicii engleze: româna acceptă inversiunea subiect-verb și o folosește natural în presă.

9. TITLUL — craft-ul e definit separat (vezi blocul TITLE_CRAFT). NU re-derivă reguli de titlu aici.

10. DESCHIDERE: Cine/Ce/Unde/Când în primele 2 propoziții. Prima propoziție max 35 de cuvinte. NU începe cu data ("Marți, 21 martie..."). Începe cu ȘTIREA.

11. PIRAMIDA INVERSATĂ: cele mai importante fapte în primele 3 paragrafe. Fiecare paragraf poartă un fapt concret.

12. FIECARE CIFRĂ primește context: din câți, comparativ cu ce, în ce interval. O cifră singură, fără reper, este o eroare.

13. TAGURI RO: 6-9 slug-uri lowercase cu cratimă, termeni de căutare nativi românești, NU traduceri. Exemplu: ["sanatate-digitala-romania", "reforma-spitale-2026"]. NU: ["Sănătate Digitală"].

14. NATURALEȚE: citește fraza cu voce tare în minte. Dacă sună a traducere — a "engleză îmbrăcată în cuvinte românești" — rescrie-o. Româna jurnalistică are ritmul ei: fraze ceva mai lungi decât în engleză, dar niciodată încărcate inutil.`


// v18.0 NEW: TITLE CRAFT — NYT/WaPo/Adevărul/G4Media-level title psychology.
// Injected into every write-and-polish system prompt.

const TITLE_CRAFT_EN = `TITLE SELF-TEST — run this checklist BEFORE outputting any title:

□ CUT THE "AMID" TAIL. If your title ends with "amid [context]", "as [situation] continues", "in the wake of", "ahead of", "on the back of" — delete everything after the main clause. The title IS the news, not the news plus its backdrop.
  FAILED: "Grindeanu Rejects Coalition with AUR Amid Political Standoff"
  PASSED: "Grindeanu rejects AUR coalition offer"
  FAILED: "Lucian Bode refuses to resign from PNL amid leadership pressure"
  PASSED: "Bode defies PNL leadership, refuses to resign"

□ DOES THE TITLE TELL THE WHOLE STORY? If a reader can skip the article after reading the title alone, you wrote a summary, not a title. Leave ONE thing for the article to deliver — the WHY, the CONSEQUENCE, or the WHAT NEXT.
  FAILED: "Romania reduces budget deficit by 44% in first five months" — complete, nothing left to read
  PASSED: "Bolojan claims 44% deficit cut, opposition disputes the math"
  FAILED: "Romania's private lending rises 7.7% year-over-year in May" — data point, not a story
  PASSED: "Romanian banks lend again after two-year squeeze"

□ KILL THE NARRATOR VOICE. If your title reads like a government press secretary wrote it — "[Institution] [neutral verb] [policy noun]" — it is dead on arrival. Ask: who LOSES? who WINS? what BREAKS?
  FAILED: "State offers companies incentives for hiring students during holidays"
  PASSED: "Firms get €500 per student hire as youth jobless rate hits 22%"
  FAILED: "President Dan convenes CSAT meeting to address security issues"
  PASSED: "Dan calls emergency CSAT over Black Sea drone breach"
  FAILED: "Cluj County Commission validates property claims, impacting local landowners"
  PASSED: "Cluj families lose land to restitution claims they never saw coming"

□ BAN THESE DEAD CONSTRUCTIONS — rewrite if your title matches any pattern:
  "[Institution] activates/convenes/validates/launches [noun]" — bureaucratic narrator
  "[Country]'s [sector] sees/records/registers [adjective] [noun]" — statistical narrator
  "amid" / "in the wake of" / "ahead of" / "on the back of" as a title tail
  "significant" / "important" / "major" / "substantial" without a number — use the number itself

□ VERB CHECK. These verbs are DEAD — never use them in a title:
  offers, activates, convenes, validates, registers, records, addresses, prioritizes, launches (neutral), discusses, considers, explores, seeks, prepares, examines
  ALIVE verbs: cuts, blocks, defies, loses, wins, drops, seizes, kills, quits, sues, breaks, forces, refuses, strips, collapses, doubles

□ THE CLICK TEST. Read your title. Would a smart, busy person stop scrolling to read the article? If no — rewrite until yes.`


const TITLE_CRAFT_RO = `AUTO-TEST TITLU — rulează această verificare ÎNAINTE de a produce titlul:

□ TAIE COADA "PE FONDUL". Dacă titlul se termină cu "pe fondul [context]", "în plin [situație]", "în contextul [X]", "în ciuda [Y]", "pe măsură ce [Z]" — șterge tot după clauza principală. Titlul ESTE știrea, nu știrea plus decorul ei.
  EȘUAT: "Grindeanu respinge coaliția cu AUR în plin blocaj politic"
  TRECUT: "Grindeanu respinge alianța cu AUR"
  EȘUAT: "Cluj activează măsuri de urgență pe fondul caniculei sub cod portocaliu"
  TRECUT: "Cluj închide școlile și deschide adăposturi pentru caniculă"

□ TITLUL SPUNE TOATĂ POVESTEA? Dacă cititorul poate sări peste articol după ce citește titlul, ai scris un rezumat, nu un titlu. Lasă UN SINGUR lucru pentru articol — DE CE, CONSECINȚA, sau CE URMEAZĂ.
  EȘUAT: "Deficitul bugetar al României s-a redus cu 44% în primele cinci luni ale anului" — complet, nimic de citit
  TRECUT: "Bolojan taie 44% din deficit, opoziția contestă cifrele"
  EȘUAT: "Creditarea privată din România crește cu 7.7% față de anul trecut" — dată statistică, nu știre
  TRECUT: "Băncile românești reîncep să dea credite după doi ani de strângere"
  EȘUAT: "Femeile din România vor ieși la pensie mai târziu din iulie 2026" — complet
  TRECUT: "Femeile pierd până la 2 ani de pensie din iulie"

□ UCIDE VOCEA NARATORULUI. Dacă titlul sună ca și cum l-a scris purtătorul de cuvânt al guvernului — "[Instituția] [verb neutru] [substantiv de politică]" — este mort. Întreabă: cine PIERDE? cine CÂȘTIGĂ? ce SE STRICĂ?
  EȘUAT: "Statul oferă stimulente financiare firmelor care angajează elevi și studenți în vacanțe"
  TRECUT: "Firmele primesc 500€ per stagiar, dar doar 1 din 10 cere banii"
  EȘUAT: "Președintele Dan convoacă ședință CSAT pentru probleme de securitate"
  TRECUT: "Dan cheamă CSAT de urgență după incidentul cu drona din Marea Neagră"
  EȘUAT: "Comisia județeană Cluj validează cereri de proprietate și afectează proprietarii locali"
  TRECUT: "Familii din Cluj pierd terenuri prin retrocedări pe care nu le-au aflat la timp"
  EȘUAT: "Poliția din Turda legitimează 234 de persoane într-o acțiune de amploare"
  TRECUT: "234 de persoane legitimate într-o razie la Turda — ce căutau polițiștii"

□ INTERZIS — rescrie dacă titlul tău conține vreunul:
  "[Instituția] activează/convoacă/validează/lansează [substantiv]" — narator birocratic
  "[Țara] înregistrează/consemnează creștere [adjectiv] în [sector]" — narator statistic
  "pe fondul" / "în plin" / "în contextul" / "pe măsură ce" ca final de titlu
  "semnificativ" / "important" / "puternic" / "profund" fără cifră — folosește cifra

□ VERIFICARE VERB. Aceste verbe sunt MOARTE în titlu:
  oferă, activează, convoacă, validează, înregistrează, consemnează, abordează, prioritizează, lansează (neutru), discută, ia în considerare, explorează, caută, pregătește, examinează, anunță
  VERBE VII: taie, blochează, sfidează, pierde, câștigă, scade, confiscă, oprește, demisionează, dă în judecată, rupe, forțează, refuză, desființează, se prăbușește

□ ABSTRACT-PLURAL = semn că titlul e AI:
  "provocările", "dinamicile", "evoluțiile", "aspectele", "implicațiile", "tendințele", "perspectivele" — numește lucrul CONCRET

□ TESTUL CLICK. Citește titlul. Un cititor deștept și grăbit s-ar opri din scroll ca să citească articolul? Dacă nu — rescrie până când da.`




const MASTER_HUMANIZING = `MASTER HUMANIZING CONSTRAINTS (apply to BOTH languages):

--- PLAGIARISM ---
- PLAGIARISM ZERO: never reuse more than 3 consecutive words from the source. Re-conceptualize every fact in your own structure. Do NOT follow the source's order, phrasing, or narrative flow.

--- SENTENCE RHYTHM (measurable — AI-detector fingerprint #1) ---
- BURSTINESS: include at least three sentences under 8 words AND at least three over 25 words. Never two consecutive sentences within 5 words of each other in length. Include at least one verbless fragment for emphasis.
- Do NOT alternate mechanically short → long → short. That regular pattern IS an AI signature. Use irregular sequences: two short then one very long, or three long then one short.
- LIVE VERBS: use strong finite verbs, not nominalizations — "decided", not "made the decision to". Cut filler like "it is important/notable/significant that".
- NO PREDICTABLE CONNECTIVE PAIRS: never pair "on one hand … on the other hand" (RO: "pe de o parte … pe de altă parte"), reflexive "not only … but also", or "although … nevertheless". Take one side or restructure.

--- PARAGRAPH STRUCTURE (measurable — fingerprint #2) ---
- VARY OPENERS: no two consecutive paragraphs may begin with the same word or grammatical structure. Alternate: proper noun, quote, time construction ("On Tuesday evening..."), result-first ("The decision was...").
- LENGTH VARIATION: include at least one paragraph of 1-2 sentences AND at least one of 5+ sentences. Uniform 3-4 sentence paragraphs across the whole article IS an AI marker.
- ALTERNATE TYPES: fact-dense (numbers, names, quotes) with interpretive (analysis, context, consequence). Never stack two of the same type.
- NO PARAGRAPH ECHO: never close a paragraph by restating what it just said. Banned closers: "This highlights/underscores/reflects/demonstrates …", "In conclusion", "In essence", "serves as a reminder", "only time will tell" (RO: "Acest lucru arată/subliniază …", "În concluzie", "Rămâne de văzut"). End each paragraph on its hardest concrete fact, number, or quote.

--- ATTRIBUTION VARIETY (measurable) ---
- Never the same attribution verb twice in a row. Rotate: EN — said, told reporters, wrote, posted, confirmed, according to, in X's words. RO — a declarat, a spus, a transmis, a precizat, potrivit, conform, a confirmat.
- MAX 2 uses of "according to" / "potrivit" / "conform" / "per" per article. If a third is needed, restructure.
- Attribution placement: NOT always at sentence start, NOT always at end. Alternate.

--- STRUCTURAL BANS (anti-AI-rhythm) ---
- TRICOLON: "X, Y, and Z" three-item lists — max once per article. Use two items or four.
- BAN "not only... but also" entirely.
- BAN negative parallelism "It's not X, it's Y" / "Nu este vorba doar de X, ci de Y" — max one per article, only if earned.
- BAN symmetrical scaffolding "On one hand... on the other hand" / "Pe de o parte... pe de altă parte" unless carrying a real counter-argument with named sources.
- BAN sentence starters (EN + RO): Indeed / Moreover / Furthermore / Notably / Importantly / Interestingly / Specifically / Essentially / Ultimately / Consequently / However / Nevertheless / Additionally / Mai mult / De asemenea / În plus / Totuși / Cu toate acestea / Prin urmare.
- EM DASH BAN: zero em dashes (—) anywhere. Use commas, periods, or parentheses.
- BAN false ranges "From X to Y" that imply a spectrum without one.

--- CLOSER STRUCTURAL BAN (replaces enumerated banned-phrase list) ---
The article ends on the LAST attributed fact — a number, a decision, a named person's stated position. It NEVER ends on:
- A prediction about the future without a named source with a specific quoted assessment.
- A rhetorical question, or "raises questions about" as the final construction.
- A summary of what was already said.
- A community-reaction placeholder ("residents await answers", "the case underscores...").
Sanitizers strip residual stock phrases at runtime, but the model MUST NOT generate closing paragraphs in this shape at all.

--- CONCRETENESS ---
- Use the precise domain term a specialist would use. Generic AI text avoids specialist terms; you must reach for them.
- Concrete over abstract: the reader should be able to picture what you describe.
- NO SYNONYM CYCLING: once you choose a term for a concept, use that SAME term throughout. Consistency reads more human than artificial variety.

--- HUMAN DISFLUENCIES (required, small doses) ---
- At least ONE parenthetical aside per article — the kind of remark a journalist inserts when they know more context: (deși cifrele oficiale nu confirmă încă acest lucru) / (though the ministry has not confirmed the figures).
- At least ONE rhetorical callback to an earlier fact: "the same €2.3M gap mentioned by the treasurer" / "aceleași cifre pe care Curtea de Conturi le contestase".
- NEVER use the same transition word twice in one article.

--- META-COMMENTARY BAN ---
Never describe the article ("this piece explores", "in this article", "în acest articol"). Just report.

--- DEMONSTRATIVE OPENER LIMIT ---
Sentences starting with "Acest/Această/Aceste/Aceasta/This/These/That" — max TWICE per article. Rewrite others with the specific noun, a pronoun, or restructure.

--- "PE MĂSURĂ CE" LIMIT (Romanian only) ---
Max ONCE per article. Rewrite others as "în timp ce", "odată ce", "pe când", or restructure.`


const HUMANIZATION_RO = `NATURALIZARE RO — DOAR CONȚINUT SPECIFIC ROMÂNEI:

CONECTORI BIROCRATICI INTERZIȘI (semnătura #1 a traducerii mecanice):
- "în cazul în care" → "dacă"
- "în cadrul (unei/unui/acestei) întâlniri" → "la o întâlnire", "într-o întâlnire"
- "în vederea + substantiv" → "pentru + substantiv"
- "în scopul de a / în încercarea de a" → "ca să" / "pentru a"
- "care vizează + substantiv" → "pentru + substantiv"
- "alocările de fonduri" → "fondurile"
- "deosebit de important" / "de o importanță majoră" → "important"
- "la acea vreme" → "atunci"
- "în ceea ce privește" → "despre"
- "în privința" → "privind"
- "în contextul în care" → "în timp ce"

VERBE DE ATRIBUIRE — REGULĂ HARDĂ:
- FOLOSEȘTE: "a declarat", "a spus", "a transmis", "a precizat", "a explicat", "a anunțat", "a confirmat", "a scris".
- INTERZIS COMPLET (tic AI): "a subliniat", "a evidențiat", "a accentuat", "a punctat", "a ținut să menționeze", "a atras atenția asupra", "a reamintit".
- Formule indirecte: variază între "potrivit X", "conform X", "așa cum a arătat X", "din declarațiile lui X reiese că", "X a confirmat că". Niciodată aceeași formulă de două ori într-un paragraf.

CUVINTE-AMBALAJ INTERZISE (fără conținut, toate formele flexionate):
crucial, esențial, vital, fundamental, semnificativ, notabil, considerabil, remarcabil, substanțial, rezilient, reziliență. Înlocuiește cu adjectivul precis SAU cu numărul concret. "Semnificativ" nu spune nimic; "cu 47% mai mult decât în 2024" spune totul.

CALCHII DE TRADUCERE — folosește varianta nativă:
- "a naviga prin / navighează complexitățile" → "gestionează", "face față"
- "peisajul politic" → "scena politică"; "peisajul X" figurat → "domeniul / mediul X"
- "câmpul (investițional/educațional/academic/cultural)" → "domeniul / mediul"
- "acomodări academice/speciale" → "facilități" (RO: acomodare = cazare)
- "prima instanță în care" → "primul caz în care" (RO: instanță = tribunal)
- "libertatea de mișcare" → "libera circulație"
- "așa cum stă / se prezintă decizia" → "potrivit deciziei"

REGISTRU ORAL-CULTIVAT (opțional, max 2-3 pe articol, dispersat):
"practic", "de fapt", "mă rog", "în fine". Le folosește un jurnalist bun când vrea să sune nativ, nu tradus.

DIACRITICE + NUMERALE — HARD:
- Toate diacriticele corecte peste tot: ă, â, î, ș, ț.
- Numerale: "12 milioane DE euro"; "47 DE contracte" (cu "de" după numere > 19).
- Genitiv: "decizia guvernului", nu "decizia A guvernului".

TESTUL FINAL — NATURALEȚE:
Citește fraza cu voce tare în minte. Dacă sună a "engleză îmbrăcată în cuvinte românești" — rescrie-o. Româna jurnalistică are ritmul ei: fraze ceva mai lungi decât în engleză, dar niciodată încărcate inutil. Româna acceptă natural inversiuni subiect-verb pe care presa serioasă le folosește pentru accent.`


const HUMANIZATION_EN = `HUMANIZATION EN — ONLY ENGLISH-SPECIFIC CONTENT:

TIER 1 BANNED VOCABULARY (AI-fingerprint words):
delve, landscape, robust, comprehensive, leverage, harness, seamless, foster, streamline, enhance, empower, utilize, endeavor, spearhead, commence, underscore, pivotal, integral, intricate, multifaceted, tapestry, embark, beacon, watershed moment, nestled in, vibrant, thriving, game-changer, cutting-edge, paradigm, ecosystem, synergy, holistic.

Replace with the plain precise word: "delve" → "explore" or "examine"; "leverage" → "use"; "robust" → "strong" or "reliable"; "streamline" → "simplify"; "foster" → "encourage"; "utilize" → "use"; "underscore" → "highlight"; "pivotal" → "key". Never smuggle a Tier 1 word back in with a small variant ("delves into", "harnessing", "empowered").

ATTRIBUTION VERB LIST:
- USE: said, told reporters, wrote, posted, confirmed, announced, added, explained, argued, warned.
- BANNED as ornament (AI signatures): "emphasized", "highlighted", "underscored", "stressed". Use only when the source genuinely emphasized something distinct from the plain content.

REGISTER — OCCASIONAL COLLOQUIAL LANDINGS (max 2-3 per article, dispersed):
"essentially", "in effect", "mind you", "for that matter". A verbless fragment used deliberately reads as human: "The result: deadlocked." "So no deal." Once per article is fine.

NATIVE ENGLISH RHYTHM:
- English news prose is shorter than Romanian news prose. Prefer the direct construction. "The mayor blocked the permit" beats "The permit was blocked by the mayor" beats "A blocking action was taken by the mayor".
- Avoid strings of prepositional phrases stacked on the tail of the sentence — a clear AI marker in English.

VOICE TEST:
Read the sentence aloud in your head. If it sounds like a corporate press release, it reads as AI to a human reader. Rewrite until it sounds like something a working reporter would type at a desk under deadline pressure.`


const ZERO_COPY_RO = `REGULĂ ANTI-PLAGIAT (OBLIGATORIE — ÎNCĂLCAREA = ARTICOL RESPINS):
Brieful editorial poate conține un articol complet dintr-o sursă externă. NU REPRODUCE NIMIC din textul sursei:
- ZERO propoziții copiate sau parafrazate la nivel de cuvânt. "Surse politice afirmă că liberalii resping orice formulă" → NU poți scrie "Surse politice susțin că liberalii refuză orice formulă". Aceasta NU este rescriere — este plagiat cosmeticizat.
- ZERO structură de paragraf din sursă. Ordinea ideilor TREBUIE să fie DIFERITĂ de cea a sursei.
- ZERO sintagme, tranziții sau formulări din sursă. "Consultările de la Cotroceni au loc în contextul" — dacă sursa spune asta, TU nu spui asta.
- ZERO lead identic sau similar. Dacă sursa deschide cu "Președintele X a reluat consultările", TU deschizi cu un unghi COMPLET diferit.

METODĂ OBLIGATORIE:
1. Citește brieful și extrage DOAR faptele atomice: CINE (nume complet, titlu, instituție), CE (acțiune, decizie, sumă exactă), CÂND (dată, oră), UNDE (loc exact), DE CE (motiv declarat, citat direct).
2. UITĂ formularea sursei. UITĂ ordinea paragrafelor. UITĂ tranzițiile. Scrie ca și cum ai afla faptele pentru prima dată dintr-un briefing oral de 30 de secunde.
3. RESTRUCTUREAZĂ narațiunea complet: alege un unghi NOU. Ordinea faptelor trebuie să fie DIFERITĂ.
4. Fiecare propoziție este construcția TA originală. NU o variantă a propoziției din sursă cu sinonime înlocuite.
5. TESTUL: dacă cineva pune articolul tău lângă sursă, NICIO propoziție nu trebuie să semene. Nicio secvență de 5+ cuvinte nu trebuie să se repete.`

const ZERO_COPY_EN = `ANTI-PLAGIARISM RULE (MANDATORY — VIOLATION = ARTICLE REJECTED):
The editorial brief may contain a complete article from an external source. REPRODUCE NOTHING from the source text:
- ZERO sentences copied or word-level paraphrased.
- ZERO paragraph structure from the source. The order of ideas MUST be DIFFERENT from the source.
- ZERO phrases, transitions, or formulations from the source.
- ZERO identical or similar lede.

MANDATORY METHOD:
1. Read the brief and extract ONLY atomic facts: WHO, WHAT, WHEN, WHERE, WHY.
2. FORGET the source's wording. FORGET the paragraph order. FORGET the transitions.
3. RESTRUCTURE the narrative completely.
4. Every sentence is YOUR original construction.
5. THE TEST: no sequence of 5+ words should repeat from the source.`


const FABRICATION_BAN_RO = `INTERZICEREA FABRICĂRII SURSELOR (OBLIGATORIE — ÎNCĂLCAREA = ARTICOL RESPINS):
Transilvania Times NU a contactat pe nimeni în legătură cu acest articol. NU scrie NICIODATĂ:
- "au declarat surse politice pentru Transilvania Times" — TT NU a vorbit cu acele surse.
- "Transilvania Times a solicitat / a contactat / a cerut un punct de vedere" — TT NU a solicitat nimic.
- "potrivit informațiilor obținute de Transilvania Times" — TT NU a obținut informații proprii.
- "în declarații acordate Transilvania Times" — nimeni NU a acordat declarații TT.
- "experți consultați de Transilvania Times" — TT NU a consultat experți.
- "într-un interviu acordat Transilvania Times" — TT NU a realizat interviuri.
- "potrivit unui comunicat" — dacă comunicatul nu apare în brief, NU îl inventa.
- "Transilvania Times nu a putut confirma / nu a primit răspuns" — NU fabrica procesul editorial.

CITATE ȘI ATRIBUIRE:
- NICIODATĂ nu inventa citate.
- NICIODATĂ nu inventa nume de analiști, experți sau comentatori.
- NICIODATĂ nu inventa interviuri, declarații de presă sau comunicări care nu există.
- Atribuirea corectă: "potrivit informațiilor publicate de [sursa originală]" sau "conform declarațiilor publice ale X" — NU "pentru Transilvania Times".
- Dacă nu știi sursa exactă, folosește: "potrivit informațiilor din presă" sau "conform datelor disponibile public".

INTERZICEREA FABRICĂRII TITLURILOR ȘI CREDENȚIALELOR (CRITICĂ):
- NU inventa funcții, titluri sau credențiale pentru persoane menționate în brief.
- Dacă brieful spune "Marian Neacșu (PSD)" — scrie "Marian Neacșu, de la PSD". NU scrie "Marian Neacșu, secretar general adjunct al PSD" decât dacă brieful precizează exact acest titlu.
- Dacă brieful spune "deputat USR" — folosește exact "deputat USR". NU adăuga "deputat USR de [județ]" decât dacă județul apare în brief.
- Dacă brieful nu specifică funcția cuiva, NU inventa una plauzibilă. Folosește doar formularea: "X, de la [partid]" sau "X, din [organizație]".
- TEST: înainte de a scrie un titlu/funcție/credențial, întreabă-te: "Apare exact acest titlu în brief, lângă acest nume?" Dacă NU — șterge-l.

INTERZICEREA PROMOVĂRII PARAFRAZEI LA CITAT DIRECT:
- Citatele între „…" trebuie să fie VERBATIM din brief, atribuite unei persoane NUMITE.
- Dacă materialul nu apare între ghilimele în brief, NU îl pune între „…" în articol — paraphrasează fără ghilimele.
- NU schimba cuvintele dintr-un citat. „doresc" ≠ „vor"; „a menționat că" introduce parafraza, NU un citat.
- TEST înainte de fiecare pereche „…": "Aceste cuvinte EXACTE apar în brief, atribuite acestei persoane numite?"
  - DA: păstrează citatul.
  - NU: REScrie fără ghilimele, ca atribuire indirectă.

INTERZICEREA INFERENȚEI EDITORIALE ATRIBUITE SURSELOR:
- NU adăuga interpretarea TA la spusele cuiva. Sursa spune doar ce este în brief.
- NU folosi "sugerând că…", "indicând că…", "lăsând să se înțeleagă că…" pentru a adăuga propria ta interpretare la o declarație.
- Dacă X a spus "nimeni nu vrea să scindeze partidul", NU adăuga "sugerând că presiunea vine din dorința de menținere a unității" — aceasta este interpretarea TA, nu ce a spus X.
- Atribuirea corectă reproduce DOAR ce a spus sursa. Implicațiile rămân în mintea cititorului.

REGULA DE AUR: Scrie DOAR ce poți demonstra din brieful primit.`

const FABRICATION_BAN_EN = `FABRICATION BAN (MANDATORY — VIOLATION = ARTICLE REJECTED):
Transilvania Times did NOT contact anyone for this article. NEVER write:
- "sources told Transilvania Times" — TT did not speak to those sources.
- "Transilvania Times reached out to / contacted / requested comment from" — TT requested nothing.
- "according to information obtained by Transilvania Times" — TT obtained no proprietary information.
- "in an interview with Transilvania Times" — TT conducted no interviews.
- "experts consulted by Transilvania Times" — TT consulted no experts.

QUOTES AND ATTRIBUTION:
- NEVER invent quotes.
- NEVER invent names of analysts, experts, or commentators.
- NEVER invent interviews, press statements, or communications that do not exist.
- Correct attribution: "according to reports by [original source]" — NOT "told Transilvania Times".

TITLE AND CREDENTIAL FABRICATION BAN (CRITICAL):
- DO NOT invent positions, titles, or credentials for people named in the brief.
- If the brief says "Marian Neacșu (PSD)" — write "Marian Neacșu, of PSD". DO NOT write "Marian Neacșu, deputy general secretary of PSD" unless the brief states that exact title.
- If the brief says "USR deputy" — use exactly "USR deputy". DO NOT add "USR deputy from [region]" unless the region appears in the brief.
- If the brief does not specify someone's role, DO NOT invent a plausible one. Use only: "X, of [party]" or "X, with [organization]".
- TEST: before writing any title/position/credential, ask: "Does this exact title appear in the brief, next to this name?" If NO — delete it.

PARAPHRASE-TO-DIRECT-QUOTE PROMOTION BAN:
- Material in quotation marks "..." must be VERBATIM from the brief, attributed to a NAMED person.
- If the material does not appear in quotation marks in the brief, DO NOT put it in quotation marks in the article — paraphrase without quotation marks.
- DO NOT change words inside a quote. "wishes" ≠ "wants"; "mentioned that" introduces paraphrase, NOT a direct quote.
- TEST before every pair of "..." marks: "Do these EXACT words appear in the brief, attributed to this named person?"
  - YES: keep the quote.
  - NO: rewrite without quotation marks, as indirect attribution.

EDITORIAL INFERENCE ATTRIBUTION BAN:
- DO NOT add your interpretation to what a source said. The source says only what is in the brief.
- DO NOT use "suggesting that…", "indicating that…", "implying that…" to attach your own interpretation to a statement.
- If X said "nobody wants to split the party", DO NOT add "suggesting that the pressure comes from a desire to maintain unity" — that is YOUR interpretation, not what X said.
- Correct attribution reproduces ONLY what the source said. The implications stay in the reader's mind.

THE GOLDEN RULE: Write ONLY what you can demonstrate from the brief received.`
const FABRICATION_HARD_STOP = `============================================
FABRICATION HARD STOP - READ FIRST, OBEY ABSOLUTELY
============================================

You will NOT invent quotes. You will NOT invent sources. This rule overrides every other instruction in this prompt.

ATTRIBUTION vs FABRICATION:
- ATTRIBUTION means: "Inspectorii DSP Bihor au constatat ca firma nu detinea autorizatie" / "DSP Bihor inspectors found that the firm lacked authorization". You name the institution that produced the finding. CORRECT JOURNALISM.
- FABRICATION means: "Am constatat lipsa autorizatiilor, a declarat un reprezentant DSP" / "We found the lack of authorization, a DSP representative said". You invent words and put them in someone's mouth. FIRING-OFFENSE JOURNALISM.

The news register asks for "multiple attributed sources". This does NOT mean "multiple direct quotes". You can have ONE direct quote and FIVE attributed sources. Attribution does not require quotation marks.

EXPLICIT RULES:
1. COUNT the direct quotes in the research telegrams. Your article contains AT MOST that many direct quotes. NOT MORE.
2. If a source is not directly quoted in the telegrams, attribute WITHOUT inventing words: "potrivit inspectorilor DSP Bihor" / "according to DSP inspectors". Never with fabricated quotation marks.
3. PLACEHOLDER ATTRIBUTIONS ARE FABRICATION: "un reprezentant", "un oficial", "un purtator de cuvant", "a spokesperson", "an official", "sources said". These are invented humans. NEVER pair them with quotation marks unless the exact words appear in the brief.
4. The brief may contain the source's editorial voice. If those words are framing, not a direct attributed quote in the brief, you do NOT reproduce them as a quote.

VIOLATION TEST: apply before writing every pair of quotation marks:
"Are these EXACT WORDS present in the editorial brief, attributed to a NAMED person or institution?"
- YES: quote and attribute correctly.
- NO: REWRITE THE SENTENCE WITHOUT QUOTATION MARKS. Use indirect attribution instead.
`


const ANTI_PADDING = `ANTI-PADDING — word count is earned by facts, never recycled:

Develop every fact from the digest with the depth serious journalism demands. Add context, attribution, or analytical framing where the material supports it — never filler, never invented material. If a section feels thin, DEEPEN existing paragraphs (more attribution, more named consequence, more precedent). Do NOT extend by adding speculation.

STRUCTURAL RULE: every paragraph must carry at least one specific fact from the digest — a name, a number, a date, a place, an attributed quote. A paragraph that would consist primarily of AI hand-wringing (unnamed "officials warn", vague "the region continues to adapt", speculative "the future will likely...") — CUT IT, end the article on the last verified fact.

A few concrete anchors for the model (not exhaustive — sanitizers strip residual stock phrases at runtime):
- EN AI hand-wringing sounds like: "This incident underscores...", "Such cases highlight the broader...", "The next phase will involve...", "Only time will tell...", "The community awaits answers..."
- RO AI hand-wringing sounds like: "Acest incident subliniază...", "Concluziile ar putea influența...", "Comunitatea așteaptă răspunsuri...", "Rămâne de văzut...", "Pe măsură ce regiunea continuă să se adapteze..."

If the digest genuinely supports only a short article, write the honest shorter length. Do NOT invent to hit a target.`


const LOCAL_AUDIENCE_DISCIPLINE = `LOCAL AUDIENCE DISCIPLINE — write for the reader who lives there:

For REGIONAL articles (Transylvania, Cluj, Sibiu, Brașov, Alba, Maramureș, Mureș, Bistrița, Hunedoara, Sălaj, Bihor, and their towns/communes), the reader already knows:
- The names of local sports clubs (Sticla Arieșul Turda, U Cluj, CFR Cluj, Universitatea Cluj)
- The geography (Florești is next to Cluj-Napoca; Turda is in Cluj county; Salina Turda is the salt mine)
- The local institutions (the county hospital, the city hall, the prefecture)
- The mayor's name (after the first mention; subsequent mentions use last name only)
- Local landmarks (Cetatea, Centrul Vechi, the river name)
- The county's main industries and recent history

DO NOT explain to a local audience what they already know. SPECIFIC BANS:
- Do NOT add "echipa de fotbal locală" before naming a recognized local team. Say the team's name.
- Do NOT add "comuna din apropierea Clujului" before a local commune name. The reader knows where Florești is.
- Do NOT add "primarul orașului X" on second or later mentions. Use the last name.
- Do NOT add "instituția responsabilă de..." before naming a recognized local institution.
- Do NOT explain "Cluj-Napoca, capitala județului Cluj" or "Turda, oraș din județul Cluj" — the audience knows.
- Do NOT explain landmarks the source itself doesn't explain.

When the article is NATIONAL or INTERNATIONAL, light context is allowed for non-local entities — but still never invent.`


const FIRST_PERSON_BAN_RO = `INTERZICEREA PERSOANEI ÎNTÂI (OBLIGATORIE pentru acest tip):
- ZERO persoana întâi singular: "eu", "eu cred", "consider", "mi se pare", "personal", "din punctul meu de vedere", "părerea mea", "experiența mea", "în opinia mea".
- ZERO persoana întâi plural editorială: "noi credem", "noi consideram", "noi trebuie", "noi românii", "redacția noastră".
- ZERO formule cu "se cuvine să", "trebuie să recunoaștem", "să admitem".
- Subiectul acțiunii este NUMIT — autoritatea (cu titlu și instituție), expertul (cu titlu și afiliere), persoana afectată (cu nume, vârstă, ocupație, localitate). NU autorul articolului.
- Verdictul vine din DATE și ATRIBUȚII, nu din voce auctorială.
- Singura voce permisă: jurnalismul observă, atribuie, contextualizează.`

const FIRST_PERSON_BAN_EN = `FIRST-PERSON BAN (MANDATORY for this article type):
- ZERO first-person singular: "I", "I think", "I believe", "I consider", "personally", "in my view", "my opinion", "my experience", "it seems to me".
- ZERO editorial first-person plural: "we believe", "we must", "we should", "as a nation", "our readers".
- ZERO constructions like "let us recognize", "we must admit", "one must concede".
- The actor in every sentence is NAMED — the official (with title and institution), the expert (with title and affiliation), the affected person (with name, age, occupation, town). NEVER the article's author.
- The verdict comes from DATA and ATTRIBUTED voices, never from an authorial voice.
- Only one voice permitted: journalism observes, attributes, contextualizes.`

function voiceAllowsFirstPerson(articleType: string): boolean {
  return articleType === 'blog' || articleType === 'editorial' || articleType === 'opinie'
}


const CATEGORY_DEPTH: Record<string, string> = {
  politics:  `DEPTH REQUIREMENTS: Name every political actor. State their party affiliation. Quantify stakes (budget amounts, vote counts, affected population). Explain policy consequences in concrete terms. Include at least one direct quote or attributed position. Reference the legislative timeline.`,
  business:  `DEPTH REQUIREMENTS: Include specific financial figures (revenue, market cap, growth percentages). Name companies, executives, and their titles. Explain market impact with numbers. Reference competitor positions. Include institutional reactions.`,
  technology:`DEPTH REQUIREMENTS: Name specific systems, protocols, versions, architectures. Explain technical tradeoffs. Reference comparable implementations. Include performance metrics or benchmarks. Mention the engineering team or technical leadership.`,
  culture:   `DEPTH REQUIREMENTS: Provide historical context — connect to artistic movements, previous works, or cultural traditions. Include critical framing. Reference at least one comparable work or event. Quote artists, curators, or critics.`,
  sports:    `DEPTH REQUIREMENTS: Include match scores, statistics, standings, records. Name players, coaches, and their records. Provide tactical analysis where relevant.`,
  health:    `DEPTH REQUIREMENTS: Cite specific studies, sample sizes, statistical significance. Name research institutions and lead researchers. Explain methodology. Include public health implications with population numbers.`,
  news:      `DEPTH REQUIREMENTS: Answer Who/What/Where/When/Why/How in the first 3 paragraphs. Include at least 2 attributed sources. Provide immediate context and background. Quantify impact.`,
  travel:    `DEPTH REQUIREMENTS: Include specific locations, routes, prices, practical details. Reference local customs and historical context. Provide seasonal or timing information.`,
  education: `DEPTH REQUIREMENTS: Name specific institutions, programs, rankings. Include enrollment figures and outcomes data. Reference educational policy and reform context. Quote educators or administrators.`,
  opinion:   `DEPTH REQUIREMENTS: State the thesis in the first paragraph. Support with at least 3 distinct evidence points. Acknowledge the strongest counterargument. Provide specific examples, not abstractions.`,
}


interface ToneDescriptor { ro: string; en: string }

const TONE_VOICE: Record<string, ToneDescriptor> = {

  news: {
    ro: `REGISTRU ȘTIRE — INVERTED PYRAMID, ȘCOALA INTERNAȚIONALĂ DE NEWS REPORTING
Voce: agenția serioasă (Reuters român, Associated Press tradus în registru românesc, secțiunea Actualitate de la Mediafax la cele bune zile, HotNews știri grele). Distantă, factuală, atribuită impecabil. NU este nici editorial, nici reportaj — este ȘTIRE.
Mecanică obligatorie:
- LEAD în primele 25 de cuvinte: CINE a făcut CE, UNDE, CÂND, DE CE — cel puțin 3 din 5W. Verb principal la indicativ, prezent sau perfect compus.
- Paragraful al doilea: contextul imediat (mărimea sumei, numărul de afectați, decizia anterioară, miza concretă).
- Citatul direct apare în prima jumătate a articolului. Cel puțin DOUĂ surse cu nume complet, titlu, instituție.
- Paragrafele sunt SCURTE — 2-4 propoziții. Fiecare paragraf duce o singură idee.
- Atribuire pentru fiecare afirmație factuală.
- Cifrele exacte cu unitatea și sursa.
- Background-ul (istoricul deciziei) intră în partea a doua, nu în lead.
- Final NU este concluzie. Final este ULTIMA INFORMAȚIE relevantă.
INTERZIS:
- Persoana întâi sub orice formă.
- Adjective de evaluare ("important", "grav") fără atribuire.
- Speculații ("ar putea însemna", "se prefigurează", "rămâne de văzut").
- Subtitluri, bullet lists.
- Verbe ornamentale: NICIODATĂ "a subliniat", "a evidențiat", "a accentuat". DOAR "a declarat", "a spus", "a anunțat", "a confirmat".`,
    en: `NEWS REGISTER — INVERTED PYRAMID, INTERNATIONAL WIRE TRADITION
Voice: the serious news agency (Reuters, AP, the news desk of the FT, the national desk of the NYT). Detached, factual, impeccably attributed.
Mandatory mechanics:
- LEDE in the first 25 words: WHO did WHAT, WHERE, WHEN, WHY — at least three of five Ws. Main verb in present or simple past, never conditional.
- Second paragraph: the immediate context.
- A direct quote appears in the first half. At least TWO named sources with full title and institution.
- Paragraphs are SHORT — 2-4 sentences. Each paragraph carries one idea.
- Attribution for every factual claim.
- Exact figures with units and source.
- Background enters in the second half, never the lede.
- The close is NOT a conclusion. The close is the LAST relevant piece of information.
BANNED:
- First person in any form.
- Evaluative adjectives ("important", "concerning") without attribution.
- Speculation ("could mean", "remains to be seen").
- Subheadings, bullet lists.
- Ornamental attribution verbs: NEVER "emphasized", "highlighted", "underscored", "stressed". ONLY "said", "told", "announced", "confirmed".`,
  },

  editorial: {
    ro: `REGISTRU EDITORIAL — ȘCOALA ROMÂNEASCĂ DE COMENTARIU POLITIC
Voce: editorialistul matur al unei redacții serioase — Cristian Tudor Popescu, Andrei Pleșu, Dan Tapalagă, Sabina Fati. Autoritate fără emfază.
Mecanică:
- Deschidere care își asumă teza în primele trei propoziții, fără "vrem să credem că".
- Argumente susținute cu fapte numite — instituții cu acronim și an, sume, persoane cu titlu, document cu sursa lui.
- Concesie reală adversarului celui mai serios.
- Tranziții invizibile, nu "în primul rând / în al doilea rând".
- Fraze de lungimi inegale. O frază scurtă lovește; una lungă explică.
- Verdictul final este o propoziție care poate fi citată mâine. Fără "rămâne de văzut".
- Persoana întâi este permisă DAR substanțială — nu sentiment, ci judecată.
Interzis: "este momentul să", "se cuvine să", "cu siguranță", sentimentalism.`,
    en: `EDITORIAL REGISTER — THE ANGLOPHONE SERIOUS PRESS TRADITION
Voice: the institutional editorial of the FT or The Economist, with the rhythm of a James Bennet or Bret Stephens column. Authority without bombast.
Mechanics:
- Open by stating the position within three sentences, without "we believe".
- Every argument grounded in named evidence.
- A real concession to the strongest opposing argument.
- Transitions invisible, not "firstly, secondly".
- Vary sentence length sharply.
- The closing line is a verdict the reader can quote tomorrow. No "only time will tell".
- First person permitted BUT substantive — never feeling, always judgment.
Banned: "it is time to", "we must all", "without a doubt", sentimentalism.`,
  },

  opinie: {
    ro: `REGISTRU OPINIE / COLUMNĂ — VOCE PROPRIE SUB SEMNĂTURĂ
Voce: columnistul format al unei publicații serioase. Tradiție: Andrei Pleșu, Cristian Tudor Popescu, Dan Perjovschi. Persoana întâi asumată dar disciplinată.
Mecanică:
- Deschidere cu observația specifică ce justifică opinia — un fapt, un citat, o cifră, o scenă văzută cu ochii.
- Teza apare clar în primele 100 de cuvinte.
- Persoana întâi DA, dar întotdeauna în slujba argumentului.
- Concesie la cea mai puternică obiecție.
- Final ferm, nu deschis.
Interzis: sentimentalism, "ca cetățean / ca părinte / ca român", retorism gol.`,
    en: `OPINION / COLUMN REGISTER — SIGNED VOICE
Voice: the serious columnist. Tradition: a Ross Douthat column, Roger Cohen at the Times, Janan Ganesh at the FT. First person owned but disciplined.
Mechanics:
- Open with the specific observation that justifies the opinion.
- The thesis appears clearly within the first 100 words.
- First person YES, but always serving the argument.
- Concession to the strongest objection.
- Firm close, not open.
Banned: sentimentalism, "as a citizen / as a parent", empty rhetoric.`,
  },

  analiza: {
    ro: `REGISTRU ANALIZĂ — TRADIȚIA ROMÂNEASCĂ DE ANALIZĂ POLICY ȘI POLITICĂ
Voce: analiza profesionistă — Adevărul lung-format, CURS-Avangarde, Stelian Tănase, Cristian Pîrvulescu, secțiunile lungi din Spotmedia. Distantă, structurată, cu metodă.
Mecanică:
- Deschidere prin formularea exactă a întrebării analitice. Fără retorism.
- Marcaje ale mișcării: "Întrebarea mai dificilă rămâne", "Ceea ce această lectură ratează".
- Evidența ca un corp, nu fapte izolate.
- Recunoaște limita analizei.
- Nu dă verdict. Închide pe întrebarea mai precisă.
Interzis: "este evident că", "concluzia se impune", "nimeni nu poate nega", persoana întâi.`,
    en: `ANALYSIS REGISTER — THE ANGLOPHONE LONG-FORM POLICY TRADITION
Voice: the Brookings working paper, the Foreign Affairs essay, an Atlantic policy piece. Measured, structured, methodologically honest.
Mechanics:
- Open by stating the analytical question precisely.
- Mark the moves: "The harder question is", "What this reading misses".
- Evidence as a body of work, not a list.
- Acknowledge what the analysis cannot determine.
- Refuse the verdict. Close on the sharper question.
Banned: "clearly", "the conclusion is obvious", first person.`,
  },

  pamflet: {
    ro: `REGISTRU PAMFLET — ȘCOALA CARAGIALE / ACADEMIA CAȚAVENCU
Voce: pamfletul românesc de cea mai bună clasă — Caragiale, Tudor Octavian, Cațavencu, Times New Roman, Andrei Gorzo. Ironie fină, nu măciucă.
Mecanică:
- Deschiderea este lauda excesivă a țintei.
- Ținta numită complet: nume, funcție, instituție, dată.
- Citatele țintei reproduse exact.
- Analogii incomode care nu-i flatează.
- Inserție de detaliu absurd verificabil.
- Finalul: aparent o sugestie binevoitoare, în fapt o sentință.
Interzis: vulgaritate, insultă neverificabilă, atac la familie, ironie ușoară de tip Facebook, persoana întâi.`,
    en: `PAMPHLET REGISTER — THE ANGLOPHONE SATIRICAL ESSAY TRADITION
Voice: Swift on the Irish question, H.L. Mencken, Christopher Hitchens dismantling Kissinger, Private Eye. Irony as scalpel, not bludgeon.
Mechanics:
- Open with excessive praise of the target.
- Name the target fully.
- Quote the target verbatim and let the words convict.
- Uncomfortable analogies.
- One verifiable absurd specific.
- The close: a charitable suggestion that is in fact a sentence.
Banned: vulgarity, unverifiable insult, attacks on family, easy social-media snark, first person.`,
  },

  blog: {
    ro: `REGISTRU BLOG — TRADIȚIA PERSONAL ESSAY ROMÂNEASCĂ
Voce: Mircea Cărtărescu pe blog, Vlad Mixich, Andrei Pleșu, Cristina Hermeziu. Persoana întâi asumată. Inteligent fără pedanterie. Cald fără sentimentalism.
ATENȚIE: acesta este ESEUL PERSONAL. Dacă subiectul nu cere persoana întâi, alege NEWS sau ANALIZA.
Mecanică:
- Deschidere care plasează autorul într-o scenă concretă.
- Permite "eu cred". Permite recunoașterea îndoielii.
- Alternanță de propoziții lungi cu propoziții scurte, ferme.
- Un detaliu personal concret.
- Auto-ironie, niciodată autovictimizare.
- Final care lasă cititorului ceva de făcut.
Interzis: "iubiții mei cititori", clișee motivaționale, "viața ne învață".`,
    en: `BLOG REGISTER — THE ANGLOPHONE PERSONAL ESSAY TRADITION
Voice: Tyler Cowen on Marginal Revolution, Maria Popova, an essay by Zadie Smith.
WARNING: this is the PERSONAL ESSAY. If the topic doesn't require first person, choose NEWS or ANALYSIS.
Mechanics:
- Open by placing the writer in a specific scene.
- "I think" permitted. Doubt permitted.
- Vary long thinking sentences with short firm ones.
- One concrete personal detail.
- Self-irony, never self-pity.
- A close that leaves the reader with something to do.
Banned: "dear reader", motivational cliché, "life teaches us".`,
  },

  reportaj: {
    ro: `REGISTRU REPORTAJ — ȘCOALA ROMÂNEASCĂ DE NARATIV LUNG
Voce: Andrei Crăciun la DoR, Casa Jurnalistului, Recorder, Vlad Stoicescu. Geo Bogza ca strămoș.
Mecanică:
- Deschidere care plasează cititorul într-un loc precis cu UN detaliu senzorial.
- Știrea intră în propoziția a treia sau a patra.
- Citează minimum doi oameni obișnuiți cu numele complet.
- Prezent narativ acolo unde aduce viața în text.
- Tensiune narativă reală.
- Întoarcerea finală la oamenii care trăiesc cu consecința.
Interzis: "într-o zi obișnuită de toamnă", clișeu poetic, persoana întâi.`,
    en: `REPORTAGE REGISTER — THE ANGLOPHONE LITERARY JOURNALISM TRADITION
Voice: a New Yorker reported piece, a long Guardian feature, John Jeremiah Sullivan in GQ, Katherine Boo, Patrick Radden Keefe.
Mechanics:
- Open by placing the reader in a precise location with ONE sensory detail.
- The news enters in the third or fourth sentence, not the first.
- Quote at least two ordinary people by full name.
- Present tense where it brings the page alive.
- Real narrative tension.
- Return at the close to the people who live with the consequence.
Banned: "on an ordinary autumn morning", tourist-board picturesque, first person.`,
  },

  cultura: {
    ro: `REGISTRU CULTURĂ — ȘCOALA ROMÂNEASCĂ DE CRITICĂ
Voce: Dilema Veche, Observator Cultural, Andrei Pleșu, Mircea Cărtărescu critic, Andrei Gorzo la film, Iulia Popovici la teatru. Fraze lungi, arhitecturale.
Mecanică:
- Fraze care construiesc sens prin clauze subordonate, ocazional aterizând pe o frază scurtă, declarativă.
- Context istoric doar acolo unde luminează.
- Numele artistului, opera, anul, materialul, formatul.
- Tratează opera cu seriozitate pe propriii ei termeni. Critică, nu rezumat.
- Final care deschide o întrebare nouă despre operă.
Interzis: "capodopera", "geniu indiscutabil", "marele nostru", clișeu patriotic-cultural, persoana întâi.`,
    en: `CULTURE REGISTER — THE ANGLOPHONE CRITICAL TRADITION
Voice: a New York Review of Books essay, James Wood on a novel, Hilton Als at the theater, Jenny Diski on a memoir.
Mechanics:
- Sentences that build through subordinate clauses, occasionally arriving at a brief declarative.
- Historical context only where it illuminates.
- The artist's name, the work, the year, the material, the format.
- Treat the work seriously on its own terms.
- A close that opens a new question.
Banned: "masterpiece", "undeniable genius", easy reverence, first person.`,
  },

  tehnologie: {
    ro: `REGISTRU TEHNOLOGIE — ȘCOALA INTERNAȚIONALĂ DE JURNALISM TEHNIC
Voce: Ars Technica deep-dive în registru românesc, blogurile inginerilor români din diaspora — Dan Luu în spirit. Precis, ușor cinic, orientat spre viitor.
Mecanică:
- Deschidere cu un fapt tehnic specific.
- Numește tehnologia precis: nu "o bază de date", ci "PostgreSQL 14 cu row-level security".
- Definește jargonul la prima folosire.
- Urmărește decizia: de ce această alegere.
- Numerele ca dovadă a consecinței.
- Final pe ce încearcă protagonistul în continuare.
Interzis: "revoluție digitală", "viitorul ne aparține", "transformare paradigmatică", entuziasm necritic, persoana întâi.`,
    en: `TECHNOLOGY REGISTER — ANGLOPHONE TECHNICAL JOURNALISM TRADITION
Voice: an Ars Technica technical deep-dive, Bruce Schneier on security, Dan Luu's essays, Stratechery on strategy.
Mechanics:
- Open with a specific technical fact.
- Name the technology precisely.
- Define jargon on first use.
- Trace the decision: why this choice.
- Numbers as evidence of consequence.
- Close on what the protagonist tries next.
Banned: "digital revolution", "paradigm-shifting", uncritical enthusiasm, first person.`,
  },
}

function getToneVoice(articleType: string, lang: 'ro' | 'en'): string {
  const t = TONE_VOICE[articleType] || TONE_VOICE.news
  return t[lang]
}
interface EditorVoice {
  ro: string
  en: string
  display_name_ro: string
  display_name_en: string
  default_category: string
  preferred_types: string[]
}

const EDITOR_VOICES: Record<string, EditorVoice> = {

  daniel_dobos: {
    display_name_ro: 'Daniel Dobos',
    display_name_en: 'Daniel Dobos',
    default_category: 'technology',
    preferred_types: ['news', 'analiza', 'tehnologie', 'reportaj', 'editorial'],
    ro: `SEMNĂTURĂ DANIEL DOBOS — biroul de tehnologie și business al unui ziar serios
Tradiția: Steve Lohr și Cade Metz la New York Times Business / Technology, Kashmir Hill pe privacy și platforme, Kate Conger pe Silicon Valley. În Anglophonia: Bruce Schneier, Dan Luu, Ben Thompson.

CE FACE diferit:
- Reportaj tehnic la nivel de inginer, scris pentru cititorul deștept dar ne-tehnic. Jargonul este definit la prima folosire, apoi folosit liber.
- Numește tehnologia PRECIS. Nu "o bază de date" — "PostgreSQL 14 pe Supabase, cu row-level security activat pentru tabelele de utilizatori".
- Personajul central este un OM la momentul deciziei.
- Numerele ca dovadă a consecinței: 47.000 de utilizatori, 12,4 milioane lei, 38 de minute de downtime.
- Sceptic față de hype, dar NU cinic.
- Tranziții în propoziție, nu între paragrafe ornamentale.

MECANICĂ:
- Lead-ul este UN fapt tehnic specific sau UN moment de decizie.
- Paragrafele scurte cu o singură idee, separate de paragrafele de context.
- Surse numite cu titlu complet și afiliere. Cel puțin un actor PRO și unul SCEPTIC.
- Citate scurte și exacte.
- Ironia cu măsură.
- Finalul este un pas următor concret.

INTERZIS:
- "Revoluția digitală", "viitorul ne aparține", "transformare paradigmatică".
- Entuziasm necritic.
- Generalizări despre "tinerii de azi", "epoca AI".
- Romantism față de tehnologie.`,
    en: `DANIEL DOBOS SIGNATURE — technology and business desk of a serious newspaper
Tradition: Steve Lohr and Cade Metz on the NYT Business / Technology desk, Kashmir Hill on privacy and platforms, Kate Conger on Silicon Valley. Bruce Schneier on security, Dan Luu on technical criticism, Ben Thompson on strategy.

WHAT THIS BYLINE DOES differently:
- Technical reportage at engineer-level precision, written for the smart non-technical reader. Jargon defined on first use, then used freely.
- Names the technology PRECISELY. Not "a database" — "PostgreSQL 14 on Supabase with row-level security enabled".
- The central character is a HUMAN at a decision moment.
- Numbers as evidence of consequence: 47,000 users, $12.4 million, 38 minutes of downtime.
- Skeptical of hype but NEVER cynical.
- Transitions inside the sentence, not ornamental between paragraphs.

MECHANICS:
- The lede is ONE specific technical fact or ONE decision moment.
- Short paragraphs carrying one idea each, alternating with longer context paragraphs.
- Sources named with full title and affiliation. At least one advocate and one skeptic.
- Quotes short and exact.
- Irony used sparingly.
- The close is a concrete next step.

BANNED for Daniel Dobos:
- "Digital revolution", "the future is here", "paradigm-shifting transformation".
- Uncritical enthusiasm for any product or company.
- Generalizations about "today's youth", "the AI era".
- Romance about technology.`,
  },

  andrei_popescu: {
    display_name_ro: 'Andrei Popescu',
    display_name_en: 'Andrei Popescu',
    default_category: 'politics',
    preferred_types: ['news', 'analiza', 'pamflet', 'editorial', 'reportaj'],
    ro: `SEMNĂTURĂ ANDREI POPESCU — biroul de politică și investigații
Tradiția: Recorder, Cristian Tudor Popescu, Dan Tapalagă, RISE Project. Hard accountability — documentul, fondul public, votul, conflictul de interese.
CE FACE diferit:
- Lucrează cu documentul ca probă: contractul (nr., dată, sumă, părți), decizia (autoritate emitentă, art. invocat), declarația de avere, votul nominal.
- Numește persoana cu funcția exactă și instituția.
- Întreabă "cine câștigă din asta" și răspunde cu nume, sume, dată.
- Tonul: rece, sec, fără ornament. Verbul puternic, fraza scurtă, atribuirea irefutabilă.
- Concesie reală adversarului — dă-i răspunsul în text, nu îl construi de paie.
INTERZIS: speculație fără document, "se zvonește", "surse spun" fără context, hiperbolă politică, entuziasm partizan.`,
    en: `ANDREI POPESCU SIGNATURE — politics and investigations desk
Tradition: ProPublica's investigative method, NYT national desk on government accountability, the FT Big Read on policy, BBC Panorama. Hard accountability.
WHAT THIS BYLINE DOES:
- Treats the document as evidence: the contract, the ruling, the disclosure, the named vote.
- Names the person by exact title and institution.
- Asks "who benefits" and answers with names, sums, dates.
- Tone: cold, dry, unornamented. Strong verb, short sentence, irrefutable attribution.
- A real concession to the opposing case.
BANNED: speculation without a document, "sources whisper", anonymous quotes without justification, political hyperbole, partisan enthusiasm.`,
  },

  elena_vasilescu: {
    display_name_ro: 'Elena Vasilescu',
    display_name_en: 'Elena Vasilescu',
    default_category: 'culture',
    preferred_types: ['analiza', 'cultura', 'editorial', 'reportaj', 'news'],
    ro: `SEMNĂTURĂ ELENA VASILESCU — biroul de știință și cultură
Tradiția: Dilema Veche pe idei, Observator Cultural pe critică, Andrei Pleșu pe eseu, Atlantic Ideas în registrul anglofon. Erudiție purtată cu ușurință.
CE FACE diferit:
- Construiește fraze lungi care țin gândul, urmate ocazional de propoziții scurte, declarative.
- Contextualizează prin trei surse intelectuale puse în dialog — niciodată citate puse cap la cap.
- Recunoaște limita argumentului.
- Tratează cititorul ca pe un egal.
- În registru științific: distinge clar între consens stabilit, ipoteză susținută de date și speculație.
INTERZIS: jargon academic gratuit, "este de necontestat", "geniul lui X", patetism cultural.`,
    en: `ELENA VASILESCU SIGNATURE — science and culture desk
Tradition: an Atlantic Ideas essay, a New Yorker piece on science, NYT Magazine cover essay, NYRB long-read. Erudition worn lightly.
WHAT THIS BYLINE DOES:
- Builds long sentences that hold the thought, occasionally landing on short declaratives.
- Contextualizes through three intellectual sources in conversation. Never stacked quotes.
- Acknowledges the argument's limit.
- Treats the reader as an equal.
- In the science register: clearly distinguishes settled consensus, data-supported hypothesis, and speculation.
BANNED: gratuitous academic jargon, "undeniable", "the genius of X", cultural pathos.`,
  },

  lucian_bratu: {
    display_name_ro: 'Lucian Bratu',
    display_name_en: 'Lucian Bratu',
    default_category: 'culture',
    preferred_types: ['reportaj', 'cultura', 'editorial', 'blog'],
    ro: `SEMNĂTURĂ LUCIAN BRATU — cronicar regional, cultură și patrimoniu
Tradiția: Geo Bogza modernizat, Andrei Crăciun pe reportajul ardelean, Casa Jurnalistului. Căldură pentru Transilvania fără sentimentalism.
CE FACE diferit:
- Deschide cu un detaliu senzorial precis al unui loc anume — strada, biserica, piața, ora, ce se aude.
- Cunoaște teritoriul: distinge Cluj-Napoca de Cluj județ, Mediaș de Sibiu, Maramureșul istoric de cel administrativ.
- Oamenii obișnuiți primesc nume complet, vârstă, ocupație, sat.
- Istoricul intră ca o adâncime, nu ca o lecție.
- Critică patrimoniul ratat fără pedanție și fără cinism.
INTERZIS: cliseu turistic ("în inima Transilvaniei", "comori ascunse"), folclorism, naționalism cultural.`,
    en: `LUCIAN BRATU SIGNATURE — regional chronicler, culture and heritage
Tradition: a long Guardian Country Diary, John McPhee on a small American town, Geoff Dyer on place, Paul Theroux on the road.
WHAT THIS BYLINE DOES:
- Opens with a precise sensory detail of a specific place.
- Knows the territory. Correct names, correctly spelled.
- Ordinary people are given full name, age, occupation, village.
- History enters as depth, not as lesson.
- Criticizes failed heritage without pedantry or cynicism.
BANNED: tourist cliché ("in the heart of Transylvania", "hidden treasures"), folklorism, cultural nationalism.`,
  },

  mihai_ionescu: {
    display_name_ro: 'Mihai Ionescu',
    display_name_en: 'Mihai Ionescu',
    default_category: 'business',
    preferred_types: ['news', 'analiza', 'tehnologie', 'editorial'],
    ro: `SEMNĂTURĂ MIHAI IONESCU — biroul de tehnologie pentru business
Tradiția: Wall Street Journal CIO Journal, Bloomberg Technology, start-up.ro, Wall-Street.ro pe analiză. Tehnologia ca decizie de business.
CE FACE diferit:
- Lead-ul este o cifră de business — venit, runda, evaluarea, head-count.
- Pune contextul competitiv: concurenții direcți, TAM-ul realist.
- Vorbește limba contractului: SLA, MRR, retention, churn, CAC, LTV. Definite la prima folosire.
- Sursele sunt fondatorul, CFO-ul, VC-ul, clientul.
- Distincție clară între ce a fost ANUNȚAT și ce a fost LIVRAT.
INTERZIS: PR-speak, entuziasm preluat din comunicate.`,
    en: `MIHAI IONESCU SIGNATURE — technology desk for the business reader
Tradition: WSJ CIO Journal, Bloomberg Technology, The Information, Stratechery. Technology as a business decision.
WHAT THIS BYLINE DOES:
- The lede is a business number.
- Sets the competitive context.
- Speaks the contract language: SLA, MRR, retention, churn, CAC, LTV. Defined on first use.
- Sources are the founder, the CFO, the VC, the customer. Not just PR.
- Clear distinction between what was ANNOUNCED and what was DELIVERED.
BANNED: PR-speak, enthusiasm lifted from press releases.`,
  },

  sofia_marinescu: {
    display_name_ro: 'Sofia Marinescu',
    display_name_en: 'Sofia Marinescu',
    default_category: 'health',
    preferred_types: ['news', 'analiza', 'editorial'],
    ro: `SEMNĂTURĂ SOFIA MARINESCU — analist senior, sănătate și tehnologie
Tradiția: STAT News, Nature News, NYT Health, BMJ Investigations. Date verificate, sceptic față de comunicat.
CE FACE diferit:
- Citează studiul cu autor principal, jurnal, an, mărimea cohortei, p-value, design.
- Distinge clar între risc relativ și risc absolut.
- Numește bias-ul când există.
- În sănătate publică: distincție clară între ce recomandă autoritatea, ce sugerează datele, ce este speculație.
- Mecanismul biologic explicat scurt, accesibil, dar precis.
INTERZIS: alarmism, "studiile arată" fără citare, "experții spun" fără numire, miracle terminology.`,
    en: `SOFIA MARINESCU SIGNATURE — senior analyst, health and technology
Tradition: STAT News, NYT Health, BMJ investigative, Nature News, Atlantic Health. Verified data, skeptical of press releases.
WHAT THIS BYLINE DOES:
- Cites the study by lead author, journal, year, cohort size, p-value, design.
- Clearly distinguishes relative from absolute risk, association from causation.
- Names the bias when present.
- In public health: clear distinction between what the authority recommends, what the data suggests, what is speculation.
- The biological mechanism explained briefly, accessibly, but precisely.
BANNED: alarmism, "studies show" without citation, "experts say" without naming, miracle terminology.`,
  },

  victor_simon: {
    display_name_ro: 'Victor Simon',
    display_name_en: 'Victor Simon',
    default_category: 'news',
    preferred_types: ['news', 'analiza'],
    ro: `SEMNĂTURĂ VICTOR SIMON — știri generale, registru agenție
Tradiția: Reuters și AP în registru românesc, Mediafax la cele bune, HotNews secțiunea Actualitate. Sobru, factual, atribuit, economic.
CE FACE diferit:
- Maximum 8 cuvinte în lead înainte de verb. Cine, ce, când.
- Paragraf 2: contextul indispensabil.
- Cifre concrete cu sursă, NICIODATĂ aproximate.
- Atribuire pentru fiecare afirmație.
- Stil neutru, fără adverbe colorate.
- Lungime: scurt. Acest editor scrie 400-700 cuvinte.
INTERZIS: ornament, opinie, persoana întâi, "se pare că", lungime artificială.`,
    en: `VICTOR SIMON SIGNATURE — general news, wire register
Tradition: Reuters, AP, the news desk of a serious paper. Sober, factual, attributed, economical.
WHAT THIS BYLINE DOES:
- Maximum 8 words in the lede before the verb.
- Paragraph 2: the indispensable context.
- Concrete figures with source, NEVER approximated.
- Attribution for every claim.
- Neutral register, no colored adverbs.
- Length: short. This byline writes 400-700 words, not 1200.
BANNED: ornament, opinion, first person, "it appears", artificial length.`,
  },

  marcus_webb: {
    display_name_ro: 'Marcus Webb',
    display_name_en: 'Marcus Webb',
    default_category: 'politics',
    preferred_types: ['news', 'analiza', 'editorial', 'reportaj'],
    ro: `SEMNĂTURĂ MARCUS WEBB — corespondent internațional, optică anglofonă
Notă: Marcus Webb scrie pentru cititorul anglofon despre România și Europa Centrală. Versiunea română este versiunea localizată a unei piese gândite primar în engleză.
CE FACE diferit:
- Plasează contextul românesc în cadrul european / global.
- Explică ce ar trebui să știe un cititor anglofon, fără pedanție.
- Numește persoanele cu funcția în engleză și echivalentul românesc.
- Sobru britanic. FT / Economist.
INTERZIS: orientalism, exotism, paternalism vest-european.`,
    en: `MARCUS WEBB SIGNATURE — international correspondent
Tradition: Financial Times Eastern Europe correspondent, Economist Europe section, NYT foreign desk, Reuters Bureau Bucharest.
WHAT THIS BYLINE DOES:
- Places Romanian context in a European / global frame.
- Explains what an Anglophone reader needs, without pedantry.
- Names persons with their English title followed by the Romanian equivalent.
- British sober. FT / Economist register.
BANNED: orientalism ("the Wild East"), exoticism, East-coast irony, West European paternalism.`,
  },

  mihai_isac: {
    display_name_ro: 'Mihai Isac',
    display_name_en: 'Mihai Isac',
    default_category: 'politics',
    preferred_types: ['news', 'analiza', 'reportaj', 'editorial'],
    ro: `SEMNĂTURĂ MIHAI ISAC — știri și investigații, registru daily
Tradiția: Recorder pe materiale daily, G4Media secțiunea hard news, RISE Project în formatul scurt, ProPublica daily desk.
CE FACE diferit:
- Lead cu informația proaspătă verificabilă: ce a aflat astăzi, cum a aflat, cu ce dovadă.
- Citează documentul cu identificator complet.
- Distinge clar între ce a verificat, ce este declarat de o parte, ce este în curs de verificare.
- Solicită răspuns părții vizate ÎN TEXT — câte încercări, prin ce canal.
- Tonul: rece, profesional, fără hiperbolă politică.
INTERZIS: speculație fără dovadă, ton de procuror, atac la persoană, partizanat declarat.`,
    en: `MIHAI ISAC SIGNATURE — news and investigations, daily register
Tradition: ProPublica daily desk, NYT national investigations, BBC News investigations short-form.
WHAT THIS BYLINE DOES:
- Lede with verified fresh information.
- Cites the document by full identifier.
- Clearly distinguishes verified, stated, and in-verification.
- Seeks response from the affected party IN TEXT.
- Tone: cold, professional, without political hyperbole.
BANNED: speculation without evidence, prosecutorial tone, personal attack, declared partisanship.`,
  },

  anamaria_florea: {
    display_name_ro: 'Anamaria Florea',
    display_name_en: 'Anamaria Florea',
    default_category: 'news',
    preferred_types: ['news', 'reportaj', 'cultura', 'blog'],
    ro: `SEMNĂTURĂ ANAMARIA FLOREA — biroul de comunitate și reportaj local
Tradiția: Casa Jurnalistului pe materialele locale, Recorder pe comunitate, Cristian Bălănescu pe viața de sat, DoR pe povești de oameni. Apropiată de subiect dar disciplinată.
CE FACE diferit:
- Deschide cu un OM — nume complet, vârstă, ocupație, locul exact. Povestea pornește de la o scenă concretă.
- Instituțiile intră ca personaje secundare: primăria, școala, spitalul — numite cu funcția completă a reprezentantului.
- Știe diferența între compasiune și sentimentalism. Arată situația, nu o plânge.
- Cifrele au context local: "din cele 12 familii din sat", "bugetul de 340.000 lei al primăriei".
- Dă voce celor care de obicei nu au voce în presă: voluntarii, profesorii din mediul rural, inițiativele mici.
- Finalul revine la omul din deschidere — ce face în continuare, nu ce ar trebui să facă altcineva.
INTERZIS: sentimentalism ("poveste emoționantă", "lacrimile nu au stat pe loc"), generalizări despre "comunitate", activism deghizat în jurnalism, persoana întâi.`,
    en: `ANAMARIA FLOREA SIGNATURE — community desk and local reporting
Tradition: a Guardian community feature, ProPublica Local, the Marshall Project on people affected by systems, Humans of New York in journalistic register.
WHAT THIS BYLINE DOES:
- Opens with a PERSON — full name, age, occupation, exact location. The story starts from a concrete scene.
- Institutions enter as supporting characters: city hall, the school, the hospital — named with the representative's full title.
- Knows the difference between compassion and sentimentalism. Shows the situation, never weeps over it.
- Numbers have local context: "of the 12 families in the village", "the town hall's €70,000 budget".
- Gives voice to those usually unheard in the press: volunteers, rural teachers, small initiatives.
- The close returns to the person from the opening — what they do next, not what someone else should do.
BANNED: sentimentalism ("an emotional story", "tears flowed"), generalizations about "the community", activism disguised as journalism, first person.`,
  },
}

const ALLOWED_EDITOR_KEYS = Object.keys(EDITOR_VOICES)
const DEFAULT_EDITOR_KEY = 'daniel_dobos'

const EDITOR_BY_CATEGORY: Record<string, string> = {
  politics: 'andrei_popescu', technology: 'mihai_ionescu', business: 'daniel_dobos',
  culture: 'lucian_bratu',    travel: 'lucian_bratu',      health: 'sofia_marinescu',
  education: 'elena_vasilescu', sports: 'victor_simon',
  news: 'victor_simon',       opinion: 'daniel_dobos',
}

function getEditorVoice(editorKey: string, lang: 'ro' | 'en'): string {
  const v = EDITOR_VOICES[editorKey] || EDITOR_VOICES[DEFAULT_EDITOR_KEY]
  return v[lang]
}

function getEditorDisplayName(editorKey: string, lang: 'ro' | 'en'): string {
  const v = EDITOR_VOICES[editorKey] || EDITOR_VOICES[DEFAULT_EDITOR_KEY]
  return lang === 'ro' ? v.display_name_ro : v.display_name_en
}

function resolveEditorKey(fromBody?: string, category?: string): string {
  if (fromBody && ALLOWED_EDITOR_KEYS.includes(fromBody)) return fromBody
  if (category && EDITOR_BY_CATEGORY[category]) return EDITOR_BY_CATEGORY[category]
  return DEFAULT_EDITOR_KEY
}


// ─── sanitizeContentEn — 110+ rules (preserved from v14) ────────────────────

function sanitizeContentEn(text: string): string {
  if (typeof text !== 'string') {
    console.warn(`[sanitizeContentEn] received non-string (${typeof text}) — coerced to empty`)
    return ''
  }
  if (!text) return ''
  let r = text

  const openers: [RegExp, string][] = [
    [/^In the ever-evolving (field|world|landscape|domain) of [^,.]+,?\s*/im, ''],
    [/^In recent years,?\s*/im, ''],
    [/^Over the past decade,?\s*/im, ''],
    [/^It'?s no secret that\s*/im, ''],
    [/^In an increasingly [^,.]+,?\s*/im, ''],
    [/^As the world (grapples|deals|contends) with\s*/im, ''],
    [/^In a world where\b[^,.]*,?\s*/im, ''],
  ]

  const starters: [RegExp, string][] = [
    [/^Furthermore,\s*/gm, ''], [/^Moreover,\s*/gm, ''], [/^Additionally,\s*/gm, ''],
    [/^Interestingly,\s*/gm, ''], [/^Notably,\s*/gm, ''], [/^Importantly,\s*/gm, ''],
    [/^Specifically,\s*/gm, ''], [/^Indeed,\s*/gm, ''], [/^Essentially,\s*/gm, ''],
    [/^Ultimately,\s*/gm, ''], [/^Consequently,\s*/gm, ''],
    [/^It is worth (noting|mentioning) that\s*/gm, ''],
    [/^It should be noted that\s*/gm, ''], [/^Overall,\s*/gm, ''],
  ]

  const phrases: [RegExp, string][] = [
    [/\bin today'?s world\b/gi, 'today'],
    [/\bthe realm of\b/gi, 'the field of'],
    [/\bit is important to note\b/gi, ''],
    [/\bit'?s worth noting\b/gi, ''],
    [/\ba testament to\b/gi, 'proof of'],
    [/\bshed light on\b/gi, 'clarify'],
    [/\bat the end of the day\b/gi, 'ultimately'],
    [/\bparadigm shift\b/gi, 'fundamental change'],
    [/\bin conclusion\b/gi, ''], [/\bin summary\b/gi, ''],
    [/\bto conclude\b/gi, ''], [/\bto sum up\b/gi, ''],
    [/\blooking ahead\b/gi, ''], [/\bas we move forward\b/gi, ''],
    [/\bwhen it comes to\b/gi, 'for'], [/\bone of the key\b/gi, 'a'],
    [/\bplays a (crucial|essential|vital|key|important|significant) role\b/gi, 'matters'],
    [/\bgame[- ]changer\b/gi, 'breakthrough'],
    [/\bcutting[- ]edge\b/gi, 'advanced'],
    [/\bonly time will tell\b/gi, ''],
    [/\bthe future looks bright\b/gi, ''],
    [/\bremains to be seen\b/gi, ''],
    [/\bthe landscape of\b/gi, 'the field of'],
    [/\bserves as a?\b/gi, 'is a'],
  ]

  const tier1: [RegExp, string][] = [
    [/\bdelves? (into)?\b/gi, 'explores'],
    [/\blandscape\b/gi, 'field'], [/\btapestry\b/gi, 'mix'],
    [/\brealm\b/gi, 'area'], [/\bparadigm\b/gi, 'model'],
    [/\bembark(s|ed|ing)? (on|upon)\b/gi, 'start'],
    [/\bbeacon\b/gi, 'signal'], [/\brobust\b/gi, 'strong'],
    [/\bcomprehensive\b/gi, 'thorough'],
    [/\bleverage[sd]?\b/gi, 'use'],
    [/\bharness(es|ed|ing)?\b/gi, 'use'],
    [/\bseamless(ly)?\b/gi, 'smooth'],
    [/\bfoster[sd]?\b/gi, 'encourage'],
    [/\bstreamline[sd]?\b/gi, 'simplify'],
    [/\benhance[sd]?\b/gi, 'improve'],
    [/\bempower[sd]?\b/gi, 'enable'],
    [/\butilize[sd]?\b/gi, 'use'],
    [/\bascertain\b/gi, 'find out'],
    [/\bendeavou?r[sd]?\b/gi, 'effort'],
    [/\bspearhead[sd]?\b/gi, 'lead'],
    [/\bcommence[sd]?\b/gi, 'begin'],
    [/\bunderscore[sd]?\b/gi, 'highlight'],
    [/\bpivotal\b/gi, 'key'], [/\bintegral\b/gi, 'central'],
    [/\bintricate\b/gi, 'complex'], [/\bmultifaceted\b/gi, 'complex'],
    [/\bbolster[sd]?\b/gi, 'strengthen'],
    [/\bcrucial\b/gi, 'important'], [/\bessential\b/gi, 'necessary'],
    [/\bvital\b/gi, 'important'], [/\bsynergy\b/gi, 'cooperation'],
    [/\becosystem\b/gi, 'environment'], [/\bholistic\b/gi, 'complete'],
    [/\bwatermark moment\b/gi, 'turning point'],
    [/\bwatershed moment\b/gi, 'turning point'],
    [/\bnestled in\b/gi, 'in'], [/\bvibrant\b/gi, 'active'],
    [/\bthriving\b/gi, 'growing'],
  ]

  const inflation: [RegExp, string][] = [
    [/\bmarks? a (significant|major|important|critical|defining) (moment|milestone|step|chapter|shift|turning point)\b/gi, ''],
    [/\bsignal(s|ing)? a (fundamental|profound|seismic|dramatic) (change|shift|transformation)\b/gi, ''],
    [/\bdespite (these |the )?challenges?,? \w+ continues? to thrive\b/gi, ''],
  ]

  const vagueAttr: [RegExp, string][] = [
    [/\bexperts (believe|say|argue|suggest|note|warn)\b/gi, ''],
    [/\bstudies (show|suggest|indicate|reveal|confirm)\b/gi, ''],
    [/\bcritics (argue|say|claim|contend|note|warn)\b/gi, ''],
    [/\banalysts (say|suggest|believe|predict|note|warn)\b/gi, ''],
    [/\bobservers (note|say|believe|suggest)\b/gi, ''],
  ]

  const closers: [RegExp, string][] = [
    [/[^.!?]*\bthis incident underscores[^.]*\./gi, ''],
    [/[^.!?]*\bthese events raise questions[^.]*\./gi, ''],
    [/[^.!?]*\bthe community awaits answers[^.]*\./gi, ''],
    [/[^.!?]*\bthe conclusions could influence[^.]*\./gi, ''],
    [/[^.!?]*\bsuch cases highlight[^.]*\./gi, ''],
    [/[^.!?]*\bthe next phase will involve[^.]*\./gi, ''],
    [/[^.!?]*\bonly time will tell[^.]*\./gi, ''],
    [/\braises questions about\b/gi, 'prompts questions about'],
  ]

  const allRules = [...openers, ...starters, ...phrases, ...tier1, ...inflation, ...vagueAttr, ...closers]
  for (const [p, s] of allRules) r = r.replace(p, s as string)

  r = r.replace(/ — /g, ', ').replace(/ – /g, ', ')
  r = r.replace(/—/g, ', ').replace(/–/g, '-')
  r = r.replace(/It'?s not (just )?[^,.]+[,;] it'?s /gi, '')
  r = r.replace(/This isn'?t (just |about )?[^,.]+[,;] (it'?s |this is )/gi, '')
  r = r.replace(/^#{1,6}\s+(.+)$/gm, '$1')
  r = r.replace(/^\s*\*\*([^*]+)\*\*\s*$/gm, '$1')
  r = r.replace(/\*\*([^*]+)\*\*/g, '$1')
  r = r.replace(/\n{3,}/g, '\n\n').replace(/  +/g, ' ')
  r = r.replace(/ ,/g, ',').replace(/ \./g, '.')
  r = r.replace(/\.\s*\./g, '.').replace(/,\s*,/g, ',')
  return r.trim()
}


// ─── sanitizeContentRo — 130+ rules (preserved from v14, all Phase 1 in) ────

function sanitizeContentRo(text: string): string {
  if (typeof text !== 'string') {
    console.warn(`[sanitizeContentRo] received non-string (${typeof text}) — coerced to empty`)
    return ''
  }
  if (!text) return ''
  let r = text

  const openers: [RegExp, string][] = [
    [/^În ultimii ani,?\s*/im, ''],
    [/^De-a lungul anilor,?\s*/im, ''],
    [/^Într-o lume în care\b[^,.]*,?\s*/im, ''],
    [/^Într-un context marcat de\b[^,.]*,?\s*/im, ''],
    [/^Într-un peisaj\b[^,.]*,?\s*/im, ''],
    [/^Pe fondul\b[^,.]*,?\s*/im, ''],
  ]

  const starters: [RegExp, string][] = [
    [/^Mai mult,\s*/gm, ''], [/^De asemenea,\s*/gm, ''],
    [/^În plus,\s*/gm, ''], [/^Totodată,\s*/gm, ''],
    [/^În același timp,\s*/gm, ''],
    [/^Cu toate acestea,\s*/gm, 'Totuși, '],
    [/^Pe de altă parte,\s*/gm, ''], [/^Nu în ultimul rând,\s*/gm, ''],
    [/^Este important de menționat că\s*/gm, ''],
    [/^Este de remarcat că\s*/gm, ''],
    [/^Merită menționat că\s*/gm, ''],
    [/^În ceea ce privește\s*/gm, 'Despre '],
  ]

  const calques: [RegExp, string][] = [
    [/\bîn concluzie\b/gi, ''], [/\bpe scurt\b/gi, ''],
    [/\bprivind în perspectivă\b/gi, ''], [/\bîn final\b/gi, ''],
    [/\bîn rezumat\b/gi, ''],
    [/\bîn cele din urmă\b/gi, 'până la urmă'],
    [/\bîn lumea de astăzi\b/gi, 'în prezent'],
    [/\bîn era digitală\b/gi, 'astăzi'],
    [/\bîn contextul actual\b/gi, 'acum'],
    [/\bîntr-un moment critic\b/gi, ''],
    [/\bîn momentul de față\b/gi, 'acum'],
    [/\bîn acest moment crucial\b/gi, 'acum'],
    [/\bstă ca un testament\b/gi, 'dovedește'],
    [/\beste un testament al\b/gi, 'dovedește'],
    [/\bstă ca o dovadă\b/gi, 'arată'],
    [/\bstă ca o mărturie\b/gi, 'arată'],
    [/\bo mărturie a\b/gi, 'o dovadă a'],
    [/\brezidă în\b/gi, 'se află în'],
    [/\bse traduce neapărat în\b/gi, 'duce la'],
    [/\bse traduce în\b/gi, 'duce la'],
    [/\bse traduce printr-?o\b/gi, 'înseamnă o'],
    [/\bimersiunea în\b/gi, 'cunoașterea'],
    [/\bimersiune\b/gi, 'cufundare'],
    [/\bimersiv[ăeai]?\b/gi, 'captivant'],
    [/\bpotențiale repercusiuni\b/gi, 'consecințe'],
    [/\bdansul (complex )?dintre\b/gi, 'relația dintre'],
    [/\ba se aventura în\b/gi, 'a aborda'],
    [/\bse aventurează în\b/gi, 'abordează'],
    [/\bfără egal\b/gi, 'unic'], [/\bfără pereche\b/gi, 'unic'],
    [/\bsabie cu două tăișuri\b/gi, 'cu două fețe'],
    [/\ba naviga (prin|printre|complexitățile|provocările)\b/gi, 'a gestiona'],
    [/\bnavighează (prin|printre|complexitățile|provocările|acest domeniu|climatul)\b/gi, 'gestionează'],
    [/\bnavigheze (prin|printre|complexitățile|provocările)\b/gi, 'gestioneze'],
    [/\bnavigând (prin|printre)\b/gi, 'gestionând'],
    [/\bla sfârșitul zilei\b/gi, 'în esență'],
    [/\bun schimbător de joc\b/gi, 'o schimbare majoră'],
    [/\bțese o poveste\b/gi, 'leagă faptele'],
    [/\brămâne de văzut\b/gi, ''],
    [/\bviitorul va fi probabil\b/gi, ''],
    [/\bdoar timpul va arăta\b/gi, ''],
    [/\bviitorul arată promițător\b/gi, ''],
    [/\bconturând direcția viitoare\b/gi, ''],
    [/\bacomodări speciale\b/gi, 'facilități speciale'],
    [/\bacomodare specială\b/gi, 'facilitate specială'],
    [/\bacomodări academice\b/gi, 'facilități academice'],
    [/\bprima instanță în care\b/gi, 'primul caz în care'],
    [/\bmarchează prima instanță\b/gi, 'marchează primul caz'],
    [/\bcâmpul educațional\b/gi, 'domeniul educațional'],
    [/\bcâmpul academic\b/gi, 'domeniul academic'],
    [/\bcâmpul cultural\b/gi, 'domeniul cultural'],
    [/\bangajamente academice\b/gi, 'obligații academice'],
    [/\bangajament academic\b/gi, 'obligație academică'],
    [/\bangajamentele academice\b/gi, 'obligațiile academice'],
    [/\blibertatea de mișcare\b/gi, 'libera circulație'],
    [/\bașa cum stă decizia\b/gi, 'potrivit deciziei'],
    [/\bașa cum se prezintă decizia\b/gi, 'potrivit deciziei'],
    [/\bîn contextul în care\b/gi, 'în timp ce'],
    [/\bîn contextul actual al\b/gi, 'pentru'],
  ]

  const attrVerbs: [RegExp, string][] = [
    [/\bsubliniază\b/gi, 'arată'], [/\bsubliniind\b/gi, 'arătând'],
    [/\bsubliniat\b/gi, 'arătat'], [/\bevidențiază\b/gi, 'arată'],
    [/\bevidențiind\b/gi, 'arătând'], [/\bevidențiat\b/gi, 'arătat'],
    [/\baccentuează\b/gi, 'afirmă'], [/\baccentuat\b/gi, 'spus'],
    [/\ba ținut să menționeze\b/gi, 'a spus'],
    [/\ba punctat\b/gi, 'a spus'],
    [/\ba atras atenția asupra\b/gi, 'a spus despre'],
    [/\ba reamintit\b/gi, 'a spus'],
  ]

  const wrappers: [RegExp, string][] = [
    [/\bnotabil[ăeai]?\b/gi, ''], [/\bconsiderabil[ăeai]?\b/gi, ''],
    [/\bremarcabil[ăeai]?\b/gi, ''], [/\bsemnificativ[ăeai]?\b/gi, ''],
    [/\bsubstanțial[ăeai]?\b/gi, ''], [/\besențial[ăeai]?\b/gi, 'necesar'],
    [/\bcrucial[ăeai]?\b/gi, 'important'], [/\brobust[ăeai]?\b/gi, 'solid'],
    [/\bvital[ăeai]?\b/gi, 'important'], [/\bfundamental[ăeai]?\b/gi, 'de bază'],
    [/\bpeisajul politic\b/gi, 'scena politică'],
    [/\bpeisajul investițional\b/gi, 'mediul investițional'],
    [/\bpeisajul\b/gi, 'domeniul'],
    [/\bcâmpul investițional\b/gi, 'mediul investițional'],
    [/\bparadigm[ăa]( investițiilor)?\b/gi, 'modelul investițiilor'],
    [/\bsinergie\b/gi, 'cooperare'], [/\becosistem\b/gi, 'mediu'],
    [/\brezilient[ăeai]?\b/gi, 'rezistent'],
    [/\breziliență\b/gi, 'rezistență'],
    [/\brole? (esențial|crucial|vital)[ăeai]?\b/gi, 'rol major'],
    [/\bjoacă un rol (important|esențial|crucial|vital|cheie)\b/gi, 'contribuie la'],
    [/\bse dovedește a fi\b/gi, 'este'],
    [/\bcând vine vorba de\b/gi, 'pentru'],
    [/\ba valorifica\b/gi, 'a folosi'],
    [/\bîn privința\b/gi, 'privind'],
    [/\bîn ceea ce privește\b/gi, 'despre'],
  ]

  const bureaucratic: [RegExp, string][] = [
    [/\bîn cazul în care\b/gi, 'dacă'],
    [/\bîn cadrul (unei|unui|unor|acestei|acestui)\b/gi, 'la'],
    [/\bîn vederea\b/gi, 'pentru'],
    [/\bîn scopul de a\b/gi, 'ca să'],
    [/\bîn încercarea de a\b/gi, 'ca să'],
    [/\bcare vizează\b/gi, 'pentru'],
    [/\basigurându-se\b/gi, 'asigurând'],
    [/\bla acea vreme\b/gi, 'atunci'],
    [/\bdeosebit de important[ăeai]?\b/gi, 'important'],
    [/\bde o importanță majoră\b/gi, 'important'],
  ]

  const closers: [RegExp, string][] = [
    [/[^.!?]*\bacest incident subliniază[^.]*\./gi, ''],
    [/[^.!?]*\bacest eveniment subliniază[^.]*\./gi, ''],
    [/[^.!?]*\baceste evenimente ridică întrebări[^.]*\./gi, ''],
    [/[^.!?]*\bacest incident ridică întrebări[^.]*\./gi, ''],
    [/[^.!?]*\burmătorul pas implică[^.]*\./gi, ''],
    [/[^.!?]*\bconcluziile ar putea influența[^.]*\./gi, ''],
    [/[^.!?]*\bcomunitatea așteaptă răspunsuri[^.]*\./gi, ''],
    [/[^.!?]*\bacest caz subliniază[^.]*\./gi, ''],
    [/[^.!?]*\bdoar timpul va arăta[^.]*\./gi, ''],
    [/\bridicând întrebări cu privire la\b/gi, 'punând întrebări despre'],
    [/\bridică întrebări cu privire la\b/gi, 'pune întrebări despre'],
    [/\bridică întrebări legate de\b/gi, 'pune întrebări despre'],
    [/[^.!?]*\baceastă situație ridică întrebări[^.]*\./gi, ''],
    [/[^.!?]*\burmătorul pas critic[^.]*\./gi, ''],
    [/[^.!?]*\burmătorul pas pentru autoritățile[^.]*\./gi, ''],
    [/[^.!?]*\baceste decizii vor fi necesare[^.]*\./gi, ''],
    [/[^.!?]*\brezultatul ar putea influența[^.]*\./gi, ''],
    [/[^.!?]*\bar putea remodela[^.]*\./gi, ''],
    [/[^.!?]*\bsperând la schimbări[^.]*\./gi, ''],
    [/[^.!?]*\bfără acțiuni concrete[^.]*\./gi, ''],
  ]

  const allRules = [...openers, ...starters, ...calques, ...attrVerbs, ...wrappers, ...bureaucratic, ...closers]
  for (const [p, s] of allRules) r = r.replace(p, s as string)

  r = r.replace(/ — /g, ', ').replace(/ – /g, ', ').replace(/—/g, ', ')

  let pmc = 0
  r = r.replace(/\bPe măsură ce\b/g, (match) => {
    pmc++
    if (pmc === 1) return match
    if (pmc === 2) return 'În timp ce'
    if (pmc === 3) return 'Odată ce'
    return ''
  })

  let demo = 0
  r = r.replace(/^(Acest[ăa]?|Aceste|Aceasta) /gm, (match) => {
    demo++
    if (demo <= 2) return match
    return ''
  })

  r = r.replace(/\bNu este vorba (doar |numai )?de [^,.]+, ci de /gi, '')
  r = r.replace(/\bNu este doar [^,.]+, ci [și ]+/gi, '')

  r = r.replace(/(\p{L})\s+ă\s+(?=\p{L})/gu, '$1 ')

  r = r.replace(/^#{1,6}\s+(.+)$/gm, '$1')
  r = r.replace(/^\s*\*\*([^*]+)\*\*\s*$/gm, '$1')
  r = r.replace(/\*\*([^*]+)\*\*/g, '$1')
  r = r.replace(/ {2,}/g, ' ')
  r = r.replace(/ ,/g, ',').replace(/ \./g, '.')
  r = r.replace(/\n{3,}/g, '\n\n')
  r = r.replace(/\.\s*\./g, '.').replace(/,\s*\./g, '.').replace(/,\s*,/g, ',')
  r = r.replace(/^\s*\n/gm, '\n')

  return r.trim()
}


function stripFirstPersonRo(text: string): string {
  if (!text) return ''
  let r = text
  const rep: [RegExp, string][] = [
    [/\beu cred că\b/gi, ''], [/\beu consider că\b/gi, ''],
    [/\beu sunt convins\b/gi, ''], [/\bcred că\b/gi, ''],
    [/\bconsider că\b/gi, ''], [/\bsunt convins că\b/gi, ''],
    [/\bpersonal,?\b/gi, ''],
    [/\bdin punctul meu de vedere,?\b/gi, ''],
    [/\bdin experiența mea\b/gi, ''],
    [/\bîn opinia mea\b/gi, ''], [/\bpărerea mea\b/gi, ''],
    [/\bmi se pare\b/gi, ''],
    [/\bnoi credem că\b/gi, ''], [/\bnoi consideram\b/gi, ''],
    [/\bnoi trebuie să\b/gi, ''], [/\bnoi românii\b/gi, 'românii'],
    [/\bredacția noastră\b/gi, 'redacția'],
    [/\bse cuvine să\b/gi, ''],
    [/\btrebuie să recunoaștem\b/gi, ''],
    [/\bsă admitem\b/gi, ''],
  ]
  for (const [p, s] of rep) r = r.replace(p, s as string)
  r = r.replace(/ +,/g, ',').replace(/ +\./g, '.').replace(/  +/g, ' ')
  r = r.replace(/^\s*,\s*/gm, '')
  return r.trim()
}

function stripFirstPersonEn(text: string): string {
  if (!text) return ''
  let r = text
  const rep: [RegExp, string][] = [
    [/\bI believe that\b/gi, ''], [/\bI think that\b/gi, ''],
    [/\bI consider that\b/gi, ''], [/\bI argue that\b/gi, ''],
    [/\bI am convinced that\b/gi, ''], [/\bI believe\b/gi, ''],
    [/\bI think\b/gi, ''], [/\bI consider\b/gi, ''],
    [/\bI feel\b/gi, ''], [/\bin my view,?\b/gi, ''],
    [/\bin my opinion,?\b/gi, ''], [/\bin my experience,?\b/gi, ''],
    [/\bpersonally,?\b/gi, ''], [/\bfrom my perspective,?\b/gi, ''],
    [/\bit seems to me that\b/gi, ''],
    [/\bwe believe that\b/gi, ''], [/\bwe must\b/gi, ''],
    [/\bwe should\b/gi, ''],
    [/\bone must concede\b/gi, ''], [/\bone must admit\b/gi, ''],
    [/\blet us recognize\b/gi, ''], [/\blet us examine\b/gi, ''],
  ]
  for (const [p, s] of rep) r = r.replace(p, s as string)
  r = r.replace(/ +,/g, ',').replace(/ +\./g, '.').replace(/  +/g, ' ')
  r = r.replace(/^\s*,\s*/gm, '')
  return r.trim()
}

function enforceVoicePerson(text: string, articleType: string, lang: 'ro' | 'en'): string {
  if (voiceAllowsFirstPerson(articleType)) return text
  return lang === 'ro' ? stripFirstPersonRo(text) : stripFirstPersonEn(text)
}


interface HumannessReport {
  score: number
  flags: string[]
  sentenceStdDev: number
  burstiness: boolean
  demoOverkill: boolean
  speculativeBlock: boolean
  pmcRepeat: boolean
}

function measureHumanness(text: string, lang: 'ro' | 'en'): HumannessReport {
  const flags: string[] = []
  let score = 100

  const sentences = text.replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZĂÂÎȘȚ])/).filter(s => s.length > 5)
  const sentenceLengths = sentences.map(s => s.split(/\s+/).length)
  const mean = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length : 0
  const variance = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + (b - mean) ** 2, 0) / sentenceLengths.length : 0
  const stdDev = Math.sqrt(variance)

  if (stdDev < 5) { flags.push(`LOW_BURSTINESS: stdDev=${stdDev.toFixed(1)}`); score -= 20 }
  else if (stdDev < 7) { flags.push(`MODERATE_BURSTINESS: stdDev=${stdDev.toFixed(1)}`); score -= 10 }

  let sameLen = 0
  for (let i = 1; i < sentenceLengths.length; i++) {
    if (Math.abs(sentenceLengths[i] - sentenceLengths[i - 1]) < 4) sameLen++
  }
  const sameLenRatio = sameLen / Math.max(sentenceLengths.length - 1, 1)
  if (sameLenRatio > 0.5) {
    flags.push(`UNIFORM_LENGTHS: ${(sameLenRatio * 100).toFixed(0)}%`); score -= 15
  }

  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 20)
  const paraLengths = paragraphs.map(p => p.split(/\s+/).length)
  if (paraLengths.length > 2) {
    const paraMean = paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length
    const paraStdDev = Math.sqrt(paraLengths.reduce((a, b) => a + (b - paraMean) ** 2, 0) / paraLengths.length)
    if (paraStdDev < 10) { flags.push(`UNIFORM_PARAGRAPHS: stdDev=${paraStdDev.toFixed(1)}`); score -= 10 }
  }

  // v16: detect demo openers at paragraph-start AND after sentence-ending punctuation within paragraphs
  const demoPattern = lang === 'ro'
    ? /(?:^|[.!?]\s+)(Acest[ăa]?|Aceste|Aceasta)\s/gm
    : /(?:^|[.!?]\s+)(This|These|That|Those)\s/gm
  const demoCount = (text.match(demoPattern) || []).length
  const demoOverkill = demoCount > 2
  if (demoOverkill) { flags.push(`DEMONSTRATIVE_OVERKILL: ${demoCount}x`); score -= 10 }

  const pmcCount = lang === 'ro' ? (text.match(/Pe măsură ce/gi) || []).length : 0
  const pmcRepeat = pmcCount > 1
  if (pmcRepeat) { flags.push(`PMC_REPEAT: ${pmcCount}x`); score -= 10 }

  const lastParas = paragraphs.slice(-2).join(' ').toLowerCase()
  const specPhrases = lang === 'ro'
    ? ['este de așteptat', 'va fi probabil', 'rămâne de văzut', 'viitorul va', 'este așteptat', 'în cele din urmă']
    : ['is expected to', 'remains to be seen', 'the future will', 'it is likely', 'will probably', 'only time will tell']
  const speculativeBlock = specPhrases.some(p => lastParas.includes(p))
  if (speculativeBlock) { flags.push('SPECULATIVE_ENDING'); score -= 15 }

  const transitions = lang === 'ro'
    ? ['totuși', 'cu toate acestea', 'în schimb', 'pe de altă parte', 'în același timp']
    : ['however', 'nevertheless', 'on the other hand', 'in contrast', 'meanwhile']
  for (const t of transitions) {
    const count = (text.toLowerCase().match(new RegExp(`\\b${t}\\b`, 'g')) || []).length
    if (count >= 3) { flags.push(`TRANSITION_REPEAT:${t}=${count}`); score -= 5 }
  }

  const aiWords = lang === 'ro'
    ? ['semnificativ', 'considerabil', 'remarcabil', 'esențial', 'crucial', 'vital', 'paradigm', 'ecosistem', 'sinergie', 'reziliență', 'rezilient']
    : ['delve', 'landscape', 'robust', 'comprehensive', 'leverage', 'foster', 'seamless', 'holistic', 'paradigm', 'ecosystem', 'synergy']
  let aiWordCount = 0
  for (const w of aiWords) {
    aiWordCount += (text.toLowerCase().match(new RegExp(`\\b${w}`, 'g')) || []).length
  }
  if (aiWordCount > 2) { flags.push(`AI_VOCAB:${aiWordCount}`); score -= aiWordCount * 3 }

  return { score: Math.max(0, Math.min(100, score)), flags, sentenceStdDev: stdDev,
    burstiness: stdDev >= 7, demoOverkill, speculativeBlock, pmcRepeat }
}


function sanitizeTitle(text: string): string {
  if (typeof text !== 'string') {
    console.warn(`[sanitizeTitle] received non-string (${typeof text}) — coerced to empty`)
    return ''
  }
  if (!text) return ''
  return text.replace(/[#*_`]/g, '').replace(/[.,;:]+$/, '').replace(/\.{2,}$/, '').trim()
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  return (tags as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .map((t: string) =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
       .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/-{2,}/g, '-')
       .replace(/^-|-$/g, '').slice(0, 50)
    )
    .filter((t: string) => { if (!t || t.length < 2 || seen.has(t)) return false; seen.add(t); return true })
    .slice(0, 9)
}


// v16.3 — XML tag field extractor. Robust to literal newlines, smart quotes,
// diacritics, and any internal punctuation that breaks JSON.parse. This is
// THE fix for the repeating "[polish-ro] JSON parse failed" and
// "[extend-ro] JSON parse failed" errors that silently lose Romanian output.
//
// Usage: parseXmlField(rawText, 'content') returns the content between
// <content>...</content> tags, or null if not found.

// v16.5 — DEFENSIVE STRING COERCER
//
// GPT-4.1 in json_object mode sometimes returns fields as arrays of paragraphs
// or nested objects instead of single strings, even though the schema asks for
// "field":"...". TypeScript's `as string` is a compile-time assertion only —
// at runtime it does NOT convert non-strings. Without this coercer, the next
// sanitize call hits .replace() on an array/object and crashes:
//   FATAL: r.replace is not a function   (minified variable name)
//
// toStr() converts to string defensively:
//   - "abc"           → "abc"
//   - ["a","b","c"]   → "a\n\nb\n\nc"  (paragraph join)
//   - {text:"a"}      → "a"            (common nested shape)
//   - {content:"a"}   → "a"
//   - {value:"a"}     → "a"
//   - {en:"a"}/{ro:"a"} → "a"          (language-keyed nested shape)
//   - null/undefined  → ""
//   - other           → ""             (with a console.warn)
//
// Each non-string field also logs which field GPT returned non-string so we
// can see in production what model output keeps breaking.

function generateSlug(title: string): string {
  const base = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+$/, '').substring(0, 60)
  return `${base}-${Math.random().toString(36).substring(2, 10)}`
}

function countWords(text: string): number {
  if (!text) return 0
  return text.trim().split(/\s+/).filter((w: string) => w.length > 0).length
}

function isRomanianText(text: string): boolean {
  if (!text || text.length < 100) return false
  const lower = text.toLowerCase()
  const diacritics = (text.match(/[ăâîșțĂÂÎȘȚ]/g) || []).length
  const letters = (text.match(/[a-zA-ZăâîșțĂÂÎȘȚ]/g) || []).length
  const density = letters > 0 ? diacritics / letters : 0
  if (density >= 0.008) return true
  const roWords = [' și ', ' în ', ' este ', ' care ', ' pentru ', ' după ', ' dupa ',
    ' această ', ' aceasta ', ' sunt ', ' către ', ' catre ', ' decât ', ' decat ',
    ' între ', ' intre ', ' până ', ' pana ', ' fără ', ' fara ', ' unui ', ' unei ',
    ' nostru ', ' lor ', ' ca ', ' sa ', ' se ', ' va ', ' si ']
  let roHits = 0
  for (const w of roWords) { if (lower.includes(w)) roHits++ }
  const enWords = [' the ', ' and ', ' of ', ' to ', ' that ', ' this ', ' with ', ' from ',
    ' was ', ' were ', ' has ', ' have ', ' which ', ' their ', ' about ', ' against ']
  let enHits = 0
  for (const w of enWords) { if (lower.includes(w)) enHits++ }
  return roHits >= 4 && enHits <= 2
}

function ensureParagraphs(text: string): string {
  if (typeof text !== 'string') {
    console.warn(`[ensureParagraphs] received non-string (${typeof text}) — coerced to empty`)
    return ''
  }
  if (!text) return ''
  const t = text.trim()
  if (/\n\s*\n/.test(t)) return t.replace(/\n{3,}/g, '\n\n')
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean)
  if (lines.length > 1) return lines.join('\n\n')
  const DOT = '\u0001'
  const guarded = t.replace(/\s+/g, ' ')
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    .replace(/\b([A-ZĂÂÎȘȚ])\.\s/g, `$1${DOT} `)
  const sentences = guarded.match(/[^.!?]+[.!?]+(?:["”»)\]]+)?\s*|[^.!?]+$/g) || [guarded]
  const restore = new RegExp(DOT, 'g')
  const paras: string[] = []
  let bucket: string[] = []
  for (const s of sentences) {
    bucket.push(s.trim().replace(restore, '.'))
    if (bucket.length >= 3) { paras.push(bucket.join(' ').trim()); bucket = [] }
  }
  if (bucket.length) paras.push(bucket.join(' ').trim())
  return paras.filter(Boolean).join('\n\n')
}

function defangBrief(brief: string): string {
  return brief
    .replace(/ignore (all|any|previous|prior) (instructions|prompts)/gi, '[removed]')
    .replace(/disregard (the|all|any) (above|previous|system)/gi, '[removed]')
    .replace(/you are now\b/gi, '[removed]')
    .substring(0, 6000)
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


// ═══════════════════════════════════════════════════════════════════════════
// V17 CORE — Result type + structured-output primitives
// ═══════════════════════════════════════════════════════════════════════════

type Ok<T>  = { ok: true;  value: T }
type Err    = { ok: false; error: string; stage?: string }
type Result<T> = Ok<T> | Err

const ok  = <T>(value: T): Ok<T> => ({ ok: true, value })
const err = (error: string, stage?: string): Err => ({ ok: false, error, stage })

// Defensive string coercion — handles every shape GPT-4.1 can throw at us
function toStr(v: unknown, fieldName?: string): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (Array.isArray(v)) {
    const strings = v.filter((x): x is string => typeof x === 'string')
    if (fieldName) console.warn(`[toStr] field ${fieldName} returned as array(${v.length}) — joining ${strings.length} string elements`)
    return strings.join('\n\n')
  }
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    for (const k of ['text', 'content', 'value', 'en', 'ro', 'string', 'body']) {
      if (typeof obj[k] === 'string') {
        if (fieldName) console.warn(`[toStr] field ${fieldName} returned as object — extracted .${k}`)
        return obj[k] as string
      }
    }
    if (fieldName) console.warn(`[toStr] field ${fieldName} returned as object with no string key — discarding: ${JSON.stringify(v).substring(0, 120)}`)
    return ''
  }
  if (fieldName) console.warn(`[toStr] field ${fieldName} returned as ${typeof v} — discarding`)
  return ''
}

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
}

// v17.2 — Per-type creative temperature. Pamflet and blog need higher creative
// freedom (satire, personal voice). News and analiza need lower (factual rigor).
// Reportaj, cultura, editorial, opinie, tehnologie sit in the middle.
function temperatureForType(articleType: string): number {
  if (articleType === 'pamflet' || articleType === 'blog') return 0.75
  if (articleType === 'news' || articleType === 'analiza') return 0.5
  return 0.6
}

// XML tag extractor — bulletproof for free-form prose (newlines, smart quotes, diacritics)
function extractXml(raw: string, tag: string): Result<string> {
  if (!raw) return err('empty response')
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')
  const m = raw.match(re)
  if (!m) return err(`<${tag}> tag not found in model response`)
  let inner = m[1].replace(/^\s+|\s+$/g, '')
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  if (cdata) inner = cdata[1]
  if (!inner) return err(`<${tag}> tag is empty`)
  return ok(inner)
}

// Strict JSON parser — for SHORT METADATA fields only (never free-form content)
function extractJson(raw: string): Result<Record<string, unknown>> {
  if (!raw) return err('empty response')
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  try { return ok(JSON.parse(cleaned) as Record<string, unknown>) }
  catch { /* fall through */ }
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}')
  if (s !== -1 && e > s) {
    try { return ok(JSON.parse(cleaned.substring(s, e + 1)) as Record<string, unknown>) }
    catch { /* fall through */ }
  }
  return err(`invalid JSON in model response: ${cleaned.substring(0, 100)}`)
}


// ═══════════════════════════════════════════════════════════════════════════
// V17 MODEL CLIENTS — typed, no silent fallbacks, no shared state
// ═══════════════════════════════════════════════════════════════════════════

interface CostTracker { usd: number }

interface ModelOptions {
  maxTokens?: number
  temperature?: number
  responseFormat?: 'text' | 'json'
  timeoutMs?: number
}

async function callOpenAI(
  system: string, user: string, opts: ModelOptions, cost: CostTracker, label: string,
): Promise<Result<string>> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return err('OPENAI_API_KEY not set', label)

  const maxRetries = 2
  let lastError = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CALL_TIMEOUT_MS)
    try {
      const body: Record<string, unknown> = {
        model: 'gpt-4.1-2025-04-14',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.5,
      }
      if (opts.responseFormat === 'json') body.response_format = { type: 'json_object' }

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timer)

      const raw = await res.text()

      // Retry on 429 (rate limit) or 5xx (server error)
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        lastError = `OpenAI ${res.status}: ${raw.substring(0, 100)}`
        console.warn(`[callOpenAI] ${label} attempt ${attempt + 1} got ${res.status} — retrying in ${1000 * Math.pow(2, attempt)}ms`)
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }

      if (!res.ok) return err(`OpenAI ${res.status}: ${raw.substring(0, 200)}`, label)

      let data: Record<string, unknown>
      try { data = JSON.parse(raw) }
      catch { return err(`OpenAI returned non-JSON envelope`, label) }

      const usage = data.usage as Record<string, number> | undefined
      if (usage) cost.usd += (usage.prompt_tokens || 0) / 1e6 * PRICE.openai.in + (usage.completion_tokens || 0) / 1e6 * PRICE.openai.out

      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined
      const content = choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content) return err(`OpenAI returned no content`, label)
      return ok(content)
    } catch (e) {
      clearTimeout(timer)
      lastError = `OpenAI exception: ${(e as Error).message}`
      // Retry on timeout (AbortError) or network errors
      if (attempt < maxRetries) {
        console.warn(`[callOpenAI] ${label} attempt ${attempt + 1} failed: ${lastError} — retrying in ${1000 * Math.pow(2, attempt)}ms`)
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
    }
  }
  return err(lastError, label)
}

async function callAnthropic(
  model: 'sonnet' | 'haiku', system: string, user: string, opts: ModelOptions, cost: CostTracker, label: string,
): Promise<Result<string>> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) return err('CLAUDE_API_KEY not set', label)
  const modelId = model === 'sonnet' ? SONNET_MODEL : HAIKU_MODEL
  const price = model === 'sonnet' ? PRICE.sonnet : PRICE.haiku

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CALL_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.5,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    const raw = await res.text()
    if (!res.ok) return err(`Anthropic ${res.status}: ${raw.substring(0, 200)}`, label)

    let data: Record<string, unknown>
    try { data = JSON.parse(raw) }
    catch { return err(`Anthropic returned non-JSON envelope`, label) }

    const usage = data.usage as Record<string, number> | undefined
    if (usage) cost.usd += (usage.input_tokens || 0) / 1e6 * price.in + (usage.output_tokens || 0) / 1e6 * price.out

    const contentBlocks = data.content as Array<{ text?: string }> | undefined
    const text = contentBlocks?.[0]?.text
    if (typeof text !== 'string' || !text) return err(`Anthropic returned no content`, label)
    return ok(text)
  } catch (e) {
    clearTimeout(timer)
    return err(`Anthropic exception: ${(e as Error).message}`, label)
  }
}

async function callGemini(
  system: string, user: string, opts: ModelOptions, cost: CostTracker, label: string,
): Promise<Result<string>> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return err('GEMINI_API_KEY not set', label)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CALL_TIMEOUT_MS)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.5,
        },
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    const raw = await res.text()
    if (!res.ok) return err(`Gemini ${res.status}: ${raw.substring(0, 200)}`, label)

    let data: Record<string, unknown>
    try { data = JSON.parse(raw) }
    catch { return err(`Gemini returned non-JSON envelope`, label) }

    const usage = data.usageMetadata as Record<string, number> | undefined
    if (usage) cost.usd += (usage.promptTokenCount || 0) / 1e6 * PRICE.gemini.in + (usage.candidatesTokenCount || 0) / 1e6 * PRICE.gemini.out

    const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined
    const text = candidates?.[0]?.content?.parts?.[0]?.text
    if (typeof text !== 'string' || !text) return err(`Gemini returned no content`, label)
    return ok(text)
  } catch (e) {
    clearTimeout(timer)
    return err(`Gemini exception: ${(e as Error).message}`, label)
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// V17 PIPELINE STAGES — each stage = one job, one input, one Result output
// ═══════════════════════════════════════════════════════════════════════════

interface PipelineInput {
  brief: string
  wordCount: number
  articleType: string
  editorKey: string
  category: string
  voiceClass: boolean
}

interface MetadataFields {
  excerpt: string
  summary: string
  tags: string[]
  seoTitle: string
  seoDescription: string
}

interface LangArticle {
  title: string
  content: string
  excerpt: string
  summary: string
  tags: string[]
  seoTitle: string
  seoDescription: string
  meta: {
    wordCount: number
    polished: boolean
    extended: boolean
    titleSwapped: boolean
    closerSwapped: boolean
    humannessScore: number
    humannessFlags: string[]
  }
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 1 — Research (Gemini enrichment, news class only)
// ───────────────────────────────────────────────────────────────────────────
async function stageResearch(
  input: PipelineInput, cost: CostTracker,
): Promise<Result<{ atoms: string; isEnriched: boolean }>> {
  // Voice class skips enrichment — the brief IS the source
  if (input.voiceClass) {
    console.log(`[v17 stage1] research SKIPPED for voice-class type=${input.articleType}; using brief directly`)
    return ok({ atoms: '', isEnriched: false })
  }

  const system = `You extract factual atoms from a news brief. Output telegraphic English fact lines.
- One fact per line. Max 15 words per line.
- Strip ALL commentary, opinion, framing.
- Group by actor: WHO did/said WHAT, WHEN, WHERE.
- Quotes: keep verbatim if direct attribution is in the source.
- No bullet symbols. No transitions. Just facts.
- Aim for 30-60 fact lines.

Output nothing but the fact lines.`

  const user = `BRIEF (category: ${input.category}):\n\n${input.brief}\n\nExtract fact atoms.`

  const result = await callGemini(system, user, { maxTokens: 4000, temperature: 0.2 }, cost, 'stage1-research')
  if (!result.ok) return err(`research failed: ${result.error}`, 'stage1-research')

  const atoms = result.value.trim()
  if (atoms.length < 100) return err(`research too short (${atoms.length}c) — likely enrichment failure`, 'stage1-research')

  console.log(`[v17 stage1] research done — ${atoms.length}c, ${atoms.split('\n').length} fact lines`)
  return ok({ atoms, isEnriched: true })
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 2 — Content generation (XML output, free-form prose)
// ───────────────────────────────────────────────────────────────────────────
async function stageContent(
  lang: 'en' | 'ro', input: PipelineInput, research: string, isEnriched: boolean, cost: CostTracker,
): Promise<Result<{ content: string; title: string }>> {
  const minWords = Math.floor(input.wordCount * 0.85)
  const maxWords = Math.ceil(input.wordCount * 1.15)

  const toneVoice = getToneVoice(input.articleType, lang)
  const editorVoice = getEditorVoice(input.editorKey, lang)
  const editorName  = getEditorDisplayName(input.editorKey, lang)
  const allowFirstPerson = voiceAllowsFirstPerson(input.articleType)

  const humanizationBlock = lang === 'ro' ? HUMANIZATION_RO : HUMANIZATION_EN
  const zeroCopyBlock     = lang === 'ro' ? ZERO_COPY_RO    : ZERO_COPY_EN
  const fabricationBlock  = lang === 'ro' ? FABRICATION_BAN_RO : FABRICATION_BAN_EN
  const firstPersonBlock  = allowFirstPerson ? '' : (lang === 'ro' ? FIRST_PERSON_BAN_RO : FIRST_PERSON_BAN_EN)
  const standardsBlock    = lang === 'ro' ? ROMANIAN_NATIVE : TT_STANDARDS

  // News-class only: enforce NYT/WaPo absolute rules + non-negotiable structure.
  // Voice-class skips these because they constrain the writer's room for
  // argument and personal framing (pamflet, editorial, opinie need to breathe).
  const newsRulesBlock     = input.voiceClass ? '' : '\n\n' + RULES
  const newsStructureBlock = input.voiceClass ? '' : '\n\n' + STRUCTURE_FIRST

  const langName = lang === 'ro' ? 'Romanian' : 'English'

  const system = `You are ${editorName}, journalist at Transilvania Times. Write a ${input.articleType.toUpperCase()} article in NATIVE ${langName.toUpperCase()}.

═══ TYPE REGISTER — ${input.articleType.toUpperCase()} ═══
${toneVoice}

═══ EDITOR SIGNATURE — ${input.editorKey} ═══
${editorVoice}

═══ STANDARDS ═══
${standardsBlock}${newsRulesBlock}${newsStructureBlock}

═══ TITLE CRAFT ═══
${lang === 'ro' ? TITLE_CRAFT_RO : TITLE_CRAFT_EN}

${MASTER_HUMANIZING}

${humanizationBlock}

${zeroCopyBlock}

${fabricationBlock}

${FABRICATION_HARD_STOP}

${ANTI_PADDING}

${LOCAL_AUDIENCE_DISCIPLINE}${firstPersonBlock ? '\n\n' + firstPersonBlock : ''}

═══ OUTPUT FORMAT — CRITICAL ═══
You return EXACTLY this structure, in ${langName}, no preamble, no markdown fences, no JSON:

<title>the article title — one line, 8-90 characters, no quotes</title>
<content>
The article body. Paragraphs separated by blank lines. No headers. No bullets. No subtitles. No concluding rhetorical questions. ${minWords}-${maxWords} words total.
</content>

The XML tags above are the ONLY structure. Inside <content> write natural ${langName} prose with real paragraph breaks (blank lines). Do NOT escape newlines as \\n. Do NOT use backticks. Do NOT wrap in code fences.`

  const briefSection = isEnriched
    ? `═══ EDITOR'S BRIEF (your context, for background and development material) ═══
${input.brief}

═══ RESEARCH ATOMS (Gemini-verified facts — these are your authoritative fact checklist) ═══
${research}

HOW TO USE BOTH:
1. ATOMS = your factual outline. Every named person, quote, number, date in your article MUST appear in the atoms.
2. BRIEF = context for background paragraphs (who actors are, what stakes, what implications). Do NOT introduce new specific facts from the brief that aren't in atoms.
3. PARAPHRASE everything. Every sentence is your construction.`
    : `═══ EDITOR'S BRIEF (this IS your source — develop directly from it) ═══
${input.brief}`

  const user = `${briefSection}

═══ TARGET LENGTH ═══
${input.wordCount} words (acceptable range: ${minWords}–${maxWords}).

To reach the target honestly: for each fact, 2-4 sentences (state, attribute, contextualize, implicate). Add 1-2 background paragraphs (named actors' roles, stakes). Add 1 consequence paragraph (who's affected). NEVER pad. NEVER invent.

Now write the article. Return ONLY <title>...</title> and <content>...</content>.`

  const temperature = temperatureForType(input.articleType)
  const maxTokens = Math.min(14000, Math.max(4000, input.wordCount * 8))

  const result = await callOpenAI(system, user, { maxTokens, temperature, responseFormat: 'text' }, cost, `stage2-content-${lang}`)
  if (!result.ok) return err(`content generation failed: ${result.error}`, `stage2-content-${lang}`)

  const titleResult   = extractXml(result.value, 'title')
  const contentResult = extractXml(result.value, 'content')
  if (!titleResult.ok)   return err(`title tag missing: ${titleResult.error}`, `stage2-content-${lang}`)
  if (!contentResult.ok) return err(`content tag missing: ${contentResult.error}`, `stage2-content-${lang}`)

  const title   = lang === 'ro' ? sanitizeTitle(sanitizeContentRo(titleResult.value))   : sanitizeTitle(sanitizeContentEn(titleResult.value))
  const content = lang === 'ro' ? ensureParagraphs(sanitizeContentRo(contentResult.value)) : ensureParagraphs(sanitizeContentEn(contentResult.value))

  if (title.length < 8)    return err(`title too short after sanitize (${title.length}c)`, `stage2-content-${lang}`)
  if (content.length < 400) return err(`content too short after sanitize (${content.length}c)`, `stage2-content-${lang}`)
  if (lang === 'ro' && !isRomanianText(content)) return err(`content failed Romanian language check`, `stage2-content-${lang}`)

  const wc = countWords(content)
  console.log(`[v17 stage2] content-${lang} produced — ${wc}w, title="${title.substring(0, 60)}"`)
  return ok({ content, title })
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 3 — Metadata generation (JSON output, short fields ONLY)
// ───────────────────────────────────────────────────────────────────────────
async function stageMetadata(
  lang: 'en' | 'ro', title: string, content: string, cost: CostTracker,
): Promise<Result<MetadataFields>> {
  const langName = lang === 'ro' ? 'Romanian' : 'English'

  // Use only first 1500c of content — metadata is derived, not regenerated
  const contentSample = content.length > 1500 ? content.substring(0, 1500) + '...' : content

  const system = `You generate article metadata in ${langName} from an already-written article.

Return ONLY a valid JSON object with these EXACT keys (every value is a short string or short array):

{
  "excerpt": "one sentence, 80-200 characters, captures the article's lead",
  "summary": "2-3 sentences, 200-450 characters, paragraph-style summary",
  "tags": ["3-7 short tags", "lowercase", "no hyphens needed", "single words preferred"],
  "seo_title": "SEO-optimized title, 50-70 characters, includes key entity",
  "seo_description": "meta description, 150-160 characters, ends without ellipsis"
}

RULES:
- Every value MUST be a string (or array of strings for tags). Never an object, never an array of objects.
- Use ${langName} for all text.
- Do not invent facts. Derive only from the article provided.
- No markdown. No code fences. No preamble. Just the JSON object.`

  const user = `TITLE: ${title}

ARTICLE EXCERPT (first 1500 characters):
${contentSample}

Return the JSON metadata.`

  const result = await callOpenAI(system, user, { maxTokens: 800, temperature: 0.3, responseFormat: 'json' }, cost, `stage3-metadata-${lang}`)
  if (!result.ok) return err(`metadata generation failed: ${result.error}`, `stage3-metadata-${lang}`)

  const parsed = extractJson(result.value)
  if (!parsed.ok) return err(`metadata JSON parse failed: ${parsed.error}`, `stage3-metadata-${lang}`)

  // toStr() on every field — defensive against GPT-4.1 nested structure quirks
  const sanitize    = lang === 'ro' ? sanitizeContentRo : sanitizeContentEn
  const sanTitle    = sanitizeTitle
  const meta: MetadataFields = {
    excerpt:        sanitize(toStr(parsed.value.excerpt, 'excerpt')).substring(0, 300),
    summary:        sanitize(toStr(parsed.value.summary, 'summary')).substring(0, 600),
    tags:           toStrArray(parsed.value.tags).map((t: string) =>
                      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                       .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '')
                       .replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 50)
                    ).filter((t: string) => t.length >= 2).slice(0, 9),
    seoTitle:       sanTitle(sanitize(toStr(parsed.value.seo_title, 'seo_title'))).substring(0, 80) || title.substring(0, 60),
    seoDescription: sanitize(toStr(parsed.value.seo_description, 'seo_description')).substring(0, 200),
  }

  console.log(`[v17 stage3] metadata-${lang} produced — tags=${meta.tags.length}, seoTitle="${meta.seoTitle.substring(0, 50)}"`)
  return ok(meta)
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 4 — Polish (Sonnet, XML output, lifts to editor voice + register)
// ───────────────────────────────────────────────────────────────────────────
async function stagePolish(
  lang: 'en' | 'ro', title: string, content: string, articleType: string, editorKey: string, voiceClass: boolean, cost: CostTracker,
): Promise<Result<{ title: string; content: string }>> {
  const draftWordCount = countWords(content)
  const toneVoice = getToneVoice(articleType, lang)
  const editorVoice = getEditorVoice(editorKey, lang)
  const editorName = getEditorDisplayName(editorKey, lang)
  const langName = lang === 'ro' ? 'Romanian' : 'English'
  const allowFirstPerson = voiceAllowsFirstPerson(articleType)

  const humanizationBlock = lang === 'ro' ? HUMANIZATION_RO : HUMANIZATION_EN
  const zeroCopyBlock     = lang === 'ro' ? ZERO_COPY_RO    : ZERO_COPY_EN
  const fabricationBlock  = lang === 'ro' ? FABRICATION_BAN_RO : FABRICATION_BAN_EN
  const firstPersonBlock  = allowFirstPerson ? '' : '\n\n' + (lang === 'ro' ? FIRST_PERSON_BAN_RO : FIRST_PERSON_BAN_EN)
  const standardsBlock    = lang === 'ro' ? ROMANIAN_NATIVE : TT_STANDARDS

  const system = `You are a senior editor at Transilvania Times. You receive a ${langName} article from ${editorName}. Lift it to the highest register of TYPE (${articleType.toUpperCase()}) AND EDITOR SIGNATURE (${editorKey}). Preserve all facts, numbers, names, quotes EXACTLY. Keep length around ${draftWordCount} words (±15%). No subheadings. No concluding rhetorical question. No closer about "the future" or "what comes next".

═══ TYPE REGISTER — ${articleType.toUpperCase()} ═══
${toneVoice}

═══ EDITOR SIGNATURE — ${editorKey} ═══
${editorVoice}

═══ STANDARDS ═══
${standardsBlock}

═══ TITLE CRAFT ═══
${lang === 'ro' ? TITLE_CRAFT_RO : TITLE_CRAFT_EN}

${MASTER_HUMANIZING}

${humanizationBlock}

${zeroCopyBlock}

${fabricationBlock}

${FABRICATION_HARD_STOP}

${ANTI_PADDING}

${LOCAL_AUDIENCE_DISCIPLINE}${firstPersonBlock}

═══ OUTPUT FORMAT ═══
Return EXACTLY:
<title>the title (kept if good, refined if needed)</title>
<content>
the polished article with paragraphs separated by blank lines
</content>

No preamble. No markdown. No JSON. No code fences.`

  const user = `TITLE: ${title}

ARTICLE:
${content}

Return the polished version inside <title> and <content> tags.`

  const tokenBudget = Math.min(12000, Math.max(4000, draftWordCount * 8))
  const result = await callAnthropic('sonnet', system, user, { maxTokens: tokenBudget, temperature: temperatureForType(articleType) }, cost, `stage4-polish-${lang}`)
  if (!result.ok) return err(`polish failed: ${result.error}`, `stage4-polish-${lang}`)

  const titleResult   = extractXml(result.value, 'title')
  const contentResult = extractXml(result.value, 'content')
  if (!contentResult.ok) return err(`polish content tag missing: ${contentResult.error}`, `stage4-polish-${lang}`)

  const newTitle   = titleResult.ok
    ? (lang === 'ro' ? sanitizeTitle(sanitizeContentRo(titleResult.value)) : sanitizeTitle(sanitizeContentEn(titleResult.value)))
    : title
  const newContent = lang === 'ro'
    ? ensureParagraphs(sanitizeContentRo(contentResult.value))
    : ensureParagraphs(sanitizeContentEn(contentResult.value))

  if (newContent.length < 400) return err(`polish content too short (${newContent.length}c)`, `stage4-polish-${lang}`)
  if (lang === 'ro' && !isRomanianText(newContent)) return err(`polish content failed Romanian check`, `stage4-polish-${lang}`)

  const newWc = countWords(newContent)
  const lenRatio = newWc / Math.max(1, draftWordCount)
  if (lenRatio < 0.5 || lenRatio > 1.5) {
    return err(`polish length ratio ${(lenRatio * 100).toFixed(0)}% out of bounds`, `stage4-polish-${lang}`)
  }

  console.log(`[v17 stage4] polish-${lang} applied — ${draftWordCount} → ${newWc}w`)
  return ok({ title: newTitle && newTitle.length >= 8 ? newTitle : title, content: newContent })
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 5 — Extend (Sonnet, XML output, when content < 85% of target)
// ───────────────────────────────────────────────────────────────────────────
async function stageExtend(
  lang: 'en' | 'ro', content: string, brief: string, atoms: string,
  currentWords: number, targetWords: number, articleType: string, editorKey: string, cost: CostTracker,
): Promise<Result<string>> {
  const editorName = getEditorDisplayName(editorKey, lang)
  const editorVoice = getEditorVoice(editorKey, lang)
  const toneVoice = getToneVoice(articleType, lang)
  const langName = lang === 'ro' ? 'Romanian' : 'English'
  const fabricationBlock = lang === 'ro' ? FABRICATION_BAN_RO : FABRICATION_BAN_EN
  const zeroCopyBlock    = lang === 'ro' ? ZERO_COPY_RO       : ZERO_COPY_EN
  const humanizationBlock = lang === 'ro' ? HUMANIZATION_RO   : HUMANIZATION_EN

  const system = `You are ${editorName}, senior journalist at Transilvania Times. You receive a SHORT DRAFT of your own ${langName} ${articleType.toUpperCase()} article. Mission: EXTEND it to ${targetWords} words by DEEPENING existing paragraphs (more attribution, more context from the brief, more named consequences). PRESERVE the existing structure and paragraph order. PRESERVE your editor voice and the type's tonal register — these are non-negotiable.

═══ TYPE REGISTER — ${articleType.toUpperCase()} (do not drift) ═══
${toneVoice}

═══ EDITOR SIGNATURE — ${editorKey} (your voice across the extension) ═══
${editorVoice}

═══ FABRICATION BAN (CRITICAL — read twice) ═══
${fabricationBlock}

${FABRICATION_HARD_STOP}

═══ ANTI-PLAGIARISM ═══
${zeroCopyBlock}

═══ HUMANIZATION ═══
${humanizationBlock}

${ANTI_PADDING}

═══ EXTENSION DISCIPLINE ═══
- Every new sentence must be grounded in atoms or brief — no invented facts.
- Develop existing paragraphs with attribution, context, named implications.
- Do NOT add rhetorical closers about "the future", "raises questions", "remains to be seen", "what comes next". The article ends with a fact or named consequence.
- Do NOT pad with filler. If you cannot honestly reach ${targetWords} words from the available material, stop earlier — but you should usually be able to deepen each paragraph by 30-40%.

═══ OUTPUT FORMAT ═══
Return EXACTLY:
<content>
the extended article — same paragraph structure, deepened with context
</content>

No preamble. No JSON. No code fences.`

  const atomsSection = atoms ? `═══ RESEARCH ATOMS (verified facts — only these are authoritative for new specifics) ═══
${atoms}

` : ''

  const user = `═══ CURRENT DRAFT (${currentWords} words — UNDER TARGET) ═══
${content}

═══ ORIGINAL BRIEF ═══
${brief}

${atomsSection}═══ TASK ═══
Extend to ${targetWords} words (±15%). Return only <content>...</content>.`

  const tokenBudget = Math.min(14000, Math.max(4000, targetWords * 8))
  const result = await callAnthropic('sonnet', system, user, { maxTokens: tokenBudget, temperature: temperatureForType(articleType) }, cost, `stage5-extend-${lang}`)
  if (!result.ok) return err(`extend failed: ${result.error}`, `stage5-extend-${lang}`)

  const contentResult = extractXml(result.value, 'content')
  if (!contentResult.ok) return err(`extend content tag missing: ${contentResult.error}`, `stage5-extend-${lang}`)

  const extended = lang === 'ro'
    ? ensureParagraphs(sanitizeContentRo(contentResult.value))
    : ensureParagraphs(sanitizeContentEn(contentResult.value))

  const extWc = countWords(extended)
  if (extWc <= currentWords) return err(`extend did not lengthen (${currentWords} → ${extWc}w)`, `stage5-extend-${lang}`)
  if (lang === 'ro' && !isRomanianText(extended)) return err(`extend content failed Romanian check`, `stage5-extend-${lang}`)

  console.log(`[v17 stage5] extend-${lang} applied — ${currentWords} → ${extWc}w`)
  return ok(extended)
}

// ───────────────────────────────────────────────────────────────────────────
// STAGE 6 — Semantic guard (Haiku, JSON output, title + closer integrity)
// ───────────────────────────────────────────────────────────────────────────
async function stageSemanticGuard(
  lang: 'en' | 'ro', title: string, content: string, brief: string, cost: CostTracker,
): Promise<Result<{ titleOverride?: string; lastParaOverride?: string }>> {
  const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 0)
  if (paragraphs.length < 2) return ok({})  // too short to meaningfully check

  const firstTwo = paragraphs.slice(0, 2).join('\n\n')
  const lastPara = paragraphs[paragraphs.length - 1]

  const system = lang === 'ro'
    ? `Ești editor de control de calitate pentru o publicație românească. Verifici DOUĂ aspecte într-un articol generat de AI.

1. TITLU ↔ CORP — titlul afirmă ceva ce primele 2 paragrafe NU dovedesc?
   - "X demisionează" cu corp fără demisie → DA.
   - "X contestă conducerea partidului" cu corp arată doar dezacord cu Cotroceni → DA.
   - Titlu reflectă fidel faptul principal → NU.
   Nu intervii doar pentru drama. Intervii doar dacă titlul afirmă un FAPT care nu apare în corp.

2. ÎNCHIDERE RETORICĂ — ultimul paragraf se termină cu speculație vagă despre viitor?
   ORICE variantă: "rămâne de văzut", "ridică/pune/naște întrebări despre viitor/direcția/impactul",
   "ce va aduce viitorul", "pe măsură ce situația evoluează" + speculație, articol care se termină cu semn de întrebare retoric.

Returnezi DOAR JSON valid, fără preambul:
{"title_problem":bool,"title_reason":"motiv|null","suggested_title":"titlu mai precis (max 90c)|null","closer_problem":bool,"closer_reason":"motiv|null","suggested_last_paragraph":"paragraf rescris fără speculație|null"}`
    : `You are a quality control editor for an English news publication. Check TWO things.

1. TITLE ↔ BODY — does the title assert something the first 2 paragraphs do NOT establish?
   Don't intervene for drama. Only intervene if the title asserts a FACT not in the body.

2. RHETORICAL CLOSER — does the last paragraph end with vague future speculation?
   Any variant: "remains to be seen", "raises questions about future/direction/impact", "what comes next", "as the situation evolves" + speculation, article ending with rhetorical question.

Return ONLY valid JSON, no preamble:
{"title_problem":bool,"title_reason":"reason|null","suggested_title":"more precise title (max 90c)|null","closer_problem":bool,"closer_reason":"reason|null","suggested_last_paragraph":"rewritten paragraph without speculation|null"}`

  const user = lang === 'ro'
    ? `BRIEF (context, primele 300c):\n${brief.substring(0, 300)}\n\nTITLU: ${title}\n\nPRIMELE 2 PARAGRAFE:\n${firstTwo}\n\nULTIMUL PARAGRAF:\n${lastPara}\n\nReturnează JSON.`
    : `BRIEF (context, first 300c):\n${brief.substring(0, 300)}\n\nTITLE: ${title}\n\nFIRST 2 PARAGRAPHS:\n${firstTwo}\n\nLAST PARAGRAPH:\n${lastPara}\n\nReturn JSON.`

  const result = await callAnthropic('haiku', system, user, { maxTokens: 1500, temperature: 0.0 }, cost, `stage6-guard-${lang}`)
  if (!result.ok) {
    console.warn(`[v17 stage6] semantic-guard-${lang} skipped: ${result.error}`)
    return ok({})  // guard is best-effort, never fail the whole pipeline
  }

  const parsed = extractJson(result.value)
  if (!parsed.ok) {
    console.warn(`[v17 stage6] semantic-guard-${lang} JSON parse failed: ${parsed.error}`)
    return ok({})
  }

  const out: { titleOverride?: string; lastParaOverride?: string } = {}

  if (parsed.value.title_problem === true) {
    const sug = toStr(parsed.value.suggested_title, 'suggested_title').trim()
    if (sug.length >= 10 && sug.length <= 130 && !sug.startsWith('{') && !sug.startsWith('[') &&
        (lang !== 'ro' || isRomanianText(sug + ' propoziție pentru lungime'.repeat(5)))) {
      out.titleOverride = sug
      console.log(`[v17 stage6] guard-${lang}: title swapped — ${toStr(parsed.value.title_reason).substring(0, 100)}`)
    }
  }
  if (parsed.value.closer_problem === true) {
    const sug = toStr(parsed.value.suggested_last_paragraph, 'suggested_last_paragraph').trim()
    if (sug.length >= 50 && sug.length <= 2000 && !sug.endsWith('?') &&
        (lang !== 'ro' || isRomanianText(sug + ' propoziție pentru lungime'.repeat(5)))) {
      out.lastParaOverride = sug
      console.log(`[v17 stage6] guard-${lang}: closer swapped — ${toStr(parsed.value.closer_reason).substring(0, 100)}`)
    }
  }
  return ok(out)
}


// ═══════════════════════════════════════════════════════════════════════════
// V17 PIPELINE ORCHESTRATOR — runs one language end-to-end
// ═══════════════════════════════════════════════════════════════════════════

async function runPipelineForLanguage(
  lang: 'en' | 'ro', input: PipelineInput, research: { atoms: string; isEnriched: boolean }, cost: CostTracker,
  budget: { startMs: number; totalBudgetMs: number },
): Promise<Result<LangArticle>> {

  const budgetRemaining = () => budget.totalBudgetMs - (Date.now() - budget.startMs)

  // STAGE 2 — Content generation (REQUIRED, no fallback)
  const contentResult = await stageContent(lang, input, research.atoms, research.isEnriched, cost)
  if (!contentResult.ok) return err(contentResult.error, contentResult.stage)
  let { title, content } = contentResult.value
  const draftWc = countWords(content)

  let extended = false
  let polished = false
  let titleSwapped = false
  let closerSwapped = false

  // STAGE 5 — Extend if under 85% of target (gated on budget)
  const minWords = Math.floor(input.wordCount * 0.85)
  if (draftWc < minWords && budgetRemaining() > 50000) {
    const extendResult = await stageExtend(lang, content, input.brief, research.atoms, draftWc, input.wordCount, input.articleType, input.editorKey, cost)
    if (extendResult.ok) {
      content = extendResult.value
      extended = true
    } else {
      console.warn(`[v17] extend-${lang} kept draft: ${extendResult.error}`)
    }
  }

  // STAGE 4 — Polish (gated on budget, optional)
  if (budgetRemaining() > 40000) {
    const polishResult = await stagePolish(lang, title, content, input.articleType, input.editorKey, input.voiceClass, cost)
    if (polishResult.ok) {
      title = polishResult.value.title
      content = polishResult.value.content
      polished = true
    } else {
      console.warn(`[v17] polish-${lang} kept draft: ${polishResult.error}`)
    }
  }

  // STAGE 6 — Semantic guard (gated on budget, best-effort)
  if (budgetRemaining() > 15000) {
    const guardResult = await stageSemanticGuard(lang, title, content, input.brief, cost)
    if (guardResult.ok) {
      if (guardResult.value.titleOverride) {
        title = guardResult.value.titleOverride
        titleSwapped = true
      }
      if (guardResult.value.lastParaOverride) {
        const paras = content.split(/\n\n+/).filter(p => p.trim().length > 0)
        paras[paras.length - 1] = guardResult.value.lastParaOverride
        content = paras.join('\n\n')
        closerSwapped = true
      }
    }
  }

  // STAGE 3 — Metadata (REQUIRED, derived from final content)
  const metaResult = await stageMetadata(lang, title, content, cost)
  if (!metaResult.ok) return err(metaResult.error, metaResult.stage)

  // FINAL — Measure humanness (telemetry only, no retry loop). Old code had a
  // humannessEnforceLoop that frequently failed JSON parsing and added latency
  // for marginal gains. v17 measures + logs so we have visibility into AI-
  // detector scores in production without retry loops.
  const finalWc = countWords(content)
  const humanness = measureHumanness(content, lang)
  console.log(`[v17] humanness final — ${lang.toUpperCase()} ${humanness.score}/100 ${humanness.flags.length ? '[' + humanness.flags.join(', ') + ']' : 'OK'}`)

  return ok({
    title,
    content,
    excerpt: metaResult.value.excerpt,
    summary: metaResult.value.summary,
    tags: metaResult.value.tags,
    seoTitle: metaResult.value.seoTitle,
    seoDescription: metaResult.value.seoDescription,
    meta: {
      wordCount: finalWc,
      polished,
      extended,
      titleSwapped,
      closerSwapped,
      humannessScore: humanness.score,
      humannessFlags: humanness.flags,
    },
  })
}


// ═══════════════════════════════════════════════════════════════════════════
// V17 MAIN GENERATOR — input validation → pipeline → unified response
// ═══════════════════════════════════════════════════════════════════════════

interface GenerationResult {
  success: boolean
  en?: LangArticle
  ro?: LangArticle
  research: { isEnriched: boolean; atomsLen: number }
  totalMs: number
  cost: number
  error?: { stage: string; message: string }
  length: { requested: number; effectiveTarget: number; capped: boolean }
}

async function generateArticle(input: PipelineInput, totalBudgetMs = 240000): Promise<GenerationResult> {
  const t0 = Date.now()
  const cost: CostTracker = { usd: 0 }
  const budget = { startMs: t0, totalBudgetMs }

  console.log(`[v17] START — type=${input.articleType}, editor=${input.editorKey}, ${input.wordCount}w requested, cat=${input.category}, voiceClass=${input.voiceClass}`)

  // STAGE 1 — Research (REQUIRED for news class, skipped for voice)
  const researchResult = await stageResearch(input, cost)
  if (!researchResult.ok) {
    return {
      success: false,
      research: { isEnriched: false, atomsLen: 0 },
      totalMs: Date.now() - t0,
      cost: Number(cost.usd.toFixed(5)),
      error: { stage: researchResult.stage || 'stage1', message: researchResult.error },
      length: { requested: input.wordCount, effectiveTarget: input.wordCount, capped: false },
    }
  }

  // LENGTH CONTRACT — input-proportional cap
  const briefWords = countWords(input.brief) + (researchResult.value.atoms ? countWords(researchResult.value.atoms) : 0)
  const multiplier = input.voiceClass ? 2.5 : 3.0  // voice can argue further; news has more material
  const maxSafe = Math.max(400, briefWords * multiplier)
  const effectiveTarget = Math.min(input.wordCount, maxSafe)
  const capped = effectiveTarget < input.wordCount

  if (capped) console.warn(`[v17] LENGTH CAPPED: requested=${input.wordCount}w, briefWords=${briefWords}, maxSafe=${maxSafe}w → effectiveTarget=${effectiveTarget}w`)
  else        console.log(`[v17] LENGTH OK: requested=${input.wordCount}w, briefWords=${briefWords}, maxSafe=${maxSafe}w → effectiveTarget=${effectiveTarget}w`)

  const effectiveInput: PipelineInput = { ...input, wordCount: effectiveTarget }

  // STAGES 2-6 — run EN and RO pipelines in parallel
  const [enResult, roResult] = await Promise.all([
    runPipelineForLanguage('en', effectiveInput, researchResult.value, cost, budget),
    runPipelineForLanguage('ro', effectiveInput, researchResult.value, cost, budget),
  ])

  // Hard requirement: at least EN must succeed; RO failure is degraded but acceptable
  if (!enResult.ok) {
    return {
      success: false,
      research: { isEnriched: researchResult.value.isEnriched, atomsLen: researchResult.value.atoms.length },
      totalMs: Date.now() - t0,
      cost: Number(cost.usd.toFixed(5)),
      error: { stage: enResult.stage || 'en-pipeline', message: enResult.error },
      length: { requested: input.wordCount, effectiveTarget, capped },
    }
  }

  if (!roResult.ok) {
    console.warn(`[v17] RO pipeline failed (EN succeeded): ${roResult.error}`)
  }

  const totalMs = Date.now() - t0
  console.log(`[v17] DONE — EN ${enResult.value.meta.wordCount}w${roResult.ok ? `, RO ${roResult.value.meta.wordCount}w` : ', RO failed'}, target=${effectiveTarget}w, cost=$${cost.usd.toFixed(5)}, ${(totalMs / 1000).toFixed(1)}s`)

  return {
    success: true,
    en: enResult.value,
    ro: roResult.ok ? roResult.value : undefined,
    research: { isEnriched: researchResult.value.isEnriched, atomsLen: researchResult.value.atoms.length },
    totalMs,
    cost: Number(cost.usd.toFixed(5)),
    length: { requested: input.wordCount, effectiveTarget, capped },
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// V17 HTTP HANDLER — single entry point, structured errors, telemetry
// ═══════════════════════════════════════════════════════════════════════════

interface TelemetryRow {
  article_type: string
  category: string
  editor: string
  word_count_req: number
  word_count_effective: number
  length_capped: boolean
  words_en: number
  words_ro: number
  research_enriched: boolean
  research_atoms_chars: number
  en_polished: boolean
  en_extended: boolean
  en_title_swapped: boolean
  en_closer_swapped: boolean
  en_humanness: number
  ro_polished: boolean
  ro_extended: boolean
  ro_title_swapped: boolean
  ro_closer_swapped: boolean
  ro_humanness: number
  total_ms: number
  est_cost_usd: number
  status: 'success' | 'fail'
  error_msg: string | null
  error_stage: string | null
  brief_excerpt: string
}

async function writeTelemetry(row: TelemetryRow): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) return
    await fetch(`${supabaseUrl}/rest/v1/generation_logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })
  } catch (e) {
    console.warn(`[v17] telemetry write failed: ${(e as Error).message}`)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...CORS, 'Content-Type': 'application/json' } })

  // Parse + validate body
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }) }

  const rawBrief    = toStr(body.prompt, 'request.prompt')
  const briefLen    = rawBrief.length
  const wordCount   = Number(body.word_count) || 1200
  const articleType = toStr(body.article_type, 'request.article_type') || 'news'
  const editorKey   = toStr(body.editor, 'request.editor') || 'andrei_popescu'
  const category    = toStr(body.category, 'request.category') || 'news'

  if (briefLen < 50)     return new Response(JSON.stringify({ error: 'Brief too short (minimum 50 characters)' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  if (wordCount < 200)   return new Response(JSON.stringify({ error: 'Word count too low (minimum 200)' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  if (wordCount > 5000)  return new Response(JSON.stringify({ error: 'Word count too high (maximum 5000)' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })

  const voiceClass = VOICE_CLASS_TYPES.includes(articleType)
  const safeBrief  = defangBrief(rawBrief)

  const input: PipelineInput = {
    brief: safeBrief,
    wordCount,
    articleType,
    editorKey,
    category,
    voiceClass,
  }

  let resultEnvelope: GenerationResult
  try {
    resultEnvelope = await generateArticle(input)
  } catch (e) {
    const msg = `[v17] uncaught exception: ${(e as Error).message}\n${(e as Error).stack || ''}`
    console.error(msg)
    await writeTelemetry({
      article_type: articleType, category, editor: editorKey,
      word_count_req: wordCount, word_count_effective: wordCount, length_capped: false,
      words_en: 0, words_ro: 0, research_enriched: false, research_atoms_chars: 0,
      en_polished: false, en_extended: false, en_title_swapped: false, en_closer_swapped: false, en_humanness: 0,
      ro_polished: false, ro_extended: false, ro_title_swapped: false, ro_closer_swapped: false, ro_humanness: 0,
      total_ms: 0, est_cost_usd: 0,
      status: 'fail', error_msg: (e as Error).message, error_stage: 'uncaught',
      brief_excerpt: safeBrief.substring(0, 300),
    })
    return new Response(JSON.stringify({ error: 'Generation failed: uncaught exception', detail: (e as Error).message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  // Telemetry
  await writeTelemetry({
    article_type: articleType, category, editor: editorKey,
    word_count_req: wordCount,
    word_count_effective: resultEnvelope.length.effectiveTarget,
    length_capped: resultEnvelope.length.capped,
    words_en: resultEnvelope.en?.meta.wordCount ?? 0,
    words_ro: resultEnvelope.ro?.meta.wordCount ?? 0,
    research_enriched: resultEnvelope.research.isEnriched,
    research_atoms_chars: resultEnvelope.research.atomsLen,
    en_polished: resultEnvelope.en?.meta.polished ?? false,
    en_extended: resultEnvelope.en?.meta.extended ?? false,
    en_title_swapped: resultEnvelope.en?.meta.titleSwapped ?? false,
    en_closer_swapped: resultEnvelope.en?.meta.closerSwapped ?? false,
    en_humanness: resultEnvelope.en?.meta.humannessScore ?? 0,
    ro_polished: resultEnvelope.ro?.meta.polished ?? false,
    ro_extended: resultEnvelope.ro?.meta.extended ?? false,
    ro_title_swapped: resultEnvelope.ro?.meta.titleSwapped ?? false,
    ro_closer_swapped: resultEnvelope.ro?.meta.closerSwapped ?? false,
    ro_humanness: resultEnvelope.ro?.meta.humannessScore ?? 0,
    total_ms: resultEnvelope.totalMs,
    est_cost_usd: resultEnvelope.cost,
    status: resultEnvelope.success ? 'success' : 'fail',
    error_msg: resultEnvelope.error?.message ?? null,
    error_stage: resultEnvelope.error?.stage ?? null,
    brief_excerpt: safeBrief.substring(0, 300),
  })

  if (!resultEnvelope.success) {
    return new Response(JSON.stringify({
      error: `Generation failed at stage: ${resultEnvelope.error?.stage}`,
      detail: resultEnvelope.error?.message,
    }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Success response — shape matches what the admin UI expects
  const en = resultEnvelope.en!
  const ro = resultEnvelope.ro
  return new Response(JSON.stringify({
    title_en: en.title,
    content_en: en.content,
    excerpt_en: en.excerpt,
    summary_en: en.summary,
    tags_en: en.tags,
    seo_title_en: en.seoTitle,
    seo_description_en: en.seoDescription,
    title_ro: ro?.title ?? '',
    content_ro: ro?.content ?? '',
    excerpt_ro: ro?.excerpt ?? '',
    summary_ro: ro?.summary ?? '',
    tags_ro: ro?.tags ?? [],
    seo_title_ro: ro?.seoTitle ?? '',
    seo_description_ro: ro?.seoDescription ?? '',
    meta: {
      word_count_en: en.meta.wordCount,
      word_count_ro: ro?.meta.wordCount ?? 0,
      length: resultEnvelope.length,
      total_ms: resultEnvelope.totalMs,
      cost_usd: resultEnvelope.cost,
      research_enriched: resultEnvelope.research.isEnriched,
    },
  }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
})