// lib/timeline/render-spec.ts
//
// Compiles a timeline into a job for a hosted render service.
//
// This is the INTERIM renderer. It exists so that a real 1080p, 25 fps, H.264
// file with measured loudness can be produced before the owned ffmpeg worker
// is written — and, just as importantly, because sending a job to any render
// API forces the timeline to serialise properly, which is the piece the owned
// worker will read too. None of this work is thrown away when the worker lands.
//
// It is deliberately lossy in known ways, and it reports what it dropped rather
// than pretending. See `describeLimitations`.

import { evalNumber, evalPoint } from './animate'
import { clipEnd } from './document'
import { framesToSeconds, rate } from './time'
import type { Clip, Timeline, Track } from './types'

export type RenderProvider = 'shotstack' | 'creatomate'

/* -------------------------------------------------------------------------- */
/* Shotstack Edit                                                             */
/* -------------------------------------------------------------------------- */

export interface ShotstackAsset {
  type: 'video' | 'image' | 'audio' | 'html'
  src?: string
  trim?: number
  volume?: number
  html?: string
  css?: string
  width?: number
  height?: number
  background?: string
}

export interface ShotstackClip {
  asset: ShotstackAsset
  start: number
  length: number
  fit?: 'cover' | 'contain' | 'crop' | 'stretch'
  scale?: number
  position?: string
  offset?: { x: number; y: number }
  opacity?: number
  effect?: string
  transition?: { in?: string; out?: string }
  transform?: { rotate?: { angle: number } }
}

export interface ShotstackEdit {
  timeline: {
    background: string
    tracks: { clips: ShotstackClip[] }[]
  }
  output: {
    format: 'mp4'
    size: { width: number; height: number }
    fps: number
    quality: 'low' | 'medium' | 'high'
  }
}

const round = (n: number, places = 3): number => {
  const f = Math.pow(10, places)
  return Math.round(n * f) / f
}

/**
 * Ken Burns as a preset. The service takes named effects, not curves, so a
 * scale or position ramp is matched to the nearest preset and anything more
 * elaborate is reported as dropped instead of being silently flattened.
 */
