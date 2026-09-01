// _verification/57-grade-style-parity.cjs
//
// Contrast and saturation, and the divergence they were hiding.
//
// THE BUG THIS SUITE EXISTS FOR WAS ALREADY SHIPPED AND ALREADY LIVE.
//
// `GradeSpec` has carried `contrast` and `saturation` for weeks. The worker
// applied them as a trailing `eq=saturation=1.06:contrast=1.04` — a hard-coded
// default nobody chose. The PREVIEW ignored them completely. So every film in
// this Studio was rendered measurably punchier than the picture the editor
// approved, on every frame, and the only way to see it was to put the preview
// and the file side by side.
//
// It could not be fixed by passing the same numbers to the browser, because the
// two filters are not the same operation:
//
//   ffmpeg `eq=contrast`   works in YUV, on luma
//   SVG feComponentTransfer works per channel, in whatever space it is told
//   ffmpeg `eq=saturation` uses its own weights
//   SVG feColorMatrix      uses Rec.709, in whatever space it is told
//
// So contrast is now FOLDED INTO the existing per-channel linear function —
// gain·contrast as the slope, pivot·(1−contrast) as the intercept — which both
// engines already evaluate identically. Saturation is written out as an explicit
// Rec.709 matrix for both. These assertions put real pixels through real ffmpeg
// and check the numbers agree.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const FF = process.env.FFMPEG || 'ffmpeg'
const haveFF = spawnSync(FF, ['-version'], { stdio: 'ignore' }).status === 0

// ── the styles ───────────────────────────────────────────────────────────
{
  const names = Object.keys(T.GRADE_STYLES)
  ok('there are named styles rather than two loose numbers', names.length >= 5, names.join(','))
  ok('every style has a label and a note that says WHEN to use it',
    names.every(k => T.GRADE_STYLES[k].label && T.GRADE_STYLES[k].note.length > 40))
  ok('flat really is flat',
    T.GRADE_STYLES.plat.contrast === 1 && T.GRADE_STYLES.plat.saturation === 1)
  ok('THE PRESTIGE LOOK PAIRS HIGH CONTRAST WITH LOW SATURATION — the other ' +
     'combination is what a phone filter does',
    T.GRADE_STYLES.dramatic.contrast > 1.25 && T.GRADE_STYLES.dramatic.saturation < 1)
  ok('...and the advertising look pairs punch with punch',
    T.GRADE_STYLES.publicitar.saturation > 1.1)
  ok('contrast rises across documentar → cinematic → dramatic',
    T.GRADE_STYLES.documentar.contrast < T.GRADE_STYLES.cinematic.contrast &&
    T.GRADE_STYLES.cinematic.contrast < T.GRADE_STYLES.dramatic.contrast)
  ok('the worker default maps to a named style', T.styleOf(1.04, 1.06) !== undefined)
  ok('styleOf finds the exact style it is given',
    T.styleOf(T.GRADE_STYLES.dramatic.contrast, T.GRADE_STYLES.dramatic.saturation) === 'dramatic')
}

