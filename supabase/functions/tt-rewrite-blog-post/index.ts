// supabase/functions/tt-rewrite-blog-post/index.ts
//
// =============================================================================
// AI RESCRIE — v8 PHASE 2: Haiku grammar corrector + humanness enforcement loop
// =============================================================================
//
// v8 changes vs v7 (Phase 2 additions on top of Phase 1 in v7):
//   - NEW: grammarCorrectorRo (Haiku 4.5) — runs AFTER sanitizeContentRo on the
//     Romanian content. Repairs orphaned articles, broken gender/number agreement,
//     dangling prepositions, doubled punctuation, cacophony from "ca care",
//     stray "ă" residues. Temperature 0.0 to forbid invention. Safety guards
//     reject any correction that deviates >10% in length or fails the Romanian
//     language check. ~$0.005-0.012/article, +3-6s latency.
//
//   - NEW: humannessEnforceLoop — if measureHumanness score < 75 AND >= 30s of
//     budget remains, calls Sonnet for ONE targeted revision that fixes only the
//     specific failed flags (LOW_BURSTINESS, UNIFORM_LENGTHS, DEMONSTRATIVE_OVERKILL,
//     PMC_REPEAT, SPECULATIVE_ENDING, AI_VOCAB). Re-sanitizes, re-measures,
//     keeps whichever scores higher. Closes the loop on the statistical metrics
//     AI detectors actually use. Triggered cost: +$0.015-0.025/article.
//
//   - serve handler: applies grammar corrector after sanitizer and BEFORE polish.
//     Humanness loop runs after final polish + first-person enforcement, before
//     DB update. Both EN and RO run independently; either may fail without
//     blocking the other.
//
//   - All Phase 1 work from v7 preserved byte-for-byte (false-friends, AI
//     closer deletions, stray-ă safety net in sanitizeContentRo).
//
// v7 changes vs v6 (already live):
//   - sanitizeContentRo: 11 false-friend calque patterns from corpus scan.
//   - sanitizeContentRo: 6 additional AI hand-wringing closer patterns.
//   - sanitizeContentRo: stray-ă wrapper-removal artifact safety net.
//
// Source of truth = the post's existing content (prefer EN, fall back to RO).
// UPDATE in place by id — preserves slug, cover_image, status, published_at,
// scraped_article_id. RO written back only if it passes the language check.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type SupaClient = ReturnType<typeof createClient<any, any, any>>

const SONNET_MODEL    = 'claude-sonnet-4-5-20250929'
const HAIKU_MODEL     = 'claude-haiku-4-5'
const CALL_TIMEOUT_MS  = 60000


// ═══════════════════════════════════════════════════════════════════════════════
// TT SHARED PROMPTS & HELPERS — unified library for all three pipelines
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
11. Concrete nouns over abstractions. Kill an adverb whenever a stronger verb exists.
12. EVERY direct quote must earn its place — it carries information or emotion a paraphrase cannot.
13. ZERO AI fingerprints. BANNED words: delve, landscape, game-changer, revolutionize, cutting-edge, leverage, navigate, paradigm, holistic, robust, comprehensive, essential, crucial, vital, pivotal, foster, bolster, harness, streamline, synergy, ecosystem, spearhead, underpin, unlock, empower, testament, realm, tapestry, beacon, treasure trove, stark reminder, plays a role, sheds light, it is worth noting.
14. SUMMARY: 2-3 sentences, wire-abstract — who did what, where, when, why it matters.
15. EXCERPT: 1-2 sentence hook for preview cards.
16. Do NOT open with a date reference. Open with the news, a provocative claim, or a vivid concrete detail.
17. Tags: lowercase hyphenated slugs
18. Title craft is defined separately (see TITLE_CRAFT block) — do NOT re-derive title rules here., 2-5 words each.

ARTICLE STRUCTURE (NYT/WaPo STANDARD):
- Para 1-2: the lede. Most newsworthy fact, who did what, with what consequence.
- Para 3-4: the nut graf. Why this matters now, what changed, what is at stake.
- Para 5-7: evidence. Specific data, quotes, institutional reactions.
- Para 8-10: context. Historical precedent, comparable situations, expert analysis.
- Para 11+: background, methodology, caveats, opposing viewpoints.
- EVERY paragraph carries at least one specific fact: a name, number, date, or place.
- NO filler. If you cannot add a specific fact to a paragraph, CUT THE PARAGRAPH.`

const ROMANIAN_NATIVE = `REGULI PENTRU ROMÂNĂ NATIVĂ (OBLIGATORII):

PRINCIPIU: Articolul în română NU este o traducere. Gândești în română de la primul cuvânt.

1. STRUCTURĂ: Zero subtitluri. Proză continuă. Fără paragraf de concluzie. Sentence case în titluri.

2. CALCHII INTERZISE (anglicisme și traduceri mecanice) — folosește varianta corectă:
   - "stă ca un testament" / "este un testament al" → "dovedește", "arată", "confirmă"
   - "rezidă în" → "se află în", "constă în"
   - "se traduce în / prin" → "duce la", "înseamnă", "are ca efect"
   - "imersiune" / "imersiv" → "cufundare", "experiență directă"
   - "dansul dintre" → "relația dintre", "jocul dintre" (doar dacă e literal)
   - "se aventurează în" → "intră în", "abordează", "pătrunde în"
   - "fără egal" / "fără pereche" → "unic", "neegalat"
   - "peisajul" (figurat) → "scena", "mediul", "domeniul"
   - "câmpul investițional / educațional / academic / cultural" → "mediul / domeniul X"
   - "a naviga prin / navighează complexitățile" → "a gestiona", "a face față"
   - "la sfârșitul zilei" → "în cele din urmă", "în esență"
   - "un schimbător de joc" / "game-changer" → "o schimbare majoră", "un punct de cotitură"
   - "de ultimă generație" abuzat → numește tehnologia concretă
   - "în era digitală" / "în lumea de azi" → elimină sau numește momentul concret
   - "o mărturie a" → "o dovadă a"
   - "țese o poveste" / "țese împreună" → "leagă", "combină", "împletește" (cu grijă)
   - "într-o lume în care" → începe direct cu faptul
   - "rezilient" / "reziliență" → "rezistent" / "rezistență"
   - "paradigmă investițiilor" → "modelul investițiilor"
   - "acomodări / acomodare specială" → "facilități / facilitate specială" (RO "acomodare" = lodging, NU adjustments)
   - "prima instanță în care" → "primul caz în care" (RO "instanță" = court, NU occurrence)
   - "angajamente academice" → "obligații academice"
   - "libertatea de mișcare" → "libera circulație"
   - "așa cum stă decizia / așa cum se prezintă decizia" → "potrivit deciziei"

