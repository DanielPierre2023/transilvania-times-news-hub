// supabase/functions/generate-voiceover/index.ts
//
// Marketing Studio — voiceover v5 — RO broadcast quality, AUTOMATIC FALLBACK.
// New in v5: fal-hosted ElevenLabs TTS (pay-per-use through your prepaid FAL_KEY,
// NO ElevenLabs subscription) and Gemini PRO TTS ahead of Flash. Chain:
//   EL direct -> fal:ElevenLabs -> Gemini Pro -> Gemini Flash -> OpenAI
// NO-SUBSCRIPTION-FIRST and fail-proof: it tries providers in order and only
// errors if EVERY configured provider fails — so a bad Gemini preview key or a
// missing model can never hard-stop a bulletin on its own.
//
//   1. ELEVENLABS (premium, only if ELEVENLABS_API_KEY + a voice_id): most
//      natural RO/EN, eleven_multilingual_v2 + voice_settings tones.
//   2. GEMINI (free, natural): gemini-2.5-flash-preview-tts, style via a
//      natural-language prefix, wraps raw PCM(L16/24k) into WAV. Uses the
//      GEMINI_API_KEY the pipeline already has.
//   3. OPENAI (last resort): gpt-4o-mini-tts.
//
// Input:  { text, provider?, voice_id?, gemini_voice?, gender?, tone?, language?, voice? }
//   provider     — 'elevenlabs' | 'minimax' | 'gemini' | 'openai' (optional; moved to front of chain)
//   voice_id     — ElevenLabs voice (stock or cloned)
//   minimax_voice— fal/MiniMax voice id (a subscription-free CLONED voice from
//                  voice-lab clone_fal, or a premade MiniMax voice). With
//                  provider:'minimax' it is delivered by fal/MiniMax only, no swap.
//   gemini_voice — Gemini prebuilt voice (Charon, Kore, …) — overrides gender default
//   gender       — 'm' | 'f' (picks a good default voice per engine when no explicit voice)
//   tone         — 'stiri' | 'emotional' | 'energic' | 'calm'
//   language     — 'ro' | 'en'
// Output: { success, publicUrl, fileName, provider, note? }  (note = which engines
//          were skipped/failed before the one that worked, for visibility)
//
// Env: GEMINI_API_KEY, ELEVENLABS_API_KEY (optional), OPENAI_API_KEY,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const OPENAI_VOICES = ['alloy','ash','ballad','coral','echo','fable','onyx','nova','sage','shimmer'];
const GEMINI_VOICES = ['Charon','Kore','Puck','Leda','Fenrir','Zephyr','Aoede','Orus'];

// Good defaults per gender for each engine (used when no explicit voice given).
const GEMINI_DEFAULT = { m: 'Charon', f: 'Kore' };
const OPENAI_DEFAULT = { m: 'onyx', f: 'nova' };

const EL_TONES: Record<string, { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean }> = {
  stiri:     { stability: 0.62, similarity_boost: 0.88, style: 0.18, use_speaker_boost: true },
  emotional: { stability: 0.35, similarity_boost: 0.85, style: 0.55, use_speaker_boost: true },
  energic:   { stability: 0.30, similarity_boost: 0.80, style: 0.70, use_speaker_boost: true },
  calm:      { stability: 0.78, similarity_boost: 0.85, style: 0.05, use_speaker_boost: true },
};

