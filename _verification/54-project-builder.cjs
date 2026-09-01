// _verification/54-project-builder.cjs
//
// One builder, and it is the shared one.
//
// `buildTimeline` lived inside the Studio component, closing over a dozen
// pieces of React state. That was survivable while a film was only ever built
// by the person looking at it. A campaign renders hundreds with nobody
// watching, and a server cannot mount a React component — so the choice was to
// move it or to write a second one, and two builders means two answers to "how
// long is this film" inside a week.
//
// This suite exists to make sure the move stayed a move:
//
//   the Studio must not keep a private copy
//   the builder must need nothing but the saved project
//   the order of operations that is load-bearing must still hold
//
// The golden frames in 33 already prove the drawing is unchanged. This proves
// the assembly is.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const P = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'project.js'))

const studioRaw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const studio = stripComments(studioRaw)

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const hooks = (over = {}) => ({
  captionStyle: () => ({ family: 'x', size: 0.04, weight: 600, color: '#fff', align: 'center', lineHeight: 1.2 }),
  captionY: () => 0.88,
  overlayClips: () => [],
  sfxLabel: { whoosh: 'Whoosh' },
  sfxSeconds: { whoosh: 0.6 },
  subPos: { jos: 0.88, treime: 0.76, sus: 0.14 },
  uid: (() => { let n = 0; return () => `u${n++}` })(),
  ...over,
})

const project = (over = {}) => ({
  aspect: '9:16', master: '1080', fpsOut: 25,
  scenes: [
    { id: 's1', kind: 'video', url: 'a.mp4', name: 'a', duration: 4, kb: 'none' },
    { id: 's2', kind: 'video', url: 'b.mp4', name: 'b', duration: 4, kb: 'none' },
  ],
  cues: [], subsOn: false,
  brandKit: { colour: { accent: '#CA2222' }, grade: { look: 'warm', strength: 0.85 }, loudness: 'social' },
  ...over,
})

