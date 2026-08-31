// lib/timeline/animate.ts
//
// Keyframe evaluation. Deliberately not generic over arbitrary value types:
// a renderer only ever needs to interpolate numbers and points, and a generic
// interpolator would either need `any` or a runtime type test. Two explicit
// functions are shorter, faster and type-safe.

import type { Animatable, Ease, Keyframe, Point } from './types'

function easeAt(t: number, ease: Ease): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  switch (ease) {
    case 'hold':
      return 0
    case 'easeIn':
      return x * x
    case 'easeOut':
      return 1 - (1 - x) * (1 - x)
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
    case 'linear':
    default:
      return x
  }
}

export function isCurve<T>(a: Animatable<T>): a is { readonly keys: readonly Keyframe<T>[] } {
  return typeof a === 'object' && a !== null && 'keys' in a
}

/**
 * Locates the pair of keys surrounding `frame` and returns the eased position
 * between them. Returns null when the value is constant or the curve is empty.
 */
function segment<T>(
  a: Animatable<T>,
  frame: number,
): { from: T; to: T; t: number } | null {
  if (!isCurve(a)) return null
  const keys = a.keys
  if (keys.length === 0) return null
  if (keys.length === 1) return { from: keys[0].value, to: keys[0].value, t: 0 }
  if (frame <= keys[0].frame) return { from: keys[0].value, to: keys[0].value, t: 0 }

  const last = keys[keys.length - 1]
  if (frame >= last.frame) return { from: last.value, to: last.value, t: 0 }

  let i = 0
  while (i < keys.length - 1 && keys[i + 1].frame <= frame) i++
  const a0 = keys[i]
  const a1 = keys[i + 1]
  const span = a1.frame - a0.frame
  const raw = span <= 0 ? 0 : (frame - a0.frame) / span
  return { from: a0.value, to: a1.value, t: easeAt(raw, a0.ease) }
}

export function evalNumber(a: Animatable<number>, frame: number): number {
  const seg = segment(a, frame)
  if (!seg) return a as number
  return seg.from + (seg.to - seg.from) * seg.t
}

export function evalPoint(a: Animatable<Point>, frame: number): Point {
  const seg = segment(a, frame)
  if (!seg) return a as Point
  return {
    x: seg.from.x + (seg.to.x - seg.from.x) * seg.t,
    y: seg.from.y + (seg.to.y - seg.from.y) * seg.t,
  }
}

/** Convenience for building a two-key ramp, which is most of what motion needs. */
export function ramp<T>(
  from: T,
  to: T,
  durationFrames: number,
  ease: Ease = 'easeInOut',
): { keys: Keyframe<T>[] } {
  return {
    keys: [
      { frame: 0, value: from, ease },
      { frame: Math.max(1, Math.round(durationFrames)), value: to, ease: 'linear' },
    ],
  }
}

/**
 * Apply a function to a value whether it is constant or keyframed.
 *
 * Reframing a film has to move positions that may be animated — a lower third
 * that slides in is a curve, not a point — and doing that with an `if` at every
 * call site is how one of the two branches ends up forgotten.
 */
export function mapAnimatable<T>(a: Animatable<T>, fn: (v: T) => T): Animatable<T> {
  if (!isCurve(a)) return fn(a as T)
  return { keys: a.keys.map(k => ({ ...k, value: fn(k.value) })) }
}
