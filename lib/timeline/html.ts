// lib/timeline/html.ts
//
// HTML as an authoring surface, without a second renderer.
//
// THE PROBLEM WITH "JUST RENDER THE HTML".
//
// The obvious implementation is: the preview mounts an iframe, the worker drives
// headless Chrome. That is two renderers for one picture — and this codebase has
// spent a great deal of effort proving where that leads. Ten faults in one month
// came from the preview reimplementing what the renderer does. Adding a browser
// to one side and not the other would have re-opened that class on the day it
// was closed.
//
// So an HTML block is rasterised ONCE, into a bitmap, and both sides draw the
// same bitmap. Not a screenshot of a preview — the artefact IS the picture.
// Layout, fonts, gradients, blend modes, masks and SVG all resolve at raster
// time, in one place, and after that it is an image like any other image.
//
// WHAT THIS BUYS AND WHAT IT COSTS.
//
// Buys: anything CSS can express. Real typography, gradient meshes, mix-blend
// modes, backdrop filters, layered SVG, flexbox lower-thirds that reflow around
// a long name — none of which node-canvas can draw and all of which a person who
// knows CSS can write in an afternoon.
//
// Costs: the block does not animate by itself. Motion comes from the timeline —
// keyframed transform, the same as every other clip. That is the honest trade,
// and it is stated here rather than discovered later. Per-frame HTML animation
// would need Chrome in the worker; the design leaves room for it (the source
// keeps its html, so it can be re-rasterised per frame) without requiring it.

export interface HtmlSource {
  readonly kind: 'html'
  /** The markup. Kept as the source of truth so it can be re-rasterised. */
  readonly html: string
  /** Rasterised result. Absent until it has been rendered once. */
  readonly url?: string
  /** Pixel size it was rasterised at, so a redraw knows its natural size. */
  readonly naturalWidth?: number
  readonly naturalHeight?: number
  /** Hash of the html at raster time — a mismatch means the bitmap is stale. */
  readonly stamp?: string

  /**
   * A composition that MOVES: one URL per frame of its animated opening.
   *
   * The author writes ordinary CSS `@keyframes`. At raster time every animation
   * on the page is paused and seeked with the Web Animations API, which respects
   * authored delays and easing exactly — a staggered reveal staggers, a
   * cubic-bezier stays cubic — and is deterministic to the byte.
   *
   * Only the moving part is rasterised. A lower third is a reveal and then a
   * hold; after the last frame it holds. That is why a four-second block costs
   * twenty frames rather than a hundred.
   */
  readonly frames?: readonly string[]
  readonly frameFps?: number
}

/**
 * Which frame of an animated composition is on screen.
 *
 * Past the end of the sequence it holds the last one — the hold is the point.
 * Called by BOTH resolvers, so the preview and the renderer cannot disagree
 * about which picture belongs to a frame.
 */
export function frameUrlAt(
  source: { url?: string; frames?: readonly string[]; frameFps?: number },
  localFrame: number,
  timelineFps: number,
): string | undefined {
  const seq = source.frames
  if (!seq || seq.length === 0) return source.url
  const fps = source.frameFps && source.frameFps > 0 ? source.frameFps : 25
  const i = Math.floor((Math.max(0, localFrame) / timelineFps) * fps)
  return seq[Math.min(i, seq.length - 1)] ?? source.url
}

/**
 * A stable, dependency-free hash of the markup.
 *
 * Only has to answer "is this bitmap still the picture this html describes".
 * FNV-1a is enough for that and needs nothing installed.
 */