const GEMINI_STYLE: Record<string, { ro: string; en: string }> = {
  stiri:     { ro: 'Vorbește ca un VORBITOR NATIV de limbă română din România — pronunție românească autentică, FĂRĂ accent englezesc sau străin. Pronunță corect ă, â, î, ș, ț și grupurile ce/ci/ge/gi/che/chi. Ești prezentator de știri profesionist la televiziune: citește cald, clar și autoritar, cu ritm măsurat de buletin de știri, articulare curată a diacriticelor și pauze firești între propoziții. Fără emfază artificială, fără grabă.', en: 'You are a professional TV news anchor. Read warm, clear and authoritative, with a measured news pace, clean articulation and natural pauses between sentences.' },
  emotional: { ro: 'Citește cu emoție caldă și sinceră, ca o poveste spusă unui prieten apropiat: intim, uman, cu pauze naturale și inflexiuni blânde.', en: 'Read with warm, sincere emotion, like a story told to a close friend: intimate, human, with natural pauses.' },
  energic:   { ro: 'Citește energic și entuziast, ca un promo dinamic de televiziune: ritm alert, ton luminos și motivant, dar fără să strigi.', en: 'Read energetically, like a dynamic TV promo: brisk pace, bright motivating tone, without shouting.' },
  calm:      { ro: 'Citește calm și așezat, ca o narațiune de documentar: liniștit, limpede, reflexiv, cu respirație relaxată.', en: 'Read calmly, like a documentary narration: quiet, clear, reflective, relaxed breathing.' },
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


// ── ROMANIAN LEGAL CITATIONS ───────────────────────────────────────────────
// ADDED 29 Aug 2026, from a real on-air fault: "Legea 169/2006" was read as
// "legea o sută șaizeci... și nouă ... două mii șase" — the slash became a
// pause and the two numbers were spoken as separate quantities.
//
// No TTS engine gets this right, and it cannot be fixed with a lexicon row:
// there is a different law number in every bulletin. It needs a rule.
//
// Deliberately CONSERVATIVE. It only fires when a legal keyword introduces the
// citation, so a football score ("s-a terminat 2/1") and a plain reference
// ("Raportul 45/2020") are left exactly as they are. Getting this wrong on a
// score is worse than leaving a law number slightly clumsy.
const RO_U_M = ['zero','unu','doi','trei','patru','cinci','șase','șapte','opt','nouă','zece',
  'unsprezece','doisprezece','treisprezece','paisprezece','cincisprezece','șaisprezece',
  'șaptesprezece','optsprezece','nouăsprezece'];
const RO_U_F = (() => { const a = [...RO_U_M]; a[1] = 'una'; a[2] = 'două'; a[12] = 'douăsprezece'; return a; })();
const RO_TENS = ['', '', 'douăzeci','treizeci','patruzeci','cincizeci','șaizeci','șaptezeci','optzeci','nouăzeci'];

function roUnder100(n: number, f: boolean): string {
  if (n < 20) return (f ? RO_U_F : RO_U_M)[n];
  const t = Math.floor(n / 10), u = n % 10;
  return u === 0 ? RO_TENS[t] : `${RO_TENS[t]} și ${(f ? RO_U_F : RO_U_M)[u]}`;
}
function roUnder1000(n: number, f: boolean): string {
  if (n < 100) return roUnder100(n, f);
  const h = Math.floor(n / 100), r = n % 100;
  // "sută" is feminine: 100 = "o sută", 200 = "două sute".
  const head = h === 1 ? 'o sută' : `${RO_U_F[h]} sute`;
  return r === 0 ? head : `${head} ${roUnder100(r, f)}`;
}
function roNumber(n: number, f = false): string {
  n = Math.trunc(Math.abs(n));
  if (n < 1000) return roUnder1000(n, f);
  const th = Math.floor(n / 1000), r = n % 1000;
  // "mie/mii" is feminine: 1000 = "o mie", 2000 = "două mii".
  const head = th === 1 ? 'o mie' : `${roUnder1000(th, true)} mii`;
  return r === 0 ? head : `${head} ${roUnder1000(r, f)}`;
}
const RO_LEGAL_KW = '(Legea|legea|Legii|legii|Lege|OUG|O\\.?U\\.?G\\.?|Ordonanța|ordonanța|' +
  'Hotărârea|hotărârea|HG|H\\.?G\\.?|Decretul|decretul|Directiva|directiva|' +
  'Regulamentul|regulamentul|Normele|normele|Codul|codul)';
function expandRoLegalRefs(text: string): string {
  return text.replace(
    new RegExp(`\\b${RO_LEGAL_KW}\\s+(?:nr\\.?\\s*)?(\\d{1,4})\\s*/\\s*(\\d{4})\\b`, 'g'),
    (_m, kw, num, year) => `${kw} ${roNumber(Number(num))} din ${roNumber(Number(year))}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ROMANIAN SPEECH NORMALISATION  ("Ioana speaks proper Romanian")
// Added 30 Aug 2026.
//
// WHY IT LIVES HERE AND NOWHERE ELSE
// This function is the last place the bulletin exists as WORDS before it
// becomes audio, and every one of the seven TTS engines below is fed from
// this same string. Put the rules here and the anchor is correct whichever
// engine answers; put them in a script-generating function and they only
// apply when that one function wrote the text — a hand-edited script, or a
// script from any other path, would still reach the voice raw.
//
// COST: zero. Pure TypeScript, no model call, no network.
//
// ORDER (unchanged in spirit from the 28-29 Aug design):
//   1. roCleanup()        — characters only, BEFORE the lexicon, so a lexicon
//                           row written with proper diacritics matches text
//                           that arrived with cedillas.
//   2. public.apply_lexicon()  — YOUR table. Always wins.
//   3. expandRoLegalRefs()     — law citations.
//   4. roSpeech()         — everything below.
// The lexicon runs BEFORE any digits are turned into words, deliberately: a
// row keyed on "Legea 55/2020" could never match text where the digits had
// already been spelled out. A mispronunciation heard on air stays one INSERT.
//
// SCOPE, deliberately conservative: acronyms and foreign names are expanded
// ONLY from the explicit tables below. Unknown ALL-CAPS words are left alone
// rather than guessed at, because mangling an emphasised Romanian word on air
// is worse than a slightly flat acronym — and the lexicon table covers the
// long tail without a deploy.
// ══════════════════════════════════════════════════════════════════════════

/** Characters only. Safe to run before the lexicon. */
function roCleanup(input: string): string {
  return input
    .replace(/ /g, ' ')                                   // NBSP
    .replace(/[‘’]/g, "'")                            // smart single quotes
    .replace(/[“”„‟]/g, '"')                // smart double quotes
    .replace(/[–—−]/g, '-')                      // en/em dash, minus
    .replace(/…/g, '...')                                  // ellipsis char
    // Cedilla forms (legacy Windows-1250 Romanian). The TTS voices are trained
    // on the comma-below letters; the cedilla look-alikes are different code
    // points and get read as a plain s / t.
    .replace(/ş/g, 'ș').replace(/ţ/g, 'ț')
    .replace(/Ş/g, 'Ș').replace(/Ţ/g, 'Ț')
    .replace(/[*_`#>]/g, '')                                    // markdown residue
    .replace(/\[[^\]]{0,80}\]/g, ' ')                           // [stage directions]
    .replace(/[ \t]{2,}/g, ' ');
}

// ── numerals ──────────────────────────────────────────────────────────────
// roUnder100 / roUnder1000 / roNumber already exist above (added for the legal
// citations) and handle 0-999999 with gender. These extend the range and add
// the two things Romanian actually needs: agreement, and the linking "de".

/**
 * Cardinal up to 999 999 999 999, gendered.
 *
 * NOTE: this does NOT call roNumber() above, deliberately. That helper joins
 * thousands as `${roUnder1000(th, true)} mii`, which drops the linking "de":
 * 250 000 comes out "două sute cincizeci mii" instead of "două sute cincizeci
 * DE mii". It never shows on the legal-citation path (law numbers and 4-digit
 * years both land under 20 thousand), so roNumber is left exactly as it is and
 * this path does its own joining.
 */
function roCardinal(n: number, f = false): string {
  n = Math.trunc(Math.abs(n));
  if (n < 1000) return roUnder1000(n, f);
  if (n < 1_000_000) {
    const th = Math.floor(n / 1000), rest = n % 1000;
    const head = th === 1 ? 'o mie'
      : `${roUnder1000(th, true)}${roNeedsDe(th) ? ' de' : ''} mii`;
    return rest === 0 ? head : `${head} ${roUnder1000(rest, f)}`;
  }
  const scales: Array<[number, string, string]> = [
    [1_000_000_000, 'un miliard', 'miliarde'],
    [1_000_000, 'un milion', 'milioane'],
  ];
  for (const [size, one, many] of scales) {
    if (n >= size) {
      const head = Math.floor(n / size), rest = n % size;
      // "milion"/"miliard" are nouns: feminine count, and always "de".
      const headWords = head === 1 ? one : `${roCardinal(head, true)} de ${many}`;
      return rest === 0 ? headWords : `${headWords} ${roCardinal(rest, f)}`;
    }
  }
  return roUnder1000(n, f);
}

/**
 * Does this number need the linking "de" before its noun?
 * Romanian: 1-19 attach directly ("nouăsprezece lei"); from 20 the noun is
 * introduced by "de" ("douăzeci DE lei"). For compounds it is the last two
 * digits that decide: 115 -> "o sută cincisprezece lei", but 120 -> "o sută
 * douăzeci DE lei", and a round hundred or thousand always takes it.
 */
function roNeedsDe(n: number): boolean {
  n = Math.trunc(Math.abs(n));
  if (n < 20) return false;
  const last2 = n % 100;
  return last2 === 0 || last2 >= 20;
}

/**
 * Gender of the counted noun. Romanian neuter nouns behave as masculine in the
 * singular and FEMININE in the plural, which is why "două procente" and "două
 * kilograme" are correct and "doi procente" is not. Everything counted here is
 * plural, so neuter is listed as feminine.
 */
const RO_MASC_NOUNS = new Set([
  'leu','lei','euro','dolar','dolari','metru','metri','kilometru','kilometri',
  'litru','litri','an','ani','kilowați','megawați','locuitor','locuitori',
  'oameni','elev','elevi','copil','copii','bărbat','bărbați','pacient','pacienți',
  'angajat','angajați','membru','membri','pompier','pompieri','polițist','polițiști',
  'militar','militari','șofer','șoferi','turist','turiști','morți','răniți',
]);
const RO_FEM_NOUNS = new Set([
  // true feminines
  'oră','ore','zi','zile','lună','luni','săptămână','săptămâni','secundă','secunde',
  'persoană','persoane','mașină','mașini','casă','case','școală','școli','firmă','firme',
  'familie','familii','femeie','femei','tonă','tone','mie','mii','sută','sute',
  'victimă','victime','ambulanță','ambulanțe','autospecială','autospeciale',
]);
// Romanian NEUTER: masculine in the singular ("un miliard"), feminine in the
// plural ("două miliarde"). Kept apart from the true feminines for that reason.
const RO_NEUTER_NOUNS = new Set([
  'procent','procente','grad','grade','minut','minute','kilogram','kilograme',
  'apartament','apartamente','loc','locuri','punct','puncte','proiect','proiecte',
  'milion','milioane','miliard','miliarde','hectar','hectare','exemplar','exemplare',
  'vehicul','vehicule','autoturism','autoturisme','spital','spitale','sat','sate',
  'oraș','orașe','dosar','dosare','contract','contracte','locuri de muncă',
]);
/** Strip diacritics so a noun typed without them still resolves. */
function roFold(w: string): string {
  return w.toLowerCase().replace(/[.,;:!?]+$/, '')
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/ș/g, 's').replace(/ț/g, 't');
}
const FOLD_M = new Set([...RO_MASC_NOUNS].map(roFold));
const FOLD_F = new Set([...RO_FEM_NOUNS].map(roFold));
const FOLD_N = new Set([...RO_NEUTER_NOUNS].map(roFold));

