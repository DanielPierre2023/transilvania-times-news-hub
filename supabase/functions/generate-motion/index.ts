// supabase/functions/generate-motion/index.ts
//
// Marketing Studio — the Kling engine, driven from your own Studio.
//
// REWRITTEN 30 Aug 2026 for Kling v3. The previous version defaulted to o3 and
// carried one assumption that cost us a whole film.
//
// ── THE FOUR HARD FACTS THIS VERSION IS BUILT ON ───────────────────────────
//
// Read from fal's own published schemas on 30 Aug 2026, not inferred:
//
//  1. v3 names the start frame `start_image_url`. o3 and v2.1 name it
//     `image_url`. Sending the wrong one is a 422 at runtime, not a build
//     error, which is why the field name is declared per model below instead
//     of being spelled once and hoped over.
//
//  2. o3 HAS NO `negative_prompt` AND NO `cfg_scale`. The previous version
//     knew this and quietly dropped both fields for o3 — which was the default
//     model. So every clip Studio ever made was generated with the anti-drift
//     negative prompt thrown away before it left this function. That is why a
//     golden-hour still came back as a cold blue night: the instruction that
//     forbade it was never sent. v3 accepts both. This is the single biggest
//     reason to move.
//
//  3. v3's `generate_audio` DEFAULTS TO TRUE. o3's defaults to false. Studio
//     dubs its own voiceover over every clip, so leaving v3's default alone
//     would buy audio nobody hears at $0.168/s instead of $0.112/s — 50% more,
//     forever, silently. `false` is now always sent explicitly.
//
//  4. v3's `negative_prompt` has a non-empty DEFAULT: "blur, distort, and low
//     quality". Sending our own REPLACES it, so ours carries those terms too.
//
// ── THE END FRAME ───────────────────────────────────────────────────────────
//
// `end_image_url` set to the same still as the start makes a seamless loop, and
// it is genuinely the right tool for an anchor plate that must repeat behind a
// voiceover. It is the wrong tool for b-roll: it tells the model the last frame
// must equal the first, and the cheapest way to satisfy that is to not move.
// Measured on the five shots of the last delivered film: 0.00% coherent camera
// movement, every one, with shimmer between 1.08 and 2.32. The loop is now
// opt-in per job and off for b-roll.
//
// Actions:
//   { action:'models' }
//       -> the catalogue, so the Studio dropdown needs no frontend deploy
//   { action:'create', image_url, prompt?, negative_prompt?, cfg_scale?,
//     duration?, model?, end_image_url?, generate_audio?, multi_prompt?,
//     elements?, shot_type?, takes? }
//       -> { jobs:[{request_id,status_url,response_url}], model, seconds,
//            estimated_usd, sent }   ('sent' is the exact payload — no guessing)
//   { action:'lipsync', video_url, audio_url, engine?, guidance_scale? }
//   { action:'poll', status_url, response_url }
//       -> { status, queue_position? } | { status:'COMPLETED', publicUrl }
//
// Env: FAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── MODEL CATALOGUE ─────────────────────────────────────────────────────────
// Every field a model does NOT declare is never sent. fal rejects unknown
// fields with a 422, so "spray every option and hope" is not an option; this
// table is the contract.
type Caps = {
  startField: 'image_url' | 'start_image_url';
  endImage: boolean;
  negative: boolean;
  cfg: boolean;
  audio: boolean;          // model accepts generate_audio at all
  audioDefaultsOn: boolean; // ...and defaults it to ON, so false must be sent
  multiPrompt: boolean;
  elements: boolean;
  shotType: boolean;
};
type KlingModel = {
  id: string;
  label: string;
  usdPerSecond: number;      // audio OFF
  usdPerSecondAudio: number; // audio ON
  minSeconds: number;
  maxSeconds: number;
  fixedDurations: string[] | null; // v2.1 knows only "5" and "10"
  caps: Caps;
  note: string;
};

const V3_CAPS: Caps = {
  startField: 'start_image_url',
  endImage: true, negative: true, cfg: true,
  audio: true, audioDefaultsOn: true,
  multiPrompt: true, elements: true, shotType: true,
};
const O3_CAPS: Caps = {
  startField: 'image_url',
  endImage: true, negative: false, cfg: false,
  audio: true, audioDefaultsOn: false,
  multiPrompt: true, elements: false, shotType: true,
};

