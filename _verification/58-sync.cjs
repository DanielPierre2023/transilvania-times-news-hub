// _verification/58-sync.cjs
//
// Making the picture change when the sentence changes.
//
// A film cut on equal durations cuts on a metronome; the voice does not speak on
// one. The cuts land mid-phrase, the eye moves before the ear does, and the film
// reads as assembled. These assertions are all against ground truth — a word
// list with known timings — because "does this feel synchronised" cannot be
// tested and "did the cut land on a phrase boundary" can.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t

// A voice with known timings. Two sentences, a comma, and a real breath.
//   "Noi scriem despre locurile care nu ajung la televizor."   0.00 – 3.20
//   "Despre oameni, nu despre statistici."                     3.90 – 6.40
//   "Stirile de aici."                                         7.30 – 8.60
function say(text, from, wordDur = 0.30, gap = 0.06) {
  const out = []
  let t = from
  for (const w of text.split(' ')) { out.push({ word: w, start: t, end: t + wordDur }); t += wordDur + gap }
  return out
}
const words = [
  ...say('Noi scriem despre locurile care nu ajung la televizor.', 0),
  ...say('Despre oameni, nu despre statistici.', 3.9),
  ...say('Stirile de aici.', 7.3),
]
const lastEnd = words[words.length - 1].end

// ── phrases ──────────────────────────────────────────────────────────────
{
  const ph = T.speechPhrases(words)
  ok('phrases are found', ph.length >= 3, ph.length)
  ok('a full stop ends a phrase', ph.some(p => p.complete && /televizor\./.test(p.text)))
  ok('A COMMA CAN END A PHRASE TOO — a cut is allowed at a comma, which is a ' +
     'weaker boundary than a full stop and still a place the ear expects change',
    ph.some(p => /oameni,/.test(p.text)))
  ok('...but a comma phrase is not marked complete',
    ph.filter(p => /oameni,$/.test(p.text)).every(p => !p.complete))
  ok('every phrase has a real span', ph.every(p => p.end > p.start))
  ok('phrases are in order', ph.every((p, i) => i === 0 || p.start >= ph[i - 1].start))
  ok('no phrase starts inside a word', ph.every(p =>
    words.some(w => near(w.start, p.start, 0.001))))
  ok('an empty voice yields no phrases', T.speechPhrases([]).length === 0)
}

// ── the report: where picture and speech disagree ────────────────────────
{
  // Three equal shots over an 8.6s voice: cuts at 2.87 and 5.73 — both inside
  // speech.
  const equal = [2.8667, 2.8667, 2.8666]
  const issues = T.syncReport(equal, words)
  ok('EQUAL SHOTS OVER A REAL VOICE PRODUCE SYNC PROBLEMS — this is the ' +
     'metronome cut, and it is the default every film starts with',
    issues.length > 0, JSON.stringify(issues.map(i => i.kind)))
  ok('...and each one names the shot and what it lands on',
    issues.every(i => i.shot > 0 && i.message.length > 20))
  ok('a cut inside a word is reported as such',
    issues.some(i => i.kind === 'midWord') || issues.some(i => i.kind === 'midPhrase'))

  // Cuts placed exactly on phrase starts should be clean.
  const ph = T.speechPhrases(words)
  const clean = [ph[1].start, ph[2].start - ph[1].start, lastEnd - ph[2].start]
  const cleanIssues = T.syncReport(clean, words).filter(i => i.kind !== 'orphan')
  ok('CUTS ON PHRASE BOUNDARIES PRODUCE NO PROBLEMS — so the report is not ' +
     'simply always complaining', cleanIssues.length === 0,
    JSON.stringify(cleanIssues))

  ok('picture running long after the voice is reported',
    T.syncReport([lastEnd + 4], words).some(i => i.kind === 'orphan'))
  ok('...and so is a voice that outruns the picture',
    T.syncReport([2], words).some(i => /nu au plan/.test(i.message)))
  ok('a film with no voice reports nothing', T.syncReport([3, 3], []).length === 0)
}

