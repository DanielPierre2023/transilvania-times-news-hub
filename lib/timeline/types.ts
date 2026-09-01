// lib/timeline/types.ts
//
// The Studio project document.
//
// One rule governs the shape: anything a client can ask for in a notes round
// must be expressible as data. "Hold two seconds longer on shot two" is a
// duration change. "Drop the music under the VO from 0:14" is a keyframe on a
// gain property. The previous model — a scene list with one duration each —
// could express neither, which is why there was no way to take notes.

import type { Rational } from './time'

export type Ease = 'hold' | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

export interface Keyframe<T> {
  /** Frames from the start of the CLIP, not the timeline. Clips stay portable. */
  readonly frame: number
  readonly value: T
  /** Interpolation from this key to the next one. */
  readonly ease: Ease
}

/** A constant, or a curve. Constants stay cheap and diff cleanly. */
export type Animatable<T> = T | { readonly keys: readonly Keyframe<T>[] }

export interface Point {
  readonly x: number
  readonly y: number
}

/** Normalised 0..1 against the frame, so a timeline survives a resolution change. */
export interface NormRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export type Fit = 'contain' | 'cover' | 'fill'

export interface TextStyle {
  readonly family: string
  /** Fraction of the SHORT edge, so type scales with the master and does not
   *  triple in size when the same setting is used in a vertical frame. */
  readonly size: number
  readonly weight: number
  readonly color: string
  readonly align: 'left' | 'center' | 'right'
  readonly lineHeight: number
  readonly background?: string
  readonly padding?: number
  readonly maxWidth?: number
  /** Em, applied between characters. Uppercase kickers need it; body text does not. */
  readonly letterSpacing?: number
  /** Lines before the text is truncated. Captions want 2; a title card wants 3. */
  readonly maxLines?: number
  /** Drop shadow behind the type, for legibility over picture without a plate. */
  readonly shadow?: string
  /** Karaoke: the word being spoken right now. */
  readonly activeColor?: string
  /** Karaoke: words not yet spoken, as a CSS colour (usually the same, faded). */
  readonly pendingColor?: string
}

export interface MediaSource {
  readonly kind: 'image' | 'video' | 'audio'
  readonly url: string
  readonly naturalWidth?: number
  readonly naturalHeight?: number
  /** Seconds. Needed to reject a trim past the end of the source. */
  readonly naturalDuration?: number
}

export interface CaptionWord {
  readonly word: string
  /** Frames from the start of the CLIP. */
  readonly start: number
  readonly end: number
}

export interface TextSource {
  readonly kind: 'text'
  readonly text: string
  readonly style: TextStyle
  /** Word timings for karaoke captions. Absent means a plain caption. */
  readonly words?: readonly CaptionWord[]
}

export interface ShapeSource {
  readonly kind: 'shape'
  readonly shape: 'rect' | 'ellipse'
  readonly fill: string
  /**
   * Normalised size against the frame. Absent means the shape fills the frame,
   * which is what a scrim or an end-card ground wants. A rule under a title is
   * 0.16 wide and 0.006 tall, and without this it could only ever be a full
   * frame scaled uniformly — which is to say, never a rule.
   */
  readonly size?: { readonly w: number; readonly h: number }
}

/** A brand-kit template: a lower third, ticker or end card, bound to parameters. */
export interface TemplateSource {
  readonly kind: 'template'
  readonly template: string
  readonly params: Readonly<Record<string, string | number | boolean>>
}

/**
 * A block authored in HTML and CSS, rasterised once into a bitmap.
 *
 * It behaves as an image from the moment it is rasterised — the preview and the
 * renderer draw the SAME file, so there is no second engine and no way for the
 * two to disagree. The markup stays on the clip so the block can be re-opened,
 * edited and re-rasterised, and so a stale bitmap can be detected rather than
 * silently shipped. See lib/timeline/html.ts.
 */
export interface HtmlSource {
  readonly kind: 'html'
  readonly html: string
  readonly url?: string
  readonly naturalWidth?: number
  readonly naturalHeight?: number
  readonly stamp?: string
  /** One url per frame of the animated opening; after it, the last frame holds. */
  readonly frames?: readonly string[]
  readonly frameFps?: number
}

export type Source = MediaSource | TextSource | ShapeSource | TemplateSource | HtmlSource

export interface Transform {
  /** Normalised centre of the clip within the frame. */
  readonly position: Animatable<Point>
  readonly scale: Animatable<number>
  /** Degrees, clockwise. */
  readonly rotation: Animatable<number>
  readonly opacity: Animatable<number>
  /** Normalised crop taken from the SOURCE before fitting. */
  readonly crop?: NormRect
}

export interface ClipAudio {
  /**
   * The clip's own processing chain and its automation envelope.
   *
   * Normalisation and ducking were the whole of the audio stage: a good
   * mastering step and no processing at all. A voice recorded in a room still
   * sounded like a room. See lib/timeline/audio.ts.
   */
  readonly effects?: readonly import('./audio').AudioEffect[]
  readonly gainPoints?: readonly import('./audio').GainPoint[]

  /** Linear gain, 1 = unity. Keyframe this and you have manual ducking. */
  readonly gain: Animatable<number>
  /** Marks the clip as a ducking TARGET, pulled down under any duckSource. */
  readonly duckTarget?: boolean
  /** Marks the clip as the voice that triggers ducking. */
  readonly duckSource?: boolean
}

