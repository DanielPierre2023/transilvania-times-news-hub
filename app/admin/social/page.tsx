'use client'

// app/admin/social/page.tsx
//
// Social media image generator for Transilvania Times.
// Composites: article cover photo + title + CTA arrow + TT logo
// into downloadable publication-grade images for social platforms.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Download, RefreshCw, Image as ImageIcon } from 'lucide-react'

// ─── FORMATS ──────────────────────────────────────────────────────────────────

interface Format {
  label: string
  width: number
  height: number
  imageRatio: number
  titleSize: number
  logoSize: number
}

const FORMATS: Record<string, Format> = {
  square: {
    label: 'Instagram / Facebook (1080×1080)',
    width: 1080, height: 1080,
    imageRatio: 0.58, titleSize: 50, logoSize: 90,
  },
  landscape: {
    label: 'Facebook / Twitter (1200×630)',
    width: 1200, height: 630,
    imageRatio: 0.52, titleSize: 38, logoSize: 70,
  },
  story: {
    label: 'Instagram Story (1080×1920)',
    width: 1080, height: 1920,
    imageRatio: 0.50, titleSize: 54, logoSize: 100,
  },
}

// ─── BRAND ────────────────────────────────────────────────────────────────────

const BRAND = {
  red: '#C41E3A',
  navy: '#0D1B4B',
  nearBlack: '#1A1A1A',
  darkGray: '#2A2A2A',
  medGray: '#666666',
  white: '#FFFFFF',
  bgLight: '#FFFFFF',
}

