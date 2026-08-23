// supabase/functions/align-subtitles/index.ts
//
// Marketing Studio — accurate subtitle timing. Downloads a voiceover MP3 and
// runs OpenAI Whisper (verbose_json, segment timestamps) to produce time-aligned
// subtitle cues that match exactly what was spoken.
// Input:  { audio_url, language? }
// Output: { success, segments: [{start, end, text}], vtt }
//
// Requires env: OPENAI_API_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Segment { start: number; end: number; text: string }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const audioUrl = String(body.audio_url || '').trim();
    if (!audioUrl) return json({ error: 'audio_url is required' }, 400);
    const language = String(body.language || 'ro');

    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) return json({ error: 'OPENAI_API_KEY not configured' }, 500);

    // Download the audio.
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return json({ error: `Could not fetch audio (${audioRes.status})` }, 400);
    const audioBlob = await audioRes.blob();

    // Whisper transcription with segment timestamps.
    const form = new FormData();
    form.append('file', audioBlob, 'voice.mp3');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word'); // karaoke captions
    if (language) form.append('language', language);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      return json({ error: `Whisper ${res.status}: ${err.substring(0, 300)}` }, 502);
    }

    const data = await res.json();
    const raw = Array.isArray(data.segments) ? data.segments : [];
    const segments: Segment[] = raw.map((s: Record<string, unknown>) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '').trim(),
    })).filter((s: Segment) => s.text.length > 0);

    const rawWords = Array.isArray(data.words) ? data.words : [];
    const words = rawWords.map((w: Record<string, unknown>) => ({
      word: String(w.word || '').trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    })).filter((w: { word: string }) => w.word.length > 0);

    return json({ success: true, segments, words, vtt: toVtt(segments) });
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function toVtt(segs: Segment[]): string {
  const stamp = (t: number) => {
    const h = Math.floor(t / 3600).toString().padStart(2, '0');
    const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    const ms = Math.floor((t % 1) * 1000).toString().padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  };
  return 'WEBVTT\n\n' + segs.map(s => `${stamp(s.start)} --> ${stamp(s.end)}\n${s.text}`).join('\n\n');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
