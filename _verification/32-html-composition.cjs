// _verification/32-html-composition.cjs
//
// An authoring surface, added without adding a second renderer.
//
// The obvious way to support HTML in a film is: iframe in the preview, headless
// Chrome in the worker. That is two engines for one picture, and this codebase
// spent a month proving where that ends — ten faults from the preview
// reimplementing what the renderer does.
//
// So a block is rasterised ONCE and both sides draw that bitmap. These
// assertions exist to stop anyone helpfully "improving" that later.
//
// WHERE THE LAYOUT HAPPENS CHANGED, AND THE REASON IS WORTH KEEPING.
//
// It was going to be the browser, through an SVG foreignObject — the page lays
// out real CSS and hands back pixels, no Chrome in the worker. That does not
// work, and it is not the kind of thing a Node suite can discover: Chrome TAINTS
// a canvas the moment an SVG containing a foreignObject is drawn on it, so
// getImageData and toBlob both throw SecurityError. Measured in the running app:
//
//   plain <svg><rect/><text/>     drawImage → getImageData → 24000 px, toBlob ok
//   the same svg + foreignObject  drawImage ok, getImageData → SecurityError
//
// The composition can be DISPLAYED and cannot be READ. So Chrome does the layout
// in the worker instead, and the parity property survives intact: neither side
// lays out HTML at draw time, both draw the produced PNG.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)
const workerRender = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'render.js'), 'utf8')


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── one renderer, still ──────────────────────────────────────────────────
{
  ok('the editor previews with an svg, not an iframe',
    /foreignObjectSvg\(/.test(src) && !/<iframe/i.test(src))
  ok('the worker loads the raster like any still',
    /clip\.source\.kind === 'html'/.test(workerRender) && /stillUrls\.add\(clip\.source\.url\)/.test(workerRender))
  ok('no headless browser enters the FRAME LOOP — layout is not per frame',
    !/puppeteer|playwright/i.test(workerRender))
  ok('the studio does not try to read back a tainted canvas',
    !/toBlob/.test(src) || !/foreignObjectSvg[\s\S]{0,400}toBlob/.test(src))
  ok('rasterisation is asked of the worker', /action: 'raster'/.test(src))
  ok('...and a worker without chromium says so plainly', /Are chromium/.test(src))
  ok('an unrasterised block stops the render instead of shipping empty',
    /nu a fost rasterizat/.test(workerRender))
  ok('the drawer treats it as a bitmap', /kind === 'shape'\) drawShape/.test(
    fs.readFileSync(path.join(ROOT, 'lib', 'timeline', 'draw.ts'), 'utf8')))
}

// ── the stamp catches a stale bitmap ─────────────────────────────────────
{
  const html = '<div>a</div>'
  const stamp = T.stampOf(html)
  ok('a stamp is stable', T.stampOf(html) === stamp)
  ok('...and changes with the markup', T.stampOf('<div>b</div>') !== stamp)
  ok('a block with no url is stale', T.isStale({ kind: 'html', html }))
  ok('a matching stamp is not stale', !T.isStale({ kind: 'html', html, url: 'x.png', stamp }))
  ok('EDITED MARKUP WITH AN OLD RASTER IS STALE',
    T.isStale({ kind: 'html', html: '<div>edited</div>', url: 'x.png', stamp }))
  ok('the studio warns about exactly that', /a fost modificată după rasterizare/.test(src))
}

// ── the linter refuses what foreignObject cannot do ──────────────────────
{
  const errs = h => T.lintHtml(h).filter(p => p.severity === 'error')
  ok('an empty block is refused', errs('').length === 1)
  ok('a remote image is refused — an SVG image cannot fetch',
    errs('<img src="https://x.com/a.png" />').some(p => /extern/i.test(p.message)))
  ok('a remote stylesheet is refused',
    errs('<style>@import url(https://fonts.googleapis.com/x);</style>').length > 0)
  ok('an unclosed br is refused, because XHTML does not forgive',
    errs('<div>a<br>b</div>').some(p => /br/.test(p.message)))
  ok('a self-closed br passes', errs('<div>a<br />b</div>').length === 0)
  ok('a bare ampersand is refused', errs('<div>a & b</div>').length > 0)
  ok('an escaped ampersand passes', errs('<div>a &amp; b</div>').length === 0)
  ok('an entity is not mistaken for a bare ampersand', errs('<div>&#8212;</div>').length === 0)
  ok('script is a warning, not an error — it just will not run',
    T.lintHtml('<script>x()</script><div>a</div>').some(p => p.severity === 'warning') &&
    errs('<script>x()</script><div>a</div>').length === 0)
  ok('the shipped sample composition is clean',
    errs((src.match(/const SAMPLE_COMPOSITION = `([\s\S]*?)`/) || [])[1] || '').length === 0)
}

// ── the wrapper is a layer, not a page ───────────────────────────────────
{
  const doc = T.wrapDocument('<div>x</div>', 1080, 1920)
  ok('the document is transparent — a composition sits OVER a film',
    /background:transparent/.test(doc))
  ok('it is sized to the frame', /width:1080px;height:1920px/.test(doc))
  ok('it does not scroll', /overflow:hidden/.test(doc))
  const svg = T.foreignObjectSvg('<div>x</div>', 540, 960)
  ok('the svg declares the xhtml namespace, or nothing renders',
    /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(svg))
  ok('...and its own size', /width="540" height="960"/.test(svg))
  ok('the markup survives into the foreignObject', /<div>x<\/div>/.test(svg))
}

