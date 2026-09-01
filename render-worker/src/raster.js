// render-worker/src/raster.js
//
// HTML and CSS to a PNG, once, on the server.
//
// WHY THIS IS NOT DONE IN THE BROWSER, HAVING TRIED.
//
// The first design rasterised in the page, through an SVG `foreignObject`: the
// browser lays out real CSS and hands back pixels, no Chrome in the worker, no
// second engine. It is a good design and it does not work, for a reason no
// amount of unit testing in Node could have surfaced.
//
// Chrome TAINTS a canvas the moment an SVG containing a foreignObject is drawn
// onto it. Measured in the live app:
//
//   plain <svg><rect/><text/>   drawImage → getImageData → 24000 px, toBlob ok
//   the same svg + foreignObject  drawImage ok, getImageData → SecurityError
//
// It is a deliberate security rule — a foreignObject can host arbitrary
// document content, so the pixels are treated as cross-origin — and it kills
// readback, which means it kills `toBlob`, which means it kills rasterisation.
// The picture can be DISPLAYED in an <img>; it cannot be read.
//
// So Chrome does the layout here instead. The parity property that matters is
// untouched: neither the preview nor the renderer lays out HTML at draw time.
// Both draw the PNG this produces. There is still exactly one engine deciding
// what a composition looks like — it simply lives on this side of the wire.

'use strict'

const fs = require('fs')

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter(Boolean)

/** The one thing worth failing loudly about, said once at startup. */
function findChromium() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p
  return null
}

// Guard rails. A composition is a layer over a film, not a website: nothing here
// should take three seconds or fifty megabytes, and anything that does is a
// mistake worth refusing rather than absorbing.
const MAX_HTML = Number(process.env.RASTER_MAX_HTML || 512 * 1024)
const MAX_SIDE = Number(process.env.RASTER_MAX_SIDE || 4320)
const TIMEOUT = Number(process.env.RASTER_TIMEOUT_MS || 15000)
// A reveal, not a film. Sixty frames at 25 fps is 2.4 seconds of movement, which
// is longer than any lower third should take, and it caps what one composition
// can cost in screenshots and in storage.
const MAX_FRAMES = Number(process.env.RASTER_MAX_FRAMES || 60)
const MAX_ANIM_SECONDS = Number(process.env.RASTER_MAX_ANIM_SECONDS || 3)

/**
 * The document a composition is laid out inside.
 *
 * Transparent, because it sits over a picture. The reset is small on purpose:
 * enough that a block behaves the same everywhere, not so much that it argues
 * with the author's own CSS.
 */
function wrap(html, width, height) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:transparent;
    font-family:Inter,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  body{display:block;overflow:hidden}
  img,svg,video{max-width:100%}
