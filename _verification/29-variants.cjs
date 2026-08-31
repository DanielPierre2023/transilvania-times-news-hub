// _verification/29-variants.cjs
//
// "One film, one aspect, one hook. Today every one of those is a manual
// rebuild."
//
// Reframing is where a naive implementation looks amateur, so the two things
// that go wrong are tested rather than assumed:
//
//   A caption at y = 0.76 sits above TikTok's caption bar in 9:16 and in
//   entirely the wrong place in 16:9. Positions must be re-clamped into the
//   safe area of the format they are GOING TO.
//
//   maxWidth is a fraction of frame WIDTH while font size is a fraction of the
//   SHORT edge. Carry 0.86 into 16:9 unchanged and the caption becomes one
//   90-character line: correct arithmetic, unreadable film.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const REELS = { top: 0.08, right: 0.14, bottom: 0.20, left: 0.05 }
const BROADCAST = { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 }

// A real vertical film: two shots, a caption low in frame, a title that slides.
function film() {
  let tl = T.migrateLegacyProject({
    aspect: '9:16',
    scenes: [
      { id: 'a', kind: 'video', url: 'a.mp4', name: 'atelier', duration: 5, kb: 'none' },
      { id: 'b', kind: 'video', url: 'b.mp4', name: 'spital', duration: 5, kb: 'left' },
    ],
    cues: [{ start: 0.2, end: 4.5, text: 'Dimineața, cineva deschide o poartă.' }],
    voUrl: 'v.wav', voDur: 9, subsOn: true, subPos: 'jos', subScale: 1,
  }, { fps: T.FPS.web })
  const gfx = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  tl = T.addClip(tl, gfx.id, {
    id: 'slide', name: 'burtieră',
    source: { kind: 'text', text: 'Ioana Pop', style: { family: 'Inter', size: 0.04, weight: 600, color: '#fff', align: 'left', lineHeight: 1.1, maxWidth: 0.5 } },
    start: 0, duration: 90, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: T.ramp({ x: 0.06, y: 0.9 }, { x: 0.12, y: 0.9 }, 30) },
    fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  return tl
}

const texts = tl => tl.tracks.filter(t => t.kind === 'video')
  .flatMap(t => t.clips).filter(c => c.source.kind === 'text')
const pictures = tl => tl.tracks.filter(t => t.kind === 'video')
  .flatMap(t => t.clips).filter(c => c.source.kind === 'video' || c.source.kind === 'image')

// ── the frame changes and the film does not ──────────────────────────────
{
  const v = film()
  const wide = T.retarget(v, { width: 1920, height: 1080, safe: BROADCAST })
  ok('the frame is the new one', wide.timebase.width === 1920 && wide.timebase.height === 1080)
  ok('the film is the same length', wide.duration === v.duration, `${wide.duration} vs ${v.duration}`)
  ok('the audio is untouched',
    JSON.stringify(wide.tracks.filter(t => t.kind === 'audio')) ===
    JSON.stringify(v.tracks.filter(t => t.kind === 'audio')))
  ok('delivery is untouched — same loudness target', JSON.stringify(wide.delivery) === JSON.stringify(v.delivery))
  ok('picture clips need no arithmetic at all',
    JSON.stringify(pictures(wide)) === JSON.stringify(pictures(v)))
  ok('retargeting to the same frame is a no-op object',
    T.retarget(v, { width: 1080, height: 1920, safe: REELS }) === v)
  // kb 'left' is a position ramp at a constant overscan, so the curve to look
  // for is on position, not on scale.
  ok('a camera move survives the reframe',
    pictures(wide).some(c => typeof c.transform.position === 'object' && 'keys' in c.transform.position))
}

// ── type is re-laid out for the destination ──────────────────────────────
{
  const v = film()
  const wide = T.retarget(v, { width: 1920, height: 1080, safe: BROADCAST })
  const before = texts(v)
  const after = texts(wide)
  ok('every text clip survives', after.length === before.length && after.length >= 2)

  const capBefore = before.find(c => (c.source.style.maxWidth ?? 0) > 0.8)
  const capAfter = after.find(c => c.id === capBefore.id)
  ok('the caption box narrows for a wide frame',
    capAfter.source.style.maxWidth < capBefore.source.style.maxWidth * 0.7,
    `${capBefore.source.style.maxWidth} -> ${capAfter.source.style.maxWidth}`)
  ok('...to roughly the same measure in ems',
    Math.abs(capAfter.source.style.maxWidth * 1920 / 1080 - capBefore.source.style.maxWidth * 1080 / 1080) < 0.02,
    String(capAfter.source.style.maxWidth * 1920 / 1080))
  ok('font size is NOT touched — it is already short-edge relative',
    capAfter.source.style.size === capBefore.source.style.size)

  // y = 0.9 is outside a 16:9 broadcast safe area (bottom 0.05 + 0.04 inset)
  const slideBefore = before.find(c => c.id === 'slide')
  const slideAfter = after.find(c => c.id === 'slide')
  const yOf = a => (typeof a === 'object' && 'keys' in a) ? a.keys.map(k => k.value.y) : [a.y]
  ok('an animated position is still animated after reframing',
    yOf(slideAfter.transform.position).length === yOf(slideBefore.transform.position).length,
    JSON.stringify(yOf(slideAfter.transform.position)))
  ok('every keyframe is clamped, not just the first',
    yOf(slideAfter.transform.position).every(y => y <= 1 - BROADCAST.bottom - 0.04 + 1e-9),
    JSON.stringify(yOf(slideAfter.transform.position)))
  ok('...and the x keyframes stay inside too',
    (typeof slideAfter.transform.position === 'object' ? slideAfter.transform.position.keys : [])
      .every(k => k.value.x >= BROADCAST.left + 0.04 - 1e-9))
}

// ── a square cut, where the vertical safe area would be wrong ────────────
{
  const v = film()
  const square = T.retarget(v, { width: 1080, height: 1080, safe: { top: 0.05, right: 0.05, bottom: 0.08, left: 0.05 } })
  const cap = texts(square).find(c => (c.source.style.maxWidth ?? 0) > 0.5)
  ok('a square frame keeps a wide measure', cap.source.style.maxWidth > 0.7, String(cap.source.style.maxWidth))
  const y = c => {
    const p = c.transform.position
    return (p && typeof p === 'object' && 'keys' in p) ? p.keys[0].value.y : p.y
  }
  ok('the caption rises out of the vertical caption bar',
    texts(square).every(c => y(c) <= 1 - 0.08 - 0.04 + 1e-9))
  ok('the square film validates', T.validate(square).filter(p => p.severity === 'error').length === 0)
}

// ── the presets are the formats a campaign is actually delivered in ──────
{
  const keys = Object.keys(T.ASPECT_PRESETS)
  ok('all four delivery formats are offered',
    ['9:16', '4:5', '1:1', '16:9'].every(k => keys.includes(k)), keys.join(','))
  ok('every preset has even dimensions — H.264 requires it',
    keys.every(k => T.ASPECT_PRESETS[k].width % 2 === 0 && T.ASPECT_PRESETS[k].height % 2 === 0))
  ok('the safe area follows the format, not the project',
    T.ASPECT_PRESETS['9:16'].safeArea === 'reels' && T.ASPECT_PRESETS['16:9'].safeArea === 'broadcast')
  const v = film()
  ok('the film is not offered its own format as a variant',
    !T.otherAspects(v).includes('9:16'), T.otherAspects(v).join(','))
  ok('...but every other one is', T.otherAspects(v).length === 3)
}

// ── and the Studio actually calls it ─────────────────────────────────────
{
  ok('there is a control that renders the family', /renderAllAspects/.test(src))
  ok('it reframes rather than rebuilding', /retarget\(base, \{/.test(src))
  ok('the safe area comes from the destination preset', /SAFE_AREAS\[preset\.safeArea\]/.test(src))
  ok('each variant is validated before it is paid for', /validate\(tl\)\.filter/.test(src))
  ok('per-shot direction is exposed', /setDirection\(sc\.id, \{ motionPrompt/.test(src))
  ok('...and so is the light it must hold', /setDirection\(sc\.id, \{ look:/.test(src))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