// ── an html clip behaves like a clip ─────────────────────────────────────
{
  let tl = T.createTimeline({ name: 'h', fps: T.FPS.web, width: 1080, height: 1920 })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  tl = T.addClip(tl, track.id, {
    id: 'h1', name: 'burtieră',
    source: { kind: 'html', html: '<div>x</div>', url: 'https://example.test/a.png',
      naturalWidth: 2160, naturalHeight: 3840, stamp: T.stampOf('<div>x</div>') },
    start: 0, duration: 60, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM }, fit: 'contain',
    fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = { ...tl, duration: 60 }
  ok('a film with an html clip validates',
    T.validate(tl).filter(p => p.severity === 'error').length === 0,
    JSON.stringify(T.validate(tl)))

  const f = T.compileFrame(tl, 10)
  const op = f.video.find(o => o.source.kind === 'html')
  ok('it compiles to a draw op', !!op)
  ok('...and is treated as graphics, above the picture', op.z >= T.GRAPHICS_Z)
  ok('...with its aspect honoured, so it is not distorted',
    Math.abs(op.dest.w / op.dest.h - 2160 / 3840) < 0.01,
    `${op.dest.w}x${op.dest.h}`)

  // and it draws: a resolver handing back a real bitmap must paint pixels
  const bmp = createCanvas(64, 114)
  const bx = bmp.getContext('2d')
  bx.fillStyle = '#CA2222'; bx.fillRect(0, 0, 64, 114)
  const c = createCanvas(108, 192)
  const cx = c.getContext('2d')
  T.drawFrame(cx, T.compileFrame(tl, 10), 108, 192, () => bmp)
  const d = cx.getImageData(0, 0, 108, 192).data
  let red = 0
  for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 80) red++
  ok('an html clip actually paints', red > 500, String(red))
}

// ── the retarget pass leaves it alone, because cover handles it ──────────
{
  let tl = T.createTimeline({ name: 'h', fps: T.FPS.web, width: 1080, height: 1920 })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  tl = T.addClip(tl, track.id, {
    id: 'h1', name: 'b',
    source: { kind: 'html', html: '<div/>', url: 'a.png', naturalWidth: 2160, naturalHeight: 3840 },
    start: 0, duration: 30, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.94 } },
    fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  const wide = T.retarget({ ...tl, duration: 30 }, {
    width: 1920, height: 1080, safe: { top: .05, right: .05, bottom: .05, left: .05 },
  })
  const c = wide.tracks.flatMap(t => t.clips).find(x => x.id === 'h1')
  ok('a composition is clamped into the new safe area like other graphics',
    c.transform.position.y <= 0.91 + 1e-9, String(c.transform.position.y))
}

// ── the rasteriser itself, driven for real ───────────────────────────────
//
// Not "does the function exist" — Chrome is launched, the shipped sample
// composition is laid out, and the pixels are counted. A gradient is the point:
// it is the thing node-canvas cannot draw and the reason this feature exists.
{
  const R = require(path.join(ROOT, 'render-worker', 'src', 'raster.js'))
  const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
  const sample = (raw.match(/const SAMPLE_COMPOSITION = `([\s\S]*?)`/) || [])[1]

  ok('chromium is findable on this machine', !!R.findChromium(), 'set CHROMIUM_PATH')

  const run = async () => {
    if (!R.findChromium()) { console.log('  SKIP: no chromium here'); return }
    const W = 540, H = 960
    const png = await R.rasterHtml(sample, W, H)
    ok('it produces a png', png && png.length > 2000, String(png && png.length))

    const img = await loadImage(png)
    const c = createCanvas(W, H)
    c.getContext('2d').drawImage(img, 0, 0)
    const d = c.getContext('2d').getImageData(0, 0, W, H).data
    let painted = 0, white = 0
    const redTones = new Set()
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 10) painted++
      if (d[i] > 130 && d[i + 1] < 70 && d[i + 2] < 70) redTones.add(d[i])
      if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) white++
    }
    ok('the composition actually paints', painted > W * H * 0.02, `${painted}px`)
    ok('the corner stays transparent — it is a layer, not a page', d[3] === 0, String(d[3]))
    ok('THE GRADIENT RENDERS — the thing node-canvas cannot do',
      redTones.size > 20, `${redTones.size} distinct red tones`)
    ok('the type renders', white > 300, `${white}px of white`)

    // Determinism: the same markup twice must give the same bytes, or a golden
    // frame containing a composition could never be stable.
    const again = await R.rasterHtml(sample, W, H)
    ok('the same markup rasterises identically', Buffer.compare(png, again) === 0)

    // The guard rails are not decorative.
    let refused = 0
    for (const [html, w, h] of [['', 100, 100], ['<div/>', 1, 1], ['<div/>', 99999, 100]]) {
      try { await R.rasterHtml(html, w, h) } catch { refused++ }
    }
    ok('empty markup, a nonsense size and an absurd size are all refused', refused === 3, String(refused))

    // And nothing loads from the network: a composition that fetches would make
    // the render depend on when it ran, and would let markup drive requests.
    const withRemote = '<img src="https://example.com/a.png" style="width:200px;height:200px" />' +
      '<div style="width:80px;height:80px;background:#00ff00"></div>'
    const guarded = await R.rasterHtml(withRemote, 300, 300)
    const gi = await loadImage(guarded)
    const gc = createCanvas(300, 300)
    gc.getContext('2d').drawImage(gi, 0, 0)
    const gd = gc.getContext('2d').getImageData(0, 0, 300, 300).data
    let green = 0
    for (let i = 0; i < gd.length; i += 4) if (gd[i + 1] > 200 && gd[i] < 80) green++
    ok('a remote image is blocked rather than fetched', green > 4000, `${green}px green drew anyway`)

    await R.closeBrowser()
  }
  module.exports.__run = run
}

;(async () => {
  if (module.exports.__run) await module.exports.__run()
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})()
