#!/usr/bin/env node
// tools/tt.cjs — the Studio's own commands.
//
//   node tools/tt.cjs doctor     what is missing on this machine
//   node tools/tt.cjs lint       what is wrong with a timeline
//   node tools/tt.cjs snapshot   write the golden frames
//   node tools/tt.cjs check      doctor + lint + snapshot compare
//
// SNAPSHOT IS THE ONE THAT EARNS ITS KEEP.
//
// There were 494 assertions before this file and not one of them looked at a
// PIXEL of a finished frame. Everything was structural — this clip exists, that
// number is in range, this string is absent. A change that draws the caption two
// points smaller, or shifts a plate, or loses a shadow, passes every one of them
// and passes the render QC too, because the file is still 900 frames at −16 LUFS.
// That is the class of regression this closes: the film still validates and no
// longer looks the same.
//
// Golden frames are rendered from a FIXTURE timeline, not from a real project,
// so the references are deterministic, small enough to commit, and do not rot
// when somebody edits their film.

'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const GOLDEN = path.join(ROOT, '_verification', 'golden')
const DIST = process.env.TIMELINE_DIST || path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js')

const c = { red: s => `\x1b[31m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`,
  amber: s => `\x1b[33m${s}\x1b[0m`, dim: s => `\x1b[2m${s}\x1b[0m` }
let problems = 0
const bad = (m, hint) => { problems++; console.log(c.red('  ✕ ') + m + (hint ? c.dim('\n      ' + hint) : '')) }
const warn = m => console.log(c.amber('  ! ') + m)
const good = m => console.log(c.green('  ✓ ') + m)

function load() {
  if (!fs.existsSync(DIST)) {
    bad('the shared timeline is not built', 'cd render-worker && npm run build:timeline')
    process.exit(1)
  }
  return require(DIST)
}

// ── the fixture ──────────────────────────────────────────────────────────
//
// One shot, a caption, a title and a rule: enough surfaces that a change to any
// drawing code moves at least one pixel, and nothing that needs a network.
function fixture(T, w = 540, h = 960) {
  let tl = T.createTimeline({ name: 'golden', fps: T.FPS.pal, width: w, height: h })
  const pic = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  const gfx = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  tl = T.addClip(tl, pic.id, {
    id: 'bg', name: 'fundal',
    source: { kind: 'shape', shape: 'rect', fill: '#2B3A42', size: { w: 1, h: 1 } },
    start: 0, duration: 125, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM }, fit: 'cover', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = T.addClip(tl, gfx.id, {
    id: 'rule', name: 'linie',
    source: { kind: 'shape', shape: 'rect', fill: '#CA2222', size: { w: 0.34, h: 0.006 } },
    start: 0, duration: 125, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.42 } },
    fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = T.addClip(tl, gfx.id, {
    id: 'title', name: 'titlu',
    source: { kind: 'text', text: 'Știrile de aici', style: {
      family: 'EB Garamond, Georgia, serif', size: 0.085, weight: 400, color: '#F4F0E8',
      align: 'center', lineHeight: 1.1 } },
    start: 0, duration: 125, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.34 } },
    fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = T.addClip(tl, gfx.id, {
    id: 'cap', name: 'replică',
    source: { kind: 'text', text: 'Dimineața, cineva deschide o poartă.', style: {
      family: 'Inter, Helvetica, Arial, sans-serif', size: 0.045, weight: 600, color: '#FFFFFF',
      align: 'center', lineHeight: 1.22, background: 'rgba(0,0,0,0.55)', padding: 0.012, maxWidth: 0.86 } },
    start: 0, duration: 125, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.76 } },
    fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  return { ...tl, duration: 125 }
}

const FRAMES = [0, 40, 90]

function renderGolden(T, frame, w = 540, h = 960) {
  const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  T.drawFrame(ctx, T.compileFrame(fixture(T, w, h), frame), w, h, () => null)
  return canvas
}

/** Mean absolute per-channel difference, 0..255, plus how many pixels moved. */
function compare(aBuf, bBuf, w, h) {
  const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
  const read = async buf => {
    const img = await loadImage(buf)
    const c2 = createCanvas(w, h)
    c2.getContext('2d').drawImage(img, 0, 0, w, h)
    return c2.getContext('2d').getImageData(0, 0, w, h).data
  }
  return Promise.all([read(aBuf), read(bBuf)]).then(([a, b]) => {
    let sum = 0, moved = 0, worst = 0
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])
      sum += d / 3
      if (d > 24) moved++
      if (d / 3 > worst) worst = d / 3
    }
    const n = a.length / 4
    return { mean: sum / n, movedPct: (100 * moved) / n, worst }
  })
}

