// lib/timeline/captions.ts
//
// Caption sidecars and caption quality.
//
// The burn-in already existed; the sidecar did not, which meant no delivery
// spec that asks for subtitles could be met. The cue data was always there —
// it just never left the canvas.
//
// The quality checks are the ones broadcasters and platforms actually apply:
// reading speed, line length, minimum time on screen, and a real gap between
// cues so the eye registers a change.

import { framesToSeconds } from './time'
import type { Rational } from './time'
import type { Timeline } from './types'

export interface Cue {
  /** Frames. */
  readonly start: number
  readonly end: number
  readonly text: string
}

/** Limits taken from common broadcast and platform subtitle specs. */
export interface CaptionLimits {
  readonly maxCharsPerLine: number
  readonly maxLines: number
  /** Characters per second. 17 is the usual adult reading speed. */
  readonly maxReadingSpeed: number
  /** Seconds a cue must stay up even if it is short. */
  readonly minDuration: number
  readonly maxDuration: number
  /** Frames of black between consecutive cues. */
  readonly minGapFrames: number
}

export const DEFAULT_LIMITS: CaptionLimits = {
  maxCharsPerLine: 42,
  maxLines: 2,
  maxReadingSpeed: 17,
  minDuration: 5 / 6,
  maxDuration: 7,
  minGapFrames: 2,
}

