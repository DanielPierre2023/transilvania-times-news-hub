// lib/timeline/time.ts
//
// Frame-accurate time. Everything in the timeline is counted in FRAMES, never
// in floating-point seconds — that is the whole point of the module. Seconds
// are a display and playback concern and are derived at the edges.
//
// Frame rates are rational because 23.976 and 29.97 are not decimals: they are
// 24000/1001 and 30000/1001. Storing them as 23.976 accumulates drift that a
// broadcaster will find.

export interface Rational {
  readonly n: number
  readonly d: number
}

/** The frame rates worth supporting. Anything else can be passed literally. */
export const FPS = {
  /** 23.976 — film-originated web delivery */
  film: { n: 24000, d: 1001 } as Rational,
  /** 25 — EBU / PAL broadcast, the European default */
  pal: { n: 25, d: 1 } as Rational,
  /** 29.97 — NTSC broadcast, drop-frame timecode */
  ntsc: { n: 30000, d: 1001 } as Rational,
  /** 30 — the social default */
  web: { n: 30, d: 1 } as Rational,
  /** 50 — EBU high frame rate */
  palHigh: { n: 50, d: 1 } as Rational,
  /** 59.94 */
  ntscHigh: { n: 60000, d: 1001 } as Rational,
  /** 60 */
  webHigh: { n: 60, d: 1 } as Rational,
} as const

export type FpsName = keyof typeof FPS

export function rate(r: Rational): number {
  return r.n / r.d
}

export function framesToSeconds(frames: number, fps: Rational): number {
  return (frames * fps.d) / fps.n
}

export function secondsToFrames(seconds: number, fps: Rational): number {
  return Math.round((seconds * fps.n) / fps.d)
}

/** Frames per second rounded to the nearest whole number — the timecode base. */
export function timecodeBase(fps: Rational): number {
  return Math.round(rate(fps))
}

/**
 * Drop-frame timecode applies only to rates derived from 1001, i.e. 29.97 and
 * 59.94. It drops timecode LABELS, never picture, to keep the clock honest.
 */
export function isDropFrame(fps: Rational): boolean {
  return fps.d === 1001 && (fps.n === 30000 || fps.n === 60000)
}

function pad(n: number, width = 2): string {
  return String(Math.floor(Math.abs(n))).padStart(width, '0')
}

/**
 * SMPTE timecode. Drop-frame is used automatically for 29.97 and 59.94 and is
 * written with a semicolon before the frames field, as the standard requires.
 */
export function formatTimecode(frames: number, fps: Rational): string {
  const base = timecodeBase(fps)
  const drop = isDropFrame(fps)
  const sign = frames < 0 ? '-' : ''
  let f = Math.abs(Math.round(frames))

  if (drop) {
    // Standard SMPTE conversion. Two frame LABELS (four at 59.94) are skipped
    // at the top of every minute except every tenth minute, so the timecode
    // clock tracks wall time to within a frame over an hour.
    const dropped = base === 30 ? 2 : 4
    const framesPer10Min = Math.round(rate(fps) * 600)
    const framesPerMin = base * 60 - dropped
    const tenMinBlocks = Math.floor(f / framesPer10Min)
    const remainder = Math.max(f % framesPer10Min, dropped)
    f += dropped * 9 * tenMinBlocks + dropped * Math.floor((remainder - dropped) / framesPerMin)
  }

  const ff = f % base
  const totalSeconds = Math.floor(f / base)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)
  const sep = drop ? ';' : ':'
  return `${sign}${pad(hh)}:${pad(mm)}:${pad(ss)}${sep}${pad(ff)}`
}

/** Accepts 00:00:00:00 and 00:00:00;00. Returns frames, or null if malformed. */
export function parseTimecode(tc: string, fps: Rational): number | null {
  const m = /^(-)?(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(tc.trim())
  if (!m) return null
  const base = timecodeBase(fps)
  const [, neg, h, mi, s, f] = m
  const hh = Number(h)
  const mm = Number(mi)
  const ss = Number(s)
  const ff = Number(f)
  if (mm > 59 || ss > 59 || ff >= base) return null

  let frames = ((hh * 60 + mm) * 60 + ss) * base + ff
  if (isDropFrame(fps)) {
    const dropped = base === 30 ? 2 : 4
    const totalMinutes = hh * 60 + mm
    frames -= dropped * (totalMinutes - Math.floor(totalMinutes / 10))
  }
  return neg ? -frames : frames
}

/** Human duration for the interface: 1:23, or 1:02:03 past an hour. */
export function formatDuration(frames: number, fps: Rational): string {
  const total = Math.max(0, Math.round(framesToSeconds(frames, fps)))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
