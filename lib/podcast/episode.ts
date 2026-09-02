// lib/podcast/episode.ts
//
// The episode itself becomes a file.
//
// WHAT WAS ACTUALLY MISSING.
//
// The podcast surface could measure a recording — it found the silences and the
// fillers, counted them, and printed "38 tăieturi · 214.6s scoase". Then it
// stopped. There was no way to get the tightened episode OUT. A number telling
// you that three and a half minutes of dead air exists is not the same as an
// episode with the dead air gone, and the second one is what gets published.
//
// So this turns the cut list into a film, and the whole of the work is in one
// idea that is easy to state and easy to get wrong:
//
//   A CUT LIST IS A LIST OF WHAT TO REMOVE. A FILM IS A LIST OF WHAT TO KEEP.
//
// They are complements, and the complement is where the bugs live: an off-by-one
// at a boundary duplicates a word or eats one, an unsorted cut list produces
// negative-length segments, and two cuts that overlap remove the same stretch
// twice and shorten the episode by more than was ever cut. (That last one is
// not hypothetical arithmetic: `retime` in lib/timeline/podcast does exactly
// that today. It is harmless only because `planTighten` happens not to emit
// overlaps — checked, not assumed, over 4000 generated recordings.)
//
// THE TWO CLOCKS.
//
// Every scene here carries two different times and they must not be confused:
//
//   `duration` is in EDITED time — how long the scene is in the finished film.
//   `in`       is in SOURCE time — where to start reading the original file.
//
// After the first cut those two diverge permanently, and they diverge by a
// different amount for every later scene. Getting this wrong does not throw; it
// produces an episode that is progressively more out of sync with itself, which
// is a bug you find at minute forty of listening.
//
// WHY IT RETURNS THE SAME SHAPE AS A CLIP.
//
// `buildClipProject` returns a project the Studio can open. This returns the
// same shape, for the same reason: an episode that is a different kind of
// object is an episode nobody can adjust. It also means the episode renders
// through `rowTimeline` — the exact path campaigns already use and that is
// already covered by assertions — rather than through a second renderer.

import type { Word, Cut } from '../timeline/podcast'
import { cameraPlan, cuesFromWords, retimeToClip, type ClipProject, type ClipSource } from './clip'

/** Shortest segment worth keeping. Below this a scene is a flash, not a shot. */
export const MIN_SEGMENT = 0.35

export interface EpisodeRequest {
  readonly words: readonly Word[]
  readonly cuts: readonly Cut[]
  /** Length of the ORIGINAL recording, in seconds. */
  readonly duration: number
  readonly sources: readonly ClipSource[]
  readonly aspect?: '16:9' | '9:16' | '1:1' | '4:5'
  /** Shown once at the top, if given. */
  readonly title?: string
  /** Burn captions into the episode. Off by default — an episode is listened to. */
  readonly captions?: boolean
  /** Minimum seconds a camera holds before it may switch. */
  readonly minHold?: number
  /**
   * Per-speaker trim in dB, keyed by speaker label.
   *
   * Balancing two lapels is the difference between a podcast that sounds made
   * and one that sounds recorded, and it cannot be done with one number for the
   * whole episode: each shot is one speaker.
   */
  readonly gainDbBySpeaker?: Readonly<Record<string, number>>
}

export interface Range { readonly start: number; readonly end: number }

/**
 * Merge a cut list into disjoint, sorted, clamped ranges.
 *
 * MEASURED, NOT ASSUMED: `planTighten` does NOT currently emit overlapping cuts
 * — 4000 randomly generated recordings produced none, because a silence cut ends
 * exactly where the filler cut after it begins. So this is not fixing a live
 * bug. It is refusing to depend on that, because the cut list this builder takes
 * is an argument, and the moment anyone hand-edits a cut or a second planner
 * writes one, overlapping ranges arrive. Subtracting an overlap twice removes
 * that stretch twice: the episode comes out shorter than the arithmetic says and
 * every scene after it reads from the wrong place in the source.
 */
export function mergeCuts(cuts: readonly Cut[], duration: number): Range[] {
  const clean = cuts
    .map(c => ({ start: Math.max(0, Math.min(c.from, c.to)), end: Math.min(duration, Math.max(c.from, c.to)) }))
    .filter(r => r.end > r.start)
    .sort((a, b) => a.start - b.start)

  const out: Range[] = []
  for (const r of clean) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end) {
      if (r.end > last.end) out[out.length - 1] = { start: last.start, end: r.end }
    } else out.push(r)
  }
  return out
}

/**
 * What survives the cut list: the complement, in source time.
 *
 * Segments shorter than MIN_SEGMENT are dropped rather than kept, because a
 * fifth of a second of recording between two cuts is not a shot — it is a click.
 */
export function keptRanges(cuts: readonly Cut[], duration: number, minSegment = MIN_SEGMENT): Range[] {
  if (!(duration > 0)) return []
  const removed = mergeCuts(cuts, duration)
  const kept: Range[] = []
  let cursor = 0
  for (const r of removed) {
    if (r.start > cursor) kept.push({ start: cursor, end: r.start })
    cursor = Math.max(cursor, r.end)
  }
  if (cursor < duration) kept.push({ start: cursor, end: duration })
  return kept.filter(r => r.end - r.start >= minSegment)
}

/** Total kept seconds — the length of the finished episode. */
export const keptSeconds = (kept: readonly Range[]): number =>
  kept.reduce((a, r) => a + (r.end - r.start), 0)