3. CONECTORI BIROCRATICI INTERZIȘI (semnătură AI #1 în română):
   - "în cazul în care" → "dacă"
   - "în cadrul (unei/unui/acestei) întâlniri" → "la o întâlnire", "într-o întâlnire"
   - "în vederea + substantiv" → "pentru + substantiv"
   - "în scopul de a / în încercarea de a" → "ca să" sau "pentru a"
   - "care vizează + substantiv" → "pentru + substantiv"
   - "alocările de fonduri" → "fondurile"
   - "deosebit de important" / "de o importanță majoră" → "important"
   - "la acea vreme" → "atunci"

4. VERBE DE ATRIBUIRE: folosește "a declarat", "a spus", "a precizat", "a explicat". INTERZIS ca tic AI: "a subliniat", "a evidențiat", "a accentuat", "a ținut să menționeze", "a punctat", "a atras atenția asupra", "a reamintit".

5. CUVINTE-AMBALAJ INTERZISE: crucial, esențial, vital, fundamental, paradigmă, ecosistem, sinergie, robust, semnificativ, remarcabil, notabil, considerabil, substanțial, deosebit de important, de o importanță majoră, rezilient, reziliență. Toate formele flexionate interzise.

6. "PE MĂSURĂ CE" — maximum O DATĂ pe articol. Alte ocurențe: "în timp ce", "odată ce", "pe când".

7. "ACEST/ACEASTĂ/ACESTE" CA ÎNCEPUT DE PROPOZIȚIE — maximum DE DOUĂ ORI pe articol.

8. REGISTRU NATIV — diacritice corecte peste tot: ă, â, î, ș, ț. Numerale: "12 milioane de euro" (cu "de"), "47 de contracte".

9. TITLUL — craft-ul e definit separat (vezi blocul TITLE_CRAFT). NU re-derivă reguli de titlu aici.

10. DESCHIDERE: Cine/Ce/Unde/Când în primele 2 propoziții. Prima propoziție max 35 de cuvinte.

11. PIRAMIDA INVERSATĂ: cele mai importante fapte în primele 3 paragrafe.

12. FIECARE CIFRĂ primește context: din câți, comparativ cu ce, în ce interval.

13. TAGURI RO: 6-9 slug-uri lowercase cu cratimă, termeni de căutare nativi românești.

14. NATURALEȚE: citește fraza cu voce tare în minte. Dacă sună a traducere, rescrie-o.`


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


const ANTI_HALLUCINATION = `ANTI-HALLUCINATION — HARDEST RULE:

You write ONLY facts present in:
1. The extracted facts list
2. The verified background context
3. The article title itself

NEVER invent:
- Named witnesses, victims, or individuals not in the facts.
- Direct quotes.
- Institutional responses.
- Statistics or rates.
- Geographic claims.
- Causal explanations.
- Future steps.
- Generic context that the source did not provide.

THE TEST: before writing each sentence, point silently to the source fact behind it. If you cannot, cut the sentence.

If after honestly developing every available fact the article is still short of target: submit the shorter article. Do not invent.`

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
- The geography (Florești is next to Cluj-Napoca; Turda is in Cluj county)
- The local institutions
- The mayor's name (after the first mention)
- Local landmarks
- The county's main industries

SPECIFIC BANS:
- Do NOT add "echipa de fotbal locală" before naming a recognized local team.
- Do NOT add "comuna din apropierea Clujului" before a local commune name.
- Do NOT add "primarul orașului X" on second or later mentions.
- Do NOT add "instituția responsabilă de..." before naming a recognized local institution.
- Do NOT explain "Cluj-Napoca, capitala județului Cluj".
- Do NOT explain landmarks the source itself doesn't explain.

When the article is NATIONAL or INTERNATIONAL, light context is allowed.`

const FIRST_PERSON_BAN_RO = `INTERZICEREA PERSOANEI ÎNTÂI (OBLIGATORIE pentru acest tip):
- ZERO persoana întâi singular: "eu", "eu cred", "consider", "mi se pare", "personal", "din punctul meu de vedere", "părerea mea", "experiența mea", "în opinia mea".
- ZERO persoana întâi plural editorială: "noi credem", "noi consideram", "noi trebuie", "noi românii", "redacția noastră".
- ZERO formule cu "se cuvine să", "trebuie să recunoaștem", "să admitem".
- Subiectul acțiunii este NUMIT — autoritatea (cu titlu și instituție), expertul (cu titlu și afiliere), persoana afectată (cu nume, vârstă, ocupație, localitate).
- Verdictul vine din DATE și ATRIBUȚII, nu din voce auctorială.`

const FIRST_PERSON_BAN_EN = `FIRST-PERSON BAN (MANDATORY for this article type):
- ZERO first-person singular: "I", "I think", "I believe", "I consider", "personally", "in my view", "my opinion", "my experience", "it seems to me".
- ZERO editorial first-person plural: "we believe", "we must", "we should", "as a nation", "our readers".
- ZERO constructions like "let us recognize", "we must admit", "one must concede".
- The actor in every sentence is NAMED.
- The verdict comes from DATA and ATTRIBUTED voices, never from an authorial voice.`

const FABRICATION_HARD_STOP = `============================================
FABRICATION HARD STOP - READ FIRST, OBEY ABSOLUTELY
============================================

You will NOT invent quotes. You will NOT invent sources. This rule overrides every other instruction in this prompt.

ATTRIBUTION vs FABRICATION:
- ATTRIBUTION means: "Inspectorii DSP Bihor au constatat ca firma nu detinea autorizatie" / "DSP Bihor inspectors found that the firm lacked authorization". You name the institution that produced the finding. CORRECT JOURNALISM.
- FABRICATION means: "Am constatat lipsa autorizatiilor, a declarat un reprezentant DSP" / "We found the lack of authorization, a DSP representative said". You invent words and put them in someone's mouth. FIRING-OFFENSE JOURNALISM.

The news register asks for "multiple attributed sources". This does NOT mean "multiple direct quotes". You can have ONE direct quote and FIVE attributed sources. Attribution does not require quotation marks.

EXPLICIT RULES:
1. COUNT the direct quotes in the source material. Your article contains AT MOST that many direct quotes. NOT MORE.
2. If a source is not directly quoted in the material, attribute WITHOUT inventing words: "potrivit inspectorilor DSP Bihor" / "according to DSP inspectors". Never with fabricated quotation marks.
3. PLACEHOLDER ATTRIBUTIONS ARE FABRICATION: "un reprezentant", "un oficial", "un purtator de cuvant", "a spokesperson", "an official", "sources said". These are invented humans. NEVER pair them with quotation marks unless the exact words appear in the material.
4. The material may contain the source's editorial voice. If those words are framing, not a direct attributed quote in the material, you do NOT reproduce them as a quote.

VIOLATION TEST: apply before writing every pair of quotation marks:
"Are these EXACT WORDS present in the source material, attributed to a NAMED person or institution?"
- YES: quote and attribute correctly.
- NO: REWRITE THE SENTENCE WITHOUT QUOTATION MARKS. Use indirect attribution instead.
`

function voiceAllowsFirstPerson(articleType: string): boolean {
  return articleType === 'blog' || articleType === 'editorial' || articleType === 'opinie'
}

const CATEGORY_DEPTH: Record<string, string> = {
  politics:  `DEPTH REQUIREMENTS: Name every political actor. State their party affiliation. Quantify stakes. Explain policy consequences. Include at least one direct quote. Reference the legislative timeline.`,
  business:  `DEPTH REQUIREMENTS: Include specific financial figures. Name companies, executives. Explain market impact with numbers. Reference competitor positions.`,
  technology:`DEPTH REQUIREMENTS: Name specific systems, protocols, versions. Explain technical tradeoffs. Reference comparable implementations. Include performance metrics.`,
  culture:   `DEPTH REQUIREMENTS: Provide historical context. Include critical framing. Reference comparable work. Quote artists, curators, or critics.`,
  sports:    `DEPTH REQUIREMENTS: Include match scores, statistics, standings, records. Name players, coaches. Provide tactical analysis.`,
  health:    `DEPTH REQUIREMENTS: Cite specific studies, sample sizes, statistical significance. Name research institutions. Explain methodology.`,
  news:      `DEPTH REQUIREMENTS: Answer Who/What/Where/When/Why/How in the first 3 paragraphs. Include at least 2 attributed sources.`,
  travel:    `DEPTH REQUIREMENTS: Include specific locations, routes, prices, practical details. Reference local customs.`,
  education: `DEPTH REQUIREMENTS: Name specific institutions, programs, rankings. Include enrollment figures. Quote educators.`,
  opinion:   `DEPTH REQUIREMENTS: State the thesis in the first paragraph. Support with at least 3 distinct evidence points. Acknowledge the strongest counterargument.`,
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


// ─── sanitizeContentEn — 110+ rules ───────────────────────────────────────────

function sanitizeContentEn(text: string): string {
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


// ─── sanitizeContentRo — 130+ rules (v7: false-friends, closers, stray-ă) ──

function sanitizeContentRo(text: string): string {
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

  // "Pe măsură ce" limiter
  let pmc = 0
  r = r.replace(/\bPe măsură ce\b/g, (match) => {
    pmc++
    if (pmc === 1) return match
    if (pmc === 2) return 'În timp ce'
    if (pmc === 3) return 'Odată ce'
    return ''
  })

  // "Acest/Această" opener density limit
  let demo = 0
  r = r.replace(/^(Acest[ăa]?|Aceste|Aceasta) /gm, (match) => {
    demo++
    if (demo <= 2) return match
    return ''
  })

  // Negative parallelism in Romanian
  r = r.replace(/\bNu este vorba (doar |numai )?de [^,.]+, ci de /gi, '')
  r = r.replace(/\bNu este doar [^,.]+, ci [și ]+/gi, '')

  // Stray "ă" wrapper-removal artifact safety net
  r = r.replace(/(\p{L})\s+ă\s+(?=\p{L})/gu, '$1 ')

  // Formatting cleanup
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

function parseJsonSafe(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  try { return JSON.parse(cleaned) } catch { /* continue */ }
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}')
  if (s !== -1 && e > s) { try { return JSON.parse(cleaned.substring(s, e + 1)) } catch { /* */ } }
  return null
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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}


// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — Romanian grammar micro-corrector (Haiku 4.5)
// ═══════════════════════════════════════════════════════════════════════════

async function callHaikuGrammar(
  system: string, user: string, maxTokens: number,
): Promise<{ text: string; error?: string }> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) return { text: '', error: 'CLAUDE_API_KEY not set' }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: maxTokens,
        temperature: 0.0,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const raw = await res.text()
    if (!res.ok) return { text: '', error: `Haiku ${res.status}: ${raw.substring(0, 200)}` }
    const data = JSON.parse(raw)
    return { text: data?.content?.[0]?.text || '' }
  } catch (e) { return { text: '', error: `Haiku: ${(e as Error).message}` } }
}

