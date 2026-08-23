// supabase/functions/publish-social/index.ts
//
// AUTO-POSTING — publishes a rendered video (public URL in studio-assets)
// directly to your channels. Each platform is independently key-gated: without
// its secrets the UI simply shows "neconfigurat" and copy-paste still works.
//
// Actions:
//   { action:'status' }                                    -> which platforms are configured
//   { action:'facebook',  video_url, description }         -> posts a Page video
//   { action:'instagram', video_url, caption }             -> creates a Reels container
//   { action:'instagram_status',  creation_id }            -> container status
//   { action:'instagram_publish', creation_id }            -> publishes the container
//   { action:'youtube',   video_url, title, description, tags?, privacy? }
//                                                          -> resumable upload
//
// Secrets:
//   Meta (one app, your own Page — no App Review needed for own-page posting):
//     FB_PAGE_ID            — the Facebook Page id
//     FB_PAGE_ACCESS_TOKEN  — long-lived PAGE access token with
//                             pages_manage_posts (+ instagram_content_publish for IG)
//     IG_USER_ID            — the Instagram Business account id linked to the Page
//   YouTube (OAuth refresh-token flow):
//     YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
//
// Notes: videos must be MP4/H.264 (Chrome's recorder output qualifies; WebM is
// rejected by IG). Facebook/IG fetch the video themselves from video_url, so it
// must be publicly reachable (studio-assets is public). YouTube is uploaded by
// this function (video is downloaded into memory — keep bulletins ≤ ~100MB).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const GV = 'v21.0'; // Meta Graph API version

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    const fbPage = Deno.env.get('FB_PAGE_ID');
    const fbTok = Deno.env.get('FB_PAGE_ACCESS_TOKEN');
    const igUser = Deno.env.get('IG_USER_ID');
    const ytId = Deno.env.get('YT_CLIENT_ID');
    const ytSecret = Deno.env.get('YT_CLIENT_SECRET');
    const ytRefresh = Deno.env.get('YT_REFRESH_TOKEN');

    if (action === 'status') {
      return json({
        facebook: !!(fbPage && fbTok),
        instagram: !!(igUser && fbTok),
        youtube: !!(ytId && ytSecret && ytRefresh),
      });
    }

    // ── FACEBOOK Page video ───────────────────────────────────────────────
    if (action === 'facebook') {
      if (!fbPage || !fbTok) return json({ error: 'FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const videoUrl = String(body.video_url || '').trim();
      if (!videoUrl) return json({ error: 'video_url is required' }, 400);
      const form = new URLSearchParams();
      form.set('file_url', videoUrl);
      form.set('description', String(body.description || ''));
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph-video.facebook.com/${GV}/${fbPage}/videos`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Facebook ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      return json({ success: true, post_id: data.id || null });
    }

    // ── INSTAGRAM Reels (container → status → publish) ────────────────────
    if (action === 'instagram') {
      if (!igUser || !fbTok) return json({ error: 'IG_USER_ID / FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const videoUrl = String(body.video_url || '').trim();
      if (!videoUrl) return json({ error: 'video_url is required' }, 400);
      const form = new URLSearchParams();
      form.set('media_type', 'REELS');
      form.set('video_url', videoUrl);
      form.set('caption', String(body.caption || ''));
      form.set('share_to_feed', 'true');
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph.facebook.com/${GV}/${igUser}/media`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Instagram ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      return json({ success: true, creation_id: data.id || null });
    }
    if (action === 'instagram_status') {
      if (!fbTok) return json({ error: 'FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const id = String(body.creation_id || '').trim();
      if (!id) return json({ error: 'creation_id is required' }, 400);
      const res = await fetch(`https://graph.facebook.com/${GV}/${id}?fields=status_code,status&access_token=${encodeURIComponent(fbTok)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Instagram ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      return json({ status_code: data.status_code || '', status: data.status || '' });
    }
    if (action === 'instagram_publish') {
      if (!igUser || !fbTok) return json({ error: 'IG_USER_ID / FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const id = String(body.creation_id || '').trim();
      if (!id) return json({ error: 'creation_id is required' }, 400);
      const form = new URLSearchParams();
      form.set('creation_id', id);
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph.facebook.com/${GV}/${igUser}/media_publish`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Instagram ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      return json({ success: true, media_id: data.id || null });
    }

    // ── YOUTUBE resumable upload ──────────────────────────────────────────
    if (action === 'youtube') {
      if (!ytId || !ytSecret || !ytRefresh) return json({ error: 'YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN not set' }, 400);
      const videoUrl = String(body.video_url || '').trim();
      const title = String(body.title || 'Buletinul zilei — Transilvania Times').slice(0, 95);
      if (!videoUrl) return json({ error: 'video_url is required' }, 400);

      // 1. Refresh token → access token.
      const tokRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: ytId, client_secret: ytSecret,
          refresh_token: ytRefresh, grant_type: 'refresh_token',
        }),
      });
      const tok = await tokRes.json().catch(() => ({}));
      if (!tokRes.ok || !tok.access_token) return json({ error: `YouTube auth ${tokRes.status}: ${JSON.stringify(tok).substring(0, 250)}` }, 502);

      // 2. Download the video.
      const vidRes = await fetch(videoUrl);
      if (!vidRes.ok) return json({ error: `video download failed (${vidRes.status})` }, 400);
      const bytes = new Uint8Array(await vidRes.arrayBuffer());
      if (bytes.byteLength < 1000) return json({ error: 'video is empty' }, 400);

      // 3. Start resumable session.
      const meta = {
        snippet: {
          title,
          description: String(body.description || ''),
          tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : undefined,
          categoryId: '25', // News & Politics
          defaultLanguage: String(body.language || 'ro'),
        },
        status: { privacyStatus: ['public', 'unlisted', 'private'].includes(String(body.privacy)) ? String(body.privacy) : 'public', selfDeclaredMadeForKids: false },
      };
      const initRes = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok.access_token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(bytes.byteLength),
          'X-Upload-Content-Type': 'video/mp4',
        },
        body: JSON.stringify(meta),
      });
      if (!initRes.ok) return json({ error: `YouTube init ${initRes.status}: ${(await initRes.text()).substring(0, 250)}` }, 502);
      const uploadUrl = initRes.headers.get('location');
      if (!uploadUrl) return json({ error: 'YouTube returned no upload URL' }, 502);

      // 4. Upload bytes.
      const upRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) },
        body: bytes,
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok) return json({ error: `YouTube upload ${upRes.status}: ${JSON.stringify(upData).substring(0, 250)}` }, 502);
      return json({ success: true, video_id: upData.id || null, url: upData.id ? `https://youtu.be/${upData.id}` : null });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
