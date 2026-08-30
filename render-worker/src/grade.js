// render-worker/src/grade.js
//
// Shot-matching grade — the pass that was missing.
//
// Professional colour is decided ONCE, over the finished cut, matching every
// shot to a single look. Both failed films had five shots that each arrived a
// different colour and nothing corrected them afterwards. A generative model
// will never return a consistent look; the fix is not a better prompt, it is a
// deterministic pass after assembly.
//
// This one has an advantage no consumer tool has: it knows the EDIT. The
// timeline supplies the exact cut points, so each shot is measured and
// corrected on its own instead of one average smeared across the whole film.
//
// Two implementation details that separate this from a saturation slider:
//
//   1. Everything happens in LINEAR light. sRGB is gamma-encoded; scaling a
//      channel in gamma space skews the midtones and desaturates. Measure in
//      linear, correct in linear, convert back.
//   2. The statistic is a TRIMMED mean, 10th–90th percentile by luminance.
//      Specular highlights and crushed blacks otherwise drag the estimate.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { loadImage, createCanvas } = require('canvas')
const { FFMPEG } = require('./sources')

const LUMA = [0.2126, 0.7152, 0.0722]

/** Named looks, as chromaticity ratios. Normalised so a grade never changes exposure. */
const LOOKS = {
  golden: [1.16, 1.0, 0.74],
  warm: [1.08, 1.0, 0.88],
  neutral: [1.0, 1.0, 1.0],
  cool: [0.92, 1.0, 1.1],
}

function normaliseLook(rgb) {
  const l = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
  return rgb.map(v => v / l)
}

const srgbToLinear = s => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4))

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args)
    let err = ''
    p.stderr.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', c => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-1200)}`))))
  })
}

/** Trimmed mean in linear light for one extracted frame. */
async function measureFrame(file) {
  const img = await loadImage(file)
  const w = Math.min(240, img.width)
  const h = Math.max(1, Math.round((img.height / img.width) * w))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  const px = []
  for (let i = 0; i < data.length; i += 4) {
    const r = srgbToLinear(data[i] / 255)
    const g = srgbToLinear(data[i + 1] / 255)
    const b = srgbToLinear(data[i + 2] / 255)
    px.push([r, g, b, r * LUMA[0] + g * LUMA[1] + b * LUMA[2]])
  }
  px.sort((a, b) => a[3] - b[3])
  const lo = Math.floor(px.length * 0.1)
  const hi = Math.ceil(px.length * 0.9)
  const keep = hi - lo > 40 ? px.slice(lo, hi) : px

  const mean = [0, 0, 0]
  for (const p of keep) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2] }
  return mean.map(v => v / keep.length)
}

async function sampleAt(file, seconds, dir, tag) {
  const out = path.join(dir, `g_${tag}.png`)
  await run(['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
    '-vf', 'scale=240:-1', out, '-y'])
  return out
}

/**
 * Per-shot channel gains that move each shot onto the target look while holding
 * its own luminance. Clamped, because a channel that recorded almost nothing
 * cannot be recovered — it can only be amplified into noise.
 */
function planGains(meanLinear, look, strength = 1, clamp = [0.45, 2.6]) {
  const target = normaliseLook(LOOKS[look] || LOOKS.neutral)
  const lum = meanLinear[0] * LUMA[0] + meanLinear[1] * LUMA[1] + meanLinear[2] * LUMA[2]
  return meanLinear.map((m, i) => {
    const desired = target[i] * lum
    const raw = desired / Math.max(m, 1e-6)
    const g = 1 + (raw - 1) * strength
    return Math.min(clamp[1], Math.max(clamp[0], g))
  })
}

/** How far a shot still is from the look after correction, in linear units. */
function residual(meanLinear, gains, look) {
  const target = normaliseLook(LOOKS[look] || LOOKS.neutral)
  const after = meanLinear.map((m, i) => m * gains[i])
  const lum = after[0] * LUMA[0] + after[1] * LUMA[1] + after[2] * LUMA[2]
  return Math.hypot(...after.map((v, i) => v - target[i] * lum))
}

/** sRGB -> linear -> gain -> sRGB, baked into one lutrgb expression per channel. */
function lutExpr(gain) {
  const s = '(val/255)'
  const lin = `if(lte(${s},0.04045),${s}/12.92,pow((${s}+0.055)/1.055,2.4))`
  const out = `clip(${lin}*${gain.toFixed(5)},0,1)`
  return `if(lte(${out},0.0031308),${out}*12.92,1.055*pow(${out},0.41666)-0.055)*255`
}

/**
 * @param input    silent picture, already assembled
 * @param output   graded picture
 * @param shots    [{ start, end }] in seconds, from the timeline's own cut list
 * @param opts     { look, strength, saturation, contrast }
 */
async function gradeFilm(input, output, shots, opts = {}) {
  const look = opts.look || 'neutral'
  const strength = typeof opts.strength === 'number' ? opts.strength : 1
  const sat = typeof opts.saturation === 'number' ? opts.saturation : 1.06
  const con = typeof opts.contrast === 'number' ? opts.contrast : 1.04

  if (look === 'none' || !shots.length) {
    fs.copyFileSync(input, output)
    return { applied: false, shots: [] }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-'))
  const report = []
  try {
    // Frame count is sacred. An earlier version cut the film into segments with
    // trim and glued it back with concat — which silently lost two frames at the
    // seams, because trim boundaries are times and times do not land on frames.
    //
    // Instead: one unbroken chain, N copies of the LUT, each switched on only
    // for its own shot with `enable`. Nothing is re-timed, nothing is cut, and
    // the output has exactly as many frames as the input.
    const stages = []
    for (let i = 0; i < shots.length; i++) {
      const { start, end } = shots[i]
      const mid = start + (end - start) / 2
      const frame = await sampleAt(input, mid, dir, String(i))
      const mean = await measureFrame(frame)
      const gains = planGains(mean, look, strength)
      const before = residual(mean, [1, 1, 1], look)
      const after = residual(mean, gains, look)
      // A gain pinned to the clamp means the source is beyond rescue: the
      // channel is empty. Say so, so the caller can regenerate instead.
      const pinned = gains.some(g => g <= 0.4501 || g >= 2.5999)
      report.push({ shot: i + 1, meanLinear: mean, gains, before, after, pinned })

      // The last shot runs to +inf so a rounding gap at the tail cannot leave
      // the final frames ungraded.
      const until = i === shots.length - 1 ? 1e9 : end
      stages.push(
        `lutrgb=r='${lutExpr(gains[0])}':g='${lutExpr(gains[1])}':b='${lutExpr(gains[2])}'` +
        `:enable='between(t,${start.toFixed(3)},${until})'`,
      )
    }

    const chain = `[0:v]${stages.join(',')},eq=saturation=${sat}:contrast=${con}[vout]`

    await run(['-v', 'error', '-y', '-i', input, '-filter_complex', chain,
      '-map', '[vout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
      '-pix_fmt', 'yuv420p', '-vsync', '0', output])

    return {
      applied: true,
      look,
      shots: report,
      // The headline number: how much closer the film is to one look.
      improvement: report.length
        ? report.reduce((s, r) => s + (r.before - r.after), 0) / report.length
        : 0,
      unrescuable: report.filter(r => r.pinned).map(r => r.shot),
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* gone */ }
  }
}

module.exports = { gradeFilm, planGains, measureFrame, residual, lutExpr, LOOKS, normaliseLook }
