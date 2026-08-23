// supabase/functions/generate-motion/index.ts
//
// Marketing Studio — real image-to-video motion via fal.ai (Kling).
// Turns a still image into a genuinely moving 5-10s clip.
//
// Actions (fal renders asynchronously — submit, then poll):
//   { action:'create', image_url, prompt?, duration? ('5'|'10'), model? }
//       -> { request_id, status_url, response_url }
//   { action:'poll', status_url, response_url }
//       -> { status: 'IN_QUEUE'|'IN_PROGRESS'|'COMPLETED'|..., queue_position? }
//          on COMPLETED: downloads the video, stores it in studio-assets/motion/
//          and returns { status:'COMPLETED', publicUrl }
//
// Env: FAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_MODEL = 'fal-ai/kling-video/v2.1/standard/image-to-video';
const DEFAULT_PROMPT =
  'Subtle cinematic motion: gentle camera drift, natural movement in the scene (drifting mist, moving clouds, flickering light, people or foliage moving softly). Preserve the composition and color grade of the original photograph. No text.';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'create');
    const falKey = Deno.env.get('FAL_KEY');
    if (!falKey) {
      return json({ configured: false, message: 'FAL_KEY not set — image-to-video is disabled. Add a fal.ai key to the generate-motion function secrets.' });
    }
    const auth = { Authorization: `Key ${falKey}` };

    if (action === 'create') {
      const imageUrl = String(body.image_url || '').trim();
      if (!imageUrl) return json({ error: 'image_url is required' }, 400);
      const model = sanitizeModel(String(body.model || DEFAULT_MODEL));
      const duration = String(body.duration || '5') === '10' ? '10' : '5';
      const prompt = String(body.prompt || '').trim() || DEFAULT_PROMPT;

      const res = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, prompt, duration }),
      });
      if (!res.ok) return json({ error: `fal ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      return json({
        request_id: String(data.request_id || ''),
        status_url: String(data.status_url || ''),
        response_url: String(data.response_url || ''),
      });
    }

    if (action === 'poll') {
      const statusUrl = String(body.status_url || '').trim();
      const responseUrl = String(body.response_url || '').trim();
      if (!isFalUrl(statusUrl) || !isFalUrl(responseUrl)) {
        return json({ error: 'status_url/response_url must be queue.fal.run URLs from the create step' }, 400);
      }

      const st = await fetch(statusUrl, { headers: auth });
      if (!st.ok) return json({ error: `fal status ${st.status}: ${(await st.text()).substring(0, 200)}` }, 502);
      const stData = await st.json();
      const status = String(stData.status || '');

      if (status !== 'COMPLETED') {
        return json({ status, queue_position: stData.queue_position ?? null });
      }

      // Completed → fetch result, store the clip in our own storage.
      const rr = await fetch(responseUrl, { headers: auth });
      if (!rr.ok) return json({ error: `fal result ${rr.status}: ${(await rr.text()).substring(0, 200)}` }, 502);
      const result = await rr.json();
      const videoUrl = String(result?.video?.url || result?.video_url || '');
      if (!videoUrl) return json({ error: 'fal returned no video url: ' + JSON.stringify(result).substring(0, 200) }, 502);

      const vid = await fetch(videoUrl);
      if (!vid.ok) return json({ error: `video download failed (${vid.status})` }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());

      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fileName = `motion/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
      const { error: upErr } = await supabase.storage.from('studio-assets')
        .upload(fileName, bytes, { contentType: 'video/mp4', upsert: false });
      if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);

      const { data: pub } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
      return json({ status: 'COMPLETED', publicUrl: pub.publicUrl, fileName });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function sanitizeModel(m: string): string {
  // allow only fal model paths like fal-ai/kling-video/v2.1/standard/image-to-video
  return /^[a-z0-9./-]+$/i.test(m) ? m : DEFAULT_MODEL;
}
function isFalUrl(u: string): boolean {
  try { return new URL(u).hostname === 'queue.fal.run'; } catch { return false; }
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
