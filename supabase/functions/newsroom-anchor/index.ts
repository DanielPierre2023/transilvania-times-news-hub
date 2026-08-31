// supabase/functions/newsroom-anchor/index.ts
//
// NEWSROOM — daily AI news-anchor video pipeline (HeyGen lipsync).
//
// Actions:
//   { action:'script', language:'ro'|'en', target_seconds, articles:[{title,summary}] }
//       -> { script }   (Claude via CLAUDE_API_KEY, OpenAI fallback. Model ids
//                        are the CLAUDE_MODEL / OPENAI_MODEL constants below,
//                        overridable by Supabase secrets of the same name.)
//   { action:'avatars' }
//       -> { configured, avatars:[{avatar_id, avatar_name, preview_image_url}] }
//   { action:'upload_photo', image_url, consent:{granted, person_name} }
//       -> { talking_photo_id }   (HeyGen talking photo; CONSENT REQUIRED)
//   { action:'generate', character:{type:'avatar',avatar_id}|{type:'talking_photo',talking_photo_id},
//     audio_url, width, height, background_color? }
//       -> { video_id }
//   { action:'status', video_id }
//       -> { status } ; on completed: stores MP4 to studio-assets/newsroom/ -> { status:'completed', publicUrl }
//
// Env: HEYGEN_API_KEY, CLAUDE_API_KEY (optional), OPENAI_API_KEY,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── MODEL CONFIGURATION ───────────────────────────────────────────────────
// ADDED 31 Aug 2026. claude-sonnet-4-5-20250929 was hard-coded in EIGHT places
// in this file and retires on 29 September 2026. A hard-coded model id is an
// outage with a calendar entry: the day it retires, every call here returns
// 404 and the newsroom stops.
//
// Both ids are now single constants AND overridable by a Supabase secret, so
// the next migration is one secret edit — no redeploy, no code review, no risk
// of missing an occurrence.
//
// claude-sonnet-5 is the canonical pinned id for its release: from the 4.6
// generation on, Anthropic dropped the dated suffix and the dateless id maps to
// one fixed snapshot whose weights are never changed underneath you. This is a
// pin, not a floating alias.
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL')?.trim() || 'claude-sonnet-5';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-4o-2024-11-20';

// USD per MILLION tokens, list price. Covers every current model so that
// switching CLAUDE_MODEL by secret stays correctly costed. Sonnet 5 is $2/$10
// — CHEAPER than the
// $3/$15 of Sonnet 4.5, so keeping the old numbers would have overstated every
// future row in ai_spend_log by roughly 50%.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  'claude-fable-5': { in: 10.00, out: 50.00 },
  'claude-opus-5': { in: 5.00, out: 25.00 },
  'claude-sonnet-5': { in: 2.00, out: 10.00 },
  'claude-haiku-4-5-20251001': { in: 1.00, out: 5.00 },
  'claude-sonnet-4-5-20250929': { in: 3.00, out: 15.00 },
  'gpt-4o-2024-11-20': { in: 2.50, out: 10.00 },
};

/** Cost of one call. An unknown model (someone set the secret to something new)
 *  falls back to the Sonnet-5 rate rather than logging $0 — an unpriced call
 *  must never look like a free one. */
function usdFor(model: string, inTok: number, outTok: number): number {
  // Unknown model -> price it at the MOST EXPENSIVE rate we know, not the
  // cheapest. A ledger that under-reports is worse than one that over-reports:
  // an unpriced call must never look cheaper than it might actually be.
  const rate = PRICE_PER_MTOK[model] ?? { in: 10.00, out: 50.00 };
  return (inTok / 1e6) * rate.in + (outTok / 1e6) * rate.out;
}



// ══════════════════════════════════════════════════════════════════════════
// ROMANIAN BROADCAST NUMBERS — runs at SCRIPT time, not at voice time.
//
// WHY HERE AND NOT IN generate-voiceover (the 31 Aug lesson)
//
// The compositor times every lower-third by taking a story's opening words AS
// WRITTEN and finding them in the word timeline of the ACTUAL audio. That only
// works while the written script and the spoken audio are the same words.
//
// The first version of this ran inside generate-voiceover, so the script box
// said "139" while the audio said "o sută treizeci și nouă". Every probe missed,
// every headline anchored to the wrong second, and the bulletin drifted.
//
// So the conversion happens ONCE, here, and its output IS the script: what the
// operator reads, what the compositor times against, and what Ioana speaks are
// one text. The model is instructed to emit digits and never spell numbers, so
// there is exactly one converter instead of two disagreeing ones.
//
// SCOPE IS DELIBERATELY NARROW: numbers, dates, times, units, currency and the
// dotted abbreviations. Acronyms and foreign names are NOT touched — those stay
// in public.pronunciation_lexicon, which is editable without a deploy and is
// already the front door for pronunciation.
// ══════════════════════════════════════════════════════════════════════════

// ── TTS-SAFE NUMERALS ─────────────────────────────────────────────────────
// The voice engine breaks compound numerals at their morpheme seams:
// "cinci|zeci", "cinci|sprezece". Spelled canonically it comes out as two
// words with a gap in the middle, which is audibly wrong in Romanian.
//
// Only the FIVE-forms are affected today (confirmed on air with Adriana-fal),
// so only those are contracted and joined. Everything else keeps its canonical
// spelling — degrading numerals that already sound right would be a loss.
//
// THIS IS THE ONE PLACE TO TUNE. If another tens value starts breaking on a new
// engine, add it here; nothing else needs to change.
const TTS_TENS: Record<number, string> = {
  2: 'douăzeci', 3: 'treizeci', 4: 'patruzeci',
  5: 'cinzeci',                      // canonical "cincizeci" splits as cinci|zeci
  6: 'șaizeci', 7: 'șaptezeci', 8: 'optzeci', 9: 'nouăzeci',
};
// JOINING applies to EVERY tens compound, not only the five-forms. The engine
// inserts a seam at "X | și | Y" wherever it occurs: 29 read as "douăzeci și
// nouă" comes out in three pieces. Written as one token it flows.
// CONTRACTION (cinci -> cin) is separate and applies only to the five-forms.
const TTS_JOIN_TENS = new Set<number>([2, 3, 4, 5, 6, 7, 8, 9]);

const TTS_TEENS_M = ['zece', 'unsprezece', 'doisprezece', 'treisprezece', 'paisprezece',
  'cinsprezece',                     // canonical "cincisprezece" splits as cinci|sprezece
  'șaisprezece', 'șaptesprezece', 'optsprezece', 'nouăsprezece'];
const TTS_TEENS_F = (() => { const a = [...TTS_TEENS_M]; a[2] = 'douăsprezece'; return a; })();

const TTS_UNITS_M = ['zero', 'unu', 'doi', 'trei', 'patru', 'cinci', 'șase', 'șapte', 'opt', 'nouă'];
const TTS_UNITS_F = (() => { const a = [...TTS_UNITS_M]; a[1] = 'una'; a[2] = 'două'; return a; })();

function roUnder20(n: number, f: boolean): string {
  return n < 10 ? (f ? TTS_UNITS_F : TTS_UNITS_M)[n] : (f ? TTS_TEENS_F : TTS_TEENS_M)[n - 10];
}
function roUnder100(n: number, f: boolean): string {
  if (n < 20) return roUnder20(n, f);
  const t = Math.floor(n / 10), u = n % 10;
  if (u === 0) return TTS_TENS[t];
  const joined = TTS_JOIN_TENS.has(t);
  const unit = (f ? TTS_UNITS_F : TTS_UNITS_M)[u];
  return joined ? `${TTS_TENS[t]}și${unit}` : `${TTS_TENS[t]} și ${unit}`;
}
function roUnder1000(n: number, f: boolean): string {
  if (n < 100) return roUnder100(n, f);
  const h = Math.floor(n / 100), r = n % 100;
  const head = h === 1 ? 'o sută' : `${TTS_UNITS_F[h]} sute`;   // "sută" is feminine
  return r === 0 ? head : `${head} ${roUnder100(r, f)}`;
}

/**
 * Does this number need the linking "de" before its noun?
 * 1-19 attach directly ("nouăsprezece lei"); from 20 the noun takes "de".
 * For compounds the LAST TWO DIGITS decide: 115 -> "o sută cincisprezece lei",
 * 120 -> "o sută douăzeci DE lei". A round hundred or thousand always takes it.
 */
function roNeedsDe(n: number): boolean {
  n = Math.trunc(Math.abs(n));
  if (n < 20) return false;
  const last2 = n % 100;
  return last2 === 0 || last2 >= 20;
}

/**
 * Cardinal to words, gendered, TTS-safe.
 *
 * FIXED 31 Aug 2026: "de" before mie/milion/miliard follows roNeedsDe like any
 * other noun. The first version applied it unconditionally and produced
 * "douăsprezece DE milioane" and "cinci DE milioane" on air.
 */
