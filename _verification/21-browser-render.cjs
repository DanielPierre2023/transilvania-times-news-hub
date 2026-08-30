// _verification/21-browser-render.cjs
//
// Three faults in the browser recorder, all reported by watching a film.
//
// The recorder captures the PREVIEW canvas in real time. That single fact
// produced all three: it recorded a guide meant only for the editor, it stopped
// at the scenes and never reached the end card, and it drove the picture off a
// different clock from the sound.
//
// The Studio page is a React component and cannot be imported here, so this
// asserts against its source — with comments stripped, so a commented-out line
// can never pass — plus the timing arithmetic, which is pure and testable.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

// ── 1 · the guide is not part of the film ─────────────────────────────────
{
  ok('the painter takes a guides flag', /function drawFrame\([^)]*guides\s*=\s*true/.test(src))
  ok('the safe-area box is drawn only when guides are on',
    /if \(guides && showSafe/.test(src))
  // It is now a dimmed mask OUTSIDE the frame, not a box drawn ON the picture.
  // A dashed rectangle sitting on the image looks like content — it was
  // reported twice, as "a strange rectangle" and as "a grid".
  ok('the guide dims what falls outside the safe area rather than drawing a box on it',
    /fillRect\(0, 0, W, y\)/.test(src) && /fillRect\(0, y \+ h, W, H - \(y \+ h\)\)/.test(src))
  ok('...and it labels itself, so it cannot be read as part of the film',
    /nu apare in film|nu apare în film/.test(raw))
  ok('the old dashed-box style is gone', !/setLineDash/.test(src))
  ok('the recorder asks for no guides',
    /drawFrame\(ctx,\s*Math\.max\(0,\s*t\),\s*false\)/.test(src))
  ok('the preview still gets them', /drawFrame\(ctx,\s*t\)\s*$/m.test(src))
}

// ── 2 · the recording runs to the end of the FILM ─────────────────────────
{
  ok('there is a film length distinct from the scene length', /const filmDur\s*=\s*useMemo/.test(src))
  ok('it accounts for the overlays', /overlays\.map\(o\s*=>\s*o\.at \+ o\.dur\)/.test(src))
  ok('the recorder stops at the film, not at the scenes',
    /if \(t >= filmDur\) \{ resolve\(\); return \}/.test(src))
  ok('...and so does the preview', /if \(t >= filmDur\) \{ stop\(\); return \}/.test(src))
  ok('nothing still ends the capture at totalDur', !/t >= totalDur/.test(src))

  // The arithmetic itself: 5 scenes of 26s with an end card at 26 for 4.
  const filmDur = (scenesDur, voDur, overlays) => {
    const total = Math.min(180, Math.max(scenesDur, voDur))
    const ends = overlays.map(o => o.at + o.dur)
    return Math.min(180, Math.max(total, ...(ends.length ? ends : [0])))
  }
  ok('an end card past the last shot extends the film',
    filmDur(26, 22, [{ at: 26, dur: 4 }]) === 30, String(filmDur(26, 22, [{ at: 26, dur: 4 }])))
  ok('an overlay inside the film does not extend it',
    filmDur(26, 22, [{ at: 2, dur: 3 }]) === 26)
  ok('with no overlays it is unchanged', filmDur(26, 22, []) === 26)
  ok('a long voice still wins over short scenes', filmDur(10, 22, []) === 22)
  ok('the 180-second ceiling still holds', filmDur(26, 22, [{ at: 170, dur: 40 }]) === 180)
}

// ── 3 · one clock ─────────────────────────────────────────────────────────
{
  ok('the recorder reads time from the audio clock',
    /const t = ac\.currentTime - t0/.test(src))
  ok('...and no longer from wall-clock inside the capture loop',
    !/setRenderPct[\s\S]{0,120}performance\.now\(\)/.test(src))
  ok('the voice and the picture now share that clock',
    /voSrc\?\.start\(t0\)/.test(src) && /ac\.currentTime - t0/.test(src))
}

// ── 4 · the deterministic render is the primary action ───────────────────
{
  const cloudBtn = src.slice(src.indexOf('onClick={renderCloud}'), src.indexOf('onClick={renderCloud}') + 400)
  ok('the cloud render is the emphasised button', /bg-brand-red/.test(cloudBtn), cloudBtn.slice(0, 120))
  const localBtn = src.slice(src.indexOf('onClick={render}'), src.indexOf('onClick={render}') + 400)
  ok('the real-time capture is secondary', !/bg-brand-red/.test(localBtn))
  ok('and the page says plainly that the browser capture can drift',
    /timp real/.test(raw) && /în urma sunetului/.test(raw))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
