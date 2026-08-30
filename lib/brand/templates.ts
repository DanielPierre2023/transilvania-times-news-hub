// lib/brand/templates.ts
//
// tt-brand — the typography that makes a film look made.
//
// A template here is NOT a new thing the renderer has to understand. It is a
// function that returns ordinary clips: rectangles and text, with keyframes.
// That choice is the whole design:
//
//   * the preview and the render already draw rectangles and text, so a title
//     card previews exactly as it renders, with no second implementation;
//   * every element stays selectable, movable and trimmable afterwards, because
//     it is a real clip and not a black box;
//   * a template can be edited by hand when a client asks for one thing moved,
//     which is the note that arrives on every job.
//
// The alternative — a `template` draw primitive the renderer expands at draw
// time — would have needed template code in the browser preview AND in the
// worker, and would have made "nudge that up 20 pixels" impossible.

import {
  IDENTITY_TRANSFORM,
  newId,
  secondsToFrames,
  type Clip,
  type Ease,
  type Keyframe,
  type Rational,
  type TextStyle,
} from '@/lib/timeline'
import { safeBox, type BrandKit, type SafeAreaName } from './kit'

export interface TemplateContext {
  readonly kit: BrandKit
  readonly fps: Rational
  /** Frame the template starts on. */
  readonly start: number
  /** Frames. Omit to use the template's own default. */
  readonly duration?: number
  readonly safeArea?: SafeAreaName
}

const key = <T,>(frame: number, value: T, ease: Ease = 'easeOut'): Keyframe<T> => ({ frame, value, ease })

interface ClipSpec {
  name: string
  source: Clip['source']
  start: number
  duration: number
  transform?: Partial<Clip['transform']>
  fadeIn?: number
  fadeOut?: number
}

function mkClip(spec: ClipSpec): Clip {
  return {
    id: newId('tpl'),
    name: spec.name,
    source: spec.source,
    start: spec.start,
    duration: spec.duration,
    sourceIn: 0,
    transform: { ...IDENTITY_TRANSFORM, ...(spec.transform || {}) },
    fit: 'fill',
    fadeIn: spec.fadeIn ?? 0,
    fadeOut: spec.fadeOut ?? 0,
    enabled: true,
  }
}

/**
 * A rule that grows from its LEFT edge rather than from its centre.
 *
 * The renderer scales a clip about the centre of its box, so a plain scale
 * keyframe makes a rule grow both ways at once, which reads as a stretch rather
 * than a draw. Moving the centre by exactly half the width it gains keeps the
 * left edge nailed down, and then it reads as a line being drawn.
 */
function wipeRight(centreX: number, centreY: number, width: number, frames: number) {
  return {
    scale: { keys: [key(0, 0.001), key(frames, 1, 'linear')] },
    position: {
      keys: [
        key(0, { x: centreX - width / 2, y: centreY }),
        key(frames, { x: centreX, y: centreY }, 'linear'),
      ],
    },
  }
}

/** A rule: a rect that knows how thin it is. */
function rule(kit: BrandKit, w: number, h = kit.ruleWeight): Clip['source'] {
  return { kind: 'shape', shape: 'rect', fill: kit.colour.accent, size: { w, h } }
}

/** Text that lifts into place — 2% of frame height, eased, over 10 frames. */
function riseIn(x: number, y: number, frames: number) {
  return {
    position: { keys: [key(0, { x, y: y + 0.02 }), key(frames, { x, y }, 'linear')] },
  }
}

function textStyle(kit: BrandKit, over: Partial<TextStyle>): TextStyle {
  return {
    family: kit.type.bodyFamily,
    size: kit.type.subtitle,
    weight: kit.type.bodyWeight,
    color: kit.colour.overPicture,
    align: 'left',
    lineHeight: kit.type.lineHeight,
    ...over,
  }
}

