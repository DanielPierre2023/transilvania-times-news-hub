// lib/timeline/podcast.ts
//
// A two-hour recording becomes a published episode and a dozen social clips.
//
// FOUR SEPARATE PROBLEMS WEAR ONE NAME.
//
//   1. Whisper takes 25 MB. An hour of stereo audio is far more than that, so a
//      podcast cannot be transcribed by handing it to the same edge function a
//      thirty-second voice-over uses. It has to be split, transcribed in parts,
//      and the timestamps of every part after the first shifted back into the
//      whole — which is the step that silently ruins everything downstream if
//      it is missed, because each part's timestamps start again at zero.
//
//   2. Two cameras and two microphones are four files that must agree about
//      what time it is. They start when their operator pressed record, so they
//      do not agree, and no amount of careful cutting fixes a half-second
//      offset. Alignment is measured from the audio, not assumed.
//
//   3. Nobody wants the silences, the false starts or the "ummm". Removing
//      them is easy to do badly: cut every pause and two people sound like they
//      are interrupting each other, which is worse than the pauses.
//
//   4. A clip for social is not an excerpt. An excerpt starts where the
//      speaker started; a clip starts where the LISTENER would start caring,
//      which is usually mid-sentence, and ends on a landing rather than at the
//      moment the thought is finished.
//
// Everything here is pure: words and timings in, decisions out. Nothing fetches,
// nothing renders. That is what lets the whole thing be tested against ground
// truth rather than judged by ear.

export interface Word {
  readonly word: string
  /** Seconds from the start of the WHOLE recording. */
  readonly start: number
  readonly end: number
  /** Which microphone this word came from, once speakers are assigned. */
  readonly speaker?: string
}

export interface Segment {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly speaker?: string
}

// ── 1 · chunking for transcription ───────────────────────────────────────

/** Whisper's hard limit. Chunks are sized well under it, in seconds of audio. */
export const WHISPER_MAX_BYTES = 25 * 1024 * 1024

export interface Chunk {
  readonly index: number
  readonly start: number
  readonly seconds: number
  /** Seconds of the previous chunk repeated at the head of this one. */
  readonly overlap: number
}

/**
 * Split a long recording into transcribable chunks.
 *
 * The overlap is not padding. A cut through the middle of a word gives that
 * word to neither chunk, and a transcript that quietly drops a word every ten
 * minutes is very hard to notice and impossible to trust. Each chunk after the
 * first therefore repeats the last few seconds of the one before, and the
 * duplicated words are removed when the parts are stitched.
 */
export function planChunks(
  totalSeconds: number,
  { chunkSeconds = 600, overlapSeconds = 5 }: { chunkSeconds?: number; overlapSeconds?: number } = {},
): Chunk[] {
  if (totalSeconds <= 0) return []
  if (totalSeconds <= chunkSeconds) return [{ index: 0, start: 0, seconds: totalSeconds, overlap: 0 }]

  const out: Chunk[] = []
  let start = 0
  let i = 0
  while (start < totalSeconds) {
    const overlap = i === 0 ? 0 : overlapSeconds
    const from = Math.max(0, start - overlap)
    const seconds = Math.min(chunkSeconds + overlap, totalSeconds - from)
    out.push({ index: i, start: from, seconds, overlap })
    start = from + seconds
    i++
    if (seconds <= 0) break
  }
  return out
}

/**
 * Stitch chunk transcripts into one, shifting timestamps and dropping overlap.
 *
 * THE SHIFT IS THE WHOLE THING. Whisper timestamps every chunk from zero. Paste
 * the parts together without adding each chunk's own start and every word after
 * the first ten minutes is wrong by a growing amount — captions drift, clips
 * are cut from the wrong place, and the transcript still reads perfectly.
 */
