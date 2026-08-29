// lib/timeline/loudness.ts
//
// ITU-R BS.1770-4 loudness, which is what EBU R128 measures.
//
// The Studio previously set the voice level from a plain RMS average. RMS is
// not loudness: it ignores how the ear weights frequency, and it counts silence
// and room tone as if they were programme. Two files with the same RMS can be
// three or four LU apart, and a delivery spec that says "−23 LUFS ±0.5" cannot
// be met by guessing.
//
// What is implemented here:
//   • K-weighting — a high shelf and a high-pass, derived from the analogue
//     prototype so the filter is correct at any sample rate, not only 48 kHz
//   • 400 ms blocks at 75 % overlap
//   • the two gates: absolute at −70 LUFS, then relative at −10 LU below the
//     ungated mean. The relative gate is what stops silence dragging the
//     measurement down.
//   • momentary (400 ms) and short-term (3 s) maxima, and loudness range
//
// Verified against ffmpeg's ebur128 implementation — see the numbers in the
// deployment notes.

/** Channel weights from BS.1770. Surround channels count for more. */
export const CHANNEL_WEIGHTS = {
  left: 1.0,
  right: 1.0,
  centre: 1.0,
  leftSurround: 1.41,
  rightSurround: 1.41,
} as const

const ABSOLUTE_GATE = -70 // LUFS
const RELATIVE_GATE = -10 // LU below the ungated mean
const OFFSET = -0.691 // the BS.1770 calibration constant

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/**
 * The K-weighting pre-filter: a high shelf of about +4 dB above 1.7 kHz,
 * standing in for the acoustic effect of a head. Coefficients are derived from
 * the analogue prototype in the standard, so they are right at 44.1 kHz and
 * 96 kHz too — the tabulated values in the standard are only for 48 kHz.
 */
function highShelf(sampleRate: number): Biquad {
  const f0 = 1681.9744509555319
  const G = 3.99984385397 // dB
  const Q = 0.7071752369554193

  const K = Math.tan((Math.PI * f0) / sampleRate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.499666774155)
  const den = 1 + K / Q + K * K

  return {
    b0: (Vh + (Vb * K) / Q + K * K) / den,
    b1: (2 * (K * K - Vh)) / den,
    b2: (Vh - (Vb * K) / Q + K * K) / den,
    a1: (2 * (K * K - 1)) / den,
    a2: (1 - K / Q + K * K) / den,
  }
}

/** The RLB high-pass: rolls off below about 38 Hz. */
function highPass(sampleRate: number): Biquad {
  const f0 = 38.13547087602444
  const Q = 0.5003270373238773
  const K = Math.tan((Math.PI * f0) / sampleRate)
  const den = 1 + K / Q + K * K
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / den,
    a2: (1 - K / Q + K * K) / den,
  }
}

function applyBiquad(input: Float32Array, f: Biquad): Float32Array {
  const out = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i]
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    out[i] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return out
}

export function kWeight(channel: Float32Array, sampleRate: number): Float32Array {
  return applyBiquad(applyBiquad(channel, highShelf(sampleRate)), highPass(sampleRate))
}

/**
 * Cumulative sums of squares, one per channel. Building these once turns every
 * window measurement into two array reads instead of a loop over the window, so
 * the 100 ms short-term series that loudness range needs costs the same as a
 * 1 s one. Without this a three-minute bulletin would take hundreds of millions
 * of operations in the browser.
 */
function prefixSquares(weighted: readonly Float32Array[]): Float64Array[] {
  return weighted.map(data => {
    const p = new Float64Array(data.length + 1)
    let acc = 0
    for (let i = 0; i < data.length; i++) {
      acc += data[i] * data[i]
      p[i + 1] = acc
    }
    return p
  })
}

function weightForChannel(index: number, count: number): number {
  if (count <= 2) return 1.0
  // 5.1 order: L R C LFE Ls Rs. LFE is excluded from the measurement.
  if (index === 3) return 0
  if (index >= 4) return 1.41
  return 1.0
}

/** Weighted mean square of one window, summed across channels. */
function blockPower(prefix: readonly Float64Array[], from: number, length: number): number {
  let sum = 0
  for (let c = 0; c < prefix.length; c++) {
    const w = weightForChannel(c, prefix.length)
    if (w === 0) continue
    const p = prefix[c]
    sum += (w * (p[from + length] - p[from])) / length
  }
  return sum
}

const toLufs = (power: number): number =>
  power > 0 ? OFFSET + 10 * Math.log10(power) : -Infinity

export interface LoudnessResult {
  /** Gated programme loudness, LUFS. The number a delivery spec means. */
  readonly integrated: number
  /** Loudest 400 ms window, LUFS. */
  readonly momentaryMax: number
  /** Loudest 3 s window, LUFS. */
  readonly shortTermMax: number
  /** Loudness range, LU — the spread between quiet and loud programme. */
  readonly range: number
  /** Highest absolute sample, dBFS. Not true peak; see the notes. */
  readonly samplePeakDb: number
  readonly durationSeconds: number
}

/**
 * Powers of consecutive windows. BS.1770 overlaps momentary blocks by 75 %;
 * the loudness-range series is sampled every 100 ms, which is what the
 * reference implementations do and what the numbers below were checked against.
 */