function roCardinal(n: number, f = false): string {
  n = Math.trunc(Math.abs(n));
  if (n < 1000) return roUnder1000(n, f);

  const scales: Array<[number, string, string]> = [
    [1_000_000_000, 'un miliard', 'miliarde'],
    [1_000_000, 'un milion', 'milioane'],
    [1_000, 'o mie', 'mii'],
  ];
  for (const [size, one, many] of scales) {
    if (n >= size) {
      const head = Math.floor(n / size);
      const rest = n % size;
      // The scale word is a NOUN, so it is counted with the feminine and takes
      // "de" on exactly the same rule as "lei" or "ore".
      const headWords = head === 1
        ? one
        : `${roCardinal(head, true)}${roNeedsDe(head) ? ' de' : ''} ${many}`;
      return rest === 0 ? headWords : `${headWords} ${roCardinal(rest, f)}`;
    }
  }
  return roUnder1000(n, f);
}

const RO_MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie',
  'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];

// ── noun gender, for agreement ────────────────────────────────────────────
const MASC = ['leu','lei','euro','dolar','dolari','metru','metri','kilometru','kilometri',
  'litru','litri','an','ani','locuitor','locuitori','oameni','elev','elevi','copil','copii',
  'barbat','barbati','pacient','pacienti','angajat','angajati','membru','membri','pompier',
  'pompieri','politist','politisti','militar','militari','sofer','soferi','turist','turisti',
  'morti','raniti','kilowati','megawati'];
const FEM = ['ora','ore','zi','zile','luna','luni','saptamana','saptamani','secunda','secunde',
  'persoana','persoane','masina','masini','casa','case','scoala','scoli','firma','firme',
  'familie','familii','femeie','femei','tona','tone','mie','mii','suta','sute','victima',
  'victime','ambulanta','ambulante'];
// Romanian NEUTER: masculine in the singular ("un miliard"), feminine in the
// plural ("două miliarde"). Kept apart for exactly that reason.
const NEUT = ['procent','procente','grad','grade','minut','minute','kilogram','kilograme',
  'apartament','apartamente','loc','locuri','punct','puncte','proiect','proiecte','milion',
  'milioane','miliard','miliarde','hectar','hectare','exemplar','exemplare','vehicul',
  'vehicule','autoturism','autoturisme','spital','spitale','sat','sate','oras','orase',
  'dosar','dosare','contract','contracte'];

/** Fold diacritics so a noun typed without them still resolves. */
function fold(w: string): string {
  return w.toLowerCase().replace(/[.,;:!?]+$/, '')
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/ș/g, 's').replace(/ț/g, 't');
}
const F_M = new Set(MASC.map(fold)), F_F = new Set(FEM.map(fold)), F_N = new Set(NEUT.map(fold));

function genderOf(noun: string): 'm' | 'f' | 'n' {
  const w = fold(noun);
  if (F_M.has(w)) return 'm';
  if (F_F.has(w)) return 'f';
  if (F_N.has(w)) return 'n';
  return 'm';   // unknown: masculine, which is what an untouched TTS already says
}

function roCount(n: number, noun: string, deAlready = false): string {
  const g = genderOf(noun);
  if (n === 1) return `${g === 'f' ? 'o' : 'un'} ${noun}`;
  const words = roCardinal(n, g !== 'm');            // neuter plural agrees feminine
  return (deAlready || roNeedsDe(n)) ? `${words} de ${noun}` : `${words} ${noun}`;
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToArabic(s: string): number {
  const t = s.toUpperCase(); let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN[t[i]]; if (!v) return 0;
    total += v < (ROMAN[t[i + 1]] || 0) ? -v : v;
  }
  return total;
}
const ORD_M = ['', 'întâi', 'al doilea', 'al treilea', 'al patrulea', 'al cincilea', 'al șaselea',
  'al șaptelea', 'al optulea', 'al nouălea', 'al zecelea', 'al unsprezecelea', 'al doisprezecelea',
  'al treisprezecelea', 'al paisprezecelea', 'al cincisprezecelea', 'al șaisprezecelea',
  'al șaptesprezecelea', 'al optsprezecelea', 'al nouăsprezecelea', 'al douăzecilea'];
const ORD_F = ['', 'întâia', 'a doua', 'a treia', 'a patra', 'a cincea', 'a șasea', 'a șaptea',
  'a opta', 'a noua', 'a zecea', 'a unsprezecea', 'a douăsprezecea', 'a treisprezecea',
  'a paisprezecea', 'a cincisprezecea', 'a șaisprezecea', 'a șaptesprezecea', 'a optsprezecea',
  'a nouăsprezecea', 'a douăzecea'];

// ── units ─────────────────────────────────────────────────────────────────
// EVERY pattern is a fully-bounded non-capturing group.
//
// The 31 Aug on-air fault: /\bm²|mp\b/ was written meaning "m² or mp". Regex
// alternation binds looser than that — it reads as (\bm²) or (mp\b), so the
// second branch had no LEFT boundary and fired on the "mp" inside "timp".
// "în timp ce" was spoken as "în timetri pătrați ce". Hence the parentheses.
const UNITS: Array<[RegExp, string]> = [
  [/\b(?:km\/h|km\/oră)\b/gi, 'kilometri pe oră'],
  [/\b(?:m\/s)\b/gi, 'metri pe secundă'],
  [/\b(?:kWh)\b/gi, 'kilowați-oră'],
  [/\b(?:MWh)\b/gi, 'megawați-oră'],
  [/\b(?:MW)\b/g, 'megawați'],
  [/\b(?:kW)\b/g, 'kilowați'],
  [/\b(?:km²|km2)\b/gi, 'kilometri pătrați'],
  [/\b(?:m²|mp)\b/gi, 'metri pătrați'],
  [/\b(?:km)\b/gi, 'kilometri'],
  [/\b(?:cm)\b/gi, 'centimetri'],
  [/\b(?:mm)\b/gi, 'milimetri'],
  [/\b(?:kg)\b/gi, 'kilograme'],
  [/\b(?:ha)\b/g, 'hectare'],
  [/\b(?:RON)\b/g, 'lei'],
  [/\b(?:EUR)\b/g, 'euro'],
  [/\b(?:USD)\b/g, 'dolari'],
];

