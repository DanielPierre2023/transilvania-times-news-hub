// lib/social/card.ts
//
// Shared Transilvania Times social-card renderer — the "cream band" template.
//
// Layout (chosen Sep 2025, replacing the old red speech-bubble card):
//   • full-bleed cover photo on top
//   • a solid CREAM band below that hugs its content
//   • a red rubric/category chip, then the headline in Lora serif (near-black)
//   • a footer row: "Transilvania Times" wordmark + the domain, over a hairline
//   • the logo on a small white chip in the photo's top-right corner
//   • a slanted red "ULTIMA ORĂ" flag on the photo, breaking news only
//
// One source of truth: the manual Social Media Generator (app/admin/social) and
// the automatic on-publish fan-out (lib/social/share.ts) both call renderCard,
// so a manual card and an auto-posted card are byte-identical. Client-only.

// ─── FORMATS ──────────────────────────────────────────────────────────────────

export interface Format {
  label: string
  width: number
  height: number
}

// 4:5 is the default — it takes ~25% more vertical space in the IG/FB feed than
// a square. 1:1 and 9:16 stay available; 1200×630 is a wide fallback.
export const FORMATS: Record<string, Format> = {
  portrait:  { label: 'Instagram / Facebook (4:5)',    width: 1080, height: 1350 },
  square:    { label: 'Instagram / Facebook (1:1)',    width: 1080, height: 1080 },
  story:     { label: 'Instagram Story (9:16)',        width: 1080, height: 1920 },
  landscape: { label: 'Facebook / Twitter (1200×630)', width: 1200, height: 630  },
}

// ─── BRAND ────────────────────────────────────────────────────────────────────

const B = {
  red: '#C41E3A',
  navy: '#0D1B4B',
  amber: '#F0A500',
  cream: '#F5F4F0',
  ink: '#1A1A1A',
  white: '#FFFFFF',
}

export type Lang = 'ro' | 'en'
export type Band = 'cream' | 'navy'

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif'
// Lora — masthead serif. Falls back to Georgia where Lora is not loaded.
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

