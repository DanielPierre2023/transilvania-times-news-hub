// lib/timeline/sync.ts
//
// Making the picture change when the sentence changes.
//
// A film assembled from equal-length shots cuts on a metronome. The voice does
// not speak on a metronome, so the cuts land mid-phrase — a shot changes while
// a clause is still finishing, the eye moves before the ear does, and the film
// feels slightly wrong in a way nobody can name. It is the single most common
// reason an assembled film reads as assembled.
//
// TWO DIRECTIONS, AND BOTH ARE NEEDED.
//
//   PICTURE → SPEECH. Given a voice that already exists, move the cuts so each
//   shot spans whole phrases. Cheap: it changes durations, nothing is
//   regenerated, and it is reversible.
//
//   SPEECH → PICTURE. Given a shot list, shape the SCRIPT so the voice breathes
//   where the film cuts. `generate-voiceover` inserts a real pause between
//   PARAGRAPHS — blank-line separated — and nowhere else, deliberately, because
//   many breaks in one generation destabilise the voice. So a script written as
//   one block gets no pauses at all, and the same script split at the cut points
//   gets a breath exactly where the picture turns over. This costs one voice
//   regeneration and is the difference between a film that is in sync and a film
//   that is in time.
//
// Nothing here guesses. Every decision is made from measured word timings.

export interface TimedWord {
  readonly word: string
  /** Seconds from the start of the voice. */
  readonly start: number
  readonly end: number
}

export interface Phrase {
  readonly start: number
  readonly end: number
  readonly text: string
  /** True when it ends on a full stop rather than a comma or a pause. */
  readonly complete: boolean
}

/**
 * Group words into phrases a cut could sit between.
 *
 * A phrase ends at punctuation, or at a silence long enough to be a breath.
 * `breath` is deliberately shorter than the sentence gap used elsewhere: a cut
 * is allowed to happen at a comma, which is a weaker boundary than a full stop
 * but still a place the ear expects something to change.
 */
export function phrases(words: readonly TimedWord[], breath = 0.28): Phrase[] {
  const out: Phrase[] = []
  let run: TimedWord[] = []
  const flush = (complete: boolean) => {
    if (!run.length) return
    out.push({
      start: run[0].start,
      end: run[run.length - 1].end,
      text: run.map(w => w.word).join(' ').replace(/\s+([.,!?;:…])/g, '$1').trim(),
      complete,
    })
    run = []
  }
  for (let i = 0; i < words.length; i++) {
    run.push(words[i])
    const w = words[i]
    const next = words[i + 1]
    const hard = /[.!?…]$/.test(w.word)
    const soft = /[,;:]$/.test(w.word)
    const gap = next ? next.start - w.end : Infinity
    if (hard || (soft && gap > breath * 0.6) || gap > breath) flush(hard)
  }
  flush(true)
  return out
}

export interface CutPlan {
  /** New shot durations, in seconds, in the original order. */
  readonly durations: number[]
  /** Per cut: how far it moved, and what it landed on. */
  readonly moves: readonly {
    readonly shot: number
    readonly fromSeconds: number
    readonly toSeconds: number
    readonly movedBy: number
    readonly landedOn: string
    readonly midWord: boolean
  }[]
  /** Total film length after the move. */
  readonly seconds: number
}

/**
 * Move each cut to the nearest phrase boundary.
 *
 * `maxMove` is the whole safety of this function. A cut that has to travel two
 * seconds to reach a phrase boundary was not nearly right; moving it that far
 * destroys a deliberate rhythm to satisfy a rule. Cuts that cannot be improved
 * within the budget are LEFT ALONE and reported, rather than dragged.
 *
 * Shots keep a minimum length, because a phrase boundary that falls half a
 * second after the previous one would otherwise produce a flash frame.
 */
export const MOVE_CAP_SECONDS = 1.5
export const MOVE_FRACTION = 0.4

export function alignCutsToSpeech(
  durations: readonly number[],
  words: readonly TimedWord[],
  { maxMove, minShot = 1.2 }: { maxMove?: number; minShot?: number } = {},
): CutPlan {
  const ph = phrases(words)
  if (ph.length === 0 || durations.length === 0) {
    return { durations: [...durations], moves: [], seconds: durations.reduce((s, d) => s + d, 0) }
  }
  // Boundaries a cut may land on: the start of every phrase, and the very end.
  const boundaries = [...ph.map(p => p.start), ph[ph.length - 1].end]
    .filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 0.05)

  const moves: CutPlan['moves'] = []
  const out: number[] = []
  let at = 0                      // where the current shot starts, after moving

  for (let i = 0; i < durations.length; i++) {
    const originalEnd = at + durations[i]
    const isLast = i === durations.length - 1
    if (isLast) { out.push(Math.max(minShot, originalEnd - at)); break }

    // THE BUDGET SCALES WITH THE SHOT, and a fixed 0.9s did not work.
    //
    // Measured on a real voice: with three equal shots over an 8.6-second read,
    // the first cut sat 1.03s from the nearest phrase boundary — so a 0.9s
    // budget moved nothing at all and the function looked like it did not work.
    // A fixed budget is wrong in both directions: 1.2s is a quarter of a
    // five-second shot and more than half of a two-second one. So it is a
    // fraction of the shot, capped, and a caller can still override it.
    const budget = maxMove ?? Math.min(MOVE_CAP_SECONDS, MOVE_FRACTION * durations[i])

    let best = originalEnd
    let bestDist = Infinity
    for (const b of boundaries) {
      const d = Math.abs(b - originalEnd)
      if (d < bestDist && d <= budget && b - at >= minShot) { best = b; bestDist = d }
    }
    const landed = ph.find(p => Math.abs(p.start - best) < 0.06)
    const midWord = words.some(w => best > w.start + 0.02 && best < w.end - 0.02)

    ;(moves as CutPlan['moves'][number][]).push({
      shot: i + 1,
      fromSeconds: originalEnd,
      toSeconds: best,
      movedBy: best - originalEnd,
      landedOn: landed ? landed.text.slice(0, 48) : '(nemutat)',
      midWord,
    })
    out.push(best - at)
    at = best
  }
  return { durations: out, moves, seconds: out.reduce((s, d) => s + d, 0) }
}

