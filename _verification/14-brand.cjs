// _verification/14-brand.cjs
//
// The brand kit and the templates, checked by DRAWING them and reading the
// pixels back — not by asserting that the objects have the right shape.
//
// A template that returns well-formed clips which land off screen, or a rule
// that grows from its centre when it should grow from its left edge, passes
// every type check and looks wrong. So this renders real frames through the
// same compile + draw path the worker uses and samples them.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const ts = require(require.resolve('typescript', { paths: [ROOT] }))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

// ── load the TS brand module without a build step ─────────────────────────
function load(file, extra = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'brand', file), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  const req = (id) => {
    if (id === '@/lib/timeline') return T
    if (extra[id]) return extra[id]
    return require(id)
  }
  new Function('exports', 'module', 'require', js)(mod.exports, mod, req)
  return mod.exports
}
const kitMod = load('kit.ts')
const tpl = load('templates.ts', { './kit': kitMod })

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const W = 1080, H = 1920            // a vertical master, the hard case
const fps = T.FPS.web
const kit = kitMod.TT_KIT

// ── render helper ─────────────────────────────────────────────────────────
function renderAt(clips, frame, extraTracks = []) {
  let tl = T.createTimeline({ name: 'test', fps, width: W, height: H })
  const track = tl.tracks.find(t => t.kind === 'video')
  for (const c of clips) tl = T.addClip(tl, track.id, c)
  for (const c of extraTracks) tl = T.addClip(tl, track.id, c)
  tl = { ...tl, duration: Math.max(tl.duration, 200) }
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  const compiled = T.compileFrame(tl, frame)
  T.drawFrame(ctx, compiled, W, H, () => null)
  return { ctx, compiled }
}
const px = (ctx, x, y) => { const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data; return [d[0], d[1], d[2]] }
const near = (a, b, tol = 26) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
const bright = (c) => (c[0] + c[1] + c[2]) / 3 > 150
/** Leftmost x on a row whose colour is close to `want`. */
function firstX(ctx, y, want, tol = 30) {
  const row = ctx.getImageData(0, Math.round(y), W, 1).data
  for (let x = 0; x < W; x++) {
    const c = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]]
    if (near(c, want, tol)) return x
  }
  return -1
}
function lastX(ctx, y, want, tol = 30) {
  const row = ctx.getImageData(0, Math.round(y), W, 1).data
  for (let x = W - 1; x >= 0; x--) {
    const c = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]]
    if (near(c, want, tol)) return x
  }
  return -1
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const ACCENT = hex(kit.colour.accent)
const PAPER = hex(kit.colour.paper)

