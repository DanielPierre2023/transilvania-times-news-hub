// _verification/41-speed.cjs
//
// "No speed ramps exposed."
//
// The assertions that matter here are about the INTEGRAL, not about whether a
// function exists. A speed ramp has one classic bug:
//
//   offset(f) = f · rate(f)      plausible, wrong the moment the rate moves
//   offset(f) = ∫₀ᶠ rate(t) dt   correct
//
// Both give identical answers for a CONSTANT rate, which is exactly why the
// wrong one survives testing: every simple test passes. So the tests below use
// a RAMP and check the offset against the trapezoid area computed by hand, and
// then check it again against a fine numerical integration of the same curve.
// A wrong implementation cannot pass both.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const S = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'speed.js'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol

// ── the rate curve itself ────────────────────────────────────────────────
{
  const ramp = { points: [{ frame: 0, rate: 1 }, { frame: 100, rate: 3 }] }
  ok('rate at the start is the first point', S.rateAt(ramp, 0) === 1)
  ok('rate at the end is the last point', S.rateAt(ramp, 100) === 3)
  ok('rate ramps LINEARLY between them', near(S.rateAt(ramp, 50), 2, 1e-9), S.rateAt(ramp, 50))
  ok('past the last point the rate HOLDS, it does not keep climbing',
    S.rateAt(ramp, 500) === 3, S.rateAt(ramp, 500))
  ok('no ramp is real time', S.rateAt(undefined, 42) === 1)
}

// ── the integral: constant rate, where both formulas agree ───────────────
{
  const half = { points: [{ frame: 0, rate: 0.5 }] }
  ok('half speed consumes half the source', near(S.sourceOffset(half, 100), 50, 1e-9))
  const dbl = { points: [{ frame: 0, rate: 2 }] }
  ok('double speed consumes twice the source', near(S.sourceOffset(dbl, 100), 200, 1e-9))
  ok('no ramp consumes exactly its own frames', S.sourceOffset(undefined, 77) === 77)
}

// ── THE INTEGRAL, WHERE THE WRONG FORMULA DIES ───────────────────────────
{
  // 1 → 3 linearly across 100 frames. Trapezoid area = (1+3)/2 × 100 = 200.
  // The plausible-but-wrong f · rate(f) gives 100 × 3 = 300.
  const ramp = { points: [{ frame: 0, rate: 1 }, { frame: 100, rate: 3 }] }
  const got = S.sourceOffset(ramp, 100)
  ok('A RAMP CONSUMES THE AREA UNDER THE RATE CURVE, not frames × final rate',
    near(got, 200, 1e-6), `got ${got}, trapezoid says 200, the wrong formula says 300`)
  ok('...and the wrong answer is genuinely different, so this test can fail',
    Math.abs(200 - 100 * S.rateAt(ramp, 100)) > 50)

  // Halfway: rate there is 2, area = (1+2)/2 × 50 = 75. Wrong formula: 50×2 = 100.
  const mid = S.sourceOffset(ramp, 50)
  ok('...and it is right halfway through too', near(mid, 75, 1e-6),
    `got ${mid}, expected 75, wrong formula gives 100`)

  // Independent check: integrate the same curve numerically at fine steps.
  let num = 0
  const STEP = 0.001
  for (let t = 0; t < 100; t += STEP) num += S.rateAt(ramp, t + STEP / 2) * STEP
  ok('AND IT MATCHES A FINE NUMERICAL INTEGRATION OF THE SAME CURVE',
    near(got, num, 0.01), `exact ${got} vs numerical ${num.toFixed(4)}`)
}

// ── multi-segment ramps sum correctly ────────────────────────────────────
{
  // 1 → 4 over 40 frames  = (1+4)/2×40 = 100
  // 4 → 1 over next 40    = (4+1)/2×40 = 100   → 200 total at frame 80
  const whip = { points: [
    { frame: 0, rate: 1 }, { frame: 40, rate: 4 }, { frame: 80, rate: 1 },
  ] }
  ok('a three-point whip sums its segments', near(S.sourceOffset(whip, 80), 200, 1e-6),
    S.sourceOffset(whip, 80))
  ok('...and mid-segment lands inside the segment, not at its edge',
    near(S.sourceOffset(whip, 20), (1 + 2.5) / 2 * 20, 1e-6), S.sourceOffset(whip, 20))
  ok('the offset never goes backwards', (() => {
    let prev = -1
    for (let f = 0; f <= 120; f++) { const o = S.sourceOffset(whip, f); if (o < prev) return false; prev = o }
    return true
  })())
}

// ── points people will actually type ─────────────────────────────────────
{
  ok('a ramp with no point at frame 0 gets one, holding the first rate backwards',
    S.normalisePoints([{ frame: 50, rate: 2 }])[0].frame === 0)
  ok('...and it holds the RATE, it does not assume real time',
    S.normalisePoints([{ frame: 50, rate: 2 }])[0].rate === 2)
  ok('points out of order are sorted', (() => {
    const p = S.normalisePoints([{ frame: 90, rate: 3 }, { frame: 0, rate: 1 }])
    return p[0].frame === 0 && p[1].frame === 90
  })())
  ok('an absurd rate is clamped, not honoured', S.clampRate(9999) === S.MAX_RATE)
  ok('a zero rate is clamped — a clip that never advances is a freeze, not a ramp',
    S.clampRate(0) === S.MIN_RATE)
  ok('an empty ramp is real time', S.sourceOffset({ points: [] }, 30) === 30)
}

