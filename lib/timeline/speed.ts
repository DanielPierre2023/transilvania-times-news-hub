// lib/timeline/speed.ts
//
// Speed ramps.
//
// THE INTEGRAL IS THE WHOLE PROBLEM.
//
// A ramp is a curve of playback RATE over the clip's own frames. What the
// compiler needs is not the rate but the SOURCE OFFSET — how far into the media
// we are at clip-local frame f. Those are different quantities and confusing
// them is the classic speed-ramp bug:
//
//   offset(f) = ∫₀ᶠ rate(t) dt        ← correct
//   offset(f) = f · rate(f)           ← wrong, and plausible
//
// The wrong one is right only when the rate never changes. The moment it ramps,
// the clip plays at the correct speed from the WRONG FRAME, and the error grows
// with f. On a talking head it reads as a lipsync fault; on b-roll it is nearly
// invisible until someone matches a cut to a beat and it will not sit.
//
// Because rate moves linearly between two points, each segment's integral is
// the area of a trapezoid — exact, not a numerical approximation, and cheap.

import type { SpeedRamp, SpeedPoint } from './types'

/** Below this a clip is effectively frozen; above it, frames are being thrown away wholesale. */
export const MIN_RATE = 0.1
export const MAX_RATE = 8

export const clampRate = (r: number): number =>
  !Number.isFinite(r) ? 1 : Math.max(MIN_RATE, Math.min(MAX_RATE, r))

/** Points in order, deduplicated by frame, clamped, with a point at frame 0. */
export function normalisePoints(points: readonly SpeedPoint[]): SpeedPoint[] {
  const seen = new Map<number, number>()
  for (const p of points) {
    const f = Math.max(0, Math.round(p.frame))
    if (!Number.isFinite(f)) continue
    seen.set(f, clampRate(p.rate))
  }
  const out = [...seen.entries()]
    .map(([frame, rate]) => ({ frame, rate }))
    .sort((a, b) => a.frame - b.frame)
  // A ramp with no value at 0 is undefined at the start of the clip. Hold the
  // first rate backwards rather than silently assuming real time, which would
  // put a step at frame 0 that nobody authored.
  if (out.length === 0) return [{ frame: 0, rate: 1 }]
  if (out[0].frame !== 0) out.unshift({ frame: 0, rate: out[0].rate })
  return out
}

/** The playback rate at a clip-local frame. Linear between points, held outside. */
export function rateAt(ramp: SpeedRamp | undefined, localFrame: number): number {
  if (!ramp) return 1
  const pts = normalisePoints(ramp.points)
  const f = Math.max(0, localFrame)
  if (f <= pts[0].frame) return pts[0].rate
  const last = pts[pts.length - 1]
  if (f >= last.frame) return last.rate
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (f >= a.frame && f <= b.frame) {
      const span = b.frame - a.frame
      if (span <= 0) return b.rate
      return a.rate + (b.rate - a.rate) * ((f - a.frame) / span)
    }
  }
  return last.rate
}

/**
 * How many SOURCE frames have been consumed by clip-local frame `f`.
 *
 * The trapezoid rule, exact for a piecewise-linear rate. Whole segments are
 * summed, then the partial segment `f` lands in.
 */
export function sourceOffset(ramp: SpeedRamp | undefined, localFrame: number): number {
  if (!ramp) return Math.max(0, localFrame)
  const pts = normalisePoints(ramp.points)
  const f = Math.max(0, localFrame)
  let acc = 0

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (f >= b.frame) {
      // whole segment
      acc += ((a.rate + b.rate) / 2) * (b.frame - a.frame)
    } else if (f > a.frame) {
      // partial segment: integrate to f, using the rate interpolated at f
      const span = b.frame - a.frame
      const rf = span <= 0 ? b.rate : a.rate + (b.rate - a.rate) * ((f - a.frame) / span)
      acc += ((a.rate + rf) / 2) * (f - a.frame)
      return acc
    } else {
      return acc
    }
  }
  // past the last point, the final rate holds
  const last = pts[pts.length - 1]
  if (f > last.frame) acc += last.rate * (f - last.frame)
  return acc
}

/**
 * Source frames a whole clip consumes.
 *
 * This is what tells you whether a ramp runs off the end of the media, which is
 * the failure that produces a frozen last frame nobody notices until delivery.
 */
export const sourceFramesUsed = (ramp: SpeedRamp | undefined, duration: number): number =>
  sourceOffset(ramp, duration)

/** True when the rate never changes — the only case where audio can follow. */
export function isConstant(ramp: SpeedRamp | undefined): boolean {
  if (!ramp) return true
  const pts = normalisePoints(ramp.points)
  return pts.every(p => Math.abs(p.rate - pts[0].rate) < 1e-9)
}

/** The single rate of a constant ramp, or null when it ramps. */
export function constantRate(ramp: SpeedRamp | undefined): number | null {
  if (!ramp) return 1
  if (!isConstant(ramp)) return null
  return normalisePoints(ramp.points)[0].rate
}

/**
 * Should this clip's audio be heard?
 *
 * A ramping rate cannot be applied to audio without a pitch slide, so a ramped
 * clip is muted unless it is constant AND asked to follow. Said out loud by the
 * linter rather than discovered in a review.
 */
export function audioFollows(ramp: SpeedRamp | undefined): boolean {
  if (!ramp) return true
  if (ramp.audio === 'mute') return false
  return isConstant(ramp)
}

/** ffmpeg `atempo` accepts 0.5..2 per instance, so a big change is chained. */
export function atempoChain(rate: number): number[] {
  const r = clampRate(rate)
  if (Math.abs(r - 1) < 1e-6) return []
  const out: number[] = []
  let remaining = r
  while (remaining > 2) { out.push(2); remaining /= 2 }
  while (remaining < 0.5) { out.push(0.5); remaining /= 0.5 }
  out.push(Number(remaining.toFixed(6)))
  return out
}

/** Ready-made ramps, named the way an editor asks for them. */
export const SPEED_PRESETS: Readonly<Record<string, { label: string; note: string; build: (dur: number) => SpeedRamp }>> = {
  slowMo: {
    label: 'Slow motion (0.5×)',
    note: 'Half speed throughout. Needs twice the source, or the shot runs out.',
    build: () => ({ points: [{ frame: 0, rate: 0.5 }] }),
  },
  double: {
    label: 'Double speed (2×)',
    note: 'Twice as fast. Good for a process shot nobody needs to watch in full.',
    build: () => ({ points: [{ frame: 0, rate: 2 }] }),
  },
  rampIn: {
    label: 'Ramp into slow motion',
    note: 'Starts real time, slides to a third by the end. The classic reveal.',
    build: (d) => ({ points: [{ frame: 0, rate: 1 }, { frame: Math.max(1, Math.round(d * 0.45)), rate: 0.33 }] }),
  },
  rampOut: {
    label: 'Ramp out of slow motion',
    note: 'Opens slow and accelerates away. Pairs with a cut on the beat.',
    build: (d) => ({ points: [{ frame: 0, rate: 0.33 }, { frame: Math.max(1, Math.round(d * 0.55)), rate: 1 }] }),
  },
  whip: {
    label: 'Whip (fast middle)',
    note: 'Real time, a hard rush through the middle, real time again.',
    build: (d) => ({ points: [
      { frame: 0, rate: 1 },
      { frame: Math.max(1, Math.round(d * 0.35)), rate: 4 },
      { frame: Math.max(2, Math.round(d * 0.65)), rate: 1 },
    ] }),
  },
}