export function stitch(parts: readonly { chunk: Chunk; words: readonly Word[] }[]): Word[] {
  const out: Word[] = []
  for (const { chunk, words } of parts) {
    for (const w of words) {
      const start = w.start + chunk.start
      const end = w.end + chunk.start
      // Drop words that fall inside the repeated head of this chunk; the
      // previous chunk already contributed them, with better context.
      if (chunk.overlap > 0 && start < chunk.start + chunk.overlap - 0.01) continue
      out.push({ ...w, start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// ── 2 · aligning several recorders ───────────────────────────────────────

/**
 * Below this, do not sync two recorders automatically — ask instead.
 *
 * Measured, not chosen: eight different noise pairs that genuinely share
 * nothing scored between 0.003 and 0.102, while a correctly aligned pair scored
 * 0.273 and an identical pair 0.312. 0.15 sits in the gap with room on both
 * sides. An automatic sync that is wrong is worse than no automatic sync,
 * because nobody re-checks a job the tool said it had done.
 */
export const SYNC_CONFIDENCE_MIN = 0.15

export interface Alignment {
  /**
   * How much LATER track B's content is than track A's.
   *
   * Positive means B's operator pressed record first / B lags — the same event
   * appears this many seconds further into B. Negative means the opposite.
   */
  readonly bLaterBySeconds: number
  /** Add this to every timestamp in B to line it up with A. The negation of the above. */
  readonly shiftBBySeconds: number
  /** Kept as the plain name; identical to `bLaterBySeconds`. */
  readonly offsetSeconds: number
  /** 0 when the two files share nothing. Below ~0.15, do not sync automatically. */
  readonly confidence: number
}

/**
 * Line up two recorders.
 *
 * TWO NAMES, ON PURPOSE. A single "offset" is the classic sign-convention trap:
 * every reader is equally sure it means the opposite of what the writer meant,
 * and getting it backwards doubles the error instead of removing it — an
 * episode two cameras out of sync by twice the real amount, with no error
 * anywhere. So the result says which track is late AND what to add to fix it.
 *
 * Cross-correlation of two loudness envelopes, not of samples. Two microphones
 * in one room record genuinely different signals — a lapel on each speaker
 * hears mostly its own — so correlating waveforms finds the room, not the sync.
 * What both microphones share is WHEN THINGS GOT LOUD, so that is what is
 * matched.
 */
export function alignOffset(
  a: readonly number[],
  b: readonly number[],
  { hz = 100, maxSeconds = 30 }: { hz?: number; maxSeconds?: number } = {},
): Alignment {
  const none = { bLaterBySeconds: 0, shiftBBySeconds: 0, offsetSeconds: 0, confidence: 0 }
  if (a.length < 4 || b.length < 4) return none
  const maxLag = Math.min(Math.round(maxSeconds * hz), Math.min(a.length, b.length) - 2)
  if (maxLag < 1) return none

  const norm = (x: readonly number[]) => {
    const mean = x.reduce((s, v) => s + v, 0) / x.length
    const c = x.map(v => v - mean)
    const energy = Math.sqrt(c.reduce((s, v) => s + v * v, 0)) || 1
    return c.map(v => v / energy)
  }
  const na = norm(a), nb = norm(b)

  const scores = new Map<number, number>()
  let best = 0, bestScore = -Infinity
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let acc = 0, n = 0
    for (let i = 0; i < na.length; i++) {
      const j = i + lag
      if (j < 0 || j >= nb.length) continue
      acc += na[i] * nb[j]
      n++
    }
    if (n < hz) continue                     // less than a second of overlap
    scores.set(lag, acc)
    if (acc > bestScore) { bestScore = acc; best = lag }
  }
  if (!scores.size || bestScore <= 0) return none

  // CONFIDENCE MUST IGNORE THE PEAK'S OWN NEIGHBOURS.
  //
  // The lag one sample either side of the true one scores almost as highly —
  // it is the same alignment, off by a hundredth of a second. Comparing the
  // winner against the runner-up therefore always reports near-zero confidence,
  // even for a perfect match: measured 0.04 on a synthetic pair that lined up
  // exactly. The same shape of mistake as the beat detector's octave error, and
  // the same fix — exclude a window around the peak and compare against what is
  // genuinely a DIFFERENT answer.
  const guard = Math.max(1, Math.round(0.25 * hz))
  let rival = 0
  for (const [lag, score] of scores) {
    if (Math.abs(lag - best) <= guard) continue
    if (score > rival) rival = score
  }
  const confidence = Math.max(0, Math.min(1, (bestScore - rival) / bestScore))
  const bLater = best / hz
  return {
    bLaterBySeconds: bLater,
    shiftBBySeconds: -bLater,
    offsetSeconds: bLater,
    confidence,
  }
}

// ── 2b · who is speaking, without a diariser ─────────────────────────────

/**
 * Assign each word to a microphone, by which microphone actually heard it.
 *
 * WHISPER DOES NOT DIARISE, and the usual answers to that are a second paid
 * service or a clustering model. Neither is needed here, because the recording
 * already contains the answer: with a lapel on each speaker, the person talking
 * is the one whose OWN microphone is loud. Every other track hears them across
 * the room, quieter and later.
 *
 * So this is not a guess dressed up as one. It is a measurement, and it is more
 * reliable than a diariser on exactly this material — a diariser works from one
 * mixed track and has to infer what two tracks state outright.
 *
 * `envelopes` are per-track loudness at `hz`, ALREADY ALIGNED — offsets applied.
 * Feeding unaligned envelopes assigns words to whoever was loudest half a second
 * later, which is the other speaker about as often as not.
 */
export interface SpeakerTrack {
  readonly speaker: string
  /** Loudness envelope, aligned to the same clock as the words. */
  readonly envelope: readonly number[]
}

export function assignSpeakers(
  words: readonly Word[],
  tracks: readonly SpeakerTrack[],
  { hz = 100, margin = 1.35 }: { hz?: number; margin?: number } = {},
): Word[] {
  if (tracks.length === 0) return [...words]
  if (tracks.length === 1) return words.map(w => ({ ...w, speaker: tracks[0].speaker }))

  const energyOf = (env: readonly number[], from: number, to: number): number => {
    const a = Math.max(0, Math.floor(from * hz))
    const b = Math.min(env.length, Math.ceil(to * hz))
    if (b <= a) return 0
    let acc = 0
    for (let i = a; i < b; i++) acc += env[i] * env[i]
    return Math.sqrt(acc / (b - a))
  }

  let previous = tracks[0].speaker
  return words.map(w => {
    const scores = tracks.map(t => ({ speaker: t.speaker, e: energyOf(t.envelope, w.start, w.end) }))
    scores.sort((a, b) => b.e - a.e)
    const [top, second] = scores
    // A CLEAR WINNER, OR THE PREVIOUS SPEAKER.
    //
    // Bleed makes the two tracks similar during a pause or an overlap, and a
    // bare argmax then flips speaker on individual words in the middle of a
    // sentence — which reads as nonsense in a transcript and cuts the camera
    // back and forth. Requiring the winner to be clearly louder, and otherwise
    // keeping whoever was already talking, is what turns a measurement into a
    // usable attribution.
    if (!second || second.e <= 0 || top.e >= second.e * margin) previous = top.speaker
    return { ...w, speaker: previous }
  })
}

/**
 * How confidently the tracks separate the speakers.
 *
 * Two lapels give a wide ratio; two omnidirectional mics on one table give
 * nearly none, and the attribution is then close to a coin toss. Better to say
 * so than to print a transcript that looks authoritative and is half wrong.
 */
export function separationOf(
  words: readonly Word[],
  tracks: readonly SpeakerTrack[],
  { hz = 100 }: { hz?: number } = {},
): number {
  if (tracks.length < 2 || words.length === 0) return 0
  const energyOf = (env: readonly number[], from: number, to: number): number => {
    const a = Math.max(0, Math.floor(from * hz))
    const b = Math.min(env.length, Math.ceil(to * hz))
    if (b <= a) return 0
    let acc = 0
    for (let i = a; i < b; i++) acc += env[i] * env[i]
    return Math.sqrt(acc / (b - a))
  }
  let sum = 0, n = 0
  for (const w of words) {
    const e = tracks.map(t => energyOf(t.envelope, w.start, w.end)).sort((a, b) => b - a)
    if (e[0] <= 0 || e[1] <= 0) continue
    sum += e[0] / e[1]
    n++
  }
  return n ? sum / n : 0
}

/** Below this, two microphones are not telling the speakers apart. */
export const SEPARATION_MIN = 1.5

// ── 3 · removing what nobody wants to hear ───────────────────────────────

export interface TightenOptions {
  /** A gap longer than this is shortened. Shorter gaps are left alone. */
  readonly maxGap?: number
  /** What a shortened gap becomes. Never zero — see below. */
  readonly keepGap?: number
  /** Filler words to drop when they stand alone between pauses. */
  readonly fillers?: readonly string[]
}

export interface Cut {
  readonly from: number
  readonly to: number
  readonly reason: 'silence' | 'filler'
}

export const DEFAULT_FILLERS = [
  'ăă', 'ăăă', 'îî', 'mmm', 'hmm', 'deci', 'gen', 'adică',
  'um', 'uh', 'erm', 'like', 'you know',
]

/**
 * Which parts of the recording to remove.
 *
 * `keepGap` is the judgement in this function and it is deliberately NOT zero.
 * Removing every pause makes two people sound as though they are talking over
 * each other; the result is technically tighter and much harder to listen to.
 * A quarter of a second of air is what a conversation sounds like.
 *
 * Filler words are only removed when they stand ALONE — surrounded by pauses.
 * "Deci" mid-sentence is a real word doing real work in Romanian, and cutting
 * every instance of it damages the sentence it was holding together.
 */
export function planTighten(words: readonly Word[], opts: TightenOptions = {}): Cut[] {
  const maxGap = opts.maxGap ?? 0.7
  const keepGap = opts.keepGap ?? 0.25
  const fillers = (opts.fillers ?? DEFAULT_FILLERS).map(f => f.toLowerCase())
  const cuts: Cut[] = []
  if (words.length === 0) return cuts

  const clean = (w: string) => w.toLowerCase().replace(/[.,!?;:…"'`]/g, '').trim()

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const prevEnd = i > 0 ? words[i - 1].end : null
    const nextStart = i + 1 < words.length ? words[i + 1].start : null

    // A filler standing on its own between two pauses.
    if (fillers.includes(clean(w.word))) {
      const before = prevEnd === null ? Infinity : w.start - prevEnd
      const after = nextStart === null ? Infinity : nextStart - w.end
      if (before > 0.18 && after > 0.18) {
        cuts.push({ from: w.start - 0.05, to: w.end + 0.05, reason: 'filler' })
        continue
      }
    }

    // A gap that is longer than a breath.
    if (prevEnd !== null) {
      const gap = w.start - prevEnd
      if (gap > maxGap) {
        cuts.push({ from: prevEnd + keepGap / 2, to: w.start - keepGap / 2, reason: 'silence' })
      }
    }
  }
  return cuts.filter(c => c.to - c.from > 0.05).sort((a, b) => a.from - b.from)
}

/** Seconds saved by a cut list, for the "this episode is 11 minutes shorter" line. */
export const secondsRemoved = (cuts: readonly Cut[]): number =>
  cuts.reduce((s, c) => s + (c.to - c.from), 0)

/**
 * Apply a cut list to word timings, so captions still line up afterwards.
 *
 * Forgetting this is the classic mistake: the audio is tightened, the transcript
 * is not, and every caption in the published episode is late by however much was
 * removed before it.
 */
export function retime(words: readonly Word[], cuts: readonly Cut[]): Word[] {
  const sorted = [...cuts].sort((a, b) => a.from - b.from)
  const shiftAt = (t: number): number => {
    let shift = 0
    for (const c of sorted) {
      if (c.to <= t) shift += c.to - c.from
      else if (c.from < t) shift += t - c.from
      else break
    }
    return t - shift
  }
  return words
    .filter(w => !sorted.some(c => w.start >= c.from && w.end <= c.to))
    .map(w => ({ ...w, start: shiftAt(w.start), end: shiftAt(w.end) }))
}

// ── 4 · finding the clips ────────────────────────────────────────────────

export interface ClipCandidate {
  readonly start: number
  readonly end: number
  readonly text: string
  /** Higher is more likely to work as a standalone clip. */
  readonly score: number
  readonly why: string
}

/** Sentence-ish grouping from word timings, split on real pauses and punctuation. */
export function sentences(words: readonly Word[], gap = 0.55): Segment[] {
  const out: Segment[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    out.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map(w => w.word).join(' ').replace(/\s+([.,!?;:])/g, '$1').trim(),
      ...(cur[0].speaker ? { speaker: cur[0].speaker } : {}),
    })
    cur = []
  }
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i])
    const w = words[i]
    const next = words[i + 1]
    const endsSentence = /[.!?…]$/.test(w.word)
    const speakerChanges = next && next.speaker && w.speaker && next.speaker !== w.speaker
    const bigGap = next && next.start - w.end > gap
    if (endsSentence || speakerChanges || bigGap) flush()
  }
  flush()
  return out
}

