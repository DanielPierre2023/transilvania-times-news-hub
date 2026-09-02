// supabase/functions/search-cover-photos/index.ts
//
// Grounded Unsplash cover search for articles. Fixes the "Indian parliament for
// the Romanian parliament" problem two ways: (1) the query is built by the
// shared visual-brief, so it carries the real country/county; (2) it returns
// Unsplash's RELEVANCE-RANKED results as CANDIDATES for a human to pick — no
// more random roll among the top few.
//
// Actions (POST JSON):
//   { action:'search', title, summary?, category?, county?, query? }
//     -> { ok, query, brief:{photo_prompt,prefer_real,alt_text,place}, results:[…] }
//        results[i] = { id, thumb, preview, url, full, author, author_link,
//                       unsplash_link, download_location, alt }
//   { action:'download', image_url, download_location?, credit? }
//     -> copies the chosen photo into blog-images/covers and returns
//        { ok, publicUrl, credit } (we OWN the asset — no hotlink breakage).
//
// Admin-gated (paid/quota'd external API). Env: UNSPLASH_ACCESS_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY (for the brief).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

// ── Grounded visual brief (inlined; self-contained for dashboard deploy) ──────
// Turns an article into a location-grounded Unsplash query + AI photo prompt so a
// subject like "the parliament" resolves to the ROMANIAN one (Bucharest), never a
// foreign parliament. Gemini is timeout-guarded with a deterministic fallback.
interface VisualBrief { unsplash_query: string; photo_prompt: string; alt_text: string; prefer_real: boolean; place: string }
const _VB_COUNTY: Record<string, string> = {
  cluj: 'Cluj', bihor: 'Bihor', alba: 'Alba', 'bistrita-nasaud': 'Bistrița-Năsăud',
  salaj: 'Sălaj', mures: 'Mureș', sibiu: 'Sibiu', maramures: 'Maramureș',
  'satu-mare': 'Satu Mare', hunedoara: 'Hunedoara', brasov: 'Brașov',
  covasna: 'Covasna', harghita: 'Harghita',
};
const _VB_SCENE: Record<string, { q: string; scene: string }> = {
  politics: { q: 'Romanian government building', scene: 'a Romanian government or council building, official setting' },
  economy: { q: 'Romania business economy', scene: 'a Romanian commercial street or office district' },
  business: { q: 'Romania business office', scene: 'a modern Romanian office or business district' },
  local: { q: 'Romania town square street', scene: 'a Transylvanian town square and historic street' },
  education: { q: 'Romania school classroom', scene: 'a Romanian school building, classroom, desks and books' },
  health: { q: 'Romania hospital healthcare', scene: 'a Romanian hospital corridor or clinic, medical staff' },
  sports: { q: 'Romania stadium sport', scene: 'a Romanian stadium or sports hall during competition' },
  culture: { q: 'Transylvania heritage architecture', scene: 'a Transylvanian heritage building, museum or theatre' },
  travel: { q: 'Transylvania landscape Romania', scene: 'a scenic Transylvanian landscape or old town' },
  events: { q: 'Romania festival crowd', scene: 'a Romanian public event or festival' },
  justice: { q: 'Romania courthouse justice', scene: 'a Romanian courthouse, formal institutional setting' },
  weather: { q: 'Transylvania weather sky landscape', scene: 'a dramatic Transylvanian sky over the countryside' },
  news: { q: 'Transylvania Romania city street', scene: 'a Transylvanian city street, everyday public life' },
};
function _vbPlace(county?: string | null): string {
  const c = (county || '').toLowerCase();
  if (c && c !== 'national' && _VB_COUNTY[c]) return `${_VB_COUNTY[c]} county, Transylvania, Romania`;
  return 'Romania';
}
function _vbClean(q: string): string {
  return (q || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
}
function _vbFallback(input: { title: string; category?: string; county?: string | null }, place: string): VisualBrief {
  const base = _VB_SCENE[(input.category || 'news').toLowerCase()] || _VB_SCENE.news;
  const q = _vbClean(place === 'Romania' ? base.q : `${_VB_COUNTY[(input.county || '').toLowerCase()] || ''} ${base.q}`);
  return {
    unsplash_query: q || 'Transylvania Romania',
    photo_prompt: `Photorealistic editorial news photograph of ${base.scene}, in ${place}. Natural light, documentary style, sharp focus, realistic. No text, no logos, no watermark, no distorted faces.`,
    alt_text: `Imagine ilustrativă — ${input.title}`.slice(0, 160),
    prefer_real: true, place,
  };
}
async function buildVisualBrief(input: { title: string; summary?: string; category?: string; county?: string | null }): Promise<VisualBrief> {
  const place = _vbPlace(input.county);
  const fallback = _vbFallback(input, place);
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return fallback;
  const sys = `You are the photo editor of Transilvania Times, a Romanian regional newspaper covering Transylvania. For the given article output a STRICT JSON object used to pick or generate an accurate COVER IMAGE.

Ground EVERYTHING in the real place: ${place}. Hard rule: never depict another country's version of a subject. For "the parliament" it is the ROMANIAN Parliament in Bucharest — never a foreign parliament. For a named town, county, institution, road or landmark, keep it Romanian/Transylvanian.

Output ONLY this JSON object (no prose):
{"unsplash_query":"3-6 ENGLISH words for a stock-photo search that returns a RELEVANT REAL photo; include the country/city/landmark when the subject is a named place, building, institution, road or event (e.g. \\"Romanian Parliament Bucharest\\", \\"Cluj-Napoca old town\\"); concrete photographable nouns, no punctuation","photo_prompt":"40-70 word ENGLISH prompt for a PHOTOREALISTIC editorial news photo of the scene, grounded in ${place}; describe setting, light, composition; must NOT contain text, logos, watermarks or recognizable real individuals' faces; avoid dense text, dozens of faces, hands in close focus","prefer_real":true if a REAL stock photo is more appropriate/credible (named places, institutions, events, factual news) — false only for abstract/illustrative/opinion pieces,"alt_text":"one concise ROMANIAN sentence describing the intended image"}`;
  const user = `Category: ${input.category || 'news'}\nCounty: ${input.county || 'national'}\nTitle: ${input.title}\nSummary: ${(input.summary || '').substring(0, 500)}`;
  try {
    const call = fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 500, responseMimeType: 'application/json' },
      }),
    }).then((r) => r.json()).catch(() => null);
    const data = await Promise.race([call, new Promise<null>((res) => setTimeout(() => res(null), 7000))]);
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    if (!text) return fallback;
    const p = JSON.parse(text);
    const query = _vbClean(String(p.unsplash_query || ''));
    const prompt = String(p.photo_prompt || '').trim();
    return {
      unsplash_query: query || fallback.unsplash_query,
      photo_prompt: prompt.length > 25 ? prompt : fallback.photo_prompt,
      alt_text: String(p.alt_text || fallback.alt_text).trim().slice(0, 200),
      prefer_real: p.prefer_real !== false, place,
    };
  } catch { return fallback; }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const UTM = 'utm_source=transilvania_times&utm_medium=referral';
