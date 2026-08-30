// supabase/functions/render-worker/index.ts
//
// The bridge between Studio and the deterministic render worker.
//
// WHY THIS EXISTS AT ALL
//
// The worker's token must never reach the browser. Everything a browser
// receives is readable by anyone who opens developer tools, and a leaked token
// lets a stranger queue three-hour renders on your Railway bill. So the browser
// talks to this function, this function talks to the worker, and the token
// stays on servers the whole way.
//
// The finished FILE is the one exception, and it is deliberate: proxying a
// 300 MB master through an edge function is not something an edge function can
// do. Instead the worker mints a one-time key per job, this function hands the
// browser a URL carrying that key, and the download goes straight from Railway
// to the browser. The key is scoped to a single job, only appears once that job
// has finished, and dies when the job is swept — the same shape as a storage
// signed URL.
//
// Requires env:
//   RENDER_WORKER_URL     https://your-service.up.railway.app
//   RENDER_WORKER_TOKEN   the same value set on the Railway service
//
// Actions:
//   { action: 'create', timeline }  -> { id, state }
//   { action: 'status', job_id }    -> { state, progress, qc, downloadUrl }
//   { action: 'health' }            -> { configured, ok, queued }
//   { action: 'inspect', clips, referenceImage?, spec?, samples? }
//                                   -> { takes[], best, anyAccepted, verdict }

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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

interface WorkerJob {
  id?: string;
  state?: string;
  progress?: unknown;
  error?: string | null;
  qc?: unknown;
  seconds?: number | null;
  renderSeconds?: number | null;
  downloadKey?: string | null;
  path?: string | null;
}

/** Longest clip end in the timeline, in seconds. Used for the cost guard. */
function timelineSeconds(timeline: unknown): number {
  if (typeof timeline !== 'object' || timeline === null) return 0;
  const tl = timeline as Record<string, unknown>;
  const timebase = tl.timebase as Record<string, unknown> | undefined;
  const fps = timebase?.fps as Record<string, unknown> | undefined;
  const n = Number(fps?.n ?? 0);
  const d = Number(fps?.d ?? 1);
  const frames = Number(tl.duration ?? 0);
  if (!n || !frames) return 0;
  return (frames * d) / n;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const base = (Deno.env.get('RENDER_WORKER_URL') || '').replace(/\/$/, '');
  const token = Deno.env.get('RENDER_WORKER_TOKEN') || '';

  if (!base || !token) {
    return json({
      configured: false,
      message:
        'Render worker not configured. Set RENDER_WORKER_URL and RENDER_WORKER_TOKEN in this ' +
        'function\'s secrets. The token must match the one on the Railway service.',
    }, 200);
  }

  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'create');

    if (action === 'health') {
      // /health needs no token, but going through the worker's own URL proves
      // the function can actually reach it — which is the thing that breaks.
      const res = await fetch(`${base}/health`);
      const payload = await res.json().catch(() => ({}));
      return json({ configured: true, ok: res.ok, worker: payload });
    }

    if (action === 'status') {
      const jobId = String(body.job_id || '').trim();
      if (!jobId) return json({ error: 'job_id is required' }, 400);

      const res = await fetch(`${base}/jobs/${encodeURIComponent(jobId)}`, { headers: auth });
      const job = (await res.json().catch(() => ({}))) as WorkerJob;
      if (!res.ok) return json({ error: job?.error || `Worker returned ${res.status}` }, 200);

      // The key never reaches the browser on its own — only inside a complete
      // URL for this one job's finished file.
      const downloadUrl = job.downloadKey && job.path
        ? `${base}${job.path}?key=${encodeURIComponent(job.downloadKey)}`
        : null;

      return json({
        configured: true,
        id: job.id,
        state: job.state,
        progress: job.progress ?? null,
        error: job.error ?? null,
        qc: job.qc ?? null,
        seconds: job.seconds ?? null,
        renderSeconds: job.renderSeconds ?? null,
        downloadUrl,
      });
    }

    // ── INSPECT ────────────────────────────────────────────────────────────
    // Hands a batch of generated takes to the worker's vision layer and returns
    // which of them is actually usable. Studio calls this after generating N
    // takes of the same shot, before any of them reach the timeline.
    if (action === 'inspect') {
      const clips = Array.isArray(body.clips) ? body.clips : [];
      if (!clips.length) return json({ error: 'clips is required' }, 400);

      const res = await fetch(`${base}/inspect`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          clips,
          referenceImage: body.referenceImage ?? body.reference_image ?? null,
          spec: body.spec ?? null,
          samples: body.samples ?? null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: payload?.error || `Worker returned ${res.status}` }, 200);
      return json({ configured: true, ...payload });
    }

    if (action === 'create') {
      const timeline = body.timeline;
      if (!timeline || typeof timeline !== 'object') {
        return json({ error: 'timeline is required' }, 400);
      }

      // Second cost guard, on the server. The worker has its own; this one
      // stops a runaway before it crosses the network at all.
      const cap = Number(Deno.env.get('MAX_RENDER_SECONDS') || 600);
      const seconds = timelineSeconds(timeline);
      if (seconds > cap) {
        return json({
          error: `Render refused: the job is ${Math.round(seconds)}s, over the ${cap}s cap.`,
          seconds, cap,
        }, 400);
      }

      const res = await fetch(`${base}/render`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ timeline }),
      });
      const job = await res.json().catch(() => ({}));
      if (!res.ok) {
        return json({ error: job?.error || `Worker returned ${res.status}`, problems: job?.problems ?? null }, 200);
      }
      return json({ configured: true, ...job });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    // A worker that is asleep, redeploying or unreachable must read as a clear
    // message, not as a generic edge-function failure.
    return json({
      error: `Could not reach the render worker: ${(e as Error).message}`,
    }, 200);
  }
});
