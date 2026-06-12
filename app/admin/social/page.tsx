'use client'

// app/admin/social/page.tsx
//
// Social media card generator — single PNL-style layout:
//
//   ┌─────────────────────────────────────────┐
//   │                                         │
//   │           [FULL-BLEED COVER PHOTO]      │
//   │                                         │
//   │                                         │
//   │  ┌─ BREAKING ┐                          │   ← only when is_breaking=true
//   │  └─┐  NEWS  ┘            [LOGO TT]      │   ← logo bottom-right, smaller
//   │    └────────┘                           │
//   │  ┌────── TITLE IN RED BUBBLE ──────┐    │   ← rounded red bubble, white centered text
//   │  │     (bold, white, centered)     │    │
//   │  └─────────────▼───────────────────┘    │   ← red downward triangle tail
//   ├──────── ARTICOL ÎN COMENTARII! ─────────┤   ← red bold text on white CTA banner
//   └─────────────────────────────────────────┘
//
// Language toggle: RO ↔ EN. When EN selected, uses title_en + English CTA.
// Breaking News badge: ONLY when the article's "Ultimele știri" box is checked
// (blog_posts.is_breaking = true). Manual override available.

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Download, RefreshCw, Image as ImageIcon, Radio } from 'lucide-react'

// ─── FORMATS ──────────────────────────────────────────────────────────────────

interface Format {
  label: string
  width: number
  height: number
  bubbleH: number  // bubble height as fraction of canvas height
  ctaH: number     // CTA banner height as fraction of canvas height
}

const FORMATS: Record<string, Format> = {
  square:    { label: 'Instagram / Facebook (1:1)',     width: 1080, height: 1080, bubbleH: 0.19, ctaH: 0.09 },
  landscape: { label: 'Facebook / Twitter (1200×630)',  width: 1200, height: 630,  bubbleH: 0.32, ctaH: 0.13 },
  story:     { label: 'Instagram Story (9:16)',         width: 1080, height: 1920, bubbleH: 0.14, ctaH: 0.07 },
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

type Lang = 'ro' | 'en'

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif'
// Lora — masthead serif. Project font, falls back to Georgia where Lora is not loaded.
const SERIF = 'Lora, Georgia, "Times New Roman", serif'

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
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur)
      cur = w
    } else {
      cur = test
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const sa = img.width / img.height
  const da = w / h
  let sx = 0, sy = 0, sw = img.width, sh = img.height
  if (sa > da) { sw = img.height * da; sx = (img.width - sw) / 2 }
  else         { sh = img.width / da;  sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h)
}

// ─── BREAKING NEWS BADGE — two slanted red boxes, stacked, with white text ───
// Mirrors the lower-third "TV news" graphic from the PNL reference. Splits the
// label on whitespace: first word in top box, rest in bottom (offset right).

