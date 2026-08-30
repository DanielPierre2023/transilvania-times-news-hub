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
 * Parabolic refinement of a 1-D minimum from three samples.
 *
 * Integer-pixel alignment quantises a slow camera move to nothing: measured on
 * one real take, the same clip read at 160 px wide reported 0.00 %/s of
 * movement and at 192 px wide reported 1.89 %/s — the shot had not changed,
 * only the rounding. A gentle push is exactly the move that matters most in a
 * marketing spot, so the estimate has to be continuous.
 */
function subPixel(eMinus, e0, ePlus) {
  const denom = eMinus - 2 * e0 + ePlus
  if (!(denom > 1e-12)) return 0
  const d = (0.5 * (eMinus - ePlus)) / denom
  return Math.max(-0.5, Math.min(0.5, d))
}

/**
 * Coarse-to-fine search for the translation that best aligns two frames, then
 * refined to sub-pixel accuracy against the error surface.
 * Deterministic and exact within the search window — no FFT, no dependency.
 */
function bestShift(a, b, w, h, radius = 24) {
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
  // If the optimum sits ON the edge of the search window, the true displacement
  // is at least this and possibly much more — the number is a lower bound, not
  // a measurement. This was silently happening: a calibration clip that really
  // moves 17.3 %/s was reported as 6.7 %/s for weeks because the window clipped
  // it, and nothing said so.
  const clipped = Math.abs(best.dx) >= radius - 1 || Math.abs(best.dy) >= radius - 1
  const ex = subPixel(
    diffAtShift(a, b, w, h, best.dx - 1, best.dy), best.err,
    diffAtShift(a, b, w, h, best.dx + 1, best.dy))
  const ey = subPixel(
    diffAtShift(a, b, w, h, best.dx, best.dy - 1), best.err,
    diffAtShift(a, b, w, h, best.dx, best.dy + 1))
  return { ...best, clipped, fx: best.dx + ex, fy: best.dy + ey }
}

/**
 * THE PICTURE'S OWN NOISE FLOOR — the fix for the first threshold that was
 * calibrated on synthetic clips and fell over on real footage.
 *
 * Alignment is integer-pixel, so a camera drifting by half a pixel leaves
 * residual EVERYWHERE, in proportion to how much fine detail the picture has.
 * A smooth synthetic test clip has almost none; a golden-hour photograph of
 * grass, haze and lichen has a great deal. Measured on three real v3 takes of
 * the same still, raw shimmer came out at 12.7 to 15.0 against a synthetic
 * calibration corpus that sat at 0.24 to 0.48. Nothing was wrong with the
 * footage. The metric had no scale.
 *
 * This is the yardstick: shift the frame against ITSELF by half a pixel and
 * measure what that alone costs. Real change is then read as a multiple of it,
 * which is a number that means the same thing on any picture.
 */
/**
 * A floor below which no picture is really "smooth": codec noise, roughly one
 * grey level out of 255. Without it, a very low-detail frame divides by almost
 * nothing and every clip shot against a plain sky reads as unstable — the
 * synthetic pan in the corpus measured 1.91x for exactly that reason while
 * three real takes measured 1.05.
 */
const CODEC_NOISE = 0.004

function selfFloor(a, w, h) {
  let sum = 0
  let n = 0
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const p = y * w + x
      const half = (a[p] + a[p + 1] + a[p + w] + a[p + w + 1]) / 4
      sum += Math.abs(a[p] - half)
      n++
    }
  }
  return n > 0 ? sum / n : 0
}

/**
 * Scales frame b about its centre by `s` into a new buffer, BILINEARLY.
 *
 * This was nearest-neighbour, and that was measurably wrong. Compensating a
 * zoom by resampling badly leaves residual of its own, which then reads as
 * instability in the footage: the synthetic pan-with-zoom in the calibration
 * corpus measured 2.04x its own noise floor purely because of this, when three
 * real generated takes measured 1.05 to 1.25. The detector was accusing the
 * footage of a defect in the detector.
 */