// ─── CANVAS HELPERS ───────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
): string[] {
  ctx.font = `bold ${fontSize}px ${fontFamily}`
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word
    if (ctx.measureText(testLine).width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = testLine
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function drawElegantArrow(
  ctx: CanvasRenderingContext2D,
  cx: number, // center x
  topY: number, // top of arrow
  height: number, // total arrow height
  color: string,
) {
  const stemWidth = 1.5
  const headWidth = 10
  const headHeight = 12
  const stemEnd = topY + height - headHeight

  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = stemWidth
  ctx.lineCap = 'round'

  // Stem
  ctx.beginPath()
  ctx.moveTo(cx, topY)
  ctx.lineTo(cx, stemEnd)
  ctx.stroke()

  // Arrowhead (chevron style — elegant, not filled triangle)
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - headWidth, stemEnd)
  ctx.lineTo(cx, stemEnd + headHeight)
  ctx.lineTo(cx + headWidth, stemEnd)
  ctx.stroke()
}

async function generateSocialImage(
  coverUrl: string,
  title: string,
  logoUrl: string,
  format: Format,
  ctaRo: string,
  ctaEn: string,
): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = format.width
  canvas.height = format.height
  const ctx = canvas.getContext('2d')!

  const pad = Math.round(format.width * 0.06)
  const imageH = Math.round(format.height * format.imageRatio)
  const textAreaH = format.height - imageH
  const serif = 'Georgia, "Times New Roman", Times, serif'
  const sans = '"Helvetica Neue", Helvetica, Arial, sans-serif'

  // ── 1. Cover image with bottom gradient fade ──────────────────────────
  try {
    const coverImg = await loadImage(coverUrl)
    const srcAspect = coverImg.width / coverImg.height
    const dstAspect = format.width / imageH
    let sx = 0, sy = 0, sw = coverImg.width, sh = coverImg.height
    if (srcAspect > dstAspect) {
      sw = coverImg.height * dstAspect
      sx = (coverImg.width - sw) / 2
    } else {
      sh = coverImg.width / dstAspect
      sy = (coverImg.height - sh) / 2
    }
    ctx.drawImage(coverImg, sx, sy, sw, sh, 0, 0, format.width, imageH)

    // Subtle gradient at bottom of photo for smooth transition
    const grad = ctx.createLinearGradient(0, imageH - 60, 0, imageH)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(1, 'rgba(255,255,255,0.15)')
    ctx.fillStyle = grad
    ctx.fillRect(0, imageH - 60, format.width, 60)
  } catch {
    ctx.fillStyle = BRAND.navy
    ctx.fillRect(0, 0, format.width, imageH)
  }

  // ── 2. Red accent line ────────────────────────────────────────────────
  ctx.fillStyle = BRAND.red
  ctx.fillRect(0, imageH, format.width, 5)

  // ── 3. White background for text area (matches logo background) ───────
  ctx.fillStyle = BRAND.bgLight
  ctx.fillRect(0, imageH + 5, format.width, textAreaH - 5)

  // ── 4. Title text ─────────────────────────────────────────────────────
  const textMaxW = format.width - pad * 2
  const titleTop = imageH + 5 + pad * 0.7

  let fontSize = format.titleSize
  let lines = wrapText(ctx, title, textMaxW, fontSize, serif)
  const maxLines = format.label.includes('Story') ? 6 : 4
  while (lines.length > maxLines && fontSize > 26) {
    fontSize -= 2
    lines = wrapText(ctx, title, textMaxW, fontSize, serif)
  }

  const lineHeight = fontSize * 1.22
  ctx.font = `bold ${fontSize}px ${serif}`
  ctx.fillStyle = BRAND.nearBlack
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], pad, titleTop + i * lineHeight)
  }

  // ── 5. CTA text + arrow (centered below title) ───────────────────────
  const titleBottom = titleTop + lines.length * lineHeight
  const ctaFontSize = Math.round(fontSize * 0.24)
  const ctaGap = Math.round(pad * 0.5)
  const ctaY = titleBottom + ctaGap

  // Romanian CTA
  ctx.font = `500 ${ctaFontSize}px ${sans}`
  ctx.fillStyle = BRAND.medGray
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(ctaRo, format.width / 2, ctaY)

  // English CTA (smaller, lighter)
  const enFontSize = Math.round(ctaFontSize * 0.85)
  ctx.font = `400 ${enFontSize}px ${sans}`
  ctx.fillStyle = '#999999'
  ctx.fillText(ctaEn, format.width / 2, ctaY + ctaFontSize + 4)

  // Elegant arrow below CTA
  const arrowTop = ctaY + ctaFontSize + 4 + enFontSize + 10
  const arrowHeight = Math.round(pad * 0.55)
  drawElegantArrow(ctx, format.width / 2, arrowTop, arrowHeight, BRAND.red)

  // ── 6. Logo (bottom-right) ────────────────────────────────────────────
  try {
    const logoImg = await loadImage(logoUrl)
    const logoW = format.logoSize
    const logoH = (logoImg.height / logoImg.width) * logoW
    const logoX = format.width - logoW - pad * 0.6
    const logoY = format.height - logoH - pad * 0.4
    ctx.drawImage(logoImg, logoX, logoY, logoW, logoH)
  } catch {
    ctx.font = `bold ${Math.round(ctaFontSize * 1.2)}px ${serif}`
    ctx.fillStyle = BRAND.red
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText('Transilvania Times', format.width - pad, format.height - pad * 0.4)
  }

  // ── 7. Thin border around the entire image ────────────────────────────
  ctx.strokeStyle = '#E0E0E0'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, format.width - 1, format.height - 1)

  ctx.textAlign = 'left'
  return canvas.toDataURL('image/png')
}

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface Article {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  published_at: string | null
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function SocialPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [title, setTitle] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [formatKey, setFormatKey] = useState<string>('square')
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
    setSelectedId(id)
    setImageData('')
    const article = articles.find(a => a.id === id)
    if (article) {
      setTitle(article.title_ro || article.title_en || '')
      setCoverUrl(article.cover_image || '')
    }
  }, [articles])

  const generate = useCallback(async () => {
    if (!title || !coverUrl) return
    setGenerating(true)
    setImageData('')
    try {
      const data = await generateSocialImage(
        coverUrl, title, logoUrl, FORMATS[formatKey], ctaRo, ctaEn
      )
      setImageData(data)
    } catch (e) {
      console.error('Generation failed:', e)
    }
    setGenerating(false)
  }, [title, coverUrl, formatKey, logoUrl, ctaRo, ctaEn])

  const download = useCallback(() => {
    if (!imageData) return
    const a = document.createElement('a')
    a.href = imageData
    const slug = articles.find(ar => ar.id === selectedId)?.slug || 'social'
    a.download = `tt-${formatKey}-${slug.substring(0, 40)}.png`
    a.click()
  }, [imageData, formatKey, selectedId, articles])

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
          Imagini pentru Facebook, Instagram, Twitter — format publicație
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">

        {/* LEFT */}
        <div className="space-y-4">

          <div className={sec}>
            <p className={sh}>Articol</p>
            <select className={inp} value={selectedId}
              onChange={e => selectArticle(e.target.value)}>
              <option value="">— Alege un articol —</option>
              {articles.map(a => (
                <option key={a.id} value={a.id}>
                  {(a.title_ro || a.title_en || a.slug).substring(0, 80)}
                </option>
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
                <img src={coverUrl} alt="Cover preview" className="w-full h-full object-cover" />
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
                    formatKey === key
                      ? 'bg-brand-red border-brand-red text-white'
                      : 'border-white/[0.07] text-white/50 hover:text-white hover:border-white/20'
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
              : <><ImageIcon className="w-4 h-4" /> Generează imagine</>
            }
          </button>
        </div>

        {/* RIGHT */}
        <div className="flex flex-col items-center">
          {imageData ? (
            <div className="space-y-4">
              <div className="bg-[#1a1a1a] border border-white/[0.07] p-4 inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={previewRef}
                  src={imageData}
                  alt="Social media preview"
                  style={{
                    width: format.width * previewScale,
                    height: format.height * previewScale,
                  }}
                />
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
                {format.width}×{format.height}px · PNG
              </p>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center p-8 text-center"
              style={{ width: format.width * previewScale + 32, height: format.height * previewScale + 32 }}>
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