const HOOK_WORDS = [
  'niciodată', 'nimeni', 'greșeal', 'adevăr', 'secret', 'problema', 'de fapt',
  'majoritatea', 'nu știe', 'am învățat', 'cel mai', 'important', 'surpriz',
  'never', 'nobody', 'mistake', 'truth', 'secret', 'actually', 'most people',
]

/**
 * Score every stretch of the episode as a possible social clip.
 *
 * The scoring is deliberately simple and deliberately explained per candidate,
 * because an unexplained ranking is one nobody trusts enough to use. What it
 * looks for is what actually makes a clip travel:
 *
 *   it opens on a claim rather than on context
 *   it is long enough to say something and short enough to be watched
 *   it does not start or end mid-word
 *   it contains a complete thought — it ends on a full stop, not a comma
 */
export function findClips(
  words: readonly Word[],
  { minSeconds = 15, maxSeconds = 75, want = 8 }: { minSeconds?: number; maxSeconds?: number; want?: number } = {},
): ClipCandidate[] {
  const sents = sentences(words)
  if (sents.length === 0) return []
  const out: ClipCandidate[] = []

  for (let i = 0; i < sents.length; i++) {
    // Grow from sentence i until the clip is long enough, then stop at the
    // first sentence that ENDS it properly.
    let end = i
    while (end < sents.length && sents[end].end - sents[i].start < minSeconds) end++
    for (let j = end; j < sents.length && sents[j].end - sents[i].start <= maxSeconds; j++) {
      const start = sents[i].start
      const stop = sents[j].end
      const text = sents.slice(i, j + 1).map(s => s.text).join(' ')
      const seconds = stop - start
      if (seconds < minSeconds) continue

      let score = 0
      const reasons: string[] = []

      const opener = sents[i].text.toLowerCase()
      if (HOOK_WORDS.some(h => opener.includes(h))) { score += 3; reasons.push('începe cu o afirmație, nu cu context') }
      if (/[.!?…]$/.test(sents[j].text)) { score += 2; reasons.push('se termină pe un gând complet') }
      else reasons.push('nu se termină curat')
      if (seconds >= 20 && seconds <= 45) { score += 2; reasons.push('lungime bună pentru vertical') }
      else if (seconds > 60) { score -= 1; reasons.push('lung pentru social') }
      const speakers = new Set(sents.slice(i, j + 1).map(s => s.speaker).filter(Boolean))
      if (speakers.size > 1) { score += 1; reasons.push('schimb între vorbitori') }
      if (/\d/.test(text)) { score += 1; reasons.push('conține o cifră') }
      if (/\?/.test(sents[i].text)) { score += 1; reasons.push('deschide cu o întrebare') }

      out.push({ start, end: stop, text, score, why: reasons.join(' · ') })
    }
  }

  // Best first, then drop anything overlapping something already chosen — ten
  // clips of the same two minutes is not ten clips.
  out.sort((a, b) => b.score - a.score || a.start - b.start)
  const chosen: ClipCandidate[] = []
  for (const c of out) {
    if (chosen.length >= want) break
    if (chosen.some(x => c.start < x.end && c.end > x.start)) continue
    chosen.push(c)
  }
  return chosen.sort((a, b) => a.start - b.start)
}

