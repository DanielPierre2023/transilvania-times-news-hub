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

/**
 * Named grade styles — the artistic lever, rather than two loose numbers.
 *
 * `contrast` and `saturation` already existed on `GradeSpec` and were already
 * being applied by the worker at a hard-coded 1.04 / 1.06. The PREVIEW ignored
 * them completely, so every film was rendered slightly punchier than the thing
 * the editor approved. That is the divergence this table closes; the styles are
 * what makes it worth having rather than merely correct.
 *
 * The numbers are chosen, not guessed. Contrast pivots on middle grey in linear
 * light, so a value of 1.3 deepens shadows and opens highlights while leaving
 * faces almost where they were — which is why `dramatic` can go that far without
 * turning people into silhouettes. Saturation moves the opposite way in the
 * prestige looks: strong contrast with high saturation reads as a phone filter,
 * strong contrast with restrained colour reads as film.
 */
export type GradeStyleName = 'plat' | 'documentar' | 'cinematic' | 'dramatic' | 'publicitar'

export const GRADE_STYLES: Readonly<Record<GradeStyleName, {
  label: string; note: string; contrast: number; saturation: number
}>> = {
  plat: {
    label: 'Plat · fără stil',
    note: 'Nici contrast, nici saturație adăugate. Pentru material care se gradează în altă parte.',
    contrast: 1, saturation: 1,
  },
  documentar: {
    label: 'Documentar · reținut',
    note: 'Aproape neatins, cu o urmă de culoare scoasă. Se folosește când subiectul trebuie ' +
      'crezut: un film reținut pare adevărat, unul lucios pare o reclamă.',
    contrast: 1.04, saturation: 0.96,
  },
  cinematic: {
    label: 'Cinematic',
    note: 'Umbre mai adânci, lumini deschise, culoare abia ridicată. Pivotul pe griul mediu ' +
      'ține fețele pe loc — de asta se poate merge atât de departe fără ca oamenii să devină siluete.',
    contrast: 1.18, saturation: 1.02,
  },
  dramatic: {
    label: 'Dramatic · prestigiu',
    note: 'Contrast tare CU culoare reținută. Combinația contează: contrast tare plus saturație ' +
      'mare arată ca un filtru de telefon; contrast tare plus culoare scoasă arată ca film.',
    contrast: 1.32, saturation: 0.9,
  },
  publicitar: {
    label: 'Publicitar · lovește',
    note: 'Punch pe amândouă. Corect pentru un produs pe fundal curat, greșit pentru un chip.',
    contrast: 1.12, saturation: 1.14,
  },
}