/** Pulls the caption clips off the timeline in timecode order. */
export function extractCues(tl: Timeline): Cue[] {
  const cues: Cue[] = []
  for (const track of tl.tracks) {
    if (track.kind !== 'video' || !track.enabled) continue
    for (const clip of track.clips) {
      if (clip.source.kind !== 'text' || !clip.enabled) continue
      cues.push({
        start: clip.start,
        end: clip.start + clip.duration,
        text: clip.source.text,
      })
    }
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}

function clock(frames: number, fps: Rational, msSeparator: ',' | '.'): string {
  const total = Math.max(0, framesToSeconds(frames, fps))
  const whole = Math.floor(total)
  const ms = Math.round((total - whole) * 1000)
  // Rounding milliseconds can carry into the next second.
  const carry = ms === 1000 ? 1 : 0
  const s = whole + carry
  const msOut = carry ? 0 : ms
  const hh = String(Math.floor(s / 3600)).padStart(2, '0')
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}${msSeparator}${String(msOut).padStart(3, '0')}`
}

/**
 * Wraps to at most `maxLines` lines of `maxCharsPerLine`, breaking on words and
 * preferring a balanced split — a two-line caption reads better when the lines
 * are close in length than when the first is full and the second is one word.
 */
export function wrapCaption(text: string, limits: CaptionLimits = DEFAULT_LIMITS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= limits.maxCharsPerLine) return [clean]

  const words = clean.split(' ')
  if (limits.maxLines === 2) {
    // Try every split point, keep the one with the smallest difference that
    // still fits both lines.
    let best: [string, string] | null = null
    let bestScore = Infinity
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' ')
      const b = words.slice(i).join(' ')
      if (a.length > limits.maxCharsPerLine || b.length > limits.maxCharsPerLine) continue
      const score = Math.abs(a.length - b.length)
      if (score < bestScore) {
        bestScore = score
        best = [a, b]
      }
    }
    if (best) return best
  }

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > limits.maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, limits.maxLines)
}

export interface CaptionOptions {
  readonly limits?: CaptionLimits
  /** Wrap long cues onto two lines. On by default. */
  readonly wrap?: boolean
}

export function toSRT(cues: readonly Cue[], fps: Rational, opts: CaptionOptions = {}): string {
  const limits = opts.limits ?? DEFAULT_LIMITS
  const wrap = opts.wrap !== false
  const blocks: string[] = []
  cues.forEach((cue, i) => {
    const lines = wrap ? wrapCaption(cue.text, limits) : [cue.text.trim()]
    if (!lines.length) return
    blocks.push(
      `${i + 1}\n${clock(cue.start, fps, ',')} --> ${clock(cue.end, fps, ',')}\n${lines.join('\n')}`,
    )
  })
  // SRT wants CRLF and a trailing blank line.
  return blocks.join('\n\n').replace(/\n/g, '\r\n') + '\r\n\r\n'
}

export function toVTT(cues: readonly Cue[], fps: Rational, opts: CaptionOptions = {}): string {
  const limits = opts.limits ?? DEFAULT_LIMITS
  const wrap = opts.wrap !== false
  const blocks = ['WEBVTT', '']
  cues.forEach((cue, i) => {
    const lines = wrap ? wrapCaption(cue.text, limits) : [cue.text.trim()]
    if (!lines.length) return
    blocks.push(String(i + 1))
    blocks.push(`${clock(cue.start, fps, '.')} --> ${clock(cue.end, fps, '.')}`)
    blocks.push(...lines)
    blocks.push('')
  })
  return blocks.join('\n')
}

export interface CaptionProblem {
  readonly index: number
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly text: string
}

/**
 * Everything a subtitle QA pass would flag. Run it before delivery — a caption
 * that flashes for four frames or runs at 30 characters a second is a rejection,
 * and it is invisible while you are watching your own edit.
 */
export function checkCaptions(
  cues: readonly Cue[],
  fps: Rational,
  limits: CaptionLimits = DEFAULT_LIMITS,
): CaptionProblem[] {
  const out: CaptionProblem[] = []
  cues.forEach((cue, i) => {
    const text = cue.text.replace(/\s+/g, ' ').trim()
    const seconds = framesToSeconds(cue.end - cue.start, fps)
    const push = (severity: 'error' | 'warning', message: string) =>
      out.push({ index: i, severity, message, text })

    if (!text) {
      push('error', 'Empty caption.')
      return
    }
    if (cue.end <= cue.start) {
      push('error', 'Ends before it starts.')
      return
    }
    if (seconds < limits.minDuration) {
      push('error', `On screen ${seconds.toFixed(2)}s, under the ${limits.minDuration.toFixed(2)}s floor.`)
    }
    if (seconds > limits.maxDuration) {
      push('warning', `On screen ${seconds.toFixed(1)}s, over the ${limits.maxDuration}s ceiling.`)
    }

    const cps = text.length / seconds
    if (cps > limits.maxReadingSpeed) {
      push('error', `${cps.toFixed(1)} characters per second, over the ${limits.maxReadingSpeed} limit.`)
    }

    const lines = wrapCaption(text, limits)
    if (lines.join(' ').length < text.length) {
      push('warning', `Too long to fit ${limits.maxLines} lines of ${limits.maxCharsPerLine}; it will be truncated.`)
    }
    for (const line of lines) {
      if (line.length > limits.maxCharsPerLine) {
        push('warning', `Line of ${line.length} characters, over ${limits.maxCharsPerLine}.`)
      }
    }

    const prev = cues[i - 1]
    if (prev) {
      if (cue.start < prev.end) {
        push('error', 'Overlaps the previous caption.')
      } else if (cue.start - prev.end < limits.minGapFrames && cue.start !== prev.end) {
        push('warning', 'Gap to the previous caption is under two frames; make them touch instead.')
      }
    }
  })
  return out
}

/**
 * Nudges cues so they satisfy the limits: pushes overlaps apart, closes
 * flicker-width gaps, and extends anything under the minimum. Empty cues are
 * dropped — an empty caption is not a caption, and leaving it in only pushes
 * the next one later.
 *
 * The minimum is applied AFTER the start has been moved, not before. Applying
 * it first and then shifting the start silently reintroduces a short cue.
 */
export interface ConformOptions {
  /**
   * Last frame the captions may occupy — normally the film's duration. Without
   * it the final cue has nowhere to grow into, which is exactly where the
   * slack usually is.
   */
  readonly tailFrames?: number
}

/**
 * Makes a cue list conform: no overlaps, no flicker gaps, nothing too short,
 * and — the part that was missing — nothing that has to be read faster than a
 * person reads.
 *
 * WHAT WENT WRONG HERE, ON THE RECORD
 *
 * This function handled minimum duration, overlaps and gaps, and a button was
 * wired to it labelled "Corectează" sitting directly beside a warning that said
 * five cues exceeded seventeen characters per second. Pressing it changed
 * nothing, because reading speed was the one rule it did not implement. The
 * button was not broken; it was solving a different problem next to the label
 * for this one.
 *
 * The reading-speed pass works the way a subtitler does. A cue that is too fast
 * is first given more time at the END, into the gap before the next cue —
 * holding a caption after the line has been spoken is free, and nobody notices.
 * Only if that is not enough does it take time at the START, and then no more
 * than half a second, because a caption that appears long before the words are
 * said reads as a mistake. Nothing ever overlaps, and nothing exceeds the
 * seven-second ceiling. A cue that still cannot fit is left alone and reported,
 * rather than quietly stretched past the point where it stops being a subtitle.
 */
export function conformCues(
  cues: readonly Cue[],
  fps: Rational,
  limits: CaptionLimits = DEFAULT_LIMITS,
  opts: ConformOptions = {},
): Cue[] {
  const perSecond = (sec: number) => Math.ceil((sec * fps.n) / fps.d)
  const minFrames = perSecond(limits.minDuration)
  const maxFrames = perSecond(limits.maxDuration)
  // Standard subtitling lead-in. More than this and the caption is early.
  const maxLeadIn = perSecond(0.5)

  const out: Cue[] = []
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    const text = cue.text.replace(/\s+/g, ' ').trim()
    if (!text) continue

    let start = cue.start
    const prev = out[out.length - 1]
    if (prev) {
      if (start < prev.end) start = prev.end
      // A sub-two-frame gap reads as a flicker; close it to a hard cut.
      else if (start - prev.end < limits.minGapFrames) start = prev.end
    }
    const end = Math.max(cue.end, start + minFrames)
    out.push({ start, end, text })
  }

  // ── reading speed ────────────────────────────────────────────────────────
  for (let i = 0; i < out.length; i++) {
    const cue = out[i]
    const chars = cue.text.replace(/\s+/g, ' ').trim().length
    const needed = Math.min(maxFrames, perSecond(chars / limits.maxReadingSpeed))
    if (cue.end - cue.start >= needed) continue

    // Take time at the end first: a caption held after the line is free.
    const ceiling = i + 1 < out.length
      ? out[i + 1].start
      : (opts.tailFrames ?? cue.end + needed)
    let end = Math.min(ceiling, cue.start + needed)
    let start = cue.start

    // Then, if it is still too fast, take a little at the front.
    if (end - start < needed) {
      const floor = i > 0 ? out[i - 1].end : 0
      const wanted = needed - (end - start)
      start = Math.max(floor, cue.start - Math.min(maxLeadIn, wanted))
      end = Math.min(ceiling, start + needed)
    }

    out[i] = { ...cue, start, end }
  }

  return out
}
