// _verification/16-layers.cjs
//
// The grade belongs to the PICTURE, not to the titles.
//
// The house look is applied over the assembled cut. Applied over the whole
// composite it also lands on the graphics, and a warm look at 0.85 turns white
// type cream and pulls the accent off its own value — at which point the brand
// red is not the brand red and the kit is decoration. Broadcast practice is to
// grade the picture and lay graphics over it ungraded.
//
// This renders a real film with a known grey picture and a known white graphic
// and measures both: the picture must move, the graphic must not.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const { renderTimeline } = require(path.join(ROOT, 'render-worker', 'src', 'render.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const W = 320, H = 240

/** A grey picture, and a white bar across the middle on a graphics track. */
async function render(look, withGraphic) {
  const fps = T.FPS.web
  let tl = T.createTimeline({ name: 'layers', fps, width: W, height: H })
  const pic = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, pic.id, {
    id: 'bg', name: 'picture',
    source: { kind: 'shape', shape: 'rect', fill: '#808080' },
    start: 0, duration: 20, sourceIn: 0,
    transform: T.IDENTITY_TRANSFORM, fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  if (withGraphic) {
    const gfx = T.emptyTrack('video', 'Titluri', 20)
    tl = { ...tl, tracks: [...tl.tracks, gfx] }
    tl = T.addClip(tl, gfx.id, {
      id: 'bar', name: 'graphic',
      source: { kind: 'shape', shape: 'rect', fill: '#FFFFFF', size: { w: 0.5, h: 0.3 } },
      start: 0, duration: 20, sourceIn: 0,
      transform: { ...T.IDENTITY_TRANSFORM, position: { x: 0.5, y: 0.5 } },
      fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
    })
  }
  tl = {
    ...tl, duration: 20,
    delivery: { loudness: 'none', codec: 'h264', captions: [], grade: { look, strength: 1 } },
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layers-'))
  const out = path.join(dir, 'f.mp4')
  const res = await renderTimeline(tl, { workDir: dir, output: out, onProgress: () => {} })
  const png = path.join(dir, 'g.png')
  execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-frames:v', '1', png, '-y'])
  const img = await loadImage(png)
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const at = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]] }
  const sample = { centre: at(W / 2, H / 2), corner: at(12, 12), frames: res.frames }
  fs.rmSync(dir, { recursive: true, force: true })
  return sample
}

;(async () => {
  const warm = await render('golden', true)
  const cast = (c) => c[0] - c[2]          // red minus blue: positive is warm

  ok('the picture is graded warm', cast(warm.corner) > 12,
    `corner ${warm.corner.join(',')} cast ${cast(warm.corner)}`)
  ok('the graphic over it is NOT graded — white stays white', Math.abs(cast(warm.centre)) <= 6,
    `centre ${warm.centre.join(',')} cast ${cast(warm.centre)}`)
  ok('...and it is still the white it was authored as, not merely neutral',
    warm.centre.every(v => v > 235), warm.centre.join(','))
  ok('the split did not cost or add frames', warm.frames === 20, String(warm.frames))

  // With no grade there is nothing to protect from, so the renderer must fall
  // back to the single pass — and produce the same graphic.
  const plain = await render('none', true)
  ok('with no grade the graphic is unchanged', plain.centre.every(v => v > 235), plain.centre.join(','))
  ok('...and the picture is left alone too', Math.abs(cast(plain.corner)) <= 6, plain.corner.join(','))
  ok('frame count is the same on both paths', plain.frames === warm.frames)

  // A film with no graphics must not pay for a second encode at all.
  const noGfx = await render('golden', false)
  ok('a film with no graphics still grades its picture', cast(noGfx.corner) > 12, noGfx.corner.join(','))

  // The layer rule itself, so nobody quietly moves captions into the picture.
  ok('captions count as graphics', T.GRAPHICS_Z === 10 && T.isGraphic({ z: 10 }))
  ok('titles count as graphics', T.isGraphic({ z: 20 }))
  ok('the picture track does not', !T.isGraphic({ z: 0 }))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