async function grammarCorrectorRo(content: string): Promise<string> {
  if (!content || content.length < 200) return content
  const system = `Ești corector gramatical pentru română jurnalistică. Misiunea ta este UNICĂ și STRICT LIMITATĂ: să repari artefactele gramaticale lăsate de un sanitizer automat care a eliminat cuvinte. NU rescrii. NU reformulezi. NU schimbi sensul. NU adaugi sau scoți fapte.

REPARĂ DOAR:
1. Articole orfane sau acord rupt: "o decizie a guvernului" rămas "o a guvernului" → "a guvernului". "Acest decizie" → "Această decizie". "Au fost luate decizii crucial" → "Au fost luate decizii".
2. Prepoziții suspendate sau duplicate: "împreună cu cu" → "împreună cu". "din din partea" → "din partea". "către către" → "către".
3. "ă" izolat fără sens între cuvinte: "o victorie ă împotriva" → "o victorie împotriva". "decizia ă luată" → "decizia luată".
4. Punctuație: spații înaintea virgulei sau punctului, virgule duble, punct după virgulă, lipsa virgulei înainte de "că" și "dacă" subordonate.
5. Cacofonie evidentă: "ca care" → "drept care" / "pe care". "să să" → "să".
6. Diacritice greșite: ș→s, ț→t doar dacă apare clar greșit; NU adăuga diacritice care nu erau în text.
7. Genitiv-dativ rupt: "decizia a guvernului" → "decizia guvernului". "împotriva a deciziei" → "împotriva deciziei".
8. Concordanță gen/număr evidentă pentru rezidu-uri de adjective stripate: "măsura important" → "măsura" (adjectivul rezidual e șters, NU se rescrie).

INTERZIS:
- NU rescrie propoziții.
- NU schimba topica.
- NU înlocui cuvinte cu sinonime.
- NU adăuga conectori, tranziții, comentarii.
- NU schimba citatele directe (între ghilimele).
- NU adăuga sau scoți paragrafe.
- NU schimba numerele, numele proprii, datele, instituțiile.
- NU adăuga cuvinte care nu rezolvă un artefact gramatical.

REGULA DE AUR: dacă fraza este corectă gramatical, o lași EXACT cum este. Dacă schimbi peste 5% din cuvinte, ai greșit misiunea.

Returnezi DOAR JSON: {"content": "textul corectat cu \\n\\n între paragrafe"}`

  const user = `TEXT DE CORECTAT (păstrează exact structura, paragrafele, numerele, numele):

${content}

Returnează JSON cu textul corectat.`

  const tokenBudget = Math.min(8000, Math.max(2000, Math.ceil(content.length / 2)))
  const result = await callHaikuGrammar(system, user, tokenBudget)
  if (result.error || !result.text) {
    console.warn(`[grammar-ro] Haiku failed: ${result.error || 'empty'} — keeping original`)
    return content
  }

  const parsed = parseJsonSafe(result.text)
  const corrected = (parsed?.content as string) || ''
  if (!corrected || corrected.length < 100) {
    console.warn('[grammar-ro] empty corrected content — keeping original')
    return content
  }

  const lenRatio = corrected.length / content.length
  if (lenRatio < 0.85 || lenRatio > 1.10) {
    console.warn(`[grammar-ro] length deviation ${(lenRatio * 100).toFixed(0)}% — keeping original`)
    return content
  }
  if (!isRomanianText(corrected)) {
    console.warn('[grammar-ro] result failed Romanian language check — keeping original')
    return content
  }

  return corrected.trim()
}


// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — Humanness enforcement loop
// ═══════════════════════════════════════════════════════════════════════════

async function callSonnetForRevision(
  system: string, user: string, maxTokens: number,
): Promise<{ text: string; error?: string }> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) return { text: '', error: 'CLAUDE_API_KEY not set' }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 45000)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: maxTokens,
        temperature: 0.55,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const raw = await res.text()
    if (!res.ok) return { text: '', error: `Sonnet revision ${res.status}: ${raw.substring(0, 200)}` }
    const data = JSON.parse(raw)
    return { text: data?.content?.[0]?.text || '' }
  } catch (e) { return { text: '', error: `Sonnet revision: ${(e as Error).message}` } }
}

function buildHumannessRevisionPrompt(flags: string[], lang: 'ro' | 'en'): string {
  const targeted: string[] = []
  for (const f of flags) {
    if (f.startsWith('LOW_BURSTINESS') || f.startsWith('MODERATE_BURSTINESS')) {
      targeted.push(lang === 'ro'
        ? 'BURSTINESS: variază AGRESIV lungimile propozițiilor. Introdu cel puțin trei propoziții sub 8 cuvinte ȘI cel puțin trei peste 25 de cuvinte. Niciodată două propoziții consecutive cu lungimi apropiate (sub 5 cuvinte diferență). Include un fragment fără verb pentru impact.'
        : 'BURSTINESS: vary sentence lengths AGGRESSIVELY. Include at least three sentences under 8 words AND at least three over 25 words. Never two consecutive sentences within 5 words of each other. Include one verbless fragment for impact.')
    } else if (f.startsWith('UNIFORM_LENGTHS')) {
      targeted.push(lang === 'ro'
        ? 'UNIFORM_LENGTHS: prea multe propoziții consecutive de lungime similară. Sparge tiparul: o propoziție foarte scurtă urmată de una foarte lungă, sau invers.'
        : 'UNIFORM_LENGTHS: too many consecutive sentences of similar length. Break the pattern: a very short sentence followed by a very long one, or vice versa.')
    } else if (f.startsWith('UNIFORM_PARAGRAPHS')) {
      targeted.push(lang === 'ro'
        ? 'UNIFORM_PARAGRAPHS: paragrafele sunt prea uniforme ca lungime. Include cel puțin un paragraf de 1-2 propoziții ȘI cel puțin unul de 5+ propoziții.'
        : 'UNIFORM_PARAGRAPHS: paragraphs are too uniform in length. Include at least one 1-2 sentence paragraph AND at least one 5+ sentence paragraph.')
    } else if (f.startsWith('DEMONSTRATIVE_OVERKILL')) {
      targeted.push(lang === 'ro'
        ? 'DEMONSTRATIVE_OVERKILL: prea multe propoziții încep cu "Acest/Această/Aceste/Aceasta". Reformulează majoritatea folosind numele specific, un pronume, sau restructurând propoziția. Maximum 2 ocurențe în întreg articolul.'
        : 'DEMONSTRATIVE_OVERKILL: too many sentences start with "This/These/That". Reformulate most using the specific noun, a pronoun, or restructuring. Maximum 2 occurrences in the entire article.')
    } else if (f.startsWith('PMC_REPEAT')) {
      targeted.push('PMC_REPEAT: "Pe măsură ce" apare de mai multe ori. Maximum O DATĂ pe articol. Restul: "în timp ce", "odată ce", "pe când", sau restructurează.')
    } else if (f.startsWith('SPECULATIVE_ENDING')) {
      targeted.push(lang === 'ro'
        ? 'SPECULATIVE_ENDING: ultimele paragrafe conțin "este de așteptat / va fi probabil / rămâne de văzut / viitorul va...". Șterge speculația. Încheie pe ULTIMUL FAPT verificabil sau ULTIMA DECLARAȚIE ATRIBUITĂ.'
        : 'SPECULATIVE_ENDING: closing paragraphs contain "is expected to / will likely / remains to be seen / the future will...". Cut the speculation. Close on the LAST verifiable fact or the LAST attributed statement.')
    } else if (f.startsWith('TRANSITION_REPEAT')) {
      targeted.push(lang === 'ro'
        ? `TRANSITION_REPEAT (${f}): un cuvânt de tranziție apare repetat. Variază tranzițiile sau elimină-le pe cele inutile.`
        : `TRANSITION_REPEAT (${f}): a transition word is repeated. Vary transitions or remove the unnecessary ones.`)
    } else if (f.startsWith('AI_VOCAB')) {
      targeted.push(lang === 'ro'
        ? `AI_VOCAB (${f}): vocabular tipic AI prezent (semnificativ/considerabil/remarcabil/esențial/crucial/vital/paradigm/ecosistem/sinergie/reziliență). Înlocuiește cu termenii concreți potriviți contextului.`
        : `AI_VOCAB (${f}): typical AI vocabulary present (delve/landscape/robust/comprehensive/leverage/foster/seamless/holistic/paradigm/ecosystem/synergy). Replace with concrete terms suited to the context.`)
    }
  }
  return targeted.length
    ? targeted.join('\n\n')
    : (lang === 'ro' ? 'Probleme generale de naturalețe: variază ritmul propozițiilor și structura paragrafelor.' : 'General naturalness issues: vary sentence rhythm and paragraph structure.')
}

