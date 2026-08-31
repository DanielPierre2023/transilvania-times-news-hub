// lib/timeline/retarget.ts
//
// One film, every aspect, in one pass.
//
// A campaign is not a film, it is a family: 9:16 for Reels and TikTok, 1:1 and
// 4:5 for feed, 16:9 for YouTube and the site. Rebuilding each by hand is how a
// week disappears, and it is also how the versions drift apart — someone fixes
// a caption in the vertical cut and forgets the square one.
//
// THREE THINGS HAVE TO CHANGE AND ONE MUST NOT.
//
// The frame changes: a new timebase. Picture clips need no arithmetic at all,
// because `fit: 'cover'` already fills whatever frame it is given — that is the
// dividend of having a real timeline document rather than a render script.
//
// Type has to be re-laid out, and this is where a naive reframe looks amateur:
//
//   Position. A caption at y = 0.76 sits above TikTok's caption bar in 9:16 and
//   halfway down a 16:9 frame in the wrong place entirely. Every text and shape
//   position is re-clamped into the safe area of the FORMAT IT IS GOING TO, not
//   the one it came from.
//
//   Measure. `maxWidth` is a fraction of frame WIDTH, and font size is a
//   fraction of the SHORT edge. Carry 0.86 across to 16:9 unchanged and the
//   caption becomes a single 90-character line — technically correct, unreadable
//   in practice. The box is rescaled so the measure stays constant in ems.
//
// What must not change is size: `TextStyle.size` is already relative to the
// short edge, so a 0.045 caption is the same apparent size in every format. Any
// "correction" there would break the one thing that already worked.

import type { Clip, Point, Timeline, Track } from './types'

/**
 * Normalised safe-area insets, 0..1 of the frame.
 *
 * Declared here rather than imported from lib/brand on purpose: the timeline
 * module must not depend on the brand module, or the renderer starts needing a
 * brand kit to reframe a film. The Studio passes SAFE_AREAS[name] straight in —
 * the shapes match, and the dependency runs the right way round.
 */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}
import { isCurve, mapAnimatable } from './animate'

export interface RetargetSpec {
  readonly width: number
  readonly height: number
  /** Safe-area insets of the DESTINATION format. Normalised, 0..1. */
  readonly safe?: Insets
  /** Breathing room inside the safe box, as a fraction of the frame. */
  readonly inset?: number
}

export interface AspectPreset {
  readonly name: string
  readonly width: number
  readonly height: number
  /** Which safe-area profile this format is normally published against. */
  readonly safeArea: 'reels' | 'feed' | 'broadcast' | 'none'
}

/** The formats a campaign is actually delivered in, at 1080p equivalents. */
export const ASPECT_PRESETS: Readonly<Record<string, AspectPreset>> = {
  '9:16': { name: 'Reels · TikTok · Shorts', width: 1080, height: 1920, safeArea: 'reels' },
  '4:5':  { name: 'Feed vertical',            width: 1080, height: 1350, safeArea: 'feed' },
  '1:1':  { name: 'Feed pătrat',              width: 1080, height: 1080, safeArea: 'feed' },
  '16:9': { name: 'YouTube · site',           width: 1920, height: 1080, safeArea: 'broadcast' },
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 }

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? (lo + hi) / 2 : v < lo ? lo : v > hi ? hi : v
}

/**
 * The measure, held constant.
 *
 * Old box in short-edge units is `maxWidth * W_old / short_old`; the new
 * fraction that reproduces it is that, times `short_new / W_new`.
 */
export function retargetMaxWidth(
  maxWidth: number,
  from: { width: number; height: number },
  to: { width: number; height: number },
): number {
  const shortFrom = Math.min(from.width, from.height)
  const shortTo = Math.min(to.width, to.height)
  const inEms = (maxWidth * from.width) / shortFrom
  return clamp((inEms * shortTo) / to.width, 0.28, 0.94)
}

function clampPoint(p: Point, safe: Insets, inset: number): Point {
  return {
    x: clamp(p.x, safe.left + inset, 1 - safe.right - inset),
    y: clamp(p.y, safe.top + inset, 1 - safe.bottom - inset),
  }
}

function retargetClip(clip: Clip, spec: RetargetSpec, from: { width: number; height: number }): Clip {
  const kind = clip.source.kind
  // Picture fills the frame by itself. Nothing to do, and nothing to get wrong.
  if (kind === 'image' || kind === 'video' || kind === 'audio') return clip

  const safe = spec.safe ?? NO_INSETS
  const inset = spec.inset ?? 0.04

  const position = mapAnimatable(clip.transform.position, p => clampPoint(p, safe, inset))

  let source = clip.source
  if (kind === 'text' && source.kind === 'text' && typeof source.style.maxWidth === 'number') {
    source = {
      ...source,
      style: {
        ...source.style,
        maxWidth: retargetMaxWidth(source.style.maxWidth, from, spec),
      },
    }
  }

  return { ...clip, source, transform: { ...clip.transform, position } }
}

/**
 * Reframe a finished timeline into another format.
 *
 * Audio, timing, markers and delivery are untouched: the same voice, the same
 * cuts, the same loudness target. Only the frame and the type move.
 */
export function retarget(tl: Timeline, spec: RetargetSpec): Timeline {
  const from = { width: tl.timebase.width, height: tl.timebase.height }
  if (from.width === spec.width && from.height === spec.height) return tl

  const tracks: Track[] = tl.tracks.map(track =>
    track.kind !== 'video'
      ? track
      : { ...track, clips: track.clips.map(c => retargetClip(c, spec, from)) },
  )

  return {
    ...tl,
    timebase: { ...tl.timebase, width: spec.width, height: spec.height },
    tracks,
  }
}

/** Every format except the one the film is already in. */
export function otherAspects(tl: Timeline): string[] {
  return Object.keys(ASPECT_PRESETS).filter(k => {
    const p = ASPECT_PRESETS[k]
    return !(p.width === tl.timebase.width && p.height === tl.timebase.height)
  })
}

export { isCurve }
