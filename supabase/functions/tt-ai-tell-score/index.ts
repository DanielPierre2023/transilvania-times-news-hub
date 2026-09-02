// supabase/functions/tt-ai-tell-score/index.ts
//
// Deterministic "AI-tell score" for the pre-publish admin check — no LLM, so it
// is instant and free. Scores an article's English and Romanian title+body for
// the machine-writing tells (ALL-CAPS titles, em dashes, the AI lexicon, "not
// only … but also", summary paragraphs …) and returns the score, a level, and
// the NAMED tells with a sample of each, so an editor sees exactly what to fix.
//
// Input : { blog_post_id: string }                      // scores both languages
//    or : { title?: string, content?: string, lang?: 'en'|'ro' }
// Output: { ok:true, overall:{score,level}, en?:Report, ro?:Report }
//
// Deploy GATED (admin only) — same posture as tt-adsense-quality-check.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// ── admin gate (inlined) ───────────────────────────────────────────────
// ── admin gate (inlined; self-contained for dashboard paste) ─────────────────
// Allows only this project's service-role key (internal callers) or a signed-in
// admin (a user_roles 'admin' row). Anon/non-admin are rejected — the anon key
// in the public bundle cannot drive this function's Unsplash quota or storage.
async function requireAdmin(req: Request): Promise<Response | null> {
  const AUTH_CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
  const deny = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...AUTH_CORS, 'Content-Type': 'application/json' } });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return deny(401, 'Unauthorized');

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) return null;

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
      .from('user_roles').select('role').eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
    if (rErr || !role) return deny(403, 'Forbidden');
    return null;
  } catch (e) {
    console.error('[requireAdmin] check failed, denying by default:', (e as Error).message);
    return deny(401, 'Unauthorized');
  }
}

// ── anti-AI module (inlined from _shared/tt-anti-ai.ts) ─────────────────

// ─────────────────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────────────────

// Acronyms / short caps tokens that must STAY uppercase when a title is calmed.
// Romanian political, institutional and economic life + common global ones.
const TT_KEEP_UPPER = new Set<string>([
  // parties & alliances
  'PSD', 'PNL', 'USR', 'AUR', 'UDMR', 'PMP', 'REPER', 'SOS', 'PUSL', 'PRM',
  // Romanian institutions
  'UE', 'ONU', 'OMS', 'FMI', 'BCE', 'BNR', 'ANAF', 'ANM', 'DNA', 'DGA',
  'SRI', 'SIE', 'STS', 'SPP', 'CNA', 'CSM', 'CCR', 'ICCJ', 'CJUE', 'CEDO',
  'INS', 'INSSE', 'CFR', 'TAROM', 'STB', 'ISU', 'IGSU', 'DSU', 'DSP',
  'CNAS', 'CNAIR', 'ASF', 'ANRE', 'ANCOM', 'AEP', 'BEC', 'MAI', 'MAE',
  'MAPN', 'CSAT', 'DIICOT', 'ANI', 'ANPC', 'ANOFM', 'ANRP', 'ANFP', 'DNSC',
  'TVR', 'PNRR', 'MCV', 'CNSU',
  // economic
  'TVA', 'PIB', 'IMM', 'ROBOR', 'IRCC', 'OUG', 'HG', 'CASS', 'CAS',
  // global bodies & countries
  'NATO', 'SUA', 'UK', 'US', 'EU', 'USA', 'FBI', 'CIA', 'NASA', 'WHO',
  'IMF', 'ECB', 'UN', 'G7', 'G20', 'OPEC', 'OECD', 'BRICS', 'GDP',
  // tech / general  (note: 'IT' is deliberately NOT kept — the shouted English
  // pronoun "IT" collides with it and mis-cased pronouns read worse than a
  // lower-cased "it sector", which is rare in a headline anyway)
  'AI', 'GPS', 'USB', 'PC', 'TV', 'CEO', 'CFO', 'SUV', 'PDF', 'URL',
  'SMS', 'DNA', 'PIN', 'ATM', 'VIP', 'PR', 'HR', 'FC', 'CS', 'CSM',
  // common roman numerals kept as-is
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI',
])

