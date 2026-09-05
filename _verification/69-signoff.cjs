// _verification/69-signoff.cjs
//
// THE BULLETIN THAT ENDED ON "La reveder—".
//
// The composed bulletin cut the presenter's closing sentence — "La revedere" —
// a hair before it finished, every time. It was not the voice, not the file,
// not the outro card. It was one line in the compose loop, and it is the same
// mistake this project keeps meeting in different clothes: TRUSTING A NUMBER
// INSTEAD OF THE THING THE NUMBER STANDS FOR.
//
//   The loop ended the content phase at `v.currentTime >= dur - 0.05`. `dur` is
//   the real media duration, so that clause trips ~50 ms BEFORE the element's
//   own `ended` event — the clip was never allowed to play its last 50 ms.
//
//   Worse, the very next frame ran `v.pause()`, which hard-gated the final
//   syllable with no ring-out: the compressor's 0.25 s release and the natural
//   decay of "revedere" were chopped mid-air. So it SOUNDED cut by much more
//   than the 50 ms actually missing, and the outro that followed carried the
//   music bed but no voice.
//
// THE FIX, AND WHAT THIS SUITE HOLDS IN PLACE.
//
//   1. The content phase ends on the media's OWN `ended` signal. The numeric
//      `dur - 0.05` survives ONLY as a stall guard — parked at the very end AND
//      not advancing for half a second — never as the thing that ends a clip
//      that is still playing.
//   2. A TAIL_PAD holds the last frame with the presenter STILL UNPAUSED, so
//      the last word and its decay flush into the recording.
//   3. Only after that pad does the loop pause the presenter and start the outro.
//
// The grep checks below bind those three to the real source in page.tsx. The
// executable model at the end shows, in arithmetic, WHY it matters: the old
// rule stops the audio before the clip ends; the new rule does not.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const pageRaw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'newsroom', 'page.tsx'), 'utf8')
// Strip comments the way the other page.tsx suites do: block comments first,
// then line comments — but NEVER the `//` in a URL (`https://`), hence the
// `[^:]` guard. The fix is DOCUMENTED with a comment that quotes the old
// `v.pause()` and `dur - 0.05`, so a check that read the comments would pass on
// the prose alone. It has to read the code.
const page = pageRaw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

// ── the end is keyed on the MEDIA, not on a number ────────────────────────
ok('the loop tracks a media-ended moment distinct from the outro start',
  /let mediaEndedAt = 0/.test(page) && /let contentEndedAt = 0/.test(page),
  'mediaEndedAt / contentEndedAt are no longer two separate moments')

ok('THE CONTENT PHASE ENDS ON THE ELEMENT\'S OWN `ended` SIGNAL',
  /if \(v\.ended \|\| stalledAtEnd\) mediaEndedAt = t/.test(page),
  'the media-end trigger no longer keys on v.ended')

ok('...and `dur - 0.05` is now only a STALL guard, not an early cut',
  /const stalledAtEnd = mt >= dur - 0\.05 && \(t - lastAdvance\) > 0\.5/.test(page),
  'dur - 0.05 is not gated behind a no-advance check — it can still cut a playing clip early')

ok('THE OLD EARLY-CUT LINE IS GONE — the one that ended content at dur - 0.05',
  !/>= dur - 0\.05\) contentEndedAt = t/.test(page),
  'the loop still sets contentEndedAt directly from dur - 0.05')

// ── the sign-off is allowed to ring out ───────────────────────────────────
const tailMatch = page.match(/const TAIL_PAD = (\d*\.?\d+)/)
ok('a TAIL_PAD is declared', !!tailMatch, 'no TAIL_PAD — the sign-off has no room to finish')
const tailPad = tailMatch ? Number(tailMatch[1]) : 0
ok('...and it is a real pad (>= 0.2 s), enough for the compressor release + decay',
  tailPad >= 0.2, `TAIL_PAD = ${tailPad}`)

