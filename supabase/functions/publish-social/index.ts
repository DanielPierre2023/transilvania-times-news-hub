// supabase/functions/publish-social/index.ts
//
// AUTO-POSTING — publishes to your channels. Two families of actions:
//
//   VIDEO (bulletins, from /admin/newsroom) — unchanged from the deployed base:
//     { action:'status' }
//     { action:'facebook',  video_url, description }          -> Page video
//     { action:'instagram', video_url, caption }              -> Reels container
//     { action:'instagram_status',  creation_id }
//     { action:'instagram_publish', creation_id }
//     { action:'youtube',   video_url, title, description, tags?, privacy? }
//
//   IMAGE + TEXT (article cards, from /admin/social) — NEW:
//     { action:'facebook_photo',  image_url, message?, first_comment? }
//                       -> Page photo; link goes in the first comment
//     { action:'facebook_link',   link, message? }            -> Page link post
//     { action:'instagram_image', image_url, caption? }       -> IMAGE container
//                       (then reuse instagram_status + instagram_publish)
//     { action:'instagram_comment', media_id, message }       -> first comment (hashtags)
//     { action:'x',        text, image_url? }                 -> tweet (+ media)
//     { action:'linkedin', text, image_url? }                 -> org post (+ image)
//
// Each platform is independently secret-gated: without its keys the UI shows
// "neconfigurat" and copy-paste still works.
//
// Secrets:
//   Meta (own Page / own IG Business — no App Review for own-surface posting):
//     FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN (pages_manage_posts, pages_manage_engagement
//     for comments, instagram_content_publish + instagram_manage_comments for IG),
//     IG_USER_ID
//   YouTube: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
//   X / Twitter (OAuth 1.0a user context; app needs Read+Write):
//     X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
//   LinkedIn (Community Management API; org page):
//     LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORG_URN (urn:li:organization:XXXX),
//     LINKEDIN_VERSION (optional, defaults below; bump to the current YYYYMM)
//
// Notes: videos must be MP4/H.264. Meta fetches image_url/video_url itself, so
// they must be publicly reachable (studio-assets is public). Instagram images
// must be JPEG. YouTube downloads the video into memory (keep bulletins small).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const GV = 'v21.0';                                              // Meta Graph API version
const LI_VERSION = Deno.env.get('LINKEDIN_VERSION') || '202508'; // LinkedIn monthly version

// ── admin gate (inlined; self-contained for dashboard paste) ─────────────────
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
    console.error('[requireAdmin] check failed, denying by default:', (e as Error).message);
    return deny(401, 'Unauthorized');
  }
}

// ── shared helpers ───────────────────────────────────────────────────────────
async function fetchImage(url: string): Promise<{ buf: ArrayBuffer; mime: string }> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`image download failed (${r.status})`);
  const mime = r.headers.get('content-type') || 'image/png';
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 100) throw new Error('image is empty');
  return { buf, mime };
}