function scaleFrame(b, w, h, s) {
  const out = new Float64Array(w * h)
  const cx = w / 2
  const cy = h / 2
  for (let y = 0; y < h; y++) {
    const fy = (y - cy) / s + cy
    const y0 = Math.floor(fy)
    const ty = fy - y0
    if (y0 < 0 || y0 + 1 >= h) continue
    for (let x = 0; x < w; x++) {
      const fx = (x - cx) / s + cx
      const x0 = Math.floor(fx)
      const tx = fx - x0
      if (x0 < 0 || x0 + 1 >= w) continue
      const p = y0 * w + x0
      out[y * w + x] =
        b[p] * (1 - tx) * (1 - ty) +
        b[p + 1] * tx * (1 - ty) +
        b[p + w] * (1 - tx) * ty +
        b[p + w + 1] * tx * ty
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

    // MEASURE AT A FIXED TEMPORAL SPACING, not at whatever spacing falls out of
    // the sample count.
    //
    // Both numbers this returns are per-second rates, and neither is invariant
    // to how far apart the two frames of a comparison are: align two frames a
    // second and a half apart and the leftover residual is large no matter how
    // clean the shot is, because a global translation and zoom cannot explain
    // that much of a real scene. Measured on the same pan clip, six samples put
    // the instability at 0.30x and four samples at 2.26x. Same footage, same
    // code, different answer — so the spacing is fixed here and the sample
    // count only decides HOW MANY places in the clip get measured.
    const gap = Math.max(0.1, Math.min(opts.pairGap ?? 0.4, (stop - start) / 2))
    const times = []
    for (let i = 0; i < samples; i++) {
      const span = stop - start - gap
      times.push(start + (samples === 1 ? 0 : (span * i) / (samples - 1)))
    }

    const frames = []
    const seconds = []
    for (let i = 0; i < times.length; i++) {
      frames.push(await grayAt(file, times[i], dir, `${i}a`))
      seconds.push(await grayAt(file, times[i] + gap, dir, `${i}b`))
    }
    const { w, h } = frames[0]

    let clipped = false
    const moves = []
    const shimmers = []
    const ratios = []
    const floors = []
    const zooms = []
    for (let i = 0; i < frames.length; i++) {
      const a = frames[i].g
      const b = seconds[i].g
      const z = bestZoom(a, b, w, h)
      const aligned = Math.abs(z.scale - 1) < 1e-9 ? b : scaleFrame(b, w, h, z.scale)
      const sh = bestShift(a, aligned, w, h)
      if (sh.clipped) clipped = true
      const floor = selfFloor(a, w, h)
      // Sub-pixel, so a slow push does not round away to nothing.
      moves.push((Math.hypot(sh.fx, sh.fy) / w) * 100 / gap)
      zooms.push(Math.abs(z.scale - 1) * 100 / gap)
      shimmers.push((sh.err * 255) / gap)
      floors.push(floor * 255)
      ratios.push(sh.err / (floor + CODEC_NOISE))
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
        // Kept for information. It is NOT a gate any more: its scale depends
        // on how detailed the picture is, so the same number means different
        // things on a misty landscape and on a plain studio wall.
        shimmerPerSecond: mean(shimmers),
        // The gate. Residual as a multiple of what a half-pixel misalignment
        // costs on this picture, plus a codec-noise allowance so a smooth
        // picture cannot divide by nothing. Scale-free, comparable across
        // shots of any subject.
        shimmerRatio: mean(ratios),
        subPixelFloor: mean(floors),
        peakCoherent: Math.max(...moves),
        // True when the alignment hit the edge of its search window, so the
        // movement figure is a floor rather than a measurement.
        clipped,
      },
      colour: { meanLinear: colour, reference },
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* gone */ }
  }
}