// ── TITLE CARD ──────────────────────────────────────────────────────────────
// The opening. A scrim over whatever plate is underneath, a kicker, a rule that
// draws itself, and the title lifting in beneath it. Left-aligned inside the
// safe box, because centred type over a photograph is the single most reliable
// way to look like a template.

export interface TitleCardParams {
  readonly kicker?: string
  readonly title: string
  readonly sub?: string
}

export function titleCard(ctx: TemplateContext, p: TitleCardParams): Clip[] {
  const { kit, fps, start } = ctx
  const dur = ctx.duration ?? secondsToFrames(3, fps)
  const inF = Math.min(12, Math.floor(dur / 4))
  const box = safeBox(kit, ctx.safeArea)
  const left = box.x
  const width = Math.min(0.78, box.w)
  const cx = left + width / 2
  const clips: Clip[] = []

  clips.push(mkClip({
    name: 'Scrim',
    source: { kind: 'shape', shape: 'rect', fill: kit.colour.scrim },
    start, duration: dur, fadeIn: inF, fadeOut: Math.min(10, inF),
    transform: { scale: 1.02 },
  }))

  // Vertical rhythm: kicker, rule, title, sub — stacked upward from the middle.
  const titleY = 0.52
  const ruleY = titleY - kit.type.display * 0.9
  const kickerY = ruleY - kit.type.kicker * 1.9

  if (p.kicker) {
    clips.push(mkClip({
      name: 'Supratitlu',
      source: {
        kind: 'text',
        text: p.kicker.toUpperCase(),
        style: textStyle(kit, {
          size: kit.type.kicker, weight: 700, color: kit.colour.accent,
          maxWidth: width, letterSpacing: 0.18, maxLines: 1,
        }),
      },
      start: start + Math.round(inF * 0.3), duration: dur - Math.round(inF * 0.3),
      fadeIn: inF, fadeOut: 8,
      transform: riseIn(cx, kickerY, inF),
    }))
  }

  const ruleW = Math.min(0.16, width * 0.3)
  clips.push(mkClip({
    name: 'Linie',
    source: rule(kit, ruleW),
    start: start + Math.round(inF * 0.5), duration: dur - Math.round(inF * 0.5),
    fadeOut: 8,
    transform: wipeRight(left + ruleW / 2, ruleY + kit.type.kicker * 0.4, ruleW, inF),
  }))

  clips.push(mkClip({
    name: 'Titlu',
    source: {
      kind: 'text',
      text: p.title,
      style: textStyle(kit, {
        family: kit.type.displayFamily, size: kit.type.display,
        weight: kit.type.displayWeight, maxWidth: width, maxLines: 3,
        lineHeight: kit.type.lineHeight,
      }),
    },
    start: start + Math.round(inF * 0.6), duration: dur - Math.round(inF * 0.6),
    fadeIn: inF, fadeOut: 10,
    transform: riseIn(cx, titleY, inF),
  }))

  if (p.sub) {
    clips.push(mkClip({
      name: 'Subtitlu',
      source: {
        kind: 'text', text: p.sub,
        style: textStyle(kit, { size: kit.type.subtitle, weight: 400, maxWidth: width, maxLines: 2 }),
      },
      start: start + inF, duration: dur - inF, fadeIn: inF, fadeOut: 10,
      transform: riseIn(cx, titleY + kit.type.display * 0.95, inF),
    }))
  }

  return clips
}

// ── LOWER THIRD ─────────────────────────────────────────────────────────────
// A name under a face. The bar draws itself, the plate slides, the type lifts.

export interface LowerThirdParams {
  readonly name: string
  readonly role?: string
}