function drawBreakingBadge(
  ctx: CanvasRenderingContext2D,
  W: number,
  label: string,
  topY: number,
  scale: number,
) {
  const trimmed = label.trim()
  if (!trimmed) return

  const parts = trimmed.split(/\s+/)
  const lineA = parts[0] || ''
  const lineB = parts.slice(1).join(' ')

  const ref = W * scale
  const h1 = Math.round(ref * 0.058)
  const h2 = Math.round(ref * 0.048)
  const slant = Math.round(ref * 0.034)  // sharper slant — bolder TV-graphic feel
  const padIn = Math.round(ref * 0.018)
  const pad = Math.round(W * 0.04)

  // Measure
  ctx.save()
  ctx.font = `900 ${Math.round(h1 * 0.56)}px ${SANS}`
  const wA = ctx.measureText(lineA).width
  ctx.font = `900 ${Math.round(h2 * 0.56)}px ${SANS}`
  const wB = lineB ? ctx.measureText(lineB).width : 0
  ctx.restore()

  const boxAw = wA + padIn * 2 + slant
  const boxBw = wB + padIn * 2 + slant

  const xA = pad
  const yA = topY

  // Box A (top, with shadow)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 4
  ctx.fillStyle = B.red
  ctx.beginPath()
  ctx.moveTo(xA, yA)
  ctx.lineTo(xA + boxAw - slant, yA)
  ctx.lineTo(xA + boxAw, yA + h1)
  ctx.lineTo(xA, yA + h1)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Box A text
  ctx.font = `900 ${Math.round(h1 * 0.56)}px ${SANS}`
  ctx.fillStyle = B.white
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(lineA, xA + padIn, yA + h1 / 2 + 1)

  // Box B (offset right and below)
  if (lineB) {
    const xB = xA + Math.round(boxAw * 0.62)   // more dramatic offset right
    const yB = yA + h1 + Math.round(h1 * 0.04)  // tighter vertical stack
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 4
    ctx.fillStyle = B.red
    ctx.beginPath()
    ctx.moveTo(xB, yB)
    ctx.lineTo(xB + boxBw - slant, yB)
    ctx.lineTo(xB + boxBw, yB + h2)
    ctx.lineTo(xB, yB + h2)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    ctx.font = `900 ${Math.round(h2 * 0.56)}px ${SANS}`
    ctx.fillStyle = B.white
    ctx.fillText(lineB, xB + padIn, yB + h2 / 2 + 1)
  }

  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

// ─── SPEECH BUBBLE — red rounded rect, white bold centered title ─────────────

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  W: number,
  title: string,
  top: number,
  h: number,
) {
  // Tighter bubble — 88% of canvas width — gives editorial breathing room
  const pad = Math.round(W * 0.06)
  const x = pad
  const w = W - pad * 2
  const radius = Math.round(W * 0.032)

  // Helper to trace the rounded-rect path — used twice for layered shadow
  const tracePath = () => {
    ctx.beginPath()
    ctx.moveTo(x + radius, top)
    ctx.lineTo(x + w - radius, top)
    ctx.arcTo(x + w, top, x + w, top + radius, radius)
    ctx.lineTo(x + w, top + h - radius)
    ctx.arcTo(x + w, top + h, x + w - radius, top + h, radius)
    ctx.lineTo(x + radius, top + h)
    ctx.arcTo(x, top + h, x, top + h - radius, radius)
    ctx.lineTo(x, top + radius)
    ctx.arcTo(x, top, x + radius, top, radius)
    ctx.closePath()
  }

  // PASS 1: wide ambient shadow (Material elevation 3 — low opacity, big blur)
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.28)'
  ctx.shadowBlur = 56
  ctx.shadowOffsetY = 20
  ctx.fillStyle = B.red
  tracePath()
  ctx.fill()
  ctx.restore()

  // PASS 2: close shadow (higher contrast, tight blur) — stacks for depth
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 5
  ctx.fillStyle = B.red
  tracePath()
  ctx.fill()
  ctx.restore()

  // Title: Lora serif, bold, white, centered, auto-shrink to fit.
  // Serif reads slightly smaller than sans optically, so fs starts higher and
  // line height is tighter (1.18 vs 1.22) — classic editorial setting.
  const innerPad = Math.round(W * 0.045)
  const titleMaxW = w - innerPad * 2

  let fs = Math.round(W * 0.056)
  let lines = wrap(ctx, title, titleMaxW, `700 ${fs}px ${SERIF}`)
  const maxLines = Math.max(2, Math.floor((h - innerPad * 0.5) / (fs * 1.18)))
  while (lines.length > maxLines && fs > 22) {
    fs -= 2
    lines = wrap(ctx, title, titleMaxW, `700 ${fs}px ${SERIF}`)
  }
  const lh = fs * 1.18
  const blockH = lines.length * lh
  const textTop = top + (h - blockH) / 2

  ctx.font = `700 ${fs}px ${SERIF}`
  ctx.fillStyle = B.white
  ctx.textBaseline = 'top'
  ctx.textAlign = 'center'
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], W / 2, textTop + i * lh)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

// ─── BUBBLE TAIL TRIANGLE (red, pointing down) ───────────────────────────────

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  baseW: number,
  triH: number,
) {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.30)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 4
  ctx.fillStyle = B.red
  ctx.beginPath()
  ctx.moveTo(cx - baseW / 2, topY)
  ctx.lineTo(cx + baseW / 2, topY)
  ctx.lineTo(cx, topY + triH)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

// ─── CTA BANNER (white background, red bold text) ────────────────────────────

