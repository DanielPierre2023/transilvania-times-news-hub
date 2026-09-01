// lib/timeline/beats.ts
//
// Cuts that land on the beat.
//
// Most of what makes a promo feel professional is not the pictures. It is that
// the edit agrees with the music: the cut arrives on the downbeat, the title
// lands with the snare, the end card resolves with the phrase. Miss it by three
// frames and the film feels amateur without anyone being able to say why.
//
// HOW IT WORKS, AND WHAT IT DELIBERATELY DOES NOT DO.
//
// Spectral flux onset detection: split the signal into short frames, take the
// magnitude spectrum of each, sum only the bins that got LOUDER than the last
// frame (a note starting is energy appearing; a note ending is not an onset),
// and pick peaks out of that curve against a moving median. Then estimate tempo
// by autocorrelating the onset curve and reading the strongest lag inside a
// musical range.
//
// It does not try to find bar lines, time signatures or genre. A beat grid and a
// tempo are what an edit needs; everything beyond that is a research project
// wearing the costume of a feature.
//
// It runs on decoded samples so both halves can use it: the browser has the
// track in an AudioBuffer, and the worker can decode one with ffmpeg.

export interface BeatAnalysis {
  /** Seconds, ascending. Detected note onsets. */
  readonly onsets: readonly number[]
  /** Beats per minute, or null when the signal is not musical enough to say. */
  readonly bpm: number | null
  /** Seconds. The inferred grid, phase-aligned to the strongest onsets. */
  readonly beats: readonly number[]
  /** 0..1. How strongly the onsets agree with the grid. */
  readonly confidence: number
}

const FFT_SIZE = 1024
const HOP = 256

/** Real FFT magnitude via a straightforward radix-2 complex transform. */
function magnitudes(re: Float64Array, im: Float64Array): Float64Array {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
  const out = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) out[i] = Math.hypot(re[i], im[i])
  return out
}

/** The onset strength curve: energy that APPEARED since the last frame. */
export function onsetCurve(samples: Float32Array | Float64Array, sampleRate: number): {
  curve: Float64Array; hopSeconds: number
} {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP))
  const curve = new Float64Array(Math.max(0, frames))
  let prev: Float64Array | null = null
  const window = new Float64Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))

  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(FFT_SIZE)
    const im = new Float64Array(FFT_SIZE)
    const off = f * HOP
    for (let i = 0; i < FFT_SIZE; i++) re[i] = samples[off + i] * window[i]
    const mag = magnitudes(re, im)
    if (prev) {
      let flux = 0
      for (let i = 0; i < mag.length; i++) {
        const d = mag[i] - prev[i]
        if (d > 0) flux += d          // rectified: only energy appearing counts
      }
      curve[f] = flux
    }
    prev = mag
  }
  return { curve, hopSeconds: HOP / sampleRate }
}

/** Peaks that stand above their own neighbourhood, not above a fixed number. */
function pickPeaks(curve: Float64Array, hopSeconds: number, sensitivity = 1.4): number[] {
  const win = Math.max(3, Math.round(0.25 / hopSeconds))     // quarter-second median
  const out: number[] = []
  let lastAt = -Infinity
  const minGap = 0.06                                        // 60 ms refractory
  for (let i = 1; i < curve.length - 1; i++) {
    const lo = Math.max(0, i - win), hi = Math.min(curve.length, i + win)
    let sum = 0
    for (let j = lo; j < hi; j++) sum += curve[j]
    const mean = sum / (hi - lo)
    if (mean <= 0) continue
    if (curve[i] < mean * sensitivity) continue
    if (curve[i] < curve[i - 1] || curve[i] < curve[i + 1]) continue
    const t = i * hopSeconds
    if (t - lastAt < minGap) continue
    out.push(t)
    lastAt = t
  }
  return out
}

/**
 * Tempo by autocorrelating the onset curve.
 *
 * Restricted to 60–190 BPM, which is not timidity: outside that range the
 * strongest correlation is nearly always a half-time or double-time echo of the
 * real tempo, and choosing one confidently is worse than declining.
 */
