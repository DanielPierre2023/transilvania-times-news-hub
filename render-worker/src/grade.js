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

// THE GRADE MATHS NOW LIVES IN lib/timeline/grade.ts, AND THIS REQUIRES IT BACK.
//
// It was defined here, in CommonJS, next to the ffmpeg spawns — which meant the
// browser could not run it, which meant the preview showed an ungraded film
// while every delivered file was graded. A colour difference on every frame of
// every shot, and the last divergence of its kind.
//
// Same pattern as the timeline module: one implementation, compiled once,
// required by the worker and imported by the page.
const {
  LUMA, LOOKS, normaliseLook, planGains, planShotGains, gradeResidual: residual, lutExpr,
  saturationMixer,
  meanLinearFromRGBA,
} = require('./timeline')


function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args)
    let err = ''
    p.stderr.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', c => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}: ${err.slice(-1200)}`))))
  })
}

/**
 * Trimmed mean in linear light for one extracted frame.
 *
 * node-canvas gets the pixels; the shared module does the arithmetic, so the
 * browser measuring the same shot arrives at the same three numbers.
 */
async function measureFrame(file) {
  const img = await loadImage(file)
  const w = Math.min(240, img.width)
  const h = Math.max(1, Math.round((img.height / img.width) * w))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  return meanLinearFromRGBA(ctx.getImageData(0, 0, w, h).data)
}

async function sampleAt(file, seconds, dir, tag) {
  const out = path.join(dir, `g_${tag}.png`)
  await run(['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
    '-vf', 'scale=240:-1', out, '-y'])
  return out
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
      // A SHOT MAY OVERRIDE THE FILM'S LOOK.
      //
      // The adaptive grade is right nearly always and wrong exactly when a shot
      // is meant to sit apart — a memory, a night exterior, a deliberately cold
      // frame in a warm film. `shots[i].grade` is that shot saying so.
      const gains = planShotGains(mean, { look, strength }, shots[i].grade)
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
        // CONTRAST IS FOLDED INTO THE SAME PER-CHANNEL FUNCTION as the gain.
        // It used to be a trailing `eq=contrast=`, which works in YUV and has
        // no exact equivalent in a browser filter — so the render was
        // measurably punchier than the preview the editor approved, on every
        // film. Folded here it is a slope and an intercept, which is precisely
        // what feComponentTransfer takes.
        `lutrgb=r='${lutExpr(gains[0], con)}':g='${lutExpr(gains[1], con)}':b='${lutExpr(gains[2], con)}'` +
        `:enable='between(t,${start.toFixed(3)},${until})'`,
      )
    }

    // Saturation as an EXPLICIT matrix rather than `eq=saturation`. ffmpeg's eq
    // works in YUV with its own weights; SVG's feColorMatrix uses Rec.709 in
    // sRGB. Writing the matrix out means both sides evaluate the same numbers
    // in the same space, in the same order — after the per-channel pass.
    const satStage = Math.abs(sat - 1) < 1e-6 ? '' : `,${saturationMixer(sat)}`
    const chain = `[0:v]${stages.join(',')}${satStage}[vout]`

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

module.exports = { gradeFilm, planGains, planShotGains, measureFrame, residual, lutExpr, LOOKS, normaliseLook }