const MODELS: Record<string, KlingModel> = {
  'v3-pro': {
    id: 'fal-ai/kling-video/v3/pro/image-to-video',
    label: 'Kling v3 pro — implicit (acceptă negative prompt)',
    usdPerSecond: 0.112, usdPerSecondAudio: 0.168,
    minSeconds: 3, maxSeconds: 15, fixedDurations: null,
    caps: V3_CAPS,
    note: 'The only tier that accepts the anti-drift negative prompt AND cfg_scale. 1080p out.',
  },
  'v3-4k': {
    id: 'fal-ai/kling-video/v3/4k/image-to-video',
    label: 'Kling v3 4K — master 4K, $0.42/s',
    usdPerSecond: 0.42, usdPerSecondAudio: 0.42,
    minSeconds: 3, maxSeconds: 15, fixedDurations: null,
    caps: V3_CAPS,
    note: 'Same schema as v3 pro, 4K output. Only worth it for a hero shot.',
  },
  'o3-standard': {
    id: 'fal-ai/kling-video/o3/standard/image-to-video',
    label: 'Kling o3 standard — ieftin, FĂRĂ negative prompt',
    usdPerSecond: 0.084, usdPerSecondAudio: 0.112,
    minSeconds: 3, maxSeconds: 15, fixedDurations: null,
    caps: O3_CAPS,
    note: 'No negative_prompt and no cfg_scale exist in this schema — colour drift cannot be forbidden.',
  },
  'o3-pro': {
    id: 'fal-ai/kling-video/o3/pro/image-to-video',
    label: 'Kling o3 pro — FĂRĂ negative prompt',
    usdPerSecond: 0.112, usdPerSecondAudio: 0.140,
    minSeconds: 3, maxSeconds: 15, fixedDurations: null,
    caps: O3_CAPS,
    note: 'Same blind spot as o3 standard.',
  },
  'v2.1': {
    id: 'fal-ai/kling-video/v2.1/standard/image-to-video',
    label: 'Kling 2.1 — vechi, doar 5s sau 10s',
    usdPerSecond: 0.05, usdPerSecondAudio: 0.05,
    minSeconds: 5, maxSeconds: 10, fixedDurations: ['5', '10'],
    caps: {
      startField: 'image_url',
      endImage: false, negative: true, cfg: true,
      audio: false, audioDefaultsOn: false,
      multiPrompt: false, elements: false, shotType: false,
    },
    note: 'Kept so existing projects reproduce exactly.',
  },
};
const DEFAULT_MODEL_KEY = 'v3-pro';

// The default negative prompt. It REPLACES fal's own default on v3, so fal's
// three terms are carried here rather than lost.
const DEFAULT_NEGATIVE = [
  'blur, distort, low quality',
  'text, watermark, logo, subtitles, caption, on-screen graphics',
  'extra fingers, deformed hands, warped face, identity change',
  'cut, shot change, morphing background, teleporting objects',
  'night, nighttime, moonlight, blue hour, twilight, dusk',
  'colour shift, color shift, changed lighting, changed time of day',
  'cold colour grade, blue cast, teal tint, desaturated, washed out',
  'season change, snow added, rain added',
  'frozen frame, static image, no motion',
].join(', ');

const DEFAULT_PROMPT =
  'Subtle cinematic motion: a slow deliberate camera move — a gentle push in, or a ' +
  'slow drift left or right — plus small natural movement in the scene. ' +
  'Keep the original photograph: same composition, same colours, same lighting, ' +
  'same time of day. One continuous shot, no cuts, no text.';

// Lip-sync engines, unchanged.
type SyncEngine = { id: string; label: string; usd: (s: number) => number; note: string };
const SYNC: Record<string, SyncEngine> = {
  latentsync: {
    id: 'fal-ai/latentsync',
    label: 'LatentSync — $0.20 (ieftin)',
    usd: (sec) => (sec <= 40 ? 0.20 : sec * 0.005),
    note: 'Works at 256x256 internally. Keep the face big in frame.',
  },
  'sync-1.9': {
    id: 'fal-ai/sync-lipsync',
    label: 'sync 1.9 — $0.70/min',
    usd: (sec) => (sec / 60) * 0.70,
    note: 'Better mouth shapes, still affordable.',
  },
  'sync-v2': {
    id: 'fal-ai/sync-lipsync/v2',
    label: 'sync v2 — $3.00/min (scump)',
    usd: (sec) => (sec / 60) * 3.00,
    note: 'Only when the clip really matters.',
  },
};

