// supabase/functions/generate-image-edit/index.ts
//
// Marketing Studio — IMAGE-TO-IMAGE (identity-preserving) generation.
//
// WHY THIS EXISTS (root cause of "I uploaded a picture but the result is highly
// inaccurate"): generate-cover-image is TEXT-TO-IMAGE — it never sees the
// uploaded photo, so the output is an unrelated stranger. This function calls
// OpenAI's images/edits endpoint with gpt-image-1, which CONDITIONS on the
// reference image(s), so the generated image actually reflects what you uploaded.
//
// Input:  { image_urls: string[] (1-16)  |  image_url: string,
//           prompt: string, aspect?: '1:1'|'4:5'|'9:16'|'16:9', quality?, size? }
// Output: { success, publicUrl, fileName, prompt, mode:'edit' }
//
// Env: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// gpt-image-1 accepts only three sizes (+ auto). Map the studio aspect to the
// closest orientation.
function sizeForAspect(aspect: string): string {
  switch (aspect) {
    case '1:1':  return '1024x1024';
    case '4:5':
    case '9:16': return '1024x1536';
    case '16:9': return '1536x1024';
    default:     return 'auto';
  }
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extFromContentType(ct: string): string {
  if (/png/i.test(ct)) return 'png';
  if (/webp/i.test(ct)) return 'webp';
  return 'jpg';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));

    const rawUrls: string[] = Array.isArray(body.image_urls)
      ? body.image_urls.map(String).filter(Boolean)
      : (body.image_url ? [String(body.image_url)] : []);
    const urls = rawUrls.slice(0, 16);   // gpt-image-1 accepts up to 16 references
    const prompt = String(body.prompt || '').trim();
    const aspect = String(body.aspect || '16:9');
    const size = String(body.size || '').trim() || sizeForAspect(aspect);
    const quality = ['low', 'medium', 'high', 'auto'].includes(String(body.quality)) ? String(body.quality) : 'high';

    if (urls.length === 0) return json({ error: 'image_urls (sau image_url) este obligatoriu — o imagine de referință de condiționat.' }, 400);
    if (!prompt) return json({ error: 'prompt este obligatoriu — descrie ce vrei să faci cu imaginea de referință.' }, 400);

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'OPENAI_API_KEY nu este setată — necesară pentru editarea imaginii (gpt-image-1).' }, 400);

    // Build a multipart form with the reference image(s). gpt-image-1 takes
    // multiple references under the repeated `image[]` field.
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('size', size);
    form.append('quality', quality);
    for (let i = 0; i < urls.length; i++) {
      const r = await fetch(urls[i]);
      if (!r.ok) return json({ error: `Nu am putut încărca imaginea de referință ${i + 1} (${r.status}).` }, 400);
      const blob = await r.blob();
      if (blob.size < 1000) return json({ error: `Imaginea de referință ${i + 1} pare goală.` }, 400);
      const ext = extFromContentType(blob.type || r.headers.get('content-type') || '');
      form.append('image[]', blob, `reference-${i + 1}.${ext}`);
    }

    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },   // multipart boundary set by fetch
      body: form,
    });
    if (!res.ok) {
      const txt = await res.text();
      return json({ error: `OpenAI images/edits ${res.status}: ${txt.substring(0, 300)}` }, 502);
    }
    const data = await res.json();
    const item = data?.data?.[0];
    let bytes: Uint8Array | null = null;
    if (item?.b64_json) bytes = b64ToBytes(item.b64_json);
    else if (item?.url) {
      const img = await fetch(item.url);
      if (!img.ok) return json({ error: `OpenAI image download failed: ${img.status}` }, 502);
      bytes = new Uint8Array(await img.arrayBuffer());
    }
    if (!bytes || bytes.byteLength < 1000) return json({ error: 'OpenAI a returnat o imagine goală.' }, 502);

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const fileName = `edits/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const { error: upErr } = await supabase.storage.from('studio-assets')
      .upload(fileName, bytes, { contentType: 'image/png', upsert: false });
    if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

    const { data: pub } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
    return json({ success: true, publicUrl: pub.publicUrl, fileName, prompt, mode: 'edit' });
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