async function humannessEnforceLoop(
  content: string, lang: 'ro' | 'en', budgetMs: number,
): Promise<{ content: string; before: number; after: number; applied: boolean }> {
  const before = measureHumanness(content, lang)
  if (before.score >= 85 || budgetMs < 30000) {
    return { content, before: before.score, after: before.score, applied: false }
  }

  const targeted = buildHumannessRevisionPrompt(before.flags, lang)
  const system = lang === 'ro'
    ? `Ești editor senior la Transilvania Times. Primești un articol care a eșuat verificarea de naturalețe pe TIPARELE SPECIFICE listate mai jos. Misiunea ta: corectezi DOAR aceste tipare, fără să schimbi NIMIC altceva.

REGULI INTANGIBILE:
- NU schimba NICIUN fapt, NUME, CIFRĂ, DATĂ, CITAT DIRECT, INSTITUȚIE.
- NU adăuga informații noi.
- NU schimba lungimea articolului cu mai mult de 5%.
- NU adăuga sau scoate paragrafe (păstrează același număr).
- NU adăuga sau scoate citate directe.
- Reformulează DOAR ca să spargi tiparele de mai jos.

TIPARE DE REPARAT (acestea sunt singurele probleme — restul textului rămâne neschimbat):

${targeted}

OUTPUT: JSON only, fără preambul, fără markdown. Paragrafe separate prin \\n\\n.
{"content":"..."}`
    : `You are a senior editor at Transilvania Times. You receive an article that failed the naturalness check on the SPECIFIC PATTERNS listed below. Your job: fix ONLY these patterns, changing NOTHING else.

UNTOUCHABLE RULES:
- Do NOT change any fact, NAME, NUMBER, DATE, DIRECT QUOTE, INSTITUTION.
- Do NOT add new information.
- Do NOT change article length by more than 5%.
- Do NOT add or remove paragraphs (keep the same count).
- Do NOT add or remove direct quotes.
- Reformulate ONLY to break the patterns below.

PATTERNS TO FIX (these are the only issues — the rest of the text stays unchanged):

${targeted}

OUTPUT: JSON only, no preamble, no markdown. Paragraphs separated by \\n\\n.
{"content":"..."}`

  const user = lang === 'ro'
    ? `ARTICOL (corectează DOAR tiparele de mai sus):\n\n${content}\n\nVersiunea corectată (JSON):`
    : `ARTICLE (fix ONLY the patterns above):\n\n${content}\n\nCorrected version (JSON):`

  const tokenBudget = Math.min(10000, Math.max(4000, Math.ceil(content.length / 1.5)))
  const result = await callSonnetForRevision(system, user, tokenBudget)
  if (result.error || !result.text) {
    console.warn(`[humanness-loop-${lang}] revision failed: ${result.error || 'empty'} — keeping original`)
    return { content, before: before.score, after: before.score, applied: false }
  }

  const parsed = parseJsonSafe(result.text)
  let revised = (parsed?.content as string) || ''
  if (!revised || revised.length < 100) {
    return { content, before: before.score, after: before.score, applied: false }
  }

  revised = lang === 'ro'
    ? ensureParagraphs(sanitizeContentRo(revised))
    : ensureParagraphs(sanitizeContentEn(revised))

  const lenRatio = revised.length / content.length
  if (lenRatio < 0.85 || lenRatio > 1.15) {
    console.warn(`[humanness-loop-${lang}] revision length ratio ${(lenRatio * 100).toFixed(0)}% — keeping original`)
    return { content, before: before.score, after: before.score, applied: false }
  }
  if (lang === 'ro' && !isRomanianText(revised)) {
    console.warn(`[humanness-loop-${lang}] revision failed RO check — keeping original`)
    return { content, before: before.score, after: before.score, applied: false }
  }

  const after = measureHumanness(revised, lang)
  if (after.score <= before.score) {
    console.log(`[humanness-loop-${lang}] revision scored ${after.score} <= ${before.score} — keeping original`)
    return { content, before: before.score, after: before.score, applied: false }
  }

  console.log(`[humanness-loop-${lang}] revision lifted score ${before.score} → ${after.score}, flags: ${before.flags.join(',')} → ${after.flags.join(',') || 'OK'}`)
  return { content: revised, before: before.score, after: after.score, applied: true }
}


// ═══════════════════════════════════════════════════════════════════════════════
// FUNCTION-SPECIFIC CODE — rewrite pipeline
// ═══════════════════════════════════════════════════════════════════════════════

function getTargetWordCount(srcWords: number, editor: string): { min: number; max: number; target: number } {
  const isVictor = editor === 'victor_simon'
  if (isVictor) {
    if (srcWords > 0 && srcWords < 300) return { min: 500, max: 800, target: 650 }
    return { min: 700, max: 1000, target: 850 }
  }
  if (srcWords > 0 && srcWords < 150) return { min: 700, max: 950, target: 820 }
  if (srcWords < 300)                 return { min: 950, max: 1250, target: 1100 }
  return { min: 1200, max: 1400, target: 1300 }
}

async function fetchWithRetry(url: string, options: RequestInit, label: string, maxRetries = 2): Promise<Response> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
    try {
      const res = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timer)
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue
      }
      return res
    } catch (e) {
      clearTimeout(timer); lastErr = e as Error
      if (attempt < maxRetries) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue }
    }
  }
  throw lastErr || new Error(`${label}: retries exhausted`)
}

