// _verification/27-editing.cjs
//
// "No undo. No trim, no split, no in/out points — the document supports all
// three, the UI exposes none."
//
// Sixty-eight pieces of state and not one line of history: deleting a shot
// destroyed it. And every clip read its source from frame zero, because the
// migration hard-coded `sourceIn: 0` — so shortening a scene could only ever
// throw away the END. There was no way to drop a bad first second of a take.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── the history value type behaves ───────────────────────────────────────
{
  let t = 1000
  const now = () => t
  let h = T.createHistory({ n: 0 }, 'start', now)
  ok('nothing to undo at the start', !T.canUndo(h) && !T.canRedo(h))

  t = 2000; h = T.pushHistory(h, { n: 1 }, 'a', { now })
  t = 3000; h = T.pushHistory(h, { n: 2 }, 'b', { now })
  ok('two edits are two steps', h.past.length === 2, String(h.past.length))

  h = T.undo(h)
  ok('undo goes back one', h.present.value.n === 1, JSON.stringify(h.present.value))
  h = T.undo(h)
  ok('...and again', h.present.value.n === 0)
  ok('redo is now possible', T.canRedo(h))
  h = T.redo(h)
  ok('redo goes forward', h.present.value.n === 1)

  // a new edit after undoing discards the redo branch
  t = 4000; h = T.pushHistory(h, { n: 9 }, 'c', { now })
  ok('editing after an undo drops the redo branch', !T.canRedo(h))

  // no-op pushes are not steps — typing a character that changes nothing
  const before = h
  const same = T.pushHistory(h, { n: 9 }, 'c', { now })
  ok('an unchanged value records nothing', same === before)

  // a drag is one step, not eighty
  let d = T.createHistory({ v: 0 }, 'start', now)
  for (let i = 1; i <= 40; i++) { t = 5000 + i * 5; d = T.pushHistory(d, { v: i }, 'mărime', { now }) }
  ok('a slider drag coalesces into one step', d.past.length === 1, String(d.past.length))
  ok('...and keeps the final value', d.present.value.v === 40)
  t = 9000
  d = T.pushHistory(d, { v: 41 }, 'mărime', { now })
  ok('a later drag past the window is a new step', d.past.length === 2, String(d.past.length))

  // the stack is bounded
  let big = T.createHistory({ i: 0 }, 'start', now)
  for (let i = 1; i <= 200; i++) { t = 10000 + i * 1000; big = T.pushHistory(big, { i }, 'e' + i, { now, limit: 25 }) }
  ok('the stack is capped', big.past.length === 25, String(big.past.length))

  ok('the next undo names itself', T.undoLabel(d) !== null)
}

// ── an in-point actually reaches the clip ────────────────────────────────
{
  const build = (inSec) => T.migrateLegacyProject({
    aspect: '9:16',
    scenes: [{ id: 'a', kind: 'video', url: 'x.mp4', name: 's', duration: 4, kb: 'none', in: inSec }],
    cues: [], subsOn: false,
  }, { fps: T.FPS.pal })
  const clipOf = tl => tl.tracks.find(t => t.kind === 'video' && t.z === 0).clips[0]

  ok('no in-point still starts at zero', clipOf(build(undefined)).sourceIn === 0)
  ok("an in-point of 1.5s is 38 frames at 25fps (37.5, rounded)", clipOf(build(1.5)).sourceIn === 38,
    String(clipOf(build(1.5)).sourceIn))
  ok('a negative in-point is clamped, not passed through', clipOf(build(-3)).sourceIn === 0)
  ok('the timeline validates with an in-point',
    T.validate(build(1.5)).filter(p => p.severity === 'error').length === 0)
}

// ── the UI exposes all of it ─────────────────────────────────────────────
{
  ok('undo is wired to a control', /onClick=\{doUndo\}/.test(src) && /onClick=\{doRedo\}/.test(src))
  ok('...and to the keyboard', /metaKey \|\| e\.ctrlKey/.test(src))
  ok('...without stealing Ctrl+Z from a text field', /INPUT\|TEXTAREA\|SELECT/.test(src))
  ok('history covers the destructive lists', /\[scenes, overlays, sfx, cues\]/.test(src))
  ok('every mutator names its step', (src.match(/mark\('/g) || []).length >= 5,
    String((src.match(/mark\('/g) || []).length))
  ok('duration is no longer image-only',
    src.indexOf('onChange={e => setDur(sc.id') < src.indexOf("{sc.kind === 'image' && <>"))
  ok('a clip has an in-point control', /setIn\(sc\.id/.test(src))
  ok('a clip can be cut at the playhead', /splitAtHead\(sc\.id\)/.test(src))
  ok('the cut refuses to make a sliver', /sc\.duration - at < MIN/.test(src))
  ok('the second half starts where the first ended', /in: \(sc\.in \?\? 0\) \+ at/.test(src))
  ok('there is a playhead to cut at', /setHead\(Number\(e\.target\.value\)\)/.test(src))
  ok('...and the canvas shows the frame under it', /if \(ctx\) drawFrame\(ctx, head\)/.test(src))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
