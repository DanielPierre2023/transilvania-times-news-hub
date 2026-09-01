// render-worker/src/sources.js
//
// Getting pixels out of the assets a timeline references.
//
// Images are fetched once and cached. Video is the interesting case: decoding
// a whole clip to memory is not an option (a 15 s 1080p clip is about 3 GB of
// RGBA), and writing it to disk as a PNG sequence is barely better. Instead
// each video clip gets its own ffmpeg process producing raw frames at exactly
// the output size and rate, and we pull one frame per output frame.
//
// That works because the renderer walks the timeline forwards, one frame at a
// time, and a clip plays at 1x. It is also what makes the render deterministic:
// frame N of the output always reads frame N of the source.

'use strict'

const { spawn } = require('child_process')
const { loadImage } = require('canvas')

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg'

/**
 * Loads stills and keeps them at full size.
 *
 * There WAS a multi-step downsampler here for about an hour. Stills are now
 * generated at twice the master, and the theory was that a single bilinear
 * reduction at 2:1 or worse would alias fine detail into moire, so the image
 * should be halved on the way in.
 *
 * The theory was wrong, and the measurement is in _verification/13-resample.
 * Against ffmpeg's Lanczos as ground truth, reducing a 3840x2160 chart to
 * 1920x1080 gives an RMS error of, in grey levels out of 255:
 *
 *     one drawImage, canvas default .............. 8.87
 *     one drawImage, patternQuality 'best' ....... 6.57
 *     reduced to 2880 first, then drawn ......... 14.26
 *     reduced to 2560 first, then drawn ......... 15.57
 *
 * Every intermediate step COMPOUNDS error rather than removing it. The whole
 * gain — 26% closer to a correct reduction — comes from one line in draw.js
 * asking Cairo for its good resampler instead of its default one. The clever
 * version of this code made the picture worse than doing nothing.
 */
class ImageCache {
  constructor() {
    this.map = new Map()
  }

  async get(url) {
    if (this.map.has(url)) return this.map.get(url)
    let bitmap = null
    try {
      bitmap = await loadImage(url)
    } catch (err) {
      // A missing asset must not silently render as black — the job fails.
      throw new Error(`Could not load image ${url}: ${err.message}`)
    }
    this.map.set(url, bitmap)
    return bitmap
  }
}

/**
 * One video clip, decoded to raw RGBA at the output size and rate, read one
 * frame at a time. Frames are returned as a canvas-compatible ImageData-like
 * object via a reusable backing canvas.
 */
class VideoTap {
  constructor({ url, startSeconds, width, height, fps, createCanvas }) {
    this.url = url
    this.width = width
    this.height = height
    this.frameBytes = width * height * 4
    this.buffer = Buffer.alloc(0)
    this.queue = []
    this.waiting = null
    this.ended = false
    this.error = null
    /** Source frames decoded so far. Speed ramps walk this at a variable pace. */
    this.consumed = 0
    this.hasFrame = false
    this.exhausted = false
    this.canvas = createCanvas(width, height)
    this.ctx = this.canvas.getContext('2d')
    this.imageData = this.ctx.createImageData(width, height)

    this.proc = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      // -ss before -i seeks fast; the value is exact because we then force fps.
      '-ss', String(startSeconds),
      '-i', url,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
             `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps}`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-an', '-',
    ])

    this.proc.stdout.on('data', chunk => this._push(chunk))
    this.proc.stderr.on('data', d => { this.stderr = (this.stderr || '') + d.toString() })
    this.proc.on('close', () => { this.ended = true; this._flush() })
    this.proc.on('error', err => { this.error = err; this.ended = true; this._flush() })
  }

  _push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    while (this.buffer.length >= this.frameBytes) {
      this.queue.push(this.buffer.subarray(0, this.frameBytes))
      this.buffer = this.buffer.subarray(this.frameBytes)
    }
    this._flush()
  }

  _flush() {
    if (!this.waiting) return
    if (this.queue.length) {
      const resolve = this.waiting
      this.waiting = null
      resolve(this.queue.shift())
      return
    }
    if (this.ended) {
      const resolve = this.waiting
      this.waiting = null
      resolve(null)
    }
  }

  /** Next frame as a drawable canvas, or null once the source runs out. */
  async next() {
    if (this.error) throw this.error
    let raw = this.queue.shift()
    if (!raw) {
      if (this.ended) return null
      raw = await new Promise(resolve => { this.waiting = resolve })
    }
    if (!raw) return null
    this.consumed += 1
    this.exhausted = false
    raw.copy(Buffer.from(this.imageData.data.buffer, this.imageData.data.byteOffset))
    this.ctx.putImageData(this.imageData, 0, 0)
    this.hasFrame = true
    return this.canvas
  }

  /**
   * Advance to a specific SOURCE frame index, for speed ramps.
   *
   * THE TAP WAS STRUCTURALLY UNABLE TO PLAY A RAMP, AND WOULD HAVE FAILED
   * QUIETLY. It reads one source frame per output frame, which is exactly right
   * at rate 1 and wrong at every other rate. The preview computes a warped
   * source time and would have shown the ramp; the render would have played the
   * clip at normal speed and nobody would have seen a stack trace. That is the
   * preview-versus-renderer divergence this codebase has spent its life closing,
   * so the tap learns to walk at a variable pace instead.
   *
   * Because `sourceOffset` is monotonic the walk is always FORWARD, so this
   * stays a sequential read and never seeks:
   *
   *   faster than real time  → read and discard the frames being skipped
   *   slower than real time  → do not read at all; hold the frame already shown
   *
   * Holding rather than re-decoding is also what makes slow motion cheap: a
   * 0.25× ramp decodes a quarter of the frames, not four times as many.
   */
  async advanceTo(sourceFrameIndex) {
    if (this.error) throw this.error
    const want = Math.max(0, Math.round(sourceFrameIndex))
    // Nothing shown yet: always decode at least one frame.
    if (!this.hasFrame) {
      const first = await this.next()
      if (!first) return null
    }
    while (this.consumed <= want) {
      const got = await this.next()
      if (!got) { this.exhausted = true; break }
    }
    // Past the end of the media the last frame holds. A ramp that runs off the
    // end is a real mistake, but a frozen tail is far better than black, and
    // the linter warns about it before the render starts.
    return this.hasFrame ? this.canvas : null
  }

  close() {
    try { this.proc.kill('SIGKILL') } catch { /* already gone */ }
  }
}

module.exports = { ImageCache, VideoTap, FFMPEG }
