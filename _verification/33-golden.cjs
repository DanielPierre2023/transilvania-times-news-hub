// _verification/33-golden.cjs
//
// The regression class 494 assertions could not catch.
//
// Everything before this was structural: this clip exists, that number is in
// range, this string is absent from the source. A change that draws the caption
// two points smaller, shifts a plate, or loses a shadow passes every one of them
// — and passes the render QC too, because the file is still 900 frames at −16
// LUFS. The film validates and no longer looks the same.
//
// This suite does not just check that golden frames exist. It checks that they
// WORK: it perturbs the drawing maths by a known amount and asserts the
// comparator sees it. A snapshot test that cannot fail is decoration, and the
// first version of this one could not — it used a tolerance of mean ≤ 0.6 and
// 0.4% moved, while a real change scores well under that.
//
// The knob is caption TYPE SIZE, deliberately: a caption rendering 40 per cent
// larger in the preview than in the file is a bug this project actually shipped,
// and three per cent is far smaller than that. The first attempt at this test
// perturbed line-height instead and measured exactly zero — the fixture caption
// is a single line, so line-height changes nothing. A test knob that moves no
// pixels is the same failure as a tolerance that ignores them.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const GOLDEN = path.join(__dirname, 'golden')
const CLI = path.join(ROOT, 'tools', 'tt.cjs')
const cli = fs.readFileSync(CLI, 'utf8')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── the commands exist and behave ────────────────────────────────────────
{
  ok('there is a doctor', /function doctor\(/.test(cli))
  ok('...a lint', /function lint\(/.test(cli))
  ok('...a snapshot', /async function snapshot\(/.test(cli))
  ok('...and a check that runs all three', /doctor\(\); lint\(file\); await snapshot\(false\)/.test(cli))

  const r = spawnSync(process.execPath, [CLI, 'doctor'], { encoding: 'utf8' })
  ok('doctor runs and reports', /node /.test(r.stdout), r.stdout.slice(0, 120))
  ok('doctor checks ffmpeg, canvas and the typefaces',
    /ffmpeg/.test(r.stdout) && /canvas/.test(r.stdout) && /typeface/i.test(r.stdout))
  ok('doctor exits clean on a good machine', r.status === 0, String(r.status))

  const l = spawnSync(process.execPath, [CLI, 'lint'], { encoding: 'utf8' })
  ok('lint runs against the fixture', /validat|Overlaps|audio/i.test(l.stdout))

  const bad = spawnSync(process.execPath, [CLI, 'nonsense'], { encoding: 'utf8' })
  ok('an unknown command is refused, not silently ignored', bad.status === 2, String(bad.status))
}

// ── the references exist and are what the code draws now ─────────────────
{
  ok('golden frames are committed', fs.existsSync(GOLDEN) &&
    fs.readdirSync(GOLDEN).filter(f => f.endsWith('.png')).length >= 3)
  const r = spawnSync(process.execPath, [CLI, 'snapshot'], { encoding: 'utf8' })
  ok('the current drawing code matches the references', r.status === 0,
    r.stdout.replace(/\x1b\[[0-9;]*m/g, '').slice(-400))
  ok('...exactly, not approximately', /mean 0\.000/.test(r.stdout))
}

// ── AND THE COMPARATOR CAN ACTUALLY FAIL ─────────────────────────────────
//
// The point of the suite. Two renders of the same fixture at different sizes of
// one drawing parameter, compared with the shipped thresholds.
{
  const W = 540, H = 960
  const build = (sizeScale) => {
    let tl = T.createTimeline({ name: 'g', fps: T.FPS.pal, width: W, height: H })
    const gfx = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
    tl = T.addClip(tl, gfx.id, {
      id: 'cap', name: 'c',
      source: { kind: 'text', text: 'Dimineața, cineva deschide o poartă.', style: {
        family: 'Inter, Helvetica, Arial, sans-serif', size: 0.045 * sizeScale, weight: 600, color: '#FFFFFF',
        align: 'center', lineHeight: 1.22,
        background: 'rgba(0,0,0,0.55)', padding: 0.012, maxWidth: 0.86 } },
      start: 0, duration: 60, sourceIn: 0,
      transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.76 } },
      fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
    })
    const c = createCanvas(W, H)
    T.drawFrame(c.getContext('2d'), T.compileFrame({ ...tl, duration: 60 }, 10), W, H, () => null)
    return c.getContext('2d').getImageData(0, 0, W, H).data
  }
  const diff = (a, b) => {
    let sum = 0, moved = 0
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      sum += d / 3
      if (d > 24) moved++
    }
    const n = a.length / 4
    return { mean: sum / n, movedPct: (100 * moved) / n }
  }
  // The shipped gate, read out of the CLI so the two cannot drift apart.
  const gate = /diff\.mean <= ([\d.]+) && diff\.movedPct <= ([\d.]+)/.exec(cli)
  ok('the tolerance is stated in the CLI, not hidden', !!gate)
  const [, meanMax, movedMax] = gate.map(Number)

  const base = build(1)
  const same = diff(base, build(1))
  ok('two identical renders are identical', same.mean === 0 && same.movedPct === 0)
  ok('...and pass the gate', same.mean <= meanMax && same.movedPct <= movedMax)

  const nudged = diff(base, build(1.03))
  ok('a 3% type-size change is detectable at all', nudged.mean > 0, JSON.stringify(nudged))
  ok('AND IT FAILS THE SHIPPED GATE — the test can catch a real regression',
    nudged.mean > meanMax || nudged.movedPct > movedMax,
    `mean ${nudged.mean.toFixed(4)} vs ${meanMax}, moved ${nudged.movedPct.toFixed(3)}% vs ${movedMax}%`)
  ok('...with room to spare, so it is not sitting on the threshold',
    nudged.mean > meanMax * 3, `${nudged.mean.toFixed(4)} vs ${meanMax * 3}`)

  // And the property that lets the gate be this tight without being flaky:
  // font size is rounded to whole pixels (540 × 0.045 = 24.3 → 24), so a change
  // too small to move the rounded size renders BYTE-IDENTICALLY rather than
  // slightly differently. There is no continuum of tiny diffs to tune against.
  const tiny = diff(base, build(1.005))
  ok('a change below the pixel-rounding threshold renders identically',
    tiny.mean === 0 && tiny.movedPct === 0, JSON.stringify(tiny))
  ok('...which is why a tight gate is not flaky', tiny.mean <= meanMax)
}

// ── the references are small enough to live in the repository ────────────
{
  const total = fs.readdirSync(GOLDEN).filter(f => f.endsWith('.png'))
    .reduce((s, f) => s + fs.statSync(path.join(GOLDEN, f)).size, 0)
  ok('all golden frames together are under 200 kB', total < 200 * 1024, `${(total / 1024).toFixed(0)} kB`)
  ok('they are real images, not placeholders', total > 10 * 1024)
}

;(async () => {
  const img = await loadImage(path.join(GOLDEN, 'frame-0000.png'))
  ok('a reference is the fixture size', img.width === 540 && img.height === 960, `${img.width}x${img.height}`)
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})()
