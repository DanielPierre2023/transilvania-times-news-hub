// _verification/20-reading.cjs
//
// Reading speed, which the conform pass did not handle until now.
//
// WHAT THIS EXISTS BECAUSE OF
//
// A button labelled "Corectează" was wired to conformCues and placed directly
// beside a warning reading "5 de corectat — over the 17 characters per second
// limit". Pressing it changed nothing. conformCues handled minimum duration,
// overlaps and flicker gaps; reading speed was the one rule it did not
// implement. The button was not broken — it was solving a different problem
// next to the label for this one, which is worse, because it looks fixed.
//
// So this suite asserts the thing the label promises: after conforming, the
// checker has nothing left to say about reading speed.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const fps = T.FPS.web
const sec = (s) => Math.round(s * 30)
const cps = (c) => c.text.trim().length / ((c.end - c.start) / 30)

// The real cue list off the delivered spot: seven lines, five of them too fast.
const REAL = [
  { start: sec(0.9),  end: sec(3.4),  text: 'Dimineața cineva deschide o poartă, altcineva stinge lumina.' },
  { start: sec(3.6),  end: sec(6.4),  text: 'După tura de noapte, într-o sală goală, se semnează un contract.' },
  { start: sec(6.6),  end: sec(8.6),  text: 'Nimeni nu-l citește. Nimeni, în afară de noi.' },
  { start: sec(8.9),  end: sec(12.4), text: 'De 20 de ani scriem despre locurile care nu ajung la televizor' },
  { start: sec(12.6), end: sec(15.6), text: 'și despre oamenii care le țin în picioare.' },
  { start: sec(15.9), end: sec(18.9), text: 'Transilvania Times.' },
  { start: sec(19.2), end: sec(22.1), text: 'Știrile de aici, scrise de aici.' },
]

{
  const before = T.checkCaptions(REAL, fps).filter(p => p.severity === 'error')
  const fast = before.filter(p => /per second/.test(p.message))
  ok('the real cue list really is too fast in several places', fast.length >= 3, String(fast.length))

  // 26 seconds of picture against 22 of voice — there is slack, but it is at
  // the END of the film, and the first three lines are packed 0.2s apart.
  const after = T.conformCues(REAL, fps, undefined, { tailFrames: sec(26) })
  const problems = T.checkCaptions(after, fps).filter(p => p.severity === 'error')
  const stillFast = problems.filter(p => /per second/.test(p.message))

  // THE HONEST CEILING, and it is worth stating because the first version of
  // this test asserted the wrong thing.
  //
  // Reading speed is characters over time. A cue cannot be made slower to read
  // by splitting it — that changes neither figure — and it can only be given
  // more time if there IS more time beside it. Where the voice itself delivers
  // sixty characters in two and a half seconds, no retiming fixes that; only
  // shortening the line does, and this function never touches words.
  //
  // So the promise is: strictly better, never worse, and honest about the rest.
  ok('conforming reduces the number of cues that are too fast',
    stillFast.length < fast.length, `${fast.length} -> ${stillFast.length}`)
  ok('...and introduces no other kind of error', problems.length === stillFast.length,
    JSON.stringify(problems.map(p => p.message)))
  ok('no cue is made HARDER to read than it was',
    after.every((c, i) => cps(c) <= cps(REAL[i]) + 0.01),
    after.map((c, i) => `${cps(REAL[i]).toFixed(1)}->${cps(c).toFixed(1)}`).join(' '))
  ok('every cue that had room beside it is now within the limit',
    after.filter((c, i) => i >= 3).every(c => cps(c) <= 17.001),
    after.map(c => cps(c).toFixed(1)).join(', '))
  ok('the text is untouched — this changes timing, never words',
    after.map(c => c.text).join('|') === REAL.map(c => c.text.replace(/\s+/g, ' ').trim()).join('|'))
  ok('nothing overlaps', after.every((c, i) => i === 0 || c.start >= after[i - 1].end))
  ok('nothing runs past the end of the film', after[after.length - 1].end <= sec(26))
  ok('nothing exceeds the seven-second ceiling', after.every(c => (c.end - c.start) / 30 <= 7.001))
}

// ── the shape of the fix: time is taken at the END first ─────────────────
{
  const two = [
    { start: sec(1), end: sec(2), text: 'O replică mult prea rapidă pentru a fi citită în timpul dat.' },
    { start: sec(10), end: sec(12), text: 'A doua.' },
  ]
  const after = T.conformCues(two, fps, undefined, { tailFrames: sec(20) })
  ok('a slow-to-read cue is held longer rather than shown earlier',
    after[0].end > two[0].end, `${after[0].end} vs ${two[0].end}`)
  ok('...and it is not pulled back more than half a second at the front',
    two[0].start - after[0].start <= sec(0.5) + 1, `${(two[0].start - after[0].start) / 30}s`)
}

// ── and it never steals from its neighbour ───────────────────────────────
{
  const tight = [
    { start: sec(1), end: sec(2), text: 'Prima replică, destul de lungă ca să fie prea rapidă aici.' },
    { start: sec(2.2), end: sec(4), text: 'A doua replică.' },
  ]
  const after = T.conformCues(tight, fps, undefined, { tailFrames: sec(10) })
  ok('a cue never grows into the next one', after[0].end <= after[1].start,
    `${after[0].end} vs ${after[1].start}`)
  ok('a cue with nowhere to grow is left alone rather than stretched over its neighbour',
    after[0].end - after[0].start <= sec(7))
  const left = T.checkCaptions(after, fps).filter(p => /per second/.test(p.message))
  ok('...and the checker still reports it, instead of the conform pretending it is fixed',
    left.length === 1, JSON.stringify(left.map(p => p.message)))
}

// ── the old guarantees still hold ────────────────────────────────────────
{
  const messy = [
    { start: sec(5), end: sec(5.2), text: 'Scurt.' },
    { start: sec(1), end: sec(2), text: 'Din ordine.' },
  ]
  const after = T.conformCues(messy, fps, undefined, { tailFrames: sec(30) })
  ok('cues come back in order', after[0].start < after[1].start)
  ok('a too-short cue is still lengthened', (after[0].end - after[0].start) / 30 >= 5 / 6 - 0.001)
  ok('an empty cue is still dropped',
    T.conformCues([{ start: 0, end: sec(1), text: '   ' }], fps).length === 0)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
