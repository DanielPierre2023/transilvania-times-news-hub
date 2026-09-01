// _verification/38-transitions.cjs
//
// "You have cuts and whooshes. No dissolves, wipes or speed ramps exposed."
//
// A cross-dissolve is not a new drawing mode. The compiler already draws clips
// in order and blends them by opacity, and a clip already has fadeIn/fadeOut.
// A dissolve is two clips overlapping while one ramps down and the other ramps
// up — everything needed existed, and nothing arranged it.
//
// So this is a pure timeline transform and the renderer never learns it happened.
// These assertions prove it by drawing actual frames.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const W = 120, H = 200
function film(colours = ['#CA2222', '#2255CC', '#22AA55'], each = 50) {
  let tl = T.createTimeline({ name: 't', fps: T.FPS.pal, width: W, height: H })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  colours.forEach((fill, i) => {
    tl = T.addClip(tl, track.id, {
      id: 's' + i, name: 'plan ' + (i + 1),
      source: { kind: 'shape', shape: 'rect', fill, size: { w: 1, h: 1 } },
      start: i * each, duration: each, sourceIn: 0,
      transform: { ...T.IDENTITY_TRANSFORM }, fit: 'cover',
      fadeIn: 0, fadeOut: 0, enabled: true,
    })
  })
  return { ...tl, duration: colours.length * each }
}
const pixel = (tl, frame) => {
  const c = createCanvas(W, H)
  T.drawFrame(c.getContext('2d'), T.compileFrame(tl, frame), W, H, () => null)
  const d = c.getContext('2d').getImageData(W / 2, H / 2, 1, 1).data
  return [d[0], d[1], d[2]]
}

// ── a cut is still a cut ─────────────────────────────────────────────────
{
  const r = T.applyTransitions(film(), [undefined, { kind: 'cut', frames: 12 }, undefined])
  ok('a cut changes nothing', r.framesLost === 0)
  ok('...and the film keeps its length', r.timeline.duration === 150)
  ok('one clip cannot have a transition', T.applyTransitions(film(['#f00'], 50), []).framesLost === 0)
}

// ── a dissolve actually blends, in pixels ────────────────────────────────
{
  const base = film()
  const { timeline, framesLost } = T.applyTransitions(base, [undefined, { kind: 'dissolve', frames: 12 }, undefined])
  ok('a dissolve costs time', framesLost === 12, String(framesLost))
  ok('...and the film says so', timeline.duration === 138, String(timeline.duration))

  const clips = timeline.tracks.find(t => t.kind === 'video' && t.z === 0).clips
  ok('the second shot starts earlier by the overlap', clips[1].start === 38, String(clips[1].start))
  ok('the outgoing shot fades out', clips[0].fadeOut === 12, String(clips[0].fadeOut))
  ok('the incoming shot fades in', clips[1].fadeIn === 12, String(clips[1].fadeIn))

  const before = pixel(timeline, 30)
  const mid = pixel(timeline, 44)
  const after = pixel(timeline, 60)
  ok('before the dissolve it is the first shot', before[0] > 150 && before[2] < 90, before.join(','))
  ok('after it, the second', after[2] > 150 && after[0] < 90, after.join(','))
  ok('IN THE MIDDLE IT IS GENUINELY BOTH — the pixels blend',
    mid[0] > 20 && mid[0] < 180 && mid[2] > 20 && mid[2] < 200 &&
    JSON.stringify(mid) !== JSON.stringify(before) && JSON.stringify(mid) !== JSON.stringify(after),
    mid.join(','))
}

// ── a dip does not eat time, and it goes solid ───────────────────────────
{
  const { timeline, framesLost } = T.applyTransitions(film(), [undefined, { kind: 'dipToBlack', frames: 10 }, undefined])
  ok('A DIP COSTS NO TIME — the shots do not overlap', framesLost === 0)
  ok('...so the film keeps its length', timeline.duration === 150)
  const dipTrack = timeline.tracks.find(t => t.kind === 'video' && t.z === 5)
  ok('the dip rides on its own track', !!dipTrack && dipTrack.clips.length === 1)
  ok('...above the picture and below the type', dipTrack.z > 0 && dipTrack.z < T.GRAPHICS_Z)

  // At the join the colour should be at full strength.
  const at = pixel(timeline, 50)
  ok('at the cut the frame is the dip colour', at[0] < 40 && at[1] < 40 && at[2] < 40, at.join(','))
  const off = pixel(timeline, 20)
  ok('...and well before it, the picture is untouched', off[0] > 150, off.join(','))

  const white = T.applyTransitions(film(), [undefined, { kind: 'dipToWhite', frames: 10 }, undefined])
  ok('a white dip goes white', pixel(white.timeline, 50)[0] > 210, pixel(white.timeline, 50).join(','))
  const brand = T.applyTransitions(film(), [undefined, { kind: 'dipToBrand', frames: 10 }, undefined],
    { brandColour: '#00FF00' })
  ok('a brand dip uses the brand colour', pixel(brand.timeline, 50)[1] > 200, pixel(brand.timeline, 50).join(','))
}

// ── it refuses to make a slideshow ───────────────────────────────────────
{
  // Two 12-frame shots asked for a 40-frame dissolve.
  const short = film(['#f00', '#00f'], 12)
  const { framesLost } = T.applyTransitions(short, [undefined, { kind: 'dissolve', frames: 40 }])
  ok('A DISSOLVE NEVER EATS MORE THAN A THIRD OF THE SHORTER SHOT',
    framesLost === 4, String(framesLost))
  const tiny = T.applyTransitions(film(['#f00', '#00f'], 6), [undefined, { kind: 'dissolve', frames: 1 }])
  ok('...and never less than the minimum, or it reads as a mistake',
    tiny.framesLost === T.MIN_DISSOLVE, String(tiny.framesLost))
}

// ── the cost is knowable before committing to it ─────────────────────────
{
  const clips = [{ duration: 50 }, { duration: 50 }, { duration: 50 }]
  const specs = [undefined, { kind: 'dissolve', frames: 12 }, { kind: 'dipToBlack', frames: 10 }]
  ok('the estimate matches what actually happens',
    T.framesLostTo(clips, specs) === T.applyTransitions(film(), specs).framesLost,
    `${T.framesLostTo(clips, specs)} vs ${T.applyTransitions(film(), specs).framesLost}`)
  ok('a dip contributes nothing to the estimate',
    T.framesLostTo(clips, [undefined, { kind: 'dipToBlack', frames: 20 }]) === 0)
}

// ── three shots, two different transitions, still coherent ───────────────
{
  const r = T.applyTransitions(film(), [
    undefined, { kind: 'dissolve', frames: 10 }, { kind: 'dipToBlack', frames: 8 },
  ])
  const clips = r.timeline.tracks.find(t => t.kind === 'video' && t.z === 0).clips
  ok('every shot still starts after the one before it',
    clips.every((c, i) => i === 0 || c.start >= clips[i - 1].start), clips.map(c => c.start).join(','))
  ok('nothing starts before zero', clips.every(c => c.start >= 0))
  ok('the timeline validates', T.validate(r.timeline).filter(p => p.severity === 'error').length === 0,
    JSON.stringify(T.validate(r.timeline).filter(p => p.severity === 'error')))
  ok('the dip moved with the shot it belongs to',
    r.timeline.tracks.find(t => t.z === 5).clips[0].start >= clips[1].start,
    String(r.timeline.tracks.find(t => t.z === 5).clips[0].start))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