ok('there is a TAIL phase between media-end and the outro',
  /else if \(t - mediaEndedAt < TAIL_PAD\)/.test(page),
  'the outro starts the instant the media ends — no room for the last word')

// The tail must NOT pause the presenter — pausing there is the original bug.
{
  const tailAt = page.indexOf('t - mediaEndedAt < TAIL_PAD')
  const afterTail = page.indexOf('} else {', tailAt)
  const tailBody = tailAt >= 0 && afterTail > tailAt ? page.slice(tailAt, afterTail) : ''
  ok('the tail HOLDS the last content frame', /drawContent\(/.test(tailBody),
    'the tail phase does not redraw the content frame')
  ok('THE TAIL DOES NOT PAUSE THE PRESENTER — that pause is what cut the sign-off',
    tailBody.length > 0 && !/v\.pause\(/.test(tailBody),
    'v.pause() is back inside the tail phase')
}

// The pause is deferred to the outro branch and happens exactly once.
ok('the presenter is paused only when the outro begins, guarded so it fires once',
  /if \(!contentEndedAt\) \{ contentEndedAt = t; v\.pause\(\) \}/.test(page),
  'v.pause() is no longer guarded behind the outro start')

ok('no branch pauses the presenter as its first act on end',
  !/else\s*\{\s*v\.pause\(\)/.test(page),
  'a bare v.pause() reappeared as the first statement of the end branch')

// ── the ceiling and the outro resolution still hold ───────────────────────
ok('the hard ceiling accounts for the added tail',
  /const HARD_STOP = INTRO \+ dur \+ TAIL_PAD \+ OUTRO \+ 30/.test(page),
  'HARD_STOP no longer includes TAIL_PAD')

ok('the render still resolves a full OUTRO after the outro begins',
  /if \(contentEndedAt && t - contentEndedAt >= OUTRO\) \{ resolve\(\); return \}/.test(page),
  'the outro duration is no longer honoured')

// ── the mechanism, as arithmetic ──────────────────────────────────────────
//
// A model of the loop's END decision — not the loop itself, but the exact rule
// that decided when to stop feeding the presenter audio to the recorder. The
// true end of the audio is `dur`. We measure how much of it each rule captures.
function capturedUntil(mode, dur) {
  const FPS = 60, frame = 1 / FPS
  let lastMt = -1, lastAdvance = 0, mediaEnded = 0, captured = 0
  for (let f = 0; f <= Math.ceil((dur + 2) * FPS); f++) {
    const t = f * frame
    const mt = Math.min(t, dur)                 // media clock, capped at the true end
    if (mt > lastMt + 1e-3) { lastMt = mt; lastAdvance = t }
    const ended = mt >= dur                      // the element's own end-of-play
    if (mode === 'old') {
      // ends at dur - 0.05, next frame pauses → nothing past here is captured
      if (mt >= dur - 0.05) { captured = mt; break }
      captured = mt
    } else {
      const stalledAtEnd = mt >= dur - 0.05 && (t - lastAdvance) > 0.5
      if (!mediaEnded) {
        captured = mt
        if (ended || stalledAtEnd) mediaEnded = t
      } else if (t - mediaEnded < 0.4) {
        captured = dur                           // the tail pad captures through the end
      } else break
    }
  }
  return captured
}

{
  const dur = 12.0
  const oldCap = capturedUntil('old', dur)
  const newCap = capturedUntil('new', dur)
  ok('THE OLD RULE STOPPED THE AUDIO BEFORE THE CLIP ENDED — "La reveder—"',
    dur - oldCap > 0.02, `old captured to ${oldCap.toFixed(3)} of ${dur}`)
  ok('THE NEW RULE CAPTURES THE AUDIO THROUGH TO THE VERY END',
    Math.abs(newCap - dur) < 1e-6, `new captured to ${newCap.toFixed(3)} of ${dur}`)
  ok('...so the new rule keeps strictly more of the sign-off than the old one',
    newCap > oldCap, `${newCap} vs ${oldCap}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
