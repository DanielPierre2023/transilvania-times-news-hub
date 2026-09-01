// lib/timeline/screen.ts
//
// Screen recordings: the missing half of every software sales clip.
//
// The Studio could film a person and not a product. A demo made here was a
// talking head describing software nobody could see.
//
// WHAT MAKES A SCREEN RECORDING WATCHABLE IS NOT THE RECORDING.
//
// A raw capture of somebody using software is unwatchable for three reasons,
// and all three are fixable with arithmetic rather than with a better camera:
//
//   IT IS THE WRONG SHAPE. A 2560×1440 desktop dropped into a 1080×1920
//   vertical frame is a letterboxed stamp with unreadable text. What is needed
//   is a moving crop that follows the part of the screen being used.
//
//   IT IS TOO SMALL. Interface text is designed to be read at arm's length on
//   a large monitor, not on a phone. A demo has to push in, and the push has to
//   land on the thing being pointed at.
//
//   IT IS TOO SLOW. Loading, typing, hunting for a menu. Those seconds are
//   real and nobody wants them, which is what the speed ramps are for.
//
// This module turns "the interesting part is here" into the crop, scale and
// timing that achieve it. It draws nothing; it produces transform values the
// existing compiler already knows how to animate.

import type { NormRect } from './types'

export interface ScreenSize {
  readonly width: number
  readonly height: number
}

/** A moment worth pushing into, in the recording's own time. */
export interface Focus {
  /** Seconds from the start of the recording. */
  readonly at: number
  /** Normalised point on the SCREEN, 0..1. Where the eye should go. */
  readonly x: number
  readonly y: number
  /** How tight. 1 is the whole screen; 0.35 is a strong push. */
  readonly zoom: number
  /** Seconds to travel there. Below 0.35 it reads as a cut, not a move. */
  readonly travel?: number
  readonly label?: string
}

/** Below this a "move" is really a jump, and reads as a mistake. */
export const MIN_TRAVEL = 0.35
/** Past this the text is bigger than the pixels behind it. */
export const MAX_ZOOM_IN = 0.28

/**
 * The crop rectangle for a focus, clamped inside the screen.
 *
 * THE CLAMP IS THE WHOLE FUNCTION. A push toward something near an edge — a
 * sidebar, a toolbar, a "save" button in the corner, which is where the
 * interesting things in software live — produces a rectangle that hangs off the
 * screen. Left alone that renders as black bars on one side of the shot, and it
 * happens precisely on the shots a demo is made of. So the rectangle is moved
 * back inside rather than shrunk: shrinking would change the zoom the author
 * asked for and make two pushes in the same film different sizes for no reason
 * the viewer can see.
 */
export function cropFor(focus: Focus, target: { w: number; h: number }, screen: ScreenSize): NormRect {
  const zoom = Math.max(MAX_ZOOM_IN, Math.min(1, focus.zoom))

  // Fit the delivery aspect inside the screen, then scale by the zoom.
  const screenAspect = screen.width / screen.height
  const targetAspect = target.w / target.h
  let w: number, h: number
  if (targetAspect > screenAspect) { w = 1; h = screenAspect / targetAspect }
  else { h = 1; w = targetAspect / screenAspect }
  w *= zoom
  h *= zoom

  const x = Math.max(0, Math.min(1 - w, focus.x - w / 2))
  const y = Math.max(0, Math.min(1 - h, focus.y - h / 2))
  return { x, y, w, h }
}

/** True when the requested point could not be centred because of the clamp. */
export const wasClamped = (focus: Focus, rect: NormRect): boolean =>
  Math.abs(rect.x + rect.w / 2 - focus.x) > 1e-6 || Math.abs(rect.y + rect.h / 2 - focus.y) > 1e-6

export interface CropKey {
  readonly frame: number
  readonly rect: NormRect
  readonly ease: 'hold' | 'easeInOut'
}

/**
 * Keyframes for a whole recording, from a list of focus moments.
 *
 * Each focus produces TWO keys: one holding the previous framing until the
 * move begins, and one at the destination. Without the holding key the crop
 * drifts continuously from the first moment to the second, so a push that was
 * meant to happen at 0:12 actually starts at 0:00 and the shot never sits
 * still — the commonest way an automated zoom looks amateur.
 */
export function cropKeys(
  focuses: readonly Focus[],
  target: { w: number; h: number },
  screen: ScreenSize,
  fps: number,
): CropKey[] {
  if (focuses.length === 0) return []
  const sorted = [...focuses].sort((a, b) => a.at - b.at)
  const keys: CropKey[] = []

  const wide: Focus = { at: 0, x: 0.5, y: 0.5, zoom: 1 }
  let previous = sorted[0].at > 0.01 ? wide : sorted[0]
  if (sorted[0].at > 0.01) keys.push({ frame: 0, rect: cropFor(wide, target, screen), ease: 'easeInOut' })

  for (const f of sorted) {
    const travel = Math.max(MIN_TRAVEL, f.travel ?? 0.6)
    const startFrame = Math.max(0, Math.round((f.at - travel) * fps))
    if (keys.length === 0 || keys[keys.length - 1].frame < startFrame) {
      keys.push({ frame: startFrame, rect: cropFor(previous, target, screen), ease: 'easeInOut' })
    }
    keys.push({ frame: Math.round(f.at * fps), rect: cropFor(f, target, screen), ease: 'easeInOut' })
    previous = f
  }
  return keys
}

export interface DeadAir {
  readonly from: number
  readonly to: number
}

/**
 * Stretches where the screen did not change — loading, reading, hunting.
 *
 * `changes` is a per-sample measure of how much the picture moved, which the
 * capture side produces cheaply by comparing downscaled frames. A run of
 * near-zero change is dead air.
 *
 * The minimum length is not tuning for its own sake. Cutting every half-second
 * of stillness from a screen recording removes the pauses where the viewer is
 * READING the thing that was just revealed, and the result is a demo that is
 * shorter and impossible to follow.
 */