/**
 * Which speaker is talking at a given moment, for two-camera switching.
 *
 * A cut on every single word is unwatchable, so a switch has to EARN itself: the
 * new speaker must hold the floor for a minimum time before the camera moves.
 * Without that rule a two-hander cuts forty times a minute during an argument.
 */
export function speakerCuts(
  words: readonly Word[],
  { minHold = 1.2 }: { minHold?: number } = {},
): { start: number; speaker: string }[] {
  // The FIRST entry is not a switch, it is which camera the episode opens on.
  // Returning switches only would leave the first stretch of every episode with
  // no camera assigned at all.
  const out: { start: number; speaker: string }[] = []
  let current: string | null = null
  let candidate: string | null = null
  let candidateFrom = 0

  for (const w of words) {
    const s = w.speaker
    if (!s) continue
    if (s === current) { candidate = null; continue }
    if (s !== candidate) { candidate = s; candidateFrom = w.start }
    if (w.end - candidateFrom >= minHold) {
      out.push({ start: candidateFrom, speaker: s })
      current = s
      candidate = null
    }
  }
  return out
}

/**
 * Chapters, from the gaps that a conversation naturally leaves.
 *
 * A new topic in a real conversation is preceded by a longer pause than a new
 * sentence is. Not perfect, and it does not pretend to be: the chapters are a
 * starting point somebody renames, which is far more useful than no chapters.
 */
export function chapters(words: readonly Word[], { minSeconds = 120 }: { minSeconds?: number } = {}): Segment[] {
  const sents = sentences(words)
  if (sents.length === 0) return []
  const out: Segment[] = []
  let startIdx = 0

  for (let i = 1; i < sents.length; i++) {
    const gap = sents[i].start - sents[i - 1].end
    const runSoFar = sents[i - 1].end - sents[startIdx].start
    if (gap > 1.5 && runSoFar >= minSeconds) {
      out.push({
        start: sents[startIdx].start,
        end: sents[i - 1].end,
        text: sents[startIdx].text.slice(0, 80),
      })
      startIdx = i
    }
  }
  out.push({
    start: sents[startIdx].start,
    end: sents[sents.length - 1].end,
    text: sents[startIdx].text.slice(0, 80),
  })
  return out
}