// Proper-noun gazetteer: lowercased key → canonical casing to RESTORE after a
// shouted word is calmed. Covers Romania + its counties/cities, the region,
// and the countries/capitals that dominate the news cycle. A surname that is
// not here will be lower-cased when a whole title is de-SHOUTED — that is the
// documented limit of a purely deterministic pass, and the reason the title
// PROMPTS were also fixed so shouted titles rarely reach this net.
const TT_PROPER = new Map<string, string>(([
  // country / regions
  'romania', 'Romania', 'românia', 'România', 'transilvania', 'Transilvania',
  'transylvania', 'Transylvania', 'ardeal', 'Ardeal', 'moldova', 'Moldova',
  'muntenia', 'Muntenia', 'banat', 'Banat', 'bucovina', 'Bucovina',
  'maramures', 'Maramureș', 'maramureș', 'Maramureș', 'dobrogea', 'Dobrogea',
  'oltenia', 'Oltenia', 'crisana', 'Crișana', 'crișana', 'Crișana',
  // counties (județe)
  'alba', 'Alba', 'arad', 'Arad', 'arges', 'Argeș', 'argeș', 'Argeș',
  'bacau', 'Bacău', 'bacău', 'Bacău', 'bihor', 'Bihor', 'bistrita', 'Bistrița',
  'bistrița', 'Bistrița', 'botosani', 'Botoșani', 'botoșani', 'Botoșani',
  'brasov', 'Brașov', 'brașov', 'Brașov', 'braila', 'Brăila', 'brăila', 'Brăila',
  'buzau', 'Buzău', 'buzău', 'Buzău', 'calarasi', 'Călărași', 'călărași', 'Călărași',
  'cluj', 'Cluj', 'constanta', 'Constanța', 'constanța', 'Constanța',
  'covasna', 'Covasna', 'dambovita', 'Dâmbovița', 'dâmbovița', 'Dâmbovița',
  'dolj', 'Dolj', 'galati', 'Galați', 'galați', 'Galați', 'giurgiu', 'Giurgiu',
  'gorj', 'Gorj', 'harghita', 'Harghita', 'hunedoara', 'Hunedoara',
  'ialomita', 'Ialomița', 'ialomița', 'Ialomița', 'iasi', 'Iași', 'iași', 'Iași',
  'ilfov', 'Ilfov', 'mehedinti', 'Mehedinți', 'mehedinți', 'Mehedinți',
  'mures', 'Mureș', 'mureș', 'Mureș', 'neamt', 'Neamț', 'neamț', 'Neamț',
  'olt', 'Olt', 'prahova', 'Prahova', 'salaj', 'Sălaj', 'sălaj', 'Sălaj',
  'satu', 'Satu', 'sibiu', 'Sibiu', 'suceava', 'Suceava', 'teleorman', 'Teleorman',
  'timis', 'Timiș', 'timiș', 'Timiș', 'tulcea', 'Tulcea', 'vaslui', 'Vaslui',
  'valcea', 'Vâlcea', 'vâlcea', 'Vâlcea', 'vrancea', 'Vrancea',
  // major cities
  'bucuresti', 'București', 'bucurești', 'București', 'bucharest', 'Bucharest',
  'cluj-napoca', 'Cluj-Napoca', 'timisoara', 'Timișoara', 'timișoara', 'Timișoara',
  'oradea', 'Oradea', 'craiova', 'Craiova', 'ploiesti', 'Ploiești', 'ploiești', 'Ploiești',
  'baia', 'Baia', 'napoca', 'Napoca', 'alba-iulia', 'Alba-Iulia',
  // world capitals / countries common in RO news
  'ucraina', 'Ucraina', 'ukraine', 'Ukraine', 'rusia', 'Rusia', 'russia', 'Russia',
  'moscova', 'Moscova', 'moscow', 'Moscow', 'kiev', 'Kiev', 'kyiv', 'Kyiv',
  'washington', 'Washington', 'bruxelles', 'Bruxelles', 'brussels', 'Brussels',
  'berlin', 'Berlin', 'paris', 'Paris', 'londra', 'Londra', 'london', 'London',
  'roma', 'Roma', 'rome', 'Rome', 'budapesta', 'Budapesta', 'budapest', 'Budapest',
  'viena', 'Viena', 'vienna', 'Vienna', 'china', 'China', 'beijing', 'Beijing',
  'chisinau', 'Chișinău', 'chișinău', 'Chișinău', 'europa', 'Europa', 'europe', 'Europe',
  'america', 'America', 'washington', 'Washington', 'ungaria', 'Ungaria',
  'bulgaria', 'Bulgaria', 'serbia', 'Serbia', 'polonia', 'Polonia', 'germania', 'Germania',
  'franta', 'Franța', 'franța', 'Franța', 'italia', 'Italia', 'spania', 'Spania',
  'grecia', 'Grecia', 'turcia', 'Turcia', 'israel', 'Israel', 'gaza', 'Gaza',
  // English weekday / month names (RO months are lowercase, not listed)
  'monday', 'Monday', 'tuesday', 'Tuesday', 'wednesday', 'Wednesday',
  'thursday', 'Thursday', 'friday', 'Friday', 'saturday', 'Saturday', 'sunday', 'Sunday',
  // English months — but NOT may/march/august, which collide with the common
  // words "may" (modal), "march" (verb), "august" (adjective); leaving those
  // lower-cased in a rare shouted title beats wrongly capitalizing a verb.
  'january', 'January', 'february', 'February', 'april', 'April',
  'june', 'June', 'july', 'July',
  'september', 'September', 'october', 'October', 'november', 'November', 'december', 'December',
] as string[]).reduce<[string, string][]>((acc, cur, i, arr) => {
  if (i % 2 === 0) acc.push([cur, arr[i + 1]])
  return acc
}, []))

