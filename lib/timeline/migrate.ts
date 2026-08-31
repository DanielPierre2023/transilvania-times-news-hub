// lib/timeline/migrate.ts
//
// Lossless upgrade from the scene-list projects already saved in
// studio_projects. Nothing a user made is thrown away, and two things are
// gained on the way through:
//
//   • the master goes to 1080p — the old aspect presets topped out at 720p
//   • Ken Burns stops being an enum and becomes real keyframes, so the motion
//     that was previously fixed is now editable

import { ramp } from './animate'
import { addClip, createTimeline, emptyTrack, IDENTITY_TRANSFORM, newId } from './document'
import { FPS, secondsToFrames } from './time'
import type { Rational } from './time'
import type { Clip, TextStyle, Timeline, Track, Transform } from './types'

export type LegacyKenBurns = 'none' | 'in' | 'out' | 'left' | 'right'
export type LegacyAspect = '9:16' | '1:1' | '4:5' | '16:9'
export type LegacySubPos = 'jos' | 'treime' | 'sus'

export interface LegacyScene {
  id: string
  kind: 'image' | 'video'
  url: string
  name: string
  /** Seconds. */
  duration: number
  kb: LegacyKenBurns
}

export interface LegacyCue {
  /** Seconds. */
  start: number
  end: number
  text: string
}

export interface LegacyWord {
  word: string
  /** Seconds. */
  start: number
  end: number
}

/**
 * The exact shape stored in studio_projects.data today. The key names are the
 * abbreviated ones the page actually writes (voDur, musicVol, subsOn) — not
 * the tidier names they should have had. Reading anything else silently drops
 * the voice and the music from every existing project.
 */
export interface LegacyProject {
  aspect?: LegacyAspect
  scenes?: LegacyScene[]
  script?: string
  lang?: string
  tone?: string
  elVoiceId?: string
  geminiVoice?: string
  voice?: string
  voUrl?: string
  /** Seconds. */
  voDur?: number
  cues?: LegacyCue[]
  words?: LegacyWord[]
  capMode?: 'clasic' | 'karaoke'
  subsOn?: boolean
  subPos?: LegacySubPos
  subScale?: number
  musicUrl?: string
  musicVol?: number
}

/** 1080p equivalents of the old 720p presets. Even numbers, as H.264 requires. */
const MASTER: Record<LegacyAspect, [number, number]> = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
}

const SUB_Y: Record<LegacySubPos, number> = { jos: 0.88, treime: 0.76, sus: 0.14 }

const SUBTITLE_STYLE: TextStyle = {
  family: 'Inter, system-ui, sans-serif',
  size: 0.045,
  weight: 600,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.25,
  background: 'rgba(21,11,6,0.72)',
  padding: 0.012,
  maxWidth: 0.86,
}

/**
 * Ken Burns as keyframes.
 *
 * THE PAN USED TO PUT BLACK DOWN ONE EDGE, AND THE ARITHMETIC SAYS SO.
 *
 * A pan works by drawing the picture larger than the frame and sliding it. The
 * spare picture either side is (scale - 1) / 2 of the frame width; the slide
 * has to stay inside that, or the far edge runs out of picture and the frame
 * shows through. The old values were scale 1.08 with a slide of +/-0.06: the
 * overscan is 0.04 and the slide is 0.06, so at each end of the move the frame
 * was short by 0.02 of its width. On a 1080-wide master that is a **21.6 px
 * black bar** down one side at the start and the other at the end, on every
 * panning scene ever rendered. Measured, not deduced — fitRect returns
 * x = +21.6 at centre 0.56, scale 1.08.
 *
 * Now the slide is +/-0.04 against scale 1.10, so the overscan is 0.05 and
 * there is 10.8 px of picture still in hand at the extremes. The move is
 * slightly smaller and it is a move rather than a defect.
 */
export function kenBurns(kb: LegacyKenBurns, durationFrames: number): Transform {
  const d = Math.max(1, durationFrames)
  switch (kb) {
    case 'in':
      return { ...IDENTITY_TRANSFORM, scale: ramp(1, 1.12, d) }
    case 'out':
      return { ...IDENTITY_TRANSFORM, scale: ramp(1.12, 1, d) }
    case 'left':
      return {
        ...IDENTITY_TRANSFORM,
        scale: PAN_SCALE,
        position: ramp({ x: 0.5 + PAN_THROW, y: 0.5 }, { x: 0.5 - PAN_THROW, y: 0.5 }, d),
      }
    case 'right':
      return {
        ...IDENTITY_TRANSFORM,
        scale: PAN_SCALE,
        position: ramp({ x: 0.5 - PAN_THROW, y: 0.5 }, { x: 0.5 + PAN_THROW, y: 0.5 }, d),
      }
    case 'none':
    default:
      return IDENTITY_TRANSFORM
  }
}

/** Overscan for a pan, and the slide it can afford. PAN_THROW < (PAN_SCALE-1)/2. */
export const PAN_SCALE = 1.10
export const PAN_THROW = 0.04

export interface MigrateOptions {
  /** Defaults to 25 — European broadcast. Pass FPS.web for social-only work. */
  fps?: Rational
}