async function callGPT4o(system: string, user: string, maxTokens = 8000): Promise<{ text: string; error?: string }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) return { text: '', error: 'OPENAI_API_KEY not set' }
  try {
    const res = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o', response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.55, max_tokens: maxTokens,
      }),
    }, 'gpt4o')
    const raw = await res.text()
    if (!res.ok) return { text: '', error: `GPT-4o ${res.status}: ${raw.substring(0, 200)}` }
    const data = JSON.parse(raw)
    return { text: data.choices?.[0]?.message?.content || '' }
  } catch (e) { return { text: '', error: `GPT-4o: ${(e as Error).message}` } }
}

async function callSonnet(system: string, user: string, maxTokens = 8000, temperature = 0.55): Promise<{ text: string; error?: string }> {
  const apiKey = Deno.env.get('CLAUDE_API_KEY')
  if (!apiKey) return { text: '', error: 'CLAUDE_API_KEY not set' }
  try {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: SONNET_MODEL, max_tokens: maxTokens, temperature, system, messages: [{ role: 'user', content: user }] }),
    }, 'sonnet')
    const raw = await res.text()
    if (!res.ok) return { text: '', error: `Sonnet ${res.status}: ${raw.substring(0, 200)}` }
    const data = JSON.parse(raw)
    return { text: data?.content?.[0]?.text || '' }
  } catch (e) { return { text: '', error: `Sonnet: ${(e as Error).message}` } }
}

async function callPolishModel(
  system: string, user: string, maxTokens: number, temperature: number, label: string,
): Promise<{ text: string; provider: 'sonnet' | 'gpt4o' | null; error?: string }> {
  const sonnet = await callSonnet(system, user, maxTokens, temperature)
  if (!sonnet.error && sonnet.text && sonnet.text.length > 50) {
    return { text: sonnet.text, provider: 'sonnet' }
  }
  const sonnetErr = sonnet.error || 'empty response'
  console.warn(`[${label}] Sonnet failed (${sonnetErr.substring(0, 100)}) — fallback to GPT-4o`)
  const gpt = await callGPT4o(system, user, Math.min(maxTokens, 14000))
  if (!gpt.error && gpt.text && gpt.text.length > 50) {
    return { text: gpt.text, provider: 'gpt4o' }
  }
  return { text: '', provider: null, error: `Both providers failed — Sonnet: ${sonnetErr.substring(0, 80)} | GPT-4o: ${(gpt.error || 'empty').substring(0, 80)}` }
}

async function writeOneLanguage(
  lang: 'en' | 'ro', material: string, materialLang: string, seedTitle: string,
  editor: string, category: string, articleType: string,
  len: { min: number; max: number; target: number },
): Promise<Record<string, unknown> | null> {
  const editorName = getEditorDisplayName(editor, lang)
  const editorVoice = getEditorVoice(editor, lang)
  const toneVoice = getToneVoice(articleType, lang)
  const catDepth = CATEGORY_DEPTH[category] || CATEGORY_DEPTH.news
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const allowFirstPerson = voiceAllowsFirstPerson(articleType)

  const langRules = lang === 'ro'
    ? `${ROMANIAN_NATIVE}\n\nScrie DIRECT în română, gândind în română de la primul cuvânt. Aceasta este o versiune românească de sine stătătoare, nu o traducere.`
    : `Write in clear, vigorous journalistic English to NYT/WaPo standard. This English article stands alone.`

  const firstPersonClause = lang === 'ro'
    ? (allowFirstPerson ? '' : '\n\n' + FIRST_PERSON_BAN_RO)
    : (allowFirstPerson ? '' : '\n\n' + FIRST_PERSON_BAN_EN)

  const humanizationBlock = lang === 'ro' ? HUMANIZATION_RO : HUMANIZATION_EN

  const systemPrompt = `Current date: ${dateStr}. You are ${editorName}, journalist at Transilvania Times, rewriting an existing article of yours to lift it to publishing standard, in ${lang === 'ro' ? 'Romanian' : 'English'}. The facts stay; the voice, structure, and depth are elevated.

${FABRICATION_HARD_STOP}

EDITOR SIGNATURE — ${editor.toUpperCase()}
${editorVoice}

TYPE REGISTER — ${articleType.toUpperCase()}
${toneVoice}

ANTI-HALLUCINATION
${ANTI_HALLUCINATION}

ANTI-PADDING
${ANTI_PADDING}

LOCAL AUDIENCE DISCIPLINE
${LOCAL_AUDIENCE_DISCIPLINE}

NYT/WaPo-GRADE RULES
${RULES}

LANGUAGE RULES
${langRules}${firstPersonClause}

CATEGORY-SPECIFIC DEPTH
${catDepth}

MASTER HUMANIZING CONSTRAINTS
${MASTER_HUMANIZING}

DETAILED HUMANIZATION
${humanizationBlock}

TITLE CRAFT
${lang === 'ro' ? TITLE_CRAFT_RO : TITLE_CRAFT_EN}

TASK: rewrite the existing article as a complete ${lang === 'ro' ? 'native Romanian' : 'English'} article. Keep every fact. Do NOT invent. Reach the target length by developing facts, never by padding.

TARGET LENGTH: ${len.min}-${len.max} words (optimal ${len.target}). Category: ${category}.

OUTPUT — JSON only, no preamble, no markdown fences:
{
  "title_${lang}":"...",
  "excerpt_${lang}":"...",
  "summary_${lang}":"...",
  "content_${lang}":"... (\\n\\n between paragraphs)",
  "tags_${lang}":["tag-1"],
  "seo_title_${lang}":"...",
  "seo_description_${lang}":"..."
}`

  const userPrompt = `EXISTING ARTICLE (${materialLang}):\n\nTitle: ${seedTitle}\n\n${material}\n\nRewrite the complete ${lang === 'ro' ? 'native Romanian' : 'English'} article now (${len.min}-${len.max} words). JSON only.`

  const tokenBudget = Math.min(14000, Math.max(4000, Math.ceil(len.max * 8)))
  const result = await callGPT4o(systemPrompt, userPrompt, tokenBudget)
  if (result.error) {
    const sFallback = await callSonnet(systemPrompt, userPrompt, Math.min(12000, tokenBudget), 0.55)
    return sFallback.error ? null : parseJsonSafe(sFallback.text)
  }
  return parseJsonSafe(result.text)
}

