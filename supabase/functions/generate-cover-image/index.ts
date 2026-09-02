// supabase/functions/generate-cover-image/index.ts
//
// Accepts (classic cover mode): { title, excerpt, summary?, category? }
//   -> Gemini rewrites into an editorial photo prompt, landscape output.
// Accepts (raw / campaign mode): { raw_prompt, aspect?, width?, height? }
//   -> raw_prompt is sent VERBATIM to the image model (no Gemini rewrite), at the
//      requested aspect ratio. Backward compatible: if raw_prompt is absent,
//      behaviour matches the classic cover flow.
// Returns: { success, publicUrl, fileName, mode, prompt }
//
// PROVIDERS (2026 fix):
//   * HuggingFace old host api-inference.huggingface.co was RETIRED (DNS fails).
//     Repointed to the current router.huggingface.co endpoint, guarded by a
//     timeout, tried first because it can be free.
//   * OpenAI dall-e-3 was RETIRED ("model does not exist"). Switched to
//     gpt-image-1, which returns base64 (not a URL) and uses 1024x1024 /
//     1536x1024 / 1024x1536 sizes. This is the reliable provider.
//
// ── 30 Aug 2026: THE RESOLUTION BUG ─────────────────────────────────────────
//
// Every Studio still was generated at 1024 on the long side — 576x1024 for a
// vertical clip — by FLUX.1-schnell, the four-step distilled model, chosen
// first because it is free. The Studio master is 1080x1920. So the picture the
// audience saw had been enlarged 1.875x from a draft-grade generation before a
// single frame was rendered, and for the campaign path the still was forced to
// 1024x576 LANDSCAPE regardless of aspect, then cropped to vertical: a usable
// 324x576, blown up 3.3x. That is the whole of "the images are really shit" —
// not the prompts, not the grade, arithmetic.
//
// Campaign/Studio stills now go to a model that accepts an explicit size and
// renders at TWICE the master (3840x2160, 2160x3840), so the render downsamples
// instead of enlarging, and a Ken Burns push has real pixels to move into.
//
//   fal-ai/bytedance/seedream/v4.5/text-to-image — explicit width/height,
//   both sides 1920..4096, $0.04 an image (fal model page, 30 Aug 2026).
//
// Article covers keep the cheap ladder: they are thumbnails, generated in bulk
// by the scraper, and 1024 is the right size for one.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const HF_TIMEOUT_MS = 25000;

// ─── Aspect ratio → dimensions ────────────────────────────────────────────────
// FLUX keeps the longer side ~1024. gpt-image-1 only accepts three sizes, mapped
// here by orientation (the exact ratio is finished with the text template).
type Aspect = '1:1' | '4:5' | '9:16' | '16:9';
function dimsForAspect(aspect: Aspect): { fluxW: number; fluxH: number; oaiSize: string } {
  switch (aspect) {
    case '1:1':  return { fluxW: 1024, fluxH: 1024, oaiSize: '1024x1024' };
    case '4:5':  return { fluxW: 820,  fluxH: 1024, oaiSize: '1024x1536' };
    case '9:16': return { fluxW: 576,  fluxH: 1024, oaiSize: '1024x1536' };
    case '16:9':
    default:     return { fluxW: 1024, fluxH: 576,  oaiSize: '1536x1024' };
  }
}
// TWICE the 1080p master on each side. Both sides land inside Seedream's
// 1920..4096 window and the total stays under 4096x4096.
//   16:9 -> 3840x2160   9:16 -> 2160x3840   1:1 -> 2560x2560   4:5 -> 2160x2700
const MASTER_DIMS: Record<Aspect, { w: number; h: number }> = {
  '16:9': { w: 3840, h: 2160 },
  '9:16': { w: 2160, h: 3840 },
  '1:1':  { w: 2560, h: 2560 },
  '4:5':  { w: 2160, h: 2700 },
};

/**
 * Seedream's constraint, from the model page: "Width and height must be
 * between 1920 and 4096, or total number of pixels must be between 2560*1440
 * and 4096*4096". Honour the strict reading — both sides in range — so a
 * caller-supplied size can never produce a 422 we only find out about live.
 */
