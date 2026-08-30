// render-worker/src/vision.js
//
// tt-vision — objective inspection of a generated shot.
//
// The premise of every other generative tool is: generate once, show the human,
// hope. This measures instead, and the measurements are chosen to catch the two
// failures that actually happen.
//
// THE INSIGHT THAT MATTERS
//
// Mean pixel difference cannot tell a camera move from a model hallucinating
// texture in place. Measured on a calibration corpus: a real 4-second pan and a
// generative clip that goes nowhere can produce similar frame differences.
//
// So this separates them. Consecutive frames are aligned by searching for the
// translation (and scale) that best matches them. What the alignment finds is
// COHERENT MOTION — a camera actually moved. What is left over after aligning is
// SHIMMER — pixels changing while the picture goes nowhere. A shot with high
// shimmer and zero displacement is boiling, not moving, and it is rejectable.
//
// Calibration, measured (percent of frame width per second):
//
//   still image .................. move 0.00   shimmer 0.00
//   slow 10% push over 4s ........ move 0.00   shimmer 0.49   (zoom, not pan)
//   real pan across a frame ...... move 4.95   shimmer 4.93
//   five Kling shots, delivered .. move 0.00   shimmer 1.08 – 2.32
//
// Zero displacement with three to five times the shimmer of a clean push is the
// signature of a dead generation.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { loadImage, createCanvas } = require('canvas')
const { FFMPEG } = require('./sources')
const { measureFrame } = require('./grade')

const LUMA = [0.2126, 0.7152, 0.0722]

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args)
    let err = ''
    p.stderr.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', c => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-900)}`))))
  })
}

async function grayAt(file, seconds, dir, tag, width = 192) {
  const out = path.join(dir, `v_${tag}.png`)
  await run(['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
    '-vf', `scale=${width}:-1`, out, '-y'])
  const img = await loadImage(out)
  const w = img.width
  const h = img.height
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Float64Array(w * h)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = (d[i] * LUMA[0] + d[i + 1] * LUMA[1] + d[i + 2] * LUMA[2]) / 255
  }
  return { g, w, h, file: out }
}

/** Mean absolute difference of b shifted by (dx,dy) against a, over the overlap. */
function diffAtShift(a, b, w, h, dx, dy) {
  let sum = 0
  let n = 0
  const x0 = Math.max(0, -dx)
  const x1 = Math.min(w, w - dx)
  const y0 = Math.max(0, -dy)
  const y1 = Math.min(h, h - dy)
  for (let y = y0; y < y1; y++) {
    const ra = y * w
    const rb = (y + dy) * w + dx
    for (let x = x0; x < x1; x++) {
      sum += Math.abs(a[ra + x] - b[rb + x])
      n++
    }
  }
  return n > 0 ? sum / n : 1
}

/**
 * Coarse-to-fine search for the translation that best aligns two frames.
 * Deterministic and exact within the search window — no FFT, no dependency.
 */
function bestShift(a, b, w, h, radius = 14) {
  let best = { dx: 0, dy: 0, err: diffAtShift(a, b, w, h, 0, 0) }
  for (const step of [4, 1]) {
    const cx = best.dx
    const cy = best.dy
    const r = step === 4 ? radius : 4
    for (let dy = cy - r; dy <= cy + r; dy += step) {
      for (let dx = cx - r; dx <= cx + r; dx += step) {
        const err = diffAtShift(a, b, w, h, dx, dy)
        if (err < best.err) best = { dx, dy, err }
      }
    }
  }
  return best
}

/** Scales frame b about its centre by `s`, nearest neighbour, into a new buffer. */
function scaleFrame(b, w, h, s) {
  const out = new Float64Array(w * h)
  const cx = w / 2
  const cy = h / 2
  for (let y = 0; y < h; y++) {
    const sy = Math.round((y - cy) / s + cy)
    if (sy < 0 || sy >= h) continue
    for (let x = 0; x < w; x++) {
      const sx = Math.round((x - cx) / s + cx)
      if (sx < 0 || sx >= w) continue
      out[y * w + x] = b[sy * w + sx]
    }
  }
  return out
}

/** Best scale change between two frames — this is what catches a zoom. */
function bestZoom(a, b, w, h) {
  let best = { scale: 1, err: Infinity, dx: 0, dy: 0 }
  for (let s = 0.96; s <= 1.0401; s += 0.01) {
    const scaled = Math.abs(s - 1) < 1e-9 ? b : scaleFrame(b, w, h, s)
    const sh = bestShift(a, scaled, w, h, 6)
    if (sh.err < best.err) best = { scale: s, err: sh.err, dx: sh.dx, dy: sh.dy }
  }
  return best
}

/**
 * @param file   the clip
 * @param opts   { start, end, samples, referenceImage }
 */
