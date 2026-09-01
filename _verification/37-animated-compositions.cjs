// _verification/37-animated-compositions.cjs
//
// "Compositions are static bitmaps moved by the timeline. No text animating on
// per word, no mask reveals, no animated logo."
//
// THE MECHANISM, AND WHY IT IS NOT A CUSTOM ANIMATION SYSTEM.
//
// The author writes ordinary CSS `@keyframes` and `animation`. Before each shot
// the rasteriser pauses every animation on the page and sets its `currentTime`
// through the Web Animations API. That respects authored delays and easing
// exactly — a staggered reveal staggers, a cubic-bezier stays cubic — and it is
// deterministic to the byte, which is the property a golden frame depends on.
//
// Only the moving part is rasterised, and then it holds. A lower third is a
// reveal and then a hold; rasterising four seconds of a mostly-static block at
// 25 fps would be a hundred PNGs for one second of movement.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const R = require(path.join(ROOT, 'render-worker', 'src', 'raster.js'))
const { createCanvas, loadImage } = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas'))
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)
const workerRender = fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'render.js'), 'utf8')


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── which frame is on screen: one answer, shared ─────────────────────────
{
  const s = { frames: ['a', 'b', 'c', 'd'], frameFps: 25, url: 'held' }
  ok('frame 0 of the timeline is frame 0 of the sequence', T.frameUrlAt(s, 0, 25) === 'a')
  ok('...and it advances with the timeline', T.frameUrlAt(s, 2, 25) === 'c')
  ok('A DIFFERENT TIMELINE FPS STILL PICKS THE RIGHT FRAME',
    T.frameUrlAt(s, 3, 30) === 'c', T.frameUrlAt(s, 3, 30))
  ok('past the end it HOLDS the last frame, which is the point',
    T.frameUrlAt(s, 999, 25) === 'd')
  ok('a still composition just uses its url', T.frameUrlAt({ url: 'x' }, 40, 25) === 'x')
  ok('an empty sequence falls back rather than returning nothing',
    T.frameUrlAt({ frames: [], url: 'x' }, 0, 25) === 'x')
  ok('a negative frame does not read off the front', T.frameUrlAt(s, -5, 25) === 'a')
  ok('a sequence with no fps assumes 25 rather than dividing by zero',
    T.frameUrlAt({ frames: ['a', 'b'] }, 25, 25) === 'b')
}

// ── staleness understands a sequence ─────────────────────────────────────
{
  const html = '<div>x</div>'
  ok('a sequence counts as rasterised',
    !T.isStale({ kind: 'html', html, frames: ['a'], stamp: T.stampOf(html) }))
  ok('nothing rasterised at all is stale', T.isStale({ kind: 'html', html }))
}

