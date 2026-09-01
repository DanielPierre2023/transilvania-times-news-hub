// _verification/42-wipes.cjs
//
// "You have cuts and dissolves. No wipes."
//
// A dissolve needed no new drawing mode — it is two opacities, which the
// compiler already had. A wipe is genuinely new: part of a clip is painted and
// part is not, with a soft edge between. That is a real capability added to
// both engines, so these assertions READ PIXELS rather than checking that a
// function exists.
//
// The three ways a wipe goes wrong, all tested here:
//
//   1. It reads as a dissolve. If the incoming shot is faded up as well as
//      masked, the outgoing shot shows through the revealed part and the edge
//      is mud. The revealed side must be the incoming colour EXACTLY.
//   2. The edge never clears the frame. If the soft band is not accounted for
//      in the travel, reveal = 1 still leaves a dark strip down one side.
//   3. It costs no time. A wipe overlaps its shots exactly like a dissolve, so
//      a film full of wipes is shorter than its voice-over unless the running
//      time accounts for them.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const W = 200, H = 120
const RED = [202, 34, 34], BLUE = [34, 85, 204]

function film(each = 50) {
  let tl = T.createTimeline({ name: 'w', fps: T.FPS.pal, width: W, height: H })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  ;['#CA2222', '#2255CC'].forEach((fill, i) => {
    tl = T.addClip(tl, track.id, {
      id: 's' + i, name: 'plan ' + (i + 1),
      source: { kind: 'shape', shape: 'rect', fill, size: { w: 1, h: 1 } },
      start: i * each, duration: each, sourceIn: 0,
      transform: { ...T.IDENTITY_TRANSFORM }, fit: 'cover',
      fadeIn: 0, fadeOut: 0, enabled: true,
    })
  })
  return { ...tl, duration: 2 * each }
}
function frameOf(tl, frame) {
  const c = createCanvas(W, H)
  T.drawFrame(c.getContext('2d'), T.compileFrame(tl, frame), W, H, () => null)
  return c.getContext('2d')
}
const px = (cx, x, y) => { const d = cx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
const isNear = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

// ── the mask primitive, on its own ───────────────────────────────────────
{
  const c = createCanvas(W, H)
  const cx = c.getContext('2d')
  cx.fillStyle = '#2255CC'; cx.fillRect(0, 0, W, H)
  T.applyMask(cx, { kind: 'wipeLeft', reveal: 0.5, softness: 0 }, W, H)

  ok('LEFT of a half wipeLeft is painted', px(cx, 10, H / 2)[2] > 150)
  ok('RIGHT of a half wipeLeft is erased', cx.getImageData(W - 10, H / 2, 1, 1).data[3] < 10)

  const c2 = createCanvas(W, H)
  const cx2 = c2.getContext('2d')
  cx2.fillStyle = '#2255CC'; cx2.fillRect(0, 0, W, H)
  T.applyMask(cx2, { kind: 'wipeLeft', reveal: 1, softness: 0.06 }, W, H)
  ok('THE SOFT EDGE CLEARS THE FRAME AT FULL REVEAL — no strip left behind',
    cx2.getImageData(W - 1, H / 2, 1, 1).data[3] > 250,
    'alpha at the far edge: ' + cx2.getImageData(W - 1, H / 2, 1, 1).data[3])

  const c3 = createCanvas(W, H)
  const cx3 = c3.getContext('2d')
  cx3.fillStyle = '#2255CC'; cx3.fillRect(0, 0, W, H)
  T.applyMask(cx3, { kind: 'wipeLeft', reveal: 0, softness: 0.06 }, W, H)
  let anyVisible = false
  for (let x = 0; x < W; x += 5) if (cx3.getImageData(x, H / 2, 1, 1).data[3] > 8) anyVisible = true
  ok('at reveal 0 NOTHING of the clip is on screen', !anyVisible)

  // softness must genuinely feather
  const c4 = createCanvas(W, H)
  const cx4 = c4.getContext('2d')
  cx4.fillStyle = '#2255CC'; cx4.fillRect(0, 0, W, H)
  T.applyMask(cx4, { kind: 'wipeLeft', reveal: 0.5, softness: 0.2 }, W, H)
  const alphas = []
  for (let x = 0; x < W; x += 2) alphas.push(cx4.getImageData(x, H / 2, 1, 1).data[3])
  const partial = alphas.filter(a => a > 12 && a < 243).length
  ok('SOFTNESS PRODUCES A REAL GRADIENT, not a hard edge', partial >= 8, partial + ' partial columns')

  const c5 = createCanvas(W, H)
  const cx5 = c5.getContext('2d')
  cx5.fillStyle = '#2255CC'; cx5.fillRect(0, 0, W, H)
  T.applyMask(cx5, { kind: 'wipeLeft', reveal: 0.5, softness: 0 }, W, H)
  const hard = []
  for (let x = 0; x < W; x += 2) hard.push(cx5.getImageData(x, H / 2, 1, 1).data[3])
  ok('...and softness 0 is genuinely harder than softness 0.2',
    hard.filter(a => a > 12 && a < 243).length < partial)
}

// ── every direction goes the right way ───────────────────────────────────
{
  const at = (kind, x, y, reveal = 0.4) => {
    const c = createCanvas(W, H); const cx = c.getContext('2d')
    cx.fillStyle = '#2255CC'; cx.fillRect(0, 0, W, H)
    T.applyMask(cx, { kind, reveal, softness: 0 }, W, H)
    return cx.getImageData(x, y, 1, 1).data[3]
  }
  ok('wipeLeft reveals from the left', at('wipeLeft', 5, H / 2) > 200 && at('wipeLeft', W - 5, H / 2) < 40)
  ok('wipeRight reveals from the right', at('wipeRight', W - 5, H / 2) > 200 && at('wipeRight', 5, H / 2) < 40)
  ok('wipeDown reveals from the top', at('wipeDown', W / 2, 5) > 200 && at('wipeDown', W / 2, H - 5) < 40)
  ok('wipeUp reveals from the bottom', at('wipeUp', W / 2, H - 5) > 200 && at('wipeUp', W / 2, 5) < 40)
  ok('circle opens from the CENTRE outwards',
    at('circle', W / 2, H / 2, 0.5) > 200 && at('circle', 2, 2, 0.5) < 40)
  ok('barnDoors opens from the centre to BOTH sides',
    at('barnDoors', W / 2, H / 2, 0.5) > 200 &&
    at('barnDoors', 2, H / 2, 0.5) < 40 && at('barnDoors', W - 2, H / 2, 0.5) < 40)
  ok('wipeDiagonal favours the top-left corner first',
    at('wipeDiagonal', 4, 4, 0.3) > at('wipeDiagonal', W - 4, H - 4, 0.3))
}

// ── a wipe on a real timeline: the incoming shot is NOT faded ────────────
{
  const base = film(50)
  const specs = [undefined, { kind: 'wipeLeft', frames: 12, softness: 0 }]
  const r = T.applyTransitions(base, specs, {})
  const tl = r.timeline

  ok('a wipe costs duration, exactly like a dissolve', r.framesLost === 12, r.framesLost)
  ok('...and the film really is that much shorter', tl.duration === 100 - 12, tl.duration)
  ok('A WIPE IS CLAMPED TO A THIRD OF THE SHORTER SHOT, like a dissolve — ' +
     'a wipe longer than the shots it joins is a slideshow',
    T.applyTransitions(base, [undefined, { kind: 'wipeLeft', frames: 40, softness: 0 }], {})
      .framesLost === Math.floor(50 / 3))
  ok('...and the clamp is reported before you render it',
    T.framesLostTo([{ duration: 50 }, { duration: 50 }],
      [undefined, { kind: 'wipeLeft', frames: 40 }]) === Math.floor(50 / 3))
  ok('framesLostTo AGREES with what applyTransitions actually did',
    T.framesLostTo([{ duration: 50 }, { duration: 50 }], specs) === r.framesLost)

  const clips = tl.tracks.find(t => t.kind === 'video' && t.z === 0).clips
  const incoming = clips[1]
  ok('the incoming shot carries a mask', !!incoming.mask)
  ok('THE INCOMING SHOT IS NOT FADED UP — the mask is what hides it',
    incoming.fadeIn === 0, 'fadeIn ' + incoming.fadeIn)
  ok('...and the outgoing shot is not faded down either',
    clips[0].fadeOut === 0, 'fadeOut ' + clips[0].fadeOut)

  // mid-wipe, the two sides must be the two SHOT COLOURS, not a blend
  const mid = incoming.start + 10
  const cx = frameOf(tl, mid)
  const left = px(cx, 6, H / 2)
  const right = px(cx, W - 6, H / 2)
  ok('MID-WIPE THE REVEALED SIDE IS THE INCOMING SHOT EXACTLY, not a blend',
    isNear(left, BLUE), left.join(','))
  ok('...and the other side is the outgoing shot exactly',
    isNear(right, RED), right.join(','))
  ok('THIS IS WHAT MAKES IT A WIPE AND NOT A DISSOLVE — neither side is mixed',
    !isNear(left, [(RED[0] + BLUE[0]) / 2, (RED[1] + BLUE[1]) / 2, (RED[2] + BLUE[2]) / 2], 30))

  // before the wipe: pure outgoing. after: pure incoming.
  ok('before the wipe starts the frame is the outgoing shot',
    isNear(px(frameOf(tl, incoming.start - 2), W / 2, H / 2), RED))
  ok('after the wipe finishes the frame is wholly the incoming shot',
    isNear(px(frameOf(tl, incoming.start + 25), W / 2, H / 2), BLUE))
  ok('...INCLUDING THE FAR EDGE, where a mistimed soft band leaves a strip',
    isNear(px(frameOf(tl, incoming.start + 25), W - 1, H / 2), BLUE),
    px(frameOf(tl, incoming.start + 25), W - 1, H / 2).join(','))
}

// ── a soft wipe really is soft on a real timeline ───────────────────────
{
  const r = T.applyTransitions(film(50), [undefined, { kind: 'wipeLeft', frames: 20, softness: 0.25 }], {})
  const inc = r.timeline.tracks.find(t => t.kind === 'video' && t.z === 0).clips[1]
  const cx = frameOf(r.timeline, inc.start + 10)
  let mixed = 0
  for (let x = 0; x < W; x += 2) {
    const p = px(cx, x, H / 2)
    if (!isNear(p, RED, 12) && !isNear(p, BLUE, 12)) mixed++
  }
  ok('a SOFT wipe shows a band of genuinely blended pixels', mixed >= 6, mixed + ' blended columns')
}

// ── existing films are untouched ─────────────────────────────────────────
{
  const plain = film(50)
  const before = px(frameOf(plain, 60), W / 2, H / 2)
  const after = px(frameOf(T.applyTransitions(plain, [undefined, undefined], {}).timeline, 60), W / 2, H / 2)
  ok('a film with no transitions renders identically after the change',
    before.join(',') === after.join(','))
  ok('a clip with no mask compiles without one',
    !T.compileFrame(plain, 60).video[0].mask)
}

// ── the UI can offer them ────────────────────────────────────────────────
{
  ok('every wipe kind has a label and a note',
    T.WIPE_KINDS.every(k => T.TRANSITIONS[k] && T.TRANSITIONS[k].label && T.TRANSITIONS[k].note))
  ok('the notes warn that a wipe eats duration',
    T.WIPE_KINDS.some(k => /durat/i.test(T.TRANSITIONS[k].note)))
  ok('isWipe is true for wipes and false for everything else',
    T.WIPE_KINDS.every(T.isWipe) && !T.isWipe('cut') && !T.isWipe('dissolve') && !T.isWipe('dipToBlack'))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
