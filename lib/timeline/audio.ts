// lib/timeline/audio.ts
//
// A real audio chain, not a volume slider.
//
// What existed: EBU R128 normalisation, a −18 dB duck under the voice, and five
// synthesised effects. That is a good mastering stage and no processing at all.
// A voice recorded in a room still sounds like a room; a music bed still fights
// the voice in the same frequencies rather than making space for it; a stray
// breath is still as loud as it was recorded.
//
// Everything here compiles to ffmpeg filters, because ffmpeg already has the
// processors and writing DSP in JavaScript to run it once per render would be
// vanity. The work is in choosing sane parameter ranges, refusing values that
// destroy audio, and ordering the chain the way an engineer would.
//
// THE ORDER IS NOT ALPHABETICAL. It is the order a signal actually goes through
// a desk, and getting it wrong is audible:
//
//   highpass → gate → EQ → compressor → saturation → delay → reverb → limiter
//
// Gate before compressor, or the compressor pulls up the noise floor between
// words and the gate then chops a signal that is no longer quiet. EQ before
// compression, so the compressor reacts to the tone you actually want. Limiter
// last, always, because anything after it can push the peak back over.

export type AudioEffectKind =
  | 'highpass' | 'lowpass' | 'eq' | 'gate' | 'compressor'
  | 'saturation' | 'delay' | 'reverb' | 'limiter'

export interface AudioEffect {
  readonly kind: AudioEffectKind
  readonly enabled?: boolean
  /** Hz. highpass, lowpass, eq. */
  readonly frequency?: number
  /** dB. eq gain, compressor makeup, saturation drive. */
  readonly gain?: number
  /** Q for eq; ratio for compressor and gate. */
  readonly q?: number
  readonly ratio?: number
  /** dB. compressor and gate threshold, limiter ceiling. */
  readonly threshold?: number
  /** ms. */
  readonly attack?: number
  readonly release?: number
  /** 0..1. delay and reverb wet amount. */
  readonly mix?: number
  /** ms for delay; room size 0..1 for reverb. */
  readonly time?: number
  readonly size?: number
}

const clamp = (v: number, lo: number, hi: number) =>
  !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v
const n = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** Presets that sound like something, so the panel is not a wall of numbers. */
export const AUDIO_PRESETS: Readonly<Record<string, { label: string; note: string; chain: AudioEffect[] }>> = {
  none: { label: 'Fără procesare', note: 'Doar normalizarea R128 la export.', chain: [] },

  voice: {
    label: 'Voce · difuzare',
    note: 'Taie zgomotul de sub 80 Hz, scoate boala de piept, deschide consoanele, ' +
      'egalizează nivelul. Lanțul standard pentru o voce de comentariu.',
    chain: [
      { kind: 'highpass', frequency: 80 },
      { kind: 'gate', threshold: -46, ratio: 2, attack: 5, release: 120 },
      { kind: 'eq', frequency: 240, gain: -2.5, q: 1.1 },
      { kind: 'eq', frequency: 3200, gain: 2.5, q: 0.9 },
      { kind: 'compressor', threshold: -20, ratio: 3, attack: 8, release: 140, gain: 3 },
      { kind: 'limiter', threshold: -1.5 },
    ],
  },

  voiceWarm: {
    label: 'Voce · caldă',
    note: 'Mai puțină strălucire, un pic de saturație. Pentru o voce subțire sau ' +
      'un microfon dur.',
    chain: [
      { kind: 'highpass', frequency: 70 },
      { kind: 'eq', frequency: 180, gain: 1.5, q: 0.8 },
      { kind: 'eq', frequency: 6500, gain: -2, q: 0.7 },
      { kind: 'compressor', threshold: -18, ratio: 2.5, attack: 12, release: 180, gain: 2 },
      { kind: 'saturation', gain: 2 },
      { kind: 'limiter', threshold: -1.5 },
    ],
  },

  music: {
    label: 'Pat muzical · sub voce',
    note: 'Scoate din pat exact banda în care stă vocea, în loc să dai muzica mai ' +
      'încet până dispare. Asta e diferența dintre muzică atenuată și muzică ' +
      'sub voce.',
    chain: [
      { kind: 'highpass', frequency: 40 },
      { kind: 'eq', frequency: 2400, gain: -4.5, q: 0.8 },
      { kind: 'eq', frequency: 400, gain: -2, q: 1.2 },
      { kind: 'compressor', threshold: -24, ratio: 2, attack: 20, release: 300 },
    ],
  },

  room: {
    label: 'Cameră mică',
    note: 'Puțin spațiu, ca să nu sune lipit pe imagine.',
    chain: [{ kind: 'reverb', size: 0.25, mix: 0.12 }, { kind: 'limiter', threshold: -1.5 }],
  },

  telephone: {
    label: 'Telefon',
    note: 'Bandă îngustă, pentru o replică auzită printr-un difuzor.',
    chain: [
      { kind: 'highpass', frequency: 400 },
      { kind: 'lowpass', frequency: 3400 },
      { kind: 'saturation', gain: 4 },
      { kind: 'limiter', threshold: -3 },
    ],
  },
}