function fitSeedream(w: number, h: number): { width: number; height: number } {
  const MIN = 1920, MAX = 4096;
  let width = Math.round(w), height = Math.round(h);
  const ratio = width / height;
  if (width < MIN || height < MIN) {
    const up = Math.max(MIN / width, MIN / height);
    width = Math.round(width * up); height = Math.round(height * up);
  }
  if (width > MAX || height > MAX) {
    const down = Math.min(MAX / width, MAX / height);
    width = Math.round(width * down); height = Math.round(height * down);
  }
  // Rounding can push a side one pixel under the floor; nudge it back along
  // the ratio rather than silently sending an invalid pair.
  if (width < MIN) { width = MIN; height = Math.round(MIN / ratio); }
  if (height < MIN) { height = MIN; width = Math.round(MIN * ratio); }
  return {
    width: Math.max(MIN, Math.min(MAX, width)),
    height: Math.max(MIN, Math.min(MAX, height)),
  };
}

function normalizeAspect(v: unknown): Aspect {
  const s = String(v || '').trim();
  if (s === '1:1' || s === '4:5' || s === '9:16' || s === '16:9') return s;
  return '16:9';
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Visual prompt ───────────────────────────────────────────────────────────
// The old category-templated generateVisualPrompt (which deliberately stripped
// specifics and never named the country) is gone — the grounded buildVisualBrief
// inlined above replaces it, so a cover is contextually correct.

// ─── Step 2a: fal Seedream 4.5 — the master-resolution provider ──────────────
//
// The only one of the three that takes an explicit width and height, and the
// only one that can render the 2160x3840 a vertical 1080p master deserves.
// Submits to fal's queue and polls; a still at this size takes a few seconds.

const FAL_IMAGE_MODELS = [
  'fal-ai/bytedance/seedream/v4.5/text-to-image',
  'fal-ai/bytedance/seedream/v4/text-to-image',
];
const FAL_POLL_MS = 2000;
const FAL_TIMEOUT_MS = 90_000;

async function generateWithFal(
  prompt: string, apiKey: string, width: number, height: number,
): Promise<Uint8Array> {
  const size = fitSeedream(width, height);
  const auth = { Authorization: `Key ${apiKey}` };
  let lastErr = '';

  for (const model of FAL_IMAGE_MODELS) {
    try {
      console.log(`[fal] ${model} ${size.width}x${size.height}`);
      const submit = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, image_size: size, num_images: 1 }),
      });
      if (!submit.ok) {
        lastErr = `fal submit ${submit.status}: ${(await submit.text()).substring(0, 200)}`;
        console.error(`[fal] ${lastErr}`);
        continue;
      }
      const q = await submit.json();
      const statusUrl = String(q.status_url || '');
      const responseUrl = String(q.response_url || '');
      if (!statusUrl || !responseUrl) { lastErr = 'fal returned no queue urls'; continue; }

      const deadline = Date.now() + FAL_TIMEOUT_MS;
      let done = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, FAL_POLL_MS));
        const st = await fetch(statusUrl, { headers: auth });
        if (!st.ok) { lastErr = `fal status ${st.status}`; break; }
        const sd = await st.json();
        if (String(sd.status || '') === 'COMPLETED') { done = true; break; }
      }
      if (!done) { lastErr = lastErr || 'fal timed out'; console.error(`[fal] ${lastErr}`); continue; }

      const rr = await fetch(responseUrl, { headers: auth });
      if (!rr.ok) { lastErr = `fal result ${rr.status}`; continue; }
      const result = await rr.json();
      const imgUrl = String(result?.images?.[0]?.url || '');
      if (!imgUrl) { lastErr = 'fal returned no image url'; continue; }

      const img = await fetch(imgUrl);
      if (!img.ok) { lastErr = `fal image download ${img.status}`; continue; }
      const buf = await img.arrayBuffer();
      if (buf.byteLength < 5000) { lastErr = `fal image too small (${buf.byteLength}b)`; continue; }
      console.log(`[fal] ${model} success: ${buf.byteLength} bytes at ${size.width}x${size.height}`);
      return new Uint8Array(buf);
    } catch (e) {
      lastErr = `${model}: ${(e as Error).message}`;
      console.error(`[fal] ${lastErr}`);
    }
  }
  throw new Error(lastErr || 'ALL_FAL_MODELS_FAILED');
}

// ─── Step 2b: HuggingFace (current router endpoint, best-effort / possibly free) ─