function drawCtaBanner(
  ctx: CanvasRenderingContext2D,
  W: number,
  cta: string,
  top: number,
  h: number,
) {
  // White background
  ctx.fillStyle = B.white
  ctx.fillRect(0, top, W, h)

  // Thin amber accent stripe at the very top of the banner — uses the brand
  // amber (#F0A500) as a publication-grade seam between bubble and CTA.
  // Same role as the colored bar on the masthead.
  const stripeH = Math.max(4, Math.round(W * 0.005))
  ctx.fillStyle = B.amber
  ctx.fillRect(0, top, W, stripeH)

  let fs = Math.round(h * 0.42)
  ctx.font = `900 ${fs}px ${SANS}`
  let textW = ctx.measureText(cta).width
  while (textW > W * 0.86 && fs > 18) {
    fs -= 2
    ctx.font = `900 ${fs}px ${SANS}`
    textW = ctx.measureText(cta).width
  }

  ctx.fillStyle = B.red
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillText(cta, W / 2, top + h / 2 + Math.round(fs * 0.05))
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

// ─── LOGO (bottom-right corner, smaller, with shadow for legibility) ─────────

async function drawLogo(
  ctx: CanvasRenderingContext2D,
  W: number,
  logoUrl: string,
  bottomY: number,
  sizePct: number,
) {
  const pad = Math.round(W * 0.04)
  try {
    const logo = await loadImg(logoUrl)
    const logoW = Math.round(W * sizePct)
    const logoH = (logo.height / logo.width) * logoW
    const logoX = W - pad - logoW
    const logoY = bottomY - logoH

    // White rounded-square backdrop with subtle drop shadow — separates
    // the dark logo emblem from whatever photo content is behind it.
    const bgPad = Math.round(logoW * 0.16)
    const bgX = logoX - bgPad
    const bgY = logoY - bgPad
    const bgW = logoW + bgPad * 2
    const bgH = logoH + bgPad * 2
    const radius = Math.round(bgW * 0.14)

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.40)'
    ctx.shadowBlur = 22
    ctx.shadowOffsetY = 6
    ctx.fillStyle = B.white
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

    // Logo drawn on top of backdrop, no shadow (backdrop already has one)
    ctx.drawImage(logo, logoX, logoY, logoW, logoH)
  } catch {
    // Fallback: text on red rounded pill
    ctx.save()
    ctx.font = `900 ${Math.round(W * 0.022)}px ${SANS}`
    const label = 'TRANSILVANIA TIMES'
    const textW = ctx.measureText(label).width
    const pillH = Math.round(W * 0.045)
    const pillPad = Math.round(W * 0.022)
    const pillW = textW + pillPad * 2
    const pillX = W - pad - pillW
    const pillY = bottomY - pillH
    const pillR = pillH / 2

    ctx.shadowColor = 'rgba(0,0,0,0.40)'
    ctx.shadowBlur = 18
    ctx.shadowOffsetY = 4
    ctx.fillStyle = B.red
    ctx.beginPath()
    ctx.moveTo(pillX + pillR, pillY)
    ctx.lineTo(pillX + pillW - pillR, pillY)
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillR, pillR)
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - pillR, pillY + pillH, pillR)
    ctx.lineTo(pillX + pillR, pillY + pillH)
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - pillR, pillR)
    ctx.arcTo(pillX, pillY, pillX + pillR, pillY, pillR)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    ctx.font = `900 ${Math.round(W * 0.022)}px ${SANS}`
    ctx.fillStyle = B.white
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, pillX + pillW / 2, pillY + pillH / 2 + 1)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
}

// ─── MAIN RENDER ─────────────────────────────────────────────────────────────

