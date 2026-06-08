'use client'

// app/admin/social/page.tsx
//
// Social media image generator — two publication-grade styles:
//   EDITORIAL: Photo top + cream text area (Guardian-inspired)
//   IMERSIV:   Full-bleed photo with title overlay (NYT-inspired)

import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Download, RefreshCw, Image as ImageIcon } from 'lucide-react'

// ─── FORMATS ──────────────────────────────────────────────────────────────────

interface Format {
  label: string; width: number; height: number
}

const FORMATS: Record<string, Format> = {
  square:    { label: 'Instagram / Facebook', width: 1080, height: 1080 },
  landscape: { label: 'Facebook / Twitter',   width: 1200, height: 630  },
  story:     { label: 'Instagram Story',      width: 1080, height: 1920 },
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
  const gap = size * 0.08 // gap between the two chevrons

  // Draw two filled chevrons pointing down
  for (let c = 0; c < 2; c++) {
    const top = y + c * (h + gap)

    ctx.beginPath()
    // Outer V shape
    ctx.moveTo(cx - w / 2, top)
    ctx.lineTo(cx, top + h)
    ctx.lineTo(cx + w / 2, top)
    // Inner V (cut-out to create thickness)
    ctx.lineTo(cx + w / 2 - t, top + t * 0.3)
    ctx.lineTo(cx, top + h - t)
    ctx.lineTo(cx - w / 2 + t, top + t * 0.3)
    ctx.closePath()
    ctx.fill()
  }

  ctx.restore()
}

// ─── EDITORIAL STYLE (Guardian-inspired) ──────────────────────────────────────

async function renderEditorial(
  coverUrl: string, title: string, logoUrl: string,
  format: Format, ctaRo: string, ctaEn: string,
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

  // 4. Navy left accent strip (4px, editorial mark)
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

  // 6. Bottom row: CTA left + logo right (vertically aligned)
  const bottomY = H - pad * 1.1
  const ctaFs = Math.round(fs * 0.22)

  // CTA text + arrow (left side, at bottom)
  ctx.font = `500 ${ctaFs}px ${sans}`
  ctx.fillStyle = B.navy
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(ctaRo, pad, bottomY - ctaFs - 2)

  ctx.font = `400 ${Math.round(ctaFs * 0.85)}px ${sans}`
  ctx.fillStyle = '#888888'
  ctx.fillText(ctaEn, pad, bottomY)

  // Arrow next to CTA text
  const ctaTextW = ctx.measureText(ctaEn).width
  drawArrow(ctx, pad + ctaTextW + 18, bottomY - ctaFs * 1.6, ctaFs * 2.8, B.red)

  // Logo (right side)
  try {
    const logo = await loadImg(logoUrl)
    const logoW = Math.round(W * 0.085)
    const logoH = (logo.height / logo.width) * logoW
    ctx.drawImage(logo, W - pad - logoW, bottomY - logoH + 4, logoW, logoH)
  } catch {
    ctx.font = `bold ${ctaFs * 1.3}px ${serif}`
    ctx.fillStyle = B.red; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText('Transilvania Times', W - pad, bottomY)
  }

  ctx.textAlign = 'left'
  return canvas.toDataURL('image/png')
}

// ─── IMMERSIVE STYLE (NYT-inspired) ──────────────────────────────────────────

