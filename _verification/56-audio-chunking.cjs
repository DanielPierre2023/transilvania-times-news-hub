// _verification/56-audio-chunking.cjs
//
// Cutting an hour of podcast into pieces a transcriber will accept.
//
// This suite exists because of two defects that would each have failed on the
// first click of the Podcast tab:
//
//   The transcription call sent `audioUrl`. The deployed edge function reads
//   `audio_url`, so every call came back "audio_url is required". A JSON
//   boundary types nothing and remembers nothing.
//
//   It also sent chunk offsets the function does not implement, so an hour of
//   audio went to Whisper whole and was refused for exceeding 25 MB.
//
// The cutting moved into the browser, where the decoded audio already is. These
// assertions check the arithmetic AND write a real WAV that ffmpeg reads back,
// because a hand-rolled RIFF header is exactly the kind of thing that looks
// right and is one field short.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync, spawnSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

function loadTs(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
  return mod.exports
}
const W = loadTs('lib/media/wav.ts')
const D = loadTs('lib/media/duration.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const FF = process.env.FFMPEG || 'ffmpeg'
const haveFF = spawnSync(FF, ['-version'], { stdio: 'ignore' }).status === 0

// ── the client now speaks the function's language ────────────────────────
{
  const prod = stripComments(
    fs.readFileSync(path.join(ROOT, 'app', 'admin', 'productie', 'page.tsx'), 'utf8'))
  const fn = stripComments(
    fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'align-subtitles', 'index.ts'), 'utf8'))

  ok('THE DEPLOYED FUNCTION READS `audio_url`', /body\.audio_url/.test(fn))
  ok('THE CLIENT SENDS `audio_url` — it sent `audioUrl`, and every call was ' +
     'refused before this was read rather than remembered',
    /audio_url: url/.test(prod))
  ok('...and no longer sends the camelCase name', !/audioUrl:/.test(prod))
  ok('...nor the chunk offsets the function does not implement',
    !/startSeconds: chunk\.start/.test(prod))
  ok('the client uploads each cut piece and transcribes that',
    /upload\(blob, `chunk-/.test(prod))
  ok('...and refuses a piece that is over the limit rather than sending it',
    /blob\.size > MAX_UPLOAD_BYTES/.test(prod))
  ok('...and stitches the parts back into one timeline', /stitch\(parts\)/.test(prod))
}

// ── the size arithmetic ──────────────────────────────────────────────────
{
  ok('a chunk is sized to fit the transcriber', W.fitsWhisper(W.CHUNK_SECONDS))
  ok('...with real headroom, not by a hair',
    W.wavBytes(W.CHUNK_SECONDS) < W.MAX_UPLOAD_BYTES * 0.75,
    `${(W.wavBytes(W.CHUNK_SECONDS) / 1e6).toFixed(1)} MB of ${(W.MAX_UPLOAD_BYTES / 1e6).toFixed(0)} MB`)
  ok('AN HOUR IS GENUINELY TOO BIG TO SEND WHOLE — which is the whole reason ' +
     'this exists', !W.fitsWhisper(3600),
    `${(W.wavBytes(3600) / 1e6).toFixed(0)} MB`)
  ok('16 kHz mono is the rate speech recognition actually uses', W.TARGET_RATE === 16000)
  ok('every planned chunk of an hour fits',
    T.planChunks(3600, { chunkSeconds: W.CHUNK_SECONDS, overlapSeconds: W.OVERLAP_SECONDS })
      .every(c => W.fitsWhisper(c.seconds)))
  ok('...and they cover the whole hour with no hole', (() => {
    const plan = T.planChunks(3600, { chunkSeconds: W.CHUNK_SECONDS, overlapSeconds: W.OVERLAP_SECONDS })
    let reach = 0
    for (const c of plan) { if (c.start > reach + 0.01) return false; reach = Math.max(reach, c.start + c.seconds) }
    return Math.abs(reach - 3600) < 1
  })())
}

// ── monoSlice ────────────────────────────────────────────────────────────
{
  const rate = 48000
  const seconds = 4
  const left = new Float32Array(rate * seconds)
  const right = new Float32Array(rate * seconds)
  // Two hard-panned speakers: left talks in the first half, right in the second.
  for (let i = 0; i < left.length; i++) {
    left[i] = i < left.length / 2 ? Math.sin((2 * Math.PI * 220 * i) / rate) : 0
    right[i] = i >= left.length / 2 ? Math.sin((2 * Math.PI * 440 * i) / rate) : 0
  }
  const buffer = {
    numberOfChannels: 2, sampleRate: rate, length: left.length, duration: seconds,
    getChannelData: (c) => (c === 0 ? left : right),
  }

  const whole = W.monoSlice(buffer, 0, seconds)
  ok('a slice comes back at the target rate',
    Math.abs(whole.length - W.TARGET_RATE * seconds) <= 2, whole.length)

  const firstHalf = W.monoSlice(buffer, 0, 2)
  const secondHalf = W.monoSlice(buffer, 2, 4)
  const energy = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / (a.length || 1))
  ok('BOTH CHANNELS ARE MIXED, NOT ONE TAKEN — two lapel microphones are often ' +
     'hard-panned, and taking one channel transcribes one speaker and drops the ' +
     'other entirely',
    energy(firstHalf) > 0.05 && energy(secondHalf) > 0.05,
    `${energy(firstHalf).toFixed(3)} / ${energy(secondHalf).toFixed(3)}`)
  ok('a slice takes the part of the recording it was asked for', (() => {
    const quiet = W.monoSlice({ ...buffer, getChannelData: () => new Float32Array(left.length) }, 0, 2)
    return energy(quiet) < 1e-6
  })())
  ok('an empty range yields nothing rather than throwing', W.monoSlice(buffer, 2, 2).length === 0)
  ok('a range past the end is clamped', W.monoSlice(buffer, 3, 999).length > 0)
}

// ── THE WAV ITSELF, read back by ffmpeg ──────────────────────────────────
if (!haveFF) {
  console.log('  ffmpeg missing — the encoded WAV cannot be verified here')
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wav-'))
  const rate = W.TARGET_RATE
  const seconds = 3
  const tone = new Float32Array(rate * seconds)
  for (let i = 0; i < tone.length; i++) tone[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate)

  const blob = W.encodeWav(tone, rate)
  const file = path.join(dir, 'out.wav')
  const buf = Buffer.from(require('buffer').Buffer.from(
    // Blob in Node exposes arrayBuffer(); read it synchronously via the polyfill path.
    fs.existsSync(file) ? [] : []))
  void buf
  // Node 18+ Blob has .arrayBuffer(); resolve it before writing.
  ;(async () => {
    fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()))

    // ffprobe, not `ffmpeg -i`. An earlier version of this suite parsed
    // `ffmpeg -v error -i file` and found nothing — `-v error` suppresses the
    // very stream description it was looking for, so four assertions failed
    // against a file that was perfectly valid. A probe that reports nothing is
    // not the same as a file that is wrong.
    const info = execSync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels ` +
      `-of default=nw=1 ${file}`, { encoding: 'utf8' })

    ok('FFPROBE READS THE FILE AT ALL — a hand-rolled RIFF header is exactly ' +
       'the kind of thing that looks right and is one field short',
      /codec_name=pcm_s16le/.test(info), info.trim())
    ok('...at 16000 Hz', /sample_rate=16000/.test(info), info.trim())
    ok('...in mono', /channels=1/.test(info), info.trim())
    ok('...as 16-bit PCM', /pcm_s16le/.test(info), info.trim())

    // Duration, measured by decoding rather than trusting the header.
    const raw = execSync(`${FF} -v error -i ${file} -f f32le -ac 1 -ar ${rate} -`, { maxBuffer: 1e9 })
    const back = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4))
    ok('the decoded length matches what was encoded',
      Math.abs(back.length - tone.length) <= 2, `${back.length} vs ${tone.length}`)

    let err = 0
    for (let i = 0; i < Math.min(back.length, tone.length); i++) err += Math.abs(back[i] - tone[i])
    const mean = err / Math.min(back.length, tone.length)
    ok('THE AUDIO SURVIVES THE ROUND TRIP — 16-bit quantisation and nothing else',
      mean < 0.001, 'mean sample error ' + mean.toExponential(2))

    // A clipped podcast is common; the encoder must not wrap it into a click.
    const hot = new Float32Array(1000).fill(1.8)
    const hotFile = path.join(dir, 'hot.wav')
    fs.writeFileSync(hotFile, Buffer.from(await W.encodeWav(hot, rate).arrayBuffer()))
    const hotRaw = execSync(`${FF} -v error -i ${hotFile} -f f32le -ac 1 -ar ${rate} -`, { maxBuffer: 1e9 })
    const hotBack = new Float32Array(hotRaw.buffer, hotRaw.byteOffset, Math.floor(hotRaw.length / 4))
    ok('A SAMPLE OVER FULL SCALE CLAMPS INSTEAD OF WRAPPING — a wrap turns a ' +
       'clipped podcast into a loud click on every peak',
      hotBack.every(v => v > 0.9), 'min ' + Math.min(...hotBack).toFixed(3))

    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }

    // ── the duration helper ──────────────────────────────────────────────
    ok('a script gives a usable estimate when a file will not say',
      D.secondsFromText('a'.repeat(140)) === 10, D.secondsFromText('a'.repeat(140)))
    ok('an empty script still gives at least a second', D.secondsFromText('') >= 1)
    ok('THE VOICE FUNCTION RETURNS NO DURATION, so it is measured or estimated ' +
       'rather than read', (() => {
        const vo = stripComments(fs.readFileSync(
          path.join(ROOT, 'supabase', 'functions', 'generate-voiceover', 'index.ts'), 'utf8'))
        return !/seconds:/.test(vo)
      })())
    ok('...and the client measures it', (() => {
      const prod = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'productie', 'page.tsx'), 'utf8')
      return /voiceSeconds\(/.test(prod) && !/Number\(vd\?\.seconds/.test(prod)
    })())

    console.log('\n' + pass + ' passed, ' + fail + ' failed')
    process.exit(fail ? 1 : 0)
  })()
}
