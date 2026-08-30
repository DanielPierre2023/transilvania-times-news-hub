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
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── admin gate (inlined from _shared/requireAdmin.ts, kept self-contained so
//    this file can be pasted straight into the Supabase dashboard editor) ────
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
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

    // Shotstack authenticates with x-api-key. Honour an explicit setting, but
    // do not make a correct deploy depend on remembering to set it.
    const provider = String(body.provider || '').toLowerCase();
    const explicitStyle = (Deno.env.get('RENDER_API_AUTH_STYLE') || '').toLowerCase();
    const authStyle = explicitStyle || (provider === 'shotstack' ? 'apikey' : 'bearer');
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

    // ── cost guard ────────────────────────────────────────────────────────
    // Every render is billed by the minute. A malformed spec with a runaway
    // length bills for it just the same, so the length is checked here rather
    // than trusted from the browser. MAX_RENDER_SECONDS overrides the default.
    const capSeconds = Number(Deno.env.get('MAX_RENDER_SECONDS') || 300);
    const seconds = specDurationSeconds(spec);
    if (seconds > capSeconds) {
      return json({
        error: `Render refused: the job is ${Math.round(seconds)}s, over the ${capSeconds}s cap. ` +
               `Raise MAX_RENDER_SECONDS if this is intentional.`,
        seconds,
        cap: capSeconds,
      }, 400);
    }

    const res = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(spec) });
    return passthrough(res, { billedSeconds: seconds });
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

/**
 * Longest clip end in the submitted spec, in seconds. Understands both shapes:
 * Shotstack (timeline.tracks[].clips[] with start/length) and Creatomate
 * (source.elements[] with time/duration). Anything unrecognised measures as 0
 * and is allowed through — the guard exists to catch a runaway, not to become
 * a second validator that rejects valid work.
 */
function specDurationSeconds(spec: unknown): number {
  if (typeof spec !== 'object' || spec === null) return 0;
  const root = spec as Record<string, unknown>;
  let max = 0;

  const timeline = root.timeline as Record<string, unknown> | undefined;
  const tracks = timeline?.tracks;
  if (Array.isArray(tracks)) {
    for (const track of tracks) {
      const clips = (track as Record<string, unknown>)?.clips;
      if (!Array.isArray(clips)) continue;
      for (const clip of clips) {
        const c = clip as Record<string, unknown>;
        const end = Number(c.start || 0) + Number(c.length || 0);
        if (Number.isFinite(end)) max = Math.max(max, end);
      }
    }
  }

  const source = root.source as Record<string, unknown> | undefined;
  const elements = source?.elements;
  if (Array.isArray(elements)) {
    for (const element of elements) {
      const e = element as Record<string, unknown>;
      const end = Number(e.time || 0) + Number(e.duration || 0);
      if (Number.isFinite(end)) max = Math.max(max, end);
    }
  }

  return max;
}

async function passthrough(res: Response, extra: Record<string, unknown> = {}): Promise<Response> {
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  // Always 200 to the caller so the Studio can read the provider's actual
  // response (including validation errors) instead of a hidden non-2xx.
  return json({ ok: res.ok, providerStatus: res.status, body: parsed, ...extra }, 200);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
