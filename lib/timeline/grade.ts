// lib/timeline/grade.ts
//
// The colour grade, moved out of the worker so both halves can run it.
//
// THIS WAS THE LAST DIVERGENCE, AND IT WAS THE MOST VISIBLE ONE.
//
// The worker applies a per-shot adaptive grade: it measures each shot's own mean
// in linear light, works out the channel gains that move that mean onto the
// kit's look, and bakes them into an ffmpeg LUT. The preview applied nothing at
// all. So every film anyone watched was ungraded and every file delivered was
// graded — a colour difference on every frame of every shot, which is a stranger
// thing to leave standing than any of the ten faults already fixed.
//
// The maths lived in `render-worker/src/grade.js`, in CommonJS, next to ffmpeg
// spawns. It is here now, dependency-free, and the worker requires it back. One
// implementation, exactly like the timeline itself.
//
// WHY THE BROWSER CAN REPRODUCE IT EXACTLY RATHER THAN APPROXIMATE IT.
//
// `lutExpr` is: sRGB → linear → multiply by gain → clip → sRGB. An SVG filter
// declared `color-interpolation-filters="linearRGB"` does the sRGB↔linear
// conversion itself, and `<feFuncR type="linear" slope="g">` is the multiply.
// So the same three gains drive both, and neither side is an approximation of
// the other. A CSS `filter: brightness()` would have been the approximation —
// it works per-pixel in sRGB and cannot express a per-channel gain in linear
// light — and an approximation here would have been a new divergence wearing
// the clothes of a fix.

export type LookName = 'golden' | 'warm' | 'neutral' | 'cool'

/** Rec.709 luminance weights. */
export const LUMA: readonly [number, number, number] = [0.2126, 0.7152, 0.0722]

/** Named looks, as chromaticity ratios. Normalised so a grade never changes exposure. */
export const LOOKS: Readonly<Record<LookName, readonly [number, number, number]>> = {
  golden: [1.16, 1.0, 0.74],
  warm: [1.08, 1.0, 0.88],
  neutral: [1.0, 1.0, 1.0],
  cool: [0.92, 1.0, 1.1],
}

export function normaliseLook(rgb: readonly number[]): number[] {
  const l = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
  return rgb.map(v => v / l)
}

export const srgbToLinear = (s: number): number =>
  s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)

export const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 0.41666) - 0.055

/**
 * Trimmed mean of a frame in linear light.
 *
 * The trim is the point: a shot with a blown window or a black doorway has its
 * mean dragged by pixels that carry no information about the grade. Dropping the
 * darkest and brightest tenth measures the picture rather than its extremes.
 *
 * Takes raw RGBA bytes so the worker can hand it node-canvas and the browser can
 * hand it an ImageData — the two sides differ in where the pixels come from and
 * in nothing else.
 */
export function meanLinearFromRGBA(data: ArrayLike<number>): [number, number, number] {
  const n = Math.floor(data.length / 4)
  if (n === 0) return [0, 0, 0]
  const px: [number, number, number, number][] = new Array(n)
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const r = srgbToLinear(data[i] / 255)
    const g = srgbToLinear(data[i + 1] / 255)
    const b = srgbToLinear(data[i + 2] / 255)
    px[p] = [r, g, b, r * LUMA[0] + g * LUMA[1] + b * LUMA[2]]
  }
  px.sort((a, b) => a[3] - b[3])
  const lo = Math.floor(px.length * 0.1)
  const hi = Math.ceil(px.length * 0.9)
  const keep = hi - lo > 40 ? px.slice(lo, hi) : px
  const mean: [number, number, number] = [0, 0, 0]
  for (const p of keep) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2] }
  return [mean[0] / keep.length, mean[1] / keep.length, mean[2] / keep.length]
}

/**
 * Per-channel gains that move one shot's measured mean onto the target look,
 * holding its luminance. Clamped, because a shot that is nearly monochrome asks
 * for a gain that would tear it apart.
 */
export function planGains(
  meanLinear: readonly number[],
  look: LookName | string,
  strength = 1,
  clamp: readonly [number, number] = [0.45, 2.6],
): number[] {
  const target = normaliseLook(LOOKS[look as LookName] || LOOKS.neutral)
  const lum = meanLinear[0] * LUMA[0] + meanLinear[1] * LUMA[1] + meanLinear[2] * LUMA[2]
  return meanLinear.map((m, i) => {
    const desired = target[i] * lum
    const raw = desired / Math.max(m, 1e-6)
    const g = 1 + (raw - 1) * strength
    return Math.min(clamp[1], Math.max(clamp[0], g))
  })
}

/** What is left after grading, so the report can say whether it landed. */
export function residual(meanLinear: readonly number[], gains: readonly number[], look: LookName | string): number {
  const target = normaliseLook(LOOKS[look as LookName] || LOOKS.neutral)
  const after = meanLinear.map((m, i) => m * gains[i])
  const lum = after[0] * LUMA[0] + after[1] * LUMA[1] + after[2] * LUMA[2]
  return after.reduce((acc, v, i) => acc + Math.abs(v / Math.max(lum, 1e-6) - target[i]), 0)
}

/** One channel of the ffmpeg LUT: sRGB → linear → gain → clip → sRGB. */
export function lutExpr(gain: number): string {
  const s = '(val/255)'
  const lin = `if(lte(${s},0.04045),${s}/12.92,pow((${s}+0.055)/1.055,2.4))`
  const out = `clip(${lin}*${gain.toFixed(5)},0,1)`
  return `if(lte(${out},0.0031308),${out}*12.92,1.055*pow(${out},0.41666)-0.055)*255`
}

/**
 * The same three gains as an SVG filter, for a canvas.
 *
 * `linearRGB` interpolation is what makes this equivalent rather than similar:
 * the browser converts to linear light, applies the slope, and converts back —
 * the three steps `lutExpr` writes out by hand.
 */
export function svgGradeFilter(gains: readonly number[], id: string): string {
  const f = (g: number) => Math.max(0, g).toFixed(5)
  return `<filter id="${id}" color-interpolation-filters="linearRGB" ` +
    `x="0%" y="0%" width="100%" height="100%">` +
    `<feComponentTransfer>` +
    `<feFuncR type="linear" slope="${f(gains[0])}"/>` +
    `<feFuncG type="linear" slope="${f(gains[1])}"/>` +
    `<feFuncB type="linear" slope="${f(gains[2])}"/>` +
    `</feComponentTransfer></filter>`
}

/** Applying the gains directly, for tests and for anything without a filter. */
export function applyGains(rgb: readonly number[], gains: readonly number[]): number[] {
  return rgb.map((v, i) => {
    const lin = srgbToLinear(v / 255) * gains[i]
    return Math.round(linearToSrgb(Math.min(1, Math.max(0, lin))) * 255)
  })
}