/**
 * Thresholds derived from measurement, and revised once already when the
 * measurement said the first version was wrong.
 *
 * All figures below are measured at 192 px wide with a FIXED 0.4 s spacing
 * between the two frames of each comparison.
 *
 * MOVEMENT, percent of frame width per second (translation + zoom):
 *     synthetic still ................... 0.00
 *     synthetic slow push ............... 3.45
 *     synthetic pan with zoom ........... 19.58
 *     real Kling v3 take 1 .............. 0.48
 *     real Kling v3 take 2 .............. 2.57   (a 2.5 %/s push)
 *     real Kling v3 take 3 .............. 0.60
 *     five delivered o3 shots, looped ... 0.00, all five
 *
 * Two earlier figures published here — "slow push 6.80, real pan 12.82" — were
 * wrong. The alignment window was 14 px and both clips moved further than that
 * between samples, so the search hit its own edge and reported the edge. The
 * window is now 24 px and a run that still hits it sets `clipped`, so a lower
 * bound can never again be mistaken for a measurement.
 *
 * STABILITY, residual after alignment as a multiple of what a half-pixel
 * misalignment costs on that same picture, plus a codec-noise allowance:
 *     synthetic still ................... 0.000
 *     synthetic pan with zoom ........... 0.061
 *     synthetic slow push ............... 0.098
 *     real v3 take 2 .................... 0.988
 *     real v3 take 1 .................... 1.009
 *     real v3 take 3 .................... 1.216
 *     take 2 + 6% per-frame noise ....... 1.112
 *     take 2 + 12% ...................... 1.213
 *     take 2 + 25% ...................... 1.310
 *
 * TWO HONEST NOTES ON THESE THRESHOLDS.
 *
 * First, the absolute shimmer ceiling that used to stand here rejected all
 * three of those real takes. It had been calibrated on smooth synthetic clips,
 * where a half-pixel misalignment costs almost nothing; real photographic
 * detail — grass, haze, lichen — makes it cost a great deal. That is why the
 * gate is a ratio now, and why the ratio has a noise floor under it.
 *
 * Second, there is no sample of REAL generative boiling in this corpus, only
 * added white noise, which is a weak proxy: it inflates the per-picture floor
 * almost as fast as it inflates the residual, so it compresses the very
 * separation it is meant to demonstrate. The standalone ceiling is therefore
 * set as a catastrophe limit rather than a fine judgement, and the sharp check
 * is the combined one — no camera movement AND unusual instability, which is
 * precisely the failure the delivered films actually had. Ranking does the
 * rest: between two takes that both pass, the calmer one scores higher and
 * wins. Tighten `maxShimmerRatio` when a genuinely boiling take is captured.
 *
 * CHROMA distance to the source still:
 *     locked-off, same framing .......... 0.05
 *     panned, honest colour ............. 0.25
 *     panned, deliberately blue ......... 1.68
 */
const DEFAULT_SPEC = {
  minCoherentMotion: 0.35,
  maxShimmerRatio: 1.8,   // catastrophe limit — see the note above
  boilingRatio: 1.15,     // ...paired with 'no movement', this is the sharp one      // "no movement AND this unstable" is a dead shot
  maxChromaDistance: 0.45,
  requireMotion: true,
}

function judge(analysis, spec = {}) {
  const s = { ...DEFAULT_SPEC, ...spec }
  const m = analysis.motion
  const movement = m.coherentPercentPerSecond + m.zoomPercentPerSecond
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  // Older analyses have no ratio; treat them as neutral rather than failing
  // them on a number that was never measured.
  const ratio = Number.isFinite(m.shimmerRatio) ? m.shimmerRatio : 1

  if (s.requireMotion) {
    add('the shot actually moves', movement >= s.minCoherentMotion,
      `${movement.toFixed(2)} %/s of coherent movement, floor ${s.minCoherentMotion}`)
  }
  add('not boiling in place', !(movement < s.minCoherentMotion && ratio > s.boilingRatio),
    `instability ${ratio.toFixed(2)}x the picture's own floor, against ${movement.toFixed(2)} %/s of movement`)
  add('stays within the ceiling for instability', ratio <= s.maxShimmerRatio,
    `instability ${ratio.toFixed(2)}x, limit ${s.maxShimmerRatio}x`)

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
        0.3 * Math.max(0, Math.min(1, (s.maxShimmerRatio - ratio) / (s.maxShimmerRatio - 0.8))) +
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

module.exports = { analyseClip, judge, selectBest, bestShift, bestZoom, selfFloor, subPixel, DEFAULT_SPEC }