// ── moving the cuts ──────────────────────────────────────────────────────
{
  const equal = [2.8667, 2.8667, 2.8666]
  const plan = T.alignCutsToSpeech(equal, words)
  ok('every shot is still there', plan.durations.length === equal.length)
  ok('every duration is positive', plan.durations.every(d => d > 0))
  ok('THE CUTS MOVED', plan.moves.some(m => Math.abs(m.movedBy) > 0.05),
    JSON.stringify(plan.moves.map(m => m.movedBy.toFixed(2))))
  ok('NO CUT LANDS INSIDE A WORD AFTERWARDS', plan.moves.every(m => !m.midWord),
    JSON.stringify(plan.moves.filter(m => m.midWord)))
  ok('...and the film is measurably better synchronised than it was', (() => {
    const before = T.syncReport(equal, words).filter(i => i.kind !== 'orphan').length
    const after = T.syncReport(plan.durations, words).filter(i => i.kind !== 'orphan').length
    return after < before
  })())
  ok('every move is explained — which shot, how far, onto what',
    plan.moves.every(m => m.shot > 0 && typeof m.movedBy === 'number' && m.landedOn.length > 0))

  ok('A CUT THAT WOULD HAVE TO TRAVEL TOO FAR IS LEFT ALONE — a cut two seconds ' +
     'from a boundary was not nearly right, and dragging it destroys a rhythm ' +
     'somebody chose', (() => {
      // A cut at 5.0 is 1.1s from the nearest boundary (3.9) and 2.3 from 7.3.
      const plan2 = T.alignCutsToSpeech([5.0, 3.6], words, { maxMove: 0.4 })
      return Math.abs(plan2.moves[0].movedBy) < 0.001
    })())
  ok('...and moving it is possible when the budget allows', (() => {
    const plan3 = T.alignCutsToSpeech([4.1, 4.5], words, { maxMove: 0.5 })
    return Math.abs(plan3.moves[0].movedBy) > 0.05
  })())
  // The guarantee is about MOVES, not about the input. An already-short shot is
  // left as it is — inventing length for it would be a different edit than the
  // one that was asked for.
  ok('A MOVE NEVER CREATES A SHOT BELOW THE MINIMUM — a boundary half a second ' +
     'after the last one would otherwise make a flash frame', (() => {
      const plan = T.alignCutsToSpeech([1.0, 1.0, 6.6], words, { minShot: 1.5 })
      return plan.moves.every((m, i) => Math.abs(m.movedBy) < 1e-9 || plan.durations[i] >= 1.5 - 1e-9)
    })())
  ok('...and an already-short shot is left alone rather than stretched',
    T.alignCutsToSpeech([1.0, 1.0, 6.6], words, { minShot: 1.5 }).durations[0] === 1.0)
  ok('the move budget scales with the shot, so it works on long and short ones',
    T.MOVE_CAP_SECONDS === 1.5 && T.MOVE_FRACTION === 0.4)
  ok('a single-shot film is left alone', T.alignCutsToSpeech([8], words).moves.length === 0)
  ok('no voice means no change',
    T.alignCutsToSpeech([3, 3], []).durations.join(',') === '3,3')
}

// ── shaping the script so the voice breathes at the cuts ─────────────────
{
  const lines = [
    'Noi scriem despre locurile care nu ajung la televizor.',
    'Despre oameni, nu despre statistici.',
    'Stirile de aici.',
  ]
  const r = T.scriptForShots(lines)
  ok('ONE PARAGRAPH PER SHOT — blank-line separated, because that is the ONLY ' +
     'place generate-voiceover inserts a pause',
    r.script.split(/\n\s*\n/).length === 3, JSON.stringify(r.script))
  ok('...and it reports how many paragraphs, so the caller can check', r.paragraphs === 3)
  ok('a pause length is returned rather than assumed', r.pauseMs > 0)
  ok('the pause is clamped to what the service accepts',
    T.scriptForShots(lines, { pauseMs: 99999 }).pauseMs === 3000)
  ok('a zero pause is honoured', T.scriptForShots(lines, { pauseMs: 0 }).pauseMs === 0)
  ok('empty lines are dropped rather than becoming empty paragraphs',
    T.scriptForShots(['a', '', '  ', 'b']).paragraphs === 2)
}

// ── splitting a one-block script ─────────────────────────────────────────
{
  const script = 'Prima propozitie foarte lunga despre locurile de aici si oamenii lor. ' +
    'A doua. A treia scurta. A patra propozitie care este iarasi destul de lunga.'
  const parts = T.splitScriptForShots(script, 3)
  ok('a one-block script splits into one line per shot', parts.length === 3, parts.length)
  ok('nothing is lost in the split',
    parts.join(' ').replace(/\s+/g, ' ') === script.replace(/\s+/g, ' '))
  ok('THE SPLIT IS BY LENGTH, NOT BY SENTENCE COUNT — three short sentences and ' +
     'one long one split evenly by count gives one shot twice the length of the ' +
     'others, which is exactly the rhythm this is meant to fix', (() => {
      const lens = parts.map(p => p.length)
      return Math.max(...lens) / Math.min(...lens) < 3
    })(), JSON.stringify(parts.map(p => p.length)))
  ok('asking for one shot returns the whole script',
    T.splitScriptForShots(script, 1).length === 1)
  ok('a single sentence cannot be split further',
    T.splitScriptForShots('Doar una.', 4).length === 1)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
