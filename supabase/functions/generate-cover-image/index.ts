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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ─── Step 1: Gemini generates proper visual prompt (classic cover mode) ────────

async function generateVisualPrompt(
  title: string,
  excerpt: string,
  category: string,
  summary: string,
): Promise<string> {
  const geminiKey = Deno.env.get('GEMINI_API_KEY');

  if (geminiKey) {
    const context = (summary || excerpt || '').substring(0, 400);

    const systemInstruction = `You are an expert at writing image generation prompts for editorial news photography.

Given a news article's category, title, and summary, write a concise photographic scene description that visually represents the story.

RULES:
- Describe the SCENE — not the specific named people or text
- Use concrete visual elements: setting, mood, lighting, objects, composition
- Write in English regardless of the article's language
- Output ONLY the prompt text — no quotes, no newlines, no explanation
- Length: 40-80 words

CATEGORY VISUAL GUIDANCE:
- education: students, classroom, books, desks, school building, certificates, blackboard
- politics: government building, parliament, flags, official ceremony, formal meeting room
- sports: athlete in action, stadium, field, competition, trophy, crowd
- business: office, professionals, meeting room, financial district, urban commerce
- technology: computer screens, server room, digital devices, code on screen, innovation lab
- health: hospital corridor, medical professional, clinic, stethoscope, healthcare setting
- culture: theater stage, museum gallery, art installation, performance, heritage building
- travel: natural landscape, tourist destination, local architecture, scenic view
- news: city street, public space, community gathering, urban life
- opinion: editorial desk, books, contemplative scene, reading, writing`;

    const userMessage = `Category: ${category || 'news'}
Title: ${title}
Summary: ${context}

Write the image generation prompt:`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents: [{ role: 'user', parts: [{ text: userMessage }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
          }),
        }
      );
      const raw = await res.text();
      if (res.ok) {
        const data = JSON.parse(raw);
        const generated = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
        if (generated.length > 20) {
          console.log(`[prompt] Gemini: "${generated.substring(0, 120)}"`);
          return generated;
        }
      } else {
        console.warn(`[prompt] Gemini failed ${res.status}: ${raw.substring(0, 100)}`);
      }
    } catch (e) {
      console.warn(`[prompt] Gemini error: ${(e as Error).message}`);
    }
  }

  const subject = `${title} ${excerpt}`.substring(0, 120).replace(/[^\w\s-]/g, '');
  const fallback = `Professional news photography, high-detail, editorial style, regarding: ${subject}`;
  console.log(`[prompt] Fallback: "${fallback.substring(0, 100)}"`);
  return fallback;
}

// ─── Step 2a: HuggingFace (current router endpoint, best-effort / possibly free) ─

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

async function generateWithOpenAI(prompt: string, apiKey: string, size: string): Promise<Uint8Array> {
  console.log(`[openai] Trying gpt-image-1 ${size}...`);
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
      quality: 'medium',
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
    const body = await req.json();

    const rawPrompt = String(body.raw_prompt || body.rawPrompt || '').trim();
    const isRaw = rawPrompt.length > 0;

    const aspect = normalizeAspect(body.aspect);
    const dims = dimsForAspect(aspect);
    const fluxW = Number.isFinite(body.width)  ? Math.max(256, Math.min(1024, Math.round(body.width)))  : dims.fluxW;
    const fluxH = Number.isFinite(body.height) ? Math.max(256, Math.min(1536, Math.round(body.height))) : dims.fluxH;

    let prompt: string;

    if (isRaw) {
      prompt = rawPrompt;
      console.log(`[mode] raw/campaign · aspect=${aspect} · ${fluxW}x${fluxH}`);
    } else {
      const title    = (body.title    || '') as string;
      const excerpt  = (body.excerpt  || '') as string;
      const summary  = (body.summary  || '') as string;
      const category = (body.category || 'news') as string;

      if (!title) {
        return new Response(JSON.stringify({ error: 'Title is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      prompt = await generateVisualPrompt(title, excerpt, category, summary);
    }

    const useFluxW = isRaw ? fluxW : 1024;
    const useFluxH = isRaw ? fluxH : 576;
    const useOaiSize = isRaw ? dims.oaiSize : '1536x1024';

    const hfKey     = Deno.env.get('HUGGING_FACE_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    let imageBytes!: Uint8Array;
    let ext       = 'png';
    let lastError = '';
    let success   = false;

    // Step 2a: HuggingFace (free when available; best-effort)
    if (hfKey && !success) {
      try {
        imageBytes = await generateWithHuggingFace(prompt, hfKey, useFluxW, useFluxH);
        ext = 'jpg';
        success = true;
      } catch (e) {
        lastError = `HF: ${(e as Error).message}`;
        console.warn(lastError);
      }
    }

    // Step 2b: OpenAI gpt-image-1 (reliable)
    if (!success && openaiKey) {
      try {
        imageBytes = await generateWithOpenAI(prompt, openaiKey, useOaiSize);
        ext = 'png';
        success = true;
      } catch (e) {
        lastError += ` | OpenAI: ${(e as Error).message}`;
        console.error(lastError);
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

    console.log(`[done] Image stored: ${urlData.publicUrl}`);

    return new Response(JSON.stringify({
      success: true,
      publicUrl: urlData.publicUrl,
      fileName,
      mode: isRaw ? 'campaign' : 'cover',
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