/**
 * A speed ramp, expressed as a curve over the clip's own timeline.
 *
 * THIS IS NOT A NEW DRAWING MODE, AND THAT IS THE WHOLE DESIGN.
 *
 * The compiler already turns a clip-local frame into a source time:
 * `sourceTime = (sourceIn + local) / fps`. A speed ramp changes nothing except
 * how fast `local` walks into the source. So a ramp is a time-warp function
 * applied before that division, and every renderer that could already seek a
 * video can play a ramp without learning anything new.
 *
 * `points` are (localFrame, rate) pairs. Rate 1 is real time, 2 is double
 * speed, 0.5 is half. Between two points the rate moves linearly, which is what
 * makes it a *ramp* rather than a step — and the source offset is therefore the
 * INTEGRAL of the rate curve, not the rate itself. Getting that wrong gives a
 * clip that plays at the right speed and starts from the wrong frame, which
 * looks like a sync bug and is very hard to see in a still.
 */
export interface SpeedPoint {
  /** Frames from the start of the clip. */
  readonly frame: number
  /** Playback rate at this instant. Clamped to 0.1..8 when applied. */
  readonly rate: number
}

export interface SpeedRamp {
  readonly points: readonly SpeedPoint[]
  /**
   * Audio follows the ramp only when the rate is CONSTANT.
   *
   * ffmpeg can retime audio (`atempo`) but not smoothly automate it, and a
   * pitch that slides during a ramp sounds broken rather than stylish. A ramped
   * clip therefore mutes its own audio and the linter says so, instead of
   * shipping a warble nobody asked for.
   */
  readonly audio?: 'follow' | 'mute'
}

/**
 * A mask over the clip, for wipes.
 *
 * A cross-dissolve needed no mask — it is two opacities. A wipe is genuinely a
 * new drawing mode: part of the clip is drawn and part is not, with a soft edge
 * between. Both engines implement it the same way — draw the clip to an
 * offscreen surface, then composite a linear or radial alpha gradient with
 * `destination-in` — so the preview and the render cannot drift.
 */
export type MaskKind =
  | 'wipeLeft' | 'wipeRight' | 'wipeUp' | 'wipeDown'
  | 'wipeDiagonal' | 'circle' | 'barnDoors'

export interface ClipMask {
  readonly kind: MaskKind
  /** 0 hides the clip entirely, 1 reveals all of it. Keyframe it to wipe. */
  readonly reveal: Animatable<number>
  /**
   * Width of the soft edge as a fraction of the frame. 0 is a hard edge.
   *
   * A hard-edged wipe reads as a graphic device; a soft one reads as a
   * transition. Default 0.06 — about 65 px on a 1080 frame, which is soft
   * enough not to alias and tight enough to still read as a wipe.
   */
  readonly softness?: number
}

export interface Clip {
  readonly id: string
  readonly name: string
  readonly source: Source
  /** Frames from the start of the timeline. */
  readonly start: number
  /** Frames. Never derived from the source — a trim is a first-class value. */
  readonly duration: number
  /** Frames into the source media. Zero for stills, text and shapes. */
  readonly sourceIn: number
  /** This shot's own colour, when the automatic grade is not what it needs. */
  readonly grade?: import('./grade').ShotGrade
  /** Plays the source faster or slower. Picture only; see SpeedRamp. */
  readonly speed?: SpeedRamp
  /** Reveals the clip through a shape. Wipes are built on this. */
  readonly mask?: ClipMask

  readonly transform: Transform
  readonly fit: Fit
  readonly audio?: ClipAudio
  /** Frames of opacity ramp at each end. */
  readonly fadeIn: number
  readonly fadeOut: number
  readonly enabled: boolean
}

export type TrackKind = 'video' | 'audio'

export interface Track {
  readonly id: string
  readonly kind: TrackKind
  readonly name: string
  /** Higher draws later, i.e. on top. Audio tracks sum regardless. */
  readonly z: number
  readonly enabled: boolean
  readonly locked: boolean
  readonly clips: readonly Clip[]
}

/** A timecoded note. Tier 1 approvals hang off these. */
export interface Marker {
  readonly id: string
  readonly frame: number
  readonly text: string
  readonly author?: string
  readonly resolved?: boolean
}

export interface Timebase {
  readonly fps: Rational
  readonly width: number
  readonly height: number
  readonly sampleRate: number
}

export type LoudnessTarget = 'broadcast' | 'social' | 'none'

export type LookName = 'none' | 'neutral' | 'warm' | 'golden' | 'cool'

/**
 * The grade is a property of the FILM, not of a shot. It is applied once over
 * the assembled cut, matching every shot to one look — which is the only way a
 * sequence of independently generated shots ever cuts together.
 */
export interface GradeSpec {
  readonly look: LookName
  /** 0 leaves the picture alone, 1 lands fully on the look. */
  readonly strength: number
  readonly saturation?: number
  readonly contrast?: number
}

export interface DeliverySpec {
  /** −23 LUFS for broadcast, −16 for social, none to leave levels alone. */
  readonly loudness: LoudnessTarget
  readonly codec: 'h264' | 'prores422'
  readonly captions: readonly ('burn' | 'srt' | 'vtt')[]
  readonly grade?: GradeSpec
}

export interface Timeline {
  readonly version: 1
  readonly id: string
  readonly name: string
  readonly timebase: Timebase
  /** Frames. Authoritative — the render is exactly this long. */
  readonly duration: number
  readonly tracks: readonly Track[]
  readonly markers: readonly Marker[]
  readonly delivery: DeliverySpec
  readonly createdAt: string
  readonly updatedAt: string
}
