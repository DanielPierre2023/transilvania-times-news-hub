// lib/podcast/clip.ts
//
// A ranked moment becomes a film somebody can publish.
//
// `findClips` ends with a list of start/end pairs and a reason for each. That is
// where it stopped, and a list of timecodes is not a deliverable — turning one
// into a vertical with burned-in captions was still a manual job in the Studio,
// per clip, which is exactly the work the tab was supposed to remove.
//
// FOUR THINGS HAVE TO HAPPEN, AND THREE OF THEM ARE EASY TO GET WRONG.
//
//   THE WORDS MUST BE RETIMED. A clip starting at 14:32 carries words
//   timestamped at 14:32, and a caption track starts at zero. Paste them over
//   without subtracting the clip's start and every caption in every clip is
//   fourteen minutes late — which looks like the captions are simply broken,
//   and sends you looking in the caption code.
//
//   THE CROP MUST FOLLOW THE SPEAKER. A 16:9 conversation dropped into 9:16 is
//   a letterboxed strip with two tiny people in it. With two cameras the crop
//   is whichever camera is on; with one, it is a crop toward whoever is talking.
//
//   THE HOOK IS THE FIRST LINE, NOT A TITLE. The words that open the clip, on
//   screen, because the clip is watched without sound. Writing a separate
//   headline is work nobody does, so it defaults to what is actually said.
//
//   IT MUST NOT START ON A HALF-WORD. `findClips` already guarantees the
//   boundaries land on word edges; this preserves that through the trim.

import type { Word } from '../timeline/podcast'

export interface ClipSource {
  /** The recording this clip is cut from. */
  readonly url: string
  readonly kind: 'video' | 'image'
  /** Seconds this file is offset from the transcript's clock. */
  readonly offsetSeconds?: number
  readonly speaker?: string
}

export interface ClipRequest {
  readonly start: number
  readonly end: number
  readonly words: readonly Word[]
  /** One entry per camera. The speaker field is matched against the words. */
  readonly sources: readonly ClipSource[]
  readonly hook?: string
  readonly attribution?: string
  readonly aspect?: '9:16' | '1:1' | '4:5' | '16:9'
}

export interface ClipScene {
  id: string
  /** Linear gain for this shot's own sound, when one speaker needs trimming. */
  audioGain?: number
  kind: 'video' | 'image'
  url: string
  name: string
  duration: number
  /** Seconds into the SOURCE this scene starts. */
  in: number
  kb: 'none'
}

export interface ClipCue { start: number; end: number; text: string }

export interface ClipProject {
  aspect: string
  scenes: ClipScene[]
  overlays: { id: string; kind: 'title' | 'lower' | 'end'; at: number; dur: number; a: string; b?: string }[]
  cues: ClipCue[]
  words: { word: string; start: number; end: number }[]
  subsOn: boolean
  /** Linear gain for the cameras' own sound. 1 — a conversation IS its audio. */
  sceneAudio: number
  seconds: number
  /** What could not be done, in words, rather than silently. */
  warnings: string[]
}

const uid = (() => { let n = 0; return () => `pc${(n++).toString(36)}` })()

/** Words inside the clip, retimed so the clip starts at zero. */
export function retimeToClip(words: readonly Word[], start: number, end: number): Word[] {
  return words
    .filter(w => w.end > start && w.start < end)
    .map(w => ({
      ...w,
      start: Math.max(0, w.start - start),
      end: Math.min(end - start, w.end - start),
    }))
    .filter(w => w.end > w.start)
}

/**
 * Caption cues from words, grouped so each stays readable.
 *
 * Grouped by CHARACTERS, not by a fixed word count: "și" and
 * "întreprinderea" are one word each and nothing like the same width. A
 * fixed count therefore produces lines that are alternately half empty and
 * overflowing, which is the commonest reason burned-in captions look amateur.
 */
export function cuesFromWords(words: readonly Word[], maxChars = 42): ClipCue[] {
  const out: ClipCue[] = []
  let run: Word[] = []
  const flush = () => {
    if (!run.length) return
    out.push({
      start: run[0].start,
      end: run[run.length - 1].end,
      text: run.map(w => w.word).join(' ').replace(/\s+([.,!?;:…])/g, '$1').trim(),
    })
    run = []
  }
  for (const w of words) {
    const candidate = [...run, w].map(x => x.word).join(' ')
    if (run.length && candidate.length > maxChars) flush()
    run.push(w)
    if (/[.!?…]$/.test(w.word)) flush()
  }
  flush()
  return out
}