async function renderImmersive(
  coverUrl: string, title: string, logoUrl: string,
  format: Format, ctaRo: string, ctaEn: string,
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

  // 2. Cinematic gradient from bottom (navy-black, 50% of image)
  const gradH = Math.round(H * 0.55)
  const grad = ctx.createLinearGradient(0, H - gradH, 0, H)
  grad.addColorStop(0, 'rgba(13,27,75,0)')       // navy transparent
  grad.addColorStop(0.3, 'rgba(13,27,75,0.4)')
  grad.addColorStop(0.6, 'rgba(13,27,75,0.75)')
  grad.addColorStop(1, 'rgba(13,27,75,0.92)')
  ctx.fillStyle = grad
  ctx.fillRect(0, H - gradH, W, gradH)

  // 3. Red accent line at very bottom
  ctx.fillStyle = B.red
  ctx.fillRect(0, H - 5, W, 5)

  // 4. Title (white, bold italic serif — NYT signature)
  let fs = Math.round(W * 0.05)
  const font = (s: number) => `bold italic ${s}px ${serif}`
  let lines = wrap(ctx, title, W - pad * 2, font(fs))
  const maxL = H > 1200 ? 7 : 4
  while (lines.length > maxL && fs > 24) { fs -= 2; lines = wrap(ctx, title, W - pad * 2, font(fs)) }
  const lh = fs * 1.25

  // Position title above the bottom section
  const ctaSpace = Math.round(pad * 2.2)
  const titleBottom = H - 5 - ctaSpace
  const titleTop = titleBottom - lines.length * lh

  ctx.font = font(fs)
  ctx.fillStyle = B.white
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // Text shadow for legibility
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 2
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], pad, titleTop + i * lh)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0

  // 5. Bottom row: CTA left + logo right
  const bottomY = H - 5 - pad * 0.6
  const ctaFs = Math.round(fs * 0.24)

  // CTA
  ctx.font = `500 ${ctaFs}px ${sans}`
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  ctx.fillText(ctaRo, pad, bottomY - ctaFs - 2)

  ctx.font = `400 ${Math.round(ctaFs * 0.85)}px ${sans}`
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(ctaEn, pad, bottomY)

  // Arrow
  const ctaW = ctx.measureText(ctaEn).width
  drawArrow(ctx, pad + ctaW + 18, bottomY - ctaFs * 1.6, ctaFs * 2.8, B.red)

  // Logo (right, white-on-dark works with the gradient)
  try {
    const logo = await loadImg(logoUrl)
    const logoW = Math.round(W * 0.085)
    const logoH = (logo.height / logo.width) * logoW
    ctx.drawImage(logo, W - pad - logoW, bottomY - logoH + 4, logoW, logoH)
  } catch {
    ctx.font = `bold ${ctaFs * 1.3}px ${serif}`
    ctx.fillStyle = B.amber; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText('Transilvania Times', W - pad, bottomY)
  }

  ctx.textAlign = 'left'
  return canvas.toDataURL('image/png')
}

// ─── ARTICLE TYPE ─────────────────────────────────────────────────────────────

interface Article {
  id: string; slug: string; title_ro: string | null; title_en: string | null
  cover_image: string | null; published_at: string | null
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
      .select('id, slug, title_ro, title_en, cover_image, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setArticles((data || []) as Article[]))
  }, [supabase])

  const selectArticle = useCallback((id: string) => {
    setSelectedId(id); setImageData('')
    const a = articles.find(x => x.id === id)
    if (a) { setTitle(a.title_ro || a.title_en || ''); setCoverUrl(a.cover_image || '') }
  }, [articles])

  const generate = useCallback(async () => {
    if (!title || !coverUrl) return
    setGenerating(true); setImageData('')
    try {
      const fmt = FORMATS[formatKey]
      const data = style === 'immersive'
        ? await renderImmersive(coverUrl, title, logoUrl, fmt, ctaRo, ctaEn)
        : await renderEditorial(coverUrl, title, logoUrl, fmt, ctaRo, ctaEn)
      setImageData(data)
    } catch (e) { console.error('Gen failed:', e) }
    setGenerating(false)
  }, [title, coverUrl, formatKey, logoUrl, ctaRo, ctaEn, style])

  const download = useCallback(() => {
    if (!imageData) return
    const a = document.createElement('a')
    a.href = imageData
    const slug = articles.find(x => x.id === selectedId)?.slug || 'social'
    a.download = `tt-${style}-${formatKey}-${slug.substring(0, 35)}.png`
    a.click()
  }, [imageData, style, formatKey, selectedId, articles])

  const format = FORMATS[formatKey]
  const previewScale = Math.min(560 / format.width, 560 / format.height)

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

          <div className={sec}>
            <p className={sh}>Articol</p>
            <select className={inp} value={selectedId} onChange={e => selectArticle(e.target.value)}>
              <option value="">— Alege un articol —</option>
              {articles.map(a => (
                <option key={a.id} value={a.id}>{(a.title_ro || a.title_en || a.slug).substring(0, 80)}</option>
              ))}
            </select>
          </div>

          <div className={sec}>
            <p className={sh}>Titlu (editabil)</p>
            <textarea className={inp + ' resize-none'} rows={3} value={title}
              onChange={e => { setTitle(e.target.value); setImageData('') }}
              placeholder="Titlul care va apărea pe imagine..." />
          </div>

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

          <div className={sec}>
            <p className={sh}>Call to Action</p>
            <input className={inp} value={ctaRo}
              onChange={e => { setCtaRo(e.target.value); setImageData('') }}
              placeholder="Text CTA în română..." />
            <input className={inp} value={ctaEn}
              onChange={e => { setCtaEn(e.target.value); setImageData('') }}
              placeholder="CTA text in English..." />
          </div>

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
              <p className="font-sans text-[10px] text-white/20 text-center">{format.width}×{format.height}px · PNG</p>
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