/** Where each processor belongs in the signal path. Lower runs first. */
const ORDER: Record<AudioEffectKind, number> = {
  highpass: 10, lowpass: 15, gate: 20, eq: 30, compressor: 40,
  saturation: 50, delay: 60, reverb: 70, limiter: 99,
}

/**
 * One effect as an ffmpeg filter.
 *
 * Every parameter is clamped rather than trusted. A ratio of 0 is a divide by
 * zero inside acompressor, a threshold above 0 dB is meaningless, and a reverb
 * mix of 1 removes the dry signal entirely — all of which are one typo away in
 * a numeric input, and none of which should be able to ruin a render.
 */
export function compileEffect(fx: AudioEffect): string | null {
  if (fx.enabled === false) return null
  switch (fx.kind) {
    case 'highpass':
      return `highpass=f=${clamp(n(fx.frequency, 80), 20, 2000)}`
    case 'lowpass':
      return `lowpass=f=${clamp(n(fx.frequency, 12000), 500, 20000)}`
    case 'eq': {
      const g = clamp(n(fx.gain, 0), -18, 18)
      if (Math.abs(g) < 0.05) return null      // a flat band is not a filter
      return `equalizer=f=${clamp(n(fx.frequency, 1000), 20, 20000)}:t=q:` +
        `w=${clamp(n(fx.q, 1), 0.1, 12)}:g=${g.toFixed(2)}`
    }
    case 'gate':
      // ffmpeg's agate takes linear thresholds, not dB.
      return `agate=threshold=${dbToLinear(clamp(n(fx.threshold, -50), -80, -10)).toFixed(6)}:` +
        `ratio=${clamp(n(fx.ratio, 2), 1, 9)}:` +
        `attack=${clamp(n(fx.attack, 5), 0.01, 500)}:release=${clamp(n(fx.release, 120), 1, 2000)}`
    case 'compressor':
      return `acompressor=threshold=${dbToLinear(clamp(n(fx.threshold, -20), -60, -2)).toFixed(6)}:` +
        `ratio=${clamp(n(fx.ratio, 3), 1.1, 20)}:` +
        `attack=${clamp(n(fx.attack, 8), 0.01, 2000)}:release=${clamp(n(fx.release, 140), 1, 9000)}:` +
        `makeup=${dbToLinear(clamp(n(fx.gain, 0), 0, 24)).toFixed(4)}`
    case 'saturation': {
      // asoftclip's tanh curve, driven and then brought back down, so the effect
      // is colour rather than level.
      const drive = clamp(n(fx.gain, 2), 0, 12)
      if (drive < 0.05) return null
      const up = dbToLinear(drive).toFixed(4)
      const down = dbToLinear(-drive * 0.8).toFixed(4)
      return `volume=${up},asoftclip=type=tanh,volume=${down}`
    }
    case 'delay': {
      const ms = clamp(n(fx.time, 220), 10, 2000)
      const wet = clamp(n(fx.mix, 0.2), 0, 0.9)
      if (wet < 0.01) return null
      // out_gain is 1, not 0.6. It scales the WHOLE output, dry signal
      // included — measured: a "reverb" with out_gain 0.9 made the source
      // 1.0 dB QUIETER instead of adding a tail. An effect that attenuates the
      // thing it is supposed to add to is not an effect, it is a bug with a
      // pleasant name. The limiter at the end of the chain handles the sum.
      return `aecho=1:1:${ms.toFixed(0)}:${wet.toFixed(3)}`
    }
    case 'reverb': {
      // A small multi-tap echo rather than a convolution: no impulse file to
      // ship, and at the depths a film actually uses it is indistinguishable.
      const size = clamp(n(fx.size, 0.3), 0.05, 1)
      const wet = clamp(n(fx.mix, 0.15), 0, 0.8)
      if (wet < 0.01) return null
      const taps = [1, 1.7, 2.6, 3.9].map(k => Math.round(18 + size * 90 * k))
      const decays = taps.map((_, i) => (wet * Math.pow(0.62, i)).toFixed(3))
      // Same correction as the delay: out_gain 1 so the tail is added to the
      // signal rather than the signal being turned down to make room for it.
      return `aecho=1:1:${taps.join('|')}:${decays.join('|')}`
    }
    case 'limiter':
      return `alimiter=limit=${dbToLinear(clamp(n(fx.threshold, -1.5), -12, -0.1)).toFixed(6)}:level=disabled`
    default:
      return null
  }
}

