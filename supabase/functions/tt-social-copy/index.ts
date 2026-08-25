// supabase/functions/tt-social-copy/index.ts
//
// tt-social-copy — generates ready-to-paste, reach-optimized social copy for a
// published article, tailored per platform (Facebook, Instagram feed + story,
// X/Twitter, LinkedIn) in the requested language.
//
// Written to 2026 social/SEO best practice:
//   - Facebook: stakes-first hook + short context + 2–3 hashtags, PLUS a
//     separate "first comment" line carrying the link (the link-in-comments
//     tactic lives HERE, in the post text — never burned into the image).
//   - Instagram feed: scroll-stopping first line (visible before "…more"),
//     compact caption, "🔗 Link în bio" CTA, and a researched hashtag block
//     (niche + local + medium + broad; no banned/spam tags).
//   - Instagram story: one-line hook meant to pair with the link sticker.
//   - X/Twitter: ≤280 chars incl. link, one strong claim/number, 1–2 hashtags.
//   - LinkedIn: professional "why it matters" framing, 3–5 hashtags, no clickbait.
//
// Self-contained (admin gate inlined) so it deploys cleanly via the dashboard /
// MCP without a bundling step — same pattern as flights-sync.
//
// Input:  { post_id: string, lang?: 'ro' | 'en' }
// Output: { ok: true, url, primary_keyword, platforms: { facebook, instagram_feed,
//           instagram_story, x, linkedin } }  (see SHAPE below)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const SITE = 'https://transilvaniatimes.com';

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
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// The specialist system prompt — one per language so Romanian is native, not translated.
function systemPrompt(lang: 'ro' | 'en'): string {
  if (lang === 'ro') {
    return `Ești un strateg de social media și SEO de top mondial (top 0.1%) pentru un cotidian regional din Transilvania (Transilvania Times). Scrii în ROMÂNĂ NATIVĂ, jurnalistică, fără calcuri din engleză. Scopul: reach organic maxim și click-through, respectând specificul FIECĂREI platforme în 2026.

REGULI GENERALE:
- Cârligul (prima propoziție) conține miza sau o cifră/nume concret din articol. Fără clickbait fals — promisiunea trebuie acoperită de articol.
- Include cuvântul-cheie principal natural în primele cuvinte (bun pentru SEO social + căutare internă).
- Ancorează local: menționează Transilvania sau județul unde e relevant (geo-relevanță + căutare locală).
- Emoji cu măsură (0–2), doar unde adaugă claritate.
- Hashtag-uri REALE și relevante, derivate din entitățile articolului + etichete locale evergreen (#Transilvania, #Cluj, #ȘtiriTransilvania etc.). Fără hashtag-uri interzise, fără spam, fără #follow4follow.
- NU inventa fapte, citate sau cifre care nu sunt în articol.

Returnează STRICT un obiect JSON valid, fără text în plus, cu exact această structură:
{
  "primary_keyword": "cuvântul-cheie principal (2-4 cuvinte)",
  "facebook": { "post": "hook + 2-4 propoziții context (40-80 cuvinte), 1-2 emoji, se termină natural", "first_comment": "linia pentru primul comentariu: îndemn scurt + [LINK]", "hashtags": ["#...", "#...", "#..."] },
  "instagram_feed": { "caption": "prima linie = cârlig puternic (vizibil înainte de «...mai mult»), apoi 2-3 linii context, apoi «🔗 Link în bio»", "hashtags": ["12-15 hashtag-uri mixte: nișă + local + mediu + larg"] },
  "instagram_story": { "text": "o linie scurtă de cârlig, gândită să însoțească sticker-ul de link" },
  "x": { "post": "≤ 240 caractere (lasă loc pentru link), o afirmație tare sau o cifră, 1-2 hashtag-uri" },
  "linkedin": { "post": "încadrare profesională «de ce contează», 1-3 paragrafe scurte, ton analitic, fără clickbait", "hashtags": ["#...", "#...", "#..."] }
}
Nu include linkul în câmpuri; îl adaug eu. Pentru Facebook, linkul merge DOAR în first_comment (folosește literalmente [LINK] ca placeholder).`;
  }
  return `You are a world-class (top 0.1%) social media & SEO strategist for a Transylvanian regional newspaper (Transilvania Times). Write in natural, journalistic ENGLISH. Goal: maximum organic reach and click-through, respecting EACH platform's 2026 best practice.

GENERAL RULES:
- The hook (first sentence) carries the stakes or a concrete number/name from the article. No false clickbait — the article must deliver on the promise.
- Put the primary keyword naturally in the first words (good for social SEO + internal search).
- Anchor locally: mention Transylvania or the county where relevant (geo-relevance + local search).
- Emoji sparingly (0–2), only where they add clarity.
- REAL, relevant hashtags derived from the article's entities + evergreen local tags (#Transylvania, #Cluj, #TransylvaniaNews etc.). No banned/spam tags, no #follow4follow.
- Never invent facts, quotes, or numbers not in the article.

Return STRICTLY one valid JSON object, no extra text, with exactly this shape:
{
  "primary_keyword": "the primary keyword (2-4 words)",
  "facebook": { "post": "hook + 2-4 sentences of context (40-80 words), 1-2 emoji", "first_comment": "first-comment line: short CTA + [LINK]", "hashtags": ["#...", "#...", "#..."] },
  "instagram_feed": { "caption": "first line = strong hook (visible before '...more'), then 2-3 context lines, then '🔗 Link in bio'", "hashtags": ["12-15 mixed hashtags: niche + local + medium + broad"] },
  "instagram_story": { "text": "one short hook line, made to sit beside the link sticker" },
  "x": { "post": "≤ 240 chars (leave room for the link), one strong claim or number, 1-2 hashtags" },
  "linkedin": { "post": "professional 'why it matters' framing, 1-3 short paragraphs, analytical tone, no clickbait", "hashtags": ["#...", "#...", "#..."] }
}
Do not include the link inside any field; I append it. For Facebook the link goes ONLY in first_comment (use the literal [LINK] placeholder).`;
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
      .select('slug, title_ro, title_en, summary_ro, summary_en, excerpt_ro, excerpt_en, content_ro, content_en, category, county, tags_ro, tags_en')
      .eq('id', post_id).single();
    if (error || !data) return json({ ok: false, error: 'Article not found' }, 404);
    const p = data as Post;

    const title = lang === 'ro' ? (p.title_ro || p.title_en) : (p.title_en || p.title_ro);
    const summary = lang === 'ro' ? (p.summary_ro || p.excerpt_ro) : (p.summary_en || p.excerpt_en);
    const bodyRaw = lang === 'ro' ? (p.content_ro || p.content_en) : (p.content_en || p.content_ro);
    const body = stripHtml(bodyRaw || '').slice(0, 3500);
    const tags = (lang === 'ro' ? p.tags_ro : p.tags_en) || [];
    const url = lang === 'ro' ? `${SITE}/blog/${p.slug}/` : `${SITE}/en/blog/${p.slug}/`;

    if (!title) return json({ ok: false, error: 'Article has no title in the requested language' }, 422);

    const userMsg = [
      `TITLU/TITLE: ${title}`,
      summary ? `REZUMAT/SUMMARY: ${summary}` : '',
      p.category ? `CATEGORIE/CATEGORY: ${p.category}` : '',
      p.county ? `JUDEȚ/COUNTY: ${p.county}` : '',
      tags.length ? `TAGS: ${tags.join(', ')}` : '',
      '',
      `CONȚINUT/CONTENT:\n${body}`,
    ].filter(Boolean).join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt(lang) },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.7,
        max_tokens: 1500,
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

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw); }
    catch { return json({ ok: false, error: 'Model returned invalid JSON', raw_preview: String(raw).slice(0, 300) }, 502); }

    // Substitute the real link into Facebook's first-comment placeholder.
    const fb = (parsed.facebook ?? {}) as Record<string, unknown>;
    if (typeof fb.first_comment === 'string') {
      fb.first_comment = fb.first_comment.includes('[LINK]')
        ? fb.first_comment.replace(/\[LINK\]/g, url)
        : `${fb.first_comment} ${url}`.trim();
      parsed.facebook = fb;
    }

    return json({ ok: true, url, lang, ...parsed });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
