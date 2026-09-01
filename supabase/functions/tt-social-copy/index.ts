// supabase/functions/tt-social-copy/index.ts
//
// tt-social-copy v2 — the article-side SEO + social pack.
//
// Brings the single-article generator up to the level of the newsroom's
// tt-social-seo pack (step 7 of /admin/newsroom), but scoped to ONE published
// article and to a STILL card rather than a video bulletin. It is deliberately
// kept a separate, self-contained function (no _shared imports) so it pastes
// straight into the Supabase dashboard editor.
//
// WHAT'S NEW vs v1 (the flat five-caption version)
//   - A real keyword layer: primary_keyword + entities + reader_questions.
//   - A Google Discover headline, plus two A/B hooks (hookA/hookB) tagged into
//     the outbound links as utm_content so article_hook_winner can compare them
//     (same loop tt-social-seo runs for bulletins).
//   - Tiered hashtags (broad / geo / entity / brand); the per-platform hashtag
//     sets are composed in CODE from those tiers, so counts and discipline are
//     deterministic instead of left to the model.
//   - Per-platform native specs: FB post + link-in-first-comment, IG feed
//     (caption + alt-text + cover-text + first-comment hashtags), IG story,
//     X (<=240, link appended by the caller), LinkedIn.
//   - publishing block: campaign = article-YYYY-MM-DD-<slug>, target_url,
//     best_hours. The caller builds the final per-platform UTM link from these.
//
// WHY NO JSON-LD HERE (deliberate): the public article page already emits
// NewsArticle + BreadcrumbList structured data (authors system, May 2026).
// Re-emitting it in this pack would invite pasting DUPLICATE schema onto the
// same URL, which hurts rather than helps. The SEO value this pack adds is the
// social-SEO layer above (Discover headline, keywords, tiers), not a second
// copy of the article's own schema.
//
// LINKS: copy fields carry a literal [LINK] placeholder only where a link
// belongs inside the text (Facebook first comment). Everywhere else the caller
// appends the link, because only the caller knows which A/B variant is being
// posted. See app/admin/social/page.tsx -> linkFor().
//
// Input:  { post_id: string, lang?: 'ro' | 'en' }
// Output: { ok:true, lang, target_url, campaign, best_hours, primary_keyword,
//           keywords, discover_headline, variants:{hookA,hookB}, hashtag_tiers,
//           platforms:{facebook,instagram_feed,instagram_story,x,linkedin} }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SITE = 'https://transilvaniatimes.com';
const MODEL = 'gpt-4o'; // unchanged engine — the upgrade is in the prompt + pack, not the model.

// ── admin gate (inlined from _shared/requireAdmin.ts, kept self-contained) ──
async function requireAdmin(req: Request): Promise<Response | null> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Unauthorized' }, 401);

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey && token === serviceKey) return null;

  const url = Deno.env.get('SUPABASE_URL')!;
  // Prove service-role by doing something only it can do.
  try {
    const probe = createClient(url, token, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!error) return null;
  } catch { /* fall through to admin-user check */ }

  try {
    const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? serviceKey!;
    const sb = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: u, error: uErr } = await sb.auth.getUser(token);
    if (uErr || !u.user) return json({ error: 'Unauthorized' }, 401);
    const { data: role } = await sb.from('user_roles').select('role')
      .eq('user_id', u.user.id).eq('role', 'admin').maybeSingle();
    if (!role) return json({ error: 'Forbidden' }, 403);
    return null;
  } catch (e) {
    console.error('[tt-social-copy] admin check failed:', (e as Error).message);
    return json({ error: 'Unauthorized' }, 401);
  }
}