export function deadAir(
  changes: readonly number[],
  hz: number,
  { threshold = 0.01, minSeconds = 1.2 }: { threshold?: number; minSeconds?: number } = {},
): DeadAir[] {
  const out: DeadAir[] = []
  let runStart: number | null = null
  for (let i = 0; i <= changes.length; i++) {
    const still = i < changes.length && changes[i] <= threshold
    if (still && runStart === null) runStart = i
    if (!still && runStart !== null) {
      const from = runStart / hz
      const to = i / hz
      if (to - from >= minSeconds) out.push({ from, to })
      runStart = null
    }
  }
  return out
}

/**
 * Speed points that skip dead air without cutting it out.
 *
 * A jump cut through a loading spinner reads as a broken recording. Running the
 * same seconds at 6× reads as a considerate edit, keeps the cursor continuous,
 * and takes the same time off the clip. The ramp in and out is short but not
 * instant, because an instantaneous speed change is itself a visible glitch.
 */
export function skipPoints(
  dead: readonly DeadAir[],
  fps: number,
  { rate = 6, edge = 0.15 }: { rate?: number; edge?: number } = {},
): { frame: number; rate: number }[] {
  const pts: { frame: number; rate: number }[] = [{ frame: 0, rate: 1 }]
  for (const d of dead) {
    const a = Math.round((d.from + edge) * fps)
    const b = Math.round((d.to - edge) * fps)
    if (b <= a) continue
    pts.push({ frame: Math.max(1, Math.round(d.from * fps)), rate: 1 })
    pts.push({ frame: a, rate })
    pts.push({ frame: b, rate })
    pts.push({ frame: Math.round(d.to * fps), rate: 1 })
  }
  return pts.sort((x, y) => x.frame - y.frame)
    .filter((p, i, arr) => i === 0 || p.frame !== arr[i - 1].frame)
}

/** Device frames a recording can sit inside. Sizes are the real content areas. */
export const DEVICE_FRAMES: Readonly<Record<string, { label: string; aspect: number; radius: number; note: string }>> = {
  none: { label: 'Fără ramă', aspect: 0, radius: 0, note: 'Ecranul umple cadrul. Cel mai lizibil.' },
  browser: { label: 'Fereastră de browser', aspect: 16 / 10, radius: 8, note: 'Sugerează o aplicație web fără să pretindă un dispozitiv.' },
  laptop: { label: 'Laptop', aspect: 16 / 10, radius: 12, note: 'Pentru software de birou. Pierde din lizibilitate.' },
  phone: { label: 'Telefon', aspect: 9 / 19.5, radius: 44, note: 'Doar pentru capturi făcute chiar pe telefon.' },
}

/**
 * Is this recording usable at the delivery size?
 *
 * TWO SEPARATE QUESTIONS, AND CONFLATING THEM GIVES THE WRONG ANSWER.
 *
 * The first draft measured only text size and cheerfully reported that a
 * desktop in a vertical frame was *more* readable than in a landscape one. That
 * is arithmetically true and practically useless: cropping the sides off a
 * 2560-wide screen to fill a 1080-wide frame really does enlarge the remaining
 * text by a third. It also throws away sixty-eight percent of the interface.
 *
 * So:
 *
 *   SCALE   how big the text is, compared with the original screen
 *   COVERAGE how much of the screen is inside the frame at all
 *
 * A vertical demo fails on coverage while passing on scale, which is exactly
 * the case that needs to be caught, and exactly the one a single number hides.
 */
export function readability(
  screen: ScreenSize,
  target: { w: number; h: number },
  zoom = 1,
): { scale: number; coverage: number; ok: boolean; note: string } {
  const crop = cropFor({ at: 0, x: 0.5, y: 0.5, zoom }, target, screen)
  const cropPixelsW = crop.w * screen.width
  const scale = target.w / cropPixelsW
  const coverage = crop.w * crop.h

  const pct = (v: number) => Math.round(v * 100)

  // COVERAGE IS ONLY A FAULT AT THE DEFAULT FRAMING.
  //
  // At zoom 1 the question is "does the whole screen fit?" and for a vertical
  // delivery the answer is no. Once the author has pushed in, they have already
  // decided to show part of the screen on purpose — judging that by coverage
  // would reject the exact remedy the note recommends, which is how a warning
  // becomes something people learn to ignore.
  const deliberatePush = zoom < 0.95
  if (coverage < 0.45 && !deliberatePush) {
    return { scale, coverage, ok: false, note:
      `Se vede doar ${pct(coverage)}% din ecran — restul interfeței rămâne în afara cadrului. ` +
      (target.w < target.h
        ? 'Pe vertical, un ecran întreg nu încape: apropie pe zona care contează, sau livrează pe orizontală.'
        : 'Apropie pe zona care contează, sau folosește o captură mai îngustă.') }
  }
  if (scale < 0.6) {
    return { scale, coverage, ok: false, note:
      `Interfața ajunge la ${pct(scale)}% din mărimea reală — textul mic nu va fi lizibil. ` +
      'Apropie pe zona care contează.' }
  }
  if (scale < 0.98) {
    return { scale, coverage, ok: true, note:
      `Interfața se vede la ${pct(scale)}% din mărimea reală, cu ${pct(coverage)}% din ecran în cadru. ` +
      'Lizibil, dar apropie-te pentru orice text mic.' }
  }
  return { scale, coverage, ok: true, note:
    `Textul rămâne la mărimea originală sau mai mare, cu ${pct(coverage)}% din ecran în cadru.` }
}
