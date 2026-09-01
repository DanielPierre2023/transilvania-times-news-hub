'use client'

// app/admin/social/page.tsx — Social Media Generator.
// Card rendering now lives in @/lib/social/card (shared with the automatic
// on-publish Facebook share); the small helpers + the SocialPack type live in
// @/lib/social/share, so the manual and automatic paths stay in lock-step.

import { useState, useEffect, useCallback, useRef } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { Download, RefreshCw, Image as ImageIcon, Radio, Sparkles, Copy, Check, Share2, Loader2, Clock, Hash, ExternalLink } from 'lucide-react'
import { FORMATS, renderCard, type Lang } from '@/lib/social/card'
import { withUtm, dataURLToBlob, toJpegBlob, buildReachHashtags, type SocialPack } from '@/lib/social/share'

interface Article {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  published_at: string | null
  is_breaking: boolean | null
}

// ─── SOCIAL PACK (from tt-social-copy v2 edge function) ───────────────────────
// Article-side twin of the newsroom's SeoPack: a Discover headline, keyword
// layer, tiered hashtags, hookA/hookB A/B variants and per-platform native copy.


type Variant = 'hookA' | 'hookB'
type Platform = 'facebook' | 'instagram' | 'x' | 'linkedin'
interface PubStatus { facebook: boolean; instagram: boolean; youtube: boolean; x: boolean; linkedin: boolean }

const PLATFORMS: { key: Platform; label: string; dot: string }[] = [
  { key: 'facebook', label: 'Facebook', dot: '#1877F2' },
  { key: 'instagram', label: 'Instagram', dot: '#E1306C' },
  { key: 'x', label: 'X', dot: '#7A7A7A' },
  { key: 'linkedin', label: 'LinkedIn', dot: '#0A66C2' },
]

