// render-worker/src/render.js
//
// The deterministic renderer.
//
// Frames are drawn one at a time from the compiled draw list and piped raw into
// ffmpeg. Nothing here depends on wall-clock time, on a browser tab staying in
// the foreground, or on a machine being fast enough — render the same timeline
// twice and you get the same bytes. That is the property the browser's
// MediaRecorder capture could never have, and the reason a post house would not
// accept its output.

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { createCanvas } = require('canvas')

const { drawFrame } = require('./draw')
const { ImageCache, VideoTap, FFMPEG } = require('./sources')
const { collectAudio, mixAudio, normalise, run } = require('./audio')
const { gradeFilm } = require('./grade')
const timeline = require('./timeline')

const CODECS = {
  h264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
  prores422: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'],
}

async function renderTimeline(tl, opts = {}) {
  const onProgress = opts.onProgress || (() => {})
  const workDir = opts.workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ttrender-'))
  fs.mkdirSync(workDir, { recursive: true })

  const { width, height, fps: rational, sampleRate } = tl.timebase
  const fps = timeline.rate(rational)
  const totalFrames = tl.duration
  const durationSeconds = timeline.framesToSeconds(totalFrames, rational)

  const problems = timeline.validate(tl).filter(p => p.severity === 'error')
  if (problems.length) {
    throw new Error('Timeline is not renderable: ' + problems.map(p => `${p.where}: ${p.message}`).join('; '))
  }

  const codec = CODECS[tl.delivery?.codec] || CODECS.h264
  const extension = tl.delivery?.codec === 'prores422' ? 'mov' : 'mp4'
  const silentVideo = path.join(workDir, `video.${extension}`)
  const finalOut = opts.output || path.join(workDir, `master.${extension}`)

  /* ---------------------------------------------------------------- picture */

  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  const images = new ImageCache()

  // Pre-load every still so a fetch never stalls the frame loop mid-render.
  const stillUrls = new Set()
  for (const track of tl.tracks) {
    for (const clip of track.clips) {
      if (clip.source.kind === 'image') stillUrls.add(clip.source.url)
    }
  }
  for (const url of stillUrls) await images.get(url)

  const taps = new Map()
  const openTap = (clip, url) => {
    if (taps.has(clip.id)) return taps.get(clip.id)
    const tap = new VideoTap({
      url,
      startSeconds: timeline.framesToSeconds(clip.sourceIn, rational),
      width, height, fps,
      createCanvas,
    })
    taps.set(clip.id, tap)
    return tap
  }

  const clipsById = new Map()
  for (const track of tl.tracks) for (const clip of track.clips) clipsById.set(clip.id, clip)

  const encoder = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`, '-r', String(fps),
    '-i', 'pipe:0',
    ...codec,
    '-r', String(fps),
    silentVideo,
  ])
  let encoderError = ''
  encoder.stderr.on('data', d => { encoderError += d.toString() })
  const encoderDone = new Promise((resolve, reject) => {
    encoder.on('close', code => code === 0 ? resolve() : reject(new Error(`encoder exited ${code}: ${encoderError.slice(-2000)}`)))
    encoder.on('error', reject)
  })

  // One persistent error handler. Attaching a fresh one per frame leaks
  // listeners — at 25 fps the warning fires within half a second of video.
  let writeError = null
  encoder.stdin.on('error', err => { writeError = err })
  const write = buffer => new Promise((resolve, reject) => {
    if (writeError) { reject(writeError); return }
    if (encoder.stdin.write(buffer)) resolve()
    else encoder.stdin.once('drain', resolve)
  })

  try {
    for (let f = 0; f < totalFrames; f++) {
      const compiled = timeline.compileFrame(tl, f)

      // Video taps must be advanced exactly once per output frame, whether or
      // not the frame is visible, or the source drifts out of sync.
      const bitmaps = new Map()
      for (const op of compiled.video) {
        if (op.source.kind !== 'video') continue
        const clip = clipsById.get(op.clipId)
        if (!clip) continue
        const tap = openTap(clip, op.source.url)
        bitmaps.set(op.clipId, await tap.next())
      }

      drawFrame(ctx, compiled, width, height, op => {
        if (op.source.kind === 'video') return bitmaps.get(op.clipId) || null
        return images.map.get(op.source.url) || null
      })

      await write(canvas.toBuffer('raw'))

      if (f % Math.max(1, Math.round(fps)) === 0) {
        onProgress({ phase: 'video', frame: f, total: totalFrames, percent: f / totalFrames })
      }
    }
  } finally {
    for (const tap of taps.values()) tap.close()
  }

  encoder.stdin.end()
  await encoderDone

  /* ------------------------------------------------------------------ grade */
  // Applied once over the assembled cut, per shot, using the timeline's own cut
  // list. This is what makes independently generated shots read as one film.
  onProgress({ phase: 'grade', percent: 0.86 })

  let gradeReport = null
  let picture = silentVideo
  const gradeSpec = tl.delivery && tl.delivery.grade
  if (gradeSpec && gradeSpec.look && gradeSpec.look !== 'none') {
    const cuts = timeline.cutFrames(tl)
    const shots = []
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = timeline.framesToSeconds(cuts[i], rational)
      const b = timeline.framesToSeconds(cuts[i + 1], rational)
      if (b - a > 0.25) shots.push({ start: a, end: b })
    }
    if (shots.length) {
      const graded = path.join(workDir, `graded.${extension}`)
      gradeReport = await gradeFilm(picture, graded, shots, gradeSpec)
      if (gradeReport.applied) picture = graded
    }
  }

  /* ------------------------------------------------------------------ sound */

  onProgress({ phase: 'audio', percent: 0.9 })

  const audioItems = collectAudio(tl, frames => timeline.framesToSeconds(frames, rational))
  let loudness = null
  let audioPath = null

  if (audioItems.length) {
    const mixed = await mixAudio(audioItems, {
      out: path.join(workDir, 'mix.wav'),
      sampleRate: sampleRate || 48000,
      duration: durationSeconds,
    })
    const normalised = path.join(workDir, 'mix-normalised.wav')
    const target = tl.delivery?.loudness === 'none' ? null : (tl.delivery?.loudness || 'social')
    if (target) {
      loudness = await normalise(mixed, normalised, target)
      audioPath = normalised
    } else {
      audioPath = mixed
    }
  }

  /* ------------------------------------------------------------------- mux  */

  onProgress({ phase: 'mux', percent: 0.95 })

  if (audioPath) {
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', picture, '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      ...(extension === 'mov' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '192k']),
      // Deliberately NOT -shortest. If the mix ever comes out short, -shortest
      // truncates the PICTURE to match, which is a silent, invisible failure.
      // Pinning the length instead means a short mix costs you tail silence,
      // never frames.
      '-t', durationSeconds.toFixed(3),
      finalOut,
    ])
  } else {
    fs.copyFileSync(picture, finalOut)
  }

  onProgress({ phase: 'done', percent: 1 })

  return {
    output: finalOut,
    workDir,
    width,
    height,
    fps,
    frames: totalFrames,
    durationSeconds,
    codec: tl.delivery?.codec || 'h264',
    loudness,
    grade: gradeReport,
  }
}

module.exports = { renderTimeline, CODECS }