export function stampOf(html: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < html.length; i++) {
    h ^= html.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

export function isStale(source: HtmlSource): boolean {
  if (!source.url && !(source.frames && source.frames.length)) return true
  return source.stamp !== stampOf(source.html)
}

/**
 * The document a block is rasterised inside.
 *
 * Transparent by default, because a composition is a layer over a film and not a
 * page. The reset is deliberately small: enough that a block behaves the same
 * everywhere, not so much that it fights the author's own CSS.
 */
export function wrapDocument(html: string, width: number, height: number): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  *,*::before,*::after{box-sizing:border-box}
  html,body{margin:0;padding:0;width:${width}px;height:${height}px;background:transparent;
    font-family:Inter,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  body{display:block;overflow:hidden}
  img,svg,video{max-width:100%}
</style></head><body>${html}</body></html>`
}

/**
 * The SVG that carries the markup for browser-side rasterisation.
 *
 * `foreignObject` is the one path that renders real CSS to a canvas without a
 * second engine: the browser lays the HTML out itself, exactly as it would on a
 * page, and hands back pixels. It has two hard rules, and both are load-bearing:
 * the markup must be well-formed XHTML, and it may not reference external URLs,
 * because an SVG loaded as an image cannot fetch. Fonts and pictures therefore
 * have to arrive already embedded — which is why the studio inlines them before
 * calling this.
 */
export function foreignObjectSvg(html: string, width: number, height: number): string {
  const doc = wrapDocument(html, width, height)
  const body = doc.slice(doc.indexOf('<body>') + 6, doc.lastIndexOf('</body>'))
  const style = doc.slice(doc.indexOf('<style>'), doc.indexOf('</style>') + 8)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px">` +
    style + body +
    `</div></foreignObject></svg>`
}

/**
 * Problems worth refusing to rasterise over.
 *
 * A block that reaches for a remote font or image looks right while you are
 * editing it — the page can fetch — and comes back blank once it is inside an
 * SVG image, which cannot. Catching that here means the author is told, rather
 * than shipping an empty rectangle into a film.
 */
export interface HtmlProblem { readonly severity: 'error' | 'warning'; readonly message: string }

export function lintHtml(html: string): HtmlProblem[] {
  const out: HtmlProblem[] = []
  if (!html.trim()) out.push({ severity: 'error', message: 'Compoziția este goală.' })

  const remote = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi)
  if (remote) {
    out.push({
      severity: 'error',
      message: `Adresă externă (${remote.length}): un SVG încărcat ca imagine nu poate descărca nimic. ` +
        'Încorporează fișierul ca data: URI.',
    })
  }
  if (/@import|url\(\s*["']?https?:/i.test(html)) {
    out.push({ severity: 'error', message: '@import sau url() extern în CSS — la fel, nu se va încărca.' })
  }
  // A STAGGERED REVEAL THAT POPS, AND WHY.
  //
  // With `animation-delay`, an element shows its NORMAL styles until the delay
  // elapses — not the `from` keyframe. So a bar meant to slide in at 0.4s is
  // sitting in its final position for the first ten frames, jumps off-screen the
  // instant the animation starts, then slides back. It looks like a glitch and
  // it is entirely correct CSS. `animation-fill-mode: backwards` (or `both`)
  // holds the opening state through the delay, which is what the author meant.
  //
  // Found by rasterising a two-bar stagger and reading the pixels, not by
  // reading the spec.
  if (/animation-delay\s*:|animation\s*:[^;]*\b\d*\.?\d+s[^;]*\b\d*\.?\d+s/i.test(html)
      && !/animation-fill-mode\s*:\s*(backwards|both)|animation\s*:[^;]*\b(backwards|both)\b/i.test(html)) {
    out.push({
      severity: 'warning',
      message: 'Întârziere de animație fără fill-mode: elementul stă în poziția finală până începe ' +
        'animația, apoi sare la început. Adaugă „backwards" sau „both".',
    })
  }
  if (/<script/i.test(html)) {
    out.push({ severity: 'warning', message: 'JavaScript nu rulează la rasterizare. Scrie rezultatul direct în markup.' })
  }
  if (/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/i.test(html)) {
    out.push({ severity: 'error', message: 'Ampersand neescapat: markup-ul trebuie să fie XHTML valid. Folosește &amp;.' })
  }
  for (const tag of ['br', 'img', 'hr', 'input']) {
    const re = new RegExp(`<${tag}(?![^>]*\\/>)[^>]*>`, 'i')
    if (re.test(html)) {
      out.push({ severity: 'error', message: `<${tag}> trebuie închis: <${tag} />. XHTML nu iartă.` })
    }
  }
  return out
}
