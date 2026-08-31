// supabase/functions/tt-social-seo/index.ts
//
// TRANSILVANIA TIMES — SOCIAL + SEO ENGINE  (v1.0, 30 Aug 2026)
//
// Replaces the `captions` action that used to live inside newsroom-anchor.
//
// ── WHY THIS IS A SEPARATE FUNCTION ─────────────────────────────────────
// newsroom-anchor is already 8 unrelated actions in one file. Caption work
// is prompt-heavy, changes on a different cadence, and is wanted by the
// Studio and the article editor too — not just the bulletin. Same reasoning
// that put tt-translate-html in its own function.
//
// ── WHAT WAS WRONG WITH THE OLD OUTPUT ──────────────────────────────────
// Real sample produced by the old code on 30 Aug 2026:
//
//   "Curtea de Conturi descoperă 92 milioane lei ascunse în bilanțul
//    Clujului, în timp ce noul centru de neurochirurgie se deschide cu 46
//    milioane euro investiți. Motorina se ieftinește din septembrie, Mircea
//    Sandu este achitat, iar managerii anticipează scumpiri în retail.
//    Toate detaliile în buletinul video de azi!"
//
// Four structural faults, all of which this function fixes:
//
//   1. IT ENUMERATES. Four stories crammed into two sentences. Enumeration
//      is the lowest-reach caption form on every platform — there is no
//      single thing for the reader to react to. Fix: pick ONE lead story
//      by specificity (a number, a name, a place, a consequence) and lead
//      with it; the rest become a "și încă N știri" tail.
//
//   2. IT WAS THE SAME TEXT EVERYWHERE. One caption lightly reworded per
//      platform, and twelve identical hashtags on all of them. Fix: each
//      platform gets its own spec — the truncation point, the hook budget,
//      the hashtag count and the CTA shape all differ, and are enforced in
//      code below, not left to the model.
//
//   3. EVERY LINK POINTED AT THE HOMEPAGE.
//        https://transilvaniatimes.com/?utm_source=facebook...
//      A reader sold a story about 92 million lei landed on a homepage that
//      does not mention it. That is a bounce, and it wastes the article's
//      own ranking signal. Fix: links target /blog/<slug>/ of the lead
//      story, or the bulletin page when one exists.
//
//   4. NOTHING WAS MEASURABLE. One campaign tag for all time, no variant
//      marker. Fix: utm_campaign=buletin-YYYY-MM-DD and utm_content=hookA|
//      hookB, so site_analytics can actually tell you which hook worked.
//
// ── ACTIONS ─────────────────────────────────────────────────────────────
//   { action:'generate', languages:['ro','en'], stories:[...], ... }
//       -> { success, results: { ro: Pack, en: Pack }, saved }
//   { action:'health' }
//       -> { ok, providers:{claude,openai,gemini}, version }
//
// ── ENV ─────────────────────────────────────────────────────────────────
//   CLAUDE_API_KEY   (primary copywriter)
//   OPENAI_API_KEY   (fallback copywriter)
//   GEMINI_API_KEY   (optional; entity/keyword extraction — cheap pass)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Cost per bulletin, both languages: ~$0.03.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const VERSION = '1.1.0';

// ── ADMIN GATE ────────────────────────────────────────────────────────────
// Ported verbatim from the DEPLOYED newsroom-anchor (30 Aug 2026). v1.0 of
// this function had no auth at all, which was wrong on two counts: it spends
// money on Claude/Gemini per call, and it writes to newsroom_bulletins. Every
// other money-spending function in this project is admin-gated; this one has
// to match, not be the exception someone finds later.
//
// Inlined rather than imported from _shared/ so the file can be pasted
// straight into the Supabase dashboard editor — same reasoning as the
// original.
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
const SITE = 'https://transilvaniatimes.com';
const BRAND = 'Transilvania Times';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const OPENAI_MODEL = 'gpt-4o-2024-11-20';

// ════════════════════════════════════════════════════════════════════════
// PLATFORM SPECS
//
// These are hard limits enforced in code AFTER generation. A model asked to
// "keep it under 125 characters" complies most of the time; most of the
// time is not a specification. Anything over budget is trimmed at a word
// boundary here, deterministically.
//
// The numbers are the practical truncation points, not the API maximums:
//   facebook.hook       ~90 chars before "See more" on mobile
//   instagram.caption   125 chars before "... more"
//   linkedin.hook       ~210 chars before "…see more"
//   x.post              280 hard, 260 leaves room for a shortened link
//   youtube.title       70 chars before ellipsis in search results
//   youtube.snippet     157 chars — what Google shows as the description
// ════════════════════════════════════════════════════════════════════════
const SPEC = {
  facebook:  { hook: 90,  body: 600,  tags: 3,  variants: 3 },
  instagram: { hook: 125, body: 900,  tags: 10, variants: 3 },
  tiktok:    { hook: 60,  body: 150,  tags: 5,  variants: 2 },
  youtube:   { hook: 70,  body: 4500, tags: 0,  variants: 3 },
  x:         { hook: 120, body: 260,  tags: 2,  variants: 2 },
  linkedin:  { hook: 210, body: 1500, tags: 5,  variants: 2 },
  threads:   { hook: 120, body: 480,  tags: 3,  variants: 2 },
} as const;

