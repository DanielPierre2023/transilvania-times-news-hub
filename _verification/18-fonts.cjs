// _verification/18-fonts.cjs
//
// A missing typeface is the most invisible defect this pipeline can have.
//
// The kit named "Playfair Display" for weeks. fontconfig had never heard of it,
// Cairo silently substituted the default sans, and every title, lower third and
// end card in every film was set in the wrong face — while the render reported
// success and the QC report stayed green, because nothing measured it.
//
// The text is still there, still legible, still the right colour. There is no
// error to catch. The only way to see it is to measure the advance width, which
// is what this does.

const fs = require('fs')
const os = require('os')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const fonts = require(path.join(ROOT, 'render-worker', 'src', 'fonts.js'))
const { renderTimeline } = require(path.join(ROOT, 'render-worker', 'src', 'render.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── the probe ─────────────────────────────────────────────────────────────
{
  const missing = fonts.probe('Playfair Display, Georgia, serif', 700)
  ok('a face that is not installed is reported as unresolved', missing.resolved === false,
    JSON.stringify(missing))
  ok('...and it is unresolved because it measures the same as a name nobody has',
    Math.abs(missing.width - missing.fallbackWidth) < 0.5)

  const eb = fonts.probe('EB Garamond, Georgia, serif', 400)
  ok('the display face the kit now names IS installed', eb.resolved === true, JSON.stringify(eb))
  const inter = fonts.probe('Inter, Helvetica, Arial, sans-serif', 600)
  ok('so is the body face', inter.resolved === true, JSON.stringify(inter))
  ok('and the two are genuinely different faces, not one substituting for the other',
    Math.abs(eb.width - inter.width) > 20, `${eb.width} vs ${inter.width}`)

  ok('a generic family counts as resolved — it asks for whatever the system has',
    fonts.probe('serif', 400).resolved === true)
  ok('...and so does sans-serif', fonts.probe('sans-serif', 400).resolved === true)
}

// ── what a timeline asks for ──────────────────────────────────────────────
{
  const fps = T.FPS.web
  let tl = T.createTimeline({ name: 'faces', fps, width: 320, height: 240 })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  const text = (id, family, weight) => ({
    id, name: id,
    source: { kind: 'text', text: 'Ăsta e un titlu', style: { family, size: 0.06, weight, color: '#fff', align: 'center', lineHeight: 1.1 } },
    start: 0, duration: 10, sourceIn: 0, transform: T.IDENTITY_TRANSFORM,
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = T.addClip(tl, track.id, text('a', 'EB Garamond, serif', 400))
  tl = T.addClip(tl, track.id, text('b', 'Inter, sans-serif', 600))
  tl = T.addClip(tl, track.id, text('c', 'EB Garamond, serif', 400))   // a duplicate

  const req = fonts.requestedFaces(tl)
  ok('every distinct face in a timeline is collected', req.length === 2, JSON.stringify(req))
  ok('...and a repeat is not probed twice', req.filter(r => /Garamond/.test(r.family)).length === 1)

  const report = fonts.checkFonts(tl)
  ok('a timeline using installed faces passes', report.ok === true, JSON.stringify(report.missing))

  let bad = T.addClip(tl, track.id, text('d', 'Playfair Display, serif', 700))
  const badReport = fonts.checkFonts(bad)
  ok('one missing face fails the whole check', badReport.ok === false)
  ok('...and the report names it', badReport.missing[0].family === 'Playfair Display',
    JSON.stringify(badReport.missing))
}

// ── and it reaches the QC report a human reads ────────────────────────────
;(async () => {
  const fps = T.FPS.web
  let tl = T.createTimeline({ name: 'qc-faces', fps, width: 320, height: 240 })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, track.id, {
    id: 'bg', name: 'bg', source: { kind: 'shape', shape: 'rect', fill: '#222' },
    start: 0, duration: 12, sourceIn: 0, transform: T.IDENTITY_TRANSFORM,
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  const gfx = T.emptyTrack('video', 'Titluri', 20)
  tl = { ...tl, tracks: [...tl.tracks, gfx] }
  tl = T.addClip(tl, gfx.id, {
    id: 't', name: 'title',
    source: { kind: 'text', text: 'Știrile de aici', style: { family: 'Playfair Display, serif', size: 0.08, weight: 700, color: '#fff', align: 'center', lineHeight: 1.1 } },
    start: 0, duration: 12, sourceIn: 0, transform: T.IDENTITY_TRANSFORM,
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = { ...tl, duration: 12, delivery: { loudness: 'none', codec: 'h264', captions: [], grade: { look: 'none', strength: 0 } } }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fontqc-'))
  const res = await renderTimeline(tl, { workDir: dir, output: path.join(dir, 'f.mp4'), onProgress: () => {} })
  ok('the render result carries a font report', res.fonts && res.fonts.ok === false, JSON.stringify(res.fonts?.missing))

  const { inspect } = require(path.join(ROOT, 'render-worker', 'src', 'qc.js'))
  const qc = await inspect(res.output, {
    width: 320, height: 240, fps: 30, frames: 12, durationSeconds: 0.4,
    loudness: 'none', fonts: res.fonts,
  })
  const check = qc.checks.find(c => /typeface/.test(c.name))
  ok('QC reports the missing typeface to a human', check && check.ok === false, JSON.stringify(check))
  ok('...and says which one, and that the film was set in the fallback',
    check && /Playfair Display/.test(check.detail) && /fallback/.test(check.detail), check?.detail)

  fs.rmSync(dir, { recursive: true, force: true })
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
