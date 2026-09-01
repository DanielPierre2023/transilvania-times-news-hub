// _verification/23-motion.cjs
//
// "They are too static."  They were, and the cause was in the code.
//
//   1. migrate.ts gave a camera move ONLY to scenes of kind 'image'. Every shot
//      in a generated film is kind 'video', so no generated film could ever
//      have a camera move at all, whatever the control said.
//   2. The control itself lived inside a `kind === 'image'` branch of the JSX,
//      so it was never even drawn next to a clip.
//   3. The pan ran out of picture. Overscan at scale 1.08 is 0.04 of the frame
//      each side; the slide was 0.06. Measured with the real fitRect: 21.6 px
//      of black down one edge on a 1080-wide master, at each end of the move.
//   4. The preview had its own camera and disagreed with the renderer three
//      ways at once — static 1.02 vs 1.00, zoom 1.02→1.12 vs 1.00→1.12, and a
//      pan that ran out of picture by a different amount.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const W = 1080, H = 1920, FPS = T.FPS.pal
const scene = (kind, kb) => ({ id: 'a', kind, url: kind === 'video' ? 'x.mp4' : 'x.png', name: 's', duration: 5, kb })
const build = (kind, kb) => T.migrateLegacyProject(
  { aspect: '9:16', scenes: [scene(kind, kb)], cues: [], subsOn: false }, { fps: FPS })
const clipOf = tl => tl.tracks.find(t => t.kind === 'video' && t.z === 0).clips[0]

// ── a clip gets a camera, not only a still ───────────────────────────────
{
  for (const kb of ['in', 'out', 'left', 'right']) {
    const v = clipOf(build('video', kb))
    const i = clipOf(build('image', kb))
    const moving = t => (typeof t.scale === 'object' && 'keys' in t.scale)
                     || (typeof t.position === 'object' && 'keys' in t.position)
    ok(`a VIDEO scene with kb=${kb} carries a move`, moving(v.transform))
    ok(`...and it is the same move a still gets`, JSON.stringify(v.transform) === JSON.stringify(i.transform))
  }
  ok('kb=none is still genuinely static',
    JSON.stringify(clipOf(build('video', 'none')).transform) === JSON.stringify(T.IDENTITY_TRANSFORM))
}

// ── the pan stays inside the picture ─────────────────────────────────────
{
  const worst = kb => {
    const tl = build('video', kb)
    const c = clipOf(tl)
    let bleed = 0
    for (let f = 0; f <= c.duration; f++) {
      const sc = T.evalNumber(c.transform.scale, f)
      const ce = T.evalPoint(c.transform.position, f)
      const r = T.fitRect('cover', 9 / 16, { x: (ce.x - 0.5) * W, y: (ce.y - 0.5) * H, w: W, h: H }, sc)
      bleed = Math.max(bleed, r.x, -(r.x + r.w - W), r.y, -(r.y + r.h - H))
    }
    return bleed
  }
  for (const kb of ['in', 'out', 'left', 'right', 'none']) {
    const b = worst(kb)
    ok(`kb=${kb} never shows the frame through`, b <= 0.001, `${b.toFixed(1)} px of black`)
  }
  // and the old numbers really were broken, so this test would have caught it
  const bad = T.fitRect('cover', 9 / 16, { x: (0.56 - 0.5) * W, y: 0, w: W, h: H }, 1.08)
  ok('the OLD pan values do bleed, by the 21.6 px claimed', Math.abs(bad.x - 21.6) < 0.5, String(bad.x))
  ok('overscan now exceeds the throw', (T.PAN_SCALE - 1) / 2 > T.PAN_THROW,
    `${(T.PAN_SCALE - 1) / 2} vs ${T.PAN_THROW}`)
}

// ── a move is worth having: it is real translation, not a zoom ───────────
{
  // The shot gate measures translation and ignores zoom by design — its own
  // calibration says "slow 10% push over 4s -> move 0.00". So a pan is what
  // actually raises the number a locked-off clip fails on.
  const c = clipOf(build('video', 'left'))
  const a = T.evalPoint(c.transform.position, 0)
  const b = T.evalPoint(c.transform.position, c.duration)
  const perSecond = Math.abs(a.x - b.x) * 100 / T.framesToSeconds(c.duration, FPS)
  ok('a pan moves the picture at over 1 %/s', perSecond > 1.0, perSecond.toFixed(2))
  ok('...comfortably clear of the 0.35 %/s floor', perSecond > 0.35 * 2)
}

// ── the preview no longer has a camera of its own ────────────────────────
{
  const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
  const src = stripComments(raw)
  ok('the hand-rolled cover painter is gone', !/function drawCover/.test(src))
  ok('no hard-coded 1.02 baseline survives', !/scale = 1\.02/.test(src))
  ok('no hard-coded 0.12 pan survives', !/W \* 0\.12/.test(src))
  // Superseded. Evaluating the renderer's curves in the preview was the fix
  // one step ago; the preview now compiles the renderer's FRAMES, so it does not
  // evaluate a camera at all. Asserting the weaker property would now fail
  // against better code.
  ok('the preview does not evaluate a camera of its own',
    !/kenBurns\(a\.scene\.kb/.test(src) && !/fitRect\('cover', mW \/ mH/.test(src))
  ok('...because it compiles the renderer\'s frames instead', /compileFrame\(filmTl, f\)/.test(src))
  ok('the move control is no longer inside the image-only branch',
    src.indexOf('setKb(sc.id') < src.indexOf("{sc.kind === 'image' && <>"))
  ok('there is a way to fix a whole timeline at once', /cameraOnAll/.test(src) && /CAMERA_CYCLE/.test(src))
  ok('...that leaves shots which already move alone', /x\.kb !== 'none' \? x :/.test(src))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
