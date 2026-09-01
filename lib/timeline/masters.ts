// lib/timeline/masters.ts
//
// Delivery masters, and an honest answer to "should I render this in 4K?"
//
// The Studio topped out at 1080p. Adding 2160 is four lines. The reason this is
// a module rather than four lines is that 4K is the one setting in the whole
// tool that can be TRUE AND USELESS at the same time, and nothing was telling
// anyone which.
//
// Every picture in a film here comes from one of three places:
//
//   a still from the image model     up to 3840 on the long edge
//   a motion clip                    1080 on most models, 4K only on the
//                                    $0.42/s tier — four times the price
//   something the user uploaded      whatever their camera gave them
//
// Render a film whose shots are 1080 motion clips at 2160 and every pixel of
// the extra detail is invented by a scaler. The file is 4K, the upload gets
// whatever bonus the platform gives 4K, and there is not one extra piece of
// real information in the picture. That is a legitimate thing to want. It is
// not a legitimate thing to be told nothing about, so `describeDelivery` says
// which of the two is happening, in words, before the render is paid for.

export type MasterTier = '720' | '1080' | '1440' | '2160'
export type Aspect = '9:16' | '1:1' | '4:5' | '16:9'

export const TIER_ORDER: readonly MasterTier[] = ['720', '1080', '1440', '2160']

/**
 * Frame sizes per tier.
 *
 * Every dimension is EVEN. h.264 chroma subsampling needs even dimensions and
 * ffmpeg will refuse an odd one outright — a 4:5 frame at 1440 is 1440×1800,
 * and the arithmetic that produces 1801 is exactly the kind of thing that
 * passes every unit test and fails at the encoder, at the end of a long render.
 */
export const MASTERS: Record<MasterTier, Record<Aspect, [number, number]>> = {
  '720':  { '9:16': [720, 1280],   '1:1': [1000, 1000], '4:5': [864, 1080],   '16:9': [1280, 720] },
  '1080': { '9:16': [1080, 1920],  '1:1': [1080, 1080], '4:5': [1080, 1350],  '16:9': [1920, 1080] },
  '1440': { '9:16': [1440, 2560],  '1:1': [1440, 1440], '4:5': [1440, 1800],  '16:9': [2560, 1440] },
  '2160': { '9:16': [2160, 3840],  '1:1': [2160, 2160], '4:5': [2160, 2700],  '16:9': [3840, 2160] },
}

export const TIER_LABEL: Record<MasterTier, string> = {
  '720': '720p · rapid',
  '1080': '1080p · standard',
  '1440': '1440p · mai clar',
  '2160': '4K · maxim',
}

/** Pixels in a frame, which is what render time and file size actually scale with. */
export const pixelsOf = (tier: MasterTier, aspect: Aspect): number => {
  const [w, h] = MASTERS[tier][aspect]
  return w * h
}

/**
 * How a master is produced.
 *
 * `renderAt` below `tier` means the film is drawn at the lower size and scaled
 * up on encode. That is genuinely useful — it is four times faster and the file
 * really is 4K — and it is genuinely not extra detail. Both facts are said.
 */
export interface DeliverySpec {
  readonly tier: MasterTier
  /** Draw at this size, then scale to `tier`. Absent means draw natively. */
  readonly renderAt?: MasterTier
}

export const isUpscaled = (spec: DeliverySpec): boolean =>
  !!spec.renderAt && TIER_ORDER.indexOf(spec.renderAt) < TIER_ORDER.indexOf(spec.tier)

/** The size the painter works at, which is not always the delivered size. */
export const renderSize = (spec: DeliverySpec, aspect: Aspect): [number, number] =>
  MASTERS[spec.renderAt && isUpscaled(spec) ? spec.renderAt : spec.tier][aspect]

export const deliverySize = (spec: DeliverySpec, aspect: Aspect): [number, number] =>
  MASTERS[spec.tier][aspect]

/**
 * Recommended h.264 bitrate, in kbit/s.
 *
 * Scaled from a measured-good 1080p25 figure by pixel count, then by frame
 * rate. Not a formula from a spec sheet: 12 Mbit at 1080p25 is what this
 * pipeline's own output needed before banding showed in the gradient of a
 * dusk sky, which is the material this Studio actually generates.
 */
export function bitrateFor(tier: MasterTier, aspect: Aspect, fps = 25): number {
  const base = 12000                    // kbit/s at 1920×1080 @ 25
  const ratio = pixelsOf(tier, aspect) / (1920 * 1080)
  // Bitrate needs grow a little slower than pixel count — detail per pixel
  // falls as resolution rises. The 0.85 exponent is the usual broadcast rule.
  return Math.round(base * Math.pow(ratio, 0.85) * (fps / 25))
}