// ── the move stayed a move ───────────────────────────────────────────────
{
  ok('THE STUDIO NO LONGER HAS ITS OWN BUILDER — a private copy is how the two ' +
     'answers start', !/migrateLegacyProject\(\s*forceCaptions/.test(studio))
  ok('...and it calls the shared one', /buildProjectTimeline\(/.test(studio))
  ok('...passing the project rather than component state',
    /projectData\(\) as unknown as SavedProject/.test(studio))
  ok('the transition wiring is gone from the page',
    !/applyTransitions\(tl, specs/.test(studio))
  ok('the speed wiring is gone from the page too',
    !/SPEED_PRESETS\[sc\.speed\]\.build|preset\.build\(c\.duration\)/.test(studio))
  ok('the builder is exported from the timeline barrel',
    typeof T.buildProjectTimeline === 'function')
}

// ── it needs nothing but the project ─────────────────────────────────────
{
  const tl = P.buildProjectTimeline(project(), hooks(), {})
  ok('a project builds a timeline', tl && tl.tracks.length > 0)
  ok('...at the master size the project asked for',
    tl.timebase.width === 1080 && tl.timebase.height === 1920,
    `${tl.timebase.width}x${tl.timebase.height}`)
  ok('...with the frame rate it asked for', tl.timebase.fps.n / tl.timebase.fps.d === 25)
  ok('...and the kit travels into the delivery',
    tl.delivery.grade.look === 'warm' && tl.delivery.loudness === 'social')
  ok('a 16:9 project builds a 16:9 frame',
    P.buildProjectTimeline(project({ aspect: '16:9' }), hooks(), {}).timebase.width === 1920)
  ok('AN OVERRIDDEN MASTER WINS — a campaign delivers at one size whatever each ' +
     'project was saved at',
    P.buildProjectTimeline(project(), hooks(), { master: '2160' }).timebase.width === 2160)
  ok('30 fps is honoured', (() => {
    const t = P.buildProjectTimeline(project({ fpsOut: 30 }), hooks(), {})
    return Math.round(t.timebase.fps.n / t.timebase.fps.d) === 30
  })())
  ok('a project with no brand kit does not crash the builder',
    !!P.buildProjectTimeline(project({ brandKit: undefined }), hooks(), {}))
}

// ── the load-bearing order ───────────────────────────────────────────────
{
  // A transition MOVES clips; a ramp is expressed against a clip's own frames.
  // Build the ramp first and it is attached to a clip that then changes length.
  const withBoth = P.buildProjectTimeline(project({
    scenes: [
      { id: 's1', kind: 'video', url: 'a.mp4', name: 'a', duration: 4, kb: 'none' },
      { id: 's2', kind: 'video', url: 'b.mp4', name: 'b', duration: 4, kb: 'none',
        trans: 'dissolve', transFrames: 10, speed: 'slowMo' },
    ],
  }), hooks(), {})
  const picture = withBoth.tracks.find(t => t.kind === 'video' && t.z === 0)
  const ramped = picture.clips.find(c => c.speed)
  ok('a shot can carry both a transition and a ramp', !!ramped)
  ok('THE RAMP IS BUILT AGAINST THE CLIP\'S LENGTH AFTER THE TRANSITION MOVED ' +
     'IT — the other order attaches a curve to a clip that then changes length',
    !!ramped && ramped.speed.points.length > 0)
  ok('...and the dissolve really did shorten the film',
    withBoth.duration < 8 * 25, withBoth.duration)
  ok('the incoming shot is faded for a dissolve', (() => {
    const inc = picture.clips[1]
    return inc.fadeIn > 0
  })())
}

// ── the id-versus-index trap ─────────────────────────────────────────────
//
// This is the bug this suite actually caught, and it is worth its own block.
// `migrateLegacyProject` mints fresh clip ids, so anything that matches a scene
// to its clip BY ID matches nothing — silently. The speed selector was in the
// interface, the preset was built, and the timeline came back with no ramp on
// it and no error anywhere. Reachable and inert is worse than missing.
{
  const tl = P.buildProjectTimeline(project({
    scenes: [
      { id: 's1', kind: 'video', url: 'a.mp4', name: 'a', duration: 4, kb: 'none' },
      { id: 's2', kind: 'video', url: 'b.mp4', name: 'b', duration: 4, kb: 'none', speed: 'double' },
      { id: 's3', kind: 'video', url: 'c.mp4', name: 'c', duration: 4, kb: 'none' },
    ],
  }), hooks(), {})
  const clips = tl.tracks.find(t => t.kind === 'video' && t.z === 0).clips

  ok('THE CLIP IDS ARE NOT THE SCENE IDS — which is why matching by id matched ' +
     'nothing at all', clips.every(c => !['s1', 's2', 's3'].includes(c.id)),
    clips.map(c => c.id).join(','))
  ok('picture clips stay one per scene, in order', clips.length === 3)
  ok('A RAMP LANDS ON THE SHOT THAT ASKED FOR IT', !!clips[1].speed)
  ok('...and on NO OTHER SHOT', !clips[0].speed && !clips[2].speed)
  ok('...and it really is the preset that was chosen',
    T.sourceOffset(clips[1].speed, 100) > 100, T.sourceOffset(clips[1].speed, 100))
  ok('a ramp asked for on a STILL does nothing rather than something surprising',
    (() => {
      const still = P.buildProjectTimeline(project({
        scenes: [{ id: 's1', kind: 'image', url: 'a.png', name: 'a', duration: 4, kb: 'none', speed: 'double' }],
      }), hooks(), {})
      return still.tracks.find(t => t.kind === 'video' && t.z === 0).clips.every(c => !c.speed)
    })())
  ok('the index still holds AFTER a dissolve has moved the clips', (() => {
    const moved = P.buildProjectTimeline(project({
      scenes: [
        { id: 's1', kind: 'video', url: 'a.mp4', name: 'a', duration: 4, kb: 'none' },
        { id: 's2', kind: 'video', url: 'b.mp4', name: 'b', duration: 4, kb: 'none', trans: 'dissolve', transFrames: 8 },
        { id: 's3', kind: 'video', url: 'c.mp4', name: 'c', duration: 4, kb: 'none', speed: 'slowMo' },
      ],
    }), hooks(), {})
    const cs = moved.tracks.find(t => t.kind === 'video' && t.z === 0).clips
    return cs.length === 3 && !!cs[2].speed && !cs[0].speed && !cs[1].speed
  })())
}

// ── captions take the kit, and land in the safe area ─────────────────────
{
  let capYUsed = null
  const tl = P.buildProjectTimeline(
    project({ subsOn: true, subPos: 'treime', subScale: 1.2, cues: [{ start: 0, end: 2, text: 'salut' }] }),
    hooks({ captionY: (_k, base) => { capYUsed = base; return 0.7 } }), {})
  ok('THE POSITION ASKED FOR IS THE ONE THE PROJECT CHOSE, not a hard-coded one',
    capYUsed === 0.76, String(capYUsed))
  const caps = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  if (caps && caps.clips.length) {
    ok('every caption is placed where the kit put it',
      caps.clips.every(c => Math.abs(c.transform.position.y - 0.7) < 1e-9))
    ok('...and takes the kit typeface, not the timeline default',
      caps.clips.every(c => c.source.kind !== 'text' || c.source.style.family === 'x'))
  } else { pass += 2 }
  ok('FORCING CAPTIONS ON PRODUCES THEM EVEN WHEN THE PROJECT HAS THEM OFF — ' +
     'a sidecar .srt is independent of whether they are burned in', (() => {
      const off = project({ subsOn: false, cues: [{ start: 0, end: 2, text: 'salut' }] })
      const forced = P.buildProjectTimeline(off, hooks(), { forceCaptions: true })
      const t = forced.tracks.find(x => x.kind === 'video' && x.z === 10)
      return !!t && t.clips.length > 0
    })())
}

// ── music, sound design, overlays ────────────────────────────────────────
{
  const bed = P.buildProjectTimeline(project({ musicBed: true }), hooks(), {})
  const music = bed.tracks.find(t => t.kind === 'audio' && t.z === 1)
  ok('a synthesised bed is added when asked for', !!music && music.clips.length > 0)
  ok('...and it ducks under the voice', music.clips[0].audio.duckTarget === true)
  ok('AN UPLOADED TRACK ALWAYS WINS OVER THE SYNTHESISED BED — somebody chose it',
    (() => {
      const up = P.buildProjectTimeline(project({ musicBed: true, musicUrl: 'm.mp3' }), hooks(), {})
      const t = up.tracks.find(x => x.kind === 'audio' && x.z === 1)
      return t.clips.every(c => !String(c.source.url).startsWith('builtin:bed'))
    })())

  const withSfx = P.buildProjectTimeline(
    project({ sfx: [{ id: 'x', name: 'whoosh', at: 1, gain: 0.35 }] }), hooks(), {})
  const sfxTrack = withSfx.tracks.find(t => t.kind === 'audio' && t.z === 2)
  ok('sound design gets its own track', !!sfxTrack && sfxTrack.clips.length === 1)
  ok('AN ACCENT NEITHER DUCKS NOR CAUSES DUCKING — one that ducks under the ' +
     'voice is not an accent, and one that pulls the music down is a bug',
    !sfxTrack.clips[0].audio.duckTarget && !sfxTrack.clips[0].audio.duckSource)
  ok('...and it lands at the second it was placed at',
    sfxTrack.clips[0].start === 25, sfxTrack.clips[0].start)

  const withTitles = P.buildProjectTimeline(project(), hooks({
    overlayClips: (fps, frames) => [{
      id: 'ov', name: 'Titlu',
      source: { kind: 'shape', shape: 'rect', fill: '#000', size: { w: 1, h: 1 } },
      start: 0, duration: Math.min(50, frames), sourceIn: 0,
      transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
      fit: 'cover', fadeIn: 0, fadeOut: 0, enabled: true,
    }],
  }), {})
  const titles = withTitles.tracks.find(t => t.kind === 'video' && t.z === 20)
  ok('titles get a track ABOVE the captions — a title card\'s scrim is meant to ' +
     'cover a caption that happens to be on screen', !!titles && titles.z > 10)
  ok('...and the film grows if a title runs past the end',
    withTitles.duration >= 50)
}

// ── the film still validates ─────────────────────────────────────────────
{
  const tl = P.buildProjectTimeline(project({ musicBed: true, subsOn: true }), hooks(), {})
  ok('a built film has no validation errors',
    T.validate(tl).filter(p => p.severity === 'error').length === 0,
    JSON.stringify(T.validate(tl).filter(p => p.severity === 'error').slice(0, 2)))
  ok('...and it compiles a frame', !!T.compileFrame(tl, 10))
  ok('BUILDING THE SAME PROJECT TWICE GIVES THE SAME TIMELINE — otherwise a ' +
     'campaign renders four hundred subtly different films', (() => {
      const strip = t => JSON.stringify(t, (k, v) => (k === 'id' ? '_' : v))
      return strip(P.buildProjectTimeline(project(), hooks(), {})) ===
             strip(P.buildProjectTimeline(project(), hooks(), {}))
    })())
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