export function migrateLegacyProject(
  project: LegacyProject,
  opts: MigrateOptions = {},
): Timeline {
  const fps = opts.fps ?? FPS.pal
  const aspect: LegacyAspect = project.aspect ?? '9:16'
  const [width, height] = MASTER[aspect]

  let tl = createTimeline({
    name: project.script?.trim().slice(0, 60) || 'Proiect importat',
    width,
    height,
    fps,
  })

  const videoTrack = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  const graphicTrack = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
  const voiceTrack = tl.tracks.find(t => t.kind === 'audio' && t.z === 0)
  const musicTrack = tl.tracks.find(t => t.kind === 'audio' && t.z === 1)
  if (!videoTrack || !graphicTrack || !voiceTrack || !musicTrack) return tl

  // --- picture -------------------------------------------------------------
  let playhead = 0
  for (const scene of project.scenes ?? []) {
    const duration = Math.max(1, secondsToFrames(scene.duration, fps))
    const clip: Clip = {
      id: newId('cl'),
      name: scene.name || 'Scenă',
      source: { kind: scene.kind, url: scene.url },
      start: playhead,
      duration,
      sourceIn: 0,
      // A CAMERA MOVE IS NOT A PROPERTY OF BEING A STILL.
      //
      // This read `scene.kind === 'image' ? kenBurns(...) : IDENTITY_TRANSFORM`,
      // so a generated CLIP could never be given one — and generated clips are
      // most of a film. A model that returns a locked-off five seconds then had
      // no way to be rescued, which is exactly how a timeline ends up measuring
      // 0.51, 0.48 and 0.37 %/s and reading as a slideshow. The preview, mean-
      // while, applied the move to any cached media, image or video: one more
      // way for what you watch and what you receive to disagree.
      transform: kenBurns(scene.kb, duration),
      fit: 'cover',
      fadeIn: 0,
      fadeOut: 0,
      enabled: true,
      ...(scene.kind === 'video' ? { audio: { gain: 0 } } : {}),
    }
    tl = addClip(tl, videoTrack.id, clip)
    playhead += duration
  }

  // --- voice ---------------------------------------------------------------
  if (project.voUrl) {
    const voFrames = Math.max(
      1,
      secondsToFrames(project.voDur ?? 0, fps) || playhead,
    )
    tl = addClip(tl, voiceTrack.id, {
      id: newId('cl'),
      name: 'Voce',
      source: { kind: 'audio', url: project.voUrl, naturalDuration: project.voDur },
      start: 0,
      duration: voFrames,
      sourceIn: 0,
      transform: IDENTITY_TRANSFORM,
      fit: 'contain',
      audio: { gain: 1, duckSource: true },
      fadeIn: 0,
      fadeOut: 0,
      enabled: true,
    })
  }

  // --- music ---------------------------------------------------------------
  if (project.musicUrl) {
    const total = Math.max(playhead, 1)
    tl = addClip(tl, musicTrack.id, {
      id: newId('cl'),
      name: 'Muzică',
      source: { kind: 'audio', url: project.musicUrl },
      start: 0,
      duration: total,
      sourceIn: 0,
      transform: IDENTITY_TRANSFORM,
      fit: 'contain',
      audio: { gain: project.musicVol ?? 0.18, duckTarget: true },
      fadeIn: 0,
      fadeOut: Math.min(secondsToFrames(1.5, fps), total),
      enabled: true,
    })
  }

  // --- subtitles -----------------------------------------------------------
  // subsOn, subPos and subScale are all carried. Karaoke word timings are kept
  // on the caption clip so nothing is lost when a karaoke project is imported.
  if (project.subsOn !== false && project.cues?.length) {
    const y = SUB_Y[project.subPos ?? 'jos']
    const scale = project.subScale ?? 1
    const style: TextStyle = { ...SUBTITLE_STYLE, size: SUBTITLE_STYLE.size * scale }
    const allWords = project.capMode === 'karaoke' ? project.words ?? [] : []

    for (const cue of project.cues) {
      const start = secondsToFrames(cue.start, fps)
      const duration = Math.max(1, secondsToFrames(cue.end - cue.start, fps))
      const words = allWords
        .filter(w => w.start < cue.end && w.end > cue.start)
        .map(w => ({
          word: w.word,
          start: secondsToFrames(w.start, fps) - start,
          end: secondsToFrames(w.end, fps) - start,
        }))

      tl = addClip(tl, graphicTrack.id, {
        id: newId('cl'),
        name: cue.text.slice(0, 40),
        source: {
          kind: 'text',
          text: cue.text,
          style,
          ...(words.length ? { words } : {}),
        },
        start,
        duration,
        sourceIn: 0,
        transform: { ...IDENTITY_TRANSFORM, position: { x: 0.5, y } },
        fit: 'contain',
        fadeIn: 0,
        fadeOut: 0,
        enabled: true,
      })
    }
  }

  return tl
}

/** True when a stored project row is still in the old scene-list shape. */
export function isLegacyProject(data: unknown): data is LegacyProject {
  if (typeof data !== 'object' || data === null) return false
  const rec = data as Record<string, unknown>
  if (rec.version === 1 && Array.isArray(rec.tracks)) return false
  return Array.isArray(rec.scenes)
}

/** Adds a track to an imported timeline, e.g. when a brand kit is applied. */
export function withExtraTrack(tl: Timeline, name: string, z: number): Timeline {
  const track: Track = emptyTrack('video', name, z)
  return { ...tl, tracks: [...tl.tracks, track] }
}
