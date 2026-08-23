// supabase/functions/newsroom-anchor/index.ts
//
// NEWSROOM — daily AI news-anchor video pipeline (HeyGen lipsync).
//
// Actions:
//   { action:'script', language:'ro'|'en', target_seconds, articles:[{title,summary}] }
//       -> { script }   (Claude claude-sonnet-4-5-20250929 via CLAUDE_API_KEY,
//                        fallback OpenAI gpt-4o-2024-11-20)
//   { action:'avatars' }
//       -> { configured, avatars:[{avatar_id, avatar_name, preview_image_url}] }
//   { action:'upload_photo', image_url, consent:{granted, person_name} }
//       -> { talking_photo_id }   (HeyGen talking photo; CONSENT REQUIRED)
//   { action:'generate', character:{type:'avatar',avatar_id}|{type:'talking_photo',talking_photo_id},
//     audio_url, width, height, background_color? }
//       -> { video_id }
//   { action:'status', video_id }
//       -> { status } ; on completed: stores MP4 to studio-assets/newsroom/ -> { status:'completed', publicUrl }
//
// Env: HEYGEN_API_KEY, CLAUDE_API_KEY (optional), OPENAI_API_KEY,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const action = String(body.action || '');

    // ── 1) SCRIPT ─────────────────────────────────────────────────────────
    if (action === 'script') {
      const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
      const edition = String(body.edition || '');   // 'morning' | 'evening' | ''
      const greetRo = edition === 'morning'
        ? "un salut de dimineață (\"Bună dimineața\") cu Transilvania Times, energic și luminos"
        : edition === 'evening'
          ? "un salut de seară (\"Bună seara\") cu Transilvania Times, așezat și autoritar"
          : "un rând de salut cu Transilvania Times și 'astăzi'";
      const greetEn = edition === 'morning'
        ? 'a bright morning greeting ("Good morning") with Transilvania Times'
        : edition === 'evening'
          ? 'a composed evening greeting ("Good evening") with Transilvania Times'
          : 'one-line greeting with Transilvania Times';
      // Duration ceiling raised 150 -> 300s. A 10-story bulletin cannot be told
      // in 110 seconds, and the old ceiling silently forced the model to drop
      // stories (see the ALL-STORIES contract below).
      const target = Math.min(300, Math.max(30, Number(body.target_seconds) || 75));
      // Article ceiling raised 10 -> 20, and anything beyond it is now REPORTED
      // rather than silently discarded.
      const allArticles = (Array.isArray(body.articles) ? body.articles : [])
        .map((a: Record<string, unknown>) => ({ title: String(a.title || ''), summary: String(a.summary || '').slice(0, 400) }))
        .filter((a: { title: string }) => a.title);
      const articles = allArticles.slice(0, 20);
      const droppedForCap = allArticles.length - articles.length;
      if (articles.length === 0) return json({ error: 'articles is required (selectează știrile zilei)' }, 400);

      const wordsTarget = Math.round(target * (language === 'ro' ? 2.3 : 2.5)); // speaking pace
      // Roughly 25 spoken words is the floor for one story to be worth airing.
      // If the requested duration cannot carry every selected story, say so in
      // the response instead of letting the model quietly bin the overflow.
      const minWordsNeeded = articles.length * 25 + 25   // stories + greeting/signoff
      const budgetTight = wordsTarget < minWordsNeeded
      const coverageRo = `OBLIGATORIU: articolul "stories" TREBUIE să conțină EXACT ${articles.length} intrări — câte una pentru FIECARE știre primită, în ordinea în care ți-au fost date. Nu omite, nu combina și nu sări peste nicio știre. Dacă spațiul e strâns, scurtează fiecare știre la o singură frază, dar include-le pe TOATE.`
      const coverageEn = `MANDATORY: the "stories" array MUST contain EXACTLY ${articles.length} entries — one for EVERY story given, in the order provided. Do not omit, merge or skip any. If space is tight, shorten each to a single sentence, but include them ALL.`
      // STRUCTURED script: JSON sections so the broadcast compositor can time
      // lower-thirds per story. `script` (joined spoken text) stays the TTS input.
      const sys = language === 'ro'
        ? `Ești prezentatorul de știri al Transilvania Times. Scrie un buletin video de ~${target} secunde (~${wordsTarget} cuvinte) în română naturală, cu diacritice, ton profesionist: cald, clar, autoritar, fără senzaționalism. Răspunde DOAR cu JSON valid, fără alt text, exact în forma: {"greeting":"${greetRo}","stories":[{"lower_third":"titlu de burtieră, max 38 caractere, fără punct final","text":"1-3 fraze rostite despre știre, cu tranziție naturală"}],"signoff":"un rând de închidere care invită pe transilvaniatimes.com"}. Fără indicații de regie, fără emoji, fără markdown.

${coverageRo}`
        : `You are the news anchor of Transilvania Times. Write a ~${target}-second (~${wordsTarget} words) bulletin in natural English: warm, clear, authoritative. Respond ONLY with valid JSON, no other text, exactly: {"greeting":"${greetEn}","stories":[{"lower_third":"lower-third title, max 38 chars, no final period","text":"1-3 spoken sentences with a natural transition"}],"signoff":"one-line sign-off inviting viewers to transilvaniatimes.com"}. No stage directions, no emoji, no markdown.

${coverageEn}`;
      const user = articles.map((a: { title: string; summary: string }, i: number) => `${i + 1}. ${a.title}\n${a.summary}`).join('\n\n');

      // ── ROOT CAUSE (observed in production) ─────────────────────────────
      // The model wrote a Romanian opening quote „ and closed it with a STRAIGHT
      // ASCII double quote: „God Is Not Your Babysitter". Inside a JSON string
      // that unescaped " terminates the value early, JSON.parse throws, and the
      // old code fell through to `{ script: text }` — dumping the RAW JSON into
      // the script box AND into the TTS input, so the anchor would have read the
      // JSON aloud. Two defences: repair the common malformations, and never let
      // unparsed JSON reach the script field (see the salvage path below).
      const repairJson = (raw: string): string => {
        // Close a Romanian „ quote that was closed with a straight " instead of ”.
        let out = raw.replace(/„([^"„”]*)"/g, '„$1”')
        // Same for an English “ opened quote closed with a straight ".
        out = out.replace(/“([^"“”]*)"/g, '“$1”')
        return out
      }

      const parseSections = (raw: string) => {
        try {
          const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
          const slice = raw.slice(s, e + 1)
          let obj: Record<string, unknown>
          try { obj = JSON.parse(slice) }
          catch { obj = JSON.parse(repairJson(slice)) }   // second chance
          const stories = (Array.isArray((obj as Record<string, unknown>).stories) ? (obj as Record<string, unknown>).stories as unknown[] : [])
            .map((st: Record<string, unknown>) => ({ lower_third: String(st.lower_third || '').slice(0, 44), text: String(st.text || '') }))
            .filter((st: { text: string }) => st.text);
          if (!stories.length) return null;
          const greeting = String((obj as Record<string, unknown>).greeting || '');
          const signoff = String((obj as Record<string, unknown>).signoff || '');
          const script = [greeting, ...stories.map((st: { text: string }) => st.text), signoff].filter(Boolean).join('\n\n');
          return { script, sections: { greeting, stories, signoff } };
        } catch { return null; }
      };

      // Last resort. If the JSON is too broken to parse even after repair, pull
      // the human-readable values out with a regex and hand back PROSE. The
      // script field feeds the TTS engine — putting JSON in it means the anchor
      // reads braces and field names aloud on air. That must never happen.
      const salvageProse = (raw: string): string => {
        const grab = (key: string) => {
          const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*[,}\\n]`))
          return m ? m[1].replace(/\\n/g, ' ').trim() : ''
        }
        const greeting = grab('greeting')
        const texts = [...raw.matchAll(/"text"\s*:\s*"([\s\S]*?)"\s*[,}\n]/g)].map(m => m[1].trim()).filter(Boolean)
        const signoff = grab('signoff')
        const parts = [greeting, ...texts, signoff].filter(Boolean)
        return parts.length ? parts.join('\n\n') : ''
      };

      // Report coverage explicitly. A missing story must never be silent.
      const coverageMeta = (parsed: { sections?: { stories?: unknown[] } } | null) => {
        const got = parsed?.sections?.stories?.length ?? 0
        const want = articles.length
        const notes: string[] = []
        if (got < want) notes.push(`ATENȚIE: ${got} din ${want} știri au intrat în script. Mărește durata buletinului (${target}s e prea scurt pentru ${want} știri) sau selectează mai puține știri.`)
        if (droppedForCap > 0) notes.push(`${droppedForCap} știri peste limita de 20 nu au fost trimise.`)
        if (budgetTight && got >= want) notes.push(`Buletinul e dens: ${want} știri în ${target}s.`)
        return { stories_requested: want, stories_returned: got, coverage_note: notes.join(' ') || undefined }
      }

      const claudeKey = Deno.env.get('CLAUDE_API_KEY');
      if (claudeKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250929', max_tokens: 1800,
            system: sys, messages: [{ role: 'user', content: user }],
            // Structured outputs: the API enforces this schema AT GENERATION
            // TIME, so the response cannot contain the unescaped-quote
            // malformation that produced raw JSON in the script box. Same
            // mechanism the scraper adopted in v72.3 for the same class of bug.
            output_config: {
              format: {
                type: 'json_schema',
                schema: {
                  type: 'object',
                  properties: {
                    greeting: { type: 'string' },
                    stories: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { lower_third: { type: 'string' }, text: { type: 'string' } },
                        required: ['lower_third', 'text'],
                        additionalProperties: false,
                      },
                    },
                    signoff: { type: 'string' },
                  },
                  required: ['greeting', 'stories', 'signoff'],
                  additionalProperties: false,
                },
              },
            },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const text = (data?.content?.[0]?.text || '').trim();
          const parsed = parseSections(text);
          if (parsed) return json({ ...parsed, model: 'claude-sonnet-4-5-20250929', ...coverageMeta(parsed) });
          const salvaged = salvageProse(text);
          if (salvaged) {
            console.warn('[script] claude JSON unparseable — salvaged prose from the values');
            return json({ script: salvaged, sections: null, model: 'claude-sonnet-4-5-20250929', note: 'JSON invalid — text recuperat, burtierele lipsesc' });
          }
          console.warn('[script] claude output unusable, falling through to OpenAI');
        } else {
          console.warn('[script] claude failed:', res.status, (await res.text()).substring(0, 150));
        }
      }
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) return json({ error: 'No LLM configured (CLAUDE_API_KEY or OPENAI_API_KEY)' }, 500);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-2024-11-20', max_tokens: 1800, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) return json({ error: `OpenAI ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      const parsed = parseSections(text);
      if (parsed) return json({ ...parsed, model: 'gpt-4o-2024-11-20', ...coverageMeta(parsed) });
      const salvaged2 = salvageProse(text);
      if (salvaged2) {
        console.warn('[script] openai JSON unparseable — salvaged prose from the values');
        return json({ script: salvaged2, sections: null, model: 'gpt-4o-2024-11-20', note: 'JSON invalid — text recuperat, burtierele lipsesc' });
      }
      // Never hand raw JSON back: it would be spoken aloud by the anchor.
      return json({ error: 'Scriptul generat nu a putut fi interpretat (JSON invalid). Reîncearcă — dacă persistă, reduce numărul de știri selectate.' }, 502);
    }

    // ── Platform caption pack (Claude → OpenAI fallback) ──────────────────
    if (action === 'captions') {
      const language = String(body.language || 'ro') === 'en' ? 'en' : 'ro';
      const titles = (Array.isArray(body.titles) ? body.titles : []).map((t: unknown) => String(t || '')).filter(Boolean).slice(0, 8);
      if (!titles.length) return json({ error: 'titles is required' }, 400);
      const base = 'https://transilvaniatimes.com';
      const utm = (src: string) => `${base}/?utm_source=${src}&utm_medium=social&utm_campaign=buletin`;
      const sys = language === 'ro'
        ? `Ești social media editor la Transilvania Times (ziar din Ardeal, ton cald și de încredere). Pentru buletinul video de azi cu subiectele date, răspunde DOAR cu JSON valid: {"facebook":"caption 2-4 fraze cu cârlig în prima frază + CTA către link","instagram":"caption scurt cu cârlig + 'link în bio'","tiktok":"caption foarte scurt, direct, cu cârlig","youtube_title":"titlu max 90 caractere cu ziua","youtube_description":"2-3 fraze + link","hashtags":["8-12 hashtag-uri RO relevante, fără #buletin generic"]}. Diacritice corecte, fără emoji excesiv (max 1-2 per caption).`
        : `You are the social media editor of Transilvania Times. For today's video bulletin with the given stories, respond ONLY with valid JSON: {"facebook":"2-4 sentence caption, hook first + CTA","instagram":"short caption with hook + 'link in bio'","tiktok":"very short punchy caption","youtube_title":"max 90 chars with the day","youtube_description":"2-3 sentences + link","hashtags":["8-12 relevant EN/RO hashtags"]}. Max 1-2 emoji per caption.`;
      const user = `Subiecte: ${titles.join(' | ')}\nLink Facebook: ${utm('facebook')}\nLink YouTube: ${utm('youtube')}`;
      const tryParse = (raw: string) => {
        try { const s = raw.indexOf('{'); const e = raw.lastIndexOf('}'); return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
      };
      const claudeKey = Deno.env.get('CLAUDE_API_KEY');
      if (claudeKey) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-5-20250929', max_tokens: 1200, system: sys, messages: [{ role: 'user', content: user }] }),
        });
        if (res.ok) {
          const data = await res.json();
          const parsed = tryParse((data?.content?.[0]?.text || ''));
          if (parsed) return json({ captions: parsed, links: { facebook: utm('facebook'), instagram: utm('instagram'), tiktok: utm('tiktok'), youtube: utm('youtube') } });
        }
      }
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) return json({ error: 'No LLM configured' }, 500);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-2024-11-20', max_tokens: 1200, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }),
      });
      if (!res.ok) return json({ error: `OpenAI ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const parsed = tryParse(data?.choices?.[0]?.message?.content || '');
      if (!parsed) return json({ error: 'Could not parse captions' }, 502);
      return json({ captions: parsed, links: { facebook: utm('facebook'), instagram: utm('instagram'), tiktok: utm('tiktok'), youtube: utm('youtube') } });
    }

    // ── FAL (SadTalker) — no-subscription lipsync engine ──────────────────
    const falKey = Deno.env.get('FAL_KEY');

    if (action === 'engines') {
      return json({
        heygen: !!Deno.env.get('HEYGEN_API_KEY'),
        fal: !!falKey,
      });
    }

    if (action === 'generate_fal') {
      if (!falKey) return json({ error: 'FAL_KEY not set — add a fal.ai key (prepaid credits, no subscription) to use the free-stack anchor.' }, 400);
      const imageUrl = String(body.image_url || '').trim();
      const videoUrl = String(body.video_url || '').trim();
      const audioUrl = String(body.audio_url || '').trim();
      if (!audioUrl || (!imageUrl && !videoUrl)) return json({ error: 'audio_url plus image_url or video_url is required' }, 400);

      // Engine selection — video-to-video lipsync is FAR more professional than
      // photo animation: the presenter clip keeps its real studio, hair, hands,
      // body motion, and only the mouth is resynced to the voiceover.
      //   'sync'       → fal-ai/sync-lipsync   (sync.so — best quality, video+audio)
      //   'latentsync' → fal-ai/latentsync     (ByteDance — strong open alternative)
      //   'sadtalker'  → fal-ai/sadtalker      (photo+audio fallback, now with GFPGAN)
      let engine = String(body.engine || '').trim();
      if (!engine) engine = videoUrl ? 'sync' : 'sadtalker';

      let model = '';
      let payload: Record<string, unknown> = {};
      if (engine === 'sync') {
        if (!videoUrl) return json({ error: 'engine "sync" needs video_url (a presenter clip)' }, 400);
        // ── COST-FIRST ENGINE SELECTION ───────────────────────────────────
        // CRITICAL FACT: every model here is a REDUB engine — it replaces the
        // MOUTH on footage you supply. None of them invent gestures or body
        // language; that comes entirely from the source clip. So paying $8/min
        // for sync-3 buys phoneme accuracy ONLY — never a "more human" presenter.
        // Verified fal prices per minute of output:
        //   latentsync ……… $0.30  ($0.20 flat ≤40s, then $0.005/s)  ← default
        //   veed/lipsync … $0.40
        //   sync-lipsync … $0.70  (1.9 base)
        //   sync v2 ……… $3.00
        //   sync v2 pro … $5.00
        //   sync v3 ……… $8.00
        // A ~1.8-min bulletin: $0.54 on latentsync vs $14.40 on v3 — 27×.
        // Fallback only ever moves DOWNWARD in price — never a silent upgrade.
        const quality = String(body.quality || 'economic').toLowerCase();
        const TIERS: Record<string, { model: string; payload: Record<string, unknown>; usd: number }> = {
          premium:  { model: 'fal-ai/sync-lipsync/v3', usd: 8.00, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop', options: { sync_mode: 'loop', model_mode: 'lipsync' } } },
          pro:      { model: 'fal-ai/sync-lipsync/v2', usd: 5.00, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop', model: 'lipsync-2-pro' } },
          bun:      { model: 'fal-ai/sync-lipsync/v2', usd: 3.00, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop' } },
          standard: { model: 'fal-ai/sync-lipsync',    usd: 0.70, payload: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'loop' } },
          veed:     { model: 'veed/lipsync',           usd: 0.40, payload: { video_url: videoUrl, audio_url: audioUrl } },
          // LatentSync: output length ALWAYS equals the audio length, and a short
          // source clip is auto-extended. loop_mode is nullable with no declared
          // default, so we set it explicitly — 'pingpong' plays the clip forward
          // then reversed, which avoids the visible jump-cut that plain 'loop'
          // produces when the last frame doesn't match the first.
          economic: { model: 'fal-ai/latentsync',      usd: 0.30, payload: { video_url: videoUrl, audio_url: audioUrl, loop_mode: 'pingpong' } },
        };
        // Chosen tier first, then progressively CHEAPER tiers as fallback.
        const cheapOrder = ['premium', 'pro', 'bun', 'standard', 'veed', 'economic'];
        const startAt = cheapOrder.indexOf(TIERS[quality] ? quality : 'economic');
        const ladder = cheapOrder.slice(startAt).map(k => TIERS[k]);
        // sync_mode 'loop' is REQUIRED: the presenter source is a short (~10s)
        // idle clip while the voiceover runs 1–2 min, so the video must loop to
        // cover the audio. 'cut_off' (fal's default) would truncate the bulletin.
        for (const step of ladder) {
          const r2 = await fetch(`https://queue.fal.run/${step.model}`, {
            method: 'POST',
            headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(step.payload),
          });
          if (r2.ok) {
            const d2 = await r2.json();
            const label = step.model + (step.payload.model ? ` (${step.payload.model})` : step.payload.options ? ' (lipsync)' : '');
            return json({ engine, model: label, usd_per_min: step.usd, quality,
              request_id: String(d2.request_id || ''), status_url: String(d2.status_url || ''), response_url: String(d2.response_url || '') });
          }
          console.warn(`[fal] ${step.model} submit failed:`, r2.status, (await r2.text()).substring(0, 200));
        }
        return json({ error: 'fal sync-lipsync: niciun model (v3/v2-pro/v2/bază) nu a acceptat cererea — verifică FAL_KEY / creditele.' }, 502);
      } else if (engine === 'avatar') {
        // ── AVATAR ENGINE — the only path that GENERATES performance ────────
        // Redub models (above) can never make a stiff source clip look alive:
        // they only move the mouth. Kling AI Avatar drives head motion, blinks
        // and expression from the AUDIO itself, starting from a single photo —
        // that is what actually reads as a human presenter rather than a mask
        // pasted on a loop. $0.0562/s = $3.37/min (verified on fal).
        // Keep segments short (≈60s) — quality and stability degrade beyond it.
        if (!imageUrl) return json({ error: 'engine "avatar" needs image_url (un portret al prezentatorului)' }, 400);
        model = 'fal-ai/kling-video/ai-avatar/v2/standard';
        payload = { image_url: imageUrl, audio_url: audioUrl };
        if (String(body.prompt || '').trim()) payload.prompt = String(body.prompt).trim();
      } else if (engine === 'latentsync') {
        if (!videoUrl) return json({ error: 'engine "latentsync" needs video_url (a presenter clip)' }, 400);
        model = 'fal-ai/latentsync';
        payload = { video_url: videoUrl, audio_url: audioUrl, loop_mode: 'pingpong' };
      } else {
        if (!imageUrl) return json({ error: 'engine "sadtalker" needs image_url (a presenter portrait)' }, 400);
        model = 'fal-ai/sadtalker';
        payload = {
          source_image_url: imageUrl,
          driven_audio_url: audioUrl,
          face_model_resolution: '512',
          preprocess: 'full',
          still_mode: false,        // natural micro head-motion instead of frozen bust
          expression_scale: 1.1,    // slightly livelier articulation
          face_enhancer: 'gfpgan',  // face restoration pass — sharper, less waxy
        };
      }

      const res = await fetch(`https://queue.fal.run/${model}`, {
        method: 'POST',
        headers: { Authorization: `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return json({ error: `fal ${engine} ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      return json({ engine, request_id: String(data.request_id || ''), status_url: String(data.status_url || ''), response_url: String(data.response_url || '') });
    }

    if (action === 'poll_fal') {
      if (!falKey) return json({ error: 'FAL_KEY not set' }, 400);
      const statusUrl = String(body.status_url || '').trim();
      const responseUrl = String(body.response_url || '').trim();
      const okUrl = (u: string) => { try { return new URL(u).hostname === 'queue.fal.run'; } catch { return false; } };
      if (!okUrl(statusUrl) || !okUrl(responseUrl)) return json({ error: 'status_url/response_url must come from generate_fal' }, 400);
      const auth = { Authorization: `Key ${falKey}` };
      const st = await fetch(statusUrl, { headers: auth });
      if (!st.ok) return json({ error: `fal status ${st.status}: ${(await st.text()).substring(0, 200)}` }, 502);
      const stData = await st.json();
      const status = String(stData.status || '');
      if (status !== 'COMPLETED') return json({ status, queue_position: stData.queue_position ?? null });
      const rr = await fetch(responseUrl, { headers: auth });
      if (!rr.ok) return json({ error: `fal result ${rr.status}: ${(await rr.text()).substring(0, 200)}` }, 502);
      const result = await rr.json();
      const videoUrl = String(result?.video?.url || '');
      if (!videoUrl) return json({ error: 'fal returned no video url: ' + JSON.stringify(result).substring(0, 200) }, 502);

      // We re-host the clip in our own bucket so the compositor gets a stable,
      // CORS-clean URL. If that upload fails FOR ANY REASON — most commonly the
      // Supabase "Upload file size limit" still sitting at its 50 MB default while
      // a high-quality sync-3 clip runs larger — we don't drop the finished clip:
      // fal's own delivery URLs (fal.media) are permanent and CORS-enabled, so we
      // hand that back instead. Raising the storage limit in the dashboard makes
      // every clip re-host in your own bucket again with no code change here.
      const vid = await fetch(videoUrl);
      if (!vid.ok) return json({ error: `video download failed (${vid.status})` }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());

      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fileName = `newsroom/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
      const { error: upErr } = await supabase.storage.from('studio-assets')
        .upload(fileName, bytes, { contentType: 'video/mp4', upsert: false });
      if (upErr) {
        console.warn('[storage] upload failed, serving fal URL:', upErr.message, `(${bytes.byteLength} bytes)`);
        const tooBig = /maximum allowed size|exceeded/i.test(upErr.message);
        return json({ status: 'completed', publicUrl: videoUrl, hosted: 'fal', bytes: bytes.byteLength,
          note: tooBig
            ? `Clip ${(bytes.byteLength/1048576).toFixed(1)} MB > limita de upload Supabase. Ridică „Upload file size limit” în Storage Settings (Pro permite până la 500 GB). Servit din fal deocamdată.`
            : `Stocare: ${upErr.message} — servit din fal.` });
      }
      const { data: pub } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
      return json({ status: 'completed', publicUrl: pub.publicUrl, hosted: 'supabase', bytes: bytes.byteLength, fileName });
    }

    // ── HeyGen actions (optional premium engine) ──────────────────────────
    const hgKey = Deno.env.get('HEYGEN_API_KEY');
    if (!hgKey) {
      return json({ configured: false, fal_configured: !!falKey, message: 'HEYGEN_API_KEY not set — use the free-stack anchor (fal/SadTalker) or add a HeyGen key for premium quality.' });
    }
    const hg = { 'X-Api-Key': hgKey };

    if (action === 'avatars') {
      const res = await fetch('https://api.heygen.com/v2/avatars', { headers: hg });
      if (!res.ok) return json({ error: `HeyGen avatars ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const raw = data?.data?.avatars || data?.avatars || [];
      const avatars = (Array.isArray(raw) ? raw : []).slice(0, 60).map((a: Record<string, unknown>) => ({
        avatar_id: String(a.avatar_id || ''),
        avatar_name: String(a.avatar_name || a.name || ''),
        preview_image_url: String(a.preview_image_url || a.preview_image || ''),
      })).filter((a: { avatar_id: string }) => a.avatar_id);
      return json({ configured: true, avatars });
    }

    if (action === 'upload_photo') {
      const imageUrl = String(body.image_url || '').trim();
      const consent = body.consent || {};
      if (!imageUrl) return json({ error: 'image_url is required' }, 400);
      // Consent gate protects REAL people's likenesses. A fully AI-generated,
      // fictional presenter has no person to consent — so it is exempt, but the
      // caller must say so explicitly (fictional:true). Real faces still gated.
      const fictional = body.fictional === true;
      if (!fictional && (consent.granted !== true || !String(consent.person_name || '').trim())) {
        return json({ error: 'CONSENT_REQUIRED: uploading a real person\'s face needs consent.granted=true and consent.person_name. For a fully AI-generated fictional presenter, pass fictional:true.' }, 403);
      }
      const img = await fetch(imageUrl);
      if (!img.ok) return json({ error: `Could not fetch photo (${img.status})` }, 400);
      const bytes = new Uint8Array(await img.arrayBuffer());
      const ct = img.headers.get('content-type') || 'image/jpeg';
      const res = await fetch('https://upload.heygen.com/v1/talking_photo', {
        method: 'POST', headers: { ...hg, 'Content-Type': ct }, body: bytes,
      });
      if (!res.ok) return json({ error: `HeyGen upload ${res.status}: ${(await res.text()).substring(0, 250)}` }, 502);
      const data = await res.json();
      const id = String(data?.data?.talking_photo_id || data?.talking_photo_id || '');
      if (!id) return json({ error: 'HeyGen returned no talking_photo_id: ' + JSON.stringify(data).substring(0, 200) }, 502);
      return json({ talking_photo_id: id });
    }

    if (action === 'generate') {
      const character = body.character;
      const audioUrl = String(body.audio_url || '').trim();
      if (!character || !audioUrl) return json({ error: 'character and audio_url are required' }, 400);
      const width = Math.min(1920, Math.max(360, Number(body.width) || 1280));
      const height = Math.min(1920, Math.max(360, Number(body.height) || 720));

      // Background: prefer a real STUDIO IMAGE when one is supplied. HeyGen
      // composites the avatar into it natively, at source, in the right aspect —
      // which beats keying a portrait clip over a studio in our own compositor
      // (no green spill, no decapitation, correct scale and eyeline).
      const bgImage = String(body.background_image_url || '').trim();
      const background = bgImage
        ? { type: 'image', url: bgImage, fit: 'cover' }
        : { type: 'color', value: String(body.background_color || '#FBF4E4') };

      const payload = {
        video_inputs: [{
          character,
          voice: { type: 'audio', audio_url: audioUrl },
          background,
        }],
        dimension: { width, height },
      };
      const res = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST', headers: { ...hg, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) return json({ error: `HeyGen generate ${res.status}: ${(await res.text()).substring(0, 300)}` }, 502);
      const data = await res.json();
      const videoId = String(data?.data?.video_id || data?.video_id || '');
      if (!videoId) return json({ error: 'HeyGen returned no video_id: ' + JSON.stringify(data).substring(0, 200) }, 502);
      return json({ video_id: videoId });
    }

    if (action === 'status') {
      const videoId = String(body.video_id || '').trim();
      if (!videoId) return json({ error: 'video_id is required' }, 400);
      const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, { headers: hg });
      if (!res.ok) return json({ error: `HeyGen status ${res.status}: ${(await res.text()).substring(0, 200)}` }, 502);
      const data = await res.json();
      const st = data?.data || {};
      const status = String(st.status || 'unknown');
      if (status !== 'completed') {
        return json({ status, error_detail: st.error ? JSON.stringify(st.error).substring(0, 200) : null });
      }
      const videoUrl = String(st.video_url || '');
      if (!videoUrl) return json({ error: 'completed but no video_url' }, 502);
      const vid = await fetch(videoUrl);
      if (!vid.ok) return json({ error: `video download failed (${vid.status})` }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());
      const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const fileName = `newsroom/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
      const { error: upErr } = await supabase.storage.from('studio-assets')
        .upload(fileName, bytes, { contentType: 'video/mp4', upsert: false });
      if (upErr) return json({ error: `Storage upload failed: ${upErr.message}` }, 500);
      const { data: pub } = supabase.storage.from('studio-assets').getPublicUrl(fileName);
      return json({ status: 'completed', publicUrl: pub.publicUrl, fileName });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
