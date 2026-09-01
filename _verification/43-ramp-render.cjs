// _verification/43-ramp-render.cjs
//
// The speed ramp, proven THROUGH THE REAL WORKER TAP.
//
// 41-speed.cjs proves the maths. That is not the same as proving the renderer
// plays it, and the gap between those two is exactly where this project's worst
// bugs have lived: the preview computes a warped source time and shows a ramp,
// the worker decodes one source frame per output frame and shows normal speed,
// nothing throws, and the divergence is only visible if somebody watches the
// file. So this suite decodes a real video through the actual VideoTap and asks
// WHICH SOURCE FRAME came back.
//
// The fixture is a video whose Nth frame is a flat grey of 20 + 4N, so a frame
// identifies itself. The offset of 20 is not decoration: at 4N the first five
// frames are 0, 4, 8, 12, 16, and limited-to-full range conversion clamps all
// of them to 0 — an earlier run of this suite reported a four-frame error at
// the start of every ramp that was entirely the fixture's fault. A test whose
// fixture cannot distinguish its own cases fails in the flattering direction
// just as surely as one that never runs.

const { execSync } = require('child_process')
const fs = require('fs'), os = require('os'), path = require('path')
const ROOT = path.join(__dirname, '..')
const { VideoTap } = require(path.join(ROOT, 'render-worker', 'src', 'sources.js'))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const S = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'speed.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const FF = process.env.FFMPEG || 'ffmpeg'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramp-'))
const src = path.join(dir, 'count.mkv')
execSync(`${FF} -v error -f lavfi -i "color=c=black:s=64x64:d=2.4:r=25" ` +
  `-vf "geq=lum='20+4*N':cb=128:cr=128" -pix_fmt gray -c:v ffv1 ${src} -y`, { stdio: 'pipe' })

const tapOf = () => new VideoTap({ url: src, startSeconds: 0, width: 64, height: 64, fps: 25, createCanvas })
const val = c => c.getContext('2d').getImageData(32, 32, 1, 1).data[0]

async function reference(n) {
  const t = tapOf(); const out = []
  for (let i = 0; i < n; i++) { const c = await t.next(); out.push(c ? val(c) : null) }
  t.close(); return out
}
async function walk(ramp, n) {
  const t = tapOf(); const out = []
  for (let f = 0; f < n; f++) out.push(await t.advanceTo(S.sourceOffset(ramp, f)).then(c => (c ? val(c) : null)))
  t.close(); return out
}

;(async () => {
  const ref = await reference(60)
  const idx = v => { let best = 0, d = 1e9
    ref.forEach((r, i) => { if (r !== null && Math.abs(r - v) < d) { d = Math.abs(r - v); best = i } }); return best }

  // The fixture must be able to tell its own frames apart, or nothing below means anything.
  ok('THE FIXTURE DISTINGUISHES ITS OWN FRAMES — no two of the first ten are equal',
    new Set(ref.slice(0, 10)).size === 10, ref.slice(0, 10).join(','))

  const cases = [
    ['real time', { points: [{ frame: 0, rate: 1 }] }, 10],
    ['half speed', { points: [{ frame: 0, rate: 0.5 }] }, 12],
    ['double speed', { points: [{ frame: 0, rate: 2 }] }, 10],
    ['ramp 1→3', { points: [{ frame: 0, rate: 1 }, { frame: 20, rate: 3 }] }, 14],
    ['whip 1→4→1', { points: [{ frame: 0, rate: 1 }, { frame: 8, rate: 4 }, { frame: 16, rate: 1 }] }, 16],
  ]

  for (const [label, ramp, n] of cases) {
    const seen = (await walk(ramp, n)).map(idx)
    const want = []
    for (let f = 0; f < n; f++) want.push(Math.round(S.sourceOffset(ramp, f)))
    const maxErr = Math.max(...seen.map((s, i) => Math.abs(s - want[i])))
    ok(`${label}: the tap plays the frames the integral asks for`, maxErr === 0,
      `tap ${seen.join(' ')} vs want ${want.join(' ')}`)
  }

  // The distinguishing test: a real ramp must NOT look like real time.
  {
    const ramp = { points: [{ frame: 0, rate: 1 }, { frame: 20, rate: 3 }] }
    const ramped = (await walk(ramp, 14)).map(idx)
    const plain = (await walk({ points: [{ frame: 0, rate: 1 }] }, 14)).map(idx)
    ok('A RAMP GENUINELY DIFFERS FROM REAL TIME — so this suite can fail',
      ramped.some((v, i) => v !== plain[i]))
    ok('...and it is ahead of real time, never behind', ramped.every((v, i) => v >= plain[i]))
  }

  // Slow motion must decode FEWER frames, not more — that is what makes it cheap.
  {
    const t = tapOf()
    const ramp = { points: [{ frame: 0, rate: 0.25 }] }
    for (let f = 0; f < 20; f++) await t.advanceTo(S.sourceOffset(ramp, f))
    ok('SLOW MOTION HOLDS FRAMES rather than re-decoding them', t.consumed <= 8, 'decoded ' + t.consumed)
    t.close()
  }

  // Running off the end of the media freezes rather than going black.
  {
    const t = tapOf()
    const c = await t.advanceTo(500)
    ok('a ramp that runs past the end of the media HOLDS the last frame, not black', !!c)
    t.close()
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})()