// ── X / Twitter (OAuth 1.0a) ─────────────────────────────────────────────────
interface XCreds { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string }
function xCreds(): XCreds | null {
  const consumerKey = Deno.env.get('X_API_KEY');
  const consumerSecret = Deno.env.get('X_API_SECRET');
  const token = Deno.env.get('X_ACCESS_TOKEN');
  const tokenSecret = Deno.env.get('X_ACCESS_SECRET');
  if (consumerKey && consumerSecret && token && tokenSecret) return { consumerKey, consumerSecret, token, tokenSecret };
  return null;
}
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
async function hmacSha1B64(keyStr: string, baseStr: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(baseStr));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
// Signs only the oauth_* params (plus any explicit query params). Multipart and
// JSON bodies are not part of the signature base, which is exactly what the
// media/upload (multipart) and /2/tweets (JSON) endpoints expect.
async function oauth1Header(method: string, url: string, creds: XCreds, extra: Record<string, string> = {}): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.token,
    oauth_version: '1.0',
  };
  const all = { ...oauth, ...extra };
  const paramString = Object.keys(all).sort()
    .map(k => `${pctEncode(k)}=${pctEncode(all[k])}`).join('&');
  const base = [method.toUpperCase(), pctEncode(url), pctEncode(paramString)].join('&');
  const signingKey = `${pctEncode(creds.consumerSecret)}&${pctEncode(creds.tokenSecret)}`;
  const signature = await hmacSha1B64(signingKey, base);
  const headerParams: Record<string, string> = { ...oauth, oauth_signature: signature };
  return 'OAuth ' + Object.keys(headerParams).sort()
    .map(k => `${pctEncode(k)}="${pctEncode(headerParams[k])}"`).join(', ');
}
async function xUploadMedia(buf: ArrayBuffer, mime: string, creds: XCreds): Promise<string> {
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const auth = await oauth1Header('POST', url, creds);
  const fd = new FormData();
  fd.append('media', new Blob([buf], { type: mime || 'image/png' }), 'card');
  const res = await fetch(url, { method: 'POST', headers: { Authorization: auth }, body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`X media ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return String(data.media_id_string || data.media_id || '');
}
async function xTweet(text: string, mediaIds: string[], creds: XCreds): Promise<Record<string, unknown>> {
  const url = 'https://api.twitter.com/2/tweets';
  const auth = await oauth1Header('POST', url, creds);
  const payload: Record<string, unknown> = { text };
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`X tweet ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  return data;
}

// ── LinkedIn (Community Management / Posts API) ──────────────────────────────
function liCreds(): { token: string; orgUrn: string } | null {
  const token = Deno.env.get('LINKEDIN_ACCESS_TOKEN');
  const orgUrn = Deno.env.get('LINKEDIN_ORG_URN');
  if (token && orgUrn) return { token, orgUrn };
  return null;
}
// commentary uses LinkedIn's "little text" format: reserved characters must be
// escaped with a backslash or the API rejects the post (422). Escaping makes a
// hashtag render as plain text rather than a linked tag — an acceptable trade
// for the post actually going out. URLs contain none of these characters, so
// the link survives intact and clickable.
function liEscape(s: string): string {
  return s.replace(/[\\<>#~@|{}[\]()*_]/g, m => '\\' + m);
}
async function liRegisterImage(orgUrn: string, token: string): Promise<{ uploadUrl: string; imageUrn: string }> {
  const res = await fetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LI_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: orgUrn } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`init ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const v = (data.value || {}) as { uploadUrl?: string; image?: string };
  if (!v.uploadUrl || !v.image) throw new Error('init returned no uploadUrl/image');
  return { uploadUrl: v.uploadUrl, imageUrn: v.image };
}
async function liUpload(uploadUrl: string, token: string, buf: ArrayBuffer, mime: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime || 'application/octet-stream' },
    body: buf,
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`upload ${res.status}: ${t.slice(0, 150)}`); }
}
async function liCreatePost(orgUrn: string, token: string, commentary: string, imageUrn?: string, title?: string): Promise<string> {
  const payload: Record<string, unknown> = {
    author: orgUrn,
    commentary,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  if (imageUrn) payload.content = { media: { id: imageUrn, title: (title || 'Transilvania Times').slice(0, 100) } };
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': LI_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`LinkedIn post ${res.status}: ${t.slice(0, 250)}`); }
  return res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id') || '';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const denied = await requireAdmin(req);
  if (denied) return denied;
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
        x: !!xCreds(),
        linkedin: !!liCreds(),
      });
    }

    // ══ VIDEO actions (unchanged) ════════════════════════════════════════════

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

      const vidRes = await fetch(videoUrl);
      if (!vidRes.ok) return json({ error: `video download failed (${vidRes.status})` }, 400);
      const bytes = new Uint8Array(await vidRes.arrayBuffer());
      if (bytes.byteLength < 1000) return json({ error: 'video is empty' }, 400);

      const meta = {
        snippet: {
          title,
          description: String(body.description || ''),
          tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : undefined,
          categoryId: '25',
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

      const upRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.byteLength) },
        body: bytes,
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok) return json({ error: `YouTube upload ${upRes.status}: ${JSON.stringify(upData).substring(0, 250)}` }, 502);
      return json({ success: true, video_id: upData.id || null, url: upData.id ? `https://youtu.be/${upData.id}` : null });
    }

    // ══ IMAGE + TEXT actions (article cards) ═════════════════════════════════

    // ── FACEBOOK Page photo (+ link in the first comment) ─────────────────
    if (action === 'facebook_photo') {
      if (!fbPage || !fbTok) return json({ error: 'FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const imageUrl = String(body.image_url || '').trim();
      if (!imageUrl) return json({ error: 'image_url is required' }, 400);
      const form = new URLSearchParams();
      form.set('url', imageUrl);
      form.set('caption', String(body.message || ''));   // /photos: caption is the post text
      form.set('published', 'true');
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph.facebook.com/${GV}/${fbPage}/photos`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Facebook photo ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      const postId = data.post_id || null;
      const photoId = data.id || null;

      let commentId: string | null = null;
      let commentError: string | null = null;
      const firstComment = String(body.first_comment || '').trim();
      if (firstComment && postId) {
        const cf = new URLSearchParams();
        cf.set('message', firstComment);
        cf.set('access_token', fbTok);
        const cres = await fetch(`https://graph.facebook.com/${GV}/${postId}/comments`, { method: 'POST', body: cf });
        const cdata = await cres.json().catch(() => ({}));
        if (cres.ok) commentId = cdata.id || null;
        else commentError = `${cres.status}: ${JSON.stringify(cdata).substring(0, 180)}`;
      }
      return json({
        success: true, post_id: postId, photo_id: photoId,
        comment_id: commentId, comment_error: commentError,
        permalink: postId ? `https://www.facebook.com/${postId}` : null,
      });
    }

    // ── FACEBOOK Page link post (alternative to photo) ────────────────────
    if (action === 'facebook_link') {
      if (!fbPage || !fbTok) return json({ error: 'FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const link = String(body.link || '').trim();
      if (!link) return json({ error: 'link is required' }, 400);
      const form = new URLSearchParams();
      form.set('link', link);
      form.set('message', String(body.message || ''));
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph.facebook.com/${GV}/${fbPage}/feed`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Facebook link ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      return json({ success: true, post_id: data.id || null, permalink: data.id ? `https://www.facebook.com/${data.id}` : null });
    }

    // ── INSTAGRAM single image (container → reuse status/publish) ─────────
    //    media_type=STORIES routes a 9:16 card to an IG Story; otherwise it is
    //    a feed image (which IG only accepts at 0.8–1.91 aspect — a 9:16 card
    //    would be rejected as a feed post, hence the split).
    if (action === 'instagram_image') {
      if (!igUser || !fbTok) return json({ error: 'IG_USER_ID / FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const imageUrl = String(body.image_url || '').trim();
      if (!imageUrl) return json({ error: 'image_url is required' }, 400);
      const isStory = String(body.media_type || '') === 'STORIES';
      const form = new URLSearchParams();
      form.set('image_url', imageUrl);                   // IG requires a public JPEG
      if (isStory) form.set('media_type', 'STORIES');    // Stories ignore captions
      else form.set('caption', String(body.caption || ''));
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph.facebook.com/${GV}/${igUser}/media`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Instagram ${res.status}: ${JSON.stringify(data).substring(0, 300)}` }, 502);
      return json({ success: true, creation_id: data.id || null });
    }

    // ── INSTAGRAM first comment (hashtags) ────────────────────────────────
    if (action === 'instagram_comment') {
      if (!fbTok) return json({ error: 'FB_PAGE_ACCESS_TOKEN not set' }, 400);
      const mediaId = String(body.media_id || '').trim();
      const message = String(body.message || '').trim();
      if (!mediaId || !message) return json({ error: 'media_id and message are required' }, 400);
      const form = new URLSearchParams();
      form.set('message', message);
      form.set('access_token', fbTok);
      const res = await fetch(`https://graph.facebook.com/${GV}/${mediaId}/comments`, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: `Instagram comment ${res.status}: ${JSON.stringify(data).substring(0, 200)}` }, 502);
      return json({ success: true, comment_id: data.id || null });
    }

    // ── X / TWITTER (media upload + tweet) ────────────────────────────────
    if (action === 'x') {
      const creds = xCreds();
      if (!creds) return json({ error: 'X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET not set' }, 400);
      const text = String(body.text || '').trim();
      if (!text) return json({ error: 'text is required' }, 400);
      try {
        let mediaIds: string[] = [];
        const imageUrl = String(body.image_url || '').trim();
        if (imageUrl) {
          const { buf, mime } = await fetchImage(imageUrl);
          const id = await xUploadMedia(buf, mime, creds);
          if (id) mediaIds = [id];
        }
        const data = await xTweet(text, mediaIds, creds);
        const id = String((data?.data as { id?: string } | undefined)?.id || '');
        return json({ success: true, tweet_id: id || null, url: id ? `https://x.com/i/web/status/${id}` : null });
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }

    // ── LINKEDIN org post (image optional; falls back to text+link) ───────
    if (action === 'linkedin') {
      const creds = liCreds();
      if (!creds) return json({ error: 'LINKEDIN_ACCESS_TOKEN / LINKEDIN_ORG_URN not set' }, 400);
      const text = String(body.text || '').trim();
      if (!text) return json({ error: 'text is required' }, 400);
      try {
        let imageUrn: string | undefined;
        let imageNote: string | null = null;
        const imageUrl = String(body.image_url || '').trim();
        if (imageUrl) {
          try {
            const reg = await liRegisterImage(creds.orgUrn, creds.token);
            const { buf, mime } = await fetchImage(imageUrl);
            await liUpload(reg.uploadUrl, creds.token, buf, mime);
            imageUrn = reg.imageUrn;
          } catch (e) {
            imageNote = 'posted without image: ' + (e as Error).message;
          }
        }
        const urn = await liCreatePost(creds.orgUrn, creds.token, liEscape(text), imageUrn, String(body.title || ''));
        return json({
          success: true, post_urn: urn || null, image_note: imageNote,
          url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : null,
        });
      } catch (e) {
        return json({ error: (e as Error).message }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