/**
 * Measured on this pipeline: 250 frames of 1920×1080 took 94.7 s, i.e. 0.11×
 * realtime. Render time tracks pixel count closely because the cost is in
 * drawing and encoding, not in decisions.
 */
export const RENDER_REALTIME_1080 = 0.11

export function estimateRenderSeconds(spec: DeliverySpec, aspect: Aspect, filmSeconds: number): number {
  const [w, h] = renderSize(spec, aspect)
  const ratio = (w * h) / (1920 * 1080)
  return Math.round((filmSeconds / RENDER_REALTIME_1080) * ratio)
}

export interface DeliveryAdvice {
  readonly label: string
  /** Plain words: what this setting really gives, including when it gives nothing. */
  readonly honest: string
  /** True when the delivered pixels carry detail that was actually captured. */
  readonly realDetail: boolean
  readonly renderSeconds: number
  readonly bitrateKbps: number
  readonly warning?: string
}

/**
 * The honest description.
 *
 * `sourceLongEdge` is the SMALLEST long edge among the picture sources in the
 * film — the weakest shot, because that is what the audience sees. Passing the
 * average would flatter a film with one 4K hero shot and nine 1080 ones.
 */
export function describeDelivery(
  spec: DeliverySpec,
  aspect: Aspect,
  filmSeconds: number,
  sourceLongEdge?: number,
  fps = 25,
): DeliveryAdvice {
  const [dw, dh] = deliverySize(spec, aspect)
  const [rw, rh] = renderSize(spec, aspect)
  const deliveredLong = Math.max(dw, dh)
  const renderLong = Math.max(rw, rh)
  const renderSeconds = estimateRenderSeconds(spec, aspect, filmSeconds)
  const bitrateKbps = bitrateFor(spec.tier, aspect, fps)

  if (isUpscaled(spec)) {
    return {
      label: `${TIER_LABEL[spec.tier]} (mărit din ${spec.renderAt}p)`,
      honest:
        `Filmul se desenează la ${rw}×${rh} și se mărește la ${dw}×${dh}. ` +
        `Fișierul CHIAR este ${deliveredLong}p și platformele îl tratează ca atare, ` +
        `dar nu conține detaliu în plus — pixelii adăugați sunt calculați, nu filmați. ` +
        `Se randează de ${Math.round(pixelsOf(spec.tier, aspect) / pixelsOf(spec.renderAt!, aspect))}× mai repede decât 4K real.`,
      realDetail: false,
      renderSeconds,
      bitrateKbps,
    }
  }

  // Native render. The question is whether the material can fill it.
  if (sourceLongEdge && sourceLongEdge < renderLong * 0.9) {
    return {
      label: TIER_LABEL[spec.tier],
      honest:
        `Se desenează nativ la ${dw}×${dh}, dar cel mai slab plan din film are ` +
        `doar ${sourceLongEdge}px pe latura lungă. Diferența o inventează scalarea.`,
      realDetail: false,
      renderSeconds,
      bitrateKbps,
      warning:
        `Plătești un randare de ${Math.round(renderSeconds / 60)} min pentru detaliu pe care ` +
        `sursa nu îl are. Fie generezi mișcarea pe modelul 4K, fie alegi „mărit din 1080p” ` +
        `și obții același rezultat de ${Math.round(pixelsOf(spec.tier, aspect) / pixelsOf('1080', aspect))}× mai repede.`,
    }
  }

  return {
    label: TIER_LABEL[spec.tier],
    honest: `Se desenează nativ la ${dw}×${dh}. Detaliul este real${
      sourceLongEdge ? `, sursa are ${sourceLongEdge}px pe latura lungă` : ''}.`,
    realDetail: true,
    renderSeconds,
    bitrateKbps,
    ...(renderSeconds > 900
      ? { warning: `Randarea durează în jur de ${Math.round(renderSeconds / 60)} minute.` }
      : {}),
  }
}

/** Every dimension must be even, or the encoder refuses the job at the very end. */
export function allEven(): boolean {
  for (const tier of TIER_ORDER) {
    for (const a of Object.keys(MASTERS[tier]) as Aspect[]) {
      const [w, h] = MASTERS[tier][a]
      if (w % 2 !== 0 || h % 2 !== 0) return false
    }
  }
  return true
}
