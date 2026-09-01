// _verification/30-grade-parity.cjs
//
// The last divergence, and the most visible one.
//
// The worker measures each shot's own mean in linear light, works out the
// channel gains that move it onto the kit's look, and bakes them into an ffmpeg
// LUT. The preview applied nothing at all — so every film anyone watched was
// ungraded and every file delivered was graded. A colour difference on every
// frame of every shot, which is a stranger thing to leave standing than any of
// the ten faults already fixed.
//
// The maths lived in render-worker/src/grade.js, in CommonJS next to ffmpeg
// spawns, which is exactly why the browser could not run it.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
process.env.TIMELINE_DIST = path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js')
const T = require(process.env.TIMELINE_DIST)
const worker = require(path.join(ROOT, 'render-worker', 'src', 'grade.js'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)
const gradeJs = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'grade.js'), 'utf8')


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── there is exactly one implementation ──────────────────────────────────
{
  ok('the worker no longer defines the looks', !/^const LOOKS = \{/m.test(gradeJs))
  ok('...nor planGains', !/^function planGains/m.test(gradeJs))
  ok('...nor the LUT expression', !/^function lutExpr/m.test(gradeJs))
  ok('...nor its own sRGB conversion', !/const srgbToLinear/.test(gradeJs))
  ok('it requires them from the shared module', /require\('\.\/timeline'\)/.test(gradeJs))
  // `k in worker` was the first version of this, and it passes for a key whose
  // value is undefined — which is exactly what a mis-spelled re-export produces.
  // A named export renamed in the index (residual → gradeResidual) slipped
  // through it and was caught by 16-layers instead, one suite too late.
  const fns = ['gradeFilm', 'planGains', 'measureFrame', 'lutExpr', 'normaliseLook', 'residual']
  for (const k of fns) ok(`worker.${k} is callable, not merely present`, typeof worker[k] === 'function',
    typeof worker[k])
  ok('LOOKS survives the move with its values', worker.LOOKS && worker.LOOKS.warm[0] === 1.08)
}

// ── the two sides compute the same numbers, not similar ones ─────────────
{
  const cases = [
    [[0.21, 0.18, 0.13], 'warm', 0.85],
    [[0.05, 0.06, 0.09], 'golden', 1],
    [[0.4, 0.4, 0.4], 'cool', 0.5],
    [[0.31, 0.29, 0.30], 'neutral', 1],
  ]
  for (const [mean, look, strength] of cases) {
    const a = worker.planGains(mean, look, strength)
    const b = T.planGains(mean, look, strength)
    ok(`${look} @${strength}: worker and library agree exactly`,
      JSON.stringify(a) === JSON.stringify(b), `${a} vs ${b}`)
  }
  ok('a grade never changes exposure — the look is normalised',
    Math.abs(T.normaliseLook(T.LOOKS.warm).reduce((s, v, i) => s + v * T.LUMA[i], 0) - 1) < 1e-9)
  ok('gains are clamped, so a near-monochrome shot is not torn apart',
    T.planGains([0.001, 0.4, 0.4], 'golden', 1).every(g => g <= 2.6 && g >= 0.45),
    T.planGains([0.001, 0.4, 0.4], 'golden', 1).join(','))
  ok('strength 0 is identity', T.planGains([0.2, 0.15, 0.1], 'golden', 0).every(g => Math.abs(g - 1) < 1e-9))
  ok('grading moves the residual down, which is the point',
    T.gradeResidual([0.21, 0.18, 0.13], T.planGains([0.21, 0.18, 0.13], 'cool', 1), 'cool') <
    T.gradeResidual([0.21, 0.18, 0.13], [1, 1, 1], 'cool'))
}

// ── the trimmed mean is the same measurement on both sides ───────────────
{
  // A frame with a blown window and a black doorway: the trim is what stops
  // those two extremes deciding the grade.
  const n = 4000
  const data = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const v = i < n * 0.08 ? 0 : i > n * 0.94 ? 255 : 120 + (i % 7)
    data[i * 4] = v; data[i * 4 + 1] = Math.round(v * 0.92); data[i * 4 + 2] = Math.round(v * 0.7)
    data[i * 4 + 3] = 255
  }
  const mean = T.meanLinearFromRGBA(data)
  ok('the mean is warm, as the pixels are', mean[0] > mean[2], mean.join(','))
  ok('the blown pixels do not drag it to white', mean[0] < 0.9, String(mean[0]))
  ok('an empty buffer does not throw', JSON.stringify(T.meanLinearFromRGBA(new Uint8ClampedArray(0))) === '[0,0,0]')
}

// ── the SVG filter is the LUT, not an approximation of it ────────────────
{
  const gains = [0.94235, 1.00593, 1.19292]
  const svg = T.svgGradeFilter(gains, 'g1')
  ok('the filter interpolates in linear light — this is the whole equivalence',
    /color-interpolation-filters="linearRGB"/.test(svg))
  ok('each channel is a linear slope', (svg.match(/type="linear"/g) || []).length === 3)
  // ASSERTED NUMERICALLY, NOT AS A STRING. This used to compare
  // `slope="0.94235"` literally, and went red when the filter gained a contrast
  // term and one more decimal place — a failure about formatting, against
  // arithmetic that had not changed. What matters is that the slope IS the gain.
  ok('the slopes ARE the gains, at whatever precision they are printed', (() => {
    const slopes = [...svg.matchAll(/slope="([\d.]+)"/g)].map(m => Number(m[1]))
    return slopes.length === 3 && slopes.every((v, i) => Math.abs(v - gains[i]) < 1e-4)
  })(), svg)
  ok('with no contrast asked for, the intercept is zero — a pure gain', (() => {
    const ints = [...svg.matchAll(/intercept="([-\d.]+)"/g)].map(m => Number(m[1]))
    return ints.length === 0 || ints.every(v => Math.abs(v) < 1e-9)
  })(), svg)
  ok('CONTRAST FOLDS INTO THE SAME SLOPE, which is what keeps the two engines ' +
     'exactly equal rather than approximately equal', (() => {
      const withC = T.svgGradeFilter(gains, 'g2', 1.25)
      const slopes = [...withC.matchAll(/slope="([\d.]+)"/g)].map(m => Number(m[1]))
      const ints = [...withC.matchAll(/intercept="([-\d.]+)"/g)].map(m => Number(m[1]))
      return slopes.every((v, i) => Math.abs(v - gains[i] * 1.25) < 1e-4) &&
             ints.every(v => Math.abs(v - 0.18 * (1 - 1.25)) < 1e-6)
    })())

}

