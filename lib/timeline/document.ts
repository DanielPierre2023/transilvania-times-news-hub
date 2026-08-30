// lib/timeline/document.ts
//
// Construction, validation and immutable edits.
//
// Every mutator returns a new Timeline. That is what makes versions cheap and
// diffs meaningful: two saves can be compared, and an approved version can
// never be altered underneath the person who approved it.

import { FPS, framesToSeconds, secondsToFrames } from './time'
import type { Rational } from './time'
import type {
  Clip,
  DeliverySpec,
  Marker,
  Timebase,
  Timeline,
  Track,
  TrackKind,
  Transform,
} from './types'

export const DEFAULT_DELIVERY: DeliverySpec = {
  loudness: 'social',
  codec: 'h264',
  captions: ['burn', 'srt'],
  // A grade is on by default. Every film that shipped without one looked like
  // five different films.
  grade: { look: 'warm', strength: 0.85 },
}

export const IDENTITY_TRANSFORM: Transform = {
  position: { x: 0.5, y: 0.5 },
  scale: 1,
  rotation: 0,
  opacity: 1,
}

let counter = 0
export function newId(prefix = 'x'): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`
}

export interface CreateTimelineOptions {
  name: string
  width: number
  height: number
  fps?: Rational
  sampleRate?: number
  delivery?: DeliverySpec
}

export function createTimeline(opts: CreateTimelineOptions): Timeline {
  const now = new Date().toISOString()
  const timebase: Timebase = {
    fps: opts.fps ?? FPS.pal,
    width: opts.width,
    height: opts.height,
    sampleRate: opts.sampleRate ?? 48000,
  }
  return {
    version: 1,
    id: newId('tl'),
    name: opts.name,
    timebase,
    duration: 0,
    tracks: [
      emptyTrack('video', 'Video', 0),
      emptyTrack('video', 'Grafică', 10),
      emptyTrack('audio', 'Voce', 0),
      emptyTrack('audio', 'Muzică', 1),
    ],
    markers: [],
    delivery: opts.delivery ?? DEFAULT_DELIVERY,
    createdAt: now,
    updatedAt: now,
  }
}

export function emptyTrack(kind: TrackKind, name: string, z: number): Track {
  return { id: newId('tr'), kind, name, z, enabled: true, locked: false, clips: [] }
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration
}

/** Longest track end. The authoritative duration is stored, not derived, but
 *  this is what to store after an edit. */
export function contentDuration(tl: Timeline): number {
  let max = 0
  for (const track of tl.tracks) {
    for (const clip of track.clips) {
      const end = clipEnd(clip)
      if (end > max) max = end
    }
  }
  return max
}

function touch(tl: Timeline, tracks: readonly Track[]): Timeline {
  const next: Timeline = { ...tl, tracks, updatedAt: new Date().toISOString() }
  return { ...next, duration: contentDuration(next) }
}

function mapTrack(
  tl: Timeline,
  trackId: string,
  fn: (t: Track) => Track,
): Timeline {
  return touch(
    tl,
    tl.tracks.map(t => (t.id === trackId ? fn(t) : t)),
  )
}

function sortClips(clips: readonly Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
}

export function addClip(tl: Timeline, trackId: string, clip: Clip): Timeline {
  return mapTrack(tl, trackId, t => ({ ...t, clips: sortClips([...t.clips, clip]) }))
}

export function removeClip(tl: Timeline, clipId: string): Timeline {
  return touch(
    tl,
    tl.tracks.map(t => ({ ...t, clips: t.clips.filter(c => c.id !== clipId) })),
  )
}

export function updateClip(
  tl: Timeline,
  clipId: string,
  patch: Partial<Clip>,
): Timeline {
  return touch(
    tl,
    tl.tracks.map(t => {
      if (!t.clips.some(c => c.id === clipId)) return t
      return {
        ...t,
        clips: sortClips(t.clips.map(c => (c.id === clipId ? { ...c, ...patch } : c))),
      }
    }),
  )
}

/** Trim without moving the picture: pulling the head in also advances sourceIn. */
export function trimClip(
  tl: Timeline,
  clipId: string,
  edge: 'head' | 'tail',
  deltaFrames: number,
): Timeline {
  const clip = findClip(tl, clipId)
  if (!clip) return tl
  if (edge === 'tail') {
    const duration = Math.max(1, clip.duration + deltaFrames)
    return updateClip(tl, clipId, { duration })
  }
  const shift = Math.min(deltaFrames, clip.duration - 1)
  return updateClip(tl, clipId, {
    start: clip.start + shift,
    duration: clip.duration - shift,
    sourceIn: Math.max(0, clip.sourceIn + shift),
  })
}

export function moveClip(tl: Timeline, clipId: string, toFrame: number): Timeline {
  return updateClip(tl, clipId, { start: Math.max(0, Math.round(toFrame)) })
}

/** Splits at an absolute timeline frame. The right half keeps reading the source. */
export function splitClip(tl: Timeline, clipId: string, atFrame: number): Timeline {
  const clip = findClip(tl, clipId)
  const track = tl.tracks.find(t => t.clips.some(c => c.id === clipId))
  if (!clip || !track) return tl
  const offset = atFrame - clip.start
  if (offset <= 0 || offset >= clip.duration) return tl

  const left: Clip = { ...clip, duration: offset, fadeOut: 0 }
  const right: Clip = {
    ...clip,
    id: newId('cl'),
    start: clip.start + offset,
    duration: clip.duration - offset,
    sourceIn: clip.sourceIn + offset,
    fadeIn: 0,
  }
  return mapTrack(tl, track.id, t => ({
    ...t,
    clips: sortClips([...t.clips.filter(c => c.id !== clipId), left, right]),
  }))
}

export function findClip(tl: Timeline, clipId: string): Clip | null {
  for (const track of tl.tracks) {
    const found = track.clips.find(c => c.id === clipId)
    if (found) return found
  }
  return null
}

export function addMarker(tl: Timeline, marker: Omit<Marker, 'id'>): Timeline {
  const next: Marker = { ...marker, id: newId('mk') }
  return {
    ...tl,
    markers: [...tl.markers, next].sort((a, b) => a.frame - b.frame),
    updatedAt: new Date().toISOString(),
  }
}

export interface Problem {
  readonly severity: 'error' | 'warning'
  readonly where: string
  readonly message: string
}

/**
 * Everything that would make a render wrong or a delivery fail. Run this before
 * queueing a job, not after — a render that fails QC has already cost money.
 */
export function validate(tl: Timeline): Problem[] {
  const out: Problem[] = []
  const { fps, width, height } = tl.timebase

  if (width % 2 !== 0 || height % 2 !== 0) {
    out.push({
      severity: 'error',
      where: 'timebase',
      message: `H.264 requires even dimensions; got ${width}×${height}.`,
    })
  }
  if (tl.duration <= 0) {
    out.push({ severity: 'error', where: 'timeline', message: 'Timeline is empty.' })
  }

  const seen = new Set<string>()
  for (const track of tl.tracks) {
    const ordered = sortClips(track.clips)
    for (let i = 0; i < ordered.length; i++) {
      const clip = ordered[i]
      const where = `${track.name} / ${clip.name}`

      if (seen.has(clip.id)) {
        out.push({ severity: 'error', where, message: 'Duplicate clip id.' })
      }
      seen.add(clip.id)

      if (clip.duration < 1) {
        out.push({ severity: 'error', where, message: 'Duration is under one frame.' })
      }
      if (clip.start < 0 || clip.sourceIn < 0) {
        out.push({ severity: 'error', where, message: 'Negative start or source in-point.' })
      }
      if (clip.fadeIn + clip.fadeOut > clip.duration) {
        out.push({ severity: 'warning', where, message: 'Fades overlap; they will be clamped.' })
      }

      const src = clip.source
      if ((src.kind === 'video' || src.kind === 'audio') && src.naturalDuration) {
        const need = framesToSeconds(clip.sourceIn + clip.duration, fps)
        if (need > src.naturalDuration + 0.04) {
          out.push({
            severity: 'error',
            where,
            message: `Reads ${need.toFixed(2)}s of a ${src.naturalDuration.toFixed(2)}s source.`,
          })
        }
      }

      const prev = ordered[i - 1]
      if (prev && clip.start < clipEnd(prev)) {
        out.push({
          severity: track.kind === 'video' ? 'warning' : 'error',
          where,
          message:
            track.kind === 'video'
              ? 'Overlaps the previous clip; the upper track wins.'
              : 'Audio clips overlap on one track; put them on separate tracks.',
        })
      }
    }
  }

  if (!tl.tracks.some(t => t.kind === 'audio' && t.clips.length > 0)) {
    out.push({ severity: 'warning', where: 'audio', message: 'No audio on the timeline.' })
  }
  return out
}

export function isRenderable(tl: Timeline): boolean {
  return !validate(tl).some(p => p.severity === 'error')
}

/** Seconds helper for interfaces that still think in seconds. */
export function seconds(tl: Timeline, frames: number): number {
  return framesToSeconds(frames, tl.timebase.fps)
}

export function frames(tl: Timeline, sec: number): number {
  return secondsToFrames(sec, tl.timebase.fps)
}
