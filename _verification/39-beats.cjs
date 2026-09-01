// _verification/39-beats.cjs
//
// "No beat detection, so the edit never lands on the downbeat — which is most of
// what makes a promo feel professional."
//
// Ground truth is a click track ffmpeg builds at a tempo we choose, so the
// answer is known rather than judged. Nothing here asserts that a function
// exists; it asserts that the tempo comes back right, across the range of
// tempos music is actually written at.
//
// THE OCTAVE ERROR IS THE WHOLE PROBLEM, AND IT IS TESTED HARDEST.
//
// A periodic signal correlates strongly at multiples of its period — every other
// click still lines up — and on a real click track the DOUBLE lag scores higher
// than the true one. Measured at 120 BPM: lag 86 scored 233 against lag 43's 148.
// Two earlier attempts reported 60.1 for 120 and 69.8 for 140, both exactly
// halved, and both looked plausible enough to ship.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const FF = process.env.FFMPEG || 'ffmpeg'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beats-'))
const SR = 22050

function click(bpm, seconds = 12, jitter = 0) {
  const period = 60 / bpm
  const f = path.join(dir, `c${bpm}-${jitter}.wav`)
  const env = jitter
    ? `volume='if(lt(mod(t+${jitter}*sin(t*3),${period.toFixed(6)}),0.03),1,0)':eval=frame`
    : `volume='if(lt(mod(t,${period.toFixed(6)}),0.03),1,0)':eval=frame`
  execSync(`${FF} -v error -f lavfi -i "sine=f=1000:d=${seconds}" -af "${env}" -ar ${SR} -ac 1 ${f} -y`,
    { stdio: 'pipe' })
  const raw = execSync(`${FF} -v error -i ${f} -f f32le -ac 1 -ar ${SR} -`, { maxBuffer: 1e9 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
}

// ── the tempo comes back right, across the musical range ─────────────────
{
  const tempos = [70, 75, 90, 100, 110, 120, 128, 140, 150, 160, 175]
  let right = 0
  for (const bpm of tempos) {
    const a = T.analyseBeats(click(bpm), SR)
    const err = a.bpm ? Math.abs(a.bpm - bpm) : 999
    if (err < 4) right++
    else console.log(`      ${bpm} → ${a.bpm ? a.bpm.toFixed(1) : 'null'}`)
  }
  ok('EVERY TEMPO FROM 70 TO 175 BPM IS FOUND WITHIN 4 BPM', right === tempos.length,
    `${right}/${tempos.length}`)

  // The two that failed the first two implementations, named so a regression is
  // recognisable rather than merely red.
  for (const bpm of [120, 140]) {
    const a = T.analyseBeats(click(bpm), SR)
    ok(`${bpm} BPM is not reported as half tempo`, a.bpm > bpm * 0.75,
      `${a.bpm && a.bpm.toFixed(1)}`)
  }
}

// ── onsets, and the grid built from them ─────────────────────────────────
{
  const a = T.analyseBeats(click(120, 10), SR)
  ok('onsets are found', a.onsets.length >= 15, String(a.onsets.length))
  ok('...ascending, always', a.onsets.every((t, i) => i === 0 || t > a.onsets[i - 1]))
  ok('...none before the file starts', a.onsets.every(t => t >= 0))
  ok('a grid is produced', a.beats.length > 15, String(a.beats.length))
  ok('the grid is evenly spaced', (() => {
    const gaps = a.beats.slice(1).map((t, i) => t - a.beats[i])
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
    return gaps.every(g => Math.abs(g - mean) < 0.005)
  })())
  ok('the grid agrees with the onsets it was built from', (() => {
    const period = 60 / a.bpm
    let near = 0
    for (const o of a.onsets) {
      const d = Math.min(...a.beats.map(b => Math.abs(b - o)))
      if (d < period * 0.15) near++
    }
    return near / a.onsets.length > 0.8
  })(), 'grid drifts away from the onsets')
  ok('confidence is high on a click track', a.confidence > 0.5, String(a.confidence))
}

// ── it declines rather than inventing ────────────────────────────────────
{
  const silence = new Float32Array(SR * 4)
  const s = T.analyseBeats(silence, SR)
  ok('silence produces no beats', s.beats.length === 0 && s.onsets.length === 0)
  ok('...and no tempo claim', s.bpm === null || s.confidence < 0.2, JSON.stringify(s.bpm))
  ok('an empty buffer does not throw', T.analyseBeats(new Float32Array(0), SR).onsets.length === 0)
  ok('a too-short buffer does not throw', T.analyseBeats(new Float32Array(100), SR).bpm === null)

  const raw = execSync(`${FF} -v error -f lavfi -i "anoisesrc=d=8:a=0.4:seed=3" -ar ${SR} -ac 1 -f f32le -`,
    { maxBuffer: 1e9 })
  const noise = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4)
  const n = T.analyseBeats(noise, SR)
  ok('WHITE NOISE IS NOT CONFIDENTLY MUSICAL', n.confidence < 0.5, String(n.confidence))
}

// ── snapping is conservative on purpose ──────────────────────────────────
{
  const beats = [0, 0.5, 1.0, 1.5, 2.0]
  ok('a cut close to a beat moves to it', T.snapToBeats([1.06], beats)[0] === 1.0)
  ok('...and one far from any beat is LEFT ALONE',
    T.snapToBeats([1.24], beats, 0.1)[0] === 1.24)
  // 1.24 is 0.24 from 1.0 and 0.26 from 1.5, so a wider limit reaches the
  // NEARER beat, not the later one. Getting this expectation wrong the first
  // time is exactly why the assertion spells out the arithmetic.
  ok('a wider limit reaches the nearest beat, not the next one',
    T.snapToBeats([1.24], beats, 0.3)[0] === 1.0)
  ok('with no beats nothing moves', T.snapToBeats([1.24], [])[0] === 1.24)
  ok('several cuts snap independently',
    JSON.stringify(T.snapToBeats([0.48, 1.03], beats)) === JSON.stringify([0.5, 1.0]))
}

// ── durations in, durations out ──────────────────────────────────────────
{
  const durs = [4, 3, 5]
  const cuts = T.cutsFromDurations(durs)
  ok('cuts sit at the joins', JSON.stringify(cuts) === JSON.stringify([4, 7]))
  ok('and convert back', JSON.stringify(T.durationsFromCuts(cuts, 12)) === JSON.stringify(durs))
  const snapped = T.durationsFromCuts(T.snapToBeats(cuts, [0, 3.5, 7.5, 12]), 12)
  ok('snapping preserves the total length', Math.abs(snapped.reduce((a, b) => a + b, 0) - 12) < 0.01,
    JSON.stringify(snapped))
  ok('no shot is allowed to collapse to nothing',
    T.durationsFromCuts([0.01, 0.02], 5).every(d => d >= 0.5), JSON.stringify(T.durationsFromCuts([0.01, 0.02], 5)))
}

fs.rmSync(dir, { recursive: true, force: true })
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
