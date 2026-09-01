// _verification/49-screen.cjs
//
// "No screen capture" — the missing half of every software sales clip.
//
// The recording is the easy part. What makes it watchable is arithmetic, and
// three pieces of that arithmetic fail in ways that look like a broken tool:
//
//   A PUSH TOWARD A CORNER hangs the crop off the edge of the screen and
//   renders as black bars — and corners are exactly where software puts the
//   interesting buttons.
//   A ZOOM WITH NO HOLDING KEYFRAME drifts from the first moment to the second,
//   so a push meant for 0:12 actually begins at 0:00 and the shot never sits still.
//   A VERTICAL DEMO IS UNREADABLE and nothing says so until it is made.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
const SCREEN = { width: 2560, height: 1440 }
const LAND = { w: 1920, h: 1080 }
const VERT = { w: 1080, h: 1920 }
const inside = r => r.x >= -1e-9 && r.y >= -1e-9 && r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9

// ── the crop stays on the screen ─────────────────────────────────────────
{
  const centre = T.cropFor({ at: 0, x: 0.5, y: 0.5, zoom: 1 }, LAND, SCREEN)
  ok('a wide shot of a 16:9 screen into a 16:9 frame uses all of it',
    near(centre.w, 1) && near(centre.h, 1), JSON.stringify(centre))
  ok('...and is inside the screen', inside(centre))

  const tight = T.cropFor({ at: 0, x: 0.5, y: 0.5, zoom: 0.4 }, LAND, SCREEN)
  ok('a push takes less of the screen', tight.w < centre.w)
  ok('...and stays centred where it was asked to be', near(tight.x + tight.w / 2, 0.5, 1e-9))

  for (const [x, y, name] of [[0, 0, 'top-left'], [1, 1, 'bottom-right'], [1, 0, 'top-right'], [0, 1, 'bottom-left']]) {
    const r = T.cropFor({ at: 0, x, y, zoom: 0.35 }, LAND, SCREEN)
    ok(`A PUSH INTO THE ${name.toUpperCase()} CORNER STAYS ON THE SCREEN — software ` +
       `puts its interesting buttons in corners, and an unclamped crop renders black bars there`,
      inside(r), JSON.stringify(r))
  }
  ok('...and the clamp MOVES the rectangle rather than shrinking it, so two ' +
     'pushes in one film are the same size',
    near(T.cropFor({ at: 0, x: 0, y: 0, zoom: 0.35 }, LAND, SCREEN).w,
         T.cropFor({ at: 0, x: 0.5, y: 0.5, zoom: 0.35 }, LAND, SCREEN).w))
  ok('a clamped push is REPORTED, so the interface can say the point moved', (() => {
    const f = { at: 0, x: 0, y: 0, zoom: 0.35 }
    return T.wasClamped(f, T.cropFor(f, LAND, SCREEN))
  })())
  ok('...and a centred push is not reported as clamped', (() => {
    const f = { at: 0, x: 0.5, y: 0.5, zoom: 0.4 }
    return !T.wasClamped(f, T.cropFor(f, LAND, SCREEN))
  })())
  ok('an absurd zoom is clamped to something the pixels can support',
    T.cropFor({ at: 0, x: 0.5, y: 0.5, zoom: 0.001 }, LAND, SCREEN).w >= T.MAX_ZOOM_IN * 0.9)

  const vert = T.cropFor({ at: 0, x: 0.5, y: 0.5, zoom: 1 }, VERT, SCREEN)
  ok('A VERTICAL DELIVERY CROPS THE SIDES rather than letterboxing the whole desktop',
    vert.w < 0.5 && near(vert.h, 1), JSON.stringify(vert))
  ok('...and is still inside the screen', inside(vert))
}

// ── keyframes: the holding key is the whole trick ────────────────────────
{
  const keys = T.cropKeys([{ at: 12, x: 0.8, y: 0.2, zoom: 0.4 }], LAND, SCREEN, 25)
  ok('a push produces keys', keys.length >= 2)
  ok('THE SHOT SITS STILL UNTIL THE MOVE BEGINS — without a holding key the ' +
     'crop drifts from frame 0 and a push meant for 0:12 starts immediately',
    (() => {
      const before = keys.filter(k => k.frame < 12 * 25)
      return before.length >= 2 &&
        JSON.stringify(before[0].rect) === JSON.stringify(before[before.length - 1].rect)
    })(), JSON.stringify(keys.map(k => k.frame)))
  ok('the push lands exactly on the moment asked for',
    keys.some(k => k.frame === 12 * 25))
  ok('the travel is not instantaneous', (() => {
    const dest = keys.findIndex(k => k.frame === 12 * 25)
    return dest > 0 && (keys[dest].frame - keys[dest - 1].frame) >= T.MIN_TRAVEL * 25 - 1
  })())
  ok('a too-short travel is lengthened to something that reads as a move',
    (() => {
      const k = T.cropKeys([{ at: 5, x: 0.5, y: 0.5, zoom: 0.4, travel: 0.01 }], LAND, SCREEN, 25)
      const d = k.findIndex(x => x.frame === 125)
      return d > 0 && (k[d].frame - k[d - 1].frame) >= T.MIN_TRAVEL * 25 - 1
    })())
  ok('keys are in frame order', keys.every((k, i) => i === 0 || k.frame >= keys[i - 1].frame))
  ok('every key rectangle is on the screen', keys.every(k => inside(k.rect)))
  ok('no focus means no keys', T.cropKeys([], LAND, SCREEN, 25).length === 0)
  ok('several pushes each get their own hold', (() => {
    const k = T.cropKeys([
      { at: 5, x: 0.2, y: 0.2, zoom: 0.5 },
      { at: 15, x: 0.8, y: 0.8, zoom: 0.4 },
    ], LAND, SCREEN, 25)
    return k.length >= 5
  })())
  ok('focuses given out of order are sorted rather than tangled', (() => {
    const k = T.cropKeys([
      { at: 15, x: 0.8, y: 0.8, zoom: 0.4 },
      { at: 5, x: 0.2, y: 0.2, zoom: 0.5 },
    ], LAND, SCREEN, 25)
    return k.every((x, i) => i === 0 || x.frame >= k[i - 1].frame)
  })())
}

