// supabase/functions/render-video/index.ts
//
// Marketing Studio — PLUGGABLE cloud render path (Creatomate-ready).
// The Studio renders in-browser for free by default. Set two secrets to enable
// guaranteed server-side MP4:
//     RENDER_API_URL   e.g. https://api.creatomate.com/v1/renders
//     RENDER_API_KEY   your provider key
// Optional: RENDER_API_AUTH_STYLE = 'bearer' (default) | 'apikey'
//
// Two actions (cloud renders are asynchronous):
//   • create:  { spec }      -> POST spec to RENDER_API_URL, returns the job(s)
//   • poll:    { poll_id }   -> GET  RENDER_API_URL/{poll_id}, returns status/url
//
// Provider-agnostic: it forwards `spec` verbatim and passes the provider
// response straight back, so you can point it at Creatomate / Shotstack /
// JSON2Video without a code change.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const apiUrl = Deno.env.get('RENDER_API_URL');
    const apiKey = Deno.env.get('RENDER_API_KEY');

    if (!apiUrl || !apiKey) {
      return json({
        configured: false,
        message: 'Cloud render not configured. The Studio renders in your browser instead. To enable cloud MP4, set RENDER_API_URL and RENDER_API_KEY in the render-video function secrets.',
      }, 200);
    }

    const authStyle = (Deno.env.get('RENDER_API_AUTH_STYLE') || 'bearer').toLowerCase();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authStyle === 'apikey') headers['x-api-key'] = apiKey;
    else headers['Authorization'] = `Bearer ${apiKey}`;

    // Poll an existing render.
    const pollId = String(body.poll_id || '').trim();
    if (pollId) {
      const res = await fetch(`${apiUrl.replace(/\/$/, '')}/${encodeURIComponent(pollId)}`, { headers });
      return passthrough(res);
    }

    // Create a render.
    const spec = body.spec;
    if (!spec) return json({ error: 'spec (or poll_id) is required' }, 400);
    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(spec) });
    return passthrough(res);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

async function passthrough(res: Response): Promise<Response> {
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  // Always 200 to the caller so the Studio can read the provider's actual
  // response (including validation errors) instead of a hidden non-2xx.
  return json({ ok: res.ok, providerStatus: res.status, body: parsed }, 200);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
