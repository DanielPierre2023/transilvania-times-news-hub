// _verification/40-shot-grade.cjs
//
// "The grade is automatic and per-shot, but you can't override one shot by hand."
//
// The adaptive grade is right nearly always and wrong exactly when a shot is
// MEANT to sit apart — a memory, a night exterior, a deliberately cold frame in
// a warm film. There was no way to say so.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const worker = require(path.join(ROOT, 'render-worker', 'src', 'grade.js'))
const workerRender = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'render.js'), 'utf8')


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const MEAN = [0.21, 0.18, 0.13]
const DELIVERY = { look: 'warm', strength: 0.85 }

// ── no override behaves exactly as before ────────────────────────────────
{
  const auto = T.planGains(MEAN, 'warm', 0.85)
  ok('no override is byte-for-byte the automatic grade',
    JSON.stringify(T.planShotGains(MEAN, DELIVERY)) === JSON.stringify(auto))
  ok('an empty override is the same', JSON.stringify(T.planShotGains(MEAN, DELIVERY, {})) === JSON.stringify(auto))
  ok('null is the same', JSON.stringify(T.planShotGains(MEAN, DELIVERY, null)) === JSON.stringify(auto))
}

// ── a shot can sit apart from the film ───────────────────────────────────
{
  const warm = T.planShotGains(MEAN, DELIVERY)
  const cool = T.planShotGains(MEAN, DELIVERY, { look: 'cool' })
  ok('a shot can take a different look', JSON.stringify(cool) !== JSON.stringify(warm))
  ok('...and it really is cooler — more blue, less red',
    cool[2] / cool[0] > warm[2] / warm[0], `${(warm[2] / warm[0]).toFixed(3)} → ${(cool[2] / cool[0]).toFixed(3)}`)

  const soft = T.planShotGains(MEAN, DELIVERY, { strength: 0.2 })
  ok('a shot can be graded less',
    soft.every(g => Math.abs(g - 1) < Math.max(...warm.map(w => Math.abs(w - 1)))),
    `${soft} vs ${warm}`)
  ok('strength zero is identity, whatever the look',
    T.planShotGains(MEAN, DELIVERY, { strength: 0 }).every(g => Math.abs(g - 1) < 1e-9))

  const off = T.planShotGains(MEAN, DELIVERY, { look: 'none' })
  ok("look 'none' leaves the shot exactly as shot", off.every(g => Math.abs(g - 1) < 1e-9), String(off))
}

// ── the trim, in the units an editor expects ─────────────────────────────
{
  const base = T.planShotGains(MEAN, DELIVERY)
  const warmer = T.planShotGains(MEAN, DELIVERY, { temperature: 1 })
  const cooler = T.planShotGains(MEAN, DELIVERY, { temperature: -1 })
  ok('POSITIVE TEMPERATURE IS WARMER', warmer[0] > base[0] && warmer[2] < base[2],
    `${base.map(x => x.toFixed(3))} → ${warmer.map(x => x.toFixed(3))}`)
  ok('negative is cooler', cooler[0] < base[0] && cooler[2] > base[2])
  ok('...and they are symmetrical', Math.abs((warmer[0] / base[0]) * (cooler[0] / base[0]) - 1) < 0.02)

  const green = T.planShotGains(MEAN, DELIVERY, { tint: 1 })
  ok('positive tint is greener', green[1] > base[1])
  ok('...without moving red against blue', Math.abs(green[0] / green[2] - base[0] / base[2]) < 1e-9)

  ok('the trim is gentle — ±1 is about ±12%',
    Math.abs(T.trimGains(1, 0)[0] - 1.12) < 1e-9 && Math.abs(T.trimGains(1, 0)[2] - 0.88) < 1e-9)
  ok('...and clamped, so a typed 40 does not destroy a shot',
    JSON.stringify(T.trimGains(40, 40)) === JSON.stringify(T.trimGains(1, 1)))
  ok('zero trim is identity', JSON.stringify(T.trimGains(0, 0)) === JSON.stringify([1, 1, 1]))
}

// ── "do not grade this" and "do not touch this" are different requests ───
{
  const g = T.planShotGains(MEAN, DELIVERY, { look: 'none', temperature: 0.5 })
  ok('an ungraded shot can still be trimmed by hand',
    Math.abs(g[0] - 1) > 0.01 && g[0] > g[2], String(g))
}

// ── both halves compute it, and the same way ─────────────────────────────
{
  ok('the worker exports it', typeof worker.planShotGains === 'function')
  const a = worker.planShotGains(MEAN, DELIVERY, { look: 'cool', temperature: 0.3 })
  const b = T.planShotGains(MEAN, DELIVERY, { look: 'cool', temperature: 0.3 })
  ok('worker and library agree exactly', JSON.stringify(a) === JSON.stringify(b))
  ok('the worker asks per shot rather than per film',
    /planShotGains\(mean, \{ look, strength \}, shots\[i\]\.grade\)/.test(
      fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'grade.js'), 'utf8')))
  ok('...and the render matches a shot back to the clip that owns it',
    /gradeAt\(cuts\[i\]\)/.test(workerRender) && /pictureClips\.find/.test(workerRender))
}

// ── it travels with the film ─────────────────────────────────────────────
{
  const tl = T.migrateLegacyProject({
    aspect: '9:16',
    scenes: [
      { id: 'a', kind: 'video', url: 'a.mp4', name: 'cald', duration: 4, kb: 'none' },
      { id: 'b', kind: 'video', url: 'b.mp4', name: 'rece', duration: 4, kb: 'none',
        grade: { look: 'cool', temperature: -0.4 } },
    ],
    cues: [], subsOn: false,
  }, { fps: T.FPS.pal })
  const clips = tl.tracks.find(t => t.kind === 'video' && t.z === 0).clips
  ok('a shot without an override carries none', !clips[0].grade)
  ok('a shot with one carries it', clips[1].grade && clips[1].grade.look === 'cool')
  ok('...and the compiled op carries it too, so the painter needs no lookup',
    T.compileFrame({ ...tl, duration: 200 }, 120).video.some(o => o.grade && o.grade.look === 'cool'))
  ok('a film with overrides still validates',
    T.validate({ ...tl, duration: 200 }).filter(p => p.severity === 'error').length === 0)
}

// ── THE CONTROL EXISTS. This is the assertion the audio chain taught me. ──
//
// temperature and tint were computed by the library, honoured by the preview,
// honoured by the worker, and asserted above — with no way for anyone using the
// Studio to set either one. Everything compiled, everything passed, the feature
// did not exist. So: the sliders, and that they write where the reader reads.
{
  const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
  const ui = stripComments(raw)
  ok('there is a control for temperature and tint', /\['temperature', 'tint'\]/.test(ui))
  ok('...it is a slider over the range the library clamps to',
    /min=\{-1\}\s+max=\{1\}/.test(ui))
  ok('...and it writes into scene.grade, where planShotGains reads',
    /grade: empty \? undefined : g/.test(ui))
  ok('AN OVERRIDE THAT SAYS NOTHING IS NOT AN OVERRIDE — back to auto at zero',
    /const empty = !g\.look/.test(ui))
  ok('the look selector still exists beside it', /value="golden"/.test(ui))
  ok('the preview reads the same two fields', /shot\?\.temperature \|\| 0/.test(ui))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
