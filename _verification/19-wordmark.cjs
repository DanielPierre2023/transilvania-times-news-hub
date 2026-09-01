// _verification/19-wordmark.cjs
//
// The wordmark, and the class of bug it belonged to.
//
// "Transilvania Times" was painted into the top-left of every frame by the
// Studio's preview function. That function draws the preview AND feeds the
// browser recorder, so the mark appeared in the preview and in a browser
// render — and was absent from every worker render, because the worker draws
// the timeline and the mark was never in it.
//
// Three outputs, two different films, and no switch. This asserts the fix from
// both ends: it is gone from the painter, and when a kit does ask for it, it
// arrives as real clips that a real render actually contains.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const { execFileSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const ts = require(require.resolve('typescript', { paths: [ROOT] }))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const { renderTimeline } = require(path.join(ROOT, 'render-worker', 'src', 'render.js'))

function load(file, extra = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'brand', file), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  const req = (id) => (id === '@/lib/timeline' ? T : (extra[id] || require(id)))
  new Function('exports', 'module', 'require', js)(mod.exports, mod, req)
  return mod.exports
}
const kitMod = load('kit.ts')
const tpl = load('templates.ts', { './kit': kitMod })


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const fps = T.FPS.web
const W = 540, H = 960

// ── it is gone from the painter ───────────────────────────────────────────
{
  const page = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
  const body = stripComments(page)
  ok('the preview no longer paints a wordmark of its own',
    !/fillText\(\s*kit\.name/.test(body) && !/fillText\(\s*['"]Transilvania Times/.test(body))
  ok('...and nothing else writes the publication name straight onto the canvas',
    !/ctx\.fillText\([^)]*Transilvania/.test(body))
}

// ── off by default ────────────────────────────────────────────────────────
{
  ok('the house kit ships with no wordmark', kitMod.TT_KIT.wordmark === 'none')
  ok('a kit that says none emits nothing',
    tpl.wordmark({ kit: kitMod.TT_KIT, fps, start: 0, frames: 90 }).length === 0)
  ok('an old kit row with no wordmark field resolves to none',
    kitMod.resolveKit({ name: 'X' }).wordmark === 'none')
}

// ── on, it is real clips that survive to the file ─────────────────────────
;(async () => {
  const kit = { ...kitMod.TT_KIT, wordmark: 'topLeft' }
  const clips = tpl.wordmark({ kit, fps, start: 0, frames: 60 })
  ok('a wordmark is text plus a rule', clips.length === 2, String(clips.length))
  ok('it lasts the whole film, not one shot', clips.every(c => c.duration === 60))
  ok('it is ordinary clips, not a special source kind',
    clips.every(c => c.source.kind === 'text' || c.source.kind === 'shape'))

  let tl = T.createTimeline({ name: 'wm', fps, width: W, height: H })
  const pic = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, pic.id, {
    id: 'bg', name: 'pic', source: { kind: 'shape', shape: 'rect', fill: '#101010' },
    start: 0, duration: 60, sourceIn: 0, transform: T.IDENTITY_TRANSFORM,
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  const gfx = T.emptyTrack('video', 'Titluri', 20)
  tl = { ...tl, tracks: [...tl.tracks, gfx] }
  for (const c of clips) tl = T.addClip(tl, gfx.id, c)
  tl = { ...tl, duration: 60, delivery: { loudness: 'none', codec: 'h264', captions: [], grade: { look: 'none', strength: 0 } } }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-'))
  const out = path.join(dir, 'f.mp4')
  await renderTimeline(tl, { workDir: dir, output: out, onProgress: () => {} })
  const png = path.join(dir, 'f.png')
  execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', png, '-y'])
  const img = await loadImage(png)
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)

  const box = kitMod.safeBox(kit)
  /** any pixel notably brighter than the near-black ground, in a region */
  const brightIn = (x0, y0, x1, y1) => {
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
    for (let i = 0; i < d.length; i += 4) if (d[i] > 120 && d[i + 1] > 120) return true
    return false
  }
  ok('the wordmark reaches the RENDERED FILE, which is the whole point',
    brightIn(Math.round(box.x * W) - 4, Math.round(box.y * H) - 4, Math.round(0.7 * W), Math.round(0.30 * H)))
  ok('...in the top-left, where the kit asked for it',
    !brightIn(Math.round(0.5 * W), Math.round(0.55 * H), W, H))

  // And with it off, the same film is clean — the state the delivered spot is in.
  let plain = T.createTimeline({ name: 'wm-off', fps, width: W, height: H })
  const p2 = plain.tracks.find(t => t.kind === 'video' && t.z === 0)
  plain = T.addClip(plain, p2.id, {
    id: 'bg', name: 'pic', source: { kind: 'shape', shape: 'rect', fill: '#101010' },
    start: 0, duration: 60, sourceIn: 0, transform: T.IDENTITY_TRANSFORM,
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  plain = { ...plain, duration: 60, delivery: { loudness: 'none', codec: 'h264', captions: [], grade: { look: 'none', strength: 0 } } }
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wm2-'))
  const out2 = path.join(dir2, 'f.mp4')
  await renderTimeline(plain, { workDir: dir2, output: out2, onProgress: () => {} })
  const png2 = path.join(dir2, 'f.png')
  execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', out2, '-frames:v', '1', png2, '-y'])
  const img2 = await loadImage(png2)
  ctx.clearRect(0, 0, W, H); ctx.drawImage(img2, 0, 0)
  ok('with the wordmark off the corner is clean',
    !brightIn(0, 0, Math.round(0.7 * W), Math.round(0.30 * H)))

  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(dir2, { recursive: true, force: true })
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