// ── kit ───────────────────────────────────────────────────────────────────
{
  ok('a partial kit resolves against the house default',
    kitMod.resolveKit({ name: 'X' }).type.display === kit.type.display)
  ok('...and a nested override survives the merge',
    kitMod.resolveKit({ colour: { accent: '#00FF00' } }).colour.accent === '#00FF00')
  ok('...without losing the rest of the nested object',
    kitMod.resolveKit({ colour: { accent: '#00FF00' } }).colour.paper === kit.colour.paper)
  ok('an absent kit is the house kit', kitMod.resolveKit(null).id === 'tt')

  const box = kitMod.safeBox(kit, 'tiktok')
  ok('TikTok safe area leaves the action rail alone', box.x + box.w <= 0.84, JSON.stringify(box))
  ok('...and clears the caption block at the bottom', box.y + box.h <= 0.79, JSON.stringify(box))
  ok('broadcast safe area is the EBU-style 5% inset',
    kitMod.SAFE_AREAS.broadcast.top === 0.05 && kitMod.SAFE_AREAS.broadcast.left === 0.05)

  // THE BUG THIS PREVENTS: a caption pinned at 0.88 of frame height sits under
  // TikTok's own caption block, where nobody can read it.
  ok('a caption asked for 0.88 is pulled up into the TikTok safe area',
    kitMod.captionY(kit, 0.88, 'tiktok') < 0.79, String(kitMod.captionY(kit, 0.88, 'tiktok')))
  ok('...and one already inside the safe area is left alone',
    Math.abs(kitMod.captionY(kit, 0.60, 'tiktok') - 0.60) < 1e-9)
  ok('with no safe area, the requested position is honoured',
    Math.abs(kitMod.captionY(kit, 0.88, 'none') - 0.88) < 1e-9)

  // THE DRIFT THIS PREVENTS.
  //
  // The kit was seeded into SQL by copying every value out of this file. Four
  // hours later the code changed the display face and the weight; the SQL row
  // did not, the row is loaded OVER the defaults, and the next render came back
  // set in the fallback face. A kit row now stores overrides only, so an empty
  // object must resolve to a complete, current kit.
  const empty = kitMod.resolveKit({})
  ok('an empty kit row resolves to a complete kit', empty.type.displayFamily === kit.type.displayFamily
    && empty.type.displayWeight === kit.type.displayWeight
    && empty.loudness === kit.loudness && empty.safeArea === kit.safeArea)
  ok('...and it follows the code, so it cannot go stale',
    /EB Garamond/.test(empty.type.displayFamily) && empty.type.displayWeight === 400,
    `${empty.type.displayFamily} ${empty.type.displayWeight}`)
  ok('a row that DOES override something keeps that override',
    kitMod.resolveKit({ colour: { accent: '#123456' } }).colour.accent === '#123456')
  ok('...while inheriting everything it does not mention',
    kitMod.resolveKit({ colour: { accent: '#123456' } }).type.displayFamily === kit.type.displayFamily)
  // A project's frozen copy is a FULL kit and must stay frozen — that is the
  // point of it. Adopting the current brand has to be a deliberate act.
  const frozen = kitMod.resolveKit({ type: { ...kit.type, displayFamily: 'Playfair Display, serif', displayWeight: 700 } })
  ok('a frozen project kit keeps its old face rather than being silently updated',
    frozen.type.displayFamily === 'Playfair Display, serif' && frozen.type.displayWeight === 700)

  const cs = kitMod.captionStyle(kit)
  ok('the caption style comes from the kit, not a constant', cs.size === kit.type.caption)
  ok('caption scale multiplies the kit size', kitMod.captionStyle(kit, 1.5).size === kit.type.caption * 1.5)
}

// ── title card ────────────────────────────────────────────────────────────
{
  const clips = tpl.titleCard({ kit, fps, start: 0, duration: 90 }, {
    kicker: 'Transilvania Times', title: 'Știrile care contează', sub: 'În fiecare dimineață',
  })
  ok('a title card is four elements: scrim, kicker, rule, title (+sub)', clips.length === 5, String(clips.length))
  ok('every element is a real clip with an id and a duration',
    clips.every(c => c.id && c.duration > 0 && c.source))

  const mid = renderAt(clips, 60)
  const box = kitMod.safeBox(kit)
  const ruleY = (0.52 - kit.type.display * 0.9 + kit.type.kicker * 0.4) * H

  ok('the accent rule is drawn in the accent colour', near(px(mid.ctx, box.x * W + 20, ruleY), ACCENT), String(px(mid.ctx, box.x * W + 20, ruleY)))
  const leftAtFull = firstX(mid.ctx, ruleY, ACCENT)
  ok('the rule starts at the safe-area left edge', Math.abs(leftAtFull - box.x * W) < 12, `${leftAtFull} vs ${box.x * W}`)

  // THE ONE THAT MATTERS: a rule must be DRAWN, not stretched. Early in the
  // animation it is shorter, but its left edge has not moved.
  const early = renderAt(clips, 8)
  const leftEarly = firstX(early.ctx, ruleY, ACCENT)
  const rightEarly = lastX(early.ctx, ruleY, ACCENT)
  const rightFull = lastX(mid.ctx, ruleY, ACCENT)
  ok('early in the wipe the rule is shorter', rightEarly < rightFull - 20, `${rightEarly} vs ${rightFull}`)
  ok('...and its LEFT edge has not moved — it is drawn, not stretched',
    Math.abs(leftEarly - leftAtFull) < 8, `${leftEarly} vs ${leftAtFull}`)

  // Scan the band rather than sampling two points: type is mostly gaps, and a
  // point sample lands between glyphs about as often as on one.
  const titleBand = (() => {
    for (let y = 0.44 * H; y < 0.62 * H; y += 3) {
      if (firstX(mid.ctx, y, [255, 255, 255], 70) >= 0) return Math.round(y)
    }
    return -1
  })()
  ok('the title is set in type inside its band', titleBand > 0, String(titleBand))
  // Leftmost across the WHOLE band, not on one row: a serif at 400 has thin
  // strokes, and a single scan line can slip between the leading glyph's stems.
  const titleLeft = (() => {
    let best = W
    for (let y = 0.44 * H; y < 0.66 * H; y += 2) {
      const x = firstX(mid.ctx, y, [255, 255, 255], 70)
      if (x >= 0 && x < best) best = x
    }
    return best
  })()
  ok('...starting at the safe-area left edge, not centred in the frame',
    Math.abs(titleLeft - box.x * W) < 60, `${titleLeft} vs ${box.x * W}`)
  ok('the scrim darkens the frame rather than covering it',
    px(mid.ctx, 0.5 * W, 0.05 * H)[0] < 90)
  ok('nothing is drawn outside the safe area on the left',
    firstX(mid.ctx, ruleY, ACCENT) >= box.x * W - 12)
}

