// _verification/13-resample.cjs
//
// Picture quality where it is actually decided: the resampler.
//
// Stills are now generated at twice the master, so every drawImage in the
// renderer is a REDUCTION. node-canvas defaults to Cairo's 'good' filter,
// which undersamples at those ratios: fine detail — brick, foliage, fabric,
// hair — turns into crawling moire, and the encoder then spends real bitrate
// carrying it.
//
// GROUND TRUTH is ffmpeg's Lanczos scaler on the same source: a properly
// windowed resampler, and not our code, so it cannot flatter us.
//
// TEST CHART: concentric rings whose frequency rises with radius, the classic
// aliasing target. Anything that undersamples produces moire, and moire shows
// up as a large per-pixel difference from a correctly filtered reduction.
//
// THIS FILE ALSO RECORDS A WRONG IDEA. The intuitive fix — halve the image
// first, then draw — measures WORSE than doing nothing, because every extra
// resample compounds error. That result is asserted here so nobody re-adds it.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { createCanvas, loadImage } = require(path.join(__dirname, '..', 'render-worker', 'node_modules', 'canvas'))

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL:', name, extra) } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resample-'))
const SRC = path.join(dir, 'chart.png')
const W = 3840, H = 2160

{
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(W, H)
  const cx = W / 2, cy = H / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - cx, y - cy)
      const v = Math.sin(r * r * 0.00035) > 0 ? 255 : 0
      const i = (y * W + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  fs.writeFileSync(SRC, c.toBuffer('image/png'))
}

/** Reads a drawable back as greyscale at its own size — no extra resampling. */
function grey(drawable, w, h) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  ctx.patternQuality = 'best'
  ctx.drawImage(drawable, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  const g = new Float64Array(w * h)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = (d[i] + d[i + 1] + d[i + 2]) / 3
  return g
}
function draw(src, w, h, quality) {
  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')
  if (quality) ctx.patternQuality = quality
  ctx.drawImage(src, 0, 0, w, h)
  return c
}
function rms(a, b) {
  let s = 0
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d }
  return Math.sqrt(s / a.length)
}
function lanczos(target) {
  const out = path.join(dir, `ref${target}.png`)
  execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-vf', `scale=${target}:-1:flags=lanczos`, out, '-y'])
  return out
}

;(async () => {
  const source = await loadImage(SRC)
  ok('the chart is the size the test assumes', source.width === W && source.height === H)

  // ── the production case: a 2x still reduced into a 1080p master ──────────
  const ref = grey(await loadImage(lanczos(1920)), 1920, 1080)
  const dDefault = rms(grey(draw(source, 1920, 1080), 1920, 1080), ref)
  const dBest = rms(grey(draw(source, 1920, 1080, 'best'), 1920, 1080), ref)
  const dHalved = rms(grey(draw(draw(source, 2880, 1620, 'best'), 1920, 1080, 'best'), 1920, 1080), ref)

  ok("'best' beats the canvas default at 2:1", dBest < dDefault,
    `${dBest.toFixed(2)} vs ${dDefault.toFixed(2)}`)
  ok('...by at least 20%', dBest < dDefault * 0.8, `${(100 - (dBest / dDefault) * 100).toFixed(0)}% closer`)
  ok('AND the intuitive "reduce in steps" fix is measurably WORSE than doing nothing',
    dHalved > dDefault, `stepped ${dHalved.toFixed(2)} vs single ${dDefault.toFixed(2)}`)

  // ── the harsher case: a 4K still in a 720p master ────────────────────────
  const ref720 = grey(await loadImage(lanczos(1280)), 1280, 720)
  const d720Default = rms(grey(draw(source, 1280, 720), 1280, 720), ref720)
  const d720Best = rms(grey(draw(source, 1280, 720, 'best'), 1280, 720), ref720)
  ok("'best' still wins at 3:1", d720Best < d720Default, `${d720Best.toFixed(2)} vs ${d720Default.toFixed(2)}`)

  // ── and the renderer must actually ask for it ────────────────────────────
  const drawSrc = fs.readFileSync(path.join(__dirname, '..', 'render-worker', 'src', 'draw.js'), 'utf8')
  ok('drawBitmap sets patternQuality — the measurement above is worth nothing otherwise',
    /function drawBitmap[\s\S]{0,1400}?patternQuality\s*=\s*'best'/.test(drawSrc))
  ok('and nothing re-added a downsampler to the image cache',
    !/downsample/.test(fs.readFileSync(path.join(__dirname, '..', 'render-worker', 'src', 'sources.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')))

  console.log('\n  rms difference from ffmpeg lanczos, grey levels out of 255:')
  console.log(`    3840x2160 -> 1920x1080   default ${dDefault.toFixed(2)}   best ${dBest.toFixed(2)}   stepped ${dHalved.toFixed(2)}`)
  console.log(`    3840x2160 -> 1280x720    default ${d720Default.toFixed(2)}   best ${d720Best.toFixed(2)}`)
  console.log(`    best is ${(100 - (dBest / dDefault) * 100).toFixed(0)}% closer to a correct reduction at the production ratio.`)

  fs.rmSync(dir, { recursive: true, force: true })
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
