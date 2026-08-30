// lib/timeline/compile.ts
//
// Flattens a timeline at one frame into a resolved draw list in absolute
// pixels, with no timeline concepts left in it.
//
// This is the seam that makes the renderer replaceable. The browser preview,
// the interim render API and the ffmpeg worker that replaces it all consume
// this same structure, so a picture that previews correctly renders correctly —
// which is not true today, where the preview and the export are separate code.

import { evalNumber, evalPoint } from './animate'
import { clipEnd } from './document'
import { framesToSeconds } from './time'
import type { Clip, Fit, Source, Timeline, Track } from './types'

export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface DrawOp {
  readonly clipId: string
  /**
   * The z of the track the op came from.
   *
   * The renderer needs it to separate PICTURE from GRAPHICS. The house grade is
   * applied over the assembled cut, and a grade that also lands on the titles
   * means the brand red is not the brand red — a warm look at 0.85 turns white
   * type cream and pulls the accent off its own value. Broadcast practice is to
   * grade the picture and lay graphics over it ungraded, and that split has to
   * happen somewhere. It happens here.
   */
  readonly z: number
  readonly source: Source
  /** Seconds into the source media. Zero for stills, text and shapes. */
  readonly sourceTime: number
  /** Where to draw, in master pixels. */
  readonly dest: PixelRect
  /** What to take from the source, in source pixels. Absent means all of it. */
  readonly crop?: PixelRect
  readonly opacity: number
  readonly rotation: number
}

export interface AudioOp {
  readonly clipId: string
  readonly url: string
  readonly sourceTime: number
  readonly gain: number
  readonly duckTarget: boolean
  readonly duckSource: boolean
}

export interface CompiledFrame {
  readonly frame: number
  readonly time: number
  /** Back to front. */
  readonly video: readonly DrawOp[]
  readonly audio: readonly AudioOp[]
}

/** −18 dB under the voice. Broadcast practice, and what "ducked" should mean. */
export const DUCK_GAIN = 0.125

/**
 * Tracks at or above this z are GRAPHICS: captions, titles, lower thirds, end
 * cards. Everything below is PICTURE. The house grade is applied to the picture
 * only, so type keeps the colour the brand kit says it has.
 */
export const GRAPHICS_Z = 10

export function isGraphic(op: DrawOp): boolean {
  return op.z >= GRAPHICS_Z
}

function activeAt(clip: Clip, frame: number): boolean {
  return clip.enabled && frame >= clip.start && frame < clipEnd(clip)
}

function fadeFactor(clip: Clip, local: number): number {
  const fadeIn = Math.max(0, clip.fadeIn)
  const fadeOut = Math.max(0, clip.fadeOut)
  let f = 1
  if (fadeIn > 0 && local < fadeIn) f *= local / fadeIn
  const fromEnd = clip.duration - local
  if (fadeOut > 0 && fromEnd < fadeOut) f *= fromEnd / fadeOut
  return f < 0 ? 0 : f > 1 ? 1 : f
}

function sourceAspect(source: Source): number | null {
  if (source.kind === 'image' || source.kind === 'video') {
    if (source.naturalWidth && source.naturalHeight) {
      return source.naturalWidth / source.naturalHeight
    }
  }
  return null
}

/**
 * Fits a source of aspect `sa` into a box, then scales about the box centre.
 * `contain` letterboxes, `cover` fills and overflows, `fill` distorts.
 */