// ── lower third ───────────────────────────────────────────────────────────
{
  const clips = tpl.lowerThird({ kit, fps, start: 0, duration: 100 }, { name: 'Ioana Mureșan', role: 'redactor-șef' })
  ok('a lower third is plate, bar, name and role', clips.length === 4, String(clips.length))
  const r = renderAt(clips, 70)
  const box = kitMod.safeBox(kit)
  const plateH = (kit.type.title * 0.62 + kit.type.kicker * 1.5) * 1.9
  const plateY = (box.y + box.h - kit.type.subtitle * 2.4 + kit.type.kicker * 0.6) * H

  ok('the accent bar sits at the safe-area left edge',
    near(px(r.ctx, box.x * W + 2, plateY), ACCENT, 40), String(px(r.ctx, box.x * W + 2, plateY)))
  ok('the plate is drawn behind the type', px(r.ctx, box.x * W + 60, plateY)[0] > 0)
  // Measured, not recomputed from the template's own arithmetic: find the
  // lowest accent pixel in the frame and check it clears the safe bottom.
  const lowestAccent = (() => {
    for (let y = H - 1; y > 0; y -= 2) if (firstX(r.ctx, y, ACCENT, 40) >= 0) return y
    return -1
  })()
  ok('the whole thing sits inside the vertical safe area',
    lowestAccent > 0 && lowestAccent <= (box.y + box.h) * H + 10,
    `${lowestAccent} vs ${(box.y + box.h) * H}`)
  ok('a lower third with no role drops the role clip',
    tpl.lowerThird({ kit, fps, start: 0 }, { name: 'X' }).length === 3)
}

// ── end card ──────────────────────────────────────────────────────────────
{
  const clips = tpl.endCard({ kit, fps, start: 0, duration: 90 }, {
    line: 'Abonează-te', url: 'transilvaniatimes.com',
  })
  const r = renderAt(clips, 60)
  ok('the end card fills the frame with the brand ground',
    near(px(r.ctx, 0.5 * W, 0.12 * H), PAPER, 20), String(px(r.ctx, 0.5 * W, 0.12 * H)))
  // Property, not coordinate: there is dark type somewhere on the light ground,
  // above the middle of the frame.
  let inkRow = -1
  for (let y = 0.30 * H; y < 0.60 * H; y += 2) {
    const row = r.ctx.getImageData(0, Math.round(y), W, 1).data
    for (let x = 0; x < W; x++) if (row[x * 4] < 120) { inkRow = Math.round(y); break }
    if (inkRow > 0) break
  }
  ok('the publication name is set in ink on that ground', inkRow > 0, String(inkRow))

  // And the rule: find it wherever it is, then check it is accent-coloured and
  // centred. Hard-coding its y made this test a restatement of the template.
  let accentRow = -1
  for (let y = 0.30 * H; y < 0.75 * H; y += 1) {
    if (firstX(r.ctx, y, ACCENT, 40) >= 0) { accentRow = y; break }
  }
  ok('there is an accent rule under the name', accentRow > 0, String(accentRow))
  ok('the rule sits below the name', accentRow > inkRow, `${accentRow} vs ${inkRow}`)
  ok('the rule is centred',
    accentRow > 0 && Math.abs((firstX(r.ctx, accentRow, ACCENT, 40) + lastX(r.ctx, accentRow, ACCENT, 40)) / 2 - W / 2) < 16,
    accentRow > 0 ? `${firstX(r.ctx, accentRow, ACCENT, 40)}..${lastX(r.ctx, accentRow, ACCENT, 40)}` : 'no rule')
  // The hole the first version left through the middle of the frame: the URL
  // must belong to the block, not sit on the bottom edge of the safe area.
  let lowestInk = -1
  for (let y = H - 1; y > 0; y -= 2) {
    const row = r.ctx.getImageData(0, Math.round(y), W, 1).data
    let hit = false
    for (let x = 0; x < W; x++) if (row[x * 4] < 200 && row[x * 4 + 2] < 200) { hit = true; break }
    if (hit) { lowestInk = y; break }
  }
  ok('the block holds together — nothing is stranded near the bottom edge',
    lowestInk > 0 && lowestInk < 0.72 * H, `${lowestInk} vs ${0.72 * H}`)
}