/** 'm' | 'f' | 'n'. Neuter is resolved by number at the call site. */
function roGenderOf(noun: string): 'm' | 'f' | 'n' {
  const w = roFold(noun);
  if (FOLD_M.has(w)) return 'm';
  if (FOLD_F.has(w)) return 'f';
  if (FOLD_N.has(w)) return 'n';
  // Unknown noun: masculine, because that is what an unmodified TTS already
  // produces — an unrecognised word is never made worse than it is today.
  return 'm';
}

function roCount(n: number, noun: string, deAlreadyThere = false): string {
  const g = roGenderOf(noun);              // gender comes from the NOUN alone
  // Singular: "1" is an article, not the numeral "unu". Neuter takes "un".
  if (n === 1) return `${g === 'f' ? 'o' : 'un'} ${noun}`;
  // Plural: neuter agrees with the feminine ("două miliarde", "două grade").
  const words = roCardinal(n, g !== 'm');
  if (deAlreadyThere || roNeedsDe(n)) return `${words} de ${noun}`;
  return `${words} ${noun}`;
}

const RO_MONTHS = ['ianuarie','februarie','martie','aprilie','mai','iunie',
  'iulie','august','septembrie','octombrie','noiembrie','decembrie'];

/** Ordinals, masculine — used only for centuries and monarch regnal numbers. */
const RO_ORD_M = ['','întâi','al doilea','al treilea','al patrulea','al cincilea',
  'al șaselea','al șaptelea','al optulea','al nouălea','al zecelea','al unsprezecelea',
  'al doisprezecelea','al treisprezecelea','al paisprezecelea','al cincisprezecelea',
  'al șaisprezecelea','al șaptesprezecelea','al optsprezecelea','al nouăsprezecelea',
  'al douăzecilea','al douăzeci și unulea'];
function roOrdinalM(n: number): string { return RO_ORD_M[n] || roCardinal(n); }
/** Feminine ordinals — "clasa a VIII-a" is "clasa a opta", not "a optulea". */
const RO_ORD_F = ['','întâia','a doua','a treia','a patra','a cincea','a șasea',
  'a șaptea','a opta','a noua','a zecea','a unsprezecea','a douăsprezecea',
  'a treisprezecea','a paisprezecea','a cincisprezecea','a șaisprezecea',
  'a șaptesprezecea','a optsprezecea','a nouăsprezecea','a douăzecea'];
function roOrdinalF(n: number): string { return RO_ORD_F[n] || roCardinal(n, true); }

const ROMAN: Record<string, number> = { I:1,V:5,X:10,L:50,C:100,D:500,M:1000 };
function romanToArabic(s: string): number {
  const t = s.toUpperCase(); let total = 0;
  for (let i = 0; i < t.length; i++) {
    const v = ROMAN[t[i]]; if (!v) return 0;
    const nx = ROMAN[t[i + 1]] || 0;
    total += v < nx ? -v : v;
  }
  return total;
}

// ── acronyms: explicit only ───────────────────────────────────────────────
// "word" = pronounce as written (the TTS already says it correctly).
// Anything else is the exact spoken form, in ordinary Romanian spelling.
// NOT in this table? It is left untouched and belongs in
// public.pronunciation_lexicon — one INSERT, no deploy.
const RO_ACRONYMS: Record<string, string> = {
  ANAF: 'Anaf', ISU: 'Isu', DSU: 'de-se-u', DSP: 'de-se-pe', DNA: 'de-ne-a',
  SRI: 'se-re-i', SIE: 'se-i-e', CFR: 'ce-fe-re', TVA: 'te-ve-a', PIB: 'pib',
  BNR: 'be-ne-re', INS: 'i-ne-se', ANM: 'a-ne-me', ISJ: 'i-se-je',
  ITM: 'i-te-me', IPJ: 'i-pe-je', UMF: 'u-me-fe', UBB: 'u-be-be',
  CNAIR: 'Cnair', SMURD: 'Smurd', UE: 'Uniunea Europeană', SUA: 'Sua',
  NATO: 'Nato', ONU: 'O-ne-u', OMS: 'o-me-se', PSD: 'pe-se-de', PNL: 'pe-ne-le',
  USR: 'u-se-re', AUR: 'Aur', UDMR: 'u-de-me-re', ADI: 'a-de-i',
  RATUC: 'Ratuc', CTP: 'ce-te-pe', OUG: 'o-u-ge', HG: 'ha-ge', CJ: 'ce-je',
  PSI: 'pe-se-i', GDPR: 'ge-de-pe-re', AI: 'a-i', PET: 'pet',
};

// ── foreign names the Romanian TTS reliably gets wrong ────────────────────
// Respelled in ordinary Romanian orthography, never IPA. Same rule as above:
// the long tail belongs in the lexicon table, not in a deploy.
const RO_FOREIGN: Record<string, string> = {
  Google: 'Gugăl', YouTube: 'Iutiub', Facebook: 'Feisbuc', TikTok: 'Ticstoc',
  WhatsApp: 'Uatsap', Microsoft: 'Maicrosoft', Instagram: 'Instagram',
  Schengen: 'Șenghen', Bruxelles: 'Brusel', Boeing: 'Boing', Airbus: 'Erbas',
  Chelsea: 'Celsi', Juventus: 'Iuventus', Bayern: 'Baiern', Liverpool: 'Liverpul',
  Manchester: 'Mancester', Wembley: 'Uembli', Netflix: 'Netflics',
  Amazon: 'Amazon', Tesla: 'Tesla', OpenAI: 'Oupăn-ei-ai', PayPal: 'Peipal',
  Bitcoin: 'Bitcoin', Brexit: 'Brecsit', Eurostat: 'Eurostat',
};