/** Characters only — safe, and never changes word identity. */
function roCleanup(input: string): string {
  return String(input || '')
    .replace(/ /g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/ș/g, 'ș').replace(/ț/g, 'ț')       // cedilla -> comma-below
    .replace(/Ș/g, 'Ș').replace(/Ț/g, 'Ț')
    .replace(/[*_`#>]/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Digits and symbols to broadcast Romanian words. Deterministic, no I/O. */
function roNumbers(input: string): string {
  let t = String(input || '');

  // 1 · DATES first — 12.03.2026 and 12.500 are the same shape to a naive rule.
  t = t.replace(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/g, (m, d, mo, y) => {
    const dd = +d, mm = +mo;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return m;
    return `${dd === 1 ? 'întâi' : roCardinal(dd, true)} ${RO_MONTHS[mm - 1]} ${roCardinal(+y, true)}`;
  });
  t = t.replace(new RegExp(`\\b(\\d{1,2})\\s+(${RO_MONTHS.join('|')})(?:\\s+(\\d{4}))?\\b`, 'gi'),
    (m, d, mon, y) => {
      const dd = +d; if (dd < 1 || dd > 31) return m;
      const day = dd === 1 ? 'întâi' : roCardinal(dd, true);
      return y ? `${day} ${mon} ${roCardinal(+y, true)}` : `${day} ${mon}`;
    });

  // 2 · CLOCK. Hours agree with the elided feminine "ora"; :00 drops minutes.
  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_m, h, mi) => {
    const hh = +h, mm = +mi;
    return mm === 0 ? roCardinal(hh, true) : `${roCardinal(hh, true)} și ${roCardinal(mm, true)}`;
  });
  t = t.replace(/\bora\s+(\d{1,2})\b/gi, (_m, h) => `ora ${roCardinal(+h, true)}`);

  // 3 · PHONE NUMBERS, digit by digit as a person reads them.
  t = t.replace(/\b0\d{3}[ .-]?\d{3}[ .-]?\d{3}\b/g, (m) =>
    m.replace(/\D/g, '').split('').map(c => TTS_UNITS_M[+c]).join(' '));

  // 4 · ROMAN NUMERALS, in explicit contexts only — a bare I, C or M in
  //     Romanian copy is far more often a letter than a numeral.
  t = t.replace(/\b(secolul|secolele|sec\.)\s+([IVXLCDM]+)\b/gi, (m, w, r) => {
    const n = romanToArabic(r); if (!n) return m;
    return `${w[0] === w[0].toUpperCase() ? 'Secolul' : 'secolul'} ${ORD_M[n] || roCardinal(n)}`;
  });
  t = t.replace(/\b(clasa|etapa|runda|grupa|ediția)\s+a\s+([IVXLCDM]+)\s*-\s*a\b/gi, (m, w, r) => {
    const n = romanToArabic(r); return n ? `${w} ${ORD_F[n] || roCardinal(n, true)}` : m;
  });
  t = t.replace(/\bal\s+([IVXLCDM]+)-lea\b/gi, (m, r) => {
    const n = romanToArabic(r); return n ? (ORD_M[n] || roCardinal(n)) : m;
  });

  // 5 · DOTTED ABBREVIATIONS.
  t = t.replace(/\bnr\.\s*/gi, 'numărul ').replace(/\bart\.\s*/gi, 'articolul ')
       .replace(/\balin\.\s*/gi, 'alineatul ').replace(/\blit\.\s*/gi, 'litera ')
       .replace(/\bjud\.\s*/gi, 'județul ').replace(/\bstr\.\s*/gi, 'strada ')
       .replace(/\bbd\.\s*/gi, 'bulevardul ').replace(/\bmld\.\s*/gi, 'miliarde ')
       .replace(/\bmil\.\s*/gi, 'milioane ').replace(/\betc\./gi, 'etcetera')
       .replace(/\bdr\.\s*/g, 'doctor ').replace(/\bprof\.\s*/gi, 'profesor ');

  // 6 · UNITS -> spoken noun, BEFORE the numbers, so the noun can decide gender.
  for (const [re, word] of UNITS) t = t.replace(re, word);

  // 7 · PERCENT / DEGREES / CURRENCY SYMBOLS.
  //     "la sută" is what a Romanian anchor says; "procente" reads as a form.
  //     The number is converted HERE rather than left for rule 11: "56 la sută"
  //     would otherwise be read as number+noun and become "cinzecișișase DE la
  //     sută", because "la" is a preposition, not a countable noun.
  t = t.replace(/\b(\d+)(?:,(\d+))?\s*%/g, (_m, a, dec) => {
    const head = roCardinal(+a);
    if (!dec) return `${head} la sută`;
    const tail = dec.length > 1 && dec[0] === '0'
      ? dec.split('').map((c: string) => TTS_UNITS_M[+c]).join(' ')
      : roCardinal(+dec);
    return `${head} virgulă ${tail} la sută`;
  })
       .replace(/(\d)\s*°\s*C/gi, '$1 grade Celsius')
       .replace(/(\d)\s*°/g, '$1 grade')
       .replace(/€\s*(\d)/g, '$1 euro').replace(/(\d)\s*€/g, '$1 euro')
       .replace(/\$\s*(\d)/g, '$1 dolari').replace(/(\d)\s*\$/g, '$1 dolari');

  // 8 · THOUSANDS SEPARATORS — 12.500 and 12 500 are one number, not two.
  t = t.replace(/\b\d{1,3}(?:[. ]\d{3})+(?![\d.,])/g, (m) => m.replace(/[. ]/g, ''));

  // 9 · DECIMALS with the Romanian comma.
  t = t.replace(/\b(\d+),(\d+)\b/g, (_m, a, b) =>
    `${roCardinal(+a)} virgulă ${b.length > 1 && b[0] === '0'
      ? b.split('').map((c: string) => TTS_UNITS_M[+c]).join(' ')
      : roCardinal(+b)}`);

  // 10 · RANGES — "10-15 grade" is a range, not a subtraction.
  t = t.replace(/\b(\d+)\s*-\s*(\d+)\b/g, (_m, a, b) => `${roCardinal(+a)} - ${roCardinal(+b)}`);

  // 11 · NUMBER + NOUN, with agreement and the linking "de".
  //      A number followed by a PREPOSITION or conjunction is not counting
  //      anything — "56 la sută" must never become "cinzecișișase DE la sută".
  //      Belt and braces: under the current design the model writes digits and
  //      "%", so this path is rarely hit, but a hand-edited script can produce it.
  const NOT_A_NOUN = new Set(['la','de','din','si','și','pe','cu','in','în','prin','spre',
    'catre','către','sau','iar','dar','ca','că','ce','care','fara','fără','pana','până',
    'dupa','după','intre','între','sub','peste','langa','lângă','a','al','ai','ale']);
  t = t.replace(/\b(\d{1,12})\s+(de\s+)?([a-zA-ZăâîșțĂÂÎȘȚ]+)/g, (m, num, de, noun) => {
    const n = +num;
    if (!Number.isFinite(n)) return m;
    if (NOT_A_NOUN.has(fold(noun))) return `${roCardinal(n)} ${de ? 'de ' : ''}${noun}`;
    return roCount(n, noun, Boolean(de));
  });

  // 12 · Any remaining bare integer.
  t = t.replace(/\b\d{1,12}\b/g, (m) => roCardinal(+m));

  // 13 · Symbols that would otherwise be read as punctuation, or swallowed.
  t = t.replace(/\s*&\s*/g, ' și ').replace(/\s*\+\s*/g, ' plus ')
       .replace(/\s*=\s*/g, ' egal ').replace(/\s*×\s*/g, ' ori ')
       .replace(/§/g, 'paragraful ').replace(/№/g, 'numărul ');

  return t.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').trim();
}

/** The whole script-time pass. */
function roBroadcast(input: string): string {
  return roNumbers(roCleanup(input));
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── admin gate (inlined from _shared/requireAdmin.ts, kept self-contained so
//    this file can be pasted straight into the Supabase dashboard editor) ────
async function requireAdmin(req: Request): Promise<Response | null> {
  const AUTH_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const deny = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), {
      status, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' },
    });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return deny(401, 'Unauthorized');

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) return null;

  // Prove service-role by doing something only service-role may do. GoTrue
  // verifies the signature, so a forged token or the public anon key from the
  // site bundle cannot pass this.
  try {
    const probe = createClient(url, token, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!error) return null;
  } catch { /* not service-role — fall through to the admin-user check */ }

  try {
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey!;
    const sb = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: u, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !u.user) return deny(401, 'Unauthorized');
    const { data: role, error: rErr } = await sb
      .from('user_roles').select('role')
      .eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
    if (rErr || !role) return deny(403, 'Forbidden');
    return null;
  } catch (e) {
    // Fail closed: a failed check is a denial, never a silent pass.
    console.error('[requireAdmin] check failed, denying by default:', (e as Error).message);
    return deny(401, 'Unauthorized');
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    // ── 1) SCRIPT ─────────────────────────────────────────────────────────
    if (action === 'script') {
      const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
      const edition = String(body.edition || '');   // 'morning' | 'evening' | ''
      const greetRo = edition === 'morning'
        ? "un salut de dimineață (\"Bună dimineața\") cu Transilvania Times, energic și luminos"
        : edition === 'evening'
          ? "un salut de seară (\"Bună seara\") cu Transilvania Times, așezat și autoritar"
          : "un rând de salut cu Transilvania Times și 'astăzi'";
      const greetEn = edition === 'morning'
        ? 'a bright morning greeting ("Good morning") with Transilvania Times'
        : edition === 'evening'
          ? 'a composed evening greeting ("Good evening") with Transilvania Times'
          : 'one-line greeting with Transilvania Times';
      // Duration ceiling raised 150 -> 300s. A 10-story bulletin cannot be told
      // in 110 seconds, and the old ceiling silently forced the model to drop
      // stories (see the ALL-STORIES contract below).
      const target = Math.min(300, Math.max(30, Number(body.target_seconds) || 75));
      // Article ceiling raised 10 -> 20, and anything beyond it is now REPORTED
      // rather than silently discarded.
      const allArticles = (Array.isArray(body.articles) ? body.articles : [])
        .map((a: Record<string, unknown>) => ({
          title: String(a.title || ''),
          summary: String(a.summary || '').slice(0, 400),
          // ADDED 29 Aug 2026 — byline attribution. Sent by /admin/newsroom from
          // authors.name_ro, falling back to blog_posts.author_name, exactly as
          // the public article page resolves it. Empty when the post has neither.
          author: String(a.author || '').slice(0, 80),
        }))
        .filter((a: { title: string }) => a.title);
      const articles = allArticles.slice(0, 20);
      const droppedForCap = allArticles.length - articles.length;
      if (articles.length === 0) return json({ error: 'articles is required (selectează știrile zilei)' }, 400);

      const wordsTarget = Math.round(target * (language === 'ro' ? 2.3 : 2.5)); // speaking pace
      // Roughly 25 spoken words is the floor for one story to be worth airing.
      // If the requested duration cannot carry every selected story, say so in
      // the response instead of letting the model quietly bin the overflow.
      const minWordsNeeded = articles.length * 25 + 25   // stories + greeting/signoff
      const budgetTight = wordsTarget < minWordsNeeded
      const coverageRo = `OBLIGATORIU: articolul "stories" TREBUIE să conțină EXACT ${articles.length} intrări — câte una pentru FIECARE știre primită, în ordinea în care ți-au fost date. Nu omite, nu combina și nu sări peste nicio știre. Dacă spațiul e strâns, scurtează fiecare știre la o singură frază, dar include-le pe TOATE.`
      const coverageEn = `MANDATORY: the "stories" array MUST contain EXACTLY ${articles.length} entries — one for EVERY story given, in the order provided. Do not omit, merge or skip any. If space is tight, shorten each to a single sentence, but include them ALL.`
      // STRUCTURED script: JSON sections so the broadcast compositor can time
      // lower-thirds per story. `script` (joined spoken text) stays the TTS input.
      const sys = language === 'ro'
        ? `Ești prezentatorul de știri al Transilvania Times. Scrie un buletin video de ~${target} secunde (~${wordsTarget} cuvinte) în română naturală, cu diacritice, ton profesionist: cald, clar, autoritar, fără senzaționalism. Răspunde DOAR cu JSON valid, fără alt text, exact în forma: {"greeting":"...","stories":[{"lower_third":"titlu de burtieră, max 38 caractere, fără punct final","text":"1-3 fraze rostite despre știre, cu tranziție naturală"}],"signoff":"..."}. Fără indicații de regie, fără emoji, fără markdown.

ACESTA ESTE BULETINUL UNUI ZIAR, NU AL UNEI TELEVIZIUNI.
Nu relatezi de la fața locului. Prezinți articolele publicate azi de redacție.

DESCHIDEREA. Începe cu ${greetRo}, apoi spune limpede că urmează articole din ziar. Variază formularea de la o zi la alta; nu repeta la nesfârșit aceeași frază. De exemplu: "Iată câteva dintre articolele publicate astăzi în ziarul nostru." sau "Vă prezentăm câteva dintre materialele apărute astăzi în Transilvania Times."

SEMNĂTURA AUTORULUI. Fiecare știre menționează o singură dată autorul articolului, dacă îl primești. ROTEȘTE formulările — patru știri care încep toate cu "Într-un articol scris de" sună ca un formular, nu ca un jurnal. Folosește alternativ:
  • "Într-un articol semnat de {autor}, ..."
  • "{autor} scrie astăzi că ..."
  • "... Materialul este semnat de {autor}."   (atribuirea la finalul frazei)
  • "Despre acest subiect scrie {autor}."
Nu folosi aceeași formulare de două ori la rând. Dacă autorul lipsește, nu inventa un nume și nu spune "autor necunoscut" — treci direct la știre.

ÎNCHIDEREA. signoff-ul are EXACT două părți, în această ordine: mai întâi trimiterea la site — "Mai multe articole puteți citi pe transilvaniatimes.com." — apoi, ca frază separată, un rămas-bun cald și scurt: "La revedere!". Nu adăuga nimic după "La revedere!". Buletinul trebuie să se încheie ferm, nu să pară că mai urmează ceva.

NUMERELE. Scrie TOATE numerele cu CIFRE, niciodată în litere: "139 de lei", "56%", "15 septembrie", "Legea 169/2006", "19,2%". NU scrie "o sută treizeci și nouă" și NU scrie "cincizeci și șase la sută".
Motivul: funcția transformă cifrele în cuvinte după ce termini, cu ortografia exactă pe care o pronunță corect vocea. Dacă le scrii tu în litere, ies greșit ("cinzecișișase" rostit ca "cinci zeci și șase") și, mai grav, textul scris nu mai coincide cu cel rostit, iar burtierele se decalează.

NU DESCRIE ARTICOLUL — SPUNE CE SCRIE ÎN EL. Aceasta este regula cea mai importantă.
Rezumatele pe care le primești sunt scrise pentru site, unde cititorul are articolul sub ochi. La televizor nu are nimic sub ochi. O frază ca "Acest eseu explorează modul în care epuizarea poate să se deghizeze în nefericire" nu spune nimic: ascultătorul nu are niciun eseu în față și nu află NIMIC despre subiect.
INTERZIS să începi o știre cu: "Acest articol...", "Acest eseu...", "Materialul de față...", "Textul...", urmate de "explorează", "analizează", "prezintă", "tratează", "vorbește despre", "își propune să".
CORECT: rostește direct afirmația, constatarea sau faptul, ca și cum i-ai explica unui prieten despre ce e vorba.

  GREȘIT: "Acest eseu explorează modul în care epuizarea poate să se deghizeze în nefericire, determinându-ne să credem că avem nevoie de schimbări radicale."
  CORECT: "Oboseala se poate deghiza în nefericire. Într-un eseu semnat de {autor}, se arată că, atunci când suntem epuizați, credem că avem nevoie de schimbări mari în viață — când, de fapt, avem nevoie de odihnă."

Atenție la diferență: a NUMI autorul și publicația este atribuire și este corectă. A descrie articolul ca obiect ("acest text analizează...") este greșit. Atribuie, apoi spune conținutul.

Pentru opinii și eseuri, formulează afirmația ca afirmație a autorului, nu ca adevăr al redacției: "{autor} susține că...", "În opinia autoarei, ...".

FIECARE ȘTIRE TREBUIE SĂ CONȚINĂ CEL PUȚIN UN FAPT CONCRET — cine, ce, unde, când, cât. Dacă rezumatul primit nu conține niciun fapt, spune ideea principală în cuvinte simple; nu umple spațiul cu descrieri despre ce "își propune" articolul.

${coverageRo}`
        : `You are the news anchor of Transilvania Times. Write a ~${target}-second (~${wordsTarget} words) bulletin in natural English: warm, clear, authoritative. Respond ONLY with valid JSON, no other text, exactly: {"greeting":"...","stories":[{"lower_third":"lower-third title, max 38 chars, no final period","text":"1-3 spoken sentences with a natural transition"}],"signoff":"..."}. No stage directions, no emoji, no markdown.

THIS IS A NEWSPAPER'S BULLETIN, NOT A TV STATION'S. You are not reporting from the scene; you are presenting the articles the newsroom published today.

OPENING. Start with ${greetEn}, then say plainly that these are articles from today's paper. Vary the wording day to day.

BYLINE. Each story credits its author once, if one is given. ROTATE the phrasing — four stories all opening "In an article by" reads like a form, not a journal. Alternate between putting the credit first, mid-sentence and at the end. If no author is given, do not invent one and do not say "unknown author" — go straight to the story.

DO NOT DESCRIBE THE ARTICLE — SAY WHAT IS IN IT. This is the most important rule.
The summaries you receive are written for a web page, where the reader has the article right there. A viewer has nothing in front of them. "This essay explores how burnout can disguise itself as unhappiness" tells the listener nothing at all.
BANNED openings: "This article/essay/piece" followed by "explores", "analyses", "presents", "looks at", "sets out to".
CORRECT: state the claim, the finding or the fact directly, the way you would explain it to a friend.
Naming the author and the paper is attribution and is correct. Describing the article as an object is not. Attribute, then deliver the content.
For opinion and essays, frame the claim as the author's, not as the paper's: "{author} argues that...".
EVERY STORY MUST CARRY AT LEAST ONE CONCRETE FACT — who, what, where, when, how much.

CLOSING. The signoff has EXACTLY two parts in this order: the site — "You can read more at transilvaniatimes.com." — then, as a separate sentence, a short warm goodbye: "Goodbye!". Nothing after it. The bulletin must end firmly, not sound as if more is coming.

${coverageEn}`;
      const user = articles
        .map((a: { title: string; summary: string; author: string }, i: number) =>
          `${i + 1}. ${a.title}\n${a.summary}${a.author ? `\nAutor: ${a.author}` : ''}`)
        .join('\n\n');

      // ── ROOT CAUSE (observed in production) ─────────────────────────────
      // The model wrote a Romanian opening quote „ and closed it with a STRAIGHT
      // ASCII double quote: „God Is Not Your Babysitter". Inside a JSON string
      // that unescaped " terminates the value early, JSON.parse throws, and the
      // old code fell through to `{ script: text }` — dumping the RAW JSON into
      // the script box AND into the TTS input, so the anchor would have read the
      // JSON aloud. Two defences: repair the common malformations, and never let
      // unparsed JSON reach the script field (see the salvage path below).
      const repairJson = (raw: string): string => {
        // Close a Romanian „ quote that was closed with a straight " instead of ”.
        let out = raw.replace(/„([^"„”]*)"/g, '„$1”')
        // Same for an English “ opened quote closed with a straight ".
        out = out.replace(/“([^"“”]*)"/g, '“$1”')
        return out
      }

      const parseSections = (raw: string) => {
        try {
          const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
          const slice = raw.slice(s, e + 1)
          let obj: Record<string, unknown>
          try { obj = JSON.parse(slice) }
          catch { obj = JSON.parse(repairJson(slice)) }   // second chance
          const stories = (Array.isArray((obj as Record<string, unknown>).stories) ? (obj as Record<string, unknown>).stories as Record<string, unknown>[] : [])
            .map((st: Record<string, unknown>) => ({ lower_third: String(st.lower_third || '').slice(0, 44), text: String(st.text || '') }))
            .filter((st: { text: string }) => st.text);
          if (!stories.length) return null;
          const greeting = String((obj as Record<string, unknown>).greeting || '');
          const signoff = String((obj as Record<string, unknown>).signoff || '');
          const script = [greeting, ...stories.map((st: { text: string }) => st.text), signoff].filter(Boolean).join('\n\n');
          return { script, sections: { greeting, stories, signoff } };
        } catch { return null; }
      };

      // Last resort. If the JSON is too broken to parse even after repair, pull
      // the human-readable values out with a regex and hand back PROSE. The
      // script field feeds the TTS engine — putting JSON in it means the anchor
      // reads braces and field names aloud on air. That must never happen.
      const salvageProse = (raw: string): string => {
        const grab = (key: string) => {
          const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}\\n]`))
          return m ? m[1].replace(/\\n/g, ' ').trim() : ''
        }
        const greeting = grab('greeting')
        const texts = [...raw.matchAll(/"text"\s*:\s*"([\s\S]*?)"\s*[,}\n]/g)].map(m => m[1].trim()).filter(Boolean)
        const signoff = grab('signoff')
        const parts = [greeting, ...texts, signoff].filter(Boolean)
        return parts.length ? parts.join('\n\n') : ''
      };

      // Report coverage explicitly. A missing story must never be silent.
      const coverageMeta = (parsed: { sections?: { stories?: unknown[] } } | null) => {
        const got = parsed?.sections?.stories?.length ?? 0
        const want = articles.length
        const notes: string[] = []
        if (got < want) notes.push(`ATENȚIE: ${got} din ${want} știri au intrat în script. Mărește durata buletinului (${target}s e prea scurt pentru ${want} știri) sau selectează mai puține știri.`)
        if (droppedForCap > 0) notes.push(`${droppedForCap} știri peste limita de 20 nu au fost trimise.`)
        if (budgetTight && got >= want) notes.push(`Buletinul e dens: ${want} știri în ${target}s.`)
        return { stories_requested: want, stories_returned: got, coverage_note: notes.join(' ') || undefined }
      }

      // ── max_tokens sizing ────────────────────────────────────────────
      // Was a hard-coded 1800 on both engines. A 300-second Romanian bulletin
      // is roughly 750 spoken words, and Romanian tokenises at about 4.2 tokens
      // per word on the Anthropic tokenizer (diacritics are multi-byte and
      // split), so the words alone are ~3 100 tokens before the JSON envelope.
      // 1800 could not hold that, and nothing reported it — the model simply
      // stopped mid-bulletin. Sized from the real target instead, with a 16 000
      // ceiling so a bad target_seconds cannot run up a bill.
      // wordsTarget is already computed above from the speaking pace.
      const scriptMaxTokens = Math.min(
        16000,
        Math.max(1800, Math.round(wordsTarget * (language === 'ro' ? 4.2 : 2.6))
                       + articles.length * 60 + 800),
      );

      const claudeKey = Deno.env.get('CLAUDE_API_KEY');
      if (claudeKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: CLAUDE_MODEL, max_tokens: scriptMaxTokens,
            system: sys, messages: [{ role: 'user', content: user }],
            // Structured outputs: the API enforces this schema AT GENERATION
            // TIME, so the response cannot contain the unescaped-quote
            // malformation that produced raw JSON in the script box. Same
            // mechanism the scraper adopted in v72.3 for the same class of bug.
            output_config: {
              format: {
                type: 'json_schema',
                schema: {
                  type: 'object',
                  properties: {
                    greeting: { type: 'string' },
                    stories: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { lower_third: { type: 'string' }, text: { type: 'string' } },
                        required: ['lower_third', 'text'],
                        additionalProperties: false,
                      },
                    },
                    signoff: { type: 'string' },
                  },
                  required: ['greeting', 'stories', 'signoff'],
                  additionalProperties: false,
                },
              },
            },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          await logSpend({
            provider: 'anthropic', model: CLAUDE_MODEL,
            // unit_kind is CONSTRAINED by the live table to
            // tokens|chars|seconds|images|minutes|requests. The descriptive
            // label goes in meta.kind, never here.
            unit_kind: 'tokens',
            units: Number(data?.usage?.input_tokens || 0) + Number(data?.usage?.output_tokens || 0),
            usd: usdFor(CLAUDE_MODEL, Number(data?.usage?.input_tokens || 0),
                        Number(data?.usage?.output_tokens || 0)),
            meta: { kind: 'script', language, target_seconds: target, articles: articles.length,
                    input_tokens: Number(data?.usage?.input_tokens || 0),
                    output_tokens: Number(data?.usage?.output_tokens || 0) },
          });
          const text = (data?.content?.[0]?.text || '').trim();
          const parsed = parseSections(text);
          if (parsed) return json({ ...broadcastify(parsed), model: CLAUDE_MODEL, ...coverageMeta(parsed) });
          const salvaged = salvageProse(text);
          if (salvaged) {
            console.warn('[script] claude JSON unparseable — salvaged prose from the values');
            return json({ script: roBroadcast(salvaged), sections: null, model: CLAUDE_MODEL, note: 'JSON invalid — text recuperat, burtierele lipsesc' });
          }
          console.warn('[script] claude output unusable, falling through to OpenAI');
        } else {
          console.warn('[script] claude failed:', res.status, (await res.text()).substring(0, 150));
        }
      }
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) return json({ error: 'No LLM configured (CLAUDE_API_KEY or OPENAI_API_KEY)' }, 500);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OPENAI_MODEL, max_tokens: scriptMaxTokens, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) return json({ error: `OpenAI ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      await logSpend({
        provider: 'openai', model: OPENAI_MODEL,
        unit_kind: 'tokens',
        units: Number(data?.usage?.prompt_tokens || 0) + Number(data?.usage?.completion_tokens || 0),
        usd: usdFor(OPENAI_MODEL, Number(data?.usage?.prompt_tokens || 0),
                    Number(data?.usage?.completion_tokens || 0)),
        meta: { kind: 'script', language, target_seconds: target, articles: articles.length,
                input_tokens: Number(data?.usage?.prompt_tokens || 0),
                output_tokens: Number(data?.usage?.completion_tokens || 0) },
      });
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      const parsed = parseSections(text);
      if (parsed) return json({ ...broadcastify(parsed), model: OPENAI_MODEL, ...coverageMeta(parsed) });
      const salvaged2 = salvageProse(text);
      if (salvaged2) {
        console.warn('[script] openai JSON unparseable — salvaged prose from the values');
        return json({ script: roBroadcast(salvaged2), sections: null, model: OPENAI_MODEL, note: 'JSON invalid — text recuperat, burtierele lipsesc' });
      }
      // Never hand raw JSON back: it would be spoken aloud by the anchor.
      return json({ error: 'Scriptul generat nu a putut fi interpretat (JSON invalid). Reîncearcă — dacă persistă, reduce numărul de știri selectate.' }, 502);
    }

    // ── SECTIONIZE ────────────────────────────────────────────────────────
    //
    // Added 30 Aug 2026 to close a silent correctness bug in the admin page.
    //
    // `sections` (greeting / stories[] / signoff) is what times the burtiere,
    // the category chip and the article photo on the studio monitor. It comes
    // from the `script` action — but the script box is editable, and an edited
    // script is used VERBATIM. So `sections` could still be describing the
    // PREVIOUS script: the right words spoken over the wrong headlines and the
    // wrong photos, with nothing on screen to say so.
    //
    // This re-derives sections from arbitrary script text WITHOUT rewriting a
    // single word of it. The split is deterministic — the script is composed as
    // [greeting, ...stories, signoff].join('\n\n') — and only the short
    // lower-third labels are written by the model. With no CLAUDE_API_KEY the
    // labels fall back to a truncation of each block's own first sentence, so
    // the action still works.
    // ══════════════════════════════════════════════════════════════════════
    // ACTION: normalize
    //
    // Converts digits to spoken Romanian ON DEMAND, for text the operator has
    // typed or pasted himself. Deterministic, free, no model call.
    //
    // This exists because the automatic pass runs ONLY on freshly generated
    // script. Anything you write into the box afterwards is yours and is never
    // touched — but when you do want "56%" turned into words, you press the
    // button instead of having it done behind your back.
    // ══════════════════════════════════════════════════════════════════════
    if (action === 'normalize') {
      const text = String(body.text || '');
      if (!text.trim()) return json({ error: 'text is required' }, 400);
      const out = roBroadcast(text);
      return json({ text: out, changed: out !== text });
    }

    if (action === 'sectionize') {
      const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
      const text = String(body.script || '').replace(/\r\n?/g, '\n').trim();
      if (!text) return json({ error: 'script is required' }, 400);

      const blocks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean);
      if (blocks.length < 2) {
        return json({ sections: null, note: 'Scriptul nu are paragrafe separate prin rand gol — nu pot deduce stirile. Lasa un rand gol intre stiri.' });
      }
      const hasGreeting = blocks.length >= 3;
      const hasSignoff  = blocks.length >= 3;
      const greeting = hasGreeting ? blocks[0] : '';
      const signoff  = hasSignoff ? blocks[blocks.length - 1] : '';
      const storyTexts = blocks.slice(hasGreeting ? 1 : 0, hasSignoff ? -1 : undefined);
      if (!storyTexts.length) return json({ sections: null, note: 'Nu am gasit blocuri de stiri in script.' });

      const fallbackLabel = (t: string) =>
        t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].slice(0, 38).replace(/[\s,;:.]+$/, '');

      let labels: string[] = storyTexts.map(fallbackLabel);
      const secKey = Deno.env.get('CLAUDE_API_KEY');
      if (secKey) {
        const secSys = language === 'ro'
          ? 'Primesti blocurile rostite ale unui buletin de stiri. Pentru fiecare bloc scrie un titlu de burtiera: maxim 38 de caractere, fara punct final, cu diacritice, concret (cine/ce/unde). Nu rescrie textul, nu adauga informatii. Raspunde DOAR cu JSON: {"labels":["...","..."]} — exact cate un titlu per bloc, in ordine.'
          : 'You receive the spoken blocks of a news bulletin. For each block write a lower-third title: max 38 characters, no final period, concrete. Do not rewrite the text or add information. Respond ONLY with JSON: {"labels":["...","..."]} — exactly one per block, in order.';
        try {
          const secRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': secKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: CLAUDE_MODEL, max_tokens: 900, system: secSys,
              messages: [{ role: 'user', content: storyTexts.map((t, i) => `[${i + 1}]\n${t}`).join('\n\n') }],
            }),
          });
          if (secRes.ok) {
            const secData = await secRes.json();
            await logSpend({
              provider: 'anthropic', model: CLAUDE_MODEL,
              unit_kind: 'tokens',
              units: Number(secData?.usage?.input_tokens || 0) + Number(secData?.usage?.output_tokens || 0),
              usd: usdFor(CLAUDE_MODEL, Number(secData?.usage?.input_tokens || 0),
                          Number(secData?.usage?.output_tokens || 0)),
              meta: { kind: 'sectionize' },
            });
            const raw = String(secData?.content?.[0]?.text || '');
            const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
            const parsedLabels = a >= 0 && b > a ? JSON.parse(raw.slice(a, b + 1)) : null;
            const got = Array.isArray(parsedLabels?.labels) ? parsedLabels.labels.map((x: unknown) => String(x || '')) : [];
            // Only accept a COMPLETE answer of the right size. A partial list
            // would silently mislabel the tail of the bulletin.
            if (got.length === storyTexts.length && got.every((l: string) => l.trim())) {
              labels = got.map((l: string) => l.trim().slice(0, 44));
            }
          }
        } catch { /* labels already have a deterministic fallback */ }
      }

      return json({
        sections: {
          greeting,
          stories: storyTexts.map((t, i) => ({ lower_third: labels[i] || `Stirea ${i + 1}`, text: t })),
          signoff,
        },
        derived: true,
        note: secKey ? undefined : 'Titlurile de burtiera au fost taiate automat din prima fraza (CLAUDE_API_KEY lipseste).',
      });
    }

    // ── Platform caption pack (Claude → OpenAI fallback) ──────────────────
    if (action === 'captions') {
      const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
      const titles = (Array.isArray(body.titles) ? body.titles : []).map((t: unknown) => String(t || '')).filter(Boolean).slice(0, 8);
      if (!titles.length) return json({ error: 'titles is required' }, 400);
      const base = 'https://transilvaniatimes.com';
      const utm = (src: string) => `${base}/?utm_source=${src}&utm_medium=social&utm_campaign=buletin`;
      const sys = language === 'ro'
        ? `Ești social media editor la Transilvania Times (ziar din Ardeal, ton cald și de încredere). Pentru buletinul video de azi cu subiectele date, răspunde DOAR cu JSON valid: {"facebook":"caption 2-4 fraze cu cârlig în prima frază + CTA către link","instagram":"caption scurt cu cârlig + 'link în bio'","tiktok":"caption foarte scurt, direct, cu cârlig","youtube_title":"titlu max 90 caractere cu ziua","youtube_description":"2-3 fraze + link","hashtags":["8-12 hashtag-uri RO relevante, fără #buletin generic"]}. Diacritice corecte, fără emoji excesiv (max 1-2 per caption).`
        : `You are the social media editor of Transilvania Times. For today's video bulletin with the given stories, respond ONLY with valid JSON: {"facebook":"2-4 sentence caption, hook first + CTA","instagram":"short caption with hook + 'link in bio'","tiktok":"very short punchy caption","youtube_title":"max 90 chars with the day","youtube_description":"2-3 sentences + link","hashtags":["8-12 relevant EN/RO hashtags"]}. Max 1-2 emoji per caption.`;
      const user = `Subiecte: ${titles.join(' | ')}\nLink Facebook: ${utm('facebook')}\nLink YouTube: ${utm('youtube')}`;
      const tryParse = (raw: string) => {
        try { const s = raw.indexOf('{'); const e = raw.lastIndexOf('}'); return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
      };
      const claudeKey = Deno.env.get('CLAUDE_API_KEY');
      if (claudeKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1200, system: sys, messages: [{ role: 'user', content: user }] }),
        });
        if (res.ok) {
          const data = await res.json();
          const parsed = tryParse((data?.content?.[0]?.text || ''));
          if (parsed) return json({ captions: parsed, links: { facebook: utm('facebook'), instagram: utm('instagram'), tiktok: utm('tiktok'), youtube: utm('youtube') } });
        }
      }
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) return json({ error: 'No LLM configured' }, 500);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_MODEL, max_tokens: 1200, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
      });
      if (!res.ok) return json({ error: `OpenAI ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const parsed = tryParse(data?.choices?.[0]?.message?.content || '');
      if (!parsed) return json({ error: 'Could not parse captions' }, 502);
      return json({ captions: parsed, links: { facebook: utm('facebook'), instagram: utm('instagram'), tiktok: utm('tiktok'), youtube: utm('youtube') } });
    }

    // ── FAL (SadTalker) — no-subscription lipsync engine ──────────────────
    const falKey = Deno.env.get('FAL_KEY');

    if (action === 'engines') {
      return json({
        heygen: !!Deno.env.get('HEYGEN_API_KEY'),
        fal: !!falKey,
      });
    }

    if (action === 'generate_fal') {
      if (!falKey) return json({ error: 'FAL_KEY not set — add a fal.ai key (prepaid credits, no subscription) to use the free-stack anchor.' }, 400);
      const imageUrl = String(body.image_url || '').trim();
      const videoUrl = String(body.video_url || '').trim();
      const audioUrl = String(body.audio_url || '').trim();
      if (!audioUrl || (!imageUrl && !videoUrl)) return json({ error: 'audio_url plus image_url or video_url is required' }, 400);

      // Engine selection — video-to-video lipsync is FAR more professional than
      // photo animation: the presenter clip keeps its real studio, hair, hands,
      // body motion, and only the mouth is resynced to the voiceover.
      //   'sync'       → fal-ai/sync-lipsync   (sync.so — best quality, video+audio)
      //   'latentsync' → fal-ai/latentsync     (ByteDance — strong open alternative)
      //   'sadtalker'  → fal-ai/sadtalker      (photo+audio fallback, now with GFPGAN)
      let engine = String(body.engine || '').trim();
      // Default for a PHOTO-only anchor is now Kling ai-avatar, not SadTalker.
      // SadTalker warps the face ("highly inaccurate"); Kling drives head motion,
      // blinks and expression from the audio while preserving the real identity.
      // SadTalker stays reachable via explicit engine:'sadtalker' (budget path).
      if (!engine) engine = videoUrl ? 'sync' : 'avatar';

      let model = '';
      let payload: Record<string, unknown> = {};
      if (engine === 'sync') {
        if (!videoUrl) return json({ error: 'engine "sync" needs video_url (a presenter clip)' }, 400);
        // ── COST-FIRST ENGINE SELECTION ───────────────────────────────────
        // CRITICAL FACT: every model here is a REDUB engine — it replaces the
        // MOUTH on footage you supply. None of them invent gestures or body
        // language; that comes entirely from the source clip. So paying $8/min
        // for sync-3 buys phoneme accuracy ONLY — never a "more human" presenter.
        // Verified fal prices per minute of output:
        //   latentsync ……… $0.30  ($0.20 flat ≤40s, then $0.005/s)  ← default
        //   veed/lipsync … $0.40
        //   sync-lipsync … $0.70  (1.9 base)
        //   sync v2 ……… $3.00
        //   sync v2 pro … $5.00
        //   sync v3 ……… $8.00
        // A ~1.8-min bulletin: $0.54 on latentsync vs $14.40 on v3 — 27×.
        // Fallback only ever moves DOWNWARD in price — never a silent upgrade.
        const quality = String(body.quality || 'economic').toLowerCase();
        const TIERS: Record<string, { model: string; payload: Record<string, unknown>; usd: number }> = {
          premium:  { model: 'fal-ai/sync-lipsync/v3', usd: 8.00, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop', options: { sync_mode: 'loop', model_mode: 'lipsync' } } },
          pro:      { model: 'fal-ai/sync-lipsync/v2', usd: 5.00, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop', model: 'lipsync-2-pro' } },
          bun:      { model: 'fal-ai/sync-lipsync/v2', usd: 3.00, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop' } },
          standard: { model: 'fal-ai/sync-lipsync',    usd: 0.70, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop' } },
          veed:     { model: 'veed/lipsync',           usd: 0.40, payload: { video_url: videoUrl, audio_url: audioUrl } },
          // LatentSync: output length ALWAYS equals the audio length, and a short
          // source clip is auto-extended. loop_mode is nullable with no declared
          // default, so we set it explicitly.
          //
          // CHANGED 28 Aug 2026: 'pingpong' → 'loop'.
          // The old comment here was right about the plates we had: pingpong
          // avoided a jump-cut when the last frame didn't match the first. But
          // pingpong plays every second repetition BACKWARDS, which reverses the
          // blinks — the eyelid opens slowly and snaps shut — and reverses hair
          // and fabric settle. Viewers can't name it; they reliably feel it.
          //
          // The plates are now shot in Kling with Start-and-End-Frames set to the
          // same still, so the last frame DOES match the first. Measured on
          // Ioana's three plates: 0.93 / 1.10 / 0.58 mean absolute difference on
          // an 8-bit scale — the compression noise floor. There is no seam left
          // for pingpong to hide.
          //
          // If you ever feed this an old plate whose last frame does not match
          // its first, that plate needs reshooting, not pingpong.
          economic: { model: 'fal-ai/latentsync',      usd: 0.30, payload: { video_url: videoUrl, audio_url: audioUrl, loop_mode: 'loop' } },
        };
        // Chosen tier first, then progressively CHEAPER tiers as fallback.
        //
        // 30 Aug 2026 — TWO DEFECTS FIXED HERE.
        //
        // (a) DUPLICATE ENDPOINT. 'pro' and 'bun' are both
        //     fal-ai/sync-lipsync/v2, differing only in a payload flag. Falling
        //     from pro to bun therefore re-POSTed the SAME model that had just
        //     refused the request — a guaranteed-useless round trip. The ladder
        //     is now de-duplicated by model+variant, keeping the first (better)
        //     one.
        //
        // (b) 'economic' HAD NO LADDER AT ALL. It is last in cheapOrder, so
        //     slice() returned a single entry: if latentsync was down or
        //     rejected the clip, the bulletin failed outright with no attempt at
        //     anything else. Since 'economic' is the DEFAULT tier, that was the
        //     common case, not an edge case. It now falls back to veed ($0.40)
        //     and then standard ($0.70).
        //
        //     Those cost MORE than the tier that was asked for, so the response
        //     reports tier_used / tier_changed and the admin page shows the
        //     price actually being paid instead of the one it estimated.
        const cheapOrder = ['premium', 'pro', 'bun', 'standard', 'veed', 'economic'];
        const chosenTier = TIERS[quality] ? quality : 'economic';
        const rawLadder = chosenTier === 'economic'
          ? ['economic', 'veed', 'standard']
          : cheapOrder.slice(cheapOrder.indexOf(chosenTier));
        const seenModels = new Set<string>();
        const ladder = rawLadder
          .map(k => ({ key: k, ...TIERS[k] }))
          .filter(step => {
            if (!step || !step.model) return false;
            const sig = step.model + '|' + JSON.stringify(step.payload.model ?? step.payload.options ?? '');
            if (seenModels.has(sig)) return false;
            seenModels.add(sig);
            return true;
          });
        // sync_mode 'loop' is REQUIRED: the presenter source is a short (~10s)
        // idle clip while the voiceover runs 1–2 min, so the video must loop to
        // cover the audio. 'cut_off' (fal's default) would truncate the bulletin.
        for (const step of ladder) {
          const r2 = await fetch(`https://queue.fal.run/${step.model}`, {
            method: 'POST',
            headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(step.payload),
          });
          if (r2.ok) {
            const d2 = await r2.json();
            const label = step.model + (step.payload.model ? ` (${step.payload.model})` : step.payload.options ? ' (lipsync)' : '');
            const lipsyncSeconds = Number(body.audio_seconds) || 0;
            if (lipsyncSeconds > 0) {
              await logSpend({
                provider: 'fal', model: step.model,
                unit_kind: 'minutes',
                units: Number((lipsyncSeconds / 60).toFixed(3)),
                usd: (lipsyncSeconds / 60) * step.usd,
                meta: { kind: 'lipsync', tier_requested: chosenTier, tier_used: step.key },
              });
            }
            return json({ engine, model: label, usd_per_min: step.usd, quality,
              tier_requested: chosenTier, tier_used: step.key,
              tier_changed: step.key !== chosenTier,
              request_id: String(d2.request_id || ''), status_url: String(d2.status_url || ''), response_url: String(d2.response_url || '') });
          }
          console.warn(`[fal] ${step.model} submit failed:`, r2.status, (await r2.text()).substring(0, 200));
        }
        return json({ error: 'fal sync-lipsync: niciun model (v3/v2-pro/v2/bază) nu a acceptat cererea — verifică FAL_KEY / creditele.' }, 502);
      } else if (engine === 'avatar') {
        // ── AVATAR ENGINE — the only path that GENERATES performance ────────
        // Redub models (above) can never make a stiff source clip look alive:
        // they only move the mouth. Kling AI Avatar drives head motion, blinks
        // and expression from the AUDIO itself, starting from a single photo —
        // that is what actually reads as a human presenter rather than a mask
        // pasted on a loop. $0.0562/s = $3.37/min (verified on fal).
        // Keep segments short (≈60s) — quality and stability degrade beyond it.
        if (!imageUrl) return json({ error: 'engine "avatar" needs image_url (un portret al prezentatorului)' }, 400);

        // ── LENGTH GUARD (added 30 Aug 2026) ─────────────────────────────
        // The comment above has said "keep segments short (≈60s)" since this
        // engine was added, and nothing enforced it. A 3-minute bulletin went
        // to Kling in ONE call: the avatar drifts, identity degrades, and it
        // bills $3.37/min — over $11 for a bulletin the admin page had priced
        // at $1.00 on the redub tariff, which does not apply to this engine.
        //
        // Splitting the audio into <=60s segments needs ffmpeg, which the Deno
        // edge runtime does not have, so it is NOT faked here. The honest
        // behaviour is to refuse and name the cheaper, better remedy: generate
        // the presenter CLIP once (Kling image-to-video, one payment), then
        // every daily bulletin is a $0.30/min redub on that clip.
        const AVATAR_MAX_S = 90;
        let audioSeconds = Number(body.audio_seconds) || 0;
        if (!audioSeconds) {
          // No duration supplied — estimate from file size. generate-voiceover
          // emits either 128 kbps MP3 (16 kB/s) or 24 kHz 16-bit mono WAV
          // (48 kB/s). Assume the denser of the two so the estimate errs
          // towards ALLOWING the call: wrongly refusing a short bulletin is
          // worse than letting a long one through.
          try {
            const head = await fetch(audioUrl, { method: 'HEAD' });
            const len = Number(head.headers.get('content-length') || 0);
            const isWav = /\.wav($|\?)/i.test(audioUrl);
            if (len > 0) audioSeconds = len / (isWav ? 48000 : 16000);
          } catch { /* estimate unavailable — allow the call */ }
        }
        if (audioSeconds > AVATAR_MAX_S) {
          return json({
            error:
              `AVATAR_TOO_LONG: vocea are ~${Math.round(audioSeconds)}s, iar Kling AI Avatar (portret animat) ` +
              `este stabil doar pana la ~${AVATAR_MAX_S}s si costa $3.37/minut — adica ~$${(audioSeconds / 60 * 3.37).toFixed(2)} ` +
              `pentru acest buletin. Genereaza o singura data un CLIP de prezentator din portret ` +
              `(pasul 4 → „Genereaza clip din portret (AI)"), apoi buletinele zilnice folosesc lipsync video ` +
              `de la $0.30/minut. Alternativ, scurteaza buletinul sub ${AVATAR_MAX_S}s.`,
            code: 'AVATAR_TOO_LONG',
            audio_seconds: Math.round(audioSeconds),
            estimated_usd: Number((audioSeconds / 60 * 3.37).toFixed(2)),
          }, 400);
        }

        model = 'fal-ai/kling-video/ai-avatar/v2/standard';
        payload = { image_url: imageUrl, audio_url: audioUrl };
        if (String(body.prompt || '').trim()) payload.prompt = String(body.prompt).trim();
      } else if (engine === 'latentsync') {
        if (!videoUrl) return json({ error: 'engine "latentsync" needs video_url (a presenter clip)' }, 400);
        model = 'fal-ai/latentsync';
        payload = { video_url: videoUrl, audio_url: audioUrl, loop_mode: 'loop' }; // see the tier table above for why this is 'loop', not 'pingpong'
      } else {
        if (!imageUrl) return json({ error: 'engine "sadtalker" needs image_url (a presenter portrait)' }, 400);
        model = 'fal-ai/sadtalker';
        payload = {
          source_image_url: imageUrl,
          driven_audio_url: audioUrl,
          face_model_resolution: '512',
          preprocess: 'full',
          still_mode: false,        // natural micro head-motion instead of frozen bust
          expression_scale: 1.1,    // slightly livelier articulation
          face_enhancer: 'gfpgan',  // face restoration pass — sharper, less waxy
        };
      }

      const res = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return json({ error: `fal ${engine} ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      return json({ engine, request_id: String(data.request_id || ''), status_url: String(data.status_url || ''), response_url: String(data.response_url || '') });
    }

    if (action === 'poll_fal') {
      if (!falKey) return json({ error: 'FAL_KEY not set' }, 400);
      const statusUrl = String(body.status_url || '').trim();
      const responseUrl = String(body.response_url || '').trim();
      const okUrl = (u: string) => { try { return new URL(u).hostname === 'queue.fal.run'; } catch { return false; } };
      if (!okUrl(statusUrl) || !okUrl(responseUrl)) return json({ error: 'status_url/response_url must come from generate_fal' }, 400);
      const auth = { Authorization: `Key ${falKey}` };
      const st = await fetch(statusUrl, { headers: auth });
      if (!st.ok) return json({ error: `fal status ${st.status}: ${(await st.text()).substring(0, 200)}` }, 502);
      const stData = await st.json();
      const status = String(stData.status || '');
      if (status !== 'COMPLETED') return json({ status, queue_position: stData.queue_position ?? null });
      const rr = await fetch(responseUrl, { headers: auth });
      if (!rr.ok) return json({ error: `fal result ${rr.status}: ${(await rr.text()).substring(0, 200)}` }, 502);
      const result = await rr.json();
      const videoUrl = String(result?.video?.url || '');
      if (!videoUrl) return json({ error: 'fal returned no video url: ' + JSON.stringify(result).substring(0, 200) }, 502);

      // We re-host the clip in our own bucket so the compositor gets a stable,
      // CORS-clean URL. If that upload fails FOR ANY REASON — most commonly the
      // Supabase "Upload file size limit" still sitting at its 50 MB default while
      // a high-quality sync-3 clip runs larger — we don't drop the finished clip:
      // fal's own delivery URLs (fal.media) are permanent and CORS-enabled, so we
      // hand that back instead. Raising the storage limit in the dashboard makes
      // every clip re-host in your own bucket again with no code change here.
      const vid = await fetch(videoUrl);
      if (!vid.ok) return json({ error: `video download failed (${vid.status})` }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());

      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fileName = `newsroom/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
      const { error: upErr } = await supabase.storage.from('studio-assets')
        .upload(fileName, bytes, { contentType: 'video/mp4', upsert: false });
      if (upErr) {
        console.warn('[storage] upload failed, serving fal URL:', upErr.message, `(${bytes.byteLength} bytes)`);
        const tooBig = /maximum allowed size|exceeded/i.test(upErr.message);
        return json({ status: 'completed', publicUrl: videoUrl, hosted: 'fal', bytes: bytes.byteLength,
          note: tooBig
            ? `Clip ${(bytes.byteLength/1048576).toFixed(1)} MB > limita de upload Supabase. Ridică „Upload file size limit” în Storage Settings (Pro permite până la 500 GB). Servit din fal deocamdată.`
            : `Stocare: ${upErr.message} — servit din fal.` });
      }
      const { data: pub } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
      return json({ status: 'completed', publicUrl: pub.publicUrl, hosted: 'supabase', bytes: bytes.byteLength, fileName });
    }

    // ── HeyGen actions (optional premium engine) ──────────────────────────
    const hgKey = Deno.env.get('HEYGEN_API_KEY');
    if (!hgKey) {
      return json({ configured: false, fal_configured: !!falKey, message: 'HEYGEN_API_KEY not set — use the free-stack anchor (fal/SadTalker) or add a HeyGen key for premium quality.' });
    }
    const hg = { 'X-Api-Key': hgKey };

    if (action === 'avatars') {
      const res = await fetch('https://api.heygen.com/v2/avatars', { headers: hg });
      if (!res.ok) return json({ error: `HeyGen avatars ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const raw = data?.data?.avatars || data?.avatars || [];
      const avatars = (Array.isArray(raw) ? raw : []).slice(0, 60).map((a: Record<string, unknown>) => ({
        avatar_id: String(a.avatar_id || ''),
        avatar_name: String(a.avatar_name || a.name || ''),
        preview_image_url: String(a.preview_image_url || a.preview_image || ''),
      })).filter((a: { avatar_id: string }) => a.avatar_id);
      return json({ configured: true, avatars });
    }

    if (action === 'upload_photo') {
      const imageUrl = String(body.image_url || '').trim();
      const consent = body.consent || {};
      if (!imageUrl) return json({ error: 'image_url is required' }, 400);
      // Consent gate protects REAL people's likenesses. A fully AI-generated,
      // fictional presenter has no person to consent — so it is exempt, but the
      // caller must say so explicitly (fictional:true). Real faces still gated.
      const fictional = body.fictional === true;
      if (!fictional && (consent.granted !== true || !String(consent.person_name || '').trim())) {
        return json({ error: 'CONSENT_REQUIRED: uploading a real person\'s face needs consent.granted=true and consent.person_name. For a fully AI-generated fictional presenter, pass fictional:true.' }, 403);
      }
      const img = await fetch(imageUrl);
      if (!img.ok) return json({ error: `Could not fetch photo (${img.status})` }, 400);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const ct = img.headers.get('content-type') || 'image/jpeg';
      const res = await fetch('https://upload.heygen.com/v1/talking_photo', {
        method: 'POST', headers: { ...hg, 'Content-Type': ct }, body: bytes,
      });
      if (!res.ok) return json({ error: `HeyGen upload ${res.status}: ${(await res.text()).substring(0, 250)}` }, 502);
      const data = await res.json();
      const id = String(data?.data?.talking_photo_id || data?.talking_photo_id || '');
      if (!id) return json({ error: 'HeyGen returned no talking_photo_id: ' + JSON.stringify(data).substring(0, 200) }, 502);
      return json({ talking_photo_id: id });
    }

    if (action === 'generate') {
      const character = body.character;
      const audioUrl = String(body.audio_url || '').trim();
      if (!character || !audioUrl) return json({ error: 'character and audio_url are required' }, 400);
      const width = Math.min(1920, Math.max(360, Number(body.width) || 1280));
      const height = Math.min(1920, Math.max(360, Number(body.height) || 720));

      // Background: prefer a real STUDIO IMAGE when one is supplied. HeyGen
      // composites the avatar into it natively, at source, in the right aspect —
      // which beats keying a portrait clip over a studio in our own compositor
      // (no green spill, no decapitation, correct scale and eyeline).
      const bgImage = String(body.background_image_url || '').trim();
      const background = bgImage
        ? { type: 'image', url: bgImage, fit: 'cover' }
        : { type: 'color', value: String(body.background_color || '#FBF4E4') };

      const payload = {
        video_inputs: [{
          character,
          voice: { type: 'audio', audio_url: audioUrl },
          background,
        }],
        dimension: { width, height },
      };
      const res = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST', headers: { ...hg, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) return json({ error: `HeyGen generate ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      const videoId = String(data?.data?.video_id || data?.video_id || '');
      if (!videoId) return json({ error: 'HeyGen returned no video_id: ' + JSON.stringify(data).substring(0, 200) }, 502);
      return json({ video_id: videoId });
    }

    if (action === 'status') {
      const videoId = String(body.video_id || '').trim();
      if (!videoId) return json({ error: 'video_id is required' }, 400);
      const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, { headers: hg });
      if (!res.ok) return json({ error: `HeyGen status ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const st = data?.data || {};
      const status = String(st.status || 'unknown');
      if (status !== 'completed') {
        return json({ status, error_detail: st.error ? JSON.stringify(st.error).substring(0, 200) : null });
      }
      const videoUrl = String(st.video_url || '');
      if (!videoUrl) return json({ error: 'completed but no video_url' }, 502);
      const vid = await fetch(videoUrl);
      if (!vid.ok) return json({ error: `video download failed (${vid.status})` }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fileName = `newsroom/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
      const { error: upErr } = await supabase.storage.from('studio-assets')
        .upload(fileName, bytes, { contentType: 'video/mp4', upsert: false });
      if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);
      const { data: pub } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
      return json({ status: 'completed', publicUrl: pub.publicUrl, fileName });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

// ── SPEND LOG ─────────────────────────────────────────────────────────────
// public.ai_spend_log has existed since 26 Aug and nothing writes to it. Every
// paid call in this function now records what it cost, so "what is the newsroom
// spending" is a query (public.ai_spend_by_function_daily) rather than a guess.
// Best-effort by construction: a logging failure must never fail a bulletin.
async function logSpend(row: {
  provider: string; model: string; usd: number;
  units?: number; unit_kind?: string; meta?: unknown;
}): Promise<void> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !svc || !Number.isFinite(row.usd)) return;
    const db = createClient(url, svc);
    await db.from('ai_spend_log').insert({
      function_name: 'newsroom-anchor',
      provider: row.provider,
      model: row.model,
      usd: Number(row.usd.toFixed(6)),
      units: row.units ?? 1,
      // 'requests' — plural. The live CHECK constraint rejects 'request'.
      unit_kind: row.unit_kind ?? 'requests',
      caller: 'newsroom',
      meta: row.meta ?? null,
    });
  } catch { /* never load-bearing */ }
}

/**
 * Convert the model's digits into spoken Romanian, ONCE, so that the script the
 * operator edits, the script the compositor times against, and the text the TTS
 * speaks are the same words. See the ROMANIAN BROADCAST NUMBERS block above for
 * why this must not happen later, in generate-voiceover.
 */
function broadcastify(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  if (typeof parsed.script === 'string') out.script = roBroadcast(parsed.script);
  const sec = parsed.sections as { greeting?: string; signoff?: string;
    stories?: Array<Record<string, unknown>> } | null | undefined;
  if (sec && typeof sec === 'object') {
    out.sections = {
      ...sec,
      greeting: typeof sec.greeting === 'string' ? roBroadcast(sec.greeting) : sec.greeting,
      signoff: typeof sec.signoff === 'string' ? roBroadcast(sec.signoff) : sec.signoff,
      stories: Array.isArray(sec.stories)
        ? sec.stories.map((st) => ({
            ...st,
            text: typeof st.text === 'string' ? roBroadcast(st.text as string) : st.text,
            // Lower-thirds are READ BY THE EYE, not spoken. "139 lei" is right on
            // a caption; "o sută treizeci și nouă de lei" would not fit 38 chars.
            lower_third: st.lower_third,
          }))
        : sec.stories,
    };
  }
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