export default function SocialPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [lang, setLang] = useState<Lang>('ro')
  const [title, setTitle] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [formatKey, setFormatKey] = useState<string>('story')
  const [isBreaking, setIsBreaking] = useState(false)
  const [breakingLabel, setBreakingLabel] = useState('BREAKING NEWS')
  const [ctaRo, setCtaRo] = useState('transilvaniatimes.com')
  const [ctaEn, setCtaEn] = useState('transilvaniatimes.com')
  const [showOnlyBreaking, setShowOnlyBreaking] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [imageData, setImageData] = useState('')
  const [logoUrl] = useState('/assets/logos/logo-transilvania-times.png')

  // ── SEO / social pack ──────────────────────────────────────────────────────
  const [copy, setCopy] = useState<SocialPack | null>(null)
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [copiedKey, setCopiedKey] = useState('')
  const [variant, setVariant] = useState<Variant>('hookA')

  // ── Direct publishing ──────────────────────────────────────────────────────
  const [pub, setPub] = useState<PubStatus | null>(null)
  const [pubBusy, setPubBusy] = useState<Platform | ''>('')
  const [pubMsg, setPubMsg] = useState<Record<string, string>>({})
  // Cache the uploaded public card URLs, keyed by the exact image currently shown.
  const uploadedRef = useRef<{ data: string; png?: string; jpg?: string }>({ data: '' })

  const supabase = createSupabaseBrowserClient()
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  useEffect(() => {
    supabase
      .from('blog_posts')
      .select('id, slug, title_ro, title_en, cover_image, published_at, is_breaking')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setArticles((data || []) as Article[]))
  }, [supabase])

  // Which platforms are wired (secret-gated in the edge function).
  useEffect(() => {
    ;(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('publish-social', { body: { action: 'status' } })
        if (!error && data) setPub(data as PubStatus)
      } catch { /* function not deployed yet — panel shows "verifică" */ }
    })()
  }, [supabase])

  const selectArticle = useCallback((id: string) => {
    setSelectedId(id)
    setImageData('')
    setCopy(null); setCopyError(''); setPubMsg({})
    const a = articles.find(x => x.id === id)
    if (a) {
      setTitle(lang === 'ro' ? (a.title_ro || a.title_en || '') : (a.title_en || a.title_ro || ''))
      setCoverUrl(a.cover_image || '')
      setIsBreaking(a.is_breaking === true)
    }
  }, [articles, lang])

  const switchLang = useCallback((newLang: Lang) => {
    setLang(newLang)
    setImageData('')
    setCopy(null); setCopyError(''); setPubMsg({})
    if (selectedId) {
      const a = articles.find(x => x.id === selectedId)
      if (a) {
        setTitle(newLang === 'ro' ? (a.title_ro || a.title_en || '') : (a.title_en || a.title_ro || ''))
      }
    }
  }, [selectedId, articles])

  const currentCta = lang === 'ro' ? ctaRo : ctaEn

  const generate = useCallback(async () => {
    if (!title || !coverUrl) return
    setGenerating(true)
    setImageData('')
    try {
      const fmt = FORMATS[formatKey]
      const data = await renderCard(coverUrl, title, logoUrl, fmt, currentCta, isBreaking, breakingLabel)
      setImageData(data)
    } catch (e) {
      console.error('Gen failed:', e)
    }
    setGenerating(false)
  }, [title, coverUrl, formatKey, logoUrl, currentCta, isBreaking, breakingLabel])

  // Generate the reach-optimized SEO + social pack for the selected article.
  const generateCopy = useCallback(async () => {
    if (!selectedId) return
    setCopyLoading(true)
    setCopyError('')
    setCopy(null)
    setVariant('hookA')
    try {
      const { data, error } = await supabase.functions.invoke('tt-social-copy', {
        body: { post_id: selectedId, lang },
      })
      if (error) throw new Error(error.message)
      if (!data?.ok) throw new Error(data?.error || 'Generarea textului a eșuat.')
      setCopy(data as SocialPack)
    } catch (e) {
      setCopyError((e as Error).message)
    }
    setCopyLoading(false)
  }, [selectedId, lang, supabase])

  const copyToClipboard = useCallback((key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(''), 1600)
    }).catch(() => {})
  }, [])

  const download = useCallback(() => {
    if (!imageData) return
    const a = document.createElement('a')
    a.href = imageData
    const slug = articles.find(x => x.id === selectedId)?.slug || 'social'
    const breakingTag = isBreaking ? '-breaking' : ''
    a.download = `tt-${lang}-${formatKey}${breakingTag}-${slug.substring(0, 35)}.png`
    a.click()
  }, [imageData, lang, formatKey, selectedId, articles, isBreaking])

  // ── Direct-publish plumbing ─────────────────────────────────────────────────

  // supabase-js hides the function's real {error} body inside error.context.
  async function invokeRaw(fn: string, reqBody: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke(fn, { body: reqBody })
    if (error) {
      let detail = ''
      const ctx = (error as { context?: unknown }).context
      if (ctx && typeof (ctx as Response).json === 'function') {
        try {
          const b = await (ctx as Response).clone().json() as Record<string, unknown>
          if (b && typeof b.error === 'string') detail = b.error
        } catch { /* not JSON */ }
      }
      throw new Error(detail || error.message)
    }
    const d = (data || {}) as Record<string, unknown>
    if (typeof d.error === 'string' && d.error) throw new Error(d.error)
    return d
  }

  const linkFor = (source: string) => copy ? withUtm(copy.target_url, source, copy.campaign, variant) : ''

  async function uploadCard(blob: Blob, ext: string): Promise<string> {
    const slug = articles.find(a => a.id === selectedId)?.slug || selectedId || 'card'
    const path = `social/${slug}/${formatKey}-${lang}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('studio-assets')
      .upload(path, blob, { contentType: blob.type || (ext === 'jpg' ? 'image/jpeg' : 'image/png'), upsert: true })
    if (error) throw new Error('Încărcarea imaginii a eșuat: ' + error.message)
    return supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
  }

  // Meta/X/LinkedIn all fetch the image by URL, so the card must live at a public
  // URL first. Upload once per generated card and per format (PNG, or JPEG for IG).
  async function ensureCardUrl(kind: 'png' | 'jpg'): Promise<string> {
    if (!imageData) throw new Error('Generează imaginea întâi.')
    if (uploadedRef.current.data !== imageData) uploadedRef.current = { data: imageData }
    const cache = uploadedRef.current
    if (kind === 'png') {
      if (!cache.png) cache.png = await uploadCard(dataURLToBlob(imageData), 'png')
      return cache.png
    }
    if (!cache.jpg) cache.jpg = await uploadCard(await toJpegBlob(imageData), 'jpg')
    return cache.jpg
  }

  async function logSocialPost(platform: Platform, externalId: string, permalink: string) {
    try {
      // social_posts is created by supabase/sql/04_article_ab_and_social_posts.sql.
      // The generated Database types won't include it until they are regenerated,
      // so this one insert is intentionally loosely typed (rather than forcing a
      // type regen before the page can build). Regenerate types later to tighten it.
      const table = supabase.from('social_posts' as never) as unknown as {
        insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
      }
      await table.insert({
        article_id: selectedId || null,
        platform, lang, format: formatKey, status: 'published',
        external_id: externalId || null, permalink: permalink || null,
        campaign: copy?.campaign || null, variant,
        image_url: uploadedRef.current.png || uploadedRef.current.jpg || null,
      })
    } catch { /* social_posts table not created yet — publishing still worked */ }
  }

  async function publishTo(platform: Platform) {
    if (!copy) { setPubMsg(m => ({ ...m, [platform]: 'Generează întâi textul social.' })); return }
    if (!imageData) { setPubMsg(m => ({ ...m, [platform]: 'Generează întâi imaginea.' })); return }
    setPubBusy(platform); setPubMsg(m => ({ ...m, [platform]: '' }))
    const P = copy.platforms
    try {
      let externalId = ''; let permalink = ''
      if (platform === 'facebook') {
        const img = await ensureCardUrl('png')
        const first = P.facebook.first_comment.includes('[LINK]')
          ? P.facebook.first_comment.replace(/\[LINK\]/g, linkFor('facebook'))
          : `${P.facebook.first_comment} ${linkFor('facebook')}`.trim()
        const tags = buildReachHashtags(copy)
        const caption = tags ? `${P.facebook.post}\n\n${tags}` : P.facebook.post
        const r = await invokeRaw('publish-social', {
          action: 'facebook_photo', image_url: img, message: caption, first_comment: first,
        })
        externalId = String(r.post_id || ''); permalink = String(r.permalink || '')
        const note = r.comment_error ? ' — comentariul cu linkul a eșuat' : ''
        setPubMsg(m => ({ ...m, facebook: '✓ Postat pe Facebook' + note }))
      } else if (platform === 'instagram') {
        const img = await ensureCardUrl('jpg')
        // A 9:16 story card goes to an IG Story; square/landscape to the feed.
        const isStory = formatKey === 'story'
        const r = await invokeRaw('publish-social', {
          action: 'instagram_image', image_url: img,
          caption: P.instagram_feed.caption,
          media_type: isStory ? 'STORIES' : undefined,
        })
        const creationId = String(r.creation_id || '')
        if (!creationId) throw new Error('Instagram nu a returnat creation_id.')
        setPubMsg(m => ({ ...m, instagram: 'Instagram procesează imaginea…' }))
        for (let i = 0; i < 20; i++) {
          await sleep(3000)
          const st = await invokeRaw('publish-social', { action: 'instagram_status', creation_id: creationId })
          const code = String(st.status_code || '')
          if (code === 'FINISHED') break
          if (code === 'ERROR') throw new Error('Instagram a respins imaginea: ' + String(st.status || ''))
          if (i === 19) throw new Error('Instagram procesează prea mult — reîncearcă.')
        }
        const pr = await invokeRaw('publish-social', { action: 'instagram_publish', creation_id: creationId })
        const mediaId = String(pr.media_id || ''); externalId = mediaId
        // Stories can't be commented on — only feed posts take a hashtag comment.
        if (!isStory && mediaId && P.instagram_feed.first_comment_hashtags) {
          try { await invokeRaw('publish-social', { action: 'instagram_comment', media_id: mediaId, message: P.instagram_feed.first_comment_hashtags }) } catch { /* hashtags comment is best-effort */ }
        }
        setPubMsg(m => ({ ...m, instagram: '✓ Publicat pe Instagram' + (isStory ? ' (Story)' : '') }))
      } else if (platform === 'x') {
        const img = await ensureCardUrl('png')
        const text = `${P.x.post} ${linkFor('x')}`.trim()
        const r = await invokeRaw('publish-social', { action: 'x', text, image_url: img })
        externalId = String(r.tweet_id || ''); permalink = String(r.url || '')
        setPubMsg(m => ({ ...m, x: '✓ Postat pe X' + (permalink ? ': ' + permalink : '') }))
      } else {
        const img = await ensureCardUrl('png')
        const tagLine = P.linkedin.hashtags.length ? '\n\n' + P.linkedin.hashtags.join(' ') : ''
        const text = `${P.linkedin.post}\n\n${linkFor('linkedin')}${tagLine}`
        const r = await invokeRaw('publish-social', { action: 'linkedin', text, image_url: img, title })
        externalId = String(r.post_urn || ''); permalink = String(r.url || '')
        const note = r.image_note ? ' — fără imagine' : ''
        setPubMsg(m => ({ ...m, linkedin: '✓ Postat pe LinkedIn' + note }))
      }
      await logSocialPost(platform, externalId, permalink)
    } catch (e) {
      setPubMsg(m => ({ ...m, [platform]: '✗ ' + (e as Error).message }))
    } finally { setPubBusy('') }
  }

  const format = FORMATS[formatKey]
  const previewScale = Math.min(560 / format.width, 720 / format.height)

  const visibleArticles = showOnlyBreaking
    ? articles.filter(a => a.is_breaking === true)
    : articles

  const selectedArticle = articles.find(a => a.id === selectedId)
  const dbIsBreaking = selectedArticle?.is_breaking === true
  const overrideHint = selectedArticle
    ? (dbIsBreaking && !isBreaking)
      ? 'Articolul este marcat ca breaking în baza de date, dar badge-ul este oprit manual.'
      : (!dbIsBreaking && isBreaking)
        ? 'Articolul NU este marcat ca breaking în baza de date — badge-ul este forțat manual.'
        : null
    : null

  const inp = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
  const sec = "bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4"
  const sh = "font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3 mb-1"

  // Per-platform, link-substituted copy for the result cards.
  const fbFirstComment = copy
    ? (copy.platforms.facebook.first_comment.includes('[LINK]')
        ? copy.platforms.facebook.first_comment.replace(/\[LINK\]/g, linkFor('facebook'))
        : `${copy.platforms.facebook.first_comment} ${linkFor('facebook')}`.trim())
    : ''

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-white">Social Media Generator</h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          Card cu titlu în Lora serif + pachet SEO &amp; social per platformă (RO/EN), cu publicare directă
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">

        {/* LEFT */}
        <div className="space-y-4">

          {/* Language */}
          <div className={sec}>
            <p className={sh}>Limbă</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => switchLang('ro')}
                className={`py-3 border font-sans text-[12px] font-bold transition-colors ${
                  lang === 'ro' ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/50 hover:text-white'
                }`}>
                🇷🇴 Română
              </button>
              <button onClick={() => switchLang('en')}
                className={`py-3 border font-sans text-[12px] font-bold transition-colors ${
                  lang === 'en' ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/50 hover:text-white'
                }`}>
                🇬🇧 English
              </button>
            </div>
            <p className="font-sans text-[10px] text-white/20">
              Schimbă titlul, textul CTA, pachetul social și numele fișierului PNG.
            </p>
          </div>

          {/* Article */}
          <div className={sec}>
            <p className={sh}>Articol</p>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={showOnlyBreaking}
                onChange={e => setShowOnlyBreaking(e.target.checked)}
                className="w-4 h-4 accent-[#C41E3A] cursor-pointer"
              />
              <span className="font-sans text-[11px] text-white/60">
                Doar articole marcate &quot;Ultimele știri&quot;
              </span>
            </label>
            <select className={inp} value={selectedId} onChange={e => selectArticle(e.target.value)}>
              <option value="">— Alege un articol —</option>
              {visibleArticles.map(a => {
                const titleStr = lang === 'ro' ? (a.title_ro || a.title_en) : (a.title_en || a.title_ro)
                return (
                  <option key={a.id} value={a.id}>
                    {a.is_breaking ? '🔴 ' : ''}
                    {(titleStr || a.slug).substring(0, 78)}
                  </option>
                )
              })}
            </select>
            {visibleArticles.length === 0 && showOnlyBreaking && (
              <p className="font-sans text-[11px] text-white/40">
                Niciun articol nu este marcat ca &quot;Ultimele știri&quot;.
              </p>
            )}
          </div>

          {/* Breaking */}
          <div className={sec}>
            <p className={sh}>Breaking News</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isBreaking}
                onChange={e => { setIsBreaking(e.target.checked); setImageData('') }}
                className="w-5 h-5 accent-[#C41E3A] cursor-pointer"
              />
              <Radio className={`w-4 h-4 ${isBreaking ? 'text-[#C41E3A]' : 'text-white/20'}`} />
              <span className="font-sans text-[13px] text-white">
                Afișează badge &quot;BREAKING NEWS&quot;
              </span>
            </label>
            <input
              className={inp}
              value={breakingLabel}
              onChange={e => { setBreakingLabel(e.target.value); setImageData('') }}
              placeholder="ex: BREAKING NEWS, ULTIMELE ȘTIRI"
              disabled={!isBreaking}
            />
            {overrideHint && (
              <p className="font-sans text-[10px] text-[#F0A500]">⚠ {overrideHint}</p>
            )}
            <p className="font-sans text-[10px] text-white/20">
              Se activează automat dacă articolul are bifa &quot;Ultimele știri&quot;
              în baza de date. Poți forța on/off manual pentru orice articol.
            </p>
          </div>

          {/* Title */}
          <div className={sec}>
            <p className={sh}>Titlu — {lang === 'ro' ? 'Română' : 'English'}</p>
            <textarea className={inp + ' resize-none'} rows={3} value={title}
              onChange={e => { setTitle(e.target.value); setImageData('') }}
              placeholder={lang === 'ro' ? 'Titlul din bula roșie...' : 'Title in the red bubble...'} />
          </div>

          {/* Cover */}
          <div className={sec}>
            <p className={sh}>Imagine copertă</p>
            <input className={inp} value={coverUrl}
              onChange={e => { setCoverUrl(e.target.value); setImageData('') }}
              placeholder="URL imagine copertă..." />
            {coverUrl && (
              <div className="overflow-hidden aspect-video">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coverUrl} alt="Cover" className="w-full h-full object-cover" />
              </div>
            )}
          </div>

          {/* Banner (domain wordmark) */}
          <div className={sec}>
            <p className={sh}>Banner card</p>
            <p className="font-sans text-[10px] text-white/30 -mt-2">
              Textul din banda de jos a imaginii. Recomandat: domeniul — devine
              reclamă de brand pe orice platformă și în orice screenshot.
            </p>
            <div>
              <p className={`font-sans text-[10px] mb-1 ${lang === 'ro' ? 'text-white' : 'text-white/30'}`}>
                RO {lang === 'ro' && <span className="text-[#C41E3A]">· activ</span>}
              </p>
              <input className={inp} value={ctaRo}
                onChange={e => { setCtaRo(e.target.value); setImageData('') }}
                placeholder="transilvaniatimes.com" />
            </div>
            <div>
              <p className={`font-sans text-[10px] mb-1 ${lang === 'en' ? 'text-white' : 'text-white/30'}`}>
                EN {lang === 'en' && <span className="text-[#C41E3A]">· active</span>}
              </p>
              <input className={inp} value={ctaEn}
                onChange={e => { setCtaEn(e.target.value); setImageData('') }}
                placeholder="transilvaniatimes.com" />
            </div>
          </div>

          {/* Format */}
          <div className={sec}>
            <p className={sh}>Format</p>
            <div className="space-y-2">
              {Object.entries(FORMATS).map(([key, f]) => (
                <button key={key} onClick={() => { setFormatKey(key); setImageData('') }}
                  className={`w-full text-left px-3 py-2.5 border font-sans text-[12px] transition-colors ${
                    formatKey === key ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/50 hover:text-white hover:border-white/20'
                  }`}>
                  {f.label}
                  <span className="text-white/30 ml-2">{f.width}×{f.height}</span>
                </button>
              ))}
            </div>
          </div>

          <button onClick={generate} disabled={generating || !title || !coverUrl}
            className="w-full flex items-center justify-center gap-3 py-4 bg-brand-red text-white font-sans text-[13px] font-bold uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează...</>
              : <><ImageIcon className="w-4 h-4" /> Generează imagine</>}
          </button>

          <button onClick={generateCopy} disabled={copyLoading || !selectedId}
            className="w-full flex items-center justify-center gap-3 py-4 bg-[#0D1B4B] text-white font-sans text-[13px] font-bold uppercase tracking-widest hover:bg-[#0a1540] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {copyLoading
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Scriu pachetul...</>
              : <><Sparkles className="w-4 h-4" /> Generează pachet SEO + social</>}
          </button>
          <p className="font-sans text-[10px] text-white/25 text-center">
            Titlu Discover, cuvinte-cheie, hashtag-uri pe niveluri și text nativ pentru Facebook, Instagram, X și LinkedIn — în limba {lang === 'ro' ? 'română' : 'engleză'}.
          </p>
        </div>

        {/* RIGHT preview */}
        <div className="flex flex-col items-center">
          {imageData ? (
            <div className="space-y-4">
              <div className="bg-[#1a1a1a] border border-white/[0.07] p-3 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageData} alt="Preview"
                  style={{ width: format.width * previewScale, height: format.height * previewScale }} />
              </div>
              <div className="flex gap-3">
                <button onClick={download}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-red text-white font-sans text-[13px] font-bold hover:bg-red-700 transition-colors">
                  <Download className="w-4 h-4" /> Descarcă PNG
                </button>
                <button onClick={generate}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-[#1a1a1a] border border-white/10 text-white font-sans text-[13px] hover:border-white/30 transition-colors">
                  <RefreshCw className="w-4 h-4" /> Regenerează
                </button>
              </div>
              <p className="font-sans text-[10px] text-white/20 text-center">
                {format.width}×{format.height}px · {lang.toUpperCase()} · PNG{isBreaking ? ' · Breaking News' : ''}
              </p>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center p-8 text-center"
              style={{ width: format.width * previewScale + 24, height: format.height * previewScale + 24 }}>
              <ImageIcon className="w-16 h-16 text-white/[0.05] mb-5" />
              <p className="font-serif text-xl text-white/20 mb-2">Preview</p>
              <p className="font-sans text-[12px] text-white/10 max-w-xs">
                Selectează un articol și apasă Generează
              </p>
            </div>
          )}
        </div>
      </div>

      {/* SEO / SOCIAL PACK RESULTS ───────────────────────────────────────────── */}
      {(copyError || copy) && (
        <div className="mt-8">
          {copyError && (
            <div className="bg-[#2a1416] border border-[#C41E3A]/40 text-[#f3b4bb] font-sans text-[13px] px-4 py-3">
              ⚠ {copyError}
            </div>
          )}

          {copy && (
            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-serif text-xl font-bold text-white">Pachet SEO &amp; social — gata de postat</h2>
                {copy.primary_keyword && (
                  <span className="font-sans text-[11px] text-white/50">
                    Cuvânt-cheie: <span className="text-[#F0A500] font-bold">{copy.primary_keyword}</span>
                  </span>
                )}
              </div>

              {/* A/B variant + best hours */}
              <div className="bg-[#12100c] border border-amber-400/25 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10.5px] font-bold uppercase tracking-widest text-amber-300/80">Cârlig A/B</span>
                  {(['hookA', 'hookB'] as const).map(v => (
                    <button key={v} onClick={() => setVariant(v)}
                      className={'px-2.5 py-1 text-[11.5px] border ' + (variant === v ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>
                      {v === 'hookA' ? 'A' : 'B'}
                    </button>
                  ))}
                  <span className="text-[10px] text-white/30">se marchează în link ca utm_content — vezi article_hook_winner</span>
                </div>
                <p className="text-[12.5px] text-white/85">{copy.variants[variant]}</p>
                <p className="text-[11px] text-sky-300/70 flex items-center gap-1.5"><Clock className="w-3 h-3" /> {copy.best_hours}</p>
                <p className="text-[10.5px] text-white/30 break-all">link → {linkFor('facebook')}</p>
              </div>

              {/* Discover headline */}
              <CopyCard title="Titlu Google Discover" accent="#F0A500"
                blocks={[{ key: 'disc', label: 'Headline', text: copy.discover_headline }]}
                copiedKey={copiedKey} onCopy={copyToClipboard} />

              {/* Keywords / entities / questions */}
              {(copy.keywords.entities.length > 0 || copy.keywords.questions.length > 0) && (
                <div className="bg-[#1a1a1a] border border-white/[0.07] p-4 space-y-2">
                  <span className="font-sans text-[10px] uppercase tracking-widest text-white/35">Semnal SEO</span>
                  {copy.keywords.entities.length > 0 && (
                    <p className="font-sans text-[12px] text-white/70"><span className="text-white/35">Entități:</span> {copy.keywords.entities.join(' · ')}</p>
                  )}
                  {copy.keywords.questions.length > 0 && (
                    <p className="font-sans text-[12px] text-white/70"><span className="text-white/35">Ce caută cititorii:</span> {copy.keywords.questions.join(' | ')}</p>
                  )}
                </div>
              )}

              {/* Hashtag tiers */}
              <div className="bg-[#1a1a1a] border border-white/[0.07] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-[10px] uppercase tracking-widest text-white/35 flex items-center gap-1.5"><Hash className="w-3 h-3" /> Hashtag-uri pe niveluri</span>
                  <button onClick={() => copyToClipboard('all-tags', [...copy.hashtag_tiers.broad, ...copy.hashtag_tiers.geo, ...copy.hashtag_tiers.entity, ...copy.hashtag_tiers.brand].join(' '))}
                    className="flex items-center gap-1 font-sans text-[10px] text-white/40 hover:text-white transition-colors">
                    {copiedKey === 'all-tags' ? <><Check className="w-3 h-3 text-green-400" /> Copiat</> : <><Copy className="w-3 h-3" /> Copiază tot</>}
                  </button>
                </div>
                {([['larg', 'broad'], ['local', 'geo'], ['entități', 'entity'], ['brand', 'brand']] as const).map(([label, key]) => {
                  const list = copy.hashtag_tiers[key]
                  return list.length ? (
                    <p key={key} className="font-sans text-[12px] text-white/70">
                      <span className="text-white/35 inline-block w-16">{label}:</span> {list.join(' ')}
                    </p>
                  ) : null
                })}
              </div>

              {/* Per-platform copy */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <CopyCard title="Facebook" accent="#1877F2"
                  blocks={[
                    { key: 'fb-post', label: 'Postare', text: copy.platforms.facebook.post },
                    { key: 'fb-comment', label: 'Primul comentariu (link)', text: fbFirstComment },
                    { key: 'fb-tags', label: 'Hashtag-uri', text: copy.platforms.facebook.hashtags.join(' ') },
                  ]}
                  copiedKey={copiedKey} onCopy={copyToClipboard} />

                <CopyCard title="Instagram — Feed" accent="#E1306C"
                  blocks={[
                    { key: 'ig-cap', label: 'Descriere', text: copy.platforms.instagram_feed.caption },
                    { key: 'ig-alt', label: 'Text alternativ (alt)', text: copy.platforms.instagram_feed.alt_text },
                    { key: 'ig-cover', label: 'Text pe copertă', text: copy.platforms.instagram_feed.cover_text },
                    { key: 'ig-tags', label: 'Hashtag-uri (primul comentariu)', text: copy.platforms.instagram_feed.first_comment_hashtags },
                  ]}
                  copiedKey={copiedKey} onCopy={copyToClipboard} />

                <CopyCard title="Instagram — Story" accent="#F0A500"
                  blocks={[
                    { key: 'igs', label: 'Text (lângă sticker-ul de link)', text: copy.platforms.instagram_story.text },
                    { key: 'igs-link', label: 'Link pentru sticker', text: linkFor('instagram') },
                  ]}
                  copiedKey={copiedKey} onCopy={copyToClipboard} />

                <CopyCard title="X / Twitter" accent="#7A7A7A"
                  blocks={[
                    { key: 'x', label: `Tweet + link (${(copy.platforms.x.post || '').length + 1 + (linkFor('x')?.length || 0)} car.)`,
                      text: copy.platforms.x.post ? `${copy.platforms.x.post} ${linkFor('x')}` : linkFor('x') },
                    { key: 'x-tags', label: 'Hashtag-uri', text: copy.platforms.x.hashtags.join(' ') },
                  ]}
                  copiedKey={copiedKey} onCopy={copyToClipboard} />

                <CopyCard title="LinkedIn" accent="#0A66C2"
                  blocks={[
                    { key: 'li', label: 'Postare', text: copy.platforms.linkedin.post ? `${copy.platforms.linkedin.post}\n\n${linkFor('linkedin')}` : linkFor('linkedin') },
                    { key: 'li-tags', label: 'Hashtag-uri', text: copy.platforms.linkedin.hashtags.join(' ') },
                  ]}
                  copiedKey={copiedKey} onCopy={copyToClipboard} />
              </div>

              {/* ── PUBLICARE DIRECTĂ ─────────────────────────────────────── */}
              <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-brand-red" />
                  <h3 className="font-sans text-[12px] font-bold uppercase tracking-widest text-white">Publicare directă</h3>
                </div>
                <p className="font-sans text-[11px] text-white/40 -mt-1">
                  Postează cardul generat + textul de mai sus. Facebook și Instagram folosesc cardul ca imagine (linkul stă în primul comentariu la Facebook); X și LinkedIn primesc cardul + linkul cu etichetă {variant === 'hookA' ? 'A' : 'B'}. Se scrie o intrare în social_posts.
                </p>
                {!imageData && (
                  <p className="font-sans text-[11px] text-[#F0A500]">⚠ Generează întâi imaginea (butonul „Generează imagine”).</p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PLATFORMS.map(pl => {
                    const configured = pub ? pub[pl.key] : null
                    const busy = pubBusy === pl.key
                    return (
                      <button key={pl.key} onClick={() => publishTo(pl.key)}
                        disabled={busy || !!pubBusy || !imageData || !copy || configured === false}
                        className="flex items-center justify-center gap-2 py-3 border border-white/10 bg-[#111] text-white font-sans text-[12px] font-bold hover:border-brand-red/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <span className="w-2.5 h-2.5 rounded-full" style={{ background: pl.dot }} />}
                        {pl.label}
                      </button>
                    )
                  })}
                </div>
                <div className="space-y-1.5">
                  {PLATFORMS.map(pl => {
                    const configured = pub ? pub[pl.key] : null
                    const msg = pubMsg[pl.key]
                    if (configured === false) {
                      return <p key={pl.key} className="font-sans text-[11px] text-white/30">{pl.label}: neconfigurat — adaugă cheile în secretele Supabase.</p>
                    }
                    if (!msg) return null
                    const ok = msg.startsWith('✓')
                    const linkMatch = msg.match(/https?:\/\/\S+/)
                    return (
                      <p key={pl.key} className={'font-sans text-[11.5px] break-all ' + (ok ? 'text-green-400' : msg.startsWith('✗') ? 'text-[#f3b4bb]' : 'text-white/55')}>
                        <span className="text-white/40">{pl.label}:</span>{' '}
                        {linkMatch
                          ? <>{msg.slice(0, linkMatch.index)}<a href={linkMatch[0]} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">{linkMatch[0]} <ExternalLink className="w-3 h-3" /></a></>
                          : msg}
                      </p>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── COPY CARD ─────────────────────────────────────────────────────────────────

interface CopyBlock { key: string; label: string; text?: string }

function CopyCard({
  title, accent, blocks, copiedKey, onCopy,
}: {
  title: string
  accent: string
  blocks: CopyBlock[]
  copiedKey: string
  onCopy: (key: string, text: string) => void
}) {
  return (
    <div className="bg-[#1a1a1a] border border-white/[0.07] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.07]">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
        <span className="font-sans text-[12px] font-bold uppercase tracking-widest text-white">{title}</span>
      </div>
      <div className="p-4 space-y-3">
        {blocks.filter(b => b.text && b.text.trim()).map(b => (
          <div key={b.key}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-sans text-[10px] uppercase tracking-widest text-white/35">{b.label}</span>
              <button onClick={() => onCopy(b.key, b.text!)}
                className="flex items-center gap-1 font-sans text-[10px] text-white/40 hover:text-white transition-colors">
                {copiedKey === b.key
                  ? <><Check className="w-3 h-3 text-green-400" /> Copiat</>
                  : <><Copy className="w-3 h-3" /> Copiază</>}
              </button>
            </div>
            <p className="font-sans text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap bg-[#111] border border-white/[0.06] px-3 py-2.5">
              {b.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