// Best-effort: make sure the Lora weights we use are ready before we measure /
// draw, so the first render isn't a Georgia fallback. Never throws.
async function ensureFonts(): Promise<void> {
  try {
    const fonts = (document as unknown as { fonts?: { load: (f: string) => Promise<unknown>; ready: Promise<unknown> } }).fonts
    if (!fonts) return
    await Promise.all([fonts.load('600 48px Lora'), fonts.load('700 32px Lora')])
    await fonts.ready
  } catch { /* fonts not available — Georgia fallback is fine */ }
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

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const sa = img.width / img.height
  const da = w / h
  let sx = 0, sy = 0, sw = img.width, sh = img.height
  if (sa > da) { sw = img.height * da; sx = (img.width - sw) / 2 }
  else         { sh = img.width / da;  sy = (img.height - sh) / 2 }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

// Manual letter-spacing (portable — avoids ctx.letterSpacing support gaps).
function measureSpaced(ctx: CanvasRenderingContext2D, text: string, sp: number): number {
  let w = 0
  for (const ch of text) w += ctx.measureText(ch).width + sp
  return Math.max(0, w - sp)
}
function fillSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number) {
  let cx = x
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

// ─── LOGO badge (top-right of the photo, on a white chip) ────────────────────

async function drawLogoBadge(ctx: CanvasRenderingContext2D, W: number, logoUrl: string, u: (n: number) => number) {
  const pad = u(4.6)
  const maxW = u(24), maxH = u(9.5)
  try {
    const logo = await loadImg(logoUrl)
    let lw = maxW, lh = (logo.height / logo.width) * lw
    if (lh > maxH) { lh = maxH; lw = (logo.width / logo.height) * lh }
    const inner = u(2.1)
    const bw = lw + inner * 2, bh = lh + inner * 2
    const bx = W - pad - bw, by = pad
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.34)'; ctx.shadowBlur = u(2.2); ctx.shadowOffsetY = u(0.5)
    ctx.fillStyle = B.white
    roundRectPath(ctx, bx, by, bw, bh, u(2))
    ctx.fill()
    ctx.restore()
    ctx.drawImage(logo, bx + inner, by + inner, lw, lh)
  } catch {
    // Fallback: compact red chip with a white "TT" — never the wide wordmark.
    const s = u(11)
    const bx = W - pad - s, by = pad
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.34)'; ctx.shadowBlur = u(2.2); ctx.shadowOffsetY = u(0.5)
    ctx.fillStyle = B.red
    roundRectPath(ctx, bx, by, s, s, u(2.4))
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = B.white
    ctx.font = `700 ${u(5)}px ${SERIF}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('TT', bx + s / 2, by + s / 2 + u(0.3))
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }
}

// ─── BREAKING flag (slanted red, upright white label; photo bottom-left) ─────

function drawBreakingFlag(ctx: CanvasRenderingContext2D, label: string, bottomY: number, u: (n: number) => number) {
  const text = (label || '').trim().toUpperCase()
  if (!text) return
  const fs = u(4.0), sp = u(0.5)
  const padL = u(4.6), padR = u(3.6), padV = u(1.9), skew = u(3.0)
  ctx.font = `800 ${fs}px ${SANS}`
  const tw = measureSpaced(ctx, text, sp)
  const h = fs * 1.16 + padV * 2
  const w = tw + padL + padR + skew
  const top = bottomY - h
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.42)'; ctx.shadowBlur = u(2.4); ctx.shadowOffsetY = u(0.6)
  ctx.fillStyle = B.red
  ctx.beginPath()
  ctx.moveTo(skew, top)
  ctx.lineTo(w, top)
  ctx.lineTo(w - skew, bottomY)
  ctx.lineTo(0, bottomY)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = B.white
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
  fillSpaced(ctx, text, padL, top + h / 2 + u(0.2), sp)
  ctx.textBaseline = 'alphabetic'
}

// ─── MAIN RENDER ─────────────────────────────────────────────────────────────

export interface RenderCardOptions {
  coverUrl: string
  title: string
  rubric: string          // category label, e.g. "LOCAL" — empty hides the chip
  domain: string          // e.g. "transilvaniatimes.com"
  logoUrl: string
  format: Format
  isBreaking: boolean
  breakingLabel: string   // e.g. "ULTIMA ORĂ"
  band?: Band             // 'cream' (default) | 'navy'
}

export async function renderCard(o: RenderCardOptions): Promise<string> {
  const { width: W, height: H } = o.format
  const u = (n: number) => (n / 100) * W          // n "cqw" → px
  const band: Band = o.band === 'navy' ? 'navy' : 'cream'
  const onCream = band === 'cream'

  await ensureFonts()

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Band metrics --------------------------------------------------------------
  const padSide = u(5.2), padTop = u(5.4), padBot = u(4.6)
  const innerW = W - padSide * 2
  const rubFs = u(3.15), rubPadV = u(1.5), rubPadH = u(2.6)
  const hasRubric = !!(o.rubric && o.rubric.trim())
  const rubChipH = hasRubric ? Math.round(rubFs * 1.15 + rubPadV * 2) : 0
  const gapRH = hasRubric ? u(3.2) : 0
  const gapHF = u(3.6)
  const footRowH = Math.round(u(5.2))

  const bandFixed = padTop + rubChipH + gapRH + gapHF + footRowH + padBot
  const measureBand = (fs: number) => {
    const lines = wrap(ctx, o.title, innerW, `600 ${fs}px ${SERIF}`)
    const lineH = fs * 1.15
    return { bandH: bandFixed + lines.length * lineH, lines, lineH }
  }

  let headFs = u(6.3)
  let m = measureBand(headFs)
  const minPhoto = 0.46 * H
  while (H - m.bandH < minPhoto && headFs > u(4.5)) { headFs -= u(0.22); m = measureBand(headFs) }
  const bandH = Math.round(Math.min(m.bandH, H - Math.round(0.4 * H)))
  const photoH = H - bandH

  // 1. Cover photo (or navy fallback) -----------------------------------------
  try {
    const img = await loadImg(o.coverUrl)
    drawCover(ctx, img, 0, 0, W, photoH)
  } catch {
    ctx.fillStyle = B.navy; ctx.fillRect(0, 0, W, photoH)
  }
  // Top scrim so the logo chip stays legible over bright photos.
  const scrimH = photoH * 0.34
  const g = ctx.createLinearGradient(0, 0, 0, scrimH)
  g.addColorStop(0, 'rgba(0,0,0,0.30)'); g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, scrimH)

  // 2. Band background --------------------------------------------------------
  ctx.fillStyle = onCream ? B.cream : B.navy
  ctx.fillRect(0, photoH, W, bandH)

  // 3. Rubric chip ------------------------------------------------------------
  let y = photoH + padTop
  if (hasRubric) {
    const label = o.rubric.trim().toUpperCase()
    const sp = u(0.42)
    ctx.font = `800 ${rubFs}px ${SANS}`
    const tw = measureSpaced(ctx, label, sp)
    const chipW = tw + rubPadH * 2
    ctx.fillStyle = B.red
    roundRectPath(ctx, padSide, y, chipW, rubChipH, u(1.2))
    ctx.fill()
    ctx.fillStyle = B.white
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    fillSpaced(ctx, label, padSide + rubPadH, y + rubChipH / 2 + u(0.2), sp)
    ctx.textBaseline = 'alphabetic'
    y += rubChipH + gapRH
  }

  // 4. Headline ---------------------------------------------------------------
  ctx.fillStyle = onCream ? B.ink : B.white
  ctx.font = `600 ${headFs}px ${SERIF}`
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  for (let i = 0; i < m.lines.length; i++) ctx.fillText(m.lines[i], padSide, y + i * m.lineH)
  ctx.textBaseline = 'alphabetic'

  // 5. Footer (hairline + wordmark + domain) ----------------------------------
  const footTop = photoH + bandH - padBot - footRowH
  ctx.strokeStyle = onCream ? 'rgba(26,26,26,0.15)' : 'rgba(255,255,255,0.22)'
  ctx.lineWidth = Math.max(1, u(0.09))
  ctx.beginPath(); ctx.moveTo(padSide, footTop); ctx.lineTo(W - padSide, footTop); ctx.stroke()

  const rowMid = footTop + (footRowH + u(3.2)) / 2 + u(0.6)
  ctx.fillStyle = onCream ? B.ink : B.white
  ctx.font = `700 ${u(3.5)}px ${SERIF}`
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText('Transilvania Times', padSide, rowMid)

  const domain = (o.domain || '').trim()
  if (domain) {
    const dsp = u(0.24)
    ctx.font = `800 ${u(3.05)}px ${SANS}`
    ctx.fillStyle = onCream ? B.red : B.amber
    const dw = measureSpaced(ctx, domain, dsp)
    fillSpaced(ctx, domain, W - padSide - dw, rowMid, dsp)
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'

  // 6. Logo badge + breaking flag (on the photo) ------------------------------
  await drawLogoBadge(ctx, W, o.logoUrl, u)
  if (o.isBreaking) drawBreakingFlag(ctx, o.breakingLabel, photoH - u(3.4), u)

  return canvas.toDataURL('image/png')
}
