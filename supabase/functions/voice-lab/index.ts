// supabase/functions/voice-lab/index.ts
//
// Marketing Studio — voice management. TWO cloning engines, kept equal:
//   • MiniMax via fal (fal-ai/minimax/voice-clone) — NO subscription, pay-per-use
//     through your prepaid FAL_KEY, reads Romanian natively (language_boost).
//   • ElevenLabs (Instant Voice Cloning) — premium, needs an ElevenLabs plan.
//
// Every clone is ALSO persisted in our own `studio_voices` table (the source of
// truth), so a cloned voice can never again "appear nowhere": the Studio lists
// voices from OUR database first, regardless of any provider's live listing.
//
// Actions:
//   { action: 'list' }
//       -> { configured, providers:{elevenlabs,minimax}, voices:[{voice_id,name,category,provider}] }
//   { action: 'clone_fal', name, audio_urls:[url], language?, consent:{granted,person_name,granted_by} }
//       -> { success, voice_id, provider:'minimax', preview_url? }   (subscription-free clone)
//   { action: 'clone', name, audio_urls:[url...], consent:{granted,person_name,granted_by} }
//       -> { success, voice_id, provider:'elevenlabs' }              (ElevenLabs IVC)
//   { action: 'delete', voice_id, provider? }
//       -> { success }
//
// CONSENT IS MANDATORY for cloning (either engine): consent.granted must be true
// and consent.person_name must name whose voice this is. Cloning someone without
// their explicit permission is refused on purpose.
//
// Env: FAL_KEY, ELEVENLABS_API_KEY (optional), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface VoiceRow { voice_id: string; name: string; category: string; provider: 'elevenlabs' | 'minimax' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');

    // Trim: a trailing newline or stray space pasted into the secret makes the
    // header invalid and ElevenLabs replies 401, which reads as "revoked key".
    const rawKey = Deno.env.get('ELEVENLABS_API_KEY') || '';
    const key = rawKey.trim().replace(/^["']|["']$/g, '');
    const falKey = (Deno.env.get('FAL_KEY') || '').trim();
    // Shape only — never the value. Lets the UI say WHY without leaking a secret.
    const keyShape = key ? `${key.startsWith('sk_') ? 'incepe cu sk_' : 'NU incepe cu sk_'}, ${key.length} caractere${rawKey !== key ? ', avea spatii/ghilimele (le-am curatat)' : ''}` : 'absenta';

    const db = getDb();

    // ─── LIST ────────────────────────────────────────────────────────────
    if (action === 'list') {
      // 1) OUR OWN clones first — the source of truth. Independent of any
      //    provider listing, so a clone we created is always visible here.
      const dbVoices = await readDbVoices(db);

      // 2) ElevenLabs live voices (stock + library + account clones), best-effort.
      const elVoices: VoiceRow[] = [];
      let elError: string | undefined;
      if (key) {
        const r = await listElevenLabs(key);
        if (r.error) elError = `${r.error} (cheia curenta: ${keyShape})`;
        else elVoices.push(...r.voices);
      }

      // Merge, de-dupe by provider+voice_id, our clones ranked first.
      const seen = new Set<string>();
      const voices = [...dbVoices, ...elVoices].filter(v => {
        const k = `${v.provider}:${v.voice_id}`;
        return seen.has(k) ? false : (seen.add(k), true);
      }).sort((a, b) => {
        const rank = (v: VoiceRow) => (v.category === 'cloned' ? 0 : v.category === 'professional' ? 1 : v.category === 'generated' ? 2 : 3);
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });

      const providers = { elevenlabs: !!key, minimax: !!falKey };
      // "configured" = the Studio has an advanced voice engine available (so it
      // switches from the Gemini-only fallback to the full picker + cloning lab).
      const configured = voices.length > 0 || providers.elevenlabs || providers.minimax;
      return json({ configured, providers, voices, count: voices.length, el_error: elError });
    }

    // ─── CLONE (subscription-free, fal / MiniMax) ────────────────────────
    if (action === 'clone_fal') {
      if (!falKey) return json({ error: 'FAL_KEY not set — add a fal.ai key (prepaid credits, no subscription) to clone voices without ElevenLabs.' }, 400);
      const name = String(body.name || '').trim();
      const urls: string[] = Array.isArray(body.audio_urls) ? body.audio_urls.map(String).filter(Boolean) : [];
      const consent = body.consent || {};
      const person = String(consent.person_name || '').trim();
      const grantedBy = String(consent.granted_by || 'admin').trim();
      const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';

      if (!name) return json({ error: 'name is required' }, 400);
      if (urls.length === 0) return json({ error: 'audio_urls is required (o mostră clară de minim 10 secunde)' }, 400);
      if (consent.granted !== true || !person) {
        return json({ error: 'CONSENT_REQUIRED: cloning needs consent.granted=true and consent.person_name (the person whose voice this is must have explicitly agreed).' }, 403);
      }

      // MiniMax requires a sample of at least ~10s. We can't measure duration
      // cheaply, so we use file size as a floor (mirrors the ElevenLabs path).
      const sample = urls[0];
      const probe = await fetch(sample);
      if (!probe.ok) return json({ error: `Could not fetch the audio sample (${probe.status})` }, 400);
      const blob = await probe.blob();
      if (blob.size < 60_000) return json({ error: 'Mostra audio e prea scurtă — MiniMax cere minim ~10 secunde de vorbire curată.' }, 400);

      // 1) Clone -> custom_voice_id.
      const cloneRes = await fetch('https://fal.run/fal-ai/minimax/voice-clone', {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: sample, noise_reduction: true, need_volume_normalization: true }),
      });
      if (!cloneRes.ok) return json({ error: `fal minimax voice-clone ${cloneRes.status}: ${(await cloneRes.text()).substring(0, 300)}` }, 502);
      const cloneData = await cloneRes.json();
      const voiceId = String(cloneData?.custom_voice_id || '');
      if (!voiceId) return json({ error: 'fal minimax voice-clone returned no custom_voice_id: ' + JSON.stringify(cloneData).substring(0, 200) }, 502);

      // 2) RETAIN. fal docs: a cloned voice must be used with a TTS endpoint at
      //    least once within 7 days or it is discarded. Speak one short line now
      //    so the voice is permanently retained — and capture a preview URL.
      let previewUrl: string | undefined;
      try {
        const hello = language === 'ro'
          ? 'Bună ziua. Aceasta este vocea mea, pentru Transilvania Times.'
          : 'Hello. This is my voice, for Transilvania Times.';
        const ttsRes = await fetch('https://fal.run/fal-ai/minimax/speech-2.8-hd', {
          method: 'POST',
          headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: hello,
            voice_setting: { voice_id: voiceId, speed: 1, vol: 1, pitch: 0 },
            language_boost: language === 'ro' ? 'Romanian' : 'English',
            audio_setting: { format: 'mp3', sample_rate: 44100, bitrate: 128000, channel: 1 },
            output_format: 'url',
          }),
        });
        if (ttsRes.ok) {
          const d = await ttsRes.json();
          previewUrl = String(d?.audio?.url || d?.audio_url || '') || undefined;
        }
      } catch { /* retain is best-effort; the voice id is already returned */ }

      // 3) Persist to our source of truth.
      await upsertVoice(db, {
        provider: 'minimax', voice_id: voiceId, name, person_name: person,
        consent_granted: true, consent_by: grantedBy, created_by: grantedBy,
        preview_url: previewUrl || null, language,
      });

      return json({ success: true, voice_id: voiceId, provider: 'minimax', preview_url: previewUrl });
    }

    // ─── CLONE (ElevenLabs Instant Voice Cloning) ────────────────────────
    if (action === 'clone') {
      if (!key) return json({ error: 'ELEVENLABS_API_KEY not set — folosește clonarea fără abonament (fal / MiniMax) sau adaugă cheia ElevenLabs.' }, 400);
      const name = String(body.name || '').trim();
      const urls: string[] = Array.isArray(body.audio_urls) ? body.audio_urls.map(String).filter(Boolean).slice(0, 5) : [];
      const consent = body.consent || {};
      const granted = consent.granted === true;
      const person = String(consent.person_name || '').trim();
      const grantedBy = String(consent.granted_by || '').trim();

      if (!name) return json({ error: 'name is required' }, 400);
      if (urls.length === 0) return json({ error: 'audio_urls is required (1-3 clean samples, 1-3 minutes total)' }, 400);
      if (!granted || !person) {
        return json({ error: 'CONSENT_REQUIRED: cloning needs consent.granted=true and consent.person_name (the person whose voice this is must have explicitly agreed).' }, 403);
      }

      const form = new FormData();
      form.append('name', name);
      form.append('description', `Transilvania Times editor voice. Consent: ${person} (recorded by ${grantedBy || 'admin'}).`);
      form.append('labels', JSON.stringify({ consent_person: person, consent_granted_by: grantedBy || 'admin', app: 'tt-studio' }));
      for (let i = 0; i < urls.length; i++) {
        const r = await fetch(urls[i]);
        if (!r.ok) return json({ error: `Could not fetch sample ${i + 1} (${r.status})` }, 400);
        const blob = await r.blob();
        if (blob.size < 20_000) return json({ error: `Sample ${i + 1} is too short — record at least ~30s of clean speech.` }, 400);
        form.append('files', blob, `sample-${i + 1}.mp3`);
      }

      const res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST', headers: { 'xi-api-key': key }, body: form,
      });
      if (!res.ok) return json({ error: `ElevenLabs clone ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      const voiceId = String(data.voice_id || '');

      // Persist to our source of truth too, so it survives an account/key change.
      if (voiceId) await upsertVoice(db, {
        provider: 'elevenlabs', voice_id: voiceId, name, person_name: person,
        consent_granted: true, consent_by: grantedBy || 'admin', created_by: grantedBy || 'admin',
        preview_url: null, language: null,
      });

      return json({ success: true, voice_id: voiceId, provider: 'elevenlabs' });
    }

    // ─── DELETE ───────────────────────────────────────────────────────────
    if (action === 'delete') {
      const voiceId = String(body.voice_id || '').trim();
      const provider = String(body.provider || 'elevenlabs') === 'minimax' ? 'minimax' : 'elevenlabs';
      if (!voiceId) return json({ error: 'voice_id is required' }, 400);

      // ElevenLabs voices are also removed from the ElevenLabs account. MiniMax
      // custom voices have no fal delete endpoint — we drop our record only.
      if (provider === 'elevenlabs' && key) {
        const res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
          method: 'DELETE', headers: { 'xi-api-key': key },
        });
        // A 404 (already gone) is fine; only a hard failure is surfaced.
        if (!res.ok && res.status !== 404) return json({ error: `ElevenLabs delete ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      }
      if (db) { try { await db.from('studio_voices').delete().eq('provider', provider).eq('voice_id', voiceId); } catch { /* best-effort */ } }
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

// ─── ElevenLabs listing (unchanged behaviour, factored into a helper) ────────
async function listElevenLabs(key: string): Promise<{ voices: VoiceRow[]; error?: string }> {
  const map = (arr: unknown): VoiceRow[] => (Array.isArray(arr) ? arr : []).map((v: Record<string, unknown>) => ({
    voice_id: String(v.voice_id || ''),
    name: String(v.name || ''),
    category: String(v.category || ''),
    provider: 'elevenlabs' as const,
  })).filter((v) => v.voice_id);

  const collected: VoiceRow[] = [];
  let nextToken = '';
  let usedV2 = false;
  for (let page = 0; page < 10; page++) {
    const url = new URL('https://api.elevenlabs.io/v2/voices');
    url.searchParams.set('page_size', '100');
    if (nextToken) url.searchParams.set('next_page_token', nextToken);
    const r = await fetch(url.toString(), { headers: { 'xi-api-key': key } });
    if (!r.ok) {
      const txt = await r.text();
      const hint = elKeyHint(r.status, txt);
      if (hint) return { voices: [], error: `${hint} [ElevenLabs ${r.status}: ${txt.substring(0, 220)}]` };
      break;
    }
    usedV2 = true;
    const d = await r.json();
    collected.push(...map(d.voices));
    nextToken = String(d.next_page_token || '');
    if (!nextToken || d.has_more === false) break;
  }

  if (!usedV2) {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    if (!res.ok) {
      const txt = await res.text();
      const hint = elKeyHint(res.status, txt);
      return { voices: [], error: hint ? `${hint} [ElevenLabs ${res.status}: ${txt.substring(0, 220)}]` : `ElevenLabs ${res.status}: ${txt.substring(0, 200)}` };
    }
    const data = await res.json();
    collected.push(...map(data.voices));
  }
  return { voices: collected };
}

// ─── DB helpers (fail-soft: a missing table must not break listing) ─────────
function getDb(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL');
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !svc) return null;
  try { return createClient(url, svc); } catch { return null; }
}
async function readDbVoices(db: SupabaseClient | null): Promise<VoiceRow[]> {
  if (!db) return [];
  try {
    const { data, error } = await db.from('studio_voices').select('voice_id,name,provider').order('created_at', { ascending: false });
    if (error || !Array.isArray(data)) return [];
    return data.map((r: Record<string, unknown>) => ({
      voice_id: String(r.voice_id || ''),
      name: String(r.name || ''),
      category: 'cloned',
      provider: (String(r.provider) === 'minimax' ? 'minimax' : 'elevenlabs') as 'minimax' | 'elevenlabs',
    })).filter(v => v.voice_id);
  } catch { return []; }
}
async function upsertVoice(db: SupabaseClient | null, row: Record<string, unknown>): Promise<void> {
  if (!db) return;
  try { await db.from('studio_voices').upsert(row, { onConflict: 'provider,voice_id' }); } catch { /* best-effort */ }
}