// ── commands ─────────────────────────────────────────────────────────────
function doctor() {
  console.log('\ndoctor\n')
  const node = Number(process.versions.node.split('.')[0])
  node >= 20 ? good(`node ${process.versions.node}`) : bad(`node ${process.versions.node}`, 'needs 20 or newer')

  const ff = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { encoding: 'utf8' })
  ff.status === 0
    ? good('ffmpeg ' + (ff.stdout.split('\n')[0] || '').replace('ffmpeg version ', '').split(' ')[0])
    : bad('ffmpeg not found', 'apt-get install ffmpeg — encoding, the audio graph and loudness all need it')

  try { require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas')); good('node-canvas') }
  catch { bad('node-canvas not built', 'cd render-worker && npm install') }

  fs.existsSync(DIST) ? good('shared timeline compiled')
    : bad('shared timeline not compiled', 'cd render-worker && npm run build:timeline')

  // THE FONT CHECK IS HERE BECAUSE A MISSING FACE WAS FOUND AT RENDER TIME.
  // The kit named a display face the renderer had never heard of, and every
  // title in every film was quietly set in the fallback. Better to be told now.
  try {
    const { checkFonts } = require(path.join(ROOT, 'render-worker', 'src', 'fonts.js'))
    const T = load()
    const missing = checkFonts(fixture(T))
    const list = Array.isArray(missing) ? missing : (missing && missing.missing) || []
    list.length === 0 ? good('typefaces resolve (EB Garamond, Inter)')
      : bad('missing typefaces: ' + list.join(', '), 'apt-get install fonts-ebgaramond fonts-inter && fc-cache -f')
  } catch (e) { warn('typeface check unavailable here — ' + e.message) }

  const golden = fs.existsSync(GOLDEN) ? fs.readdirSync(GOLDEN).filter(f => f.endsWith('.png')) : []
  golden.length ? good(`${golden.length} golden frames`) : warn('no golden frames yet — run: node tools/tt.cjs snapshot')
  return problems
}

function lint(file) {
  console.log('\nlint\n')
  const T = load()
  let tl
  if (file) {
    try { tl = JSON.parse(fs.readFileSync(file, 'utf8')) }
    catch (e) { bad('cannot read ' + file, e.message); return problems }
  } else {
    tl = fixture(T)
    console.log(c.dim('  (no timeline given — linting the built-in fixture)'))
  }
  const found = T.validate(tl)
  for (const p of found) (p.severity === 'error' ? bad : warn)(`${p.where}: ${p.message}`)
  if (!found.length) good('timeline validates')

  const cues = T.extractCues(tl)
  if (cues.length) {
    const caption = T.checkCaptions(cues, tl.timebase.fps)
    for (const p of caption) warn(p.message)
    if (!caption.length) good(`${cues.length} cues within the reading-speed limits`)
  }
  return problems
}

async function snapshot(write) {
  console.log('\n' + (write ? 'snapshot · writing references' : 'snapshot · comparing') + '\n')
  const T = load()
  fs.mkdirSync(GOLDEN, { recursive: true })
  for (const frame of FRAMES) {
    const file = path.join(GOLDEN, `frame-${String(frame).padStart(4, '0')}.png`)
    const buf = renderGolden(T, frame).toBuffer('image/png')
    if (write) { fs.writeFileSync(file, buf); good(`wrote ${path.basename(file)} (${(buf.length / 1024).toFixed(1)} kB)`); continue }
    if (!fs.existsSync(file)) { bad(`no reference for frame ${frame}`, 'node tools/tt.cjs snapshot --write'); continue }
    const diff = await compare(fs.readFileSync(file), buf, 540, 960)
    // CALIBRATED, NOT GUESSED.
    //
    // The first version used mean ≤ 0.6 and 0.4% moved, which sounded careful
    // and was useless: a deliberate 3% change to caption TYPE SIZE — a fortieth
    // of the 61-vs-49-pixel caption bug this project actually shipped — sailed
    // straight through it. A golden-frame test that cannot see that is
    // decoration.
    //
    // Measured on this fixture: an identical render is 0.000 / 0.00%, and a 3%
    // type-size change is far above this gate. The per-pixel delta is 24 so
    // plain antialiasing drift does not count as movement, and font size is
    // rounded to whole pixels, so a change too small to move the rounded size
    // renders byte-identically — there is no continuum of tiny diffs to tune
    // against, which is what lets the gate be this tight without being flaky.
    if (diff.mean <= 0.005 && diff.movedPct <= 0.03) {
      good(`frame ${frame} matches  ${c.dim(`mean ${diff.mean.toFixed(3)} · moved ${diff.movedPct.toFixed(2)}%`)}`)
    } else {
      const out = path.join(os.tmpdir(), `tt-frame-${frame}.png`)
      fs.writeFileSync(out, buf)
      bad(`frame ${frame} changed — mean ${diff.mean.toFixed(3)}, ${diff.movedPct.toFixed(2)}% of pixels moved, worst ${diff.worst.toFixed(0)}`,
        `got: ${out}   reference: ${file}`)
    }
  }
  return problems
}

;(async () => {
  const cmd = process.argv[2] || 'check'
  const write = process.argv.includes('--write')
  const file = process.argv.find(a => a.endsWith('.json'))
  if (cmd === 'doctor') doctor()
  else if (cmd === 'lint') lint(file)
  else if (cmd === 'snapshot') await snapshot(write)
  else if (cmd === 'check') { doctor(); lint(file); await snapshot(false) }
  else { console.log('usage: tt.cjs [doctor|lint|snapshot [--write]|check] [timeline.json]'); process.exit(2) }
  console.log('')
  if (problems) { console.log(c.red(`${problems} problem${problems === 1 ? '' : 's'}`)); process.exit(1) }
  console.log(c.green('all good')); process.exit(0)
})()
