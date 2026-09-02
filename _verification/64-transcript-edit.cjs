// _verification/64-transcript-edit.cjs
//
// CUTTING BY READING, AND THE FOUR WAYS IT GOES WRONG QUIETLY.
//
//   1. A RESTORE THAT DOES NOT SURVIVE A SLIDER. The obvious key for a cut is
//      `from-to`. Move the silence threshold a tenth of a second and every
//      silence cut gets new boundaries, so every cut the person put back comes
//      silently back out. Their edit partially undoes itself while they watch
//      a number change. This is the assertion this suite exists for.
//
//   2. A CUT THAT LEAVES A HOLE. Cutting exactly from the first word's start
//      to the last word's end is correct arithmetic and a worse edit: the pause
//      before and the pause after become adjacent, so removing a stumble ADDS
//      a suspicious silence exactly where the stumble was.
//
//   3. A SUMMARY THAT DOUBLE-COUNTS. Adding up cut lengths over-reports the
//      moment a manual cut overlaps an automatic one — which is constantly,
//      since the first thing anyone does is cut a stumble the filler pass
//      already took half of. The number shown then disagrees with the episode.
//
//   4. A WORD STRUCK THROUGH THAT IS STILL AUDIBLE. A cut that takes half the
//      pause before a word touches that word's start. Marking it removed strikes
//      out a word the listener hears, which destroys trust in the whole display.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const Ed = require(path.join(ROOT, 'render-worker', 'dist', 'podcast', 'edit.js'))
const Ep = require(path.join(ROOT, 'render-worker', 'dist', 'podcast', 'episode.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol

/** A recording: words at 1s intervals, a long pause, a filler, two speakers. */
function fixture() {
  const w = []
  const push = (word, start, dur, speaker) =>
    w.push({ word, start: +start.toFixed(3), end: +(start + dur).toFixed(3), speaker })
  let t = 0
  for (let i = 0; i < 5; i++) { push('unu' + i, t, 0.4, 'A'); t += 0.5 }
  // A two-second pause, then a filler STANDING ALONE.
  //
  // `planTighten` only removes a filler that is isolated by more than 0.18s of
  // pause on BOTH sides, on the correct grounds that "deci" mid-sentence is a
  // real Romanian word holding a sentence together. The first version of this
  // fixture put "deci" 0.1s before the next word, so nothing cut it and six
  // assertions failed against a library that was behaving exactly as designed.
  t += 2
  push('deci', t, 0.3, 'A'); t += 0.3 + 0.4    // 0.4s of air after it
  for (let i = 0; i < 5; i++) { push('doi' + i, t, 0.4, 'A'); t += 0.5 }
  t += 1.5                                      // another pause, and a new speaker
  for (let i = 0; i < 5; i++) { push('trei' + i, t, 0.4, 'B'); t += 0.5 }
  return { words: w, duration: +(t + 1).toFixed(3) }
}

const { words, duration } = fixture()

// ── the automatic passes, and their toggles ──────────────────────────────
{
  const all = Ed.autoCuts(words, Ed.DEFAULT_SETTINGS)
  ok('the automatic pass finds something', all.length > 0, String(all.length))
  ok('...including the filler', all.some(c => c.source === 'filler'), JSON.stringify(all))
  ok('...and the long pause', all.some(c => c.source === 'silence'))

  const noFill = Ed.autoCuts(words, { ...Ed.DEFAULT_SETTINGS, removeFillers: false })
  ok('switching fillers off removes exactly those', !noFill.some(c => c.source === 'filler'))
  ok('...and leaves the silences alone', noFill.some(c => c.source === 'silence'))

  const noSil = Ed.autoCuts(words, { ...Ed.DEFAULT_SETTINGS, removeSilences: false })
  ok('switching silences off removes exactly those', !noSil.some(c => c.source === 'silence'))
  ok('...and leaves the fillers alone', noSil.some(c => c.source === 'filler'))

  ok('both off means no automatic cuts at all',
    Ed.autoCuts(words, { ...Ed.DEFAULT_SETTINGS, removeFillers: false, removeSilences: false }).length === 0)

  ok('every cut carries a key', all.every(c => typeof c.key === 'string' && c.key.length > 0))
  ok('...and the keys are unique', new Set(all.map(c => c.key)).size === all.length)

  // NEVER ZERO. A pause closed completely is what makes an automatic edit
  // audible as an automatic edit.
  ok('the default leaves a breath in a shortened pause', Ed.DEFAULT_SETTINGS.keepGap > 0.1,
    String(Ed.DEFAULT_SETTINGS.keepGap))
}

// ── 1. THE KEY SURVIVES THE SLIDER ───────────────────────────────────────
{
  // THE SETTING THAT MOVES A BOUNDARY IS `keepGap`, NOT `maxGap`.
  //
  // Worth being exact about, because the first version of this suite asserted
  // that `maxGap` moved them and failed. Reading `planTighten`: `maxGap` decides
  // WHETHER a pause is cut, and the boundaries are always `prevEnd + keepGap/2`
  // to `start - keepGap/2`. So `keepGap` is what a timestamp key cannot survive,
  // and it is a control the person has in front of them.
  const loose = { ...Ed.DEFAULT_SETTINGS, keepGap: 0.25 }
  const tight = { ...Ed.DEFAULT_SETTINGS, keepGap: 0.5 }

  const a = Ed.autoCuts(words, loose).filter(c => c.source === 'silence')
  const b = Ed.autoCuts(words, tight).filter(c => c.source === 'silence')
  ok('changing the breath left in a pause moves the cut boundaries', a.length > 0 && b.length > 0 &&
    a.some(x => !b.some(y => near(x.from, y.from) && near(x.to, y.to))),
    'the fixture does not exercise this: ' + JSON.stringify({ a, b }))

  // ...and yet the same PAUSE keeps the same key.
  const bigPause = a.reduce((m, c) => (c.to - c.from) > (m.to - m.from) ? c : m, a[0])
  const same = b.find(c => c.key === bigPause.key)
  ok('...but the same pause keeps the same key across it', Boolean(same),
    `${bigPause.key} not in ${b.map(c => c.key).join(',')}`)

  // The real thing: a restore survives.
  let edit = { settings: loose, manual: [], restored: [] }
  edit = Ed.restore(edit, bigPause)
  const beforeMove = Ed.effectiveCuts(words, edit).some(c => c.key === bigPause.key)
  const afterMove = Ed.effectiveCuts(words, { ...edit, settings: tight })
    .some(c => c.key === bigPause.key)
  ok('a restored pause stays restored before the setting moves', !beforeMove)
  ok('A RESTORED PAUSE STAYS RESTORED AFTER THE SLIDER MOVES — the whole reason ' +
     'keys are anchored to a word instead of a timestamp', !afterMove)
}

// ── 2. A MANUAL CUT CLOSES ITS OWN JOIN ──────────────────────────────────
{
  // Cut the filler, which sits between a 2s pause and a normal gap.
  const fillerIndex = words.findIndex(w => w.word === 'deci')
  ok('the fixture has a filler to cut', fillerIndex > 0)

  const cut = Ed.cutWordRange(words, fillerIndex, fillerIndex)
  const w = words[fillerIndex]
  ok('the cut starts before the word', cut.from < w.start, `${cut.from} vs ${w.start}`)
  ok('...and ends after it', cut.to > w.end)
  ok('...taking at most a quarter second of the pause in front',
    near(w.start - cut.from, 0.25, 0.001) || w.start - cut.from < 0.25,
    String(w.start - cut.from))
  ok('...and at most a quarter second behind', w.end < cut.to && cut.to - w.end <= 0.2501,
    String(cut.to - w.end))

  // A cut at the very start has no pause in front to take.
  const first = Ed.cutWordRange(words, 0, 0)
  ok('a cut on the first word does not read before the file starts', first.from >= words[0].start - 1e-9,
    `${first.from} vs ${words[0].start}`)

  // ...and one at the end has none behind.
  const last = Ed.cutWordRange(words, words.length - 1, words.length - 1)
  ok('a cut on the last word does not read past the end',
    near(last.to, words[words.length - 1].end), `${last.to}`)

  // Backwards selection is the same cut.
  const fwd = Ed.cutWordRange(words, 3, 7)
  const rev = Ed.cutWordRange(words, 7, 3)
  ok('a selection dragged backwards is the same cut',
    near(fwd.from, rev.from) && near(fwd.to, rev.to))

  // A small pause is halved rather than capped.
  const tiny = [
    { word: 'a', start: 0, end: 0.4 },
    { word: 'b', start: 0.5, end: 0.9 },   // 0.1s gap
    { word: 'c', start: 1.0, end: 1.4 },
  ]
  const mid = Ed.cutWordRange(tiny, 1, 1)
  ok('a short pause is halved, not eaten whole', near(0.5 - mid.from, 0.05),
    String(0.5 - mid.from))
}

// ── 3. THE SUMMARY DOES NOT DOUBLE-COUNT ─────────────────────────────────
{
  const settings = Ed.DEFAULT_SETTINGS
  const auto = Ed.autoCuts(words, settings)
  const filler = auto.find(c => c.source === 'filler')
  ok('there is an automatic filler cut to overlap', Boolean(filler))

  const fillerIndex = words.findIndex(w => w.word === 'deci')
  // A manual cut over the same word, deliberately overlapping.
  const manual = Ed.cutWordRange(words, fillerIndex, fillerIndex + 1)
  const edit = Ed.addCut({ settings, manual: [], restored: [] }, manual)

  const s = Ed.editSummary(words, edit, duration)
  const naive = Ed.effectiveCuts(words, edit).reduce((a, c) => a + (c.to - c.from), 0)
  ok('the naive sum over-reports when cuts overlap', naive > s.removedSeconds,
    `naive ${naive} vs distinct ${s.removedSeconds}`)

  // The number shown must match the episode that comes out.
  const built = Ep.buildEpisodeProject({
    words, cuts: Ed.asCuts(Ed.effectiveCuts(words, edit)), duration,
    sources: [{ url: 'https://x/a.mp4', kind: 'video', speaker: 'A' }],
  })
  ok('THE LENGTH SHOWN IS THE LENGTH RENDERED', near(s.keptSeconds, built.seconds, 0.4),
    `panel says ${s.keptSeconds}s, episode is ${built.seconds}s`)

  ok('kept + removed = the recording', near(s.keptSeconds + s.removedSeconds, duration, 0.01))
  ok('the counts are broken out by kind',
    s.manualCuts === 1 && s.fillerCuts >= 1 && s.silenceCuts >= 1,
    JSON.stringify(s))
}

// ── 4. ONLY REMOVED WORDS ARE STRUCK THROUGH ─────────────────────────────
{
  const settings = { ...Ed.DEFAULT_SETTINGS, removeFillers: false, removeSilences: false }
  const fillerIndex = words.findIndex(w => w.word === 'deci')
  const edit = Ed.addCut({ settings, manual: [], restored: [] },
    Ed.cutWordRange(words, fillerIndex, fillerIndex))

  const st = Ed.wordStatuses(words, edit)
  ok('the cut word is marked', st[fillerIndex] === 'manual', st[fillerIndex])
  ok('THE WORD BEFORE IT IS NOT — the cut takes half that pause and touches ' +
     'nothing audible', st[fillerIndex - 1] === 'kept', st[fillerIndex - 1])
  ok('...and neither is the word after', st[fillerIndex + 1] === 'kept', st[fillerIndex + 1])
  ok('exactly one word is removed', st.filter(x => x !== 'kept').length === 1)

  // Clicking a struck word finds the cut that removed it.
  const found = Ed.cutAtWord(words, edit, fillerIndex)
  ok('a removed word knows which cut removed it', Boolean(found))
  ok('...and restoring that cut brings it back',
    Ed.wordStatuses(words, Ed.restore(edit, found))[fillerIndex] === 'kept')
  ok('a kept word has no cut to restore', Ed.cutAtWord(words, edit, 0) === null)
}

// ── the settings are what the automatic passes read ──────────────────────
{
  const wide = Ed.autoCuts(words, { ...Ed.DEFAULT_SETTINGS, maxGap: 5 })
  ok('a very wide threshold stops cutting pauses',
    !wide.some(c => c.source === 'silence'), JSON.stringify(wide))
  // The list is an argument. Checked with a word that is not a filler anywhere,
  // placed so that it stands alone — otherwise this would be testing the
  // isolation rule rather than the list.
  const lonely = [
    { word: 'alfa', start: 0, end: 0.4 },
    { word: 'brânză', start: 1.6, end: 2.0 },
    { word: 'gamma', start: 3.2, end: 3.6 },
  ]
  const custom = Ed.autoCuts(lonely, {
    ...Ed.DEFAULT_SETTINGS, removeSilences: false, fillers: ['brânză'],
  })
  ok('the filler list is honoured, not hard-coded',
    custom.length === 1 && custom[0].source === 'filler',
    JSON.stringify(custom))
  ok('...and a word not on the list is left alone',
    Ed.autoCuts(lonely, { ...Ed.DEFAULT_SETTINGS, removeSilences: false, fillers: ['altceva'] })
      .length === 0)
}

// ── history ──────────────────────────────────────────────────────────────
{
  let h = Ed.newHistory(Ed.EMPTY_EDIT)
  ok('a fresh history cannot undo', h.past.length === 0)

  const c1 = Ed.cutWordRange(words, 1, 2)
  const c2 = Ed.cutWordRange(words, 6, 7)
  h = Ed.commit(h, Ed.addCut(h.present, c1))
  h = Ed.commit(h, Ed.addCut(h.present, c2))
  ok('two cuts are two steps', h.present.manual.length === 2)

  h = Ed.undo(h)
  ok('undo removes the last cut', h.present.manual.length === 1)
  h = Ed.undo(h)
  ok('...and again', h.present.manual.length === 0)
  h = Ed.undo(h)
  ok('undoing past the start is a no-op, not a crash', h.present.manual.length === 0)

  h = Ed.redo(h)
  ok('redo puts it back', h.present.manual.length === 1)
  h = Ed.redo(h)
  ok('...and again', h.present.manual.length === 2)
  h = Ed.redo(h)
  ok('redoing past the end is a no-op', h.present.manual.length === 2)

  // A NEW EDIT AFTER AN UNDO DISCARDS THE REDO BRANCH. Keeping it lets a person
  // redo their way into an edit that never existed.
  h = Ed.undo(h)
  h = Ed.commit(h, Ed.addCut(h.present, Ed.cutWordRange(words, 10, 11)))
  ok('a new cut after an undo clears the redo branch', h.future.length === 0)

  ok('committing the same edit twice does not grow the history', (() => {
    let g = Ed.newHistory(Ed.EMPTY_EDIT)
    g = Ed.commit(g, g.present)
    return g.past.length === 0
  })())

  ok('the history depth is capped', (() => {
    let g = Ed.newHistory(Ed.EMPTY_EDIT)
    for (let i = 0; i < 300; i++) g = Ed.commit(g, { ...g.present, restored: ['x' + i] }, 100)
    return g.past.length <= 100
  })())

  ok('adding the same cut twice is idempotent', (() => {
    const e1 = Ed.addCut(Ed.EMPTY_EDIT, c1)
    return Ed.addCut(e1, c1).manual.length === 1
  })())
  ok('dropping a manual cut removes it rather than suppressing it', (() => {
    const e1 = Ed.addCut(Ed.EMPTY_EDIT, c1)
    const e2 = Ed.restore(e1, c1)
    return e2.manual.length === 0 && e2.restored.length === 0
  })())
}

// ── paragraphs ───────────────────────────────────────────────────────────
{
  const p = Ed.paragraphs(words)
  ok('the transcript is grouped into blocks', p.length > 1, String(p.length))
  ok('a block never mixes speakers',
    p.every(b => new Set(b.indices.map(i => words[i].speaker ?? '')).size === 1))
  ok('the blocks cover every word exactly once', (() => {
    const seen = p.flatMap(b => b.indices)
    return seen.length === words.length && new Set(seen).size === words.length
  })())
  ok('the indices are in order', p.every(b => b.indices.every((v, i, a) => i === 0 || v > a[i - 1])))
  ok('THE INDICES POINT AT THE ORIGINAL LIST — a copied word cannot say which ' +
     'one it was, and the editor has to name a range to cut',
    p.every(b => b.indices.every(i => words[i] !== undefined)))
  ok('a block starts at its first word', p.every(b => near(b.start, words[b.indices[0]].start)))
  ok('a long pause breaks a block',
    p.length >= 3, `${p.length} blocks for a fixture with two long pauses`)
  ok('a very long stretch is broken up by length', (() => {
    const many = []
    for (let i = 0; i < 400; i++) many.push({ word: 'w', start: i * 0.3, end: i * 0.3 + 0.25, speaker: 'A' })
    return Ed.paragraphs(many, { maxSeconds: 20 }).length > 1
  })())
  ok('no words means no blocks', Ed.paragraphs([]).length === 0)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
