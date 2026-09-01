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
const { resolveBuiltins } = require('./sfx')
const { checkFonts } = require('./fonts')
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
      // AN HTML BLOCK IS A BITMAP BY THE TIME IT GETS HERE.
      //
      // It was rasterised once, in the browser, into a real file — so the worker
      // loads that file exactly as it loads any still. No headless Chrome in the
      // render path, and no second layout engine that could disagree with the
      // one the author was looking at.
      //
      // A block with no url has never been rasterised. Failing loudly is right:
      // a silently missing layer is how a film ships without its lower third.
      if (clip.source.kind === 'html') {
        if (!clip.source.url && !(clip.source.frames || []).length) {
          throw new Error(`Compoziția HTML "${clip.name || clip.id}" nu a fost rasterizată. ` +
            'Deschide-o în Studio și apasă Rasterizează.')
        }
        if (clip.source.url) stillUrls.add(clip.source.url)
        // An animated composition is a sequence; every frame is a still.
        for (const u of clip.source.frames || []) stillUrls.add(u)
      }
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

  // ── PICTURE AND GRAPHICS ARE TWO LAYERS ─────────────────────────────────
  //
  // The house grade is applied over the assembled cut. Applied over the whole
  // COMPOSITE it also lands on the titles, and a warm look at 0.85 turns white
  // type cream and pulls the accent off its own value — the brand red stops
  // being the brand red. Broadcast practice is to grade the picture and lay
  // graphics on top ungraded.
  //
  // So when there is both a grade and something to protect from it, the frame
  // loop draws twice: picture into the main encoder, graphics into a second
  // stream that carries alpha, and the two are composited after the grade.
  // When either is absent this is exactly the old single pass, because paying
  // for a second encode to protect nothing would be silly.
  // Checked before a single frame is drawn, so a missing brand face is reported
  // rather than silently substituted.
  const fonts = checkFonts(tl)
  if (!fonts.ok) {
    console.warn('[fonts] not resolved here, rendering in the fallback face:',
      fonts.missing.map(f => `${f.family} ${f.weight}`).join(', '))
  }

  const gradeSpec = tl.delivery && tl.delivery.grade
  const gradeActive = !!(gradeSpec && gradeSpec.look && gradeSpec.look !== 'none')
  const hasGraphics = tl.tracks.some(t =>
    t.kind === 'video' && t.enabled !== false && t.z >= timeline.GRAPHICS_Z && t.clips.length > 0)
  const splitLayers = gradeActive && hasGraphics

  const encoder = spawn(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    // BGRA, NOT RGBA.
    //
    // node-canvas hands back Cairo's native ARGB32, which on a little-endian
    // machine is B, G, R, A in memory. Telling ffmpeg 'rgba' made it read the
    // blue byte as red and the red byte as blue in EVERY frame of EVERY render
    // this worker has ever produced.
    //
    // Measured: a #CA2222 rectangle (R 202, G 34, B 34) came out of the encoder
    // as R 33, G 33, B 202. Exactly the swap.
    //
    // This is the real reason a warm golden-hour still arrived on screen cold
    // and blue, and the reason the delivered film measured B−R of +60, +39 and
    // +49 across its shots. That was read at the time as the generation model
    // drifting; it was this line. The browser preview never had the bug — it
    // draws straight to a visible canvas — so the preview looked right and the
    // file did not, which is the worst shape a bug can take.
    '-f', 'rawvideo', '-pix_fmt', 'bgra',
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

  // The graphics stream. PNG in a MOV: lossless and, critically, it keeps the
  // alpha channel, which every delivery codec here throws away.
  const gfxPath = path.join(workDir, 'graphics.mov')
  const gfxCanvas = splitLayers ? createCanvas(width, height) : null
  const gfxCtx = gfxCanvas ? gfxCanvas.getContext('2d') : null
  let gfxEncoder = null
  let gfxDone = Promise.resolve()
  if (splitLayers) {
    gfxEncoder = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'bgra',
      '-s', `${width}x${height}`, '-r', String(fps),
      '-i', 'pipe:0',
      '-c:v', 'png', '-pix_fmt', 'rgba',
      '-r', String(fps),
      gfxPath,
    ])
    let gfxErr = ''
    gfxEncoder.stderr.on('data', d => { gfxErr += d.toString() })
    gfxDone = new Promise((resolve, reject) => {
      gfxEncoder.on('close', code => code === 0 ? resolve() : reject(new Error(`graphics encoder exited ${code}: ${gfxErr.slice(-2000)}`)))
      gfxEncoder.on('error', reject)
    })
  }

  // One persistent error handler. Attaching a fresh one per frame leaks
  // listeners — at 25 fps the warning fires within half a second of video.
  let writeError = null
  encoder.stdin.on('error', err => { writeError = err })
  const writeTo = (proc, buffer) => new Promise((resolve, reject) => {
    if (writeError) { reject(writeError); return }
    if (proc.stdin.write(buffer)) resolve()
    else proc.stdin.once('drain', resolve)
  })
  const write = buffer => writeTo(encoder, buffer)
  if (gfxEncoder) gfxEncoder.stdin.on('error', err => { writeError = err })

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
        // A ramped clip walks its source at a variable pace; an unramped one
        // advances exactly one frame per output frame, as before. Both go
        // through the same tap so there is one notion of "which frame is on
        // screen" and the preview cannot disagree with the render.
        if (clip.speed) {
          const local = f - clip.start
          bitmaps.set(op.clipId, await tap.advanceTo(timeline.sourceOffset(clip.speed, local)))
        } else {
          bitmaps.set(op.clipId, await tap.next())
        }
      }

      const resolve = op => {
        if (op.source.kind === 'video') return bitmaps.get(op.clipId) || null
        // An animated composition holds a sequence; the shared helper decides
        // which frame is on screen, so the preview cannot pick a different one.
        if (op.source.kind === 'html') {
          const u = timeline.frameUrlAt(op.source, op.localFrame, fps)
          return (u && images.map.get(u)) || null
        }
        return images.map.get(op.source.url) || null
      }

      if (splitLayers) {
        drawFrame(ctx, compiled, width, height, resolve, { filter: op => !timeline.isGraphic(op) })
        // Transparent, not black: the graphics layer is a matte and everything
        // it does not cover must let the picture through.
        gfxCtx.clearRect(0, 0, width, height)
        drawFrame(gfxCtx, compiled, width, height, resolve, { clear: false, filter: timeline.isGraphic })
        await write(canvas.toBuffer('raw'))
        await writeTo(gfxEncoder, gfxCanvas.toBuffer('raw'))
      } else {
        drawFrame(ctx, compiled, width, height, resolve)
        await write(canvas.toBuffer('raw'))
      }

      if (f % Math.max(1, Math.round(fps)) === 0) {
        onProgress({ phase: 'video', frame: f, total: totalFrames, percent: f / totalFrames })
      }
    }
  } finally {
    for (const tap of taps.values()) tap.close()
  }

  encoder.stdin.end()
  if (gfxEncoder) gfxEncoder.stdin.end()
  await encoderDone
  await gfxDone

  /* ------------------------------------------------------------------ grade */
  // Applied once over the assembled cut, per shot, using the timeline's own cut
  // list. This is what makes independently generated shots read as one film.
  onProgress({ phase: 'grade', percent: 0.86 })

  let gradeReport = null
  let picture = silentVideo
  if (gradeActive) {
    const cuts = timeline.cutFrames(tl)
    // A shot's own colour override travels on the clip that starts it, so the
    // cut list is matched back to the picture clips rather than being a bare
    // list of times.
    const pictureClips = (tl.tracks.find(t => t.kind === 'video' && t.z === 0)?.clips || [])
      .slice().sort((a, b) => a.start - b.start)
    const gradeAt = (frame) => pictureClips.find(c => frame >= c.start && frame < c.start + c.duration)?.grade || null
    const shots = []
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = timeline.framesToSeconds(cuts[i], rational)
      const b = timeline.framesToSeconds(cuts[i + 1], rational)
      if (b - a > 0.25) shots.push({ start: a, end: b, grade: gradeAt(cuts[i]) })
    }
    if (shots.length) {
      const graded = path.join(workDir, `graded.${extension}`)
      gradeReport = await gradeFilm(picture, graded, shots, gradeSpec)
      if (gradeReport.applied) picture = graded
    }
  }

  /* --------------------------------------------------------------- compose */
  // Graphics go on AFTER the grade, which is the whole point of having drawn
  // them separately. One extra encode, and only on films that have both.
  if (splitLayers && fs.existsSync(gfxPath)) {
    onProgress({ phase: 'compose', percent: 0.88 })
    const composed = path.join(workDir, `composed.${extension}`)
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', picture, '-i', gfxPath,
      '-filter_complex', '[0:v][1:v]overlay=format=auto:shortest=0[vout]',
      '-map', '[vout]',
      ...codec,
      '-r', String(fps),
      composed,
    ])
    picture = composed
  }

  /* ------------------------------------------------------------------ sound */

  onProgress({ phase: 'audio', percent: 0.9 })

  // Built-in sound design is synthesised here, so the timeline can refer to
  // `builtin:whoosh` and nothing downstream has to know it was not a file.
  const audioItems = await resolveBuiltins(
    collectAudio(tl, frames => timeline.framesToSeconds(frames, rational)),
    workDir,
  )
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
    fonts,
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