// ── audio: the honest limitation, asserted ───────────────────────────────
{
  ok('a constant rate can carry its audio', S.audioFollows({ points: [{ frame: 0, rate: 2 }] }))
  ok('A RAMPING RATE MUTES ITS AUDIO — a sliding pitch is a fault, not a style',
    !S.audioFollows({ points: [{ frame: 0, rate: 1 }, { frame: 50, rate: 2 }] }))
  ok('...and it can be muted deliberately even when constant',
    !S.audioFollows({ points: [{ frame: 0, rate: 2 }], audio: 'mute' }))
  ok('no ramp keeps its audio', S.audioFollows(undefined))
  ok('constantRate reports null for a real ramp',
    S.constantRate({ points: [{ frame: 0, rate: 1 }, { frame: 9, rate: 2 }] }) === null)
}

// ── atempo chaining, because ffmpeg only takes 0.5..2 per instance ───────
{
  ok('unity needs no atempo at all', S.atempoChain(1).length === 0)
  ok('2× is one stage', S.atempoChain(2).length === 1)
  ok('4× must be chained', S.atempoChain(4).length === 2)
  ok('...and the chain MULTIPLIES BACK to the rate asked for', (() => {
    for (const r of [0.25, 0.5, 1.5, 2, 3, 4, 8]) {
      const product = S.atempoChain(r).reduce((a, b) => a * b, 1)
      if (Math.abs(product - r) > 1e-4) return false
    }
    return true
  })())
  ok('every stage is inside ffmpeg\'s legal 0.5..2 window',
    [0.25, 0.5, 3, 4, 8].every(r => S.atempoChain(r).every(v => v >= 0.5 && v <= 2)))
}

// ── presets are ramps an editor would recognise ──────────────────────────
{
  const keys = Object.keys(S.SPEED_PRESETS)
  ok('there are presets', keys.length >= 5)
  ok('every preset builds a usable ramp at a real duration',
    keys.every(k => {
      const r = S.SPEED_PRESETS[k].build(100)
      return r.points.length >= 1 && r.points.every(p => p.rate >= S.MIN_RATE && p.rate <= S.MAX_RATE)
    }))
  ok('slow motion really is slower than real time',
    S.sourceOffset(S.SPEED_PRESETS.slowMo.build(100), 100) < 100)
  ok('double speed really is faster',
    S.sourceOffset(S.SPEED_PRESETS.double.build(100), 100) > 100)
  ok('the whip genuinely ramps — its audio cannot follow',
    !S.audioFollows(S.SPEED_PRESETS.whip.build(100)))
}

// ── the compiler actually uses it ────────────────────────────────────────
{
  let tl = T.createTimeline({ name: 's', fps: T.FPS.pal, width: 640, height: 360 })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, track.id, {
    id: 'v', name: 'clip', source: { kind: 'video', url: 'v.mp4', naturalDuration: 60 },
    start: 0, duration: 120, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM }, fit: 'cover',
    fadeIn: 0, fadeOut: 0, enabled: true,
    speed: { points: [{ frame: 0, rate: 1 }, { frame: 100, rate: 3 }] },
  })
  tl = { ...tl, duration: 120 }
  const at = (f) => T.compileFrame(tl, f).video[0].sourceTime

  ok('the compiled op carries a WARPED source time', near(at(100), 200 / 25, 1e-6), at(100))
  ok('...which is not the unramped one', Math.abs(at(100) - 100 / 25) > 1)
  ok('at frame 0 a ramp starts at the start of the media', near(at(0), 0, 1e-9))
  ok('source time rises monotonically across the whole clip', (() => {
    let prev = -1
    for (let f = 0; f <= 100; f++) { const t = at(f); if (t < prev) return false; prev = t }
    return true
  })())
  ok('sourceIn is still honoured on top of the ramp', (() => {
    let t2 = T.createTimeline({ name: 's', fps: T.FPS.pal, width: 640, height: 360 })
    const tr = t2.tracks.find(t => t.kind === 'video' && t.z === 0)
    t2 = T.addClip(t2, tr.id, {
      id: 'v', name: 'c', source: { kind: 'video', url: 'v.mp4' },
      start: 0, duration: 10, sourceIn: 50,
      transform: { ...T.IDENTITY_TRANSFORM }, fit: 'cover',
      fadeIn: 0, fadeOut: 0, enabled: true,
      speed: { points: [{ frame: 0, rate: 2 }] },
    })
    const st = T.compileFrame({ ...t2, duration: 10 }, 0).video[0].sourceTime
    return near(st, 50 / 25, 1e-9)
  })())
  ok('a clip WITHOUT a ramp is untouched — the feature costs existing films nothing', (() => {
    let t3 = T.createTimeline({ name: 's', fps: T.FPS.pal, width: 640, height: 360 })
    const tr = t3.tracks.find(t => t.kind === 'video' && t.z === 0)
    t3 = T.addClip(t3, tr.id, {
      id: 'v', name: 'c', source: { kind: 'video', url: 'v.mp4' },
      start: 0, duration: 50, sourceIn: 0,
      transform: { ...T.IDENTITY_TRANSFORM }, fit: 'cover',
      fadeIn: 0, fadeOut: 0, enabled: true,
    })
    return near(T.compileFrame({ ...t3, duration: 50 }, 25).video[0].sourceTime, 1, 1e-9)
  })())
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