// ─────────────────────────────────────────────────────────────────────────
// Title de-shouting
// ─────────────────────────────────────────────────────────────────────────

function ttIsAllCapsToken(w: string): boolean {
  // has at least two cased letters and no lowercase letter
  const letters = w.replace(/[^\p{L}]/gu, '')
  if (letters.length < 2) return false
  if (letters === letters.toLowerCase()) return false // no cased letters (e.g. digits)
  return letters === letters.toUpperCase()
}

function ttRestoreProper(lowerWord: string): string {
  const canon = TT_PROPER.get(lowerWord.toLowerCase())
  return canon ?? lowerWord
}

// Turn a shouted title into clean sentence case, keeping acronyms and known
// proper nouns. Only ALL-CAPS tokens are touched — a correctly-cased title
// passes through unchanged.
function ttDeShoutTitle(title: string): string {
  if (!title || typeof title !== 'string') return title || ''
  let sawShout = false

  const out = title.replace(/[\p{L}][\p{L}\p{M}'''\-]*/gu, (word) => {
    const bare = word.replace(/[.\-']/g, '')
    if (TT_KEEP_UPPER.has(bare.toUpperCase()) && ttIsAllCapsToken(word)) return word // acronym stays
    if (!ttIsAllCapsToken(word)) return word // already mixed/lower/Proper — leave it
    sawShout = true
    // calm the shout, then restore a known proper noun's canonical casing
    const lowered = word.toLowerCase()
    // hyphenated compound: restore per-part (e.g. CLUJ-NAPOCA → Cluj-Napoca)
    if (lowered.includes('-')) {
      const restoredWhole = TT_PROPER.get(lowered)
      if (restoredWhole) return restoredWhole
      return lowered.split('-').map((p) => ttRestoreProper(p)).join('-')
    }
    return ttRestoreProper(lowered)
  })

  if (!sawShout) return title.trim()

  // capitalize the first letter of the title and of any new sentence
  const recased = out.replace(/(^\s*|[.!?:]\s+)([\p{Ll}])/gu, (_m, b, ch) => b + ch.toUpperCase())
  return recased.replace(/\s{2,}/g, ' ').trim()
}

// ─────────────────────────────────────────────────────────────────────────
// Dash normalization (literal + HTML entities), idempotent
// ─────────────────────────────────────────────────────────────────────────

function ttStripDashes(s: string): string {
  if (!s) return s
  let r = s
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/&ndash;|&#8211;|&#x2013;/gi, '–')
    .replace(/&#8213;|&#x2015;/gi, '—')
  // numeric range with en/em dash → hyphen (2019–2021, 10–15%)
  r = r.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
  // spaced em/en dash used as a pause → comma
  r = r.replace(/\s+[–—]\s+/g, ', ')
  // "space -- space" (ASCII double hyphen the same way LLMs use an em dash)
  r = r.replace(/\s+--\s+/g, ', ')
  // any leftover em dash → comma+space; leftover en dash → hyphen
  r = r.replace(/—/g, ', ').replace(/–/g, '-')
  // tidy the seams
  r = r.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/[ \t]{2,}/g, ' ')
  return r
}

// ─────────────────────────────────────────────────────────────────────────
// Lexicon scrub
// ─────────────────────────────────────────────────────────────────────────

// Replace preserving the case of the match's first letter; empty target deletes.
function ttCaseRep(to: string) {
  return (m: string): string => {
    if (!to) return ''
    const fa = m.match(/[\p{L}]/u)
    if (fa && fa[0] === fa[0].toUpperCase() && fa[0] !== fa[0].toLowerCase()) {
      return to.charAt(0).toUpperCase() + to.slice(1)
    }
    return to
  }
}

// EN: mid-sentence synonyms (safe, meaning-preserving)
const TT_LEX_EN: Array<[RegExp, string]> = [
  [/\bdelve into\b/gi, 'examine'],
  [/\bdelving into\b/gi, 'examining'],
  [/\ba testament to\b/gi, 'proof of'],
  [/\btestament to\b/gi, 'proof of'],
  [/\bstands as a\b/gi, 'is a'],
  [/\bstands as\b/gi, 'is'],
  [/\bboasts\b/gi, 'has'],
  [/\bboasting\b/gi, 'with'],
  [/\bnestled\b/gi, 'located'],
  [/\bin the heart of\b/gi, 'in'],
  [/\brich tapestry of\b/gi, 'mix of'],
  [/\btapestry of\b/gi, 'mix of'],
  [/\bwhen it comes to\b/gi, 'for'],
  [/\bin the realm of\b/gi, 'in'],
  [/\bin the world of\b/gi, 'in'],
  [/\bplays? an? (?:crucial|vital|key|pivotal|central|important|significant) role in\b/gi, 'is central to'],
  [/\bplays? an? (?:crucial|vital|key|pivotal|central|important|significant) role\b/gi, 'is central'],
  [/\bunderscores\b/gi, 'highlights'],
  [/\bunderscoring\b/gi, 'highlighting'],
  [/\bunderscore\b/gi, 'highlight'],
  [/\bshowcasing\b/gi, 'showing'],
  [/\bshowcases\b/gi, 'shows'],
  [/\bshowcase\b/gi, 'show'],
  [/\butilizes\b/gi, 'uses'],
  [/\butilizing\b/gi, 'using'],
  [/\butilize\b/gi, 'use'],
  [/\butilization\b/gi, 'use'],
  [/\bleveraging\b/gi, 'using'],
  [/\bto leverage\b/gi, 'to use'],
  [/\ba myriad of\b/gi, 'many'],
  [/\bmyriad of\b/gi, 'many'],
  [/\bmyriad\b/gi, 'many'],
  [/\ba plethora of\b/gi, 'many'],
  [/\bplethora of\b/gi, 'many'],
  [/\bseamlessly\b/gi, 'smoothly'],
  [/\bseamless\b/gi, 'smooth'],
  [/\bbustling\b/gi, 'busy'],
  [/\bmeticulously\b/gi, 'carefully'],
  [/\bmeticulous\b/gi, 'careful'],
  [/\bcutting-edge\b/gi, 'advanced'],
  [/\bstate-of-the-art\b/gi, 'advanced'],
  [/\bgame-?chang(?:er|ing)\b/gi, 'major shift'],
  [/\bever-(?:evolving|changing)\b/gi, 'changing'],
  [/\bsheds light on\b/gi, 'explains'],
  [/\bshed light on\b/gi, 'explain'],
  [/\bushering in\b/gi, 'bringing'],
  [/\busher in\b/gi, 'bring'],
  [/\bgarnered\b/gi, 'drew'],
  [/\bgarnering\b/gi, 'drawing'],
  [/\bgarner\b/gi, 'attract'],
  [/\bspearheaded\b/gi, 'led'],
  [/\bspearheading\b/gi, 'leading'],
  [/\bspearhead\b/gi, 'lead'],
  [/\bpivotal\b/gi, 'key'],
  [/\bat the forefront of\b/gi, 'leading'],
  [/\bpaved the way for\b/gi, 'enabled'],
  [/\bpaving the way for\b/gi, 'enabling'],
  [/\bpave the way for\b/gi, 'enable'],
  [/\bnavigating the (?:complexities|challenges|landscape) of\b/gi, 'handling'],
  [/\bnavigate the (?:complexities|challenges|landscape) of\b/gi, 'handle'],
  [/\btreasure trove of\b/gi, 'wealth of'],
  [/\ba beacon of\b/gi, 'a symbol of'],
]

// EN: sentence-initial fillers to drop (recap handled by the shared remover)
const TT_FILLERS_EN =
  'Moreover|Furthermore|Additionally|In addition|Notably|Importantly|Crucially|' +
  'Indeed|Ultimately|In conclusion|In summary|To summarize|To sum up|All in all|' +
  'That said|Of course|Needless to say|It goes without saying|' +
  'It’s no secret that|It is no secret that|' +
  'It’s worth noting that|It is worth noting that|' +
  'It’s important to note that|It is important to note that|' +
  'It’s important to remember that|It is important to remember that|' +
  'In today’s (?:fast-paced |digital |modern )?world|' +
  'In an? (?:increasingly|ever)[- ]\\w+ world|At the end of the day'

// RO: mid-sentence synonyms
const TT_LEX_RO: Array<[RegExp, string]> = [
  [/\bjoacă un rol (?:crucial|esențial|cheie|vital|decisiv|central|important) (?:în|pentru)\b/gi, 'este esențial pentru'],
  [/\bjoacă un rol (?:crucial|esențial|cheie|vital|decisiv|central|important)\b/gi, 'este esențial'],
  [/\bo gamă largă de\b/gi, 'multe'],
  [/\bo gamă variată de\b/gi, 'multe'],
  [/\bo multitudine de\b/gi, 'multe'],
  [/\bo mulțime de\b/gi, 'multe'],
  [/\bpune în lumină\b/gi, 'arată'],
  [/\bscoate în evidență\b/gi, 'arată'],
  [/\bsubliniază faptul că\b/gi, 'arată că'],
  [/\bevidențiază faptul că\b/gi, 'arată că'],
  [/\bdeschide calea (?:către|pentru|spre)\b/gi, 'permite'],
  [/\bîn era digitală\b/gi, 'astăzi'],
]

// RO: sentence-initial fillers to drop
const TT_FILLERS_RO =
  'Mai mult decât atât|Mai mult|Totodată|În plus|De asemenea|Pe de altă parte|' +
  'Nu în ultimul rând|În esență|Practic|De altfel|În concluzie|În cele din urmă|' +
  'Merită menționat că|Merită subliniat că|Este demn de remarcat că|' +
  'Este important de menționat că|Este important de subliniat că|' +
  'Trebuie menționat că|Trebuie precizat că|Trebuie subliniat că|' +
  'Este de remarcat că|Este de menționat că'

function ttDropFillers(s: string, alternation: string): string {
  // boundary (start | after . ! ? | newline) + filler + optional , / : + next word
  const re = new RegExp(
    '(^|[.!?]\\s+|\\n+)\\s*(?:' + alternation + ')\\b[,:]?\\s+([\\p{L}])',
    'gu',
  )
  return s.replace(re, (_m, b, ch) => b + ch.toUpperCase())
}

function ttScrubLexicon(s: string, lang: 'en' | 'ro'): string {
  if (!s) return s
  let r = s
  const lex = lang === 'ro' ? TT_LEX_RO : TT_LEX_EN
  for (const [re, to] of lex) r = r.replace(re, ttCaseRep(to))
  r = ttDropFillers(r, lang === 'ro' ? TT_FILLERS_RO : TT_FILLERS_EN)
  // collapse any double spaces / stray comma seams the drops created
  r = r.replace(/[ \t]{2,}/g, ' ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',')
  return r
}

// ─────────────────────────────────────────────────────────────────────────
// Orchestrators
// ─────────────────────────────────────────────────────────────────────────

function ttHumanizeText(s: string, lang: 'en' | 'ro'): string {
  if (!s) return s
  return ttScrubLexicon(ttStripDashes(s), lang).trim()
}

// HTML-preserving: transform ONLY the text between tags, never a tag or its
// attributes, and never the whitespace that separates inline tags. Used by the
// rich-article translator so the structure stays 1:1 with the Romanian source.
function ttHumanizeHtml(html: string, lang: 'en' | 'ro'): string {
  if (!html) return html
  // capturing split -> [text, "<tag>", text, "<tag>", ...]; tags start with '<'
  return html.split(/(<[^>]*>)/g).map((seg) => {
    if (!seg || seg[0] === '<') return seg
    // preserve the node's own leading/trailing whitespace (may be the only space
    // between two inline tags)
    const lead = (seg.match(/^\s*/) || [''])[0]
    const trail = (seg.match(/\s*$/) || [''])[0]
    let core = seg.slice(lead.length, seg.length - trail.length)
    if (!core) return seg
    // ttDeShoutTitle is a no-op on normally-cased text, so it is safe on any
    // node; it only calms an actual all-caps run (e.g. a shouted heading).
    if (/[\p{Lu}]{4,}/u.test(core)) core = ttDeShoutTitle(core)
    core = ttStripDashes(core)
    core = ttScrubLexicon(core, lang)
    return lead + core + trail
  }).join('')
}

// ─────────────────────────────────────────────────────────────────────────
// Detector — deterministic "AI-tell score" for the pre-publish admin check
// ─────────────────────────────────────────────────────────────────────────

interface TtTell {
  key: string
  label: string
  severity: 'high' | 'medium' | 'low'
  count: number
  sample: string
}
interface TtTellReport {
  score: number // 0 = clean, higher = more AI-like (max 100)
  level: 'clean' | 'low' | 'medium' | 'high'
  tells: TtTell[]
}

const TT_WEIGHT = { high: 40, medium: 7, low: 3 } as const

// Detector patterns for body text (label + weight). Case-insensitive.
function ttBodyTellDefs(lang: 'en' | 'ro'): Array<{ key: string; label: string; severity: 'high' | 'medium' | 'low'; re: RegExp }> {
  const common = [
    { key: 'em_dash', label: 'Em/en dash (—, –)', severity: 'medium' as const, re: /[–—]|&mdash;|&ndash;/g },
    { key: 'double_hyphen', label: 'Double hyphen used as a dash ( -- )', severity: 'medium' as const, re: /\s--\s/g },
    { key: 'emoji', label: 'Emoji in body text', severity: 'low' as const, re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu },
  ]
  if (lang === 'ro') {
    return [
      ...common,
      { key: 'ro_worth_noting', label: '„Merită menționat / este important de menționat"', severity: 'medium', re: /\b(?:merită menționat|este important de (?:menționat|subliniat)|este demn de remarcat|trebuie (?:menționat|precizat|subliniat))\b/gi },
      { key: 'ro_crucial_role', label: '„joacă un rol crucial/esențial"', severity: 'medium', re: /\bjoacă un rol (?:crucial|esențial|cheie|vital|decisiv|central|important)\b/gi },
      { key: 'ro_testament', label: '„reprezintă o dovadă / stă drept mărturie"', severity: 'medium', re: /\b(?:reprezintă o dovadă|stă drept mărturie)\b/gi },
      { key: 'ro_wide_range', label: '„o gamă largă / o multitudine de"', severity: 'low', re: /\b(?:o gamă (?:largă|variată) de|o multitudine de)\b/gi },
      { key: 'ro_not_only', label: 'Structura „nu doar … ci și"', severity: 'medium', re: /\bnu doar\b[^.?!]{0,80}\bci și\b/gi },
      { key: 'ro_conclusion', label: 'Paragraf de concluzie („În concluzie / În cele din urmă")', severity: 'medium', re: /(^|\n)\s*(?:În concluzie|În cele din urmă|În esență|Pe scurt)\b/gi },
      { key: 'ro_filler', label: 'Conectori „Mai mult decât atât / Totodată"', severity: 'low', re: /(^|\n|[.!?]\s+)(?:Mai mult decât atât|Totodată|Nu în ultimul rând)\b/g },
    ]
  }
  return [
    ...common,
    { key: 'en_worth_noting', label: '“It’s worth noting / important to note”', severity: 'medium', re: /\bit(?:'|’)?s (?:worth noting|important to note)\b|\bit is (?:worth noting|important to note)\b/gi },
    { key: 'en_lexicon', label: 'AI lexicon (delve, boasts, nestled, testament, tapestry…)', severity: 'medium', re: /\b(?:delve|delving|boasts?|nestled|tapestry|testament to|underscore[sd]?|showcas(?:e|es|ing)|myriad|plethora|seamless(?:ly)?|meticulous(?:ly)?|cutting-edge|state-of-the-art|garner(?:ed|ing)?|spearhead(?:ed|ing)?)\b/gi },
    { key: 'en_role', label: '“plays a crucial/pivotal role”', severity: 'medium', re: /\bplays? an? (?:crucial|vital|key|pivotal|central|important|significant) role\b/gi },
    { key: 'en_not_only', label: 'Structure “not only … but also”', severity: 'medium', re: /\bnot only\b[^.?!]{0,80}\bbut also\b/gi },
    { key: 'en_conclusion', label: 'Summary paragraph (“In conclusion / In summary”)', severity: 'medium', re: /(^|\n)\s*(?:In conclusion|In summary|To sum up|All in all|Ultimately)\b/gi },
    { key: 'en_filler', label: 'Connectives “Moreover / Furthermore / Additionally”', severity: 'low', re: /(^|\n|[.!?]\s+)(?:Moreover|Furthermore|Additionally)\b/g },
  ]
}

function ttSampleAround(text: string, re: RegExp): string {
  const m = re.exec(text)
  if (!m) return ''
  const i = Math.max(0, m.index - 24)
  const j = Math.min(text.length, m.index + m[0].length + 24)
  return (i > 0 ? '…' : '') + text.slice(i, j).replace(/\s+/g, ' ').trim() + (j < text.length ? '…' : '')
}

function ttScoreAiTells(input: { title?: string; content?: string; lang?: 'en' | 'ro' }): TtTellReport {
  const lang: 'en' | 'ro' = input.lang === 'ro' ? 'ro' : 'en'
  const title = (input.title || '').trim()
  const content = (input.content || '').trim()
  const tells: TtTell[] = []
  let score = 0

  // ── title tells ──────────────────────────────────────────────────────
  if (title) {
    const words = title.match(/[\p{L}][\p{L}\p{M}'''\-]*/gu) || []
    const shouted = words.filter((w) => ttIsAllCapsToken(w) && !TT_KEEP_UPPER.has(w.replace(/[.\-']/g, '').toUpperCase()))
    if (shouted.length >= 1) {
      const whole = words.length > 0 && shouted.length >= Math.max(2, Math.ceil(words.length * 0.6))
      tells.push({
        key: 'title_caps',
        label: whole ? 'ALL-CAPS title' : 'Shouted word(s) in the title',
        severity: whole ? 'high' : 'medium',
        count: shouted.length,
        sample: shouted.slice(0, 4).join(', '),
      })
      score += whole ? TT_WEIGHT.high : TT_WEIGHT.medium * Math.min(shouted.length, 3)
    }
    // English Title Case (informational, low)
    if (lang === 'en') {
      const cap = words.filter((w) => /^[A-Z][a-z]+$/.test(w))
      const small = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'but', 'as', 'at', 'by', 'with'])
      const content2 = words.filter((w) => !small.has(w.toLowerCase()))
      if (content2.length >= 4 && cap.length >= content2.length - 1 && cap.length >= 4) {
        tells.push({ key: 'title_titlecase', label: 'English Title Case headline (site style is sentence case)', severity: 'low', count: cap.length, sample: title.slice(0, 60) })
        score += TT_WEIGHT.low
      }
    }
  }

  // ── body tells ───────────────────────────────────────────────────────
  if (content) {
    for (const def of ttBodyTellDefs(lang)) {
      const re = new RegExp(def.re.source, def.re.flags)
      const matches = content.match(re)
      const count = matches ? matches.length : 0
      if (count > 0) {
        tells.push({
          key: def.key,
          label: def.label,
          severity: def.severity,
          count,
          sample: ttSampleAround(content, new RegExp(def.re.source, def.re.flags)),
        })
        // diminishing weight: first hit full, extra hits half, capped at 5 units
        score += TT_WEIGHT[def.severity] * Math.min(count, 5) * (count > 1 ? 0.7 : 1)
      }
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  const level: TtTellReport['level'] =
    score === 0 ? 'clean' : score <= 15 ? 'low' : score <= 40 ? 'medium' : 'high'
  tells.sort((a, b) => TT_WEIGHT[b.severity] - TT_WEIGHT[a.severity] || b.count - a.count)
  return { score, level, tells }
}
// ── end inline ────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'Method Not Allowed' }, 405)

  const denied = await requireAdmin(req)
  if (denied) return denied

  try {
    const input = await req.json().catch(() => ({})) as {
      blog_post_id?: string; title?: string; content?: string; lang?: 'en' | 'ro'
    }

    // ad-hoc scoring of supplied text
    if (!input.blog_post_id) {
      const lang: 'en' | 'ro' = input.lang === 'ro' ? 'ro' : 'en'
      const rep = ttScoreAiTells({ title: input.title, content: input.content, lang })
      return json({ ok: true, overall: { score: rep.score, level: rep.level }, [lang]: rep })
    }

    // score a stored article, both languages
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const sb = createClient(url, serviceKey, { auth: { persistSession: false } })

    const { data: post, error } = await sb
      .from('blog_posts')
      .select('title_en, content_en, title_ro, content_ro')
      .eq('id', input.blog_post_id)
      .single()
    if (error || !post) return json({ ok: false, error: error?.message || 'Article not found' }, 404)

    const en = ttScoreAiTells({ title: post.title_en as string, content: post.content_en as string, lang: 'en' })
    const ro = ttScoreAiTells({ title: post.title_ro as string, content: post.content_ro as string, lang: 'ro' })
    const hasEn = Boolean((post.title_en as string) || (post.content_en as string))
    const hasRo = Boolean((post.title_ro as string) || (post.content_ro as string))

    const scores = [hasEn ? en.score : -1, hasRo ? ro.score : -1].filter((n) => n >= 0)
    const worst = scores.length ? Math.max(...scores) : 0
    const level = worst === 0 ? 'clean' : worst <= 15 ? 'low' : worst <= 40 ? 'medium' : 'high'

    const out: Record<string, unknown> = { ok: true, overall: { score: worst, level } }
    if (hasEn) out.en = en
    if (hasRo) out.ro = ro
    return json(out)
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || 'Unknown error' }, 500)
  }
})