export function fitRect(
  fit: Fit,
  sa: number | null,
  box: PixelRect,
  scale: number,
): PixelRect {
  let w = box.w
  let h = box.h
  if (sa && fit !== 'fill') {
    const boxAspect = box.w / box.h
    const wider = sa > boxAspect
    const matchWidth = fit === 'contain' ? wider : !wider
    if (matchWidth) {
      w = box.w
      h = box.w / sa
    } else {
      h = box.h
      w = box.h * sa
    }
  }
  w *= scale
  h *= scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

function compileClip(
  clip: Clip,
  frame: number,
  width: number,
  height: number,
  fpsSeconds: (f: number) => number,
  z: number,
): DrawOp {
  const local = frame - clip.start
  const t = clip.transform
  const scale = evalNumber(t.scale, local)
  const centre = evalPoint(t.position, local)
  const opacity = evalNumber(t.opacity, local) * fadeFactor(clip, local)
  const rotation = evalNumber(t.rotation, local)

  // The clip's box is the full frame, recentred on its position...
  const box: PixelRect = {
    x: (centre.x - 0.5) * width,
    y: (centre.y - 0.5) * height,
    w: width,
    h: height,
  }
  // ...unless it is a shape that declares its own size, in which case the box
  // is that size, centred on the position. Same semantics either way: the
  // position is where the middle of the drawn thing lands.
  const sized = clip.source.kind === 'shape' && clip.source.size
    ? {
        x: centre.x * width - (clip.source.size.w * width * scale) / 2,
        y: centre.y * height - (clip.source.size.h * height * scale) / 2,
        w: clip.source.size.w * width * scale,
        h: clip.source.size.h * height * scale,
      }
    : null
  const dest = sized ?? fitRect(clip.fit, sourceAspect(clip.source), box, scale)

  const crop = t.crop
    ? {
        x: t.crop.x * (clip.source.kind === 'image' || clip.source.kind === 'video'
          ? clip.source.naturalWidth ?? width
          : width),
        y: t.crop.y * (clip.source.kind === 'image' || clip.source.kind === 'video'
          ? clip.source.naturalHeight ?? height
          : height),
        w: t.crop.w * (clip.source.kind === 'image' || clip.source.kind === 'video'
          ? clip.source.naturalWidth ?? width
          : width),
        h: t.crop.h * (clip.source.kind === 'image' || clip.source.kind === 'video'
          ? clip.source.naturalHeight ?? height
          : height),
      }
    : undefined

  return {
    clipId: clip.id,
    z,
    source: clip.source,
    sourceTime: clip.source.kind === 'video' ? fpsSeconds(clip.sourceIn + local) : 0,
    dest,
    ...(crop ? { crop } : {}),
    opacity,
    rotation,
  }
}

function byZ(a: Track, b: Track): number {
  return a.z - b.z
}

export function compileFrame(tl: Timeline, frame: number): CompiledFrame {
  const { width, height, fps } = tl.timebase
  const toSeconds = (f: number) => framesToSeconds(f, fps)

  const video: DrawOp[] = []
  const audio: AudioOp[] = []

  for (const track of [...tl.tracks].sort(byZ)) {
    if (!track.enabled) continue
    for (const clip of track.clips) {
      if (!activeAt(clip, frame)) continue
      const local = frame - clip.start

      if (track.kind === 'video') {
        const op = compileClip(clip, frame, width, height, toSeconds, track.z)
        if (op.opacity > 0.001) video.push(op)
        // A video clip can also carry sound.
        if (clip.source.kind === 'video' && clip.audio) {
          audio.push({
            clipId: clip.id,
            url: clip.source.url,
            sourceTime: toSeconds(clip.sourceIn + local),
            gain: evalNumber(clip.audio.gain, local) * fadeFactor(clip, local),
            duckTarget: clip.audio.duckTarget === true,
            duckSource: clip.audio.duckSource === true,
          })
        }
        continue
      }

      if (clip.source.kind !== 'audio') continue
      audio.push({
        clipId: clip.id,
        url: clip.source.url,
        sourceTime: toSeconds(clip.sourceIn + local),
        gain: evalNumber(clip.audio?.gain ?? 1, local) * fadeFactor(clip, local),
        duckTarget: clip.audio?.duckTarget === true,
        duckSource: clip.audio?.duckSource === true,
      })
    }
  }

  // Real ducking: any target is pulled down while a source is actually sounding.
  const voiceActive = audio.some(a => a.duckSource && a.gain > 0.001)
  const ducked = voiceActive
    ? audio.map(a => (a.duckTarget ? { ...a, gain: a.gain * DUCK_GAIN } : a))
    : audio

  return { frame, time: toSeconds(frame), video, audio: ducked }
}

/** Every frame index the render will visit. */
export function frameRange(tl: Timeline): number[] {
  const out: number[] = []
  for (let f = 0; f < tl.duration; f++) out.push(f)
  return out
}

/** The frames where the draw list changes — cut points, for a cheap preview. */
export function cutFrames(tl: Timeline): number[] {
  const set = new Set<number>([0])
  for (const track of tl.tracks) {
    for (const clip of track.clips) {
      set.add(clip.start)
      set.add(clipEnd(clip))
    }
  }
  return [...set].filter(f => f >= 0 && f <= tl.duration).sort((a, b) => a - b)
}