// Phrases that depress reach (explicit engagement bait) or read as filler.
// Stripped after generation regardless of what the model produced.
const BANNED_RO = [
  'dați share', 'da-ti share', 'distribuie și tu', 'like și share',
  'apasă like', 'comentează mai jos', 'nu uita să', 'abonează-te acum',
  'click aici', 'aflați mai multe aici', 'toate detaliile în',
];
const BANNED_EN = [
  'smash that like', 'like and share', 'comment below', 'click here',
  'don’t forget to', 'subscribe now', 'read more here',
];

interface StoryIn {
  title: string;
  summary?: string;
  category?: string | null;
  county?: string | null;
  slug?: string | null;
  author?: string | null;
  start?: number | null;      // seconds into the bulletin (for chapters)
}

interface Story extends StoryIn {
  url_ro: string;
  url_en: string;
}

// ════════════════════════════════════════════════════════════════════════
// SMALL DETERMINISTIC HELPERS
// ════════════════════════════════════════════════════════════════════════

const stripDia = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
   .replace(/ș/g, 's').replace(/ț/g, 't')
   .replace(/ş/g, 's').replace(/ţ/g, 't');

/** Trim to a hard character budget at a word boundary, never mid-word. */
function clampWords(text: string, max: number): string {
  const t = (text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.…-]+$/, '') + '…';
}

/** "Curtea de Conturi" -> "#CurteaDeConturi". Diacritics removed: a hashtag
 *  with ș or ț is not clickable as the same tag people actually type. */
function hashtagize(raw: string): string {
  const words = stripDia(String(raw || ''))
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).slice(0, 4);
  if (!words.length) return '';
  const joined = words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return joined.length > 2 ? '#' + joined : '';
}

function dedupeTags(tags: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const tag = t.startsWith('#') ? t : '#' + t;
    const key = stripDia(tag).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= limit) break;
  }
  return out;
}