// ── both halves resolve through the same helper ──────────────────────────
{
  ok('the worker asks the shared helper', /timeline\.frameUrlAt\(op\.source, op\.localFrame, fps\)/.test(workerRender))
  ok('the studio asks the same one', /frameUrlAt\(src, op\.localFrame,/.test(src))
  ok('every frame of a sequence is preloaded', /for \(const u of clip\.source\.frames \|\| \[\]\)/.test(workerRender))
  ok('a composition with neither url nor frames stops the render',
    /!\(clip\.source\.frames \|\| \[\]\)\.length/.test(workerRender))
  ok('the studio uploads the whole sequence', /Promise\.all\(\(r\.frames as string\[\]\)/.test(src))
  ok('...in parallel, because twenty round trips is what makes it feel heavy',
    /Promise\.all/.test(src))
  ok('there is a control for how long it moves', /setHtmlAnim\(/.test(src))
  ok('...and it says what it will cost in frames', /cadre, apoi ține/.test(src))
}

;(async () => {
  if (!R.findChromium()) { console.log('  SKIP: no chromium'); }
  else {
    // A staggered two-bar reveal: if the seek respected only the first
    // animation, or ignored delays, this would not stagger.
    const html = `<style>
      @keyframes slide { from { transform: translateX(-240px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
      .w { position:absolute; left:20px; width:240px; height:30px; background:#CA2222;
           animation: slide .8s cubic-bezier(.2,.7,.2,1) forwards }
      .a { top:20px } .b { top:60px; animation-delay:.4s; background:#ffffff }
    </style><div class="w a"></div><div class="w b"></div>`

    const { fps, frames } = await R.rasterHtmlFrames(html, 300, 110, { seconds: 0.8, fps: 25 })
    ok('it produces the frames asked for', frames.length === 21, String(frames.length))
    ok('...at the fps asked for', fps === 25)

    const extent = async (buf, y) => {
      const img = await loadImage(buf)
      const c = createCanvas(300, 110)
      c.getContext('2d').drawImage(img, 0, 0)
      const d = c.getContext('2d').getImageData(0, y, 300, 6).data
      let first = -1, last = -1
      for (let x = 0; x < 300; x++) { const i = x * 4; if (d[i + 3] > 40) { if (first < 0) first = x; last = x } }
      return { first, last }
    }
    const a0 = await extent(frames[0], 30)
    const a10 = await extent(frames[10], 30)
    const a20 = await extent(frames[20], 30)
    ok('THE FIRST BAR IS OFF-SCREEN AT THE START', a0.last < 0 || a0.first < 0, JSON.stringify(a0))
    ok('...on its way in by the middle', a10.first >= 0 && a10.last < 259, JSON.stringify(a10))
    ok('...and landed at the end', a20.first === 20 && a20.last === 259, JSON.stringify(a20))

    // THE STAGGER, MEASURED AGAINST THE FIRST BAR RATHER THAN AGAINST ITSELF.
    //
    // The obvious assertion — "the delayed bar has not moved yet" — is wrong, and
    // finding out why was worth the detour. With `animation-delay` an element
    // shows its NORMAL styles until the delay elapses, not the `from` keyframe.
    // So the delayed bar sits in its FINAL position for ten frames, snaps
    // off-screen the instant its animation begins, and slides back. Correct CSS,
    // looks like a glitch, and the linter now warns about it.
    const b10 = await extent(frames[10], 70)
    const b20 = await extent(frames[20], 70)
    ok('A DELAYED BAR IS STILL MOVING WHEN THE FIRST HAS LANDED — the stagger survives',
      (b20.first !== 20 || b20.last !== 259) && (a20.first === 20 && a20.last === 259),
      `delayed at end ${JSON.stringify(b20)}, first bar at end ${JSON.stringify(a20)}`)
    ok('...and it is genuinely animating, not frozen',
      JSON.stringify(b10) !== JSON.stringify(b20), `${JSON.stringify(b10)} vs ${JSON.stringify(b20)}`)

    ok('consecutive frames actually differ', Buffer.compare(frames[5], frames[6]) !== 0)

    // and the trap the stagger revealed is now caught before a render
    const warn = T.lintHtml('<style>.a{animation:slide 1s;animation-delay:.4s}</style><div class="a"/>')
    ok('a delay without a fill-mode is warned about',
      warn.some(p => p.severity === 'warning' && /fill-mode/.test(p.message)), JSON.stringify(warn))
    ok('...and adding backwards silences it',
      !T.lintHtml('<style>.a{animation:slide 1s backwards;animation-delay:.4s}</style><div class="a"/>')
        .some(p => /fill-mode/.test(p.message)))

    const again = await R.rasterHtmlFrames(html, 300, 110, { seconds: 0.8, fps: 25 })
    ok('THE WHOLE SEQUENCE IS DETERMINISTIC — a golden frame depends on it',
      frames.every((f, i) => Buffer.compare(f, again.frames[i]) === 0))

    const one = await R.rasterHtmlFrames(html, 300, 110, { seconds: 0, fps: 25 })
    ok('zero seconds is a single still, not an empty sequence', one.frames.length === 1)

    const capped = await R.rasterHtmlFrames('<div style="width:10px;height:10px;background:red"></div>',
      100, 100, { seconds: 99, fps: 25 })
    ok('an absurd duration is capped rather than rendering for a minute',
      capped.frames.length <= R.MAX_FRAMES, String(capped.frames.length))

    await R.closeBrowser()
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})()