export interface SyncIssue {
  readonly shot: number
  readonly seconds: number
  readonly kind: 'midWord' | 'midPhrase' | 'orphan'
  readonly message: string
}

/**
 * Where the picture and the speech disagree, in the film as it stands.
 *
 * Reported rather than fixed, because some of these are choices. A cut in the
 * middle of a word is never a choice; a cut mid-phrase sometimes is.
 */
export function syncReport(
  durations: readonly number[],
  words: readonly TimedWord[],
): SyncIssue[] {
  const ph = phrases(words)
  const issues: SyncIssue[] = []
  let at = 0
  for (let i = 0; i < durations.length - 1; i++) {
    at += durations[i]
    const w = words.find(x => at > x.start + 0.02 && at < x.end - 0.02)
    if (w) {
      issues.push({ shot: i + 1, seconds: at, kind: 'midWord',
        message: `Tăietura ${i + 1} cade în mijlocul cuvântului „${w.word}”.` })
      continue
    }
    const inside = ph.find(p => at > p.start + 0.05 && at < p.end - 0.05)
    if (inside) {
      issues.push({ shot: i + 1, seconds: at, kind: 'midPhrase',
        message: `Tăietura ${i + 1} cade în mijlocul frazei „${inside.text.slice(0, 40)}…”.` })
    }
  }
  const spoken = words.length ? words[words.length - 1].end : 0
  const picture = durations.reduce((s, d) => s + d, 0)
  if (spoken > 0 && picture - spoken > 1.5) {
    issues.push({ shot: durations.length, seconds: picture, kind: 'orphan',
      message: `Imaginea ține ${(picture - spoken).toFixed(1)}s după ce se termină vocea.` })
  }
  if (spoken > picture + 0.4) {
    issues.push({ shot: durations.length, seconds: picture, kind: 'orphan',
      message: `Vocea depășește imaginea cu ${(spoken - picture).toFixed(1)}s — ultimele cuvinte nu au plan.` })
  }
  return issues
}

/**
 * Shape a script so the voice breathes where the film cuts.
 *
 * One paragraph per shot, blank-line separated, because that is the ONLY place
 * `generate-voiceover` inserts a pause. A script handed over as one block reads
 * straight through every cut in the film.
 *
 * `pauseMs` is returned rather than assumed: a 12-frame dissolve wants a longer
 * breath than a cut, and the caller knows which it has.
 */
export function scriptForShots(
  lines: readonly string[],
  { pauseMs = 450 }: { pauseMs?: number } = {},
): { script: string; pauseMs: number; paragraphs: number } {
  const parts = lines.map(l => l.trim()).filter(Boolean)
  return {
    script: parts.join('\n\n'),
    // Clamped to what the function accepts. Above 3s ElevenLabs refuses it, and
    // a pause that long is a hole in the film anyway.
    pauseMs: Math.max(0, Math.min(3000, Math.round(pauseMs))),
    paragraphs: parts.length,
  }
}

/** Split an existing one-block script into one line per shot, at sentence ends. */
export function splitScriptForShots(script: string, shots: number): string[] {
  const sentences = script
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
  if (shots <= 1 || sentences.length <= 1) return [script.trim()]
  if (sentences.length <= shots) return sentences

  // Spread by LENGTH, not by count: three short sentences and one long one split
  // evenly by count gives one shot twice the length of the others, which is
  // exactly the rhythm this exists to fix.
  //
  // The second condition is the one the first version was missing. Closing a
  // bucket only on "enough characters" ran out of sentences before it ran out of
  // buckets — asked for three lines it returned two, silently, and a shot went
  // without any words. A bucket may only close while enough sentences remain to
  // fill every bucket that is still open.
  const total = sentences.reduce((s, x) => s + x.length, 0)
  const target = total / shots
  const out: string[] = []
  let cur: string[] = []
  let acc = 0
  for (let i = 0; i < sentences.length; i++) {
    cur.push(sentences[i])
    acc += sentences[i].length
    const remaining = sentences.length - i - 1
    const bucketsLeft = shots - out.length - 1
    if (out.length < shots - 1 && acc >= target && remaining >= bucketsLeft) {
      out.push(cur.join(' ')); cur = []; acc = 0
    }
  }
  if (cur.length) out.push(cur.join(' '))
  // If rounding still left a bucket short, split the longest line rather than
  // returning fewer lines than shots.
  while (out.length < shots) {
    let bi = 0
    for (let i = 1; i < out.length; i++) if (out[i].length > out[bi].length) bi = i
    const parts = out[bi].split(' ')
    if (parts.length < 2) break
    const half = Math.ceil(parts.length / 2)
    out.splice(bi, 1, parts.slice(0, half).join(' '), parts.slice(half).join(' '))
  }
  return out
}