const withUtm = (link: string) => {
  if (!link) return link;
  return link + (link.includes('?') ? '&' : '?') + UTM;
};

interface UnsplashPhoto {
  id: string;
  alt_description?: string | null;
  urls?: { thumb?: string; small?: string; regular?: string; full?: string };
  user?: { name?: string; links?: { html?: string } };
  links?: { html?: string; download_location?: string };
}

async function handleSearch(body: Record<string, unknown>, accessKey: string): Promise<Response> {
  const title = String(body.title || '').trim();
  const provided = String(body.query || '').trim();
  if (!title && !provided) return json({ error: 'title or query is required' }, 400);

  const brief = await buildVisualBrief({
    title,
    summary: String(body.summary || ''),
    category: String(body.category || ''),
    county: (body.county as string) ?? null,
  });
  const query = provided || brief.unsplash_query;

  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}`
    + `&per_page=12&orientation=landscape&content_filter=high`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let results: UnsplashPhoto[] = [];
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${accessKey}`, 'Accept-Version': 'v1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return json({ error: `Unsplash ${res.status}: ${t.slice(0, 160)}`, query }, 502);
    }
    const data = await res.json();
    results = Array.isArray(data?.results) ? data.results as UnsplashPhoto[] : [];
  } catch (e) {
    clearTimeout(timer);
    return json({ error: `Unsplash request failed: ${(e as Error).message}`, query }, 502);
  }

  // Relevance order preserved (Unsplash returns most-relevant first).
  const mapped = results.map((p) => ({
    id: p.id,
    thumb: p.urls?.thumb || p.urls?.small || '',
    preview: p.urls?.small || p.urls?.regular || '',
    url: p.urls?.regular || p.urls?.full || '',
    full: p.urls?.full || p.urls?.regular || '',
    author: p.user?.name || 'Unsplash',
    author_link: withUtm(p.user?.links?.html || ''),
    unsplash_link: withUtm(p.links?.html || ''),
    download_location: p.links?.download_location || '',
    alt: p.alt_description || '',
  })).filter((r) => r.url);

  return json({
    ok: true,
    query,
    brief: {
      photo_prompt: brief.photo_prompt,
      prefer_real: brief.prefer_real,
      alt_text: brief.alt_text,
      place: brief.place,
    },
    results: mapped,
  });
}

async function handleDownload(body: Record<string, unknown>, accessKey: string): Promise<Response> {
  const imageUrl = String(body.image_url || '').trim();
  if (!imageUrl) return json({ error: 'image_url is required' }, 400);

  // Unsplash guideline: trigger the download endpoint when a photo is used.
  const dl = String(body.download_location || '').trim();
  if (dl) {
    try { await fetch(withUtm(dl), { headers: { Authorization: `Client-ID ${accessKey}` } }); } catch { /* non-fatal */ }
  }

  const img = await fetch(imageUrl);
  if (!img.ok) return json({ error: `photo download failed (${img.status})` }, 502);
  const buf = new Uint8Array(await img.arrayBuffer());
  if (buf.byteLength < 3000) return json({ error: 'photo is empty' }, 502);

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const fileName = `covers/unsplash-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error: upErr } = await supabaseAdmin.storage
    .from('blog-images')
    .upload(fileName, buf, { contentType: 'image/jpeg', upsert: false });
  if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

  const { data: urlData } = supabaseAdmin.storage.from('blog-images').getPublicUrl(fileName);
  return json({ ok: true, publicUrl: urlData.publicUrl, fileName, credit: (body.credit as string) || null });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const accessKey = Deno.env.get('UNSPLASH_ACCESS_KEY');
    if (!accessKey) return json({ error: 'UNSPLASH_ACCESS_KEY not configured' }, 400);

    const action = String(body.action || 'search');
    if (action === 'download') return await handleDownload(body, accessKey);
    return await handleSearch(body, accessKey);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});