// ── admin gate (inlined so this file pastes straight into the dashboard) ────
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

  try {
    const probe = createClient(url, token, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (!error) return null;
  } catch { /* not service-role — fall through */ }

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
    console.error('[requireAdmin] check failed, denying by default:', (e as Error).message);
    return deny(401, 'Unauthorized');
  }
}

// ── payload builder ─────────────────────────────────────────────────────────
// Split out and exported in shape so it can be reasoned about (and, in the
// verification suite, asserted against) without spending a cent at fal.
export function buildPayload(m: KlingModel, body: Record<string, unknown>): {
  payload: Record<string, unknown>; seconds: number; dropped: string[];
} {
  const c = m.caps;
  const dropped: string[] = [];
  const payload: Record<string, unknown> = {};

  payload[c.startField] = String(body.image_url || body.start_image_url || '').trim();

  // Duration. fal's enum is string-typed on every Kling tier.
  const wanted = Math.round(Number(body.duration ?? 5));
  let seconds = Math.max(m.minSeconds, Math.min(m.maxSeconds, Number.isFinite(wanted) ? wanted : 5));
  if (m.fixedDurations) {
    // Snap to the nearest value the model actually knows rather than sending a
    // number it will reject.
    const nearest = m.fixedDurations
      .map(Number)
      .reduce((a, b) => (Math.abs(b - seconds) < Math.abs(a - seconds) ? b : a));
    seconds = nearest;
  }
  payload.duration = String(seconds);

  // prompt XOR multi_prompt — fal rejects both together.
  const multi = Array.isArray(body.multi_prompt) ? body.multi_prompt : null;
  if (multi && multi.length && c.multiPrompt) {
    payload.multi_prompt = multi
      .slice(0, 8)
      .map((s) => {
        const el = s as Record<string, unknown>;
        const out: Record<string, unknown> = { prompt: String(el?.prompt ?? s ?? '').trim() };
        const d = Number(el?.duration);
        if (Number.isFinite(d)) out.duration = String(Math.max(1, Math.min(15, Math.round(d))));
        return out;
      })
      .filter((x) => String(x.prompt).length > 0);
  } else {
    if (multi && multi.length) dropped.push('multi_prompt');
    payload.prompt = String(body.prompt || '').trim() || DEFAULT_PROMPT;
  }

  const endUrl = String(body.end_image_url || '').trim();
  if (endUrl) {
    if (c.endImage) payload.end_image_url = endUrl;
    else dropped.push('end_image_url');
  }

  if (c.negative) {
    const neg = String(body.negative_prompt || '').trim() || DEFAULT_NEGATIVE;
    payload.negative_prompt = neg;
  } else if (body.negative_prompt) {
    // Say it out loud. This silently-dropped field is what cost the last film.
    dropped.push('negative_prompt');
  }

  if (c.cfg) {
    const cfg = Number(body.cfg_scale);
    payload.cfg_scale = Number.isFinite(cfg) ? Math.max(0, Math.min(1, cfg)) : 0.5;
  } else if (body.cfg_scale !== undefined) {
    dropped.push('cfg_scale');
  }

  if (c.audio) {
    // Always explicit. v3 defaults this ON and would bill 50% more for audio
    // that Studio's own voiceover covers up.
    payload.generate_audio = body.generate_audio === true;
  }

  if (c.shotType) {
    const st = String(body.shot_type || '').trim();
    if (st === 'customize' || st === 'intelligent') payload.shot_type = st;
  }

  if (c.elements && Array.isArray(body.elements) && body.elements.length) {
    // Pass-through, URL-checked. The exact member shape is fal's to define; we
    // forward what the caller gives and never invent fields.
    const els = (body.elements as unknown[]).slice(0, 4).filter((e) => {
      const el = e as Record<string, unknown>;
      return typeof el === 'object' && el !== null &&
        (isHttp(String(el.frontal_image_url || '')) || isHttp(String(el.video_url || '')));
    });
    if (els.length) payload.elements = els;
  } else if (Array.isArray(body.elements) && body.elements.length) {
    dropped.push('elements');
  }

  return { payload, seconds, dropped };
}

