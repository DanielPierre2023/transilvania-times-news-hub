'use client'

// app/admin/social/page.tsx
//
// Social media image generator — two publication-grade styles:
//   EDITORIAL: Photo top + cream text area (Guardian-inspired)
//   IMERSIV:   Full-bleed photo with title overlay (NYT-inspired)
//
// v2 — BREAKING NEWS wiring:
//   • Fetches blog_posts.is_breaking and auto-toggles the badge.
//   • Manual override toggle in the left panel (force-on or force-off).
//   • Dropdown shows 🔴 prefix on breaking articles.
//   • Editable badge label (default "BREAKING NEWS", swap to "ULTIMELE ȘTIRI"
//     or anything else without touching code).
//   • Badge renders identically in both Editorial and Immersive styles —
//     top-left, brand red with amber accent, white live-dot, drop shadow.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Download, RefreshCw, Image as ImageIcon, Radio } from 'lucide-react'

// ─── FORMATS ──────────────────────────────────────────────────────────────────

interface Format {
  label: string; width: number; height: number
  imageRatio: number    // photo height as fraction of total (Editorial style)
  titleFactor: number   // title font size as fraction of width
}

const FORMATS: Record<string, Format> = {
  square:    { label: 'Instagram / Facebook', width: 1080, height: 1080, imageRatio: 0.60, titleFactor: 0.048 },
  landscape: { label: 'Facebook / Twitter',   width: 1200, height: 630,  imageRatio: 0.54, titleFactor: 0.046 },
  story:     { label: 'Instagram Story',      width: 1080, height: 1920, imageRatio: 0.72, titleFactor: 0.058 },
}

// ─── BRAND ────────────────────────────────────────────────────────────────────

const B = {
  red: '#C41E3A',
  navy: '#0D1B4B',
  amber: '#F0A500',
  cream: '#F5F4F0',
  nearBlack: '#1A1A1A',
  white: '#FFFFFF',
}

type Style = 'editorial' | 'immersive'

