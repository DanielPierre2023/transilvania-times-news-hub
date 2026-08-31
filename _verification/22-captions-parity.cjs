// _verification/22-captions-parity.cjs
//
// The preview and the file must draw the same captions.
//
// They did not. The preview had its own subtitle painter: uppercase, sized off
// frame HEIGHT, a rounded plate, two lines maximum. The file got the kit's
// caption style: mixed case, sized off the SHORT edge, a square plate, clamped
// into the safe area. On a 9:16 master that is 69 px against 49 px — the
// preview was showing captions forty per cent larger than the ones being
// delivered, which is precisely the "the subtitles are too big" note from the
// very first film. It was fixed in the renderer and left standing in the
// preview, so it kept being true of the thing people actually look at.
//
// Karaoke was worse than a mismatch. The renderer ignored the word timings and
// drew plain text, so it was a mode you could select, watch working, and never
// receive.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── the preview no longer has a subtitle painter of its own ──────────────
{
  ok('nothing upper-cases a cue for drawing', !/cue\.text\.toUpperCase\(\)/.test(src))
  ok('no caption font is sized off frame height', !/H \* 0\.03[26] \* subScale/.test(src))
  ok('the karaoke painter is gone', !/w\.word\.toUpperCase\(\)/.test(src))
  ok('...and so is the grouping only it used', !/chars > 26/.test(src))
  // Superseded, and by something stronger. This used to assert that captions
  // were built into an overlay-only timeline the preview drew alongside its own
  // hand-painted picture. There is no overlay-only timeline any more: the
  // preview compiles the SAME timeline the renderer is handed, captions and all.
  ok('captions come from the kit, through the one timeline',
    /captionStyle\(kit, subScale\)/.test(src) && /compileFrame\(filmTl, f\)/.test(src))
  ok('...and there is no separate overlay pass left to drift', !/overlayTl/.test(src))
  ok('and clamped into the safe area there', /captionY\(kit, SUB_POS\[subPos\]\)/.test(src))
}

// ── the third caption path: the hosted-provider spec ─────────────────────
//
// There were not two caption painters, there were three. The preview, our own
// worker, and buildCloudSpec — the Creatomate-shaped export used when the
// provider is not our worker. That one carried Inter 700, its own plate colour
// and an unclamped Y, sized off frame HEIGHT: 61 px on a 1080x1920 master
// against the 49 px everything else draws. A film sent to a hosted provider
// matched neither of the other two.
{
  const spec = src.slice(src.indexOf('function buildCloudSpec'))
                  .slice(0, src.slice(src.indexOf('function buildCloudSpec')).indexOf('\n  }\n'))
  ok('the hosted spec exists to be checked', spec.length > 200)
  ok('its captions take the kit style', /captionStyle\(kit, subScale\)/.test(spec))
  ok('...clamped into the safe area like everything else', /captionY\(kit, SUB_POS\[subPos\]\)/.test(spec))
  ok('...and sized off the SHORT edge, so 9:16 and 16:9 agree',
    /Math\.min\(W, H\)/.test(spec) && /shortEdge \* capStyle\.size/.test(spec))
  ok('no hard-coded family, weight, colour or plate survives there',
    !/font_family: 'Inter'/.test(spec) && !/font_weight: '700'/.test(spec) &&
    !/fill_color: '#ffffff'/.test(spec) && !/rgba\(21,11,6/.test(spec))
}

// ── karaoke is now real in the renderer ──────────────────────────────────
{
  const draw = fs.readFileSync(path.join(ROOT, 'lib', 'timeline', 'draw.ts'), 'utf8')
  ok('the shared drawer implements karaoke', /function drawKaraoke/.test(draw))
  ok('...and drawText hands off to it when a clip carries word timings',
    /if \(source\.words && source\.words\.length\)/.test(draw))
  ok('an op knows how far into its own clip it is', /localFrame/.test(draw))
}

// ── and it actually paints differently over time ─────────────────────────
{
  const W = 540, H = 960
  const style = {
    family: 'Inter', size: 0.045, weight: 600, color: '#FFFFFF',
    align: 'center', lineHeight: 1.2, background: 'rgba(0,0,0,0.55)',
    activeColor: '#CA2222', pendingColor: 'rgba(255,255,255,0.35)',
  }
  const words = [
    { word: 'Dimineața', start: 0, end: 8 },
    { word: 'cineva', start: 9, end: 16 },
    { word: 'deschide', start: 17, end: 26 },
  ]
  const clip = {
    id: 'c', name: 'cap',
    source: { kind: 'text', text: 'Dimineața cineva deschide', style, words },
    start: 0, duration: 30, sourceIn: 0,
    transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.8 } },
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  }
  let tl = T.createTimeline({ name: 'k', fps: T.FPS.web, width: W, height: H })
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, track.id, clip)
  tl = { ...tl, duration: 30 }

  const at = (frame) => {
    const c = createCanvas(W, H)
    const ctx = c.getContext('2d')
    T.drawFrame(ctx, T.compileFrame(tl, frame), W, H, () => null)
    const d = ctx.getImageData(0, Math.round(0.8 * H) - 6, W, 12).data
    let red = 0, white = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 130 && d[i + 1] < 90 && d[i + 2] < 90) red++
      if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) white++
    }
    return { red, white }
  }

  const early = at(3), mid = at(12), late = at(22)
  ok('the word being spoken is picked out in the accent colour', early.red > 0, JSON.stringify(early))
  ok('the highlight MOVES as the line is spoken',
    early.red > 0 && mid.red > 0 && late.red > 0 &&
    !(early.red === mid.red && mid.red === late.red),
    `${early.red} ${mid.red} ${late.red}`)
  ok('words already spoken are drawn in the full caption colour', late.white > 0, JSON.stringify(late))

  // Without word timings the same clip must draw as a plain caption.
  let plain = T.createTimeline({ name: 'p', fps: T.FPS.web, width: W, height: H })
  const pt = plain.tracks.find(t => t.kind === 'video' && t.z === 0)
  plain = T.addClip(plain, pt.id, { ...clip, source: { kind: 'text', text: 'Dimineața cineva deschide', style } })
  plain = { ...plain, duration: 30 }
  const pc = createCanvas(W, H)
  const pctx = pc.getContext('2d')
  T.drawFrame(pctx, T.compileFrame(plain, 12), W, H, () => null)
  const pd = pctx.getImageData(0, Math.round(0.8 * H) - 6, W, 12).data
  let predOnly = 0
  for (let i = 0; i < pd.length; i += 4) if (pd[i] > 130 && pd[i + 1] < 90 && pd[i + 2] < 90) predOnly++
  ok('a caption with no word timings has no highlight at all', predOnly === 0, String(predOnly))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