async function generateWithHuggingFace(
  prompt: string, apiKey: string, width: number, height: number,
): Promise<Uint8Array> {
  const models = [
    'black-forest-labs/FLUX.1-schnell',
    'stabilityai/stable-diffusion-xl-base-1.0',
  ];

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);
    try {
      console.log(`[hf] Trying model=${model} ${width}x${height}`);
      // Current endpoint (api-inference.huggingface.co was retired).
      const res = await fetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Wait-For-Model': 'true',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: { width, height },
        }),
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[hf] ${model} failed (${res.status}): ${errText.substring(0, 200)}`);
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('image')) {
        const body = await res.text();
        console.error(`[hf] non-image response: ${contentType} — ${body.substring(0, 100)}`);
        continue;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength < 1000) {
        console.error(`[hf] response too small: ${buffer.byteLength} bytes`);
        continue;
      }

      console.log(`[hf] success with ${model}: ${buffer.byteLength} bytes`);
      return new Uint8Array(buffer);
    } catch (e) {
      clearTimeout(timer);
      console.error(`[hf] ${model} exception: ${(e as Error).message}`);
      continue;
    }
  }
  throw new Error('ALL_HF_MODELS_FAILED');
}

// ─── Step 2b: OpenAI gpt-image-1 (reliable; returns base64) ───────────────────

async function generateWithOpenAI(
  prompt: string, apiKey: string, size: string, quality: 'medium' | 'high' = 'medium',
): Promise<Uint8Array> {
  console.log(`[openai] Trying gpt-image-1 ${size} q=${quality}...`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt,
      n: 1,
      size: size,
      quality,
      // no response_format — gpt-image-1 always returns b64_json
    }),
  });

  if (!res.ok) {
    const errData = await res.text();
    throw new Error(`OpenAI ${res.status}: ${errData.substring(0, 300)}`);
  }

  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) {
    console.log(`[openai] gpt-image-1 success (b64)`);
    return b64ToBytes(item.b64_json);
  }
  // Resilience: if a future model returns a URL, fetch it.
  if (item?.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error(`OpenAI image download failed: ${imgRes.status}`);
    return new Uint8Array(await imgRes.arrayBuffer());
  }
  throw new Error('OpenAI returned no image data');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    let persistPostId = '';
    const body = await req.json();

    const rawPrompt = String(body.raw_prompt || body.rawPrompt || '').trim();
    const isRaw = rawPrompt.length > 0;

    const aspect = normalizeAspect(body.aspect);
    const dims = dimsForAspect(aspect);
    const master = MASTER_DIMS[aspect];
    // The old clamp was 1024x1536 — it silently capped every request at the
    // draft size even when the caller asked for a master. Now the cap is the
    // largest thing any provider here will render.
    const reqW = Number.isFinite(body.width)  ? Math.max(256, Math.min(4096, Math.round(body.width)))  : 0;
    const reqH = Number.isFinite(body.height) ? Math.max(256, Math.min(4096, Math.round(body.height))) : 0;
    const fluxW = reqW || dims.fluxW;
    const fluxH = reqH || dims.fluxH;
    // What we ask the master-resolution provider for.
    const bigW = reqW || master.w;
    const bigH = reqH || master.h;

    let prompt: string;

    if (isRaw) {
      prompt = rawPrompt;
      console.log(`[mode] raw/campaign · aspect=${aspect} · ${fluxW}x${fluxH}`);
    } else {
      let title    = String(body.title || '');
      let summary  = String(body.summary || body.excerpt || '');
      let category = String(body.category || 'news');
      let county   = (typeof body.county === 'string' ? body.county : null) as string | null;
      const explicitPrompt = String(body.prompt || '').trim();

      // Regenerate-from-id: load the article (this is what makes the Articole
      // "regenerate cover" button work — it previously sent only post_id, which
      // the function ignored → 400) and persist the result back at the end.
      const postId = String(body.post_id || '').trim();
      if (postId) {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: row } = await sb.from('blog_posts')
          .select('title_ro, title_en, summary_ro, excerpt_ro, category, county')
          .eq('id', postId).single();
        if (row) {
          title    = row.title_ro || row.title_en || title;
          summary  = row.summary_ro || row.excerpt_ro || summary;
          category = row.category || category;
          county   = row.county ?? county;
          persistPostId = postId;
        }
      }

      if (!title) {
        return new Response(JSON.stringify({ error: 'Title is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // GROUNDED prompt — the shared visual brief names the real country and the
      // Transylvanian county, so the image is contextually correct (the Romanian
      // Parliament, not a foreign one). An explicit editor-refined prompt wins.
      prompt = explicitPrompt || (await buildVisualBrief({ title, summary, category, county })).photo_prompt;
    }

    const useFluxW = isRaw ? fluxW : 1024;
    const useFluxH = isRaw ? fluxH : 576;
    const useOaiSize = isRaw ? dims.oaiSize : '1536x1024';

    const hfKey     = Deno.env.get('HUGGING_FACE_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const falKey    = Deno.env.get('FAL_KEY');
    let imageBytes!: Uint8Array;
    let ext       = 'png';
    let lastError = '';
    let success   = false;
    let provider  = '';
    let renderedAt = '';

    // TWO LADDERS, AND THE ORDER IS THE POINT.
    //
    // A campaign still is one picture that will fill a 1080p frame for four
    // seconds in front of an audience; it gets the best provider first and the
    // free one last. An article cover is a thumbnail, generated in bulk by the
    // RSS scraper, and 1024px from the free tier is genuinely the right answer
    // for one — putting fal first there would spend $0.04 per scraped article
    // to make a picture nobody views above 400px wide.
    const wantMaster = isRaw;

    // Step 2a: fal Seedream at master resolution (campaign only)
    if (wantMaster && falKey && !success) {
      try {
        imageBytes = await generateWithFal(prompt, falKey, bigW, bigH);
        const fitted = fitSeedream(bigW, bigH);
        renderedAt = `${fitted.width}x${fitted.height}`;
        ext = 'jpg'; provider = 'fal/seedream'; success = true;
      } catch (e) {
        lastError = `fal: ${(e as Error).message}`;
        console.warn(lastError);
      }
    }

    // Step 2b: OpenAI gpt-image-1 — 'high' for a campaign still, 'medium' for
    // a thumbnail. The old code asked for 'medium' every time, including for
    // the pictures that end up on screen.
    if (!success && openaiKey) {
      try {
        imageBytes = await generateWithOpenAI(prompt, openaiKey, useOaiSize, wantMaster ? 'high' : 'medium');
        renderedAt = useOaiSize;
        ext = 'png'; provider = 'openai/gpt-image-1'; success = true;
      } catch (e) {
        lastError += ` | OpenAI: ${(e as Error).message}`;
        console.error(lastError);
      }
    }

    // Step 2c: HuggingFace — raw/campaign stills ONLY. Article covers never fall
    // back to draft-tier FLUX: a garbled cover is worse than none (the editor
    // offers a real Unsplash photo instead), so a cover is a clean gpt-image-1
    // or a clean error.
    if (hfKey && !success && isRaw) {
      try {
        imageBytes = await generateWithHuggingFace(prompt, hfKey, useFluxW, useFluxH);
        renderedAt = `${useFluxW}x${useFluxH}`;
        ext = 'jpg'; provider = 'hf/flux-schnell'; success = true;
      } catch (e) {
        lastError += ` | HF: ${(e as Error).message}`;
        console.warn(lastError);
      }
    }

    if (!success) {
      return new Response(JSON.stringify({
        error: 'IMAGE_GENERATION_FAILED',
        details: lastError || 'No image provider configured (need HUGGING_FACE_API_KEY or OPENAI_API_KEY)',
      }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: upload to Supabase Storage
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const folder      = isRaw ? 'campaign' : 'covers';
    const fileName    = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';

    const { error: uploadErr } = await supabaseAdmin.storage
      .from('blog-images')
      .upload(fileName, imageBytes, { contentType, upsert: false });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: urlData } = supabaseAdmin.storage
      .from('blog-images')
      .getPublicUrl(fileName);

    // Regenerate-from-id: write the new cover straight back onto the article.
    if (persistPostId) {
      try {
        await supabaseAdmin.from('blog_posts')
          .update({ cover_image: urlData.publicUrl, cover_image_credit: 'Imagine generată cu inteligență artificială' })
          .eq('id', persistPostId);
      } catch (e) { console.warn(`[persist] ${(e as Error).message}`); }
    }

    console.log(`[done] Image stored: ${urlData.publicUrl}`);

    return new Response(JSON.stringify({
      success: true,
      publicUrl: urlData.publicUrl,
      fileName,
      mode: isRaw ? 'campaign' : 'cover',
      // Say which model made it and at what size. When a still looks soft you
      // want to know whether it fell back to the draft tier, not guess.
      provider,
      renderedAt,
      prompt,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[error]', (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