// ── the pivot is the photographic one ────────────────────────────────────
{
  ok('the pivot is middle grey in linear light, not 0.5',
    Math.abs(T.CONTRAST_PIVOT - 0.18) < 1e-9)

  // A mid-grey face value should barely move; shadows and highlights should.
  const mid = T.applyGains([119, 119, 119], [1, 1, 1], 1.32, 1)   // ~0.18 linear
  const shadow = T.applyGains([40, 40, 40], [1, 1, 1], 1.32, 1)
  const high = T.applyGains([210, 210, 210], [1, 1, 1], 1.32, 1)
  ok('A MIDDLE-GREY TONE BARELY MOVES UNDER STRONG CONTRAST — this is why faces ' +
     'survive a dramatic grade', Math.abs(mid[0] - 119) <= 4, `119 → ${mid[0]}`)
  ok('...while the shadows genuinely deepen', shadow[0] < 40 - 4, `40 → ${shadow[0]}`)
  ok('...and the highlights genuinely open', high[0] > 210 + 3, `210 → ${high[0]}`)
  // MEASURED, AND IT CONTRADICTED THE PLAUSIBLE STORY. The comment in grade.ts
  // originally said a 0.5 pivot pushes skin UP and makes people look sunburnt.
  // It does the opposite: 0.5 is far above middle grey in LINEAR light, so the
  // naive pivot drags a mid grey down by 0.101 while the photographic one moves
  // it 0.0014. Both the code comment and this assertion were corrected to the
  // measurement rather than the other way round.
  ok('A 0.5 PIVOT DRAGS MID TONES DOWN, HARD — seventy times further than the ' +
     'photographic pivot moves them', (() => {
      const G = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'grade.js'))
      const lin = G.srgbToLinear(119 / 255)
      const correct = Math.abs((lin - 0.18) * 1.32 + 0.18 - lin)
      const naive = Math.abs((lin - 0.5) * 1.32 + 0.5 - lin)
      return correct < 0.01 && naive > 0.05 && naive > correct * 20
    })())
  ok('contrast 1 changes nothing at all',
    T.applyGains([77, 133, 200], [1, 1, 1], 1, 1).join(',') === '77,133,200')
  ok('saturation 1 changes nothing at all',
    T.applyGains([77, 133, 200], [1, 1, 1], 1, 1).join(',') === '77,133,200')
  ok('saturation 0 is a true greyscale — all three channels equal', (() => {
    const g = T.applyGains([200, 100, 50], [1, 1, 1], 1, 0)
    return g[0] === g[1] && g[1] === g[2]
  })())
  ok('...and it lands on the Rec.709 luma, not on an average', (() => {
    const g = T.applyGains([200, 100, 50], [1, 1, 1], 1, 0)
    const want = 200 * 0.213 + 100 * 0.715 + 50 * 0.072
    return Math.abs(g[0] - want) <= 1
  })())
}

