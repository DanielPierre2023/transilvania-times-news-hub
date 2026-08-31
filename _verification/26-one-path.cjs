// _verification/26-one-path.cjs
//
// The preview had its own painter. That is the root cause of ten separate
// faults this month — not ten bugs, one bug reported ten times:
//
//   channel order · wordmark · safe-area guide · film length · clock source
//   caption size · caption case · karaoke · camera static · camera pan
//
// Each was found by a person watching a finished film, because nothing in the
// code forced the two paths to agree. They are now the same path: the preview
// compiles the SAME timeline `buildTimeline()` hands the renderer and draws it
// with the SAME drawFrame. This suite exists to keep it that way.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const painter = (src.match(/function drawFrame\(ctx: CanvasRenderingContext2D[\s\S]*?\n  \}\n/) || [''])[0]

// ── the painter draws compiled ops and nothing else ──────────────────────
{
  ok('the preview compiles a timeline', /compileFrame\(filmTl, f\)/.test(painter))
  ok('...and draws it with the shared drawer', /drawCompiled\(/.test(painter))
  ok('the picture is no longer painted by hand', !/drawImage/.test(painter))
  ok('the painter no longer knows what a scene is', !/scene/i.test(painter.replace(/nu apare în film/g, '')))
  ok('the second camera is gone', !/kenBurns|evalNumber|evalPoint|fitRect/.test(painter))
  ok('only the guides are drawn outside the compiled frame',
    /guides && showSafe/.test(painter))
}

// ── and the dead second implementation is actually deleted ───────────────
{
  ok('activeSceneAt is gone', !/function activeSceneAt/.test(src))
  ok('the overlay-only timeline is gone', !/overlayTl/.test(src))
  ok('the hand-rolled cover painter stays gone', !/function drawCover/.test(src))
  ok('no camera helpers are still imported',
    !/from '@\/lib\/timeline\/animate'/.test(src) && !/\bkenBurns\b/.test(src))
  ok('the preview timeline comes from the render builder', /return buildTimeline\(\)/.test(src))
}

// ── videos are on their clip's clock, not the film's ─────────────────────
{
  ok('there is a resolver that hands over real media', /function resolveMedia|const resolveMedia/.test(src))
  ok('a video is driven from the clip local frame', /op\.localFrame \/ fps/.test(src))
  ok('nothing starts every video at film time zero any more',
    !/v\.currentTime = 0; v\.play\(\)/.test(src))
  ok('...they are paused and rewound at the start instead', /v\.pause\(\); v\.currentTime = 0/.test(src))
  ok('scrubbing seeks rather than plays', /if \(!m\.paused\) m\.pause\(\)/.test(src))
  ok('playback resyncs only when it has slipped', /> 0\.25\) m\.currentTime = want/.test(src))
  // A scrubber that draws black is worse than no scrubber. Measured on the live
  // site before this landed: six scrub positions, five of them with ten
  // non-black pixels out of four thousand, because media was fetched only by
  // preloadAll() when Preview was pressed.
  ok('a frame that wants a source it has not got fetches it', /pendingMedia\.current\.add\(src\.url\)/.test(src))
  ok('...exactly once per url', /if \(!pendingMedia\.current\.has\(src\.url\)\)/.test(src))
  ok('...and redraws when it lands', /bumpMedia\(n => n \+ 1\)/.test(src))
  ok('...and a dead url does not wedge the painter', /\.catch\(\(\) =>/.test(src) && /finally/.test(src))
  ok('the parked frame redraws on new media', /subScale, mediaTick\]/.test(src))
}

// ── the compiled frame really does carry everything ──────────────────────
// A film with a picture clip, a title and a caption must compile to three
// video ops — if the preview draws that frame it cannot be missing a layer.
{
  const legacy = {
    aspect: '9:16',
    scenes: [{ id: 'a', kind: 'image', url: 'x.png', name: 's', duration: 4, kb: 'in' }],
    cues: [{ start: 0.2, end: 3.5, text: 'Dimineața, cineva deschide o poartă.' }],
    subsOn: true, subPos: 'jos', subScale: 1,
  }
  let tl = T.migrateLegacyProject(legacy, { fps: T.FPS.web })
  const gfx = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  tl = T.addClip(tl, gfx.id, {
    id: 'ttl', name: 'titlu',
    source: { kind: 'text', text: 'Transilvania Times', style: { family: 'Inter', size: 0.06, weight: 600, color: '#fff', align: 'center', lineHeight: 1.1 } },
    start: 0, duration: 60, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.3 } },
    fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  const f = T.compileFrame(tl, 30)
  const kinds = f.video.map(o => o.source.kind)
  ok('a compiled frame carries the picture', kinds.includes('image'), kinds.join(','))
  ok('...the title', kinds.filter(k => k === 'text').length >= 1, kinds.join(','))
  ok('...and the caption, in one list', kinds.filter(k => k === 'text').length >= 2, kinds.join(','))
  ok('every op knows how far into its clip it is',
    f.video.every(o => typeof o.localFrame === 'number'))
  ok('ops are ordered back to front', f.video.map(o => o.z).every((z, i, a) => i === 0 || z >= a[i - 1]),
    f.video.map(o => o.z).join(','))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