async function renderCard(
  coverUrl: string,
  title: string,
  logoUrl: string,
  format: Format,
  cta: string,
  isBreaking: boolean,
  breakingLabel: string,
): Promise<string> {
  const { width: W, height: H } = format
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // 1. Full-bleed cover photo
  try {
    const img = await loadImg(coverUrl)
    drawCover(ctx, img, W, H)
  } catch {
    ctx.fillStyle = B.navy
    ctx.fillRect(0, 0, W, H)
  }

  // Layout zones (bottom-up)
  const ctaH = Math.round(H * format.ctaH)
  const triW = Math.round(W * 0.060)
  const triH = Math.round(W * 0.030)
  const bubbleH = Math.round(H * format.bubbleH)

  const ctaTop = H - ctaH
  const triTop = ctaTop - 2                           // triangle slightly overlaps CTA top edge
  const bubbleTop = ctaTop - bubbleH                  // bubble sits directly above CTA

  // Breaking + Logo zone (above bubble)
  const aboveBubbleGap = Math.round(H * 0.012)
  const badgeScale = H < 800 ? 0.78 : 1.0             // shrink badge for landscape
  const badgeTopY = bubbleTop - aboveBubbleGap - Math.round(W * 0.16 * badgeScale)
  const logoBottomY = bubbleTop - aboveBubbleGap

  // 2. Breaking badge (left) — only if checked
  if (isBreaking) {
    drawBreakingBadge(ctx, W, breakingLabel, badgeTopY, badgeScale)
  }

  // 3. Logo (right) — smaller than previous version
  await drawLogo(ctx, W, logoUrl, logoBottomY, 0.105)

  // 4. CTA banner (drawn before bubble/triangle so they overlay it)
  drawCtaBanner(ctx, W, cta, ctaTop, ctaH)

  // 5. Speech bubble
  drawSpeechBubble(ctx, W, title, bubbleTop, bubbleH)

  // 6. Triangle tail — pokes from bubble into CTA banner
  drawTriangle(ctx, W / 2, triTop, triW, triH)

  return canvas.toDataURL('image/png')
}

// ─── ARTICLE TYPE ─────────────────────────────────────────────────────────────

interface Article {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  published_at: string | null
  is_breaking: boolean | null
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function SocialPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [lang, setLang] = useState<Lang>('ro')
  const [title, setTitle] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [formatKey, setFormatKey] = useState<string>('story')
  const [isBreaking, setIsBreaking] = useState(false)
  const [breakingLabel, setBreakingLabel] = useState('BREAKING NEWS')
  const [ctaRo, setCtaRo] = useState('ARTICOL ÎN COMENTARII!')
  const [ctaEn, setCtaEn] = useState('ARTICLE IN COMMENTS!')
  const [showOnlyBreaking, setShowOnlyBreaking] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [imageData, setImageData] = useState('')
  const [logoUrl] = useState('/assets/logos/logo-transilvania-times.png')

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
    setSelectedId(id)
    setImageData('')
    const a = articles.find(x => x.id === id)
    if (a) {
      setTitle(lang === 'ro' ? (a.title_ro || a.title_en || '') : (a.title_en || a.title_ro || ''))
      setCoverUrl(a.cover_image || '')
      setIsBreaking(a.is_breaking === true)
    }
  }, [articles, lang])

  // Toggle language — if an article is selected, refresh title from its DB row
  const switchLang = useCallback((newLang: Lang) => {
    setLang(newLang)
    setImageData('')
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

  const download = useCallback(() => {
    if (!imageData) return
    const a = document.createElement('a')
    a.href = imageData
    const slug = articles.find(x => x.id === selectedId)?.slug || 'social'
    const breakingTag = isBreaking ? '-breaking' : ''
    a.download = `tt-${lang}-${formatKey}${breakingTag}-${slug.substring(0, 35)}.png`
    a.click()
  }, [imageData, lang, formatKey, selectedId, articles, isBreaking])

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

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-white">Social Media Generator</h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          Card cu titlu în Lora serif, BREAKING NEWS opțional, CTA bilingv
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
              Schimbă titlul, textul CTA și numele fișierului PNG.
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

          {/* CTA */}
          <div className={sec}>
            <p className={sh}>Call to Action</p>
            <div>
              <p className={`font-sans text-[10px] mb-1 ${lang === 'ro' ? 'text-white' : 'text-white/30'}`}>
                RO {lang === 'ro' && <span className="text-[#C41E3A]">· activ</span>}
              </p>
              <input className={inp} value={ctaRo}
                onChange={e => { setCtaRo(e.target.value); setImageData('') }}
                placeholder="ARTICOL ÎN COMENTARII!" />
            </div>
            <div>
              <p className={`font-sans text-[10px] mb-1 ${lang === 'en' ? 'text-white' : 'text-white/30'}`}>
                EN {lang === 'en' && <span className="text-[#C41E3A]">· active</span>}
              </p>
              <input className={inp} value={ctaEn}
                onChange={e => { setCtaEn(e.target.value); setImageData('') }}
                placeholder="ARTICLE IN COMMENTS!" />
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
    </div>
  )
}