/**
 * Build the publishable episode.
 *
 * One scene per (kept range × camera hold). The camera plan runs INSIDE each
 * kept range rather than across the whole episode, because a camera switch is
 * only meaningful between two moments that are still adjacent after the cut —
 * planning switches across a removed stretch puts a cut where there is now no
 * pause to hide it.
 */
export function buildEpisodeProject(req: EpisodeRequest): ClipProject {
  const warnings: string[] = []
  const duration = Math.max(0, req.duration)
  const kept = keptRanges(req.cuts, duration)
  const sources = req.sources.filter(s => s.url)

  if (sources.length === 0) warnings.push('Nicio pistă video pentru episod.')
  if (kept.length === 0 && duration > 0) warnings.push('Lista de tăieturi elimină tot episodul.')

  const scenes: ClipProject['scenes'] = []
  let editedCursor = 0
  let seq = 0

  for (const range of kept) {
    const span = range.end - range.start
    // Words retimed to this range, so the camera plan reasons in range-local
    // seconds exactly as it does for a clip.
    const local = retimeToClip(req.words, range.start, range.end)
    const plan = sources.length
      ? cameraPlan(local, sources, span, req.minHold ?? 1.8)
      : []

    const segments = plan.length ? plan : [{ from: 0, to: span, source: sources[0] }]
    for (const seg of segments) {
      if (!seg.source) continue
      const segSeconds = seg.to - seg.from
      if (segSeconds <= 0) continue
      const trimDb = req.gainDbBySpeaker?.[seg.source.speaker ?? ''] ?? 0
      scenes.push({
        id: `ep${(seq++).toString(36)}`,
        kind: seg.source.kind,
        // dB is what a person adjusts; linear gain is what ffmpeg takes. The
        // conversion belongs here rather than in the page, so the page cannot
        // pass 3 where 1.41 was meant.
        ...(trimDb ? { audioGain: Number(Math.pow(10, trimDb / 20).toFixed(4)) } : {}),
        url: seg.source.url,
        name: `${seg.source.speaker ? seg.source.speaker + ' · ' : ''}${seq}`,
        duration: Number(segSeconds.toFixed(3)),
        // SOURCE time: where this range begins in the original file, plus how
        // far into the range this camera segment starts, plus that camera's own
        // measured offset from the transcript clock. Dropping any one of the
        // three is silent and wrong.
        in: Number((range.start + seg.from + (seg.source.offsetSeconds ?? 0)).toFixed(3)),
        kb: 'none',
      })
      editedCursor += segSeconds
    }
  }

  // Captions are written against EDITED time, which is what `retime` produces —
  // the same retimed words the cleanup panel already shows, not the originals.
  const edited = retimeWords(req.words, req.cuts)

  const overlays: ClipProject['overlays'] = []
  if (req.title) {
    overlays.push({ id: 'eptitle', kind: 'title', at: 0, dur: Math.min(3.2, editedCursor), a: req.title })
  }

  if (scenes.length > 240) {
    warnings.push(`${scenes.length} planuri — episodul e tăiat foarte des; ` +
      'crește pauza minimă dacă rezultatul sacadează.')
  }

  return {
    aspect: req.aspect ?? '16:9',
    // THE CAMERAS CARRY THE CONVERSATION. Without this the render mutes every
    // video clip — the default that is correct for b-roll under a voiceover and
    // silent for a podcast. Proven by building the timeline and reading the
    // clip's gain, after this shipped muted.
    sceneAudio: 1,
    scenes,
    overlays,
    cues: req.captions ? cuesFromWords(edited) : [],
    words: edited.map(w => ({ word: w.word, start: w.start, end: w.end })),
    // An EPISODE is listened to; a CLIP is watched muted. Opposite defaults on
    // purpose, rather than one default that is wrong half the time.
    subsOn: req.captions ?? false,
    seconds: Number(editedCursor.toFixed(3)),
    warnings,
  }
}

/**
 * Words with the cuts removed and the remainder pulled left.
 *
 * This is `retime` from lib/timeline/podcast, restated against MERGED cuts.
 *
 * The original walks the raw list and adds up every cut that ends before a word,
 * so two cuts covering the same stretch shift that word twice. That is measured:
 * with cuts [2,5] and [3,4], `retime` puts a word starting at 6s at 2s, where
 * the merged answer is 3s. It does not bite today because `planTighten` emits
 * no overlaps (checked over 4000 generated recordings). It is restated here
 * rather than changed there because changing `retime` would move every number
 * the cleanup panel currently shows, and the two agree on every input the app
 * actually produces — this one additionally survives inputs it does not.
 */
export function retimeWords(words: readonly Word[], cuts: readonly Cut[]): Word[] {
  const merged = [...mergeCuts(cuts, Number.MAX_SAFE_INTEGER)]
  const shiftAt = (t: number): number => {
    let shift = 0
    for (const c of merged) {
      if (c.end <= t) shift += c.end - c.start
      else if (c.start < t) shift += t - c.start
      else break
    }
    return t - shift
  }
  return words
    .filter(w => !merged.some(c => w.start >= c.start && w.end <= c.end))
    .map(w => ({ ...w, start: Number(shiftAt(w.start).toFixed(3)), end: Number(shiftAt(w.end).toFixed(3)) }))
    .filter(w => w.end > w.start)
}