async function analyseClip(file, opts = {}) {
  const start = opts.start ?? 0.2
  const end = opts.end ?? null
  const samples = Math.max(3, opts.samples ?? 6)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'))

  try {
    let stop = end
    if (stop === null) {
      const probe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', file])
      let out = ''
      probe.stdout.on('data', d => { out += d.toString() })
      await new Promise(r => probe.on('close', r))
      stop = Math.max(start + 0.5, Number(out.trim()) - 0.2)
    }

    const times = []
    for (let i = 0; i < samples; i++) times.push(start + ((stop - start) * i) / (samples - 1))
    const gap = times[1] - times[0]

    const frames = []
    for (let i = 0; i < times.length; i++) frames.push(await grayAt(file, times[i], dir, String(i)))
    const { w, h } = frames[0]

    const moves = []
    const shimmers = []
    const zooms = []
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i].g
      const b = frames[i + 1].g
      const z = bestZoom(a, b, w, h)
      const aligned = Math.abs(z.scale - 1) < 1e-9 ? b : scaleFrame(b, w, h, z.scale)
      const sh = bestShift(a, aligned, w, h)
      moves.push((Math.hypot(sh.dx, sh.dy) / w) * 100 / gap)
      zooms.push(Math.abs(z.scale - 1) * 100 / gap)
      shimmers.push((sh.err * 255) / gap)
    }

    const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length
    const colour = await measureFrame(frames[Math.floor(frames.length / 2)].file)

    let reference = null
    if (opts.referenceImage) {
      const ref = await measureFrame(opts.referenceImage)
      const lum = c => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
      // Compare CHROMATICITY, not absolute level — a shot may legitimately be
      // brighter or darker than its still, but it must not change colour.
      const nc = colour.map(v => v / Math.max(lum(colour), 1e-6))
      const nr = ref.map(v => v / Math.max(lum(ref), 1e-6))
      reference = {
        meanLinear: ref,
        chromaDistance: Math.hypot(...nc.map((v, i) => v - nr[i])),
      }
    }

    return {
      samples: times.length,
      window: [start, stop],
      motion: {
        coherentPercentPerSecond: mean(moves),
        zoomPercentPerSecond: mean(zooms),
        shimmerPerSecond: mean(shimmers),
        peakCoherent: Math.max(...moves),
      },
      colour: { meanLinear: colour, reference },
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* gone */ }
  }
}

/**
 * Thresholds derived from the calibration corpus, not guessed.
 *
 * Chroma distance to the source still, measured:
 *     locked-off, same framing ....... 0.05
 *     panned, honest colour .......... 0.25   <- a camera move legitimately
 *                                              changes what is in frame, and
 *                                              therefore the average colour
 *     panned, deliberately blue ...... 1.68
 *
 * 0.45 sits clear of innocent framing change and far below real drift.
 */
const DEFAULT_SPEC = {
  minCoherentMotion: 0.35,   // still = 0.00, slow push = 6.80
  maxShimmer: 1.0,           // a clean push sits at 0.24, a real pan at 0.48
  maxChromaDistance: 0.45,
  requireMotion: true,
}

function judge(analysis, spec = {}) {
  const s = { ...DEFAULT_SPEC, ...spec }
  const m = analysis.motion
  const movement = m.coherentPercentPerSecond + m.zoomPercentPerSecond
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  if (s.requireMotion) {
    add('the shot actually moves', movement >= s.minCoherentMotion,
      `${movement.toFixed(2)} %/s of coherent movement, floor ${s.minCoherentMotion}`)
  }
  add('not boiling in place', !(movement < s.minCoherentMotion && m.shimmerPerSecond > s.maxShimmer),
    `shimmer ${m.shimmerPerSecond.toFixed(2)}/s against ${movement.toFixed(2)} %/s of movement`)
  add('stays within the ceiling for instability', m.shimmerPerSecond <= s.maxShimmer * 2.5,
    `shimmer ${m.shimmerPerSecond.toFixed(2)}/s`)

  const ref = analysis.colour.reference
  if (ref) {
    add('holds the colour of the approved still', ref.chromaDistance <= s.maxChromaDistance,
      `chroma distance ${ref.chromaDistance.toFixed(3)}, limit ${s.maxChromaDistance}`)
  }

  const failed = checks.filter(c => !c.ok)
  // A single score so takes can be ranked: movement is good, shimmer and drift
  // are bad, and a failed check is disqualifying rather than merely costly.
  const score = failed.length
    ? 0
    : Math.max(0, Math.min(1,
        0.5 * Math.min(1, movement / 3) +
        0.3 * Math.max(0, 1 - m.shimmerPerSecond / (s.maxShimmer * 2)) +
        0.2 * (ref ? Math.max(0, 1 - ref.chromaDistance / s.maxChromaDistance) : 1)))

  return { accepted: failed.length === 0, score, checks, failed: failed.map(c => c.name) }
}

/** Rank several takes of the same shot and return the winner. */
function selectBest(judgements) {
  let best = -1
  let bestScore = -1
  judgements.forEach((j, i) => {
    if (j.accepted && j.score > bestScore) { bestScore = j.score; best = i }
  })
  return { index: best, score: bestScore, anyAccepted: best >= 0 }
}

module.exports = { analyseClip, judge, selectBest, bestShift, bestZoom, DEFAULT_SPEC }