function stripBanned(text: string, lang: 'ro' | 'en'): string {
  let out = text || '';
  for (const p of (lang === 'ro' ? BANNED_RO : BANNED_EN)) {
    out = out.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Per-platform, per-variant tracked URL. */
function withUtm(url: string, source: string, campaign: string, content?: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', source);
    u.searchParams.set('utm_medium', 'social');
    u.searchParams.set('utm_campaign', campaign);
    if (content) u.searchParams.set('utm_content', content);
    return u.toString();
  } catch {
    return url;
  }
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60), r = s % 60;
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`;
}

/** JSON extraction hardened the same way newsroom-anchor's parser is: the
 *  model occasionally closes a Romanian „ quote with a straight " , which
 *  terminates the JSON string early. */
function repairJson(raw: string): string {
  let out = raw.replace(/„([^"„”]*)"/g, '„$1”');
  out = out.replace(/“([^"“”]*)"/g, '“$1”');
  return out;
}
function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) return null;
    const slice = raw.slice(s, e + 1);
    try { return JSON.parse(slice); } catch { return JSON.parse(repairJson(slice)); }
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════
// LEAD-STORY SELECTION
//
// The single most important editorial decision in the whole pack, and it is
// made in code rather than left to the model, because "which story leads"
// should be reproducible and explainable.
//
// Score = specificity. What makes a social post travel is a concrete,
// checkable fact — a sum of money, a named person or institution, a place
// the reader knows, a consequence they will feel.
// ════════════════════════════════════════════════════════════════════════
function scoreStory(s: StoryIn): number {
  const text = `${s.title || ''} ${s.summary || ''}`;
  let score = 0;
  // A hard number (money, percentage, count) is the strongest hook there is.
  if (/\d[\d.,]*\s*(milioane|miliarde|mii|lei|euro|%|milion)/i.test(text)) score += 5;
  else if (/\b\d[\d.,]{2,}\b/.test(text)) score += 3;
  else if (/\b\d+\b/.test(text)) score += 1;
  // A named institution or person (capitalised multiword) is checkable.
  const proper = text.match(/\b[A-ZĂÂÎȘȚ][a-zăâîșț]{2,}(?:\s+[A-ZĂÂÎȘȚ][a-zăâîșț]{2,})+/g);
  score += Math.min(3, (proper?.length || 0));
  // Local beats national beats international, for a regional paper.
  if (s.county && s.county !== 'national') score += 4;
  else if (s.county === 'national') score += 1;
  // Consequence verbs — something changes for the reader.
  if (/(se ieftine|se scump|cresc|scad|intr[ăa] în vigoare|de la 1 |[îi]ncep|se [îi]nchid|se deschid)/i.test(text)) score += 3;
  // Money-adjacent categories travel further than culture pieces.
  if (['business', 'politics', 'news'].includes(String(s.category || '').toLowerCase())) score += 1;
  return score;
}

// ════════════════════════════════════════════════════════════════════════
// PUBLISH SLOTS — from this site's OWN traffic, not a generic blog table.
//
// site_analytics has 9k+ rows with created_at; the hour histogram over the
// last 90 days is a real signal about when THIS audience is awake. If there
// is too little data the field is omitted rather than invented.
// ════════════════════════════════════════════════════════════════════════
async function bestSlots(db: SupabaseClient | null): Promise<{ hours: number[]; sample: number } | null> {
  if (!db) return null;
  try {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data, error } = await db
      .from('site_analytics')
      .select('created_at')
      .gte('created_at', since)
      .limit(20000);
    if (error || !Array.isArray(data) || data.length < 200) return null;
    const buckets = new Array(24).fill(0);
    for (const r of data as { created_at: string }[]) {
      const d = new Date(r.created_at);
      if (Number.isNaN(d.getTime())) continue;
      // Europe/Bucharest is UTC+3 in summer, UTC+2 in winter. Intl gives the
      // correct local hour without hardcoding an offset.
      const h = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Bucharest', hour: '2-digit', hour12: false,
      }).format(d));
      if (Number.isFinite(h)) buckets[h % 24]++;
    }
    const ranked = buckets
      .map((n, h) => ({ h, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map(x => x.h)
      .sort((a, b) => a - b);
    return { hours: ranked, sample: data.length };
  } catch { return null; }
}

// ════════════════════════════════════════════════════════════════════════
// CHAPTERS — deterministic, from the story start times the newsroom page
// already computes. Never asked of the model: a hallucinated timestamp is
// worse than no chapter at all.
//
// YouTube requires the first chapter to be 0:00 and at least three chapters
// of >= 10s each, or it silently ignores the whole list.
// ════════════════════════════════════════════════════════════════════════
function buildChapters(
  stories: Story[], introOffset: number, duration: number, lang: 'ro' | 'en',
): { time: string; label: string; seconds: number }[] {
  const withStart = stories.filter(s => typeof s.start === 'number' && Number.isFinite(s.start!));
  if (withStart.length < 2 || !duration || duration < 60) return [];

  const out = [{
    seconds: 0,
    time: '0:00',
    label: lang === 'ro' ? 'Deschidere' : 'Intro',
  }];

  for (const s of withStart) {
    const sec = Math.round((s.start as number) + introOffset);
    if (sec <= 0 || sec >= duration - 5) continue;
    if (sec - out[out.length - 1].seconds < 10) continue;   // YouTube minimum
    out.push({
      seconds: sec,
      time: fmtClock(sec),
      label: clampWords(s.title, 60),
    });
  }

  if (out.length < 3) return [];
  return out;
}

// ════════════════════════════════════════════════════════════════════════
// STEP 1 — ENTITY / INTENT EXTRACTION  (Gemini Flash; optional)
//
// Deliberately NOT a keyword-volume tool. There is no paid SEO data source
// in this stack, and inventing a monthly search volume would be a fabricated
// number presented as fact. What IS real and free: the named entities in the
// copy, and the phrasing a Romanian reader actually types into Google.
// ════════════════════════════════════════════════════════════════════════
async function extractKeywords(
  stories: Story[], lang: 'ro' | 'en', geminiKey?: string,
): Promise<{ entities: string[]; questions: string[]; primary: string }> {
  const fallback = {
    entities: [] as string[],
    questions: [] as string[],
    primary: stories[0]?.title?.slice(0, 60) || BRAND,
  };
  if (!geminiKey) return fallback;

  const body = stories.map((s, i) => `${i + 1}. ${s.title}\n${(s.summary || '').slice(0, 300)}`).join('\n\n');
  const instruction = lang === 'ro'
    ? 'Extrage din știrile de mai jos, ca JSON strict: {"entities":["nume proprii: persoane, instituții, localități, legi, companii — maxim 12"],"questions":["3-6 interogări exact cum le-ar tasta un cititor român în Google"],"primary":"expresia-cheie principală, 3-6 cuvinte"}. Fără alt text.'
    : 'From the stories below extract strict JSON: {"entities":["proper nouns: people, institutions, places, laws, companies — max 12"],"questions":["3-6 queries exactly as a reader would type them"],"primary":"the main key phrase, 3-6 words"}. No other text.';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${instruction}\n\n${body}` }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) return fallback;
    const d = await res.json();
    const parsed = parseJson(String(d?.candidates?.[0]?.content?.parts?.[0]?.text || ''));
    if (!parsed) return fallback;
    return {
      entities: (Array.isArray(parsed.entities) ? parsed.entities : []).map(String).slice(0, 12),
      questions: (Array.isArray(parsed.questions) ? parsed.questions : []).map(String).slice(0, 6),
      primary: String(parsed.primary || fallback.primary),
    };
  } catch { return fallback; }
}