/**
 * Which camera should be on, and for how long.
 *
 * With one source this is the whole clip. With two it follows the speaker, and
 * a switch has to earn itself — the minimum hold is what stops a two-hander
 * cutting on every interjection.
 */
export function cameraPlan(
  words: readonly Word[],
  sources: readonly ClipSource[],
  clipSeconds: number,
  minHold = 1.5,
): { from: number; to: number; source: ClipSource }[] {
  if (sources.length === 0) return []
  if (sources.length === 1) return [{ from: 0, to: clipSeconds, source: sources[0] }]

  const bySpeaker = new Map(sources.filter(s => s.speaker).map(s => [s.speaker as string, s]))
  const segments: { from: number; to: number; source: ClipSource }[] = []
  let current = bySpeaker.get(words[0]?.speaker ?? '') ?? sources[0]
  let from = 0
  let candidate: ClipSource | null = null
  let candidateFrom = 0

  for (const w of words) {
    const want = bySpeaker.get(w.speaker ?? '')
    if (!want || want === current) { candidate = null; continue }
    if (want !== candidate) { candidate = want; candidateFrom = w.start }
    if (w.end - candidateFrom >= minHold) {
      segments.push({ from, to: candidateFrom, source: current })
      current = want
      from = candidateFrom
      candidate = null
    }
  }
  segments.push({ from, to: clipSeconds, source: current })
  return segments.filter(s => s.to > s.from + 0.05)
}

/**
 * Build the project for one clip.
 *
 * The result is the SAME project shape a hand-made film has, so a clip can be
 * opened in the Studio, adjusted and re-rendered. A clip that is a different
 * kind of object is a clip nobody can fix.
 */
export function buildClipProject(req: ClipRequest): ClipProject {
  const warnings: string[] = []
  const seconds = Math.max(0.5, req.end - req.start)
  const words = retimeToClip(req.words, req.start, req.end)

  if (words.length === 0) warnings.push('Clipul nu conține niciun cuvânt transcris — va ieși fără subtitrări.')
  if (req.sources.length === 0) warnings.push('Nicio sursă video pentru acest clip.')

  const plan = cameraPlan(words, req.sources, seconds)
  const scenes: ClipScene[] = plan.map((seg, i) => ({
    id: uid(),
    kind: seg.source.kind,
    url: seg.source.url,
    name: `${seg.source.speaker ? seg.source.speaker + ' · ' : ''}${i + 1}`,
    duration: Number((seg.to - seg.from).toFixed(3)),
    // THE SOURCE OFFSET IS ADDED HERE, not subtracted. The transcript clock and
    // each camera's own clock differ by the measured alignment; a scene that
    // ignores it is out of sync by exactly that amount, on every clip.
    in: Number((req.start + seg.from + (seg.source.offsetSeconds ?? 0)).toFixed(3)),
    kb: 'none',
  }))

  if (plan.length > 1) {
    const switches = plan.length - 1
    if (switches > seconds / 4) {
      warnings.push(`${switches} schimbări de cameră în ${seconds.toFixed(0)}s — prea des pentru un clip scurt.`)
    }
  }

  // The hook is what is actually said, unless something better was written.
  const spoken = words.slice(0, 12).map(w => w.word).join(' ').replace(/\s+([.,!?;:…])/g, '$1')
  const hook = (req.hook || spoken).slice(0, 80)

  const overlays: ClipProject['overlays'] = []
  if (hook) overlays.push({ id: uid(), kind: 'title', at: 0, dur: Math.min(2.6, seconds), a: hook })
  if (req.attribution) {
    overlays.push({ id: uid(), kind: 'lower', at: Math.min(2.8, seconds * 0.2),
      dur: Math.min(3, Math.max(1.5, seconds * 0.25)), a: req.attribution })
  }

  return {
    aspect: req.aspect ?? '9:16',
    // THE CAMERAS CARRY THE CONVERSATION. Without this the render mutes every
    // video clip — the default that is correct for b-roll under a voiceover and
    // silent for a podcast. Proven by building the timeline and reading the
    // clip's gain, after this shipped muted.
    sceneAudio: 1,
    scenes,
    overlays,
    cues: cuesFromWords(words),
    words: words.map(w => ({ word: w.word, start: w.start, end: w.end })),
    // A clip is watched without sound. Captions are not optional here.
    subsOn: true,
    seconds,
    warnings,
  }
}