// ── THE DIVERGENCE IS CLOSED ─────────────────────────────────────────────
{
  const worker = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'grade.js'), 'utf8')
  ok('THE WORKER NO LONGER USES ffmpeg eq FOR CONTRAST — it has no browser ' +
     'equivalent, so it could only ever diverge',
    !/eq=saturation=\$\{sat\}:contrast=\$\{con\}/.test(worker))
  ok('...contrast is folded into the per-channel function instead',
    /lutExpr\(gains\[0\], con\)/.test(worker))
  ok('...and saturation is an explicit matrix', /saturationMixer\(sat\)/.test(worker))

  const filter = T.svgGradeFilter([1.08, 1, 0.88], 'g', 1.18, 1.02)
  ok('the preview filter now carries contrast', /intercept=/.test(filter))
  ok('...as a slope on the linear transfer', /slope="1\.2744/.test(filter), filter.slice(0, 200))
  ok('...and saturation as a Rec.709 saturate matrix',
    /feColorMatrix type="saturate" values="1\.020000"/.test(filter))
  ok('THE TRANSFER IS IN LINEAR LIGHT AND THE SATURATION IN sRGB — the two ' +
     'spaces ffmpeg uses, named per primitive',
    /feComponentTransfer color-interpolation-filters="linearRGB"/.test(filter) &&
    /feColorMatrix[^>]*color-interpolation-filters="sRGB"/.test(filter))
  ok('a neutral style emits no saturation primitive at all',
    !/feColorMatrix/.test(T.svgGradeFilter([1, 1, 1], 'g', 1, 1)))

  const studio = stripComments(
    fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8'))
  ok('THE PREVIEW ACTUALLY PASSES THEM — the whole bug was that it did not',
    /svgGradeFilter\([^)]*contrast/.test(studio) || /svgGradeFilter\(gains, [^,]+, [^,]+, /.test(studio),
    'preview still calls svgGradeFilter with gains only')
}

// ── ffmpeg, on real pixels ───────────────────────────────────────────────
if (!haveFF) {
  console.log('  ffmpeg missing — the parity cannot be measured here')
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(2)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-'))
const patch = (rgb) => {
  const c = createCanvas(8, 8)
  const cx = c.getContext('2d')
  cx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
  cx.fillRect(0, 0, 8, 8)
  const f = path.join(dir, `in-${rgb.join('_')}.png`)
  fs.writeFileSync(f, c.toBuffer('image/png'))
  return f
}
const readBack = (file) => {
  const raw = execSync(`${FF} -v error -i ${file} -f rawvideo -pix_fmt rgb24 -`, { maxBuffer: 1e8 })
  return [raw[0], raw[1], raw[2]]
}

// Contrast, through the real lutrgb the worker builds.
for (const [rgb, con] of [[[119, 119, 119], 1.32], [[40, 40, 40], 1.32], [[210, 210, 210], 1.32],
                          [[77, 133, 200], 1.18]]) {
  const inFile = patch(rgb)
  const out = path.join(dir, `c-${rgb.join('_')}-${con}.png`)
  const chain = `lutrgb=r='${T.lutExpr(1, con)}':g='${T.lutExpr(1, con)}':b='${T.lutExpr(1, con)}'`
  execSync(`${FF} -v error -i ${inFile} -vf "${chain}" -y ${out}`, { stdio: 'pipe' })
  const got = readBack(out)
  const want = T.applyGains(rgb, [1, 1, 1], con, 1)
  const err = Math.max(...got.map((v, i) => Math.abs(v - want[i])))
  ok(`CONTRAST ${con} ON ${rgb.join(',')}: ffmpeg agrees with the maths`, err <= 2,
    `ffmpeg ${got.join(',')} vs maths ${want.join(',')}`)
}

// Saturation, through the real colorchannelmixer the worker builds.
for (const [rgb, sat] of [[[200, 100, 50], 0.9], [[200, 100, 50], 1.14], [[60, 180, 90], 0.9],
                          [[200, 100, 50], 0]]) {
  const inFile = patch(rgb)
  const out = path.join(dir, `s-${rgb.join('_')}-${sat}.png`)
  execSync(`${FF} -v error -i ${inFile} -vf "${T.saturationMixer(sat)}" -y ${out}`, { stdio: 'pipe' })
  const got = readBack(out)
  const want = T.applyGains(rgb, [1, 1, 1], 1, sat)
  const err = Math.max(...got.map((v, i) => Math.abs(v - want[i])))
  ok(`SATURATION ${sat} ON ${rgb.join(',')}: ffmpeg agrees with the maths`, err <= 2,
    `ffmpeg ${got.join(',')} vs maths ${want.join(',')}`)
}

// Both together, in the order the worker applies them.
{
  const rgb = [180, 120, 70]
  const style = T.GRADE_STYLES.dramatic
  const inFile = patch(rgb)
  const out = path.join(dir, 'both.png')
  const gains = [1.08, 1, 0.88]
  const chain =
    `lutrgb=r='${T.lutExpr(gains[0], style.contrast)}':g='${T.lutExpr(gains[1], style.contrast)}':` +
    `b='${T.lutExpr(gains[2], style.contrast)}',${T.saturationMixer(style.saturation)}`
  execSync(`${FF} -v error -i ${inFile} -vf "${chain}" -y ${out}`, { stdio: 'pipe' })
  const got = readBack(out)
  const want = T.applyGains(rgb, gains, style.contrast, style.saturation)
  const err = Math.max(...got.map((v, i) => Math.abs(v - want[i])))
  ok('THE WHOLE DRAMATIC STYLE — gain, contrast and saturation, in the worker\'s ' +
     'own order — agrees with the maths the preview uses', err <= 2,
    `ffmpeg ${got.join(',')} vs maths ${want.join(',')}`)
  ok('...and it really did change the pixel, so this test can fail',
    Math.max(...got.map((v, i) => Math.abs(v - rgb[i]))) > 5,
    `${rgb.join(',')} → ${got.join(',')}`)
}

try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