// ── typography that the old drawing code could not do ─────────────────────
{
  const plain = {
    kind: 'text', text: 'TRANSILVANIA', style: {
      family: 'Inter', size: 0.04, weight: 700, color: '#FFFFFF',
      align: 'center', lineHeight: 1.1, maxLines: 1,
    },
  }
  const tracked = { ...plain, style: { ...plain.style, letterSpacing: 0.25 } }
  const mk = (src) => ({
    id: 'c', name: 'n', source: src, start: 0, duration: 30, sourceIn: 0,
    transform: T.IDENTITY_TRANSFORM, fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  const a = renderAt([mk(plain)], 10)
  const b = renderAt([mk(tracked)], 10)
  const spanA = lastX(a.ctx, 0.5 * H, [255, 255, 255], 60) - firstX(a.ctx, 0.5 * H, [255, 255, 255], 60)
  const spanB = lastX(b.ctx, 0.5 * H, [255, 255, 255], 60) - firstX(b.ctx, 0.5 * H, [255, 255, 255], 60)
  ok('letter spacing actually spaces the letters', spanB > spanA * 1.15, `${spanB} vs ${spanA}`)
  ok('...and the tracked line stays centred',
    Math.abs((firstX(b.ctx, 0.5 * H, [255, 255, 255], 60) + lastX(b.ctx, 0.5 * H, [255, 255, 255], 60)) / 2 - W / 2) < 20)

  const long = mk({
    kind: 'text', text: 'Un titlu foarte lung care are nevoie de trei rânduri ca să încapă în cadru fără să fie tăiat',
    style: { family: 'Inter', size: 0.05, weight: 700, color: '#FFFFFF', align: 'left', lineHeight: 1.15, maxWidth: 0.7, maxLines: 3 },
  })
  const three = renderAt([long], 10)
  let rows = 0
  for (let y = 0; y < H; y += 4) if (firstX(three.ctx, y, [255, 255, 255], 60) >= 0) rows++
  ok('a title may run to three lines when the style allows it', rows > 24, String(rows))

  const two = renderAt([mk({ ...long.source, style: { ...long.source.style, maxLines: 1 } })], 10)
  let rows1 = 0
  for (let y = 0; y < H; y += 4) if (firstX(two.ctx, y, [255, 255, 255], 60) >= 0) rows1++
  ok('...and is truncated to one when it does not', rows1 < rows * 0.6, `${rows1} vs ${rows}`)
}

// ── shapes now have a size, which is what makes a rule possible ───────────
{
  const bar = {
    id: 'b', name: 'bar',
    source: { kind: 'shape', shape: 'rect', fill: kit.colour.accent, size: { w: 0.2, h: 0.01 } },
    start: 0, duration: 30, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.5 } },
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  }
  const r = renderAt([bar], 5)
  const w = lastX(r.ctx, 0.5 * H, ACCENT) - firstX(r.ctx, 0.5 * H, ACCENT)
  ok('a sized shape is drawn at its own width, not the frame width',
    Math.abs(w - 0.2 * W) < 6, `${w} vs ${0.2 * W}`)
  ok('...and is centred on its position',
    Math.abs((firstX(r.ctx, 0.5 * H, ACCENT) + lastX(r.ctx, 0.5 * H, ACCENT)) / 2 - W / 2) < 6)
  ok('a shape with no size still fills the frame',
    (() => {
      const full = renderAt([{ ...bar, source: { kind: 'shape', shape: 'rect', fill: kit.colour.accent } }], 5)
      return near(px(full.ctx, 10, 10), ACCENT)
    })())
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