async function polishOneLanguage(
  lang: 'en' | 'ro', editor: string, articleType: string,
  title: string, content: string, len: { min: number; max: number; target: number },
): Promise<{ title: string; content: string } | null> {
  const editorName = getEditorDisplayName(editor, lang)
  const editorVoice = getEditorVoice(editor, lang)
  const toneVoice = getToneVoice(articleType, lang)
  const humanizationBlock = lang === 'ro' ? HUMANIZATION_RO : HUMANIZATION_EN
  const langRules = lang === 'ro' ? ROMANIAN_NATIVE : ''

  const system = lang === 'ro'
    ? `Ești ${editorName}, jurnalist la Transilvania Times. Îmbunătățește fluența, ritmul și vocea, păstrând exact aceleași fapte. NU adăuga. NU schimba cifre, nume, date, citate. Păstrează lungimea (~${len.target} cuvinte). Fără subtitluri.

SEMNĂTURA EDITORULUI
${editorVoice}

REGISTRUL TIPULUI — ${articleType.toUpperCase()}
${toneVoice}

${langRules}

${MASTER_HUMANIZING}

${humanizationBlock}

${TITLE_CRAFT_RO}

JSON only: {"title":"...","content":"..."}`
    : `You are ${editorName}, journalist at Transilvania Times. Improve flow, rhythm, voice while keeping EXACTLY the same facts. Do NOT add or change numbers/names/dates/quotes. Keep length (~${len.target} words). No subheadings.

EDITOR SIGNATURE
${editorVoice}

TYPE REGISTER — ${articleType.toUpperCase()}
${toneVoice}

${MASTER_HUMANIZING}

${humanizationBlock}

${TITLE_CRAFT_EN}

JSON only: {"title":"...","content":"..."}`

  const user = lang === 'ro'
    ? `TITLU: ${title}\n\nARTICOL (${countWords(content)} cuvinte):\n${content}\n\nVersiunea îmbunătățită (JSON):`
    : `TITLE: ${title}\n\nARTICLE (${countWords(content)} words):\n${content}\n\nImproved version (JSON):`

  const polishTokens = Math.min(10000, Math.max(4096, Math.ceil(len.max * 6)))
  const result = await callPolishModel(system, user, polishTokens, 0.5, `rewrite:polish-${lang}`)
  if (result.error) return null
  if (result.provider === 'gpt4o') console.log(`[rewrite] polish-${lang} used GPT-4o fallback`)
  const parsed = parseJsonSafe(result.text)
  if (!parsed) return null
  const c = (parsed.content as string) || ''
  const wc = countWords(c)
  if (c.length < 400 || wc < Math.floor(len.min * 0.5) || wc > Math.ceil(len.max * 1.5)) return null
  if (lang === 'ro' && !isRomanianText(c)) return null
  return { title: (parsed.title as string) || title, content: c }
}