// ════════════════════════════════════════════════════════════════════════
// STEP 2 — THE COPY PROMPT
// ════════════════════════════════════════════════════════════════════════
function buildPrompt(
  lang: 'ro' | 'en',
  stories: Story[],
  lead: Story,
  kw: { entities: string[]; questions: string[]; primary: string },
  edition: string,
  dateLabel: string,
): { system: string; user: string } {
  const editionLabelRo = edition === 'morning' ? 'ediția de dimineață' : edition === 'evening' ? 'jurnalul de seară' : 'buletinul zilei';
  const editionLabelEn = edition === 'morning' ? 'the morning edition' : edition === 'evening' ? 'the evening bulletin' : "today's bulletin";

  const systemRo = `Ești social media editor senior la ${BRAND}, cotidian din Ardeal. Scrii pentru cititori din Cluj, Turda și județele Transilvaniei. Ton: cald, sobru, de încredere — de ziar serios, nu de agregator de clickbait.

REGULA CENTRALĂ: NU ENUMERA. Un post care înșiră patru știri într-o frază nu are de ce să fie citit. Alegi UN SINGUR fapt — cel mai concret din știrea principală — și construiești postarea în jurul lui. Restul buletinului devine cel mult o propoziție de final ("și încă N subiecte în ${editionLabelRo}").

CE FACE UN CÂRLIG SĂ FUNCȚIONEZE:
- o cifră verificabilă (o sumă, un procent, un termen)
- un nume propriu pe care cititorul îl recunoaște
- o consecință pe care cititorul o simte în buzunar sau în cartier
- o tensiune reală între două fapte
NU: superlative goale ("incredibil", "șocant"), promisiuni vagi ("aflați totul"), întrebări retorice fără miză.

REGULI DE LIMBĂ: română corectă cu diacritice, fără calcuri din engleză, fără majuscule de accentuare, maxim un emoji pe postare și doar unde chiar ajută. Nu inventa niciun fapt, nicio cifră și niciun nume care nu apare în materialul primit. Nu atribui declarații.

FIECARE PLATFORMĂ ARE ALT FORMAT — nu rescrie același text de șapte ori:
- facebook: cârlig de maxim 90 de caractere pe primul rând, apoi 2-3 paragrafe scurte, apoi o întrebare deschisă care merită un comentariu real. Fără link în text (linkul merge în primul comentariu).
- instagram: tot cârligul trebuie să încapă în primele 125 de caractere. Rânduri scurte, aerisit.
- tiktok: maxim 150 de caractere, ton vorbit. Separat, "on_screen_hook": 4-7 cuvinte care se scriu pe ecran în prima secundă.
- youtube_title: maxim 70 de caractere, cu cuvântul-cheie principal la început, fără puncte de suspensie.
- youtube_description: primele 157 de caractere sunt fragmentul din Google — scrie-le ca atare. Apoi 2-3 paragrafe.
- x: maxim 260 de caractere, o singură idee.
- linkedin: primele 210 caractere sunt ce se vede; unghi profesional (economic, administrativ, instituțional).
- threads: maxim 480 de caractere, conversațional.
- discover_headline: 8-12 cuvinte, începe cu entitatea, formulare completă și fără ambiguitate — Google Discover penalizează titlurile care ascund subiectul.

HASHTAG-URI pe niveluri, fără diacritice, în CamelCase:
  broad (3): generale — #Stiri #Romania #Transilvania
  geo (4): județ, oraș, regiune
  entity (4): instituțiile și numele proprii din știri
  brand (1): #TransilvaniaTimes`;

  const systemEn = `You are a senior social editor at ${BRAND}, a daily newspaper from Transylvania, Romania, writing for an international audience.

CENTRAL RULE: DO NOT ENUMERATE. A post that lists four stories in one sentence gives the reader nothing to react to. Choose ONE concrete fact — the most specific one in the lead story — and build the post around it. The rest of the bulletin becomes at most a closing line ("plus N more stories in ${editionLabelEn}").

WHAT MAKES A HOOK WORK: a checkable number, a recognisable name, a consequence the reader feels, a real tension between two facts. NOT: empty superlatives, vague promises, rhetorical questions with nothing at stake.

Invent nothing. No fact, figure or name that is not in the supplied material. Attribute no quotes.

EACH PLATFORM HAS ITS OWN FORMAT — do not reword one caption seven times:
- facebook: hook in the first 90 characters, then 2-3 short paragraphs, then one open question worth a real answer. No link in the text.
- instagram: the entire hook must fit in the first 125 characters. Short lines.
- tiktok: max 150 characters, spoken register. Separately "on_screen_hook": 4-7 words burned on screen in the first second.
- youtube_title: max 70 characters, main keyword first, no ellipsis.
- youtube_description: the first 157 characters are the Google snippet — write them as such. Then 2-3 paragraphs.
- x: max 260 characters, one idea.
- linkedin: the first 210 characters are what shows; professional angle.
- threads: max 480 characters, conversational.
- discover_headline: 8-12 words, entity first, unambiguous.

HASHTAGS in tiers, no diacritics, CamelCase: broad (3), geo (4), entity (4), brand (1) = #TransilvaniaTimes`;

  const schema = `{
  "lead_rationale": "o propoziție: de ce această știre e cârligul",
  "discover_headline": "",
  "facebook":  { "hooks": ["", "", ""], "body": "", "question": "", "first_comment": "" },
  "instagram": { "hooks": ["", "", ""], "caption": "", "alt_text": "", "cover_text": "" },
  "tiktok":    { "hooks": ["", ""], "caption": "", "on_screen_hook": "" },
  "youtube":   { "titles": ["", "", ""], "description": "", "pinned_comment": "", "tags": [""] },
  "x":         { "post": "", "thread": ["", "", ""] },
  "linkedin":  { "hook": "", "body": "" },
  "threads":   { "post": "" },
  "hashtags":  { "broad": [""], "geo": [""], "entity": [""], "brand": ["#TransilvaniaTimes"] }
}`;

  const storyBlock = stories.map((s, i) => {
    const tag = s === lead ? (lang === 'ro' ? '  <<< ȘTIREA PRINCIPALĂ' : '  <<< LEAD STORY') : '';
    return [
      `${i + 1}. ${s.title}${tag}`,
      s.summary ? `   ${s.summary.slice(0, 400)}` : '',
      s.category ? `   categorie: ${s.category}` : '',
      s.county ? `   județ: ${s.county}` : '',
      s.author ? `   semnat: ${s.author}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const ctx = [
    lang === 'ro' ? `Data: ${dateLabel}` : `Date: ${dateLabel}`,
    kw.primary ? (lang === 'ro' ? `Expresie-cheie: ${kw.primary}` : `Key phrase: ${kw.primary}`) : '',
    kw.entities.length ? (lang === 'ro' ? `Entități: ${kw.entities.join(', ')}` : `Entities: ${kw.entities.join(', ')}`) : '',
    kw.questions.length ? (lang === 'ro' ? `Ce caută cititorii: ${kw.questions.join(' | ')}` : `Reader queries: ${kw.questions.join(' | ')}`) : '',
  ].filter(Boolean).join('\n');

  return {
    system: (lang === 'ro' ? systemRo : systemEn)
      + `\n\nRăspunde DOAR cu JSON valid, exact în forma:\n${schema}`,
    user: `${ctx}\n\n${storyBlock}`,
  };
}

// ════════════════════════════════════════════════════════════════════════
// STEP 3 — MODEL CALL (Claude primary, OpenAI fallback)
// ════════════════════════════════════════════════════════════════════════
async function generatePack(
  system: string, user: string,
): Promise<{ data: Record<string, unknown>; model: string; usd: number }> {
  const claudeKey = Deno.env.get('CLAUDE_API_KEY');
  const notes: string[] = [];

  if (claudeKey) {
    // First attempt asks the API to enforce the shape. If this deployment's
    // API version does not know the field it answers 400; we retry once
    // without it rather than losing the better model to a schema nicety.
    for (const useSchema of [true, false]) {
      const payload: Record<string, unknown> = {
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        temperature: 0.7,
        system,
        messages: [{ role: 'user', content: user }],
      };
      if (useSchema) {
        payload.output_config = { format: { type: 'json_object' } };
      }
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': claudeKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const d = await res.json();
          const parsed = parseJson(String(d?.content?.[0]?.text || ''));
          if (parsed) {
            const inTok = Number(d?.usage?.input_tokens || 0);
            const outTok = Number(d?.usage?.output_tokens || 0);
            // Sonnet list price at time of writing: $3 / MTok in, $15 / MTok out.
            const usd = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;
            return { data: parsed, model: CLAUDE_MODEL, usd };
          }
          notes.push('claude: unparseable JSON');
        } else {
          const txt = (await res.text()).slice(0, 200);
          notes.push(`claude ${res.status}: ${txt}`);
          if (res.status !== 400) break;   // only a 400 is worth retrying
        }
      } catch (e) {
        notes.push(`claude: ${(e as Error).message}`);
        break;
      }
    }
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) throw new Error('No copywriter configured — ' + (notes.join(' | ') || 'set CLAUDE_API_KEY or OPENAI_API_KEY'));

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 4000,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)} (after ${notes.join(' | ')})`);
  const d = await res.json();
  const parsed = parseJson(String(d?.choices?.[0]?.message?.content || ''));
  if (!parsed) throw new Error('Could not parse the caption pack from either model');
  const inTok = Number(d?.usage?.prompt_tokens || 0);
  const outTok = Number(d?.usage?.completion_tokens || 0);
  const usd = (inTok / 1e6) * 2.5 + (outTok / 1e6) * 10;
  return { data: parsed, model: OPENAI_MODEL, usd };
}

// ════════════════════════════════════════════════════════════════════════
// STEP 4 — ENFORCEMENT
//
// Everything below is deterministic. The model proposes; this decides.
// Character budgets, hashtag counts, banned phrases, link placement and
// UTM tagging are all applied here so the output is specification-compliant
// every single time, not most of the time.
// ════════════════════════════════════════════════════════════════════════
function assemble(
  raw: Record<string, unknown>,
  lang: 'ro' | 'en',
  stories: Story[],
  lead: Story,
  opts: {
    campaign: string;
    bulletinUrl: string;
    leadUrl: string;
    chapters: { time: string; label: string; seconds: number }[];
    slots: { hours: number[]; sample: number } | null;
    edition: string;
  },
) {
  const g = (o: unknown, k: string): Record<string, unknown> =>
    (o && typeof o === 'object' && (o as Record<string, unknown>)[k] && typeof (o as Record<string, unknown>)[k] === 'object')
      ? (o as Record<string, Record<string, unknown>>)[k] : {};
  const str = (v: unknown, fb = '') => stripBanned(String(v ?? (fb || '')), lang);
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.map(x => String(x ?? '')).filter(Boolean) : [];

  const fb = g(raw, 'facebook');
  const ig = g(raw, 'instagram');
  const tk = g(raw, 'tiktok');
  const yt = g(raw, 'youtube');
  const xx = g(raw, 'x');
  const li = g(raw, 'linkedin');
  const th = g(raw, 'threads');
  const hs = g(raw, 'hashtags');

  // ── hashtag tiers ────────────────────────────────────────────────────
  const tierBroad = dedupeTags(arr(hs.broad), 3);
  const tierGeo = dedupeTags(arr(hs.geo), 4);
  const tierEntity = dedupeTags(arr(hs.entity), 4);
  const tierBrand = dedupeTags([...arr(hs.brand), '#TransilvaniaTimes'], 1);

  // Guarantee a geo tag even if the model skipped it: the county is in the
  // data, and for a regional paper the local tag is the one that converts.
  if (tierGeo.length === 0) {
    const c = stories.map(s => s.county).find(c => c && c !== 'national');
    const t = c ? hashtagize(c) : '';
    if (t) tierGeo.push(t);
  }
  const allTags = [...tierEntity, ...tierGeo, ...tierBroad, ...tierBrand];
  const tagsFor = (n: number) => dedupeTags(allTags, n).join(' ');

  // ── links ────────────────────────────────────────────────────────────
  // The bulletin page when there is one, otherwise the lead article. Never
  // the homepage: a reader sold one specific story must land on it.
  const target = opts.bulletinUrl || opts.leadUrl;
  const link = (src: string, variant?: string) => withUtm(target, src, opts.campaign, variant);

  // ── facebook ─────────────────────────────────────────────────────────
  const fbHooks = arr(fb.hooks).map(h => clampWords(str(h), SPEC.facebook.hook)).slice(0, 3);
  const fbHook = fbHooks[0] || clampWords(lead.title, SPEC.facebook.hook);
  const fbBody = clampWords(str(fb.body), SPEC.facebook.body);
  const fbQuestion = str(fb.question);
  const facebook = {
    hooks: fbHooks,
    text: [fbHook, '', fbBody, fbQuestion ? '\n' + fbQuestion : '', '', tagsFor(SPEC.facebook.tags)]
      .filter(l => l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    // Facebook demotes posts that push traffic off-platform. Putting the URL
    // in the first comment keeps the post's own reach and still gets the click.
    first_comment: (str(fb.first_comment) || (lang === 'ro' ? 'Buletinul complet 👇' : 'Full bulletin 👇'))
      + '\n' + link('facebook', 'hookA'),
    link_variants: { hookA: link('facebook', 'hookA'), hookB: link('facebook', 'hookB') },
    hashtags: dedupeTags(allTags, SPEC.facebook.tags),
  };

  // ── instagram ────────────────────────────────────────────────────────
  const igHooks = arr(ig.hooks).map(h => clampWords(str(h), SPEC.instagram.hook)).slice(0, 3);
  const igCaption = clampWords(str(ig.caption), SPEC.instagram.body);
  const instagram = {
    hooks: igHooks,
    // First 125 characters carry the whole hook; everything after is below
    // the "... more" fold and most readers never open it.
    caption: [igHooks[0] || clampWords(lead.title, SPEC.instagram.hook), '', igCaption, '',
      lang === 'ro' ? 'Buletinul video complet — link în bio.' : 'Full video bulletin — link in bio.',
      '', dedupeTags(allTags, 5).join(' ')].join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    first_comment_hashtags: dedupeTags(allTags.slice(5), SPEC.instagram.tags).join(' '),
    alt_text: clampWords(str(ig.alt_text) || lead.title, 280),
    cover_text: clampWords(str(ig.cover_text) || lead.title, 40),
    bio_link: link('instagram', 'bio'),
    hashtags: dedupeTags(allTags, SPEC.instagram.tags),
  };

  // ── tiktok ───────────────────────────────────────────────────────────
  const tiktok = {
    caption: clampWords(str(tk.caption), SPEC.tiktok.body) + '\n' + dedupeTags(allTags, SPEC.tiktok.tags).join(' '),
    // The real TikTok lever is not the caption — it is the text burned into
    // the first second of video. Produced here so it can be set in the editor.
    on_screen_hook: clampWords(str(tk.on_screen_hook) || arr(tk.hooks)[0] || lead.title, SPEC.tiktok.hook),
    hooks: arr(tk.hooks).map(h => clampWords(str(h), SPEC.tiktok.hook)).slice(0, 2),
    link: link('tiktok'),
    hashtags: dedupeTags(allTags, SPEC.tiktok.tags),
  };

  // ── youtube ──────────────────────────────────────────────────────────
  const ytTitles = arr(yt.titles).map(t => clampWords(str(t), SPEC.youtube.hook)).slice(0, 3);
  const ytDesc = str(yt.description);
  const chapterBlock = opts.chapters.length
    ? (lang === 'ro' ? '\n\nCAPITOLE\n' : '\n\nCHAPTERS\n') +
      opts.chapters.map(c => `${c.time} ${c.label}`).join('\n')
    : '';
  const sourceBlock = stories.length
    ? (lang === 'ro' ? '\n\nSURSE — articolele complete:\n' : '\n\nSOURCES — full articles:\n') +
      stories.slice(0, 10)
        .map(s => `• ${s.title}\n  ${withUtm(lang === 'ro' ? s.url_ro : s.url_en, 'youtube', opts.campaign, 'desc')}`)
        .join('\n')
    : '';
  // YouTube's tag budget is 500 characters across all tags.
  const ytTags: string[] = [];
  let tagBudget = 500;
  for (const t of [...arr(yt.tags), ...allTags.map(t => t.replace(/^#/, '')), BRAND, 'stiri Transilvania', 'buletin de stiri']) {
    const clean = String(t).replace(/^#/, '').trim();
    if (!clean || ytTags.some(x => x.toLowerCase() === clean.toLowerCase())) continue;
    if (clean.length + 1 > tagBudget) break;
    ytTags.push(clean); tagBudget -= clean.length + 1;
  }
  const youtube = {
    titles: ytTitles,
    title: ytTitles[0] || clampWords(lead.title, SPEC.youtube.hook),
    // The first 157 characters are what Google shows as the search snippet.
    snippet: clampWords(ytDesc.replace(/\n+/g, ' '), 157),
    description: clampWords(
      ytDesc + chapterBlock + sourceBlock +
      `\n\n${lang === 'ro' ? 'Abonează-te pentru buletinul zilnic din Ardeal.' : 'Subscribe for the daily bulletin from Transylvania.'}\n${link('youtube')}\n\n` +
      dedupeTags(allTags, 3).join(' '),
      SPEC.youtube.body),
    chapters: opts.chapters,
    tags: ytTags,
    pinned_comment: str(yt.pinned_comment) || (lang === 'ro'
      ? 'Care subiect vrei detaliat mâine? Scrie mai jos.'
      : 'Which story should we go deeper on tomorrow?'),
  };

  // ── x ────────────────────────────────────────────────────────────────
  const xPost = clampWords(str(xx.post), SPEC.x.body - 24);   // room for the link
  const x = {
    post: `${xPost}\n${link('x')}`,
    thread: arr(xx.thread).slice(0, 4).map((p, i) =>
      clampWords(str(p), SPEC.x.body) + (i === 0 ? `\n${link('x', 'thread')}` : '')),
    hashtags: dedupeTags(allTags, SPEC.x.tags),
  };

  // ── linkedin ─────────────────────────────────────────────────────────
  const liHook = clampWords(str(li.hook), SPEC.linkedin.hook);
  const linkedin = {
    hook: liHook,
    text: [liHook, '', clampWords(str(li.body), SPEC.linkedin.body), '',
      link('linkedin'), '', dedupeTags(allTags, SPEC.linkedin.tags).join(' ')]
      .join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    hashtags: dedupeTags(allTags, SPEC.linkedin.tags),
  };

  // ── threads ──────────────────────────────────────────────────────────
  const threads = {
    post: clampWords(str(th.post), SPEC.threads.body - 30) + '\n' + link('threads'),
    hashtags: dedupeTags(allTags, SPEC.threads.tags),
  };

  const slotLabel = opts.slots
    ? (lang === 'ro'
        ? `Cele mai active ore ale site-ului: ${opts.slots.hours.map(h => `${String(h).padStart(2, '0')}:00`).join(', ')} (din ${opts.slots.sample} vizite, ultimele 90 de zile).`
        : `Busiest hours on site: ${opts.slots.hours.map(h => `${String(h).padStart(2, '0')}:00`).join(', ')} (from ${opts.slots.sample} visits, last 90 days).`)
    : null;

  return {
    lead_story: lead.title,
    lead_rationale: str(raw.lead_rationale),
    discover_headline: clampWords(str(raw.discover_headline) || lead.title, 110),
    hashtag_tiers: { broad: tierBroad, geo: tierGeo, entity: tierEntity, brand: tierBrand },
    platforms: { facebook, instagram, tiktok, youtube, x, linkedin, threads },
    publishing: {
      campaign: opts.campaign,
      target_url: target,
      best_hours: slotLabel,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// STEP 5 — JSON-LD for the public bulletin page
// ════════════════════════════════════════════════════════════════════════
function buildJsonLd(opts: {
  lang: 'ro' | 'en';
  headline: string;
  description: string;
  bulletinUrl: string;
  videoUrl: string;
  posterUrl: string;
  duration: number;
  publishedAt: string;
  stories: Story[];
}) {
  const iso = `PT${Math.floor(opts.duration / 60)}M${Math.round(opts.duration % 60)}S`;
  const publisher = {
    '@type': 'NewsMediaOrganization',
    name: BRAND,
    url: SITE,
    logo: { '@type': 'ImageObject', url: `${SITE}/assets/logos/logo-transilvania-times.png` },
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoObject',
        name: opts.headline,
        description: opts.description,
        thumbnailUrl: opts.posterUrl ? [opts.posterUrl] : undefined,
        uploadDate: opts.publishedAt,
        duration: iso,
        contentUrl: opts.videoUrl || undefined,
        embedUrl: opts.bulletinUrl || undefined,
        inLanguage: opts.lang === 'ro' ? 'ro-RO' : 'en-GB',
        publisher,
        isFamilyFriendly: true,
      },
      {
        '@type': 'NewsArticle',
        headline: clampWords(opts.headline, 110),
        description: opts.description,
        datePublished: opts.publishedAt,
        dateModified: opts.publishedAt,
        inLanguage: opts.lang === 'ro' ? 'ro-RO' : 'en-GB',
        mainEntityOfPage: { '@type': 'WebPage', '@id': opts.bulletinUrl },
        image: opts.posterUrl ? [opts.posterUrl] : undefined,
        publisher,
        author: { '@type': 'Organization', name: BRAND, url: SITE },
        // The bulletin is an editorial summary OF these articles; saying so
        // explicitly is what makes it a hub rather than duplicate content.
        mentions: opts.stories.slice(0, 10).map(s => ({
          '@type': 'NewsArticle',
          headline: s.title,
          url: opts.lang === 'ro' ? s.url_ro : s.url_en,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND, item: SITE },
          { '@type': 'ListItem', position: 2, name: opts.lang === 'ro' ? 'Buletine' : 'Bulletins', item: `${SITE}/buletin/` },
          { '@type': 'ListItem', position: 3, name: opts.headline, item: opts.bulletinUrl },
        ],
      },
    ],
  };
}

// ════════════════════════════════════════════════════════════════════════
// SPEND LOG — every paid call is recorded, so cost is a query not a guess.
// ════════════════════════════════════════════════════════════════════════
async function logSpend(
  db: SupabaseClient | null,
  row: { provider: string; model: string; usd: number; units?: number; unit_kind?: string; meta?: unknown },
) {
  if (!db) return;
  try {
    await db.from('ai_spend_log').insert({
      function_name: 'tt-social-seo',
      provider: row.provider,
      model: row.model,
      usd: Number(row.usd.toFixed(6)),
      units: row.units ?? 1,
      unit_kind: row.unit_kind ?? 'request',
      caller: 'newsroom',
      meta: row.meta ?? null,
    });
  } catch { /* logging must never break the deliverable */ }
}

// ════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'generate');

    if (action === 'health') {
      return json({
        ok: true,
        version: VERSION,
        providers: {
          claude: !!Deno.env.get('CLAUDE_API_KEY'),
          openai: !!Deno.env.get('OPENAI_API_KEY'),
          gemini: !!Deno.env.get('GEMINI_API_KEY'),
        },
      });
    }
    if (action !== 'generate') return json({ error: `Unknown action: ${action}` }, 400);

    // ── inputs ────────────────────────────────────────────────────────
    const rawStories = Array.isArray(body.stories) ? body.stories : [];
    const stories: Story[] = rawStories
      .map((s: Record<string, unknown>) => {
        const slug = String(s.slug || '').trim();
        return {
          title: String(s.title || '').trim(),
          summary: String(s.summary || '').trim().slice(0, 600),
          category: s.category ? String(s.category) : null,
          county: s.county ? String(s.county) : null,
          slug: slug || null,
          author: s.author ? String(s.author) : null,
          start: Number.isFinite(Number(s.start)) ? Number(s.start) : null,
          url_ro: slug ? `${SITE}/blog/${slug}/` : SITE,
          url_en: slug ? `${SITE}/en/blog/${slug}/` : SITE,
        };
      })
      .filter((s: Story) => s.title)
      .slice(0, 12);

    if (!stories.length) return json({ error: 'stories is required (cel puțin o știre cu titlu)' }, 400);

    const wanted = Array.isArray(body.languages) && body.languages.length
      ? body.languages.map((l: unknown) => String(l) === 'en' ? 'en' : 'ro')
      : ['ro'];
    const languages = [...new Set(wanted)] as ('ro' | 'en')[];

    const edition = String(body.edition || '');
    const publishDate = String(body.publish_date || '') || new Date().toISOString();
    const dateKey = publishDate.slice(0, 10);
    const campaign = `buletin-${dateKey}`;
    const bulletinSlug = String(body.bulletin_slug || '').trim();
    const bulletinUrl = bulletinSlug ? `${SITE}/buletin/${bulletinSlug}/` : String(body.bulletin_url || '').trim();
    const videoUrl = String(body.video_url || '').trim();
    const posterUrl = String(body.poster_url || '').trim();
    const duration = Number(body.duration_seconds) || 0;
    const introOffset = Number.isFinite(Number(body.intro_offset_seconds))
      ? Number(body.intro_offset_seconds) : 4.2;

    // ── lead story: highest specificity wins ──────────────────────────
    const scored = stories.map(s => ({ s, v: scoreStory(s) }));
    scored.sort((a, b) => b.v - a.v);
    const lead = scored[0].s;

    const db = getDb();
    const slots = await bestSlots(db);
    const geminiKey = Deno.env.get('GEMINI_API_KEY') || undefined;

    const results: Record<string, unknown> = {};
    let totalUsd = 0;

    for (const lang of languages) {
      const kw = await extractKeywords(stories, lang, geminiKey);
      if (geminiKey) await logSpend(db, { provider: 'google', model: 'gemini-2.5-flash', usd: 0.0004, unit_kind: 'extract' });

      const dateLabel = new Date(publishDate).toLocaleDateString(
        lang === 'ro' ? 'ro-RO' : 'en-GB',
        { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
      );
      const { system, user } = buildPrompt(lang, stories, lead, kw, edition, dateLabel);
      const { data, model, usd } = await generatePack(system, user);
      totalUsd += usd;
      await logSpend(db, {
        provider: model.startsWith('claude') ? 'anthropic' : 'openai',
        model, usd, unit_kind: 'caption_pack', meta: { language: lang, stories: stories.length },
      });

      const chapters = buildChapters(stories, introOffset, duration, lang);
      const pack = assemble(data, lang, stories, lead, {
        campaign,
        bulletinUrl,
        leadUrl: lang === 'ro' ? lead.url_ro : lead.url_en,
        chapters,
        slots,
        edition,
      });

      const jsonld = buildJsonLd({
        lang,
        headline: pack.discover_headline,
        description: (pack.platforms.youtube.snippet || lead.title),
        bulletinUrl: bulletinUrl || SITE,
        videoUrl,
        posterUrl,
        duration,
        publishedAt: publishDate,
        stories,
      });

      results[lang] = { ...pack, keywords: kw, jsonld, model };
    }

    // ── persist ───────────────────────────────────────────────────────
    let saved = false;
    const bulletinId = String(body.bulletin_id || '').trim();
    if (bulletinId && db) {
      try {
        await db.from('newsroom_bulletins')
          .update({ captions: results, seo: { campaign, generated_at: new Date().toISOString(), version: VERSION }, utm_campaign: campaign })
          .eq('id', bulletinId);
        saved = true;
      } catch { /* the pack is still returned to the caller */ }
    }

    return json({
      success: true,
      version: VERSION,
      campaign,
      lead_story: lead.title,
      usd: Number(totalUsd.toFixed(4)),
      saved,
      results,
    });
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function getDb(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !svc) return null;
  try { return createClient(url, svc); } catch { return null; }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