interface Post {
  slug: string;
  title_ro: string | null; title_en: string | null;
  summary_ro: string | null; summary_en: string | null;
  excerpt_ro: string | null; excerpt_en: string | null;
  content_ro: string | null; content_en: string | null;
  category: string | null; county: string | null;
  tags_ro: string[] | null; tags_en: string[] | null;
  author_name: string | null;
  published_at: string | null;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ── typed accessors so a missing / mistyped model field never throws ─────────
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
function arr(v: unknown, max = 30): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(x => str(x)).filter(Boolean).slice(0, max);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
// A hashtag, normalised: single leading #, no spaces, keep RO diacritics.
function tag(raw: string): string {
  const t = raw.replace(/^#+/, '').replace(/\s+/g, '');
  return t ? '#' + t : '';
}
function tags(list: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of list) {
    const t = tag(r);
    const k = t.toLowerCase();
    if (t && !seen.has(k)) { seen.add(k); out.push(t); if (out.length >= max) break; }
  }
  return out;
}

// The specialist system prompt — one per language so Romanian is native, not translated.
function systemPrompt(lang: 'ro' | 'en'): string {
  if (lang === 'ro') {
    return `Ești un strateg de social media și SEO de top mondial (top 0.1%) pentru un cotidian regional din Transilvania (Transilvania Times). Scrii în ROMÂNĂ NATIVĂ, jurnalistică, fără calcuri din engleză. Scopul: reach organic maxim și click-through, respectând specificul FIECĂREI platforme în 2026.

REGULI GENERALE:
- Cârligul (prima propoziție) conține miza sau o cifră/nume concret din articol. Fără clickbait fals — promisiunea trebuie acoperită de articol.
- Include cuvântul-cheie principal natural în primele cuvinte.
- Ancorează local: menționează Transilvania sau județul unde e relevant.
- Emoji cu măsură (0–2), doar unde adaugă claritate.
- NU inventa fapte, citate sau cifre care nu sunt în articol.
- Hashtag-urile le dai pe NIVELURI (nu amestecate), din entitățile reale ale articolului + etichete locale evergreen. Fără spam, fără #follow4follow.

Returnează STRICT un obiect JSON valid, fără text în plus, cu EXACT structura:
{
  "primary_keyword": "cuvântul-cheie principal (2-4 cuvinte)",
  "entities": ["3-6 nume proprii reale din articol: persoane, instituții, locuri"],
  "reader_questions": ["2-4 întrebări pe care le-ar căuta cititorii pe acest subiect"],
  "discover_headline": "titlu pentru Google Discover: concret, ≤ 90 caractere, fără clickbait, promisiune acoperită de articol",
  "hook_a": "variantă scurtă de cârlig A (curiozitate + miză)",
  "hook_b": "variantă scurtă de cârlig B, alt unghi (condusă de o cifră sau un nume)",
  "hashtag_tiers": {
    "broad": ["2-3 hashtag-uri largi de subiect"],
    "geo": ["2-3 hashtag-uri locale: #Transilvania, județ, oraș"],
    "entity": ["2-4 hashtag-uri din entitățile articolului"],
    "brand": ["#TransilvaniaTimes"]
  },
  "facebook": { "post": "cârlig + 2-4 propoziții context (40-80 cuvinte), 1-2 emoji, se termină natural; FĂRĂ link în text", "first_comment": "linia pentru primul comentariu: îndemn scurt urmat de [LINK]" },
  "instagram_feed": { "caption": "prima linie = cârlig puternic (vizibil înainte de «...mai mult»), apoi 2-3 linii context, apoi «🔗 Link în bio»", "alt_text": "descriere factuală a imaginii pentru accesibilitate (≤ 120 caractere)", "cover_text": "3-6 cuvinte mari pentru coperta cardului" },
  "instagram_story": { "text": "o linie scurtă de cârlig, gândită să însoțească sticker-ul de link" },
  "x": { "post": "≤ 240 caractere (las loc pentru link, îl adaug eu), o afirmație tare sau o cifră; FĂRĂ link, FĂRĂ mai mult de 1 hashtag în text" },
  "linkedin": { "post": "încadrare profesională «de ce contează», 1-3 paragrafe scurte, ton analitic, fără clickbait; FĂRĂ link" }
}
Nu pune linkul în niciun câmp în afară de [LINK] din facebook.first_comment; restul linkurilor le adaug eu.`;
  }
  return `You are a world-class (top 0.1%) social media & SEO strategist for a Transylvanian regional newspaper (Transilvania Times). Write in natural, journalistic ENGLISH. Goal: maximum organic reach and click-through, respecting EACH platform's 2026 best practice.

GENERAL RULES:
- The hook (first sentence) carries the stakes or a concrete number/name from the article. No false clickbait — the article must deliver.
- Put the primary keyword naturally in the first words.
- Anchor locally: mention Transylvania or the county where relevant.
- Emoji sparingly (0–2), only where they add clarity.
- Never invent facts, quotes, or numbers not in the article.
- Give hashtags in TIERS (not mixed), derived from the article's real entities + evergreen local tags. No spam, no #follow4follow.

Return STRICTLY one valid JSON object, no extra text, with EXACTLY this shape:
{
  "primary_keyword": "the primary keyword (2-4 words)",
  "entities": ["3-6 real proper nouns from the article: people, institutions, places"],
  "reader_questions": ["2-4 questions readers would search on this topic"],
  "discover_headline": "a Google Discover headline: concrete, <= 90 chars, no clickbait, promise covered by the article",
  "hook_a": "short hook variant A (curiosity + stakes)",
  "hook_b": "short hook variant B, a different angle (number- or name-led)",
  "hashtag_tiers": {
    "broad": ["2-3 broad topic hashtags"],
    "geo": ["2-3 local hashtags: #Transylvania, county, city"],
    "entity": ["2-4 hashtags from the article's entities"],
    "brand": ["#TransilvaniaTimes"]
  },
  "facebook": { "post": "hook + 2-4 sentences of context (40-80 words), 1-2 emoji, ends naturally; NO link in the text", "first_comment": "first-comment line: short CTA followed by [LINK]" },
  "instagram_feed": { "caption": "first line = strong hook (visible before '...more'), then 2-3 context lines, then '🔗 Link in bio'", "alt_text": "factual image description for accessibility (<= 120 chars)", "cover_text": "3-6 big words for the card cover" },
  "instagram_story": { "text": "one short hook line, made to sit beside the link sticker" },
  "x": { "post": "<= 240 chars (leave room for the link, I append it), one strong claim or number; NO link, at most 1 hashtag in the text" },
  "linkedin": { "post": "professional 'why it matters' framing, 1-3 short paragraphs, analytical tone, no clickbait; NO link" }
}
Do not put the link in any field except the [LINK] token inside facebook.first_comment; I append every other link.`;
}

function bestHours(lang: 'ro' | 'en'): string {
  return lang === 'ro'
    ? 'Ore bune de postare (ora României): Facebook 19:00–22:00 · Instagram 12:00–13:00 și 20:00–22:00 · X 08:00–10:00 · LinkedIn 08:00–10:00, marți–joi.'
    : 'Good posting windows (EET): Facebook 7–10pm · Instagram noon & 8–10pm · X 8–10am · LinkedIn 8–10am, Tue–Thu.';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const { post_id, lang: rawLang } = await req.json();
    const lang: 'ro' | 'en' = rawLang === 'en' ? 'en' : 'ro';
    if (!post_id) return json({ ok: false, error: 'post_id is required' }, 400);

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ ok: false, error: 'OPENAI_API_KEY not configured' }, 500);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });
    const { data, error } = await sb.from('blog_posts')
      .select('slug, title_ro, title_en, summary_ro, summary_en, excerpt_ro, excerpt_en, content_ro, content_en, category, county, tags_ro, tags_en, author_name, published_at')
      .eq('id', post_id).single();
    if (error || !data) return json({ ok: false, error: 'Article not found' }, 404);
    const p = data as Post;

    const title = lang === 'ro' ? (p.title_ro || p.title_en) : (p.title_en || p.title_ro);
    const summary = lang === 'ro' ? (p.summary_ro || p.excerpt_ro) : (p.summary_en || p.excerpt_en);
    const bodyRaw = lang === 'ro' ? (p.content_ro || p.content_en) : (p.content_en || p.content_ro);
    const body = stripHtml(bodyRaw || '').slice(0, 3500);
    const seedTags = (lang === 'ro' ? p.tags_ro : p.tags_en) || [];
    const target_url = lang === 'ro' ? `${SITE}/blog/${p.slug}/` : `${SITE}/en/blog/${p.slug}/`;

    if (!title) return json({ ok: false, error: 'Article has no title in the requested language' }, 422);

    // campaign = article-YYYY-MM-DD-<slug>, dated by publish day (fallback: today).
    const day = (p.published_at || new Date().toISOString()).slice(0, 10);
    const campaign = `article-${day}-${p.slug}`.slice(0, 120);

    const userMsg = [
      `TITLU/TITLE: ${title}`,
      summary ? `REZUMAT/SUMMARY: ${summary}` : '',
      p.category ? `CATEGORIE/CATEGORY: ${p.category}` : '',
      p.county ? `JUDEȚ/COUNTY: ${p.county}` : '',
      seedTags.length ? `TAGS: ${seedTags.join(', ')}` : '',
      '',
      `CONȚINUT/CONTENT:\n${body}`,
    ].filter(Boolean).join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt(lang) },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return json({ ok: false, error: `OpenAI ${res.status}: ${t.slice(0, 300)}` }, 502);
    }
    const oa = await res.json();
    const raw = oa.choices?.[0]?.message?.content;
    if (!raw) return json({ ok: false, error: 'Empty response from model' }, 502);

    let m: Record<string, unknown>;
    try { m = JSON.parse(raw); }
    catch { return json({ ok: false, error: 'Model returned invalid JSON', raw_preview: String(raw).slice(0, 300) }, 502); }

    // ── Compose the pack. Hashtag sets are built in CODE from the tiers so the
    //    per-platform counts and dedupe are deterministic, not model-dependent.
    const t = obj(m.hashtag_tiers);
    const tierBroad  = arr(t.broad, 6).map(tag).filter(Boolean);
    const tierGeo    = arr(t.geo, 6).map(tag).filter(Boolean);
    const tierEntity = arr(t.entity, 8).map(tag).filter(Boolean);
    let   tierBrand  = arr(t.brand, 4).map(tag).filter(Boolean);
    if (!tierBrand.length) tierBrand = ['#TransilvaniaTimes'];

    const hashtag_tiers = { broad: tierBroad, geo: tierGeo, entity: tierEntity, brand: tierBrand };

    // per-platform hashtag discipline
    const fbTags = tags([...tierBroad.slice(0, 1), ...tierGeo.slice(0, 1), ...tierEntity.slice(0, 1)], 3);
    const igTags = tags([...tierEntity, ...tierGeo, ...tierBroad, ...tierBrand], 15);
    const xTags  = tags([tierEntity[0] || tierBroad[0] || '', tierGeo[0] || ''], 2);
    const liTags = tags([...tierBroad.slice(0, 2), ...tierEntity.slice(0, 2), ...tierBrand.slice(0, 1)], 5);

    const fb = obj(m.facebook);
    const ig = obj(m.instagram_feed);
    const igs = obj(m.instagram_story);
    const x = obj(m.x);
    const li = obj(m.linkedin);

    const facebook = {
      post: str(fb.post),
      // link stays a [LINK] placeholder; the caller substitutes the variant link.
      first_comment: str(fb.first_comment) || (lang === 'ro' ? 'Articolul complet 👇 [LINK]' : 'Full story 👇 [LINK]'),
      hashtags: fbTags,
    };
    const instagram_feed = {
      caption: str(ig.caption),
      alt_text: str(ig.alt_text),
      cover_text: str(ig.cover_text),
      first_comment_hashtags: igTags.join(' '),
      hashtags: igTags,
    };
    const instagram_story = { text: str(igs.text) };
    const xPlat = { post: str(x.post), hashtags: xTags };
    const linkedin = { post: str(li.post), hashtags: liTags };

    const primary_keyword = str(m.primary_keyword);
    const entities = arr(m.entities, 8);
    const reader_questions = arr(m.reader_questions, 6);
    const discover_headline = str(m.discover_headline) || title;
    const hookA = str(m.hook_a) || discover_headline;
    const hookB = str(m.hook_b) || title;

    return json({
      ok: true,
      lang,
      target_url,
      campaign,
      best_hours: bestHours(lang),
      primary_keyword,
      keywords: { primary: primary_keyword, entities, questions: reader_questions },
      discover_headline,
      variants: { hookA, hookB },
      hashtag_tiers,
      platforms: {
        facebook,
        instagram_feed,
        instagram_story,
        x: xPlat,
        linkedin,
      },
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
