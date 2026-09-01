// render-worker/src/audio.js
//
// The audio mix, built as an ffmpeg graph from the timeline.
//
// Two things happen here that the browser export never did:
//
//   • REAL DUCKING. A clip marked duckTarget is compressed by a clip marked
//     duckSource through a sidechain, so the music moves out of the way of the
//     voice and comes back when the voice stops. The Studio's music slider was
//     a static gain the whole time.
//
//   • REAL LOUDNESS. Two-pass loudnorm: measure the mix, then apply the
//     correction with the measured values. One-pass loudnorm is a live
//     estimator and will not land on a target; this lands within a tenth.

'use strict'

const { spawn } = require('child_process')
const { FFMPEG } = require('./sources')
const timeline = require('./timeline')

const TARGETS = {
  broadcast: { I: -23, TP: -1, LRA: 7 },
  social: { I: -16, TP: -1, LRA: 11 },
}

function run(args, { capture = 'stderr' } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, args)
    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('error', reject)
    proc.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg exited ${code}: ${err.slice(-2000)}`))
      else resolve(capture === 'stdout' ? out : err)
    })
  })
}

/**
 * Peak level of a source, in dBFS. Used to normalise the SIDECHAIN KEY.
 *
 * A fixed compressor threshold assumes the voice arrives at a predictable
 * level, and it does not — a quiet voiceover simply never crosses it and the
 * ducking silently does not happen, which is exactly what the first test run
 * showed. Normalising the key by a CONSTANT derived from measurement keeps the
 * speech-to-pause contrast intact, where a dynamic normaliser would lift the
 * silence too and duck through the gaps.
 */
async function probePeakDb(url, start, duration) {
  try {
    const err = await run([
      '-hide_banner', '-ss', String(start), '-t', String(duration),
      '-i', url, '-af', 'volumedetect', '-f', 'null', '-',
    ])
    const m = err.match(/max_volume:\s*(-?\d+(?:\.\d+)?)/)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

/** Every audio clip on the timeline, flattened with its timing in seconds. */
function collectAudio(timeline, framesToSeconds) {
  const items = []
  for (const track of timeline.tracks) {
    if (!track.enabled) continue
    for (const clip of track.clips) {
      if (!clip.enabled) continue
      const src = clip.source
      const isAudio = src.kind === 'audio'
      const isVideoWithSound = src.kind === 'video' && clip.audio
      if (!isAudio && !isVideoWithSound) continue

      // Gain automation is not expressible as one ffmpeg volume; take the value
      // at the clip's start and report it, rather than pretending otherwise.
      const gain = typeof clip.audio?.gain === 'number' ? clip.audio.gain : 1
      if (gain <= 0) continue

      items.push({
        url: src.url,
        start: framesToSeconds(clip.start),
        duration: framesToSeconds(clip.duration),
        sourceIn: framesToSeconds(clip.sourceIn),
        gain,
        duckSource: clip.audio?.duckSource === true,
        duckTarget: clip.audio?.duckTarget === true,
        fadeIn: framesToSeconds(clip.fadeIn),
        fadeOut: framesToSeconds(clip.fadeOut),
        name: clip.name,
        // The per-clip processing chain and its automation envelope. Both are
        // compiled by lib/timeline/audio.ts, so the Studio can show exactly the
        // filters that will run rather than a hopeful description of them.
        effects: clip.audio?.effects || null,
        gainPoints: clip.audio?.gainPoints || null,
      })
    }
  }
  return items
}

function buildGraph(items, sampleRate, totalSeconds, sourceKeyGain = []) {
  const parts = []
  const sources = []
  const targets = []
  const plain = []

  items.forEach((item, i) => {
    const label = `a${i}`
    const chain = [
      `atrim=start=${item.sourceIn.toFixed(3)}:duration=${item.duration.toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      `aresample=${sampleRate}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      `volume=${item.gain.toFixed(4)}`,
    ]

    // PROCESSING, BEFORE THE FADES AND THE DELAY.
    //
    // A gate and a compressor have to see the clip's own dynamics, not a fade
    // that has already flattened its opening, and certainly not silence padded
    // in front of it by adelay. Order matters here for the same reason it
    // matters inside the chain itself.
    const fx = timeline.compileChain(item.effects)
    if (fx) chain.push(fx)

    // Automation last of the level moves: a hand-drawn envelope is intent, and
    // it should not be re-shaped by a compressor that ran after it.
    if (item.gainPoints && item.gainPoints.length) {
      const auto = timeline.compileGainAutomation(item.gainPoints)
      if (auto) chain.push(auto)
    }
    if (item.fadeIn > 0.001) chain.push(`afade=t=in:st=0:d=${item.fadeIn.toFixed(3)}`)
    if (item.fadeOut > 0.001) {
      chain.push(`afade=t=out:st=${Math.max(0, item.duration - item.fadeOut).toFixed(3)}:d=${item.fadeOut.toFixed(3)}`)
    }
    const delayMs = Math.round(item.start * 1000)
    if (delayMs > 0) chain.push(`adelay=${delayMs}|${delayMs}`)

    parts.push(`[${i}:a]${chain.join(',')}[${label}]`)
    if (item.duckSource) sources.push(label)
    else if (item.duckTarget) targets.push(label)
    else plain.push(label)
  })

  const mixInputs = []

  if (sources.length && targets.length) {
    // The sidechain key is the voice; it is duplicated because it also has to
    // reach the mix. asplit is the only way to use one stream twice.
    const keyed = []
    sources.forEach((label, i) => {
      parts.push(`[${label}]asplit=2[${label}mix][${label}key${i}]`)
      mixInputs.push(`${label}mix`)
      keyed.push(`${label}key${i}`)
    })
    // sidechaincompress ends when the SHORTER of its two inputs ends. A voice
    // that stops before the music would therefore truncate the music — and,
    // through the mux, the picture with it. Pad the key to the full length so
    // the compressor keeps running with the key at silence, which is exactly
    // when the music should come back up.
    keyed.forEach((label, i) => {
      const gain = sourceKeyGain[i] ?? 1
      const chain = [`apad=whole_dur=${Number(totalSeconds).toFixed(3)}`]
      if (gain > 1.01) chain.push(`volume=${gain.toFixed(3)}`)
      parts.push(`[${label}]${chain.join(',')}[${label}p]`)
      keyed[i] = `${label}p`
    })
    // With more than one voice, sum the keys into a single control signal.
    let key = keyed[0]
    if (keyed.length > 1) {
      parts.push(`${keyed.map(k => `[${k}]`).join('')}amix=inputs=${keyed.length}:normalize=0[keysum]`)
      key = 'keysum'
    }
    targets.forEach((label, i) => {
      const keyForThis = `${key}${targets.length > 1 ? `d${i}` : ''}`
      if (targets.length > 1) parts.push(`[${key}]asplit=1[${keyForThis}]`)
      parts.push(
        `[${label}][${targets.length > 1 ? keyForThis : key}]` +
        // threshold ~ -30 dBFS, 8:1, fast enough to catch a word, slow enough
        // not to pump between them.
        'sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350:makeup=1' +
        `[${label}duck]`,
      )
      mixInputs.push(`${label}duck`)
    })
  } else {
    mixInputs.push(...sources, ...targets)
  }
  mixInputs.push(...plain)

  if (!mixInputs.length) return null
  if (mixInputs.length === 1) {
    parts.push(`[${mixInputs[0]}]anull[mix]`)
  } else {
    parts.push(`${mixInputs.map(l => `[${l}]`).join('')}amix=inputs=${mixInputs.length}:normalize=0:dropout_transition=0[mix]`)
  }
  return { filter: parts.join(';'), label: 'mix' }
}

/** Mixes every audio clip into one WAV, with ducking applied. */
async function mixAudio(items, { out, sampleRate, duration }) {
  // Bring each sidechain key's peak to about -6 dBFS so the threshold below
  // means "the voice is speaking" rather than "the voice happens to be loud".
  const keyGains = []
  for (const item of items) {
    if (!item.duckSource) continue
    const peak = await probePeakDb(item.url, item.sourceIn, item.duration)
    const gain = peak === null || peak >= -6 ? 1 : Math.min(64, Math.pow(10, (-6 - peak) / 20))
    keyGains.push(gain)
  }
  const graph = buildGraph(items, sampleRate, duration, keyGains)
  if (!graph) return null
  const args = ['-hide_banner', '-loglevel', 'error', '-y']
  for (const item of items) args.push('-i', item.url)
  args.push(
    '-filter_complex', graph.filter,
    '-map', `[${graph.label}]`,
    '-t', duration.toFixed(3),
    '-c:a', 'pcm_s16le', '-ar', String(sampleRate), '-ac', '2',
    out,
  )
  await run(args)
  return out
}

function parseLoudnormJson(stderr) {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try { return JSON.parse(stderr.slice(start, end + 1)) } catch { return null }
}

/**
 * Two-pass loudness normalisation to an EBU R128 target.
 * Returns the measured values so the job can report what it actually delivered.
 */
async function normalise(input, output, target = 'social') {
  const spec = TARGETS[target] || TARGETS.social
  const base = `I=${spec.I}:TP=${spec.TP}:LRA=${spec.LRA}`

  const measureErr = await run([
    '-hide_banner', '-i', input,
    '-af', `loudnorm=${base}:print_format=json`,
    '-f', 'null', '-',
  ])
  const measured = parseLoudnormJson(measureErr)

  const filter = measured
    ? `loudnorm=${base}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
      `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
      `:offset=${measured.target_offset}:linear=true:print_format=summary`
    : `loudnorm=${base}`

  await run([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-af', filter,
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2',
    output,
  ])

  return {
    target: spec,
    measuredBefore: measured
      ? {
          integrated: Number(measured.input_i),
          truePeak: Number(measured.input_tp),
          range: Number(measured.input_lra),
        }
      : null,
  }
}

module.exports = { collectAudio, buildGraph, mixAudio, normalise, probePeakDb, run, TARGETS }
