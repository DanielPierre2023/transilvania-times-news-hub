// lib/social/share.ts
//
// Shared social helpers + the automatic on-publish multi-platform share.
//
// autoShareOnPublish() is the hands-off path: given an article id it renders the
// branded card once, uploads it, runs tt-social-copy once, then fans the article
// OUT to every *configured* channel — Facebook, Instagram, LinkedIn — reusing the
// same deployed `publish-social` edge function the manual /admin/social page uses.
// X is intentionally not wired.
//
// It is status-driven: it asks publish-social which platforms have their secrets
// set and only posts where a token exists, so each network switches itself on the
// moment its secret lands — no code change per platform. It is FULLY guarded — it
// never throws and never blocks the publish; each platform is independent, so one
// failing never stops the others. Every attempt logs a social_posts row (published
// or failed), and a per-platform dedupe means re-publishing an article posts only
// to the networks it hasn't reached yet.
//
// The manual Social Media Generator (app/admin/social/page.tsx) imports the small
// helpers (withUtm / dataURLToBlob / toJpegBlob / buildReachHashtags) and the
// SocialPack type from here so the two paths stay in lock-step.

import { createBrowserClient } from '@supabase/ssr'
import { renderCard, FORMATS } from './card'

// The client both callers (ArticleEditor, articles list) already use.
type SupaClient = ReturnType<typeof createBrowserClient>

// ── tt-social-copy pack shape (shared with /admin/social) ────────────────────
export interface PackPlatforms {
  facebook: { post: string; first_comment: string; hashtags: string[] }
  instagram_feed: { caption: string; alt_text: string; cover_text: string; first_comment_hashtags: string; hashtags: string[] }
  instagram_story: { text: string }
  x: { post: string; hashtags: string[] }
  linkedin: { post: string; hashtags: string[] }
}
export interface SocialPack {
  ok: boolean
  lang: 'ro' | 'en'
  target_url: string
  campaign: string
  best_hours: string
  primary_keyword: string
  keywords: { primary: string; entities: string[]; questions: string[] }
  discover_headline: string
  variants: { hookA: string; hookB: string }
  hashtag_tiers: { broad: string[]; geo: string[]; entity: string[]; brand: string[] }
  platforms: PackPlatforms
}

// ── result shapes ────────────────────────────────────────────────────────────
export type SharePlatform = 'facebook' | 'instagram' | 'linkedin'
export interface PlatformShareResult {
  platform: SharePlatform
  ok: boolean
  skipped?: boolean
  reason?: string
  error?: string
  permalink?: string
}
export interface AutoShareSummary {
  ran: boolean                 // was the article eligible and did we attempt platforms?
  note?: string                // whole-article skip reason, or a setup error before any platform
  results: PlatformShareResult[]
}

