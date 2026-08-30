// render-worker/src/draw.js
//
// Draws one compiled frame onto a canvas.
//
// Everything here is driven by the draw list that lib/timeline/compile.ts
// produces, which is the same structure the browser preview consumes. That is
// the whole point of the seam: a picture that previews correctly renders
// correctly, because both read the same resolved geometry rather than two
// separate implementations of the same intent.

'use strict'

/** Splits text to fit a width, measured with the real font. */
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ')
  if (!words.length || words[0] === '') return []
  const lines = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && current) {
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

function drawText(ctx, op, width, height) {
  const { style, text } = op.source
  // Type scales off the SHORT edge, not the height. Sizing off height makes
  // the same setting render more than three times larger (relative to frame
  // width) in a vertical frame than a horizontal one — which is how a caption
  // that looks right in 16:9 turns into a meme slab in 9:16.
  const shortEdge = Math.min(width, height)
  const fontSize = Math.round(shortEdge * style.size)
  const family = style.family.split(',')[0].replace(/['"]/g, '').trim()
  ctx.font = `${style.weight} ${fontSize}px "${family}", sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = style.align

  const maxWidth = (style.maxWidth ?? 0.86) * width
  const lines = wrapText(ctx, text, maxWidth, 2)
  if (!lines.length) return

  const lineHeight = fontSize * style.lineHeight
  const pad = Math.round(shortEdge * (style.padding ?? 0.012))
  // op.dest is the full-frame box recentred on the clip's position.
  const cx = op.dest.x + op.dest.w / 2
  const cy = op.dest.y + op.dest.h / 2
  const blockHeight = lines.length * lineHeight
  const top = cy - blockHeight / 2

  if (style.background) {
    let widest = 0
    for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width)
    ctx.fillStyle = style.background
    ctx.fillRect(
      cx - widest / 2 - pad * 2,
      top - pad,
      widest + pad * 4,
      blockHeight + pad * 2,
    )
  }

  ctx.fillStyle = style.color
  const anchor = style.align === 'left' ? cx - maxWidth / 2 : style.align === 'right' ? cx + maxWidth / 2 : cx
  lines.forEach((line, i) => {
    ctx.fillText(line, anchor, top + lineHeight * (i + 0.5))
  })
}

function drawShape(ctx, op) {
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

function drawBitmap(ctx, op, bitmap) {
  if (!bitmap) return
  const { x, y, w, h } = op.dest
  if (op.crop) {
    ctx.drawImage(bitmap, op.crop.x, op.crop.y, op.crop.w, op.crop.h, x, y, w, h)
  } else {
    ctx.drawImage(bitmap, x, y, w, h)
  }
}

/**
 * @param ctx        canvas 2d context sized to the master
 * @param frame      CompiledFrame from lib/timeline/compile
 * @param resolve    (op) => bitmap | null, for image and video sources
 */
function drawFrame(ctx, frame, width, height, resolve) {
  ctx.save()
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  for (const op of frame.video) {
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
    else drawBitmap(ctx, op, resolve(op))

    ctx.restore()
  }
}

module.exports = { drawFrame, wrapText }