function elKeyHint(status: number, bodyText: string): string | null {
  if (/API key ID used as API key/i.test(bodyText)) {
    return 'CHEIE GRESITA: ai pus ID-ul cheii, nu cheia. Cheia reala incepe cu "sk_" si se afiseaza O SINGURA DATA, cand o creezi. '
         + 'Mergi in ElevenLabs -> Profile / API Keys -> Create API Key, copiaza valoarea care incepe cu sk_ si pune-o in '
         + 'Supabase -> Project Settings -> Edge Functions -> Secrets ca ELEVENLABS_API_KEY.';
  }
  if (/missing_permission|missing_permissions|insufficient/i.test(bodyText)) {
    return 'CHEIE FARA PERMISIUNI: cheia este valida, dar nu are dreptul "Voices / Read" (si "Text to Speech"). '
         + 'In ElevenLabs -> API Keys, editeaza cheia si bifeaza permisiunile Voices (Read) + Text to Speech, sau creeaza una cu acces complet.';
  }
  if (/unusual_activity|detected_unusual/i.test(bodyText)) {
    return 'ELEVENLABS A BLOCAT CONTUL: "unusual activity" — se intampla la conturile gratuite folosite prin VPN/proxy sau semnalate automat. '
         + 'Cheia e buna; trebuie sa activezi un plan platit ElevenLabs sau sa contactezi suportul lor.';
  }
  if (status === 401 || /invalid_api_key|unauthorized/i.test(bodyText)) {
    return 'Cheia ElevenLabs a fost respinsa. Cauze uzuale: cheia a fost stearsa/regenerata in ElevenLabs, apartine altui cont, '
         + 'sau nu are permisiunile necesare. Creeaza una noua in ElevenLabs -> API Keys cu acces la Voices + Text to Speech '
         + 'si actualizeaza ELEVENLABS_API_KEY in Supabase -> Project Settings -> Edge Functions -> Secrets.';
  }
  if (status === 429) return 'ElevenLabs: prea multe cereri sau credite epuizate. Verifica planul tau ElevenLabs.';
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