function estimateBpm(curve: Float64Array, hopSeconds: number): { bpm: number | null; confidence: number } {
  const minLag = Math.max(1, Math.round(60 / 190 / hopSeconds))
  const maxLag = Math.min(curve.length - 1, Math.round(60 / 60 / hopSeconds))
  if (maxLag <= minLag) return { bpm: null, confidence: 0 }

  let mean = 0
  for (const v of curve) mean += v
  mean /= Math.max(1, curve.length)

  const scores: { lag: number; acc: number }[] = []
  let best = -Infinity, total = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0
    for (let i = 0; i + lag < curve.length; i++) acc += (curve[i] - mean) * (curve[i + lag] - mean)
    // THE BIASED ESTIMATOR, ON PURPOSE.
    //
    // Dividing by the overlap (length − lag) looks more correct and is worse: it
    // scales up long lags, which have fewer terms, so the correlation at twice
    // the true period comes out HIGHER than at the period. Measured — 120 BPM
    // reported 60.1 and 140 reported 69.8 even with a tempo prior in place,
    // because the halved lag genuinely scored higher before the prior ran.
    // Dividing by a constant tapers long lags, which is the behaviour that makes
    // the fundamental win.
    acc /= curve.length
    scores.push({ lag, acc })
    total += Math.abs(acc)
    if (acc > best) best = acc
  }
  if (!scores.length || best <= 0) return { bpm: null, confidence: 0 }

  // THE OCTAVE ERROR, WHICH IS THE ONLY HARD PART OF TEMPO ESTIMATION.
  //
  // A periodic signal correlates strongly at multiples of its period — every
  // other click still lines up — and on a real click track the DOUBLE lag can
  // score higher than the true one. Measured at 120 BPM: lag 86 scored 233 while
  // lag 43, the actual tempo, scored 148. So it is not a matter of a tie needing
  // breaking; the wrong answer wins outright.
  //
  // A "prefer something near 120 BPM" prior does not fix that on its own,
  // because the true lag never gets close enough to the winner to be considered.
  // What does fix it is asking the question directly: if half this lag also
  // correlates respectably, then this lag is the harmonic and half is the
  // fundamental. Sub-multiples are tested explicitly, the smallest lag that
  // still holds a decent share of the peak wins, and the log-space prior only
  // settles what is left.
  const accAt = (lag: number) => {
    const s = scores.find(x => x.lag === lag)
    return s ? s.acc : -Infinity
  }
  const peak = scores.reduce((a, b) => (b.acc > a.acc ? b : a), scores[0])

  // A third of the peak is enough to believe a sub-multiple: at 120 BPM the
  // fundamental held 63% of it, and a lag that is merely noise holds far less.
  const SHARE = 0.35
  const candidates = [peak.lag]
  for (const div of [2, 3]) {
    const lag = Math.round(peak.lag / div)
    if (lag >= minLag && lag <= maxLag) {
      // Look at the best of the three neighbouring lags: the true period is
      // rarely a whole number of hops, so its energy straddles two of them.
      const near = Math.max(accAt(lag - 1), accAt(lag), accAt(lag + 1))
      if (near >= peak.acc * SHARE) candidates.push(
        [lag - 1, lag, lag + 1].reduce((a, b) => (accAt(b) > accAt(a) ? b : a), lag))
    }
  }

  const PREFER = 120
  let chosen = candidates[0], bestFit = Infinity
  for (const lag of candidates) {
    const bpm = 60 / (lag * hopSeconds)
    const fit = Math.abs(Math.log2(bpm / PREFER))
    if (fit < bestFit) { bestFit = fit; chosen = lag }
  }
  const best2 = peak.acc

  const avg = total / Math.max(1, scores.length)
  return {
    bpm: 60 / (chosen * hopSeconds),
    confidence: Math.max(0, Math.min(1, avg > 0 ? (best2 / avg - 1) / 4 : 0)),
  }
}

/**
 * The grid, phase-aligned AND period-refined against the onsets.
 *
 * Autocorrelation resolves tempo to the width of one analysis hop — about 11 ms
 * — which is fine as a number and not fine as a grid. At 120 BPM the estimate
 * came back 117.5, and over ten seconds a 2.5 BPM error accumulates 0.21 s of
 * drift: by the end the grid sits between the beats instead of on them, and a
 * cut snapped to it lands in the wrong place.
 *
 * So the coarse period is only a starting point. Each onset is assigned to its
 * nearest grid index and the period and phase are re-fitted by least squares
 * over those pairs, which uses every onset in the track rather than the
 * resolution of one FFT hop. The grid then tracks the music for its whole
 * length instead of walking away from it.
 */
