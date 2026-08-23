// supabase/functions/voice-lab/index.ts
//
// Marketing Studio — voice management on ElevenLabs.
// Actions:
//   { action: 'list' }
//       -> { configured, voices: [{ voice_id, name, category }] }
//   { action: 'clone', name, audio_urls: [publicUrl...], consent: { granted, person_name, granted_by } }
//       -> { success, voice_id }  (instant voice clone from 1-3 clean samples)
//   { action: 'delete', voice_id }
//       -> { success }
//
// CONSENT IS MANDATORY for cloning: consent.granted must be true and
// consent.person_name must name whose voice this is. The consent metadata is
// stored on the voice as labels. Cloning someone without their explicit
// permission is refused by this function on purpose.
//
// Env: ELEVENLABS_API_KEY

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
    const action = String(body.action || 'list');
    // Trim: a trailing newline or stray space pasted into the secret makes the
    // header invalid and ElevenLabs replies 401, which reads as "revoked key".
    const rawKey = Deno.env.get('ELEVENLABS_API_KEY') || '';
    const key = rawKey.trim().replace(/^["']|["']$/g, '');
    // Shape only — never the value. Lets the UI say WHY without leaking a secret.
    const keyShape = key ? `${key.startsWith('sk_') ? 'incepe cu sk_' : 'NU incepe cu sk_'}, ${key.length} caractere${rawKey !== key ? ', avea spatii/ghilimele (le-am curatat)' : ''}` : 'absenta';

    if (!key) return json({ configured: false, voices: [], message: 'ELEVENLABS_API_KEY not set — using OpenAI fallback voices.' });

    if (action === 'list') {
      // Voice listing: /v2/voices is the current endpoint and is the one that
      // reliably includes voices ADDED FROM THE VOICE LIBRARY (a library voice
      // saved to "My Voices" could be missing from the older listing). v2
      // paginates with page_size defaulting to 10 — we request the 100 maximum
      // and page through, otherwise a large account silently truncates.
      // Falls back to /v1/voices if v2 is unavailable for this key.
      const map = (arr: unknown) => (Array.isArray(arr) ? arr : []).map((v: Record<string, unknown>) => ({
        voice_id: String(v.voice_id || ''),
        name: String(v.name || ''),
        category: String(v.category || ''),
      })).filter((v: { voice_id: string }) => v.voice_id);

      const collected: { voice_id: string; name: string; category: string }[] = [];
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
          // An auth problem will fail on v1 too — report it clearly, don't retry.
          if (hint) return json({ configured: false, voices: [], error: `${hint} (cheia curenta: ${keyShape}) [ElevenLabs ${r.status}: ${txt.substring(0, 220)}]` }, 200);
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
          if (hint) return json({ configured: false, voices: [], error: `${hint} (cheia curenta: ${keyShape}) [ElevenLabs ${res.status}: ${txt.substring(0, 220)}]` }, 200);
          return json({ error: `ElevenLabs ${res.status}: ${txt.substring(0, 200)}` }, 502);
        }
        const data = await res.json();
        collected.push(...map(data.voices));
      }

      // De-duplicate, then surface cloned/generated voices first — a voice the
      // user deliberately added is far likelier to be the one they want than
      // the stock premade list.
      const seen = new Set<string>();
      const voices = collected.filter(v => (seen.has(v.voice_id) ? false : (seen.add(v.voice_id), true)))
        .sort((a, b) => {
          const rank = (c: string) => (c === 'cloned' ? 0 : c === 'professional' ? 1 : c === 'generated' ? 2 : 3);
          return rank(a.category) - rank(b.category) || a.name.localeCompare(b.name);
        });
      return json({ configured: true, voices, count: voices.length, source: usedV2 ? 'v2' : 'v1' });
    }

    if (action === 'clone') {
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
      return json({ success: true, voice_id: String(data.voice_id || '') });
    }

    if (action === 'delete') {
      const voiceId = String(body.voice_id || '').trim();
      if (!voiceId) return json({ error: 'voice_id is required' }, 400);
      const res = await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE', headers: { 'xi-api-key': key },
      });
      if (!res.ok) return json({ error: `ElevenLabs delete ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function elKeyHint(status: number, bodyText: string): string | null {
  // ElevenLabs shows an "API key ID" in the dashboard list, but the REAL secret
  // (starting with sk_) is displayed ONCE at creation. Pasting the ID is the
  // single most common setup mistake and its raw error is cryptic, so translate.
  if (/API key ID used as API key/i.test(bodyText)) {
    return 'CHEIE GRESITA: ai pus ID-ul cheii, nu cheia. Cheia reala incepe cu "sk_" si se afiseaza O SINGURA DATA, cand o creezi. '
         + 'Mergi in ElevenLabs -> Profile / API Keys -> Create API Key, copiaza valoarea care incepe cu sk_ si pune-o in '
         + 'Supabase -> Project Settings -> Edge Functions -> Secrets ca ELEVENLABS_API_KEY.';
  }
  // Scoped keys: ElevenLabs keys carry PERMISSIONS. A key created without the
  // "Voices: Read" scope authenticates fine but cannot list voices.
  if (/missing_permission|missing_permissions|insufficient/i.test(bodyText)) {
    return 'CHEIE FARA PERMISIUNI: cheia este valida, dar nu are dreptul "Voices / Read" (si "Text to Speech"). '
         + 'In ElevenLabs -> API Keys, editeaza cheia si bifeaza permisiunile Voices (Read) + Text to Speech, sau creeaza una cu acces complet.';
  }
  // Free/flagged accounts get blocked with a 401 that is NOT a bad key.
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