function motionPreset(clip: Clip): string | undefined {
  const last = Math.max(0, clip.duration - 1)
  const s0 = evalNumber(clip.transform.scale, 0)
  const s1 = evalNumber(clip.transform.scale, last)
  if (s1 - s0 > 0.01) return 'zoomIn'
  if (s0 - s1 > 0.01) return 'zoomOut'

  const p0 = evalPoint(clip.transform.position, 0)
  const p1 = evalPoint(clip.transform.position, last)
  if (p1.x - p0.x > 0.01) return 'slideRight'
  if (p0.x - p1.x > 0.01) return 'slideLeft'
  if (p1.y - p0.y > 0.01) return 'slideDown'
  if (p0.y - p1.y > 0.01) return 'slideUp'
  return undefined
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function captionClip(clip: Clip, tl: Timeline): ShotstackClip | null {
  if (clip.source.kind !== 'text') return null
  const { fps, width, height } = tl.timebase
  const style = clip.source.style
  const centre = evalPoint(clip.transform.position, 0)
  const boxWidth = Math.round(width * (style.maxWidth ?? 0.86))
  // Short edge, so vertical and horizontal masters get the same apparent size.
  const shortEdge = Math.min(width, height)
  const fontSize = Math.round(shortEdge * style.size)
  const pad = Math.round(shortEdge * (style.padding ?? 0.012))

  const css = [
    `p{`,
    `font-family:${style.family.split(',')[0].replace(/['"]/g, '')};`,
    `font-size:${fontSize}px;`,
    `font-weight:${style.weight};`,
    `color:${style.color};`,
    `line-height:${style.lineHeight};`,
    `text-align:${style.align};`,
    style.background ? `background-color:${style.background};` : '',
    `padding:${pad}px ${pad * 2}px;`,
    `margin:0;`,
    `}`,
  ].join('')

  return {
    asset: {
      type: 'html',
      html: `<p>${escapeHtml(clip.source.text)}</p>`,
      css,
      width: boxWidth,
      height: Math.round(fontSize * style.lineHeight * 2.6 + pad * 2),
      background: 'transparent',
    },
    start: round(framesToSeconds(clip.start, fps)),
    length: round(framesToSeconds(clip.duration, fps)),
    position: 'center',
    offset: { x: round(centre.x - 0.5), y: round(0.5 - centre.y) },
    opacity: round(evalNumber(clip.transform.opacity, 0)),
  }
}

function mediaClip(clip: Clip, tl: Timeline): ShotstackClip | null {
  const src = clip.source
  if (src.kind !== 'image' && src.kind !== 'video' && src.kind !== 'audio') return null
  const { fps } = tl.timebase
  const start = round(framesToSeconds(clip.start, fps))
  const length = round(framesToSeconds(clip.duration, fps))

  if (src.kind === 'audio') {
    return {
      asset: {
        type: 'audio',
        src: src.url,
        trim: round(framesToSeconds(clip.sourceIn, fps)),
        volume: round(evalNumber(clip.audio?.gain ?? 1, 0)),
      },
      start,
      length,
    }
  }

  const centre = evalPoint(clip.transform.position, 0)
  const out: ShotstackClip = {
    asset:
      src.kind === 'video'
        ? {
            type: 'video',
            src: src.url,
            trim: round(framesToSeconds(clip.sourceIn, fps)),
            volume: round(evalNumber(clip.audio?.gain ?? 0, 0)),
          }
        : { type: 'image', src: src.url },
    start,
    length,
    fit: clip.fit === 'fill' ? 'stretch' : clip.fit,
    position: 'center',
    offset: { x: round(centre.x - 0.5), y: round(0.5 - centre.y) },
    opacity: round(evalNumber(clip.transform.opacity, 0)),
  }

  const scale = evalNumber(clip.transform.scale, 0)
  if (Math.abs(scale - 1) > 0.001) out.scale = round(scale)

  const rotation = evalNumber(clip.transform.rotation, 0)
  if (Math.abs(rotation) > 0.001) out.transform = { rotate: { angle: round(rotation, 1) } }

  const effect = motionPreset(clip)
  if (effect) out.effect = effect

  if (clip.fadeIn > 0) out.transition = { ...out.transition, in: 'fade' }
  if (clip.fadeOut > 0) out.transition = { ...out.transition, out: 'fade' }

  return out
}

/** Shotstack layers the FIRST track on top; the timeline stores highest z on top. */
function orderedTracks(tl: Timeline): Track[] {
  return [...tl.tracks].filter(t => t.enabled && t.clips.length > 0).sort((a, b) => b.z - a.z)
}

export interface ShotstackOptions {
  /** Overrides the timeline's own master size, e.g. to render a proof at 720p. */
  size?: { width: number; height: number }
  quality?: 'low' | 'medium' | 'high'
  background?: string
}

export function toShotstackEdit(tl: Timeline, opts: ShotstackOptions = {}): ShotstackEdit {
  const tracks: { clips: ShotstackClip[] }[] = []

  for (const track of orderedTracks(tl)) {
    const clips: ShotstackClip[] = []
    for (const clip of track.clips) {
      if (!clip.enabled) continue
      const built = clip.source.kind === 'text' ? captionClip(clip, tl) : mediaClip(clip, tl)
      if (built) clips.push(built)
    }
    if (clips.length) tracks.push({ clips })
  }

  return {
    timeline: {
      background: opts.background ?? '#000000',
      tracks,
    },
    output: {
      format: 'mp4',
      size: opts.size ?? { width: tl.timebase.width, height: tl.timebase.height },
      fps: Math.round(rate(tl.timebase.fps)),
      quality: opts.quality ?? 'high',
    },
  }
}

/* -------------------------------------------------------------------------- */
/* What the interim renderer cannot do                                        */
/* -------------------------------------------------------------------------- */

export interface Limitation {
  readonly where: string
  readonly message: string
}

/**
 * Reports what this job will lose relative to the timeline. Say it out loud in
 * the interface: a motion curve quietly replaced by a preset is exactly the
 * kind of difference that is noticed after delivery rather than before.
 */
export function describeLimitations(tl: Timeline): Limitation[] {
  const out: Limitation[] = []
  const isCurve = (v: unknown): boolean =>
    typeof v === 'object' && v !== null && 'keys' in (v as Record<string, unknown>)

  for (const track of tl.tracks) {
    for (const clip of track.clips) {
      const where = `${track.name} / ${clip.name}`
      const t = clip.transform
      if (isCurve(t.scale) || isCurve(t.position)) {
        out.push({ where, message: 'Motion curve replaced by the nearest preset (zoom or slide).' })
      }
      if (isCurve(t.opacity)) {
        out.push({ where, message: 'Opacity curve flattened to its first value; only fades survive.' })
      }
      if (isCurve(t.rotation)) {
        out.push({ where, message: 'Rotation curve flattened to its first value.' })
      }
      if (isCurve(clip.audio?.gain)) {
        out.push({ where, message: 'Gain automation flattened; the service takes one level per clip.' })
      }
      if (clip.audio?.duckTarget) {
        out.push({ where, message: 'Ducking is not applied by the service — set the music level manually.' })
      }
      if (t.crop) {
        out.push({ where, message: 'Crop is not carried across.' })
      }
      if (clip.source.kind === 'text' && clip.source.words?.length) {
        out.push({ where, message: 'Karaoke word timings are not carried; the caption renders as one block.' })
      }
    }
  }
  // One line per distinct message keeps the list readable.
  const seen = new Set<string>()
  return out.filter(l => {
    const key = `${l.where}|${l.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* -------------------------------------------------------------------------- */
/* Provider responses and cost                                                */
/* -------------------------------------------------------------------------- */

export type JobState = 'queued' | 'rendering' | 'done' | 'failed'

export interface JobStatus {
  readonly state: JobState
  readonly url?: string
  readonly message?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0])
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Both providers bury the job id differently. Neither is guessable from the other. */
export function readJobId(provider: RenderProvider, body: unknown): string | null {
  const root = asRecord(body)
  if (!root) return null
  if (provider === 'shotstack') {
    const response = asRecord(root.response)
    const id = response?.id ?? root.id
    return typeof id === 'string' && id ? id : null
  }
  const id = root.id
  return typeof id === 'string' && id ? id : null
}

export function readJobStatus(provider: RenderProvider, body: unknown): JobStatus {
  const root = asRecord(body)
  if (!root) return { state: 'failed', message: 'Empty response from the render service.' }

  if (provider === 'shotstack') {
    const response = asRecord(root.response) ?? root
    const status = String(response.status ?? '')
    const url = typeof response.url === 'string' ? response.url : undefined
    const message = typeof response.error === 'string' ? response.error : undefined
    if (status === 'done') return { state: 'done', url, message }
    if (status === 'failed') return { state: 'failed', message: message ?? 'Render failed.' }
    if (status === 'queued' || status === 'fetching') return { state: 'queued' }
    return { state: 'rendering' }
  }

  const status = String(root.status ?? '')
  const url = typeof root.url === 'string' ? root.url : undefined
  const message = typeof root.error_message === 'string' ? root.error_message : undefined
  if (status === 'succeeded') return { state: 'done', url, message }
  if (status === 'failed') return { state: 'failed', message: message ?? 'Render failed.' }
  if (status === 'planned' || status === 'waiting') return { state: 'queued' }
  return { state: 'rendering' }
}

/** Published rates, August 2026. Subscription is the cheaper of the two. */
export const RENDER_RATES = {
  shotstack: { subscriptionPerMinute: 0.2, payAsYouGoPerMinute: 0.3 },
} as const

export function estimateCostUsd(tl: Timeline, perMinute = RENDER_RATES.shotstack.subscriptionPerMinute): number {
  const seconds = framesToSeconds(tl.duration, tl.timebase.fps)
  return (seconds / 60) * perMinute
}

/** Longest clip end in seconds — what a service actually bills for. */
export function billableSeconds(tl: Timeline): number {
  let max = 0
  for (const track of tl.tracks) {
    for (const clip of track.clips) max = Math.max(max, clipEnd(clip))
  }
  return framesToSeconds(Math.max(max, tl.duration), tl.timebase.fps)
}
