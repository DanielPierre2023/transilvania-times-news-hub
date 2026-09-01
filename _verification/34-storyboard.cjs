// _verification/34-storyboard.cjs
//
// A film that only exists as a database row can only be reviewed inside the tool
// that made it. A storyboard is the film as a document: every shot, what it
// does, what is said over it, what was measured. It reviews in a pull request,
// it diffs between versions, and it outlives the Studio.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

function film() {
  return T.migrateLegacyProject({
    aspect: '9:16',
    scenes: [
      { id: 'a', kind: 'video', url: 'https://x/atelier.mp4', name: 'atelier', duration: 5, kb: 'none' },
      { id: 'b', kind: 'video', url: 'https://x/spital.mp4', name: 'spital', duration: 5, kb: 'left' },
    ],
    cues: [
      { start: 0.3, end: 4.4, text: 'Dimineața, cineva deschide o poartă.' },
      // deliberately runs across the cut at 5s, and is mostly heard on shot 2
      { start: 4.6, end: 9.2, text: 'Altcineva stinge lumina, după tura de noapte.' },
    ],
    voUrl: 'v.wav', voDur: 10, subsOn: true, subPos: 'jos', subScale: 1,
  }, { fps: T.FPS.pal })
}

// ── the board describes the film ─────────────────────────────────────────
{
  const tl = film()
  const b = T.buildStoryboard(tl, { name: 'Știrile de aici' })
  ok('one entry per shot', b.shots.length === 2, String(b.shots.length))
  ok('shots are in order', b.shots[0].n === 1 && b.shots[1].n === 2)
  ok('a shot keeps its name', b.shots[0].name === 'atelier')
  ok('...its place on the timeline', Math.abs(b.shots[1].startSeconds - 5) < 0.05,
    String(b.shots[1].startSeconds))
  ok('...its length', Math.abs(b.shots[0].durationSeconds - 5) < 0.05)
  ok('...and where the picture came from', b.shots[0].url === 'https://x/atelier.mp4')
  ok('the meta records the frame', b.meta.width === 1080 && b.meta.height === 1920)
  ok('...the loudness target', !!b.meta.loudness)
  ok('...and when it was written', !!Date.parse(b.meta.generatedAt))
}

// ── what is SAID over a shot, which is the hard part ─────────────────────
{
  const b = T.buildStoryboard(film())
  ok('shot 1 carries its own line', /deschide o poartă/.test(b.shots[0].says), b.shots[0].says)
  ok('shot 2 carries its own line', /stinge lumina/.test(b.shots[1].says), b.shots[1].says)
  // A cue that starts at 4.6 and ends at 9.2 overlaps both shots. It must appear
  // where it is actually heard, not only where it began.
  ok('a line running across a cut appears on both shots it is heard on',
    /stinge lumina/.test(b.shots[0].says) && /stinge lumina/.test(b.shots[1].says))
  ok('a shot with no line says nothing rather than undefined',
    typeof T.buildStoryboard(T.migrateLegacyProject({
      aspect: '9:16', scenes: [{ id: 'x', kind: 'image', url: 'a.png', name: 'n', duration: 3, kb: 'none' }],
      cues: [], subsOn: false }, { fps: T.FPS.pal })).shots[0].says === 'string')
}

// ── notes from the take machine reach the page ───────────────────────────
{
  const tl = film()
  const ids = tl.tracks.find(t => t.kind === 'video' && t.z === 0).clips.map(c => c.id)
  const b = T.buildStoryboard(tl, {
    shotNotes: { [ids[0]]: { measured: 'mișcare 3.34 %/s · stabilitate 1.38×', direction: 'obloanele urcă' } },
  })
  ok('a measurement is carried into the document', /3\.34/.test(b.shots[0].measured))
  ok('...and the direction with it', /obloanele/.test(b.shots[0].direction))
  ok('a shot without notes has none', !b.shots[1].measured)
}

// ── the markdown is readable, and complete ───────────────────────────────
{
  const b = T.buildStoryboard(film(), { name: 'Știrile de aici' })
  const md = T.storyboardMarkdown(b, 'Dimineața, cineva deschide o poartă. Altcineva stinge lumina.')
  ok('it opens with the film title', /^# Știrile de aici/m.test(md))
  ok('it states the frame and length', /1080×1920/.test(md) && /planuri/.test(md))
  ok('the script is included, so a reviewer can read it without the tool',
    /## Textul/.test(md) && /deschide o poartă/.test(md))
  ok('every shot has a heading', (md.match(/^### \d+\./gm) || []).length === 2)
  ok('timings are printed, not implied', /0\.00s → 5\.00s/.test(md), md.slice(0, 400))
  ok('spoken lines are quoted', /^> /m.test(md))
  ok('it says what made it', /Marketing Studio/.test(md))
  ok('no script means no empty section', !/## Textul/.test(T.storyboardMarkdown(b)))
}

// ── the studio actually offers it ────────────────────────────────────────
{
  ok('there is an export', /function exportStoryboard/.test(src))
  ok('it writes both the document and the data', /STORYBOARD\.md/.test(src) && /meta\.json/.test(src))
  ok('it carries the measured verdicts across', /measured: sc\.verdict/.test(src))
  ok('...and the per-shot direction', /sc\.motionPrompt/.test(src))
  ok('the object url is released', /revokeObjectURL/.test(src))
  ok('a film with no shots is refused', /Nimic de povestit/.test(src))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