</style></head><body>${html}</body></html>`
}

let browserPromise = null

/** One browser, reused. Launching Chrome per composition costs about a second. */
async function getBrowser() {
  if (browserPromise) return browserPromise
  const exe = findChromium()
  if (!exe) throw new Error('Chromium not found. Set CHROMIUM_PATH or install the chromium package.')
  const { chromium } = require('playwright')
  browserPromise = chromium.launch({
    executablePath: exe,
    // No sandbox: this is already a container, and the alternative is not
    // starting at all on most hosts.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  }).catch(err => { browserPromise = null; throw err })
  return browserPromise
}

async function closeBrowser() {
  if (!browserPromise) return
  try { (await browserPromise).close() } catch { /* already gone */ }
  browserPromise = null
}

/**
 * Lay out `html` at `width`×`height` and return a transparent PNG.
 *
 * `omitBackground` is what makes it a layer rather than a page: everything the
 * composition does not cover stays transparent and the film shows through.
 */
async function rasterHtml(html, width, height) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('Compoziția este goală.')
  if (html.length > MAX_HTML) throw new Error(`Compoziția are ${html.length} caractere, peste limita de ${MAX_HTML}.`)
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) throw new Error('Dimensiuni invalide.')
  if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`Peste limita de ${MAX_SIDE}px pe latură.`)

  const browser = await getBrowser()
  // A fresh context per composition: no cookies, no storage, nothing carried
  // from the last one.
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    // NOTHING LOADS FROM THE NETWORK.
    //
    // A composition that fetches is a composition whose result depends on when
    // it was rendered, and a renderer that fetches arbitrary URLs on behalf of
    // whoever wrote the markup is a request-forgery hole. Fonts and pictures
    // arrive embedded or not at all — which is also exactly what the editor's
    // linter tells the author before they get here.
    await page.route('**/*', route => {
      const url = route.request().url()
      if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return route.continue()
      return route.abort()
    })
    await page.setContent(wrap(html, w, h), { waitUntil: 'load', timeout: TIMEOUT })
    // Give webfonts already embedded as data: URIs a chance to be applied before
    // the shot — otherwise the first raster is in the fallback face.
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {})
    return await page.screenshot({ omitBackground: true, type: 'png', timeout: TIMEOUT })
  } finally {
    await context.close().catch(() => {})
  }
}

/**
 * A composition that MOVES: one PNG per frame of its animated section.
 *
 * The mechanism is the Web Animations API rather than anything bespoke. The
 * author writes ordinary CSS `@keyframes` and `animation`; before each shot,
 * every animation on the page is paused and its `currentTime` set. That gives a
 * deterministic seek which respects authored delays and easing exactly — a
 * staggered reveal staggers, a cubic-bezier stays cubic — and two seeks to the
 * same time produce byte-identical PNGs. Measured, not assumed.
 *
 * ONLY THE ANIMATED SECTION IS RASTERISED, AND THEN IT HOLDS.
 *
 * A lower third is a reveal and then a hold; a logo sting is a sting and then a
 * hold. Rasterising four seconds of a mostly-static block at 25 fps would mean
 * a hundred PNGs, most of them identical, for one second of movement. So the
 * caller says how long the movement lasts, that many frames are produced, and
 * everything after it draws the last one.
 */
async function rasterHtmlFrames(html, width, height, opts = {}) {
  const fps = Math.max(1, Math.min(30, Math.round(Number(opts.fps) || 25)))
  const seconds = Math.max(0, Math.min(MAX_ANIM_SECONDS, Number(opts.seconds) || 0))
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(seconds * fps) + 1))
  if (count === 1) return { fps, frames: [await rasterHtml(html, width, height)] }

  const w = Math.round(Number(width)), h = Math.round(Number(height))
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) throw new Error('Dimensiuni invalide.')
  if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`Peste limita de ${MAX_SIDE}px pe latură.`)
  if (html.length > MAX_HTML) throw new Error(`Compoziția are ${html.length} caractere, peste limita de ${MAX_HTML}.`)

  const browser = await getBrowser()
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  try {
    const page = await context.newPage()
    await page.route('**/*', route => {
      const u = route.request().url()
      if (u.startsWith('data:') || u.startsWith('blob:') || u === 'about:blank') return route.continue()
      return route.abort()
    })
    await page.setContent(wrap(html, w, h), { waitUntil: 'load', timeout: TIMEOUT })
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {})

    const frames = []
    for (let i = 0; i < count; i++) {
      const ms = (i / fps) * 1000
      await page.evaluate((t) => {
        for (const a of document.getAnimations()) {
          try { a.pause(); a.currentTime = t } catch { /* an animation that refuses to seek is left alone */ }
        }
      }, ms)
      frames.push(await page.screenshot({ omitBackground: true, type: 'png', timeout: TIMEOUT }))
    }
    return { fps, frames }
  } finally {
    await context.close().catch(() => {})
  }
}

module.exports = {
  rasterHtml, rasterHtmlFrames, findChromium, closeBrowser, wrap,
  MAX_HTML, MAX_SIDE, MAX_FRAMES, MAX_ANIM_SECONDS,
}