export const dbToLinear = (db: number): number => Math.pow(10, db / 20)
export const linearToDb = (v: number): number => 20 * Math.log10(Math.max(v, 1e-9))

/**
 * A whole chain, ordered and de-duplicated where it must be.
 *
 * Two limiters in a row is not twice the limiting, it is two gain stages fighting
 * each other; only the lowest ceiling survives.
 */
export function compileChain(effects: readonly AudioEffect[] | undefined): string {
  if (!effects || effects.length === 0) return ''
  const active = effects.filter(f => f.enabled !== false)
  const limiters = active.filter(f => f.kind === 'limiter')
  const keep = active.filter(f => f.kind !== 'limiter')
  if (limiters.length) {
    keep.push(limiters.reduce((a, b) => (n(a.threshold, -1.5) <= n(b.threshold, -1.5) ? a : b)))
  }
  return keep
    .slice()
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
    .map(compileEffect)
    .filter(Boolean)
    .join(',')
}

/**
 * Keyframed gain as an ffmpeg expression — automation, rather than one number
 * for the whole clip.
 *
 * `eval=frame` is what makes it move: without it ffmpeg evaluates the expression
 * once, at the start, and a fade becomes a level change. The expression is built
 * as nested `if(lt(t,..))` segments with linear interpolation inside each, which
 * is exactly what the timeline's own keyframes mean.
 */
export interface GainPoint { readonly t: number; readonly db: number }

export function compileGainAutomation(points: readonly GainPoint[]): string {
  const pts = [...points].filter(p => Number.isFinite(p.t) && Number.isFinite(p.db)).sort((a, b) => a.t - b.t)
  if (pts.length === 0) return ''
  if (pts.length === 1) return `volume=${dbToLinear(pts[0].db).toFixed(5)}`

  let expr = `${dbToLinear(pts[pts.length - 1].db).toFixed(5)}`
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i], b = pts[i + 1]
    const va = dbToLinear(a.db), vb = dbToLinear(b.db)
    const span = Math.max(1e-6, b.t - a.t)
    const seg = `(${va.toFixed(5)}+(${(vb - va).toFixed(5)})*(t-${a.t.toFixed(3)})/${span.toFixed(3)})`
    expr = `if(lt(t,${b.t.toFixed(3)}),${seg},${expr})`
  }
  return `volume=volume='${expr}':eval=frame`
}

/** What a chain does, in words, for a panel that should not be a wall of numbers. */
export function describeChain(effects: readonly AudioEffect[] | undefined): string {
  if (!effects || !effects.length) return 'fără procesare'
  const active = effects.filter(f => f.enabled !== false)
  const names: Record<AudioEffectKind, string> = {
    highpass: 'taie jos', lowpass: 'taie sus', eq: 'EQ', gate: 'poartă',
    compressor: 'compresor', saturation: 'saturație', delay: 'ecou',
    reverb: 'reverb', limiter: 'limitator',
  }
  const seen: string[] = []
  for (const f of active.slice().sort((a, b) => ORDER[a.kind] - ORDER[b.kind])) {
    const label = names[f.kind]
    if (!seen.includes(label)) seen.push(label)
  }
  return seen.join(' → ')
}
