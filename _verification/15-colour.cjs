// _verification/15-colour.cjs
//
// THE BUG THIS EXISTS TO PREVENT
//
// node-canvas hands back Cairo's native ARGB32, which on a little-endian
// machine is B, G, R, A in memory. The worker's raw pipe told ffmpeg 'rgba'.
// Every frame of every render this worker ever produced had its red and blue
// channels swapped.
//
// Measured before the fix: a #CA2222 rectangle — R 202, G 34, B 34 — came out
// of the encoder as R 33, G 33, B 202.
//
// It is the real reason a warm golden-hour still arrived on screen cold and
// blue, and the reason the delivered film measured B−R of +60, +39 and +49
// across its shots. That was read at the time as the generation model drifting.
// It was one word in one ffmpeg argument.
//
// The browser preview never had it — it draws straight to a visible canvas — so
// the preview looked right and the file did not, which is the worst shape a bug
// can take and the reason this test renders a real file rather than a canvas.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const { renderTimeline } = require(path.join(ROOT, 'render-worker', 'src', 'render.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const SWATCHES = [
  { name: 'brand red', hex: '#CA2222', rgb: [202, 34, 34] },
  { name: 'pure blue', hex: '#2222CA', rgb: [34, 34, 202] },
  { name: 'green', hex: '#22CA22', rgb: [34, 202, 34] },
  { name: 'paper', hex: '#F4F0E8', rgb: [244, 240, 232] },
]

async function renderSwatch(hex) {
  const fps = T.FPS.web
  let tl = T.createTimeline({ name: 'colour', fps, width: 320, height: 240 })
  const vid = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, vid.id, {
    id: 's1', name: 'swatch',
    source: { kind: 'shape', shape: 'rect', fill: hex },
    start: 0, duration: 12, sourceIn: 0,
    transform: T.IDENTITY_TRANSFORM, fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  // Grade OFF: this measures the pipe, not the look.
  tl = { ...tl, duration: 12, delivery: { loudness: 'none', codec: 'h264', captions: [], grade: { look: 'none', strength: 0 } } }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colour-'))
  const out = path.join(dir, 'sw.mp4')
  await renderTimeline(tl, { workDir: dir, output: out, onProgress: () => {} })
  const png = path.join(dir, 'f.png')
  execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', '-vf', 'crop=4:4:158:118', png, '-y'])
  const img = await loadImage(png)
  const c = createCanvas(4, 4)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(1, 1, 1, 1).data
  fs.rmSync(dir, { recursive: true, force: true })
  return [d[0], d[1], d[2]]
}

;(async () => {
  for (const s of SWATCHES) {
    const got = await renderSwatch(s.hex)
    const dist = Math.max(...got.map((v, i) => Math.abs(v - s.rgb[i])))
    // 4:2:0 chroma subsampling and the yuv round trip cost a few levels.
    ok(`${s.name} survives the render at the right end of the spectrum`, dist <= 10,
      `wanted ${s.rgb.join(',')} got ${got.join(',')}`)
    // The specific failure mode, named: red and blue exchanged.
    const swapped = [s.rgb[2], s.rgb[1], s.rgb[0]]
    const swapDist = Math.max(...got.map((v, i) => Math.abs(v - swapped[i])))
    const symmetrical = s.rgb[0] === s.rgb[2]
    ok(`${s.name} is not the red/blue swap`, symmetrical || swapDist > dist,
      `distance to correct ${dist}, to swapped ${swapDist}`)
  }

  // And the argument itself, so a refactor cannot quietly undo it.
  const src = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'render.js'), 'utf8')
  ok("the raw pipe is declared bgra, matching what node-canvas actually produces",
    /'-pix_fmt',\s*'bgra'/.test(src))
  ok('...and never rgba', !/'-f',\s*'rawvideo',\s*'-pix_fmt',\s*'rgba'/.test(src))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
