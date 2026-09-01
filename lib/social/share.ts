// lib/social/share.ts
//
// Shared social helpers + the automatic on-publish Facebook share.
//
// autoShareToFacebook() is the hands-off path: given an article id it renders
// the branded card, uploads it, runs tt-social-copy, and posts to the Page
// (card photo + caption WITH hashtags + link in the first comment), logging to
// social_posts. It is FULLY guarded — it never throws and never blocks the
// publish flow; on any problem it returns { ok:false, error } (and logs a
// 'failed' row) so the article still publishes normally.
//
// The manual Social Media Generator (app/admin/social/page.tsx) imports the
// small helpers (withUtm / dataURLToBlob / toJpegBlob / buildReachHashtags)
// and the SocialPack type from here so the two paths stay in lock-step.

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

export interface AutoShareResult { ok: boolean; skipped?: boolean; reason?: string; error?: string; permalink?: string }

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

// ── social_posts logging (best-effort; untyped insert, table from 04_...sql) ──
interface LogRow {
  article_id: string; platform: string; lang: string; format: string
  status: string; external_id?: string | null; permalink?: string | null
  campaign?: string | null; variant?: string | null; image_url?: string | null; error?: string | null
}
async function logSocial(supabase: SupaClient, row: LogRow): Promise<void> {
  try { await supabase.from('social_posts').insert(row) } catch { /* table missing — non-fatal */ }
}

interface ArticleRow {
  slug?: string | null; title_ro?: string | null; title_en?: string | null
  cover_image?: string | null; is_breaking?: boolean | null
  status?: string | null; skip_facebook?: boolean | null
}

// ── the auto-share ───────────────────────────────────────────────────────────
export async function autoShareToFacebook(supabase: SupaClient, articleId: string): Promise<AutoShareResult> {
  try {
    if (!articleId) return { ok: false, error: 'lipsește id-ul articolului' }

    // 1. Read the article + the per-article opt-out flag.
    const { data: artData, error: aErr } = await supabase
      .from('blog_posts')
      .select('slug, title_ro, title_en, cover_image, is_breaking, status, skip_facebook')
      .eq('id', articleId).single()
    if (aErr || !artData) return { ok: false, error: 'articolul nu a putut fi citit' }
    const art = artData as ArticleRow

    if (art.skip_facebook === true) return { ok: true, skipped: true, reason: 'marcat „nu posta pe Facebook”' }
    if (art.status !== 'published') return { ok: true, skipped: true, reason: 'articolul nu este publicat' }

    const cover = art.cover_image || ''
    const title = art.title_ro || art.title_en || ''
    if (!cover || !title) return { ok: false, error: 'lipsește coperta sau titlul' }

    // 2. Dedupe — already posted to Facebook for this article?
    const { data: existing } = await supabase
      .from('social_posts').select('id')
      .eq('article_id', articleId).eq('platform', 'facebook').eq('status', 'published').limit(1)
    if (Array.isArray(existing) && existing.length > 0) return { ok: true, skipped: true, reason: 'deja postat pe Facebook' }

    // 3. Render the branded card (square, RO) and upload it publicly.
    const dataUrl = await renderCard(
      cover, title, '/assets/logos/logo-transilvania-times.png',
      FORMATS.square, 'transilvaniatimes.com', art.is_breaking === true, 'ULTIMA ORĂ',
    )
    const slug = art.slug || articleId
    const path = `social/${slug}/auto-square-ro-${Date.now()}.png`
    const { error: upErr } = await supabase.storage.from('studio-assets')
      .upload(path, dataURLToBlob(dataUrl), { contentType: 'image/png', upsert: true })
    if (upErr) return { ok: false, error: 'încărcarea cardului a eșuat: ' + upErr.message }
    const imageUrl = supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl

    // 4. Generate the SEO + social pack (RO).
    const { data: packData, error: pErr } = await supabase.functions.invoke('tt-social-copy', { body: { post_id: articleId, lang: 'ro' } })
    if (pErr) return { ok: false, error: 'tt-social-copy: ' + pErr.message }
    const pack = packData as SocialPack
    if (!pack?.ok) return { ok: false, error: (packData as { error?: string })?.error || 'pachetul social a eșuat' }

    // 5. Caption (with hashtags for reach) + first comment (the link).
    const link = withUtm(pack.target_url, 'facebook', pack.campaign, 'hookA')
    const tags = buildReachHashtags(pack)
    const caption = tags ? `${pack.platforms.facebook.post}\n\n${tags}` : pack.platforms.facebook.post
    const firstComment = pack.platforms.facebook.first_comment.includes('[LINK]')
      ? pack.platforms.facebook.first_comment.replace(/\[LINK\]/g, link)
      : `${pack.platforms.facebook.first_comment} ${link}`.trim()

    // 6. Publish.
    const { data: postData, error: postErr } = await supabase.functions.invoke('publish-social', {
      body: { action: 'facebook_photo', image_url: imageUrl, message: caption, first_comment: firstComment },
    })
    const base = { article_id: articleId, platform: 'facebook', lang: 'ro', format: 'square', campaign: pack.campaign, variant: 'hookA', image_url: imageUrl }
    if (postErr) { await logSocial(supabase, { ...base, status: 'failed', error: postErr.message }); return { ok: false, error: 'publish-social: ' + postErr.message } }
    const pd = (postData || {}) as { error?: string; post_id?: string; permalink?: string }
    if (pd.error) { await logSocial(supabase, { ...base, status: 'failed', error: pd.error }); return { ok: false, error: pd.error } }

    await logSocial(supabase, { ...base, status: 'published', external_id: pd.post_id || null, permalink: pd.permalink || null })
    return { ok: true, permalink: pd.permalink || undefined }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