/** The style whose numbers a spec matches, for showing the right thing selected. */
export function styleOf(contrast?: number, saturation?: number): GradeStyleName {
  const c = contrast ?? 1.04, sa = saturation ?? 1.06
  let best: GradeStyleName = 'documentar'
  let dist = Infinity
  for (const [k, v] of Object.entries(GRADE_STYLES) as [GradeStyleName, typeof GRADE_STYLES.plat][]) {
    const d = Math.abs(v.contrast - c) + Math.abs(v.saturation - sa)
    if (d < dist) { dist = d; best = k }
  }
  return best
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

/**
 * One shot's own colour, when the automatic answer is not the right one.
 *
 * The grade is adaptive: it measures each shot and moves it onto the kit's look.
 * That is right nearly always, and wrong exactly when a shot is *meant* to sit
 * apart — a memory, a night exterior, a deliberately cold frame in a warm film.
 * Until now there was no way to say so.
 *
 * `temperature` and `tint` are a trim on top of whatever the automatic pass
 * decided, in the same units an editor expects: positive temperature is warmer,
 * positive tint is greener. They multiply the computed gains rather than
 * replacing them, so a shot keeps tracking the look and simply sits beside it.
 */
export interface ShotGrade {
  readonly look?: LookName | 'none'
  readonly strength?: number
  /** −1..1. Positive is warmer. */
  readonly temperature?: number
  /** −1..1. Positive is greener. */
  readonly tint?: number
  /**
   * Contrast, 1 = untouched. Applied in LINEAR LIGHT around middle grey.
   *
   * The pivot is 0.18, not 0.5, and that is the whole difference between a
   * cinematic contrast and a crushed one. 0.18 in linear light IS middle grey —
   * the value a grey card reflects — so faces sit on the pivot and barely move
   * while the shadows deepen and the highlights open.
   *
   * MEASURED, because the plausible explanation was wrong. An sRGB mid grey of
   * 119 is 0.1845 in linear light. Pivoting at 0.18 moves it by 0.0014 — it
   * stays put, which is the point. Pivoting at 0.5 moves it by −0.101: 0.5 is
   * far ABOVE middle grey in linear light, so a naive pivot drags every face
   * down into the shadows rather than lifting it. Either way the picture is
   * wrong; it is worth knowing which way.
   */
  readonly contrast?: number
  /** Saturation, 1 = untouched. 0 is greyscale, >1 richer. */
  readonly saturation?: number
}

/** Middle grey in linear light. The photographic pivot, not the arithmetic one. */
export const CONTRAST_PIVOT = 0.18

/**
 * Rec.709 luma weights — the ones SVG's `feColorMatrix type="saturate"` uses.
 *
 * Written out rather than left implicit because the ffmpeg side has to be given
 * the same matrix explicitly. Use Rec.601 on one side and 709 on the other and
 * the preview and the render disagree about how red a red is, by a few percent,
 * on every frame — visible only when the two are put side by side, which is
 * exactly when it matters.
 */
export const LUMA_709: readonly [number, number, number] = [0.213, 0.715, 0.072]

/** The trim, as channel multipliers. Deliberately gentle: ±1 is about ±12%. */
export function trimGains(temperature = 0, tint = 0): [number, number, number] {
  const t = Math.max(-1, Math.min(1, temperature)) * 0.12
  const g = Math.max(-1, Math.min(1, tint)) * 0.10
  return [1 + t, 1 + g, 1 - t]
}

/**
 * The gains for one shot, honouring its own override.
 *
 * A shot set to `look: 'none'` is left exactly as shot — the trim still applies,
 * because "do not grade this" and "do not touch this" are different requests.
 */
export function planShotGains(
  meanLinear: readonly number[],
  delivery: { look: LookName | string; strength: number },
  shot?: ShotGrade | null,
): number[] {
  const look = shot?.look ?? delivery.look
  const strength = typeof shot?.strength === 'number' ? shot.strength : delivery.strength
  const base = look === 'none' ? [1, 1, 1] : planGains(meanLinear, look, strength)
  const trim = trimGains(shot?.temperature, shot?.tint)
  return base.map((g, i) => g * trim[i])
}

/** What is left after grading, so the report can say whether it landed. */
export function residual(meanLinear: readonly number[], gains: readonly number[], look: LookName | string): number {
  const target = normaliseLook(LOOKS[look as LookName] || LOOKS.neutral)
  const after = meanLinear.map((m, i) => m * gains[i])
  const lum = after[0] * LUMA[0] + after[1] * LUMA[1] + after[2] * LUMA[2]
  return after.reduce((acc, v, i) => acc + Math.abs(v / Math.max(lum, 1e-6) - target[i]), 0)
}

/** One channel of the ffmpeg LUT: sRGB → linear → gain → clip → sRGB. */
export function lutExpr(gain: number, contrast = 1): string {
  const s = '(val/255)'
  const lin = `if(lte(${s},0.04045),${s}/12.92,pow((${s}+0.055)/1.055,2.4))`
  // GAIN AND CONTRAST ARE ONE LINEAR FUNCTION, which is what keeps the two
  // engines exactly equal rather than approximately equal.
  //
  //   out = (lin·gain − p)·c + p  =  lin·(gain·c) + p·(1 − c)
  //
  // A slope and an intercept — precisely what `feComponentTransfer type="linear"`
  // takes. So the browser and ffmpeg are not doing similar arithmetic in
  // different orders; they are evaluating the same two numbers.
  const slope = (gain * contrast).toFixed(6)
  const intercept = (CONTRAST_PIVOT * (1 - contrast)).toFixed(6)
  const out = `clip(${lin}*${slope}+(${intercept}),0,1)`
  return `if(lte(${out},0.0031308),${out}*12.92,1.055*pow(${out},0.41666)-0.055)*255`
}

/**
 * The saturation matrix, as ffmpeg's `colorchannelmixer` takes it.
 *
 * Deliberately the SVG saturate matrix written out, so the two sides cannot
 * drift. Applied AFTER the per-channel pass in both engines — the order is part
 * of the contract, because contrast-then-saturate and saturate-then-contrast
 * give visibly different pictures.
 */
export function saturationMixer(saturation: number): string {
  const sat = Math.max(0, saturation)
  const [lr, lg, lb] = LUMA_709
  const m = [
    lr + (1 - lr) * sat, lg - lg * sat,       lb - lb * sat,
    lr - lr * sat,       lg + (1 - lg) * sat, lb - lb * sat,
    lr - lr * sat,       lg - lg * sat,       lb + (1 - lb) * sat,
  ].map(v => v.toFixed(6))
  return `colorchannelmixer=rr=${m[0]}:rg=${m[1]}:rb=${m[2]}:` +
         `gr=${m[3]}:gg=${m[4]}:gb=${m[5]}:` +
         `br=${m[6]}:bg=${m[7]}:bb=${m[8]}`
}

/**
 * The same three gains as an SVG filter, for a canvas.
 *
 * `linearRGB` interpolation is what makes this equivalent rather than similar:
 * the browser converts to linear light, applies the slope, and converts back —
 * the three steps `lutExpr` writes out by hand.
 */
export function svgGradeFilter(
  gains: readonly number[],
  id: string,
  contrast = 1,
  saturation = 1,
): string {
  const f = (g: number) => Math.max(0, g).toFixed(6)
  const intercept = (CONTRAST_PIVOT * (1 - contrast)).toFixed(6)
  // The component transfer runs in LINEAR light, matching `lutExpr`.
  const transfer =
    `<feComponentTransfer color-interpolation-filters="linearRGB">` +
    `<feFuncR type="linear" slope="${f(gains[0] * contrast)}" intercept="${intercept}"/>` +
    `<feFuncG type="linear" slope="${f(gains[1] * contrast)}" intercept="${intercept}"/>` +
    `<feFuncB type="linear" slope="${f(gains[2] * contrast)}" intercept="${intercept}"/>` +
    `</feComponentTransfer>`
  // Saturation runs in sRGB, because that is where ffmpeg's colorchannelmixer
  // runs. Same matrix, same space, same order — the three things that have to
  // agree for the preview and the file to be the same picture.
  const sat = Math.abs(saturation - 1) < 1e-6 ? '' :
    `<feColorMatrix type="saturate" values="${Math.max(0, saturation).toFixed(6)}" ` +
    `color-interpolation-filters="sRGB"/>`
  return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%">` +
    transfer + sat + `</filter>`
}

/** Applying the gains directly, for tests and for anything without a filter. */
export function applyGains(
  rgb: readonly number[],
  gains: readonly number[],
  contrast = 1,
  saturation = 1,
): number[] {
  const out = rgb.map((v, i) => {
    const lin = srgbToLinear(v / 255) * gains[i] * contrast + CONTRAST_PIVOT * (1 - contrast)
    return linearToSrgb(Math.min(1, Math.max(0, lin))) * 255
  })
  if (Math.abs(saturation - 1) < 1e-9) return out.map(v => Math.round(v))
  // In sRGB, after the per-channel pass — the same order both engines use.
  const [lr, lg, lb] = LUMA_709
  const luma = out[0] * lr + out[1] * lg + out[2] * lb
  return out.map(v => Math.round(Math.min(255, Math.max(0, luma + (v - luma) * saturation))))
}