// ── units ─────────────────────────────────────────────────────────────────
// Written form -> spoken noun. The noun decides the numeral's gender via
// roGenderOf(), so "2 ore" becomes "două ore" and "2 lei" stays "doi lei".
const RO_UNITS: Array<[RegExp, string]> = [
  [/km\/h|km\/oră/gi, 'kilometri pe oră'],
  [/m\/s/gi, 'metri pe secundă'],
  [/kWh/gi, 'kilowați-oră'],
  [/MWh/gi, 'megawați-oră'],
  [/\bMW\b/g, 'megawați'],
  [/\bkW\b/g, 'kilowați'],
  [/\bkm²|km2\b/gi, 'kilometri pătrați'],
  [/\bm²|mp\b/gi, 'metri pătrați'],
  [/\bkm\b/gi, 'kilometri'],
  [/\bcm\b/gi, 'centimetri'],
  [/\bmm\b/gi, 'milimetri'],
  [/\bkg\b/gi, 'kilograme'],
  [/\bha\b/g, 'hectare'],
  [/\bml\b/gi, 'mililitri'],
  [/\bRON\b/g, 'lei'],
  [/\bEUR\b/g, 'euro'],
  [/\bUSD\b/g, 'dolari'],
];

/**
 * The deterministic pass. Runs AFTER the lexicon and after the legal-citation
 * expander, so anything an editor fixed by hand is already gone from the text
 * and cannot be re-mangled here.
 */
function roSpeech(input: string): string {
  let t = input;

  // 1 · DATES. First, because 12.03.2026 and 12.500 are the same shape to a
  //     naive thousands separator rule.
  t = t.replace(/\b(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})\b/g, (m, d, mo, y) => {
    const dd = +d, mm = +mo, yy = +y;
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return m;
    // Days are counted with the feminine (elided "ziua"): "două martie".
    return `${dd === 1 ? 'întâi' : roCardinal(dd, true)} ${RO_MONTHS[mm - 1]} ${roCardinal(yy, true)}`;
  });
  // "1 ianuarie", "23 august 2026" — the day, and the year if present.
  t = t.replace(
    new RegExp(`\\b(\\d{1,2})\\s+(${RO_MONTHS.join('|')})(\\s+(\\d{4}))?\\b`, 'gi'),
    (m, d, mon, _all, y) => {
      const dd = +d; if (dd < 1 || dd > 31) return m;
      const day = dd === 1 ? 'întâi' : roCardinal(dd, true);
      return y ? `${day} ${mon} ${roCardinal(+y, true)}` : `${day} ${mon}`;
    });

  // 2 · CLOCK. Hours agree with the elided feminine "ora"; :00 drops minutes.
  t = t.replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, (_m, h, mi) => {
    const hh = +h, mm = +mi;
    const hw = roCardinal(hh, true);
    return mm === 0 ? hw : `${hw} și ${roCardinal(mm, true)}`;
  });
  t = t.replace(/\bora\s+(\d{1,2})\b/gi, (_m, h) => `ora ${roCardinal(+h, true)}`);

  // 3 · PHONE NUMBERS, read digit by digit as a person would.
  t = t.replace(/\b0\d{3}[ .\-]?\d{3}[ .\-]?\d{3}\b/g, (m) =>
    m.replace(/\D/g, '').split('').map((c) => RO_U_M[+c]).join(' '));

  // 4 · ROMAN NUMERALS, in explicit contexts only. A bare "I", "C" or "M" in
  //     Romanian copy is far more often a letter than a numeral.
  t = t.replace(/\b(secolul|secolele|sec\.)\s+([IVXLCDM]+)\b/gi, (m, w, r) => {
    const n = romanToArabic(r); if (!n) return m;
    const head = w[0] === w[0].toUpperCase() ? 'Secolul' : 'secolul';
    return `${head} ${roOrdinalM(n)}`;
  });
  // "clasa a VIII-a", "etapa a II-a" — feminine ordinal.
  t = t.replace(/\b(clasa|etapa|runda|grupa|ediția)\s+a\s+([IVXLCDM]+)\s*-\s*a\b/gi, (m, w, r) => {
    const n = romanToArabic(r); return n ? `${w} ${roOrdinalF(n)}` : m;
  });
  t = t.replace(/\b(clasa|etapa|runda|grupa|ediția)\s+([IVXLCDM]+)\b/gi, (m, w, r) => {
    const n = romanToArabic(r); return n ? `${w} ${roCardinal(n, true)}` : m;
  });
  t = t.replace(/\bal\s+([IVXLCDM]+)-lea\b/gi, (m, r) => {
    const n = romanToArabic(r); return n ? roOrdinalM(n) : m;
  });

  // 5 · ABBREVIATIONS that are read as full words.
  t = t
    .replace(/\bnr\.\s*/gi, 'numărul ')
    .replace(/\bart\.\s*/gi, 'articolul ')
    .replace(/\balin\.\s*/gi, 'alineatul ')
    .replace(/\blit\.\s*/gi, 'litera ')
    .replace(/\bjud\.\s*/gi, 'județul ')
    .replace(/\bstr\.\s*/gi, 'strada ')
    .replace(/\bbd\.\s*/gi, 'bulevardul ')
    .replace(/\bap\.\s*/gi, 'apartamentul ')
    .replace(/\bmld\.\s*/gi, 'miliarde ')
    .replace(/\bmil\.\s*/gi, 'milioane ')
    .replace(/\betc\./gi, 'etcetera')
    .replace(/\bdr\.\s*/g, 'doctor ')
    .replace(/\bprof\.\s*/gi, 'profesor ')
    .replace(/\bing\.\s*/gi, 'inginer ')
    .replace(/\bp\.m\./gi, 'după-amiaza')
    .replace(/\ba\.m\./gi, 'dimineața');

  // 6 · ACRONYMS and FOREIGN NAMES — explicit tables only (see the note above).
  for (const [k, v] of Object.entries(RO_ACRONYMS)) {
    t = t.replace(new RegExp(`\\b${k}\\b`, 'g'), v);
  }
  for (const [k, v] of Object.entries(RO_FOREIGN)) {
    t = t.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
  }

  // 7 · UNITS: written symbol -> spoken noun, before the numbers are expanded,
  //     so the noun is available to decide the numeral's gender.
  for (const [re, word] of RO_UNITS) t = t.replace(re, word);

  // 8 · PERCENT, DEGREES, CURRENCY SYMBOLS.
  t = t.replace(/(\d)\s*%/g, '$1 procente')
       .replace(/(\d)\s*°\s*C/gi, '$1 grade Celsius')
       .replace(/(\d)\s*°/g, '$1 grade')
       .replace(/€\s*(\d)/g, '$1 euro').replace(/(\d)\s*€/g, '$1 euro')
       .replace(/\$\s*(\d)/g, '$1 dolari').replace(/(\d)\s*\$/g, '$1 dolari');

  // 9 · THOUSANDS SEPARATORS. Romanian writes 12.500 and 12 500; both are one
  //     number, not two. Runs after dates so 12.03.2026 is already gone.
  t = t.replace(/\b(\d{1,3})(?:[.   ](\d{3}))+(?![\d.,])/g, (m) =>
    m.replace(/[.   ]/g, ''));

  // 10 · DECIMALS with the Romanian comma: 3,5 -> "trei virgulă cinci".
  t = t.replace(/\b(\d+),(\d+)\b/g, (_m, a, b) =>
    `${roCardinal(+a)} virgulă ${b.length > 1 && b[0] === '0'
      ? b.split('').map((c: string) => RO_U_M[+c]).join(' ')
      : roCardinal(+b)}`);

  // 11 · RANGES: "10-15 grade" is a range, not a subtraction.
  t = t.replace(/\b(\d+)\s*-\s*(\d+)\b/g, (_m, a, b) => `${roCardinal(+a)} - ${roCardinal(+b)}`);

  // 12 · NUMBER + NOUN, with agreement and the linking "de".
  t = t.replace(/\b(\d{1,12})\s+(de\s+)?([a-zăâîșț]+)/gi, (m, num, de, noun) => {
    const n = +num;
    if (!Number.isFinite(n)) return m;
    return roCount(n, noun, Boolean(de));
  });

  // 13 · Any remaining bare integer.
  t = t.replace(/\b\d{1,12}\b/g, (m) => roCardinal(+m));

  // 14 · Symbols that would otherwise be read as punctuation, or silently.
  t = t.replace(/\s*&\s*/g, ' și ')
       .replace(/\s*\+\s*/g, ' plus ')
       .replace(/\s*=\s*/g, ' egal ')
       .replace(/\s*×\s*/g, ' ori ')
       .replace(/§/g, 'paragraful ')
       .replace(/№/g, 'numărul ');

  return t.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1');
}


serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    // NOTE: the old normaliser was `/\s+\n/g -> '\n'`, which ATE the blank line
    // between stories ("a\n\nb" became "a\nb"). Paragraph breaks are the only
    // story boundary marker we have, so they must survive normalisation.
    let text = String(body.text || '')
      .replace(/\r\n?/g, '\n')       // CRLF -> LF
      .replace(/[ \t]+\n/g, '\n')    // trailing spaces at end of a line
      .replace(/\n{3,}/g, '\n\n')     // cap at ONE blank line
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    if (!text) return json({ error: 'text is required' }, 400);

    // Character-level cleanup runs BEFORE the lexicon so that a row written
    // with proper diacritics still matches text that arrived with cedillas.
    text = roCleanup(text);

    // ═══ PRONUNCIATION LEXICON ═══════════════════════════════════════════
    // ADDED 28 Aug 2026. This is the LAST place the bulletin exists as words
    // before it becomes audio, so it is the only correct place to apply
    // written -> spoken rewrites. Every engine below gets the corrected text;
    // fixing it per-engine would mean fixing it seven times.
    //
    // The rules live in public.pronunciation_lexicon and are applied by
    // public.apply_lexicon(). A new mispronunciation heard on air is one INSERT
    // and takes effect on the next bulletin — no redeploy, no code.
    //
    // FAILS OPEN, deliberately: if the table or function is missing, or the
    // call errors, the ORIGINAL text is spoken. A pronunciation nicety must
    // never be able to take the whole voiceover down.
    const lexLang = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
    let lexiconApplied = false;
    if (body.apply_lexicon !== false) {
      try {
        const lexUrl = Deno.env.get('SUPABASE_URL');
        const lexKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (lexUrl && lexKey) {
          const lexDb = createClient(lexUrl, lexKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const { data: lexed, error: lexErr } = await lexDb.rpc('apply_lexicon', { p_text: text, p_lang: lexLang });
          if (!lexErr && typeof lexed === 'string' && lexed.trim()) {
            if (lexed !== text) { lexiconApplied = true; console.log(`[lexicon] ${text.length} -> ${lexed.length} chars, rules applied`); }
            text = lexed;
          } else if (lexErr) {
            console.warn('[lexicon] skipped:', lexErr.message);
          }
        }
      } catch (e) {
        console.warn('[lexicon] skipped:', (e as Error).message);
      }
    }

    // Legal citations, AFTER the lexicon so a hand-written lexicon row always
    // wins: if you add a row for a specific law, its digits are already gone by
    // the time this runs and the regex cannot match them.
    if (lexLang === 'ro') {
      const before = text;
      text = expandRoLegalRefs(text);
      if (text !== before) console.log('[legal] expanded a law citation');
    }

    // Romanian speech normalisation. LAST of the text passes, so anything an
    // editor fixed by hand through the lexicon is already gone and cannot be
    // re-mangled here. Pure TypeScript: no model call, no network, no cost.
    let speechChanged = false;
    if (lexLang === 'ro') {
      const beforeSpeech = text;
      text = roSpeech(text);
      speechChanged = text !== beforeSpeech;
      if (speechChanged) console.log('[ro-speech] normalised numbers/abbreviations for TTS');
    }

    // Cap AFTER all passes: a respelling changes length, and truncating first
    // could cut a word one of them was about to rewrite.
    if (text.length > 4800) text = text.slice(0, 4800);

    // ═══ INTER-STORY PAUSE ═══════════════════════════════════════════════
    // The bulletin script joins stories with a blank line, but TTS engines
    // ignore blank lines entirely — so the anchor ran every story together with
    // no breath between them. A real newsreader pauses ~0.5-1s before the next
    // item. Each engine needs a DIFFERENT mechanism, so we build the pause per
    // engine instead of putting markup in the script the user edits.
    //   pause_ms: 0 disables it. Clamped to ElevenLabs' 3s ceiling.
    const pauseMs = Math.max(0, Math.min(3000, Number(body.pause_ms ?? 700)));
    // Paragraph boundaries in the generated script ARE the story boundaries:
    // newsroom-anchor builds `script` as [greeting, ...stories, signoff].join('\n\n').
    // If a hand-pasted script uses single newlines instead, fall back to those.
    const blocks = text.split(/\n\s*\n+/).map(t => t.trim()).filter(Boolean);
    const paragraphs = blocks.length > 1
      ? blocks
      : text.split(/\n+/).map(t => t.trim()).filter(Boolean);
    const xmlEscape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // ElevenLabs v2 models honour <break time="x.xs" />. Their docs warn that
    // MANY breaks in one generation can destabilise the voice, so we only place
    // one per story boundary — never inside a story.
    const textWithElevenBreaks = (): string => {
      if (!pauseMs || paragraphs.length < 2) return text;
      return paragraphs.join(` <break time="${(pauseMs / 1000).toFixed(1)}s" /> `);
    };
    // Google Cloud TTS needs true SSML input mode for <break>.
    const ssmlWithBreaks = (): string => {
      const joined = pauseMs && paragraphs.length > 1
        ? paragraphs.map(xmlEscape).join(`<break time="${pauseMs}ms"/>`)
        : xmlEscape(text);
      return `<speak>${joined}</speak>`;
    };
    // Gemini and OpenAI accept no markup. An ellipsis plus a paragraph break is
    // the strongest pause cue they respond to — weaker than a real break tag,
    // which is why the ElevenLabs path stays the recommended one.
    const textWithSoftPauses = (): string => {
      if (!pauseMs || paragraphs.length < 2) return text;
      return paragraphs.join('\n\n…\n\n');
    };
    // MiniMax (fal-ai/minimax/speech-2.8-hd) documents an explicit silence
    // marker: `<#x#>` where x is 0.01-99.99 SECONDS. Exact duration, no prosody
    // side effects — the best of the non-ElevenLabs engines for this.
    const textWithMinimaxPauses = (): string => {
      if (!pauseMs || paragraphs.length < 2) return text;
      const secs = Math.max(0.01, Math.min(99.99, pauseMs / 1000)).toFixed(2);
      return paragraphs.join(` <#${secs}#> `);
    };
    // fal's Gemini TTS takes no SSML but documents expressive audio tags,
    // including `[short pause]`. Duration is approximate (model-decided), so we
    // also state the intent in style_instructions.
    const textWithTagPauses = (): string => {
      if (!pauseMs || paragraphs.length < 2) return text;
      return paragraphs.join('\n\n[short pause]\n\n');
    };

    const tone = String(body.tone || 'stiri');
    const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
    // Default FEMALE: this is a news anchorwoman. The old default ('m') is what
    // silently produced the male voice "George" whenever a fallback kicked in.
    const gender = String(body.gender || 'f') === 'm' ? 'm' : 'f';
    // Trim: a stray newline/space/quote in the secret invalidates the header.
    const elKey = (Deno.env.get('ELEVENLABS_API_KEY') || '').trim().replace(/^["']|["']$/g, '') || undefined;
    const falKey = Deno.env.get('FAL_KEY');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const requestedRaw = String(body.provider || '').trim();
    // 'minimax' is the Studio's name for a fal/MiniMax CLONED voice — map it to
    // the fal_minimax engine that already exists below.
    const requested = requestedRaw === 'minimax' ? 'fal_minimax' : requestedRaw;
    const minimaxVoice = String(body.minimax_voice || '').trim();
    // A cloned MiniMax voice named explicitly (the user's own voice, via fal —
    // no ElevenLabs) must be delivered by fal/MiniMax or fail with the reason,
    // never silently swapped for a different (English-accented) voice.
    const wantsMinimaxClone = (requestedRaw === 'minimax' || requested === 'fal_minimax') && !!minimaxVoice;

    type Out = { bytes: Uint8Array; ext: string; contentType: string };

    // ── engine implementations (throw on failure) ─────────────────────────
    const elGen = async (): Promise<Out> => {
      if (!elKey) throw new Error('no ElevenLabs key');
      const voiceId = String(body.voice_id || '').trim();
      if (!voiceId) throw new Error('no voice_id');
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        { method: 'POST', headers: { 'xi-api-key': elKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: textWithElevenBreaks(), model_id: 'eleven_multilingual_v2', voice_settings: EL_TONES[tone] || EL_TONES.stiri, language_code: language }) },
      );
      if (!res.ok) {
        const txt = await res.text();
        // Same key mix-up as voice-lab: the dashboard's "API key ID" is not the
        // key. Surface the actionable version instead of the raw API error.
        if (/API key ID used as API key/i.test(txt)) {
          throw new Error('CHEIE GRESITA: ai pus ID-ul cheii ElevenLabs, nu cheia. Cheia reala incepe cu "sk_" si se vede o singura data, la creare. Creeaza una noua in ElevenLabs -> API Keys si pune-o ca ELEVENLABS_API_KEY in Supabase -> Project Settings -> Edge Functions -> Secrets.');
        }
        throw new Error(`ElevenLabs ${res.status}: ${txt.substring(0, 160)}`);
      }
      return { bytes: new Uint8Array(await res.arrayBuffer()), ext: 'mp3', contentType: 'audio/mpeg' };
    };

    // fal-hosted ElevenLabs multilingual v2 — EL-grade Romanian, prepaid fal
    // credits, no ElevenLabs account. Named premade voices, RO handled natively.
    const FAL_EL_DEFAULT = { m: 'George', f: 'Sarah' };
    const falElGen = async (): Promise<Out> => {
      if (!falKey) throw new Error('no FAL key');
      // fal documents this field as "the name OR the ID (voice_id) of the voice",
      // so a real ElevenLabs voice id can be passed here too. Prefer an explicit
      // el_voice, then the user's own voice_id, and only then a premade default.
      const voice = String(body.el_voice || '').trim()
        || String(body.voice_id || '').trim()
        || FAL_EL_DEFAULT[gender];
      const t = EL_TONES[tone] || EL_TONES.stiri;
      const res = await fetch('https://fal.run/fal-ai/elevenlabs/tts/multilingual-v2', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textWithElevenBreaks(), voice, language_code: language,
          stability: t.stability, similarity_boost: t.similarity_boost, style: t.style }),
      });
      if (!res.ok) throw new Error(`fal-elevenlabs ${res.status}: ${(await res.text()).substring(0, 160)}`);
      const data = await res.json();
      const url = String(data?.audio?.url || data?.audio_url || '');
      if (!url) throw new Error('fal-elevenlabs returned no audio url');
      const aud = await fetch(url);
      if (!aud.ok) throw new Error(`fal-elevenlabs audio download ${aud.status}`);
      return { bytes: new Uint8Array(await aud.arrayBuffer()), ext: 'mp3', contentType: 'audio/mpeg' };
    };

    const geminiCall = async (model: string): Promise<Out> => {
      const voiceName = GEMINI_VOICES.includes(String(body.gemini_voice)) ? String(body.gemini_voice) : GEMINI_DEFAULT[gender];
      const style = (GEMINI_STYLE[tone] || GEMINI_STYLE.stiri)[language];
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${style}\n\nFă o pauză scurtă (aprox. o secundă) între secțiunile separate prin linie goală.\n\n${textWithSoftPauses()}` }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } },
          }) },
      );
      if (!res.ok) throw new Error(`Gemini(${model}) ${res.status}: ${(await res.text()).substring(0, 160)}`);
      const data = await res.json();
      const part = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      const b64 = String(part?.data || '');
      if (!b64) throw new Error('Gemini returned no audio');
      const mime = String(part?.mimeType || 'audio/L16;codec=pcm;rate=24000');
      const sampleRate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000);
      return { bytes: wavFromPcm16(b64ToBytes(b64), sampleRate, 1), ext: 'wav', contentType: 'audio/wav' };
    };
    const geminiGen = async (): Promise<Out> => {
      if (!geminiKey) throw new Error('no Gemini key');
      // PRO TTS first — audibly better prosody in Romanian; Flash as fallback.
      try { return await geminiCall('gemini-2.5-pro-preview-tts'); }
      catch (_e) { return await geminiCall('gemini-2.5-flash-preview-tts'); }
    };

    const openaiGen = async (): Promise<Out> => {
      if (!openaiKey) throw new Error('no OpenAI key');
      const voice = OPENAI_VOICES.includes(String(body.voice)) ? String(body.voice) : OPENAI_DEFAULT[gender];
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: textWithSoftPauses(), response_format: 'mp3',
          instructions: (GEMINI_STYLE[tone] || GEMINI_STYLE.stiri)[language] }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).substring(0, 160)}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), ext: 'mp3', contentType: 'audio/mpeg' };
    };

    // ── GOOGLE CLOUD TTS — the only free-stack engine with NATIVE Romanian ──
    // Gemini's prebuilt voices are English personas: they read Romanian with an
    // English accent and no setting changes that. Google Cloud TTS is a
    // DIFFERENT service that ships per-locale voices — ro-RO-Chirp3-HD-* are
    // trained on Romanian speakers, so they sound native. Same persona names
    // (Aoede, Kore, Zephyr...), real Romanian mouth.
    // It accepts a plain API key, and an AI Studio (Gemini) key usually works if
    // "Cloud Text-to-Speech API" is enabled on that Google project — so this
    // often needs NO new credentials at all. A dedicated GOOGLE_TTS_API_KEY
    // overrides when provided.
    const gttsKey = (Deno.env.get('GOOGLE_TTS_API_KEY') || '').trim() || geminiKey;
    const googleTtsGen = async (): Promise<Out> => {
      if (!gttsKey) throw new Error('no Google key');
      const locale = language === 'ro' ? 'ro-RO' : 'en-US';

      // Ask Google which voices exist for this locale, then pick the best one —
      // self-configuring, so we never hard-code a voice name that may be renamed.
      let chosen = String(body.google_voice || '').trim();
      if (!chosen) {
        const lr = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=${locale}&key=${gttsKey}`);
        if (!lr.ok) throw new Error(`GoogleTTS voices ${lr.status}: ${(await lr.text()).substring(0, 160)}`);
        const ld = await lr.json();
        const all = (Array.isArray(ld.voices) ? ld.voices : []) as Record<string, unknown>[];
        const want = gender === 'f' ? 'FEMALE' : 'MALE';
        const byRank = (n: string) => n.includes('Chirp3-HD') ? 0 : n.includes('Chirp') ? 1 : n.includes('Neural2') ? 2 : n.includes('Wavenet') ? 3 : 4;
        const pool = all
          .map(v => ({ name: String(v.name || ''), ssml: String(v.ssmlGender || '') }))
          .filter(v => v.name)
          .filter(v => v.ssml === want || !all.some(x => String(x.ssmlGender) === want));
        pool.sort((a, b) => byRank(a.name) - byRank(b.name) || a.name.localeCompare(b.name));
        if (!pool.length) throw new Error(`GoogleTTS: nicio voce ${locale}`);
        chosen = pool[0].name;
      }

      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${gttsKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // SSML input so <break> is honoured; plain text ignores it.
          input: pauseMs && paragraphs.length > 1 ? { ssml: ssmlWithBreaks() } : { text },
          voice: { languageCode: locale, name: chosen },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
        }),
      });
      if (!res.ok) throw new Error(`GoogleTTS ${res.status}: ${(await res.text()).substring(0, 200)}`);
      const d = await res.json();
      const b64 = String(d?.audioContent || '');
      if (!b64) throw new Error('GoogleTTS returned no audio');
      usedGoogleVoice = chosen;
      return { bytes: b64ToBytes(b64), ext: 'mp3', contentType: 'audio/mpeg' };
    };

    // ── GEMINI TTS ON FAL — Romanian, using the FAL_KEY you already have ─────
    // The Google AI Studio Gemini TTS API has NO language parameter: it infers
    // language and its voices are English personas, so Romanian comes out
    // accented. fal hosts a Gemini TTS endpoint that DOES take an explicit
    // language_code ("Romanian (Romania)"), which selects Romanian phonetics.
    // Needs no Google Cloud project and no new key.
    const FAL_GEMINI_VOICE = { f: 'Kore', m: 'Charon' };
    const falGeminiTtsGen = async (): Promise<Out> => {
      if (!falKey) throw new Error('no FAL key');
      const voice = String(body.gemini_voice || '').trim() || FAL_GEMINI_VOICE[gender];
      const res = await fetch('https://fal.run/fal-ai/gemini-3.1-flash-tts', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textWithTagPauses(),
          voice,
          language_code: language === 'ro' ? 'Romanian (Romania)' : 'English (United States)',
          style_instructions: (GEMINI_STYLE[tone] || GEMINI_STYLE.stiri)[language]
            + (pauseMs && paragraphs.length > 1
              ? ` Fă o pauză de aproximativ ${(pauseMs / 1000).toFixed(1)} secunde acolo unde apare [short pause]; nu rosti eticheta.`
              : ''),
        }),
      });
      if (!res.ok) throw new Error(`fal-gemini-tts ${res.status}: ${(await res.text()).substring(0, 200)}`);
      const d = await res.json();
      const url = String(d?.audio?.url || d?.audio_url || '');
      if (!url) throw new Error('fal-gemini-tts returned no audio url');
      const aud = await fetch(url);
      if (!aud.ok) throw new Error(`fal-gemini-tts download ${aud.status}`);
      usedGoogleVoice = `fal/gemini-3.1-flash-tts · ${voice} · ro-RO`;
      return { bytes: new Uint8Array(await aud.arrayBuffer()), ext: 'mp3', contentType: 'audio/mpeg' };
    };

    // ── MINIMAX ON FAL — explicit Romanian via language_boost ────────────────
    const falMinimaxGen = async (): Promise<Out> => {
      if (!falKey) throw new Error('no FAL key');
      const mmVoice = String(body.minimax_voice || '').trim()
        || (gender === 'f' ? 'Wise_Woman' : 'Deep_Voice_Man');
      const res = await fetch('https://fal.run/fal-ai/minimax/speech-2.8-hd', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textWithMinimaxPauses(),                // 2.8 uses `prompt`, not `text`
          voice_setting: { voice_id: mmVoice, speed: 1, vol: 1, pitch: 0 },
          language_boost: language === 'ro' ? 'Romanian' : 'English',
          audio_setting: { format: 'mp3', sample_rate: 44100, bitrate: 128000, channel: 1 },
          output_format: 'url',                           // default is hex — must set
        }),
      });
      if (!res.ok) throw new Error(`fal-minimax ${res.status}: ${(await res.text()).substring(0, 200)}`);
      const d = await res.json();
      const url = String(d?.audio?.url || d?.audio_url || '');
      if (!url) throw new Error('fal-minimax returned no audio url');
      const aud = await fetch(url);
      if (!aud.ok) throw new Error(`fal-minimax download ${aud.status}`);
      usedGoogleVoice = `fal/minimax-2.8-hd · ${mmVoice} · Romanian`;
      return { bytes: new Uint8Array(await aud.arrayBuffer()), ext: 'mp3', contentType: 'audio/mpeg' };
    };

    const engines: Record<string, { name: string; run: () => Promise<Out> }> = {
      fal_gemini_tts: { name: 'fal_gemini_tts', run: falGeminiTtsGen },
      fal_minimax:    { name: 'fal_minimax', run: falMinimaxGen },
      google_tts:     { name: 'google_tts', run: googleTtsGen },
      elevenlabs:     { name: 'elevenlabs', run: elGen },
      fal_elevenlabs: { name: 'fal_elevenlabs', run: falElGen },
      gemini:         { name: 'gemini', run: geminiGen },
      openai:         { name: 'openai', run: openaiGen },
    };

    // HARD STOP — a cloned MiniMax voice needs fal. Never fall through to a
    // different voice: that is the same "wrong person" failure the ElevenLabs
    // guard below prevents.
    if (wantsMinimaxClone && !falKey) {
      return json({
        error: 'MINIMAX_KEY_MISSING: ai cerut o voce clonată MiniMax (prin fal) dar FAL_KEY nu este setată în secretele proiectului Supabase. '
             + 'Adaug-o în Supabase → Project Settings → Edge Functions → Secrets, apoi reîncearcă.',
      }, 400);
    }

    // HARD STOP — no silent accent swap.
    // Asking for a specific ElevenLabs voice_id means asking for a voice that
    // lives in YOUR ElevenLabs account. If the key is missing we must NOT quietly
    // slide down the chain to fal's premade "Sarah" or a Gemini voice: those are
    // English-recorded and read Romanian with an English accent, which looks like
    // "the voice setting is broken" rather than "the key is missing".
    if (String(body.voice_id || '').trim() && !elKey) {
      return json({
        error: 'ELEVENLABS_KEY_MISSING: ai cerut o voce ElevenLabs (voice_id) dar ELEVENLABS_API_KEY nu este setată în secretele proiectului Supabase. '
             + 'Fără ea nu pot folosi vocea ta românească — iar celelalte motoare (fal „Sarah", Gemini) sunt voci englezești și citesc româna cu accent. '
             + 'Adaug-o în Supabase → Project Settings → Edge Functions → Secrets, apoi reîncearcă.',
      }, 400);
    }

    // Chain: requested first, else EL direct -> fal:EL -> Gemini(Pro->Flash) -> OpenAI.
    // For ROMANIAN the ordering matters enormously: google_tts has real ro-RO
    // voices, while fal's premade ElevenLabs voices and Gemini are English and
    // will always carry an accent. Put the native engine ahead of them.
    // ROMANIAN ORDER, best-accent first:
    //   elevenlabs      — your own Ioana (needs a working ELEVENLABS_API_KEY)
    //   fal_gemini_tts  — Gemini WITH language_code ro-RO, via FAL_KEY  ($0.05/1k)
    //   fal_minimax     — language_boost 'Romanian', via FAL_KEY        ($0.10/1k)
    //   google_tts      — native ro-RO, needs Cloud TTS API enabled
    //   fal_elevenlabs  — premade ENGLISH voices (accent) — late resort
    //   gemini / openai — English personas (accent) — last resort
    let order = language === 'ro'
      ? ['elevenlabs', 'fal_gemini_tts', 'fal_minimax', 'google_tts', 'fal_elevenlabs', 'gemini', 'openai']
      : ['elevenlabs', 'fal_elevenlabs', 'gemini', 'openai'];
    if (requested && engines[requested]) order = [requested, ...order.filter(o => o !== requested)];

    // NO SILENT VOICE SUBSTITUTION.
    // Asking for a specific voice_id names ONE voice in the user's ElevenLabs
    // account. If that engine fails, falling through the chain does not produce
    // "the same voice, slightly worse" — it produces a DIFFERENT PERSON, and
    // because gender defaults to male it silently returned "George" when the
    // user had asked for a female Romanian anchor. A named voice must either be
    // delivered or fail with the reason.
    const explicitVoiceId = String(body.voice_id || '').trim();
    if (explicitVoiceId) {
      // Try the voice through YOUR account first, then through fal (whose
      // ElevenLabs endpoint also accepts a voice id). Never fall through to a
      // DIFFERENT voice — that is what produced the male "George".
      order = ['elevenlabs', 'fal_elevenlabs'];
    }
    // A cloned MiniMax voice is delivered ONLY by fal/MiniMax — no substitution.
    if (wantsMinimaxClone) order = ['fal_minimax'];
    // Drop engines whose key is plainly absent (keeps the chain honest).
    order = order.filter(o =>
      o === 'elevenlabs' ? !!elKey :
      o === 'fal_elevenlabs' || o === 'fal_gemini_tts' || o === 'fal_minimax' ? !!falKey :
      o === 'google_tts' ? !!gttsKey :
      o === 'gemini' ? !!geminiKey : !!openaiKey);
    if (order.length === 0) return json({ error: 'No TTS provider configured (need FAL_KEY, GEMINI_API_KEY, ELEVENLABS_API_KEY or OPENAI_API_KEY)' }, 500);

    let out: Out | null = null;
    let usedProvider = '';
    let usedGoogleVoice = '';
    const notes: string[] = [];
    for (const key of order) {
      try { out = await engines[key].run(); usedProvider = key; break; }
      catch (e) { notes.push(`${key}: ${(e as Error).message}`); }
    }
    if (!out && explicitVoiceId) {
      return json({
        error: 'VOCEA CERUTA NU A PUTUT FI FOLOSITA: ai cerut vocea ElevenLabs "' + explicitVoiceId + '" dar apelul a esuat — '
             + (notes.join(' | ') || 'motiv necunoscut')
             + '. NU am inlocuit-o cu alta voce (inainte se intampla asta si primeai vocea masculina "George"). '
             + 'Verifica ELEVENLABS_API_KEY si permisiunile cheii (Voices + Text to Speech).',
      }, 502);
    }
    if (!out && wantsMinimaxClone) {
      return json({
        error: 'VOCEA CLONATĂ NU A PUTUT FI FOLOSITĂ: vocea ta MiniMax „' + minimaxVoice + '" a eșuat prin fal — '
             + (notes.join(' | ') || 'motiv necunoscut')
             + '. NU am înlocuit-o cu altă voce. Verifică FAL_KEY și creditele fal.',
      }, 502);
    }
    if (!out || out.bytes.byteLength < 500) {
      return json({ error: 'All TTS engines failed — ' + (notes.join(' | ') || 'empty audio') }, 502);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const fileName = `voice/${Date.now()}-${Math.random().toString(36).slice(2)}.${out.ext}`;
    const { error: upErr } = await supabase.storage.from('studio-assets')
      .upload(fileName, out.bytes, { contentType: out.contentType, upsert: false });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    const { data } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
    return json({ success: true, publicUrl: data.publicUrl, fileName, provider: usedProvider,
      voice_used: usedGoogleVoice || undefined,
      // The newsroom page already has a "corecții de pronunție aplicate"
      // indicator reading these. Until now the function never returned them,
      // so the indicator could never light up.
      lexicon_applied: lexiconApplied ? 1 : 0,
      speech_normalised: speechChanged,
      note: notes.length ? `fallback după: ${notes.join(' | ')}` : undefined });
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Minimal RIFF/WAVE wrapper for 16-bit PCM.
function wavFromPcm16(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  const buf = new ArrayBuffer(44 + pcm.byteLength);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true); v.setUint16(32, blockAlign, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
