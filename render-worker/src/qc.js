// render-worker/src/qc.js
//
// Automated acceptance on the rendered file.
//
// A render that has to be checked by a human frame by frame does not scale, and
// the mistakes that matter are the ones nobody notices while watching their own
// edit: a file two frames short, audio that drifted, loudness off target, a
// picture that silently came out at the wrong size. Every job carries this
// report, so a failure is caught before delivery rather than after.

'use strict'

const { spawn } = require('child_process')
const { FFMPEG } = require('./sources')

const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe'

function exec(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args)
    let out = ''
    let err = ''
    proc.stdout.on('data', d => { out += d.toString() })
    proc.stderr.on('data', d => { err += d.toString() })
    proc.on('error', reject)
    proc.on('close', () => resolve({ out, err }))
  })
}

async function probe(file) {
  const { out } = await exec(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file,
  ])
  try { return JSON.parse(out) } catch { return null }
}

async function measureLoudness(file) {
  const { err } = await exec(FFMPEG, ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
  const summary = err.slice(err.lastIndexOf('Summary:'))
  const num = re => {
    const m = summary.match(re)
    return m ? Number(m[1]) : null
  }
  return {
    integrated: num(/I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/),
    range: num(/LRA:\s+(-?\d+(?:\.\d+)?)\s+LU/),
    truePeak: num(/Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/),
  }
}

const TARGET_LUFS = { broadcast: -23, social: -16 }

/**
 * @param file      the rendered master
 * @param expected  { width, height, fps, frames, durationSeconds, loudness }
 */
async function inspect(file, expected) {
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })

  const info = await probe(file)
  if (!info) {
    return { passed: false, checks: [{ name: 'readable', ok: false, detail: 'ffprobe could not read the file' }] }
  }

  const video = info.streams.find(s => s.codec_type === 'video')
  const audio = info.streams.find(s => s.codec_type === 'audio')

  add('has a video stream', !!video, video ? video.codec_name : 'none')

  if (video) {
    add(
      'resolution matches the master',
      video.width === expected.width && video.height === expected.height,
      `${video.width}×${video.height}, expected ${expected.width}×${expected.height}`,
    )
    const [num, den] = String(video.r_frame_rate || '0/1').split('/').map(Number)
    const fps = den ? num / den : 0
    add('frame rate matches', Math.abs(fps - expected.fps) < 0.01, `${fps.toFixed(3)} fps`)
    if (video.nb_frames) {
      add(
        'frame count is exact',
        Number(video.nb_frames) === expected.frames,
        `${video.nb_frames}, expected ${expected.frames}`,
      )
    }
    add(
      'dimensions are even (H.264 requires it)',
      video.width % 2 === 0 && video.height % 2 === 0,
      `${video.width}×${video.height}`,
    )
  }

  const duration = Number(info.format?.duration || 0)
  add(
    'duration matches the timeline',
    Math.abs(duration - expected.durationSeconds) < 0.2,
    `${duration.toFixed(2)}s, expected ${expected.durationSeconds.toFixed(2)}s`,
  )

  if (expected.loudness && expected.loudness !== 'none') {
    add('has an audio stream', !!audio, audio ? audio.codec_name : 'none')
    if (audio) {
      const measured = await measureLoudness(file)
      const target = TARGET_LUFS[expected.loudness] ?? -16
      add(
        `loudness within 1 LU of ${target} LUFS`,
        measured.integrated !== null && Math.abs(measured.integrated - target) <= 1,
        `${measured.integrated} LUFS`,
      )
      add(
        'true peak under -1 dBFS',
        measured.truePeak !== null && measured.truePeak <= -1,
        `${measured.truePeak} dBFS`,
      )
      checks.loudness = measured
    }
  }

  return {
    passed: checks.every(c => c.ok),
    checks,
    probed: video
      ? { width: video.width, height: video.height, codec: video.codec_name, frames: video.nb_frames, duration }
      : null,
  }
}

module.exports = { inspect, probe, measureLoudness }