export function lowerThird(ctx: TemplateContext, p: LowerThirdParams): Clip[] {
  const { kit, fps, start } = ctx
  const dur = ctx.duration ?? secondsToFrames(kit.lowerThirdSeconds, fps)
  const inF = Math.min(10, Math.floor(dur / 5))
  const box = safeBox(kit, ctx.safeArea)
  const width = Math.min(0.62, box.w)
  const left = box.x
  const cx = left + width / 2
  const baseY = box.y + box.h - kit.type.subtitle * 2.4

  const plateH = (kit.type.title * 0.62 + (p.role ? kit.type.kicker * 1.5 : 0)) * 1.9
  const plateY = baseY + (p.role ? kit.type.kicker * 0.6 : 0)

  const clips: Clip[] = [
    // A plate, so the name is readable over any plate underneath it. Wiping it
    // in from the left is what makes a lower third read as broadcast rather
    // than as a caption someone typed.
    mkClip({
      name: 'Placă',
      source: { kind: 'shape', shape: 'rect', fill: kit.colour.scrim, size: { w: width + 0.03, h: plateH } },
      start, duration: dur, fadeOut: 8,
      transform: wipeRight(left + (width + 0.03) / 2, plateY, width + 0.03, inF),
    }),
    mkClip({
      name: 'Bară',
      source: { kind: 'shape', shape: 'rect', fill: kit.colour.accent, size: { w: 0.007, h: plateH } },
      start, duration: dur, fadeOut: 8,
      transform: { position: { x: left + 0.0035, y: plateY }, scale: { keys: [key(0, 0.001), key(inF, 1, 'linear')] } },
    }),
    mkClip({
      name: 'Nume',
      source: {
        kind: 'text', text: p.name,
        style: textStyle(kit, {
          family: kit.type.displayFamily, size: kit.type.title * 0.62,
          weight: kit.type.displayWeight, maxWidth: width, maxLines: 1,
        }),
      },
      start: start + 2, duration: dur - 2, fadeIn: inF, fadeOut: 8,
      transform: riseIn(cx + 0.02, baseY, inF),
    }),
  ]

  if (p.role) {
    clips.push(mkClip({
      name: 'Funcție',
      source: {
        kind: 'text', text: p.role.toUpperCase(),
        style: textStyle(kit, {
          size: kit.type.kicker, weight: 600, color: kit.colour.accent,
          maxWidth: width, letterSpacing: 0.14, maxLines: 1,
        }),
      },
      start: start + 4, duration: dur - 4, fadeIn: inF, fadeOut: 8,
      transform: riseIn(cx + 0.02, baseY + kit.type.title * 0.62, inF),
    }))
  }

  return clips
}

// ── END CARD ────────────────────────────────────────────────────────────────
// The frame people screenshot. Brand ground, masthead, one line, the address.

export interface EndCardParams {
  readonly title?: string
  readonly line?: string
  readonly url?: string
}