// ─── CANVAS HELPERS ───────────────────────────────────────────────────────────

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Load failed: ${src}`))
    img.src = src
  })
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: string): string[] {
  ctx.font = font
  const words = text.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w }
    else cur = test
  }
  if (cur) lines.push(cur)
  return lines
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const sa = img.width / img.height, da = w / h
  let sx = 0, sy = 0, sw = img.width, sh = img.height
  if (sa > da) { sw = img.height * da; sx = (img.width - sw) / 2 }
  else { sh = img.width / da; sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, y: number, size: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  const w = size * 0.7   // width of each chevron
  const h = size * 0.38  // height of each chevron
  const t = size * 0.14  // thickness of chevron arms
  const gap = size * 0.08

  for (let c = 0; c < 2; c++) {
    const top = y + c * (h + gap)
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, top)
    ctx.lineTo(cx, top + h)
    ctx.lineTo(cx + w / 2, top)
    ctx.lineTo(cx + w / 2 - t, top + t * 0.3)
    ctx.lineTo(cx, top + h - t)
    ctx.lineTo(cx - w / 2 + t, top + t * 0.3)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// ─── BREAKING NEWS BADGE ──────────────────────────────────────────────────────
// Top-left corner. Brand red with amber accent stripe on the right edge.
// White live-pulse dot + bold "BREAKING NEWS" (or custom label) text.
// Drop shadow for separation from any photo background.

function drawBreakingBadge(
  ctx: CanvasRenderingContext2D,
  W: number,
  pad: number,
  label: string,
) {
  // Auto-size to label so "ULTIMELE ȘTIRI" doesn't overflow vs "BREAKING NEWS"
  const sans = '"Helvetica Neue", Helvetica, Arial, sans-serif'
  const bh = Math.round(W * 0.058)             // badge height
  const textFs = Math.round(bh * 0.42)
  ctx.save()
  ctx.font = `900 ${textFs}px ${sans}`
  const textWidth = ctx.measureText(label.toUpperCase()).width
  ctx.restore()

  const dotZone = Math.round(bh * 1.1)         // space for live dot before text
  const rightPad = Math.round(bh * 0.55)       // breathing room after text
  const accentW = Math.round(bh * 0.18)        // amber right accent
  const bw = dotZone + textWidth + rightPad + accentW

  const bx = pad
  const by = pad

  // 1. Red main rectangle WITH shadow for separation
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 5
  ctx.fillStyle = B.red
  ctx.fillRect(bx, by, bw, bh)
  ctx.restore()

  // 2. Amber accent stripe on right edge (brand signature)
  ctx.fillStyle = B.amber
  ctx.fillRect(bx + bw - accentW, by, accentW, bh)

  // 3. Live pulse — outer ring + solid white dot
  const dotR = Math.round(bh * 0.16)
  const dotX = bx + Math.round(bh * 0.55)
  const dotY = by + bh / 2

  ctx.beginPath()
  ctx.arc(dotX, dotY, dotR * 2.1, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = Math.max(1, Math.round(bh * 0.025))
  ctx.stroke()

  ctx.beginPath()
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
  ctx.fillStyle = B.white
  ctx.fill()

  // 4. Label text — heavy weight, all caps, generous tracking
  ctx.font = `900 ${textFs}px ${sans}`
  ctx.fillStyle = B.white
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const textX = bx + dotZone
  // letterSpacing is unreliable; fake tracking by manual draw if needed
  ctx.fillText(label.toUpperCase(), textX, by + bh / 2 + 1)

  ctx.textAlign = 'left'
}

// ─── EDITORIAL STYLE (Guardian-inspired) ──────────────────────────────────────

async function renderEditorial(
  coverUrl: string, title: string, logoUrl: string,
  format: Format, ctaRo: string, ctaEn: string,
  isBreaking: boolean, breakingLabel: string,
): Promise<string> {
  const { width: W, height: H } = format
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const pad = Math.round(W * 0.06)
  const serif = 'Georgia, "Times New Roman", serif'
  const sans = '"Helvetica Neue", Helvetica, Arial, sans-serif'
  const imgH = Math.round(H * 0.58)
  const textH = H - imgH

  // 1. Cover photo
  try { const img = await loadImg(coverUrl); drawCover(ctx, img, W, imgH) }
  catch { ctx.fillStyle = B.navy; ctx.fillRect(0, 0, W, imgH) }

  // 2. Red accent bar
  ctx.fillStyle = B.red
  ctx.fillRect(0, imgH, W, 5)

  // 3. Cream text area
  ctx.fillStyle = B.cream
  ctx.fillRect(0, imgH + 5, W, textH - 5)

  // 4. Navy left accent strip
  ctx.fillStyle = B.navy
  ctx.fillRect(pad - 14, imgH + 5 + pad * 0.5, 4, textH - 5 - pad)

  // 5. Title
  let fs = Math.round(W * 0.046)
  let lines = wrap(ctx, title, W - pad * 2 - 10, `bold ${fs}px ${serif}`)
  const maxL = H > 1200 ? 7 : 4
  while (lines.length > maxL && fs > 24) { fs -= 2; lines = wrap(ctx, title, W - pad * 2 - 10, `bold ${fs}px ${serif}`) }
  const lh = fs * 1.2
  const titleTop = imgH + 5 + pad * 0.65

  ctx.font = `bold ${fs}px ${serif}`
  ctx.fillStyle = B.nearBlack
  ctx.textBaseline = 'top'
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], pad, titleTop + i * lh)

  // 6. Bottom row: CTA left + logo right
  const bottomY = H - pad * 1.1
  const ctaFs = Math.round(fs * 0.22)
  const ctaEnFs = Math.round(ctaFs * 0.85)

  ctx.font = `500 ${ctaFs}px ${sans}`
  const ctaRoW = ctx.measureText(ctaRo).width
  ctx.font = `400 ${ctaEnFs}px ${sans}`
  const ctaEnW = ctx.measureText(ctaEn).width
  const maxCtaW = Math.max(ctaRoW, ctaEnW)

  ctx.font = `500 ${ctaFs}px ${sans}`
  ctx.fillStyle = B.navy
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(ctaRo, pad, bottomY - ctaFs - 2)

  ctx.font = `400 ${ctaEnFs}px ${sans}`
  ctx.fillStyle = '#888888'
  ctx.fillText(ctaEn, pad, bottomY)

  const ctaBlockHeight = ctaFs + ctaEnFs + 2
  const ctaBlockTop = bottomY - ctaBlockHeight
  const arrowSize = ctaBlockHeight * 1.4
  const arrowX = pad + maxCtaW + Math.round(pad * 0.4)
  const arrowY = ctaBlockTop - (arrowSize - ctaBlockHeight) / 2
  drawArrow(ctx, arrowX, arrowY, arrowSize, B.red)

  // Logo
  try {
    const logo = await loadImg(logoUrl)
    const logoW = Math.round(W * 0.13)
    const logoH = (logo.height / logo.width) * logoW
    ctx.drawImage(logo, W - pad - logoW, bottomY - logoH + 4, logoW, logoH)
  } catch {
    ctx.font = `bold ${ctaFs * 1.3}px ${serif}`
    ctx.fillStyle = B.red; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText('Transilvania Times', W - pad, bottomY)
  }

  ctx.textAlign = 'left'

  // 7. Breaking News badge — drawn last so it sits above photo + text
  if (isBreaking) drawBreakingBadge(ctx, W, pad, breakingLabel)

  return canvas.toDataURL('image/png')
}

// ─── IMMERSIVE STYLE (NYT-inspired) ──────────────────────────────────────────

async function renderImmersive(
  coverUrl: string, title: string, logoUrl: string,
  format: Format, ctaRo: string, ctaEn: string,
  isBreaking: boolean, breakingLabel: string,
): Promise<string> {
  const { width: W, height: H } = format
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const pad = Math.round(W * 0.06)
  const serif = 'Georgia, "Times New Roman", serif'
  const sans = '"Helvetica Neue", Helvetica, Arial, sans-serif'

  // 1. Full-bleed photo
  try { const img = await loadImg(coverUrl); drawCover(ctx, img, W, H) }
  catch { ctx.fillStyle = B.navy; ctx.fillRect(0, 0, W, H) }

  // 2. Cinematic gradient from bottom
  const gradH = Math.round(H * 0.55)
  const grad = ctx.createLinearGradient(0, H - gradH, 0, H)
  grad.addColorStop(0, 'rgba(13,27,75,0)')
  grad.addColorStop(0.3, 'rgba(13,27,75,0.4)')
  grad.addColorStop(0.6, 'rgba(13,27,75,0.75)')
  grad.addColorStop(1, 'rgba(13,27,75,0.92)')
  ctx.fillStyle = grad
  ctx.fillRect(0, H - gradH, W, gradH)

  // 3. Red accent line at very bottom
  ctx.fillStyle = B.red
  ctx.fillRect(0, H - 5, W, 5)

  // 4. Title (white bold italic serif)
  let fs = Math.round(W * 0.05)
  const font = (s: number) => `bold italic ${s}px ${serif}`
  let lines = wrap(ctx, title, W - pad * 2, font(fs))
  const maxL = H > 1200 ? 7 : 4
  while (lines.length > maxL && fs > 24) { fs -= 2; lines = wrap(ctx, title, W - pad * 2, font(fs)) }
  const lh = fs * 1.25

  const ctaSpace = Math.round(pad * 2.2)
  const titleBottom = H - 5 - ctaSpace
  const titleTop = titleBottom - lines.length * lh

  ctx.font = font(fs)
  ctx.fillStyle = B.white
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], pad, titleTop + i * lh)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  // 5. Bottom row: CTA + logo
  const bottomY = H - 5 - pad * 0.6
  const ctaFs = Math.round(fs * 0.24)
  const ctaEnFs = Math.round(ctaFs * 0.85)

  ctx.font = `500 ${ctaFs}px ${sans}`
  const ctaRoW = ctx.measureText(ctaRo).width
  ctx.font = `400 ${ctaEnFs}px ${sans}`
  const ctaEnW = ctx.measureText(ctaEn).width
  const maxCtaW = Math.max(ctaRoW, ctaEnW)

  ctx.font = `500 ${ctaFs}px ${sans}`
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(ctaRo, pad, bottomY - ctaFs - 2)

  ctx.font = `400 ${ctaEnFs}px ${sans}`
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(ctaEn, pad, bottomY)

  const ctaBlockHeight = ctaFs + ctaEnFs + 2
  const ctaBlockTop = bottomY - ctaBlockHeight
  const arrowSize = ctaBlockHeight * 1.4
  const arrowX = pad + maxCtaW + Math.round(pad * 0.4)
  const arrowY = ctaBlockTop - (arrowSize - ctaBlockHeight) / 2
  drawArrow(ctx, arrowX, arrowY, arrowSize, B.red)

  // Logo with cream backdrop for legibility on dark gradient
  try {
    const logo = await loadImg(logoUrl)
    const logoW = Math.round(W * 0.13)
    const logoH = (logo.height / logo.width) * logoW
    const logoX = W - pad - logoW
    const logoY = bottomY - logoH + 4

    const bgPad = Math.round(logoW * 0.08)
    const bgX = logoX - bgPad
    const bgY = logoY - bgPad
    const bgW = logoW + bgPad * 2
    const bgH = logoH + bgPad * 2
    const radius = Math.round(bgW * 0.08)

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetY = 3
    ctx.fillStyle = B.cream
    ctx.beginPath()
    ctx.moveTo(bgX + radius, bgY)
    ctx.lineTo(bgX + bgW - radius, bgY)
    ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + radius, radius)
    ctx.lineTo(bgX + bgW, bgY + bgH - radius)
    ctx.arcTo(bgX + bgW, bgY + bgH, bgX + bgW - radius, bgY + bgH, radius)
    ctx.lineTo(bgX + radius, bgY + bgH)
    ctx.arcTo(bgX, bgY + bgH, bgX, bgY + bgH - radius, radius)
    ctx.lineTo(bgX, bgY + radius)
    ctx.arcTo(bgX, bgY, bgX + radius, bgY, radius)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.drawImage(logo, logoX, logoY, logoW, logoH)
  } catch {
    ctx.font = `bold ${ctaFs * 1.3}px ${serif}`
    ctx.fillStyle = B.amber; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText('Transilvania Times', W - pad, bottomY)
  }

  ctx.textAlign = 'left'

  // 6. Breaking News badge
  if (isBreaking) drawBreakingBadge(ctx, W, pad, breakingLabel)

  return canvas.toDataURL('image/png')
}

// ─── ARTICLE TYPE ─────────────────────────────────────────────────────────────

interface Article {
  id: string; slug: string; title_ro: string | null; title_en: string | null
  cover_image: string | null; published_at: string | null
  is_breaking: boolean | null
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function SocialPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [title, setTitle] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [formatKey, setFormatKey] = useState<string>('square')
  const [style, setStyle] = useState<Style>('immersive')
  const [ctaRo, setCtaRo] = useState('Accesează articolul complet în comentarii')
  const [ctaEn, setCtaEn] = useState('Full article link in comments')

  // v2 — Breaking News state
  const [isBreaking, setIsBreaking] = useState(false)
  const [breakingLabel, setBreakingLabel] = useState('BREAKING NEWS')
  const [showOnlyBreaking, setShowOnlyBreaking] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [imageData, setImageData] = useState('')
  const [logoUrl] = useState('/assets/logos/logo-transilvania-times.png')
  const previewRef = useRef<HTMLImageElement>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    supabase
      .from('blog_posts')
      .select('id, slug, title_ro, title_en, cover_image, published_at, is_breaking')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setArticles((data || []) as Article[]))
  }, [supabase])

  const selectArticle = useCallback((id: string) => {
    setSelectedId(id); setImageData('')
    const a = articles.find(x => x.id === id)
    if (a) {
      setTitle(a.title_ro || a.title_en || '')
      setCoverUrl(a.cover_image || '')
      // Auto-init breaking state from the column. User can still override.
      setIsBreaking(a.is_breaking === true)
    }
  }, [articles])

  const generate = useCallback(async () => {
    if (!title || !coverUrl) return
    setGenerating(true); setImageData('')
    try {
      const fmt = FORMATS[formatKey]
      const data = style === 'immersive'
        ? await renderImmersive(coverUrl, title, logoUrl, fmt, ctaRo, ctaEn, isBreaking, breakingLabel)
        : await renderEditorial(coverUrl, title, logoUrl, fmt, ctaRo, ctaEn, isBreaking, breakingLabel)
      setImageData(data)
    } catch (e) { console.error('Gen failed:', e) }
    setGenerating(false)
  }, [title, coverUrl, formatKey, logoUrl, ctaRo, ctaEn, style, isBreaking, breakingLabel])

  const download = useCallback(() => {
    if (!imageData) return
    const a = document.createElement('a')
    a.href = imageData
    const slug = articles.find(x => x.id === selectedId)?.slug || 'social'
    const breakingTag = isBreaking ? '-breaking' : ''
    a.download = `tt-${style}-${formatKey}${breakingTag}-${slug.substring(0, 35)}.png`
    a.click()
  }, [imageData, style, formatKey, selectedId, articles, isBreaking])

  const format = FORMATS[formatKey]
  const previewScale = Math.min(560 / format.width, 560 / format.height)

  // Computed: which articles to show in the dropdown
  const visibleArticles = showOnlyBreaking
    ? articles.filter(a => a.is_breaking === true)
    : articles

  // Computed: is the manual toggle out of sync with the DB column?
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

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-white">Social Media Generator</h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          Imagini pentru rețele sociale — două stiluri de publicație
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">

        {/* LEFT */}
        <div className="space-y-4">

          {/* Style selector */}
          <div className={sec}>
            <p className={sh}>Stil</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setStyle('immersive'); setImageData('') }}
                className={`py-3 border font-sans text-[12px] font-bold transition-colors ${
                  style === 'immersive' ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/50 hover:text-white'
                }`}>
                Imersiv (NYT)
              </button>
              <button onClick={() => { setStyle('editorial'); setImageData('') }}
                className={`py-3 border font-sans text-[12px] font-bold transition-colors ${
                  style === 'editorial' ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/50 hover:text-white'
                }`}>
                Editorial
              </button>
            </div>
            <p className="font-sans text-[10px] text-white/20">
              {style === 'immersive'
                ? 'Titlu suprapus pe fotografie cu gradient cinematic. Optimal pentru mobil.'
                : 'Fotografie sus, titlu pe fond cream dedesubt. Stil editorial clasic.'}
            </p>
          </div>

          {/* Article picker */}
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
              {visibleArticles.map(a => (
                <option key={a.id} value={a.id}>
                  {a.is_breaking ? '🔴 ' : ''}
                  {(a.title_ro || a.title_en || a.slug).substring(0, 78)}
                </option>
              ))}
            </select>
            {visibleArticles.length === 0 && showOnlyBreaking && (
              <p className="font-sans text-[11px] text-white/40">
                Niciun articol nu este marcat ca &quot;Ultimele știri&quot; în prezent.
              </p>
            )}
          </div>

          {/* Breaking News control */}
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
              placeholder="Text badge (ex: BREAKING NEWS, ULTIMELE ȘTIRI)"
              disabled={!isBreaking}
            />
            {overrideHint && (
              <p className="font-sans text-[10px] text-[#F0A500]">⚠ {overrideHint}</p>
            )}
            <p className="font-sans text-[10px] text-white/20">
              Badge-ul se activează automat dacă articolul are bifa &quot;Ultimele știri&quot;.
              Poți forța manual on/off pentru orice articol.
            </p>
          </div>

          {/* Title editor */}
          <div className={sec}>
            <p className={sh}>Titlu (editabil)</p>
            <textarea className={inp + ' resize-none'} rows={3} value={title}
              onChange={e => { setTitle(e.target.value); setImageData('') }}
              placeholder="Titlul care va apărea pe imagine..." />
          </div>

          {/* Cover image */}
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

          {/* CTA */}
          <div className={sec}>
            <p className={sh}>Call to Action</p>
            <input className={inp} value={ctaRo}
              onChange={e => { setCtaRo(e.target.value); setImageData('') }}
              placeholder="Text CTA în română..." />
            <input className={inp} value={ctaEn}
              onChange={e => { setCtaEn(e.target.value); setImageData('') }}
              placeholder="CTA text in English..." />
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
        </div>

        {/* RIGHT */}
        <div className="flex flex-col items-center">
          {imageData ? (
            <div className="space-y-4">
              <div className="bg-[#1a1a1a] border border-white/[0.07] p-3 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={previewRef} src={imageData} alt="Preview"
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
                {format.width}×{format.height}px · PNG{isBreaking ? ' · Breaking News' : ''}
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
    </div>
  )
}