// ── small helpers (shared) ───────────────────────────────────────────────────
export function withUtm(url: string, source: string, campaign: string, content: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', source)
    u.searchParams.set('utm_medium', 'social')
    if (campaign) u.searchParams.set('utm_campaign', campaign)
    if (content) u.searchParams.set('utm_content', content)
    return u.toString()
  } catch { return url }
}
export function dataURLToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] || 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
export function toJpegBlob(dataUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const ctx = c.getContext('2d')
      if (!ctx) { reject(new Error('no 2d context')); return }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0)
      c.toBlob(b => b ? resolve(b) : reject(new Error('jpeg encode failed')), 'image/jpeg', 0.92)
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = dataUrl
  })
}
// Reach hashtags: all tiers (broad + geo + entity + brand), deduped, capped.
export function buildReachHashtags(pack: SocialPack, max = 8): string {
  const t = pack.hashtag_tiers || { broad: [], geo: [], entity: [], brand: [] }
  const all = [...(t.broad || []), ...(t.geo || []), ...(t.entity || []), ...(t.brand || [])]
  const seen = new Set<string>(); const out: string[] = []
  for (const raw of all) {
    const h = (raw || '').trim(); const k = h.toLowerCase()
    if (h && !seen.has(k)) { seen.add(k); out.push(h); if (out.length >= max) break }
  }
  return out.join(' ')
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── social_posts logging (best-effort; untyped insert, table from 04_...sql) ──
interface LogRow {
  article_id: string; platform: string; lang: string; format: string
  status: string; external_id?: string | null; permalink?: string | null
  campaign?: string | null; variant?: string | null; image_url?: string | null; error?: string | null
}
async function logSocial(supabase: SupaClient, row: LogRow): Promise<void> {
  try { await supabase.from('social_posts').insert(row) } catch { /* table missing — non-fatal */ }
}
async function alreadyPosted(supabase: SupaClient, articleId: string, platform: SharePlatform): Promise<boolean> {
  try {
    const { data } = await supabase.from('social_posts').select('id')
      .eq('article_id', articleId).eq('platform', platform).eq('status', 'published').limit(1)
    return Array.isArray(data) && data.length > 0
  } catch { return false }
}

interface ArticleRow {
  slug?: string | null; title_ro?: string | null; title_en?: string | null
  cover_image?: string | null; is_breaking?: boolean | null
  status?: string | null; skip_facebook?: boolean | null; category?: string | null
}

// Everything a platform poster needs (built once, reused by all).
interface ShareCtx {
  articleId: string
  slug: string
  title: string
  pack: SocialPack
  imagePngUrl: string          // FB + LinkedIn (crisp text)
  imageJpegUrl: string | null  // Instagram (IG rejects PNG); null if not needed/failed
}

// ── per-platform posters (each dedupes, posts, logs; never throws) ────────────

async function postFacebook(supabase: SupaClient, ctx: ShareCtx): Promise<PlatformShareResult> {
  const platform: SharePlatform = 'facebook'
  try {
    if (await alreadyPosted(supabase, ctx.articleId, platform)) return { platform, ok: true, skipped: true, reason: 'deja postat' }
    const fb = ctx.pack.platforms.facebook
    const link = withUtm(ctx.pack.target_url, 'facebook', ctx.pack.campaign, 'hookA')
    const tags = buildReachHashtags(ctx.pack)
    const message = tags ? `${fb.post}\n\n${tags}` : fb.post
    const firstComment = fb.first_comment.includes('[LINK]')
      ? fb.first_comment.replace(/\[LINK\]/g, link)
      : `${fb.first_comment} ${link}`.trim()

    const { data, error } = await supabase.functions.invoke('publish-social', {
      body: { action: 'facebook_photo', image_url: ctx.imagePngUrl, message, first_comment: firstComment },
    })
    const base = { article_id: ctx.articleId, platform, lang: 'ro', format: 'square', campaign: ctx.pack.campaign, variant: 'hookA', image_url: ctx.imagePngUrl }
    if (error) { await logSocial(supabase, { ...base, status: 'failed', error: error.message }); return { platform, ok: false, error: error.message } }
    const pd = (data || {}) as { error?: string; post_id?: string; permalink?: string }
    if (pd.error) { await logSocial(supabase, { ...base, status: 'failed', error: pd.error }); return { platform, ok: false, error: pd.error } }
    await logSocial(supabase, { ...base, status: 'published', external_id: pd.post_id || null, permalink: pd.permalink || null })
    return { platform, ok: true, permalink: pd.permalink || undefined }
  } catch (e) { return { platform, ok: false, error: (e as Error).message } }
}

async function postInstagram(supabase: SupaClient, ctx: ShareCtx): Promise<PlatformShareResult> {
  const platform: SharePlatform = 'instagram'
  const base = { article_id: ctx.articleId, platform, lang: 'ro', format: 'square', campaign: ctx.pack.campaign, variant: 'hookA', image_url: ctx.imageJpegUrl }
  try {
    if (await alreadyPosted(supabase, ctx.articleId, platform)) return { platform, ok: true, skipped: true, reason: 'deja postat' }
    if (!ctx.imageJpegUrl) { await logSocial(supabase, { ...base, status: 'failed', error: 'card JPEG indisponibil' }); return { platform, ok: false, error: 'card JPEG indisponibil' } }
    const ig = ctx.pack.platforms.instagram_feed
    const caption = (ig?.caption || ctx.pack.platforms.facebook.post || ctx.title).trim()

    // 1. Create the image container.
    const { data: cData, error: cErr } = await supabase.functions.invoke('publish-social', {
      body: { action: 'instagram_image', image_url: ctx.imageJpegUrl, caption },
    })
    if (cErr) { await logSocial(supabase, { ...base, status: 'failed', error: cErr.message }); return { platform, ok: false, error: cErr.message } }
    const creationId = (cData as { creation_id?: string; error?: string })?.creation_id || ''
    const cGraphErr = (cData as { error?: string })?.error
    if (cGraphErr || !creationId) { const m = cGraphErr || 'container fără creation_id'; await logSocial(supabase, { ...base, status: 'failed', error: m }); return { platform, ok: false, error: m } }

    // 2. Poll the container until FINISHED (images are usually quick).
    let ready = false; let statusErr = 'container neprocesat (timeout)'
    for (let i = 0; i < 6; i++) {
      await sleep(i === 0 ? 1200 : 2200)
      const { data: sData, error: sErr } = await supabase.functions.invoke('publish-social', { body: { action: 'instagram_status', creation_id: creationId } })
      if (sErr) { statusErr = sErr.message; continue }
      const sc = (sData as { status_code?: string })?.status_code || ''
      if (sc === 'FINISHED') { ready = true; break }
      if (sc === 'ERROR' || sc === 'EXPIRED') { statusErr = `container ${sc}`; break }
    }
    if (!ready) { await logSocial(supabase, { ...base, status: 'failed', error: statusErr }); return { platform, ok: false, error: statusErr } }

    // 3. Publish the container.
    const { data: pData, error: pErr } = await supabase.functions.invoke('publish-social', { body: { action: 'instagram_publish', creation_id: creationId } })
    if (pErr) { await logSocial(supabase, { ...base, status: 'failed', error: pErr.message }); return { platform, ok: false, error: pErr.message } }
    const pGraphErr = (pData as { error?: string })?.error
    const mediaId = (pData as { media_id?: string })?.media_id || ''
    if (pGraphErr || !mediaId) { const m = pGraphErr || 'publicare fără media_id'; await logSocial(supabase, { ...base, status: 'failed', error: m }); return { platform, ok: false, error: m } }

    // 4. Hashtags as the first comment (best-effort; caption stays clean).
    const igTags = (ig?.first_comment_hashtags || buildReachHashtags(ctx.pack, 15) || '').trim()
    if (igTags) {
      try { await supabase.functions.invoke('publish-social', { body: { action: 'instagram_comment', media_id: mediaId, message: igTags } }) } catch { /* comment optional */ }
    }
    // IG's media_id has no public shortcode we can turn into a URL, so we log the
    // id for audit but return no permalink (the flash just shows "IG ✓").
    await logSocial(supabase, { ...base, status: 'published', external_id: mediaId, permalink: null })
    return { platform, ok: true }
  } catch (e) { await logSocial(supabase, { ...base, status: 'failed', error: (e as Error).message }); return { platform, ok: false, error: (e as Error).message } }
}

async function postLinkedIn(supabase: SupaClient, ctx: ShareCtx): Promise<PlatformShareResult> {
  const platform: SharePlatform = 'linkedin'
  try {
    if (await alreadyPosted(supabase, ctx.articleId, platform)) return { platform, ok: true, skipped: true, reason: 'deja postat' }
    const li = ctx.pack.platforms.linkedin
    const link = withUtm(ctx.pack.target_url, 'linkedin', ctx.pack.campaign, 'hookA')
    // LinkedIn's Posts API escapes reserved characters (so hashtags can't be
    // clickable there) — keep the body to the copy + the (clickable) link.
    const text = `${li?.post || ctx.title}\n\n${link}`.trim()

    const { data, error } = await supabase.functions.invoke('publish-social', {
      body: { action: 'linkedin', text, image_url: ctx.imagePngUrl, title: ctx.title },
    })
    const base = { article_id: ctx.articleId, platform, lang: 'ro', format: 'square', campaign: ctx.pack.campaign, variant: 'hookA', image_url: ctx.imagePngUrl }
    if (error) { await logSocial(supabase, { ...base, status: 'failed', error: error.message }); return { platform, ok: false, error: error.message } }
    const pd = (data || {}) as { error?: string; post_urn?: string; url?: string }
    if (pd.error) { await logSocial(supabase, { ...base, status: 'failed', error: pd.error }); return { platform, ok: false, error: pd.error } }
    await logSocial(supabase, { ...base, status: 'published', external_id: pd.post_urn || null, permalink: pd.url || null })
    return { platform, ok: true, permalink: pd.url || undefined }
  } catch (e) { return { platform, ok: false, error: (e as Error).message } }
}

// ── the orchestrator ─────────────────────────────────────────────────────────
export async function autoShareOnPublish(supabase: SupaClient, articleId: string): Promise<AutoShareSummary> {
  try {
    if (!articleId) return { ran: false, note: 'lipsește id-ul articolului', results: [] }

    // 1. Read the article + the per-article opt-out flag.
    const { data: artData, error: aErr } = await supabase
      .from('blog_posts')
      .select('slug, title_ro, title_en, cover_image, is_breaking, status, skip_facebook, category')
      .eq('id', articleId).single()
    if (aErr || !artData) return { ran: false, note: 'articolul nu a putut fi citit', results: [] }
    const art = artData as ArticleRow

    if (art.skip_facebook === true) return { ran: false, note: 'marcat „nu posta pe rețele sociale”', results: [] }
    if (art.status !== 'published') return { ran: false, note: 'articolul nu este publicat', results: [] }

    const cover = art.cover_image || ''
    const title = art.title_ro || art.title_en || ''
    if (!cover || !title) return { ran: false, note: 'lipsește coperta sau titlul', results: [] }

    // 2. Which platforms are configured? (X is intentionally never attempted.)
    let cfg = { facebook: false, instagram: false, linkedin: false }
    const { data: stData, error: stErr } = await supabase.functions.invoke('publish-social', { body: { action: 'status' } })
    if (!stErr && stData) {
      const s = stData as { facebook?: boolean; instagram?: boolean; linkedin?: boolean }
      cfg = { facebook: !!s.facebook, instagram: !!s.instagram, linkedin: !!s.linkedin }
    } else {
      cfg.facebook = true  // status unreachable — attempt the known-configured baseline
    }
    if (!cfg.facebook && !cfg.instagram && !cfg.linkedin) return { ran: true, results: [] }

    // 3. Render the branded card once; upload PNG (FB/LinkedIn) + JPEG (IG only).
    const dataUrl = await renderCard({
      coverUrl: cover, title, rubric: (art.category || '').toUpperCase(),
      domain: 'transilvaniatimes.com', logoUrl: '/assets/logos/logo-transilvania-times.png',
      format: FORMATS.portrait, isBreaking: art.is_breaking === true, breakingLabel: 'ULTIMA ORĂ',
      band: 'cream',
    })
    const slug = art.slug || articleId
    const stem = `social/${slug}/auto-card-ro-${Date.now()}`
    const { error: upErr } = await supabase.storage.from('studio-assets')
      .upload(`${stem}.png`, dataURLToBlob(dataUrl), { contentType: 'image/png', upsert: true })
    if (upErr) return { ran: true, note: 'încărcarea cardului a eșuat: ' + upErr.message, results: [] }
    const imagePngUrl = supabase.storage.from('studio-assets').getPublicUrl(`${stem}.png`).data.publicUrl

    let imageJpegUrl: string | null = null
    if (cfg.instagram) {
      try {
        const jpeg = await toJpegBlob(dataUrl)
        const { error: jErr } = await supabase.storage.from('studio-assets').upload(`${stem}.jpg`, jpeg, { contentType: 'image/jpeg', upsert: true })
        if (!jErr) imageJpegUrl = supabase.storage.from('studio-assets').getPublicUrl(`${stem}.jpg`).data.publicUrl
      } catch { /* Instagram poster will report the missing JPEG */ }
    }

    // 4. Generate the SEO + social pack once (RO), reused by every platform.
    const { data: packData, error: pErr } = await supabase.functions.invoke('tt-social-copy', { body: { post_id: articleId, lang: 'ro' } })
    if (pErr) return { ran: true, note: 'tt-social-copy: ' + pErr.message, results: [] }
    const pack = packData as SocialPack
    if (!pack?.ok) return { ran: true, note: (packData as { error?: string })?.error || 'pachetul social a eșuat', results: [] }

    // 5. Fan out — sequential, independent, deduped.
    const ctx: ShareCtx = { articleId, slug, title, pack, imagePngUrl, imageJpegUrl }
    const results: PlatformShareResult[] = []
    if (cfg.facebook) results.push(await postFacebook(supabase, ctx))
    if (cfg.instagram) results.push(await postInstagram(supabase, ctx))
    if (cfg.linkedin) results.push(await postLinkedIn(supabase, ctx))
    return { ran: true, results }
  } catch (e) {
    return { ran: false, note: (e as Error).message, results: [] }
  }
}

// A compact status string for the editor flash, e.g. " · FB ✓ · IG ✓ · LinkedIn ⚠".
export function shareFlash(s: AutoShareSummary): string {
  if (!s.ran) return s.note ? ` · ${s.note}` : ''
  if (!s.results.length) return s.note ? ` · ⚠ ${s.note}` : ''
  const label = (p: SharePlatform) => (p === 'facebook' ? 'FB' : p === 'instagram' ? 'IG' : 'LinkedIn')
  const parts = s.results.map(r =>
    r.ok && !r.skipped ? `${label(r.platform)} ✓`
      : r.skipped ? `${label(r.platform)}: ${r.reason || 'sărit'}`
        : `${label(r.platform)} ⚠ ${r.error || 'a eșuat'}`)
  return ' · ' + parts.join(' · ')
}