function blockPowers(
  prefix: readonly Float64Array[],
  totalSamples: number,
  sampleRate: number,
  windowSeconds: number,
  stepSeconds?: number,
): number[] {
  const windowLength = Math.round(sampleRate * windowSeconds)
  const step = stepSeconds
    ? Math.max(1, Math.round(sampleRate * stepSeconds))
    : Math.max(1, Math.round(windowLength / 4))
  const powers: number[] = []
  if (totalSamples < windowLength) return powers
  for (let from = 0; from + windowLength <= totalSamples; from += step) {
    powers.push(blockPower(prefix, from, windowLength))
  }
  return powers
}

function gatedMean(powers: readonly number[]): number {
  const abovePlain = powers.filter(p => toLufs(p) > ABSOLUTE_GATE)
  if (!abovePlain.length) return 0
  const ungatedMean = abovePlain.reduce((s, p) => s + p, 0) / abovePlain.length
  const threshold = toLufs(ungatedMean) + RELATIVE_GATE
  const gated = abovePlain.filter(p => toLufs(p) > threshold)
  if (!gated.length) return 0
  return gated.reduce((s, p) => s + p, 0) / gated.length
}

/** Linearly interpolated percentile, which is what the reference tools use. */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0]
  const pos = q * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Loudness range per EBU Tech 3342: the spread between the 10th and 95th
 * percentile of short-term loudness, after an absolute gate at −70 LUFS and a
 * relative gate 20 LU below the mean.
 */
function loudnessRange(shortTermPowers: readonly number[]): number {
  const above = shortTermPowers.filter(p => toLufs(p) > ABSOLUTE_GATE)
  if (above.length < 2) return 0
  const mean = above.reduce((s, p) => s + p, 0) / above.length
  const threshold = toLufs(mean) - 20
  const values = above
    .map(toLufs)
    .filter(l => l > threshold)
    .sort((a, b) => a - b)
  if (values.length < 2) return 0
  return percentile(values, 0.95) - percentile(values, 0.1)
}

export function measureLoudness(
  channels: readonly Float32Array[],
  sampleRate: number,
): LoudnessResult {
  const empty: LoudnessResult = {
    integrated: -Infinity,
    momentaryMax: -Infinity,
    shortTermMax: -Infinity,
    range: 0,
    samplePeakDb: -Infinity,
    durationSeconds: 0,
  }
  if (!channels.length || !channels[0].length) return empty

  const weighted = channels.map(c => kWeight(c, sampleRate))
  const prefix = prefixSquares(weighted)
  const total = channels[0].length

  const momentary = blockPowers(prefix, total, sampleRate, 0.4)
  const shortTerm = blockPowers(prefix, total, sampleRate, 3.0)
  const shortTermForRange = blockPowers(prefix, total, sampleRate, 3.0, 0.1)

  let peak = 0
  for (const c of channels) {
    for (let i = 0; i < c.length; i++) {
      const v = Math.abs(c[i])
      if (v > peak) peak = v
    }
  }

  return {
    integrated: toLufs(gatedMean(momentary)),
    momentaryMax: momentary.length ? Math.max(...momentary.map(toLufs)) : -Infinity,
    shortTermMax: shortTerm.length ? Math.max(...shortTerm.map(toLufs)) : -Infinity,
    range: loudnessRange(shortTermForRange),
    samplePeakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    durationSeconds: channels[0].length / sampleRate,
  }
}

export const LOUDNESS_TARGETS = {
  /** EBU R128 — European broadcast. */
  broadcast: { lufs: -23, truePeak: -1 },
  /** What the platforms normalise to. */
  social: { lufs: -16, truePeak: -1 },
} as const

export interface NormalisationPlan {
  readonly measured: number
  readonly target: number
  /** Linear gain to apply. */
  readonly gain: number
  readonly gainDb: number
  /** True if the gain would push the peak past the ceiling. */
  readonly wouldClip: boolean
  /** Gain actually applied once the peak ceiling is respected. */
  readonly safeGain: number
}

/**
 * How much to move the programme to hit a target, and whether that gain fits
 * under the peak ceiling. Reporting the clash is the point — silently limiting
 * is how a mix gets squashed without anyone noticing.
 */
export function planNormalisation(
  result: LoudnessResult,
  target: 'broadcast' | 'social' = 'social',
): NormalisationPlan {
  const spec = LOUDNESS_TARGETS[target]
  const measured = result.integrated
  if (!Number.isFinite(measured)) {
    return {
      measured,
      target: spec.lufs,
      gain: 1,
      gainDb: 0,
      wouldClip: false,
      safeGain: 1,
    }
  }
  const gainDb = spec.lufs - measured
  const gain = Math.pow(10, gainDb / 20)
  const peakAfter = result.samplePeakDb + gainDb
  const wouldClip = peakAfter > spec.truePeak
  const safeGainDb = wouldClip ? spec.truePeak - result.samplePeakDb : gainDb
  return {
    measured,
    target: spec.lufs,
    gain,
    gainDb,
    wouldClip,
    safeGain: Math.pow(10, safeGainDb / 20),
  }
}

/** Reads an AudioBuffer without depending on the DOM lib in this module. */
export interface AudioBufferLike {
  readonly numberOfChannels: number
  readonly sampleRate: number
  getChannelData(channel: number): Float32Array
}

export function measureAudioBuffer(buffer: AudioBufferLike): LoudnessResult {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  return measureLoudness(channels, buffer.sampleRate)
}

export function formatLufs(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : '—'
}