function gridFrom(onsets: readonly number[], bpm: number, until: number): { beats: number[]; bpm: number } {
  let period = 60 / bpm

  // Coarse phase: the offset most onsets agree with.
  let phase = 0, bestScore = -1
  for (const o of onsets.slice(0, 40)) {
    const cand = o % period
    let score = 0
    for (const q of onsets) {
      const d = ((q - cand) % period + period) % period
      if (Math.min(d, period - d) < period * 0.12) score++
    }
    if (score > bestScore) { bestScore = score; phase = cand }
  }

  // Two refinement passes. One is usually enough; the second costs nothing and
  // rescues a first pass that assigned a few onsets to the wrong index.
  for (let pass = 0; pass < 2; pass++) {
    const xs: number[] = [], ys: number[] = []
    for (const o of onsets) {
      const k = Math.round((o - phase) / period)
      const predicted = phase + k * period
      if (Math.abs(o - predicted) > period * 0.2) continue   // not on this grid
      xs.push(k); ys.push(o)
    }
    if (xs.length < 3) break
    const n = xs.length
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
    if (den <= 0) break
    const slope = num / den
    if (!Number.isFinite(slope) || slope <= 0) break
    // Refuse a fit that has wandered to a different tempo entirely: that means
    // the assignment was wrong, not the period.
    if (slope < period * 0.7 || slope > period * 1.4) break
    period = slope
    phase = my - slope * mx
  }

  phase = ((phase % period) + period) % period
  const beats: number[] = []
  for (let t = phase; t <= until + 1e-6; t += period) beats.push(Number(t.toFixed(4)))
  return { beats, bpm: 60 / period }
}

export function analyseBeats(
  samples: Float32Array | Float64Array,
  sampleRate: number,
  opts: { sensitivity?: number } = {},
): BeatAnalysis {
  if (!samples || samples.length < FFT_SIZE * 4 || !sampleRate) {
    return { onsets: [], bpm: null, beats: [], confidence: 0 }
  }
  const { curve, hopSeconds } = onsetCurve(samples, sampleRate)
  const onsets = pickPeaks(curve, hopSeconds, opts.sensitivity ?? 1.4)
  const { bpm, confidence } = estimateBpm(curve, hopSeconds)
  const until = samples.length / sampleRate
  if (!bpm || onsets.length < 2) return { onsets, bpm, beats: [], confidence }
  const fitted = gridFrom(onsets, bpm, until)
  return { onsets, bpm: fitted.bpm, beats: fitted.beats, confidence }
}

/**
 * Move a cut to the nearest beat, but only if it is already close.
 *
 * A cut dragged a second and a half to reach a downbeat is no longer the cut the
 * editor chose. `maxShift` is the whole safety of this feature: outside it the
 * original stands, because the music serves the film rather than the other way
 * round.
 */
export function snapToBeats(
  cuts: readonly number[],
  beats: readonly number[],
  maxShift = 0.25,
): number[] {
  if (!beats.length) return [...cuts]
  return cuts.map(t => {
    let best = t, dist = Infinity
    for (const b of beats) {
      const d = Math.abs(b - t)
      if (d < dist) { dist = d; best = b }
    }
    return dist <= maxShift ? Number(best.toFixed(4)) : t
  })
}

/** Cut points from a run of durations, and back again. */
export function cutsFromDurations(durations: readonly number[]): number[] {
  const out: number[] = []
  let t = 0
  for (let i = 0; i < durations.length - 1; i++) { t += durations[i]; out.push(Number(t.toFixed(4))) }
  return out
}

export function durationsFromCuts(cuts: readonly number[], total: number, min = 0.5): number[] {
  const out: number[] = []
  let prev = 0
  for (const c of cuts) { out.push(Math.max(min, Number((c - prev).toFixed(4)))); prev = c }
  out.push(Math.max(min, Number((total - prev).toFixed(4))))
  return out
}