export function endCard(ctx: TemplateContext, p: EndCardParams): Clip[] {
  const { kit, fps, start } = ctx
  const dur = ctx.duration ?? secondsToFrames(3, fps)
  const inF = Math.min(10, Math.floor(dur / 5))
  const box = safeBox(kit, ctx.safeArea)
  const width = Math.min(0.8, box.w)
  const cx = 0.5
  const clips: Clip[] = [
    mkClip({
      name: 'Fundal',
      source: { kind: 'shape', shape: 'rect', fill: kit.colour.paper },
      start, duration: dur, fadeIn: Math.min(8, inF),
      transform: { scale: 1.02 },
    }),
  ]

  // VERTICAL RHYTHM, and it is the whole difference between an end card and a
  // slide. The first version put the name at 0.46 and the address on the safe
  // edge at 0.80, which left a hole through the middle of the frame and read as
  // unfinished. Everything now hangs off one optical centre, each element a
  // known multiple of the type size below the last, and the block as a whole
  // sits slightly above true centre because type always looks low when it is
  // measured to the middle.
  const centreY = 0.44
  const ruleY = centreY + kit.type.title * 0.72
  const lineY = ruleY + kit.type.subtitle * 1.5
  const urlY = lineY + kit.type.kicker * 3.4

  if (kit.mastheadUrl) {
    clips.push(mkClip({
      name: 'Siglă',
      source: { kind: 'image', url: kit.mastheadUrl },
      start: start + 2, duration: dur - 2, fadeIn: inF,
      transform: { scale: 0.42, position: { x: cx, y: centreY } },
    }))
  } else {
    clips.push(mkClip({
      name: 'Nume publicație',
      source: {
        kind: 'text', text: p.title ?? kit.name,
        style: textStyle(kit, {
          family: kit.type.displayFamily, size: kit.type.title,
          weight: kit.type.displayWeight, color: kit.colour.ink,
          align: 'center', maxWidth: width, maxLines: 2,
        }),
      },
      start: start + 2, duration: dur - 2, fadeIn: inF,
      transform: riseIn(cx, centreY, inF),
    }))
  }

  const ruleW = 0.1
  clips.push(mkClip({
    name: 'Linie',
    source: rule(kit, ruleW),
    start: start + 5, duration: dur - 5,
    transform: wipeRight(cx, ruleY, ruleW, inF),
  }))

  if (p.line) {
    clips.push(mkClip({
      name: 'Mesaj',
      source: {
        kind: 'text', text: p.line,
        style: textStyle(kit, {
          size: kit.type.subtitle, weight: 400, color: kit.colour.ink,
          align: 'center', maxWidth: width, maxLines: 2,
        }),
      },
      start: start + 6, duration: dur - 6, fadeIn: inF,
      transform: riseIn(cx, lineY, inF),
    }))
  }

  if (p.url) {
    clips.push(mkClip({
      name: 'Adresă',
      source: {
        kind: 'text', text: p.url.toUpperCase(),
        style: textStyle(kit, {
          size: kit.type.kicker, weight: 600, color: kit.colour.accent,
          align: 'center', maxWidth: width, letterSpacing: 0.16, maxLines: 1,
        }),
      },
      start: start + 8, duration: dur - 8, fadeIn: inF,
      transform: riseIn(cx, urlY, inF),
    }))
  }

  return clips
}

// ── WORDMARK ────────────────────────────────────────────────────────────────
// A standing masthead for the whole film. Ordinary clips, like everything else
// here, which is the entire point: the version of this that lived in the
// preview painter appeared in the preview and in the browser recording and was
// absent from the worker render, because the worker draws the timeline and this
// was never in it.

export function wordmark(ctx: TemplateContext & { readonly frames: number }): Clip[] {
  const { kit, start } = ctx
  if (kit.wordmark === 'none') return []
  const box = safeBox(kit, ctx.safeArea)
  const size = kit.type.kicker * 1.35
  const y = kit.wordmark === 'topLeft' ? box.y + size * 0.9 : box.y + box.h - size * 2.2
  const width = Math.min(0.5, box.w)
  const cx = box.x + width / 2
  const ruleW = 0.16

  return [
    mkClip({
      name: 'Siglă text',
      source: {
        kind: 'text', text: kit.name,
        style: textStyle(kit, {
          family: kit.type.displayFamily, size,
          weight: kit.type.displayWeight, color: kit.colour.overPicture,
          maxWidth: width, maxLines: 1,
          // Over picture and with no plate behind it, so it needs a shadow or
          // it disappears against anything pale.
          shadow: 'rgba(0,0,0,0.55)',
        }),
      },
      start, duration: ctx.frames, fadeIn: 8, fadeOut: 8,
      transform: { position: { x: cx, y } },
    }),
    mkClip({
      name: 'Siglă linie',
      source: rule(kit, ruleW),
      start, duration: ctx.frames, fadeIn: 8, fadeOut: 8,
      transform: { position: { x: box.x + ruleW / 2, y: y + size * 0.85 } },
    }),
  ]
}

export const TEMPLATES = ['titleCard', 'lowerThird', 'endCard', 'wordmark'] as const
export type TemplateName = (typeof TEMPLATES)[number]
