// lib/timeline/draw.ts
//
// ONE drawing implementation, used by the browser preview and by the worker.
//
// WHY THIS MOVED HERE
//
// The worker had its own draw.js and the Studio preview had its own canvas
// code, and the two agreed only by luck. Every typographic feature added from
// here on — letter-spaced kickers, a title that may run to three lines, a rule
// with a real thickness — would otherwise have to be written twice and would
// drift the first time one of them was fixed alone. compile.ts was always
// described as "the seam that makes the renderer replaceable"; this is the
// other half of that seam.
//
// The context is typed structurally rather than as a DOM CanvasRenderingContext2D
// so the same code runs against node-canvas in the worker, where several DOM
// niceties (ctx.letterSpacing among them) do not exist.

import type { CompiledFrame, DrawOp } from './compile'
import type { TextStyle } from './types'

export interface DrawableImage {
  readonly width?: number
  readonly height?: number
}

export interface Ctx2D {
  save(): void
  restore(): void
  translate(x: number, y: number): void
  rotate(a: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
  beginPath(): void
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void
  fill(): void
  drawImage(...args: never[]): void
  globalAlpha: number
  fillStyle: string
  font: string
  textAlign: string
  textBaseline: string
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
}

/** Splits text to fit a width, measured with the real font. */
export function wrapText(
  ctx: Ctx2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  advance: (s: string) => number,
): string[] {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ')
  if (!words.length || words[0] === '') return []
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (advance(candidate) > maxWidth && current) {
      lines.push(current)
      current = word
      if (lines.length === maxLines) return lines
    } else {
      current = candidate
    }
  }
  if (current && lines.length < maxLines) lines.push(current)
  return lines
}

/**
 * Letter spacing, done by hand.
 *
 * Chrome has ctx.letterSpacing; node-canvas does not, and the worker is
 * node-canvas. Doing it manually in one place means a kicker is tracked
 * identically in the preview and in the file, instead of being tracked in the
 * preview and tight in the render — which is the kind of difference nobody
 * notices until a client does.
 */
function drawTracked(ctx: Ctx2D, text: string, x: number, y: number, spacing: number, align: string) {
  if (!spacing) {
    ctx.textAlign = align
    ctx.fillText(text, x, y)
    return
  }
  const chars = Array.from(text)
  const total = chars.reduce((w, c) => w + ctx.measureText(c).width, 0) + spacing * (chars.length - 1)
  let cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x
  ctx.textAlign = 'left'
  for (const c of chars) {
    ctx.fillText(c, cursor, y)
    cursor += ctx.measureText(c).width + spacing
  }
}

