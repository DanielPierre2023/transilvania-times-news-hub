// lib/timeline/transitions.ts
//
// Dissolves and dips, without touching the renderer.
//
// THE WHOLE TRICK IS THAT THERE IS NO TRICK.
//
// The compiler already draws clips in track order and blends them by opacity,
// and a clip already has `fadeIn` and `fadeOut` that ramp it. A cross-dissolve
// is therefore not a new drawing mode — it is two clips overlapping, the
// outgoing one fading down while the incoming one fades up. Everything needed
// already exists; what was missing was anything that arranged it.
//
// So this is a pure timeline transform. Shots come in butt-joined and go out
// overlapped, and the renderer is not aware that anything happened. No new
// filter, no new compositing path, nothing to keep in step between the preview
// and the file — which is the only reason it is safe to add a feature like this
// to a codebase that has spent a month closing that exact gap.
//
// WHAT IT COSTS, SAID PLAINLY.
//
// A dissolve eats time. Two shots of five seconds joined by a twelve-frame
// dissolve occupy 9.52 seconds, not 10 — the overlap is shared. The film gets
// shorter, and if the voice was cut to the old length it will now run past the
// picture. `applyTransitions` returns the new duration so a caller can say so.

import type { Clip, Timeline } from './types'
import { addClip, emptyTrack } from './document'

export type TransitionKind = 'cut' | 'dissolve' | 'dipToBlack' | 'dipToWhite' | 'dipToBrand'

export interface TransitionSpec {
  readonly kind: TransitionKind
  /** Frames. A dissolve under four frames reads as a soft cut, not a dissolve. */
  readonly frames: number
  /** For dipToBrand. */
  readonly colour?: string
}

export const TRANSITIONS: Readonly<Record<TransitionKind, { label: string; note: string }>> = {
  cut: { label: 'Tăietură', note: 'Nimic între planuri. Corect pentru aproape tot.' },
  dissolve: {
    label: 'Fondu încrucișat',
    note: 'Cele două planuri se suprapun. Spune „a trecut timp" sau „acestea sunt legate". ' +
      'Mănâncă durată: două planuri de 5s cu un fondu de 12 cadre ocupă 9.5s, nu 10.',
  },
  dipToBlack: { label: 'Trecere prin negru', note: 'Separă capitole. Mai tare decât un fondu.' },
  dipToWhite: { label: 'Trecere prin alb', note: 'Mai luminos, mai publicitar. Folosit rar și scurt.' },
  dipToBrand: { label: 'Trecere prin culoarea brandului', note: 'Semnătura, când filmul o suportă.' },
}

const DIP_COLOUR: Partial<Record<TransitionKind, string>> = {
  dipToBlack: '#000000',
  dipToWhite: '#FFFFFF',
}

/** A dissolve shorter than this reads as a mistake rather than as an effect. */
export const MIN_DISSOLVE = 3

export interface TransitionResult {
  readonly timeline: Timeline
  /** Frames the film lost to overlaps. Zero when nothing dissolves. */
  readonly framesLost: number
}

/**
 * Apply per-cut transitions to the picture track.
 *
 * `specs[i]` is the transition BEFORE clip i, so index 0 is ignored: there is no
 * cut before the first shot. Anything not named is a cut.
 */
export function applyTransitions(
  tl: Timeline,
  specs: readonly (TransitionSpec | undefined)[],
  opts: { brandColour?: string } = {},
): TransitionResult {
  const track = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  if (!track || track.clips.length < 2) return { timeline: tl, framesLost: 0 }

  const clips = [...track.clips].sort((a, b) => a.start - b.start)
  const out: Clip[] = []
  const dips: { at: number; frames: number; colour: string }[] = []
  let shift = 0          // how far everything after here has moved earlier
  let lost = 0

  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]
    const spec = specs[i]
    let fadeIn = c.fadeIn
    const fadeOut = c.fadeOut

    if (i > 0 && spec && spec.kind !== 'cut') {
      // Never eat more than a third of either shot: a dissolve longer than the
      // shots it joins is a slideshow, and it is easy to ask for by accident.
      const prev = clips[i - 1]
      const room = Math.floor(Math.min(prev.duration, c.duration) / 3)
      const frames = Math.max(MIN_DISSOLVE, Math.min(spec.frames, room))

      if (spec.kind === 'dissolve') {
        shift += frames
        lost += frames
        fadeIn = Math.max(fadeIn, frames)
        // The outgoing shot fades under it. `out` already holds it.
        const last = out[out.length - 1]
        out[out.length - 1] = { ...last, fadeOut: Math.max(last.fadeOut, frames) }
      } else {
        // A DIP IS NOT A DISSOLVE. The shots do not overlap; a colour comes up
        // over the join and goes down again, so the cut still happens where it
        // was and no time is lost.
        const colour = spec.kind === 'dipToBrand'
          ? (spec.colour || opts.brandColour || '#CA2222')
          : (DIP_COLOUR[spec.kind] || '#000000')
        dips.push({ at: c.start - shift - frames, frames: frames * 2, colour })
      }
    }

    out.push({ ...c, start: c.start - shift, fadeIn, fadeOut })
  }

  let next: Timeline = {
    ...tl,
    tracks: tl.tracks.map(t => (t === track ? { ...t, clips: out } : t)),
    duration: Math.max(1, tl.duration - lost),
  }

  if (dips.length) {
    // Dips ride ABOVE the picture and below the type: a dip that covers the
    // lower third is a mistake, and a dip the captions punch through is right.
    let dipTrack = next.tracks.find(t => t.kind === 'video' && t.z === 5)
    if (!dipTrack) {
      dipTrack = emptyTrack('video', 'Treceri', 5)
      next = { ...next, tracks: [...next.tracks, dipTrack] }
    }
    for (const d of dips) {
      next = addClip(next, dipTrack.id, {
        id: `dip_${d.at}_${Math.round(d.frames)}`,
        name: 'Trecere',
        source: { kind: 'shape', shape: 'rect', fill: d.colour, size: { w: 1, h: 1 } },
        start: Math.max(0, d.at),
        duration: Math.max(2, d.frames),
        sourceIn: 0,
        transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
        fit: 'cover',
        // Up and down in equal halves: the cut sits at the peak, where the
        // colour is solid and neither shot is visible.
        fadeIn: Math.max(1, Math.round(d.frames / 2)),
        fadeOut: Math.max(1, Math.round(d.frames / 2)),
        enabled: true,
      })
    }
  }

  return { timeline: next, framesLost: lost }
}

/** What the transitions will do to the running time, before committing to them. */
export function framesLostTo(
  clips: readonly { duration: number }[],
  specs: readonly (TransitionSpec | undefined)[],
): number {
  let lost = 0
  for (let i = 1; i < clips.length; i++) {
    const s = specs[i]
    if (!s || s.kind !== 'dissolve') continue
    const room = Math.floor(Math.min(clips[i - 1].duration, clips[i].duration) / 3)
    lost += Math.max(MIN_DISSOLVE, Math.min(s.frames, room))
  }
  return lost
}