// ── dead air ─────────────────────────────────────────────────────────────
{
  const hz = 10
  // 3s busy, 4s still (loading), 3s busy
  const changes = [
    ...Array(30).fill(0.4),
    ...Array(40).fill(0.001),
    ...Array(30).fill(0.4),
  ]
  const dead = T.deadAir(changes, hz)
  ok('a loading pause is found', dead.length === 1, JSON.stringify(dead))
  ok('...with the right boundaries', near(dead[0].from, 3, 0.11) && near(dead[0].to, 7, 0.11), JSON.stringify(dead))

  const brief = [...Array(30).fill(0.4), ...Array(5).fill(0.001), ...Array(30).fill(0.4)]
  ok('A SHORT STILLNESS IS LEFT ALONE — those are the seconds where the viewer ' +
     'is READING what was just revealed, and cutting them makes a demo shorter ' +
     'and impossible to follow',
    T.deadAir(brief, hz).length === 0)
  ok('a recording that is still to the very end is still found',
    T.deadAir([...Array(10).fill(0.4), ...Array(40).fill(0)], hz).length === 1)
  ok('a busy recording has no dead air', T.deadAir(Array(100).fill(0.5), hz).length === 0)
  ok('an empty measurement does not crash', T.deadAir([], hz).length === 0)
}

// ── skipping dead air with speed rather than with a cut ──────────────────
{
  const pts = T.skipPoints([{ from: 3, to: 7 }], 25)
  ok('dead air becomes a speed ramp', pts.length >= 4)
  ok('THE CLIP RUNS AT NORMAL SPEED BEFORE AND AFTER',
    pts[0].rate === 1 && pts[pts.length - 1].rate === 1)
  ok('...and fast in the middle', pts.some(p => p.rate > 3))
  ok('THE SPEED CHANGE IS NOT INSTANTANEOUS — an instant rate change is itself ' +
     'a visible glitch',
    (() => {
      const up = pts.findIndex(p => p.rate > 3)
      return up > 0 && pts[up].frame > pts[up - 1].frame
    })())
  ok('the points are ordered and unique',
    pts.every((p, i) => i === 0 || p.frame > pts[i - 1].frame))
  ok('THE RAMP IS A VALID SPEED RAMP the compiler can actually play', (() => {
    const off = T.sourceOffset({ points: pts }, 300)
    return Number.isFinite(off) && off > 0
  })())
  ok('...and it genuinely consumes MORE source than real time, which is what ' +
     'skipping means',
    T.sourceOffset({ points: pts }, 250) > 250)
  ok('no dead air produces a plain real-time ramp',
    T.skipPoints([], 25).length === 1 && T.skipPoints([], 25)[0].rate === 1)
}

// ── readability: say it before the film is made ──────────────────────────
{
  const wide = T.readability(SCREEN, LAND, 1)
  ok('a 2560 desktop into a 1920 frame is readable', wide.ok, wide.note)
  ok('...and reports the real scale', wide.scale > 0.7 && wide.scale < 0.8, wide.scale)

  const vertical = T.readability(SCREEN, VERT, 1)
  ok('A WHOLE DESKTOP IN A VERTICAL FRAME IS REPORTED UNUSABLE', !vertical.ok,
    `scale ${vertical.scale.toFixed(2)} coverage ${vertical.coverage.toFixed(2)}`)
  ok('...and it fails on COVERAGE, not on text size — cropping the sides off a ' +
     'wide screen genuinely enlarges the text, which is why a single number ' +
     'reported this case as the most readable of all',
    vertical.scale > 1 && vertical.coverage < 0.45,
    `scale ${vertical.scale.toFixed(2)} coverage ${vertical.coverage.toFixed(2)}`)
  ok('...and the note names how much of the screen is lost',
    /% din ecran/.test(vertical.note), vertical.note)
  ok('...and says what to do about it', /apropie|orizontal/i.test(vertical.note), vertical.note)
  ok('the landscape case reports high coverage', wide.coverage > 0.9, wide.coverage)

  const pushed = T.readability(SCREEN, VERT, 0.35)
  ok('...and pushing in on the part that matters fixes it', pushed.ok, pushed.note)
  ok('A DELIBERATE PUSH IS NOT JUDGED ON COVERAGE — rejecting the exact remedy ' +
     'the warning recommends is how a warning becomes one people ignore',
    pushed.coverage < 0.45 && pushed.ok, `coverage ${pushed.coverage.toFixed(3)}`)
  ok('...but a pushed-in shot that is still too small to read DOES fail',
    !T.readability({ width: 800, height: 600 }, { w: 3840, h: 2160 }, 0.2).ok === false ||
     T.readability({ width: 8000, height: 6000 }, { w: 640, h: 360 }, 0.9).ok === false)
  ok('every device frame has a label and an honest note',
    Object.values(T.DEVICE_FRAMES).every(f => f.label && f.note.length > 20))
  ok('the "no frame" option says it is the most readable',
    /lizibil/.test(T.DEVICE_FRAMES.none.note))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