function fontOf(style: TextStyle, px: number): string {
  const family = style.family.split(',')[0].replace(/['"]/g, '').trim()
  return `${style.weight} ${px}px "${family}", sans-serif`
}

/**
 * Karaoke: the caption, word by word, with the one being spoken picked out.
 *
 * This lived only in the Studio preview. The renderer ignored the word timings
 * entirely and drew the line as plain text, so "karaoke" was a mode you could
 * select, watch working in the preview, and never receive in the file. The word
 * timings were always in the document; nothing consumed them.
 */
function drawKaraoke(
  ctx: Ctx2D, op: DrawOp, style: TextStyle,
  words: readonly { word: string; start: number; end: number }[],
  width: number, height: number, fontSize: number, spacing: number,
): void {
  const gap = fontSize * 0.34
  const maxWidth = (style.maxWidth ?? 0.86) * width
  const advance = (s: string) =>
    ctx.measureText(s).width + (spacing ? spacing * Math.max(0, Array.from(s).length - 1) : 0)

  // Lay the words into lines the same way the plain caption wraps, so a long
  // cue does not run off the frame.
  const lines: { word: string; start: number; end: number }[][] = [[]]
  let lineWidth = 0
  for (const w of words) {
    const wide = advance(w.word)
    if (lineWidth > 0 && lineWidth + gap + wide > maxWidth) { lines.push([]); lineWidth = 0 }
    lines[lines.length - 1].push(w)
    lineWidth += (lineWidth > 0 ? gap : 0) + wide
  }

  const lineHeight = fontSize * style.lineHeight
  const cx = op.dest.x + op.dest.w / 2
  const cy = op.dest.y + op.dest.h / 2
  const top = cy - (lines.length * lineHeight) / 2
  const pad = Math.round(Math.min(width, height) * (style.padding ?? 0.012))

  lines.forEach((line, li) => {
    const widths = line.map(w => advance(w.word))
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, line.length - 1)
    const y = top + lineHeight * (li + 0.5)

    if (style.background) {
      ctx.fillStyle = style.background
      ctx.fillRect(cx - total / 2 - pad * 2, y - lineHeight / 2, total + pad * 4, lineHeight * 0.92)
    }

    let x = cx - total / 2
    line.forEach((w, i) => {
      const spoken = op.localFrame >= w.start
      const active = op.localFrame >= w.start && op.localFrame <= w.end
      ctx.fillStyle = active
        ? (style.activeColor ?? '#FFD37A')
        : spoken ? style.color : (style.pendingColor ?? 'rgba(255,255,255,0.42)')
      drawTracked(ctx, w.word, x, y, spacing, 'left')
      x += widths[i] + gap
    })
  })
}

export function drawText(ctx: Ctx2D, op: DrawOp, width: number, height: number): void {
  const source = op.source
  if (source.kind !== 'text') return
  const style = source.style
  // Type scales off the SHORT edge, not the height. Sizing off height renders
  // the same setting three times larger in a vertical frame than a horizontal
  // one — the bug that turned a caption into a meme slab in 9:16.
  const shortEdge = Math.min(width, height)
  const fontSize = Math.round(shortEdge * style.size)
  ctx.font = fontOf(style, fontSize)
  ctx.textBaseline = 'middle'

  const spacing = (style.letterSpacing ?? 0) * fontSize
  const advance = (s: string) =>
    ctx.measureText(s).width + (spacing ? spacing * Math.max(0, Array.from(s).length - 1) : 0)

  if (source.words && source.words.length) {
    drawKaraoke(ctx, op, style, source.words, width, height, fontSize, spacing)
    return
  }

  const maxWidth = (style.maxWidth ?? 0.86) * width
  const lines = wrapText(ctx, source.text, maxWidth, style.maxLines ?? 2, advance)
  if (!lines.length) return

  const lineHeight = fontSize * style.lineHeight
  const pad = Math.round(shortEdge * (style.padding ?? 0.012))
  const cx = op.dest.x + op.dest.w / 2
  const cy = op.dest.y + op.dest.h / 2
  const blockHeight = lines.length * lineHeight
  const top = cy - blockHeight / 2

  if (style.background) {
    let widest = 0
    for (const line of lines) widest = Math.max(widest, advance(line))
    ctx.fillStyle = style.background
    ctx.fillRect(cx - widest / 2 - pad * 2, top - pad, widest + pad * 4, blockHeight + pad * 2)
  }

  if (style.shadow) {
    ctx.shadowColor = style.shadow
    ctx.shadowBlur = Math.round(fontSize * 0.22)
    ctx.shadowOffsetY = Math.round(fontSize * 0.04)
  }

  ctx.fillStyle = style.color
  const anchor =
    style.align === 'left' ? cx - maxWidth / 2 : style.align === 'right' ? cx + maxWidth / 2 : cx
  lines.forEach((line, i) => {
    drawTracked(ctx, line, anchor, top + lineHeight * (i + 0.5), spacing, style.align)
  })

  if (style.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0)'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }
}

export function drawShape(ctx: Ctx2D, op: DrawOp): void {
  if (op.source.kind !== 'shape') return
  ctx.fillStyle = op.source.fill
  const { x, y, w, h } = op.dest
  if (op.source.shape === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillRect(x, y, w, h)
  }
}

export function drawBitmap(ctx: Ctx2D, op: DrawOp, bitmap: unknown): void {
  if (!bitmap) return
  // Stills arrive at twice the master, so every draw here is a reduction, and
  // the canvas default filter undersamples at that ratio. Measured against
  // ffmpeg's Lanczos, asking for the good resampler lands 26% closer at 2:1
  // and 52% closer at 3:1.
  const c = ctx as unknown as { patternQuality?: string; quality?: string; imageSmoothingQuality?: string; imageSmoothingEnabled?: boolean }
  c.patternQuality = 'best'
  c.quality = 'best'
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'high'
  const { x, y, w, h } = op.dest
  const draw = ctx.drawImage as unknown as (...a: unknown[]) => void
  if (op.crop) {
    draw.call(ctx, bitmap, op.crop.x, op.crop.y, op.crop.w, op.crop.h, x, y, w, h)
  } else {
    draw.call(ctx, bitmap, x, y, w, h)
  }
}

/**
 * @param resolve (op) => bitmap | null, for image and video sources
 */
export function drawFrame(
  ctx: Ctx2D,
  frame: CompiledFrame,
  width: number,
  height: number,
  resolve: (op: DrawOp) => unknown,
  opts?: { readonly clear?: boolean; readonly filter?: (op: DrawOp) => boolean },
): void {
  if (opts?.clear !== false) {
    ctx.save()
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
  }

  for (const op of frame.video) {
    if (opts?.filter && !opts.filter(op)) continue
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, op.opacity))

    if (op.rotation) {
      const cx = op.dest.x + op.dest.w / 2
      const cy = op.dest.y + op.dest.h / 2
      ctx.translate(cx, cy)
      ctx.rotate((op.rotation * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }

    const kind = op.source.kind
    if (kind === 'text') drawText(ctx, op, width, height)
    else if (kind === 'shape') drawShape(ctx, op)
    // An html block is a bitmap by the time it reaches here — rasterised once,
    // drawn identically by the preview and the renderer. That is the whole
    // reason it is not an iframe on one side and headless Chrome on the other.
    else drawBitmap(ctx, op, resolve(op))

    ctx.restore()
  }
}