function inferArticleType(category: string, content: string): string {
  const c = content.toLowerCase()
  if (category === 'opinion') return 'editorial'
  if (c.includes('reportaj') || c.includes('feature')) return 'reportaj'
  if (c.includes('analiză') || c.includes('analysis')) return 'analiza'
  if (category === 'technology') return 'tehnologie'
  if (category === 'culture') return 'cultura'
  return 'news'
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const t0 = Date.now()
  // Soft time budget for the whole request (rewrite has a generous 240s edge runtime).
  // We track this so the Phase 2 humanness loop and grammar corrector don't risk timeouts.
  const TOTAL_SOFT_LIMIT_MS = 240000
  const budgetRemaining = () => TOTAL_SOFT_LIMIT_MS - (Date.now() - t0)

  try {
    const body = await req.json().catch(() => ({})) as { post_id?: string; blog_post_id?: string; id?: string }
    const postId = body.post_id || body.blog_post_id || body.id
    if (!postId) {
      return new Response(JSON.stringify({ ok: false, error: 'post_id required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const supabase: SupaClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: postData, error: postErr } = await supabase
      .from('blog_posts')
      .select('id, title_ro, title_en, content_ro, content_en, excerpt_ro, excerpt_en, summary_ro, summary_en, tags_ro, tags_en, seo_title_ro, seo_title_en, seo_description_ro, seo_description_en, category, subcategory, ai_editor, source_url, scraped_article_id')
      .eq('id', postId).single()
    if (postErr || !postData) {
      return new Response(JSON.stringify({ ok: false, error: `Post not found: ${postErr?.message || 'no row'}` }), {
        status: 404, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const post = postData as Record<string, unknown>

    const category = (post.category as string) || 'news'
    let editor = (post.ai_editor as string) || EDITOR_BY_CATEGORY[category] || DEFAULT_EDITOR_KEY
    if (!ALLOWED_EDITOR_KEYS.includes(editor)) editor = EDITOR_BY_CATEGORY[category] || DEFAULT_EDITOR_KEY

    const sourceEn = (post.content_en as string) || ''
    const sourceRo = (post.content_ro as string) || ''
    const seedTitle = (post.title_en as string) || (post.title_ro as string) || ''
    if (!sourceEn && !sourceRo) {
      return new Response(JSON.stringify({ ok: false, error: 'Post has no content to rewrite' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }
    const material = sourceEn || sourceRo
    const materialLang = sourceEn ? 'EN' : 'RO'
    const len = getTargetWordCount(countWords(material), editor)
    const articleType = inferArticleType(category, material)

    console.log(`[rewrite v8] START — post=${postId}, editor=${editor}, type=${articleType}, target=${len.target}w`)

    const [enDraft, roDraft] = await Promise.all([
      writeOneLanguage('en', material, materialLang, seedTitle, editor, category, articleType, len),
      writeOneLanguage('ro', material, materialLang, seedTitle, editor, category, articleType, len),
    ])

    if (!enDraft) {
      return new Response(JSON.stringify({ ok: false, error: 'Rewrite failed (EN writer returned null)' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    let titleEn   = sanitizeTitle(sanitizeContentEn((enDraft.title_en as string) || (post.title_en as string) || ''))
    let contentEn = ensureParagraphs(sanitizeContentEn((enDraft.content_en as string) || ''))
    const excerptEn = sanitizeContentEn((enDraft.excerpt_en as string) || '')
    const summaryEn = sanitizeContentEn((enDraft.summary_en as string) || excerptEn)
    const tagsEn = normalizeTags((enDraft.tags_en as unknown[]) || [])
    const seoTitleEn = sanitizeTitle(sanitizeContentEn((enDraft.seo_title_en as string) || ''))
    const seoDescEn = sanitizeContentEn((enDraft.seo_description_en as string) || '')

    if (!contentEn || contentEn.length < 200) {
      return new Response(JSON.stringify({ ok: false, error: 'Rewrite produced English content too short' }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    let titleRo = '', contentRo = '', excerptRo = '', summaryRo = '', seoTitleRo = '', seoDescRo = ''
    let tagsRo: string[] = []
    let roOk = false
    if (roDraft) {
      contentRo = ensureParagraphs(sanitizeContentRo((roDraft.content_ro as string) || ''))
      roOk = isRomanianText(contentRo) && contentRo.length >= 200
      if (roOk) {
        titleRo = sanitizeTitle(sanitizeContentRo((roDraft.title_ro as string) || ''))
        excerptRo = sanitizeContentRo((roDraft.excerpt_ro as string) || '')
        summaryRo = sanitizeContentRo((roDraft.summary_ro as string) || excerptRo)
        tagsRo = normalizeTags((roDraft.tags_ro as unknown[]) || [])
        seoTitleRo = sanitizeTitle(sanitizeContentRo((roDraft.seo_title_ro as string) || ''))
        seoDescRo = sanitizeContentRo((roDraft.seo_description_ro as string) || '')
      }
    }
    if (!roOk) console.warn(`[rewrite v8] post ${postId}: RO failed/absent — updating EN only`)

    // ── PHASE 2 — Romanian grammar corrector (Haiku 4.5)
    // Runs AFTER sanitizeContentRo, BEFORE polish. Repairs artifacts from wrapper stripping.
    if (roOk && budgetRemaining() > 40000) {
      const correctedRo = await grammarCorrectorRo(contentRo)
      if (correctedRo !== contentRo) {
        contentRo = ensureParagraphs(sanitizeContentRo(correctedRo))
        console.log(`[rewrite v8] grammar corrector applied to RO`)
      }
    }

    if (roOk && budgetRemaining() > 30000) {
      const p = await polishOneLanguage('ro', editor, articleType, titleRo, contentRo, len)
      if (p) { contentRo = ensureParagraphs(sanitizeContentRo(p.content)); const pt = sanitizeTitle(sanitizeContentRo(p.title)); if (pt.length >= 8) titleRo = pt }
    }
    if (budgetRemaining() > 30000) {
      const p = await polishOneLanguage('en', editor, articleType, titleEn, contentEn, len)
      if (p) { contentEn = ensureParagraphs(sanitizeContentEn(p.content)); const pt = sanitizeTitle(sanitizeContentEn(p.title)); if (pt.length >= 8) titleEn = pt }
    }

    contentEn = enforceVoicePerson(contentEn, articleType, 'en')
    contentRo = enforceVoicePerson(contentRo, articleType, 'ro')
    titleEn = enforceVoicePerson(titleEn, articleType, 'en')
    titleRo = enforceVoicePerson(titleRo, articleType, 'ro')

    // ── PHASE 2 — Humanness enforcement loop
    // Runs AFTER first-person enforcement. If score < 75, one targeted Sonnet revision.
    const humanEnInitial = measureHumanness(contentEn, 'en')
    const humanRoInitial = roOk ? measureHumanness(contentRo, 'ro') : null
    console.log(`[rewrite v8] humanness pre-loop — EN ${humanEnInitial.score}/100 ${humanEnInitial.flags.length ? humanEnInitial.flags.join(',') : 'OK'}`)
    if (humanRoInitial) console.log(`[rewrite v8] humanness pre-loop — RO ${humanRoInitial.score}/100 ${humanRoInitial.flags.length ? humanRoInitial.flags.join(',') : 'OK'}`)

    const enLoop = await humannessEnforceLoop(contentEn, 'en', budgetRemaining())
    contentEn = enLoop.content
    let roLoopResult = { applied: false, before: humanRoInitial?.score ?? 0, after: humanRoInitial?.score ?? 0 }
    if (roOk) {
      const roLoop = await humannessEnforceLoop(contentRo, 'ro', budgetRemaining())
      contentRo = roLoop.content
      roLoopResult = roLoop
    }

    const humanEn = measureHumanness(contentEn, 'en')
    const humanRo = roOk ? measureHumanness(contentRo, 'ro') : null
    console.log(`[rewrite v8] humanness final — EN ${humanEn.score}/100 ${humanEn.flags.length ? humanEn.flags.join(',') : 'OK'}${enLoop.applied ? ' [loop applied]' : ''}`)
    if (humanRo) console.log(`[rewrite v8] humanness final — RO ${humanRo.score}/100 ${humanRo.flags.length ? humanRo.flags.join(',') : 'OK'}${roLoopResult.applied ? ' [loop applied]' : ''}`)

    const updates: Record<string, unknown> = {
      title_en: titleEn, content_en: contentEn, excerpt_en: excerptEn, summary_en: summaryEn,
      tags_en: tagsEn, seo_title_en: seoTitleEn, seo_description_en: seoDescEn,
      ai_editor: editor, word_count: countWords(contentEn), updated_at: new Date().toISOString(),
    }
    if (roOk) {
      updates.title_ro = titleRo; updates.content_ro = contentRo; updates.excerpt_ro = excerptRo
      updates.summary_ro = summaryRo; updates.tags_ro = tagsRo
      updates.seo_title_ro = seoTitleRo; updates.seo_description_ro = seoDescRo
    }

    const { error: updErr } = await supabase.from('blog_posts').update(updates).eq('id', postId)
    if (updErr) {
      return new Response(JSON.stringify({ ok: false, error: `DB update failed: ${updErr.message}` }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    console.log(`[rewrite v8] post ${postId}: editor=${editor}, type=${articleType}, RO_ok=${roOk}, EN_wc=${countWords(contentEn)}, RO_wc=${countWords(contentRo)}, ${((Date.now()-t0)/1000).toFixed(1)}s`)
    return new Response(
      JSON.stringify({
        ok: true, post_id: postId, editor, article_type: articleType, ro_ok: roOk,
        en_word_count: countWords(contentEn), ro_word_count: countWords(contentRo),
        humanness_en: humanEn.score, humanness_ro: humanRo?.score ?? null,
        humanness_loop_en: enLoop.applied, humanness_loop_ro: roLoopResult.applied,
      }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    const msg = (e as Error).message || 'unknown'
    console.error(`[rewrite v8] FATAL: ${msg}`)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})