function isHttp(u: string): boolean {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:'; }
  catch { return false; }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'create');
    const falKey = Deno.env.get('FAL_KEY');
    if (!falKey) {
      return json({ configured: false, message: 'FAL_KEY not set — image-to-video is disabled. Add a fal.ai key to the generate-motion function secrets.' });
    }
    const auth = { Authorization: `Key ${falKey}` };

    if (action === 'models') {
      return json({
        models: Object.entries(MODELS).map(([key, m]) => ({
          key, label: m.label, usdPerSecond: m.usdPerSecond,
          usdPerSecondAudio: m.usdPerSecondAudio,
          endFrame: m.caps.endImage, negativePrompt: m.caps.negative,
          cfgScale: m.caps.cfg, elements: m.caps.elements, multiPrompt: m.caps.multiPrompt,
          minSeconds: m.minSeconds, maxSeconds: m.maxSeconds,
          fixedDurations: m.fixedDurations, note: m.note,
        })),
        sync: Object.entries(SYNC).map(([key, e]) => ({ key, label: e.label, note: e.note })),
        defaultModel: DEFAULT_MODEL_KEY,
        defaultNegative: DEFAULT_NEGATIVE,
        defaultPrompt: DEFAULT_PROMPT,
      });
    }

    if (action === 'create') {
      const imageUrl = String(body.image_url || body.start_image_url || '').trim();
      if (!isHttp(imageUrl)) return json({ error: 'image_url must be an http(s) URL' }, 400);

      const rawModel = String(body.model || DEFAULT_MODEL_KEY).trim();
      const key = MODELS[rawModel]
        ? rawModel
        : (Object.entries(MODELS).find(([, x]) => x.id === rawModel)?.[0] ?? DEFAULT_MODEL_KEY);
      const m = MODELS[key];

      const { payload, seconds, dropped } = buildPayload(m, body);

      // TAKES. The whole point of the closed loop: generate several, measure
      // them, keep the one that works. Each take gets its own seed by virtue of
      // being a separate submission.
      const takes = Math.max(1, Math.min(4, Math.round(Number(body.takes) || 1)));

      const jobs: Record<string, string>[] = [];
      for (let i = 0; i < takes; i++) {
        const res = await fetch(`https://queue.fal.run/${m.id}`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = (await res.text()).substring(0, 500);
          // Hand back the payload we actually sent. A 422 from fal is a schema
          // disagreement, and you cannot fix one you cannot see.
          return json({
            error: `fal ${res.status}: ${text}`,
            model: m.id, sent: payload, submitted: jobs.length,
          }, 502);
        }
        const data = await res.json();
        jobs.push({
          request_id: String(data.request_id || ''),
          status_url: String(data.status_url || ''),
          response_url: String(data.response_url || ''),
        });
      }

      const perSecond = payload.generate_audio === true ? m.usdPerSecondAudio : m.usdPerSecond;
      return json({
        // New shape.
        jobs,
        model: m.id, modelKey: key, seconds, takes,
        looped: !!payload.end_image_url,
        dropped,
        sent: payload,
        estimated_usd: Number((perSecond * seconds * takes).toFixed(3)),
        // Back-compatible shape: an older Studio build reads these three.
        ...jobs[0],
      });
    }

    if (action === 'lipsync') {
      const videoUrl = String(body.video_url || '').trim();
      const audioUrl = String(body.audio_url || '').trim();
      if (!videoUrl || !audioUrl) return json({ error: 'video_url and audio_url are required' }, 400);
      const eng = SYNC[String(body.engine || 'latentsync')] ?? SYNC.latentsync;

      const payload: Record<string, unknown> = { video_url: videoUrl, audio_url: audioUrl };
      if (eng.id === 'fal-ai/latentsync') {
        payload.loop_mode = 'loop';
        const g = Number(body.guidance_scale);
        if (Number.isFinite(g)) payload.guidance_scale = Math.max(1, Math.min(2, g));
      } else {
        payload.sync_mode = 'loop';
      }

      const res = await fetch(`https://queue.fal.run/${eng.id}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return json({ error: `fal ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      const secs = Math.max(1, Number(body.seconds) || 10);
      return json({
        request_id: String(data.request_id || ''),
        status_url: String(data.status_url || ''),
        response_url: String(data.response_url || ''),
        engine: eng.id,
        estimated_usd: Number(eng.usd(secs).toFixed(3)),
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

function isFalUrl(u: string): boolean {
  try { return new URL(u).hostname === 'queue.fal.run'; } catch { return false; }
}
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