// ── the shipped LUT string and the shared maths agree, through real ffmpeg ─
//
// The first version of this check evaluated the ffmpeg expression with a
// hand-rolled string rewrite. It threw, `viaLut` came back null, and eighteen
// assertions were skipped inside an `if` — the suite passed by not running.
// So it runs the real encoder instead: an exact PNG in, lutrgb over it, the
// pixel read back and compared with the arithmetic the browser applies.
{
  const os = require('os')
  const { spawnSync } = require('child_process')
  const { loadImage, createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-'))

  const through = (rgb, gains) => {
    const c = createCanvas(16, 16)
    const x = c.getContext('2d')
    x.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
    x.fillRect(0, 0, 16, 16)
    const inp = path.join(dir, 'in.png'), out = path.join(dir, 'out.png')
    fs.writeFileSync(inp, c.toBuffer('image/png'))
    const filter = 'format=rgb24,lutrgb=' +
      `r='${T.lutExpr(gains[0])}':g='${T.lutExpr(gains[1])}':b='${T.lutExpr(gains[2])}'`
    const r = spawnSync(process.env.FFMPEG || 'ffmpeg',
      ['-v', 'error', '-i', inp, '-vf', filter, '-pix_fmt', 'rgb24', '-frames:v', '1', '-y', out],
      { encoding: 'utf8' })
    if (r.status !== 0) return null
    return { out, err: r.stderr }
  }

  const read = async (file) => {
    const im = await loadImage(file)
    const c = createCanvas(16, 16)
    const x = c.getContext('2d')
    x.drawImage(im, 0, 0)
    const d = x.getImageData(8, 8, 1, 1).data
    return [d[0], d[1], d[2]]
  }

  ;(async () => {
    const trials = [
      [[128, 96, 160], [0.94235, 1.00593, 1.19292]],
      [[32, 40, 60], [1.16, 1.0, 0.74]],
      [[220, 210, 190], [0.92, 1.0, 1.1]],
      [[8, 8, 8], [1.08, 1.0, 0.88]],
    ]
    for (const [rgb, gains] of trials) {
      const res = through(rgb, gains)
      if (!res) { ok(`ffmpeg ran for ${rgb}`, false, 'ffmpeg failed'); continue }
      const got = await read(res.out)
      const want = T.applyGains(rgb, gains)
      // ffmpeg builds a 256-entry integer table, so one level of rounding is
      // expected and anything more is a real disagreement.
      ok(`LUT and browser maths agree on ${rgb.join(',')} — within one level`,
        got.every((v, i) => Math.abs(v - want[i]) <= 1), `ffmpeg ${got} vs browser ${want}`)
      ok(`...and it is not a coincidence of grey on ${rgb.join(',')}`,
        new Set(want).size > 1 || rgb[0] === rgb[1])
    }
    fs.rmSync(dir, { recursive: true, force: true })
    runPreviewChecks()
  })()
}

function runPreviewChecks() {
// ── the preview actually applies it, and only to the picture ─────────────
{
  ok('the preview measures the shot', /meanLinearFromRGBA\(/.test(src) && /planShotGains\(/.test(src))
  ok('...at the same 240px the worker uses', /const w = 240/.test(src))
  ok('...caching per url, look, strength and trim — a shot override is part of the key',
    /\$\{url\}\|\$\{look\}\|\$\{shot\?\.strength \?\? spec\.strength\}\|\$\{temp\}\|\$\{tint\}/.test(src))
  ok('the canvas filter is the SVG filter', /svgGradeFilter\(gains, key/.test(src))
  ok('AND IT CARRIES THE FILM CONTRAST AND SATURATION. It did not: the worker ' +
     'applied them at a hard-coded 1.04/1.06 and the preview ignored both, so ' +
     'every film rendered punchier than the picture that was approved.',
    /gradeFilterUrl\(gains, kit\.grade\.contrast \?\? 1\.04, kit\.grade\.saturation \?\? 1\.06\)/.test(src))
  ok('...installed once, not per frame', /getElementById\(ID \+ '-host'\)/.test(src))
  ok('the picture and the type are drawn in two passes',
    /filter: o => o\.z < GRAPHICS_Z/.test(src) && /filter: o => o\.z >= GRAPHICS_Z/.test(src))
  ok('...so the grade never lands on a caption', /clear: false, filter: o => o\.z >= GRAPHICS_Z/.test(src))
  ok('no grade means one pass, as before', /drawCompiled\(Ctx, frame, W, H, resolveMedia\)/.test(src))
  ok("a look of none is not graded — unless a trim was asked for, which is a different request",
    /look === 'none' && !temp && !tint/.test(src))
  ok('a tainted canvas does not break the preview', /catch \{ return null \}/.test(src))
}

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
}
