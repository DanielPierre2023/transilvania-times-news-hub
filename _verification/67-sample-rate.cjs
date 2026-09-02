// _verification/67-sample-rate.cjs
//
// A WAV HEADER THAT DISAGREES WITH ITS SAMPLES.
//
// This suite exists because of one shipped bug and one support message: "the
// voice is on speed". The voice-clone reference was built like this:
//
//   encodeWav(monoSlice(buf, 0, buf.duration), buf.sampleRate)
//
// which reads correctly and is wrong. `monoSlice` was written for Whisper and
// RESAMPLES TO 16 kHz whatever you pass it; the header was then written with
// the source rate, 48 kHz. 48000/16000 = 3, so the file played at three times
// speed, and MiniMax faithfully cloned a chipmunk.
//
// Three things conspired, and all three are ordinary:
//
//   the function's name does not mention resampling;
//   a Float32Array cannot say what rate it is at;
//   `encodeWav` takes the rate as a separate argument.
//
// So the fix is not "be careful" — it is `monoAudio`, which returns the samples
// WITH their rate, and `encodeWavFrom`, which takes that pair. The header can
// no longer be given a number the samples do not agree with.
//
// THE ASSERTIONS MEASURE PITCH, NOT PARAMETERS.
//
// Checking that a variable holds 48000 would have passed on the broken code too
// — the variable did hold 48000. So this synthesises a 440 Hz tone, runs it
// through the real conversion, and asks ffmpeg what frequency comes out. A 3×
// speed error moves 440 Hz to 1320 Hz and there is nowhere for it to hide.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const ROOT = path.join(__dirname, '..')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol

const W = require(path.join(ROOT, 'render-worker', 'dist', 'media', 'wav.js'))

// ── the pair, before any file is involved ────────────────────────────────
{
  // A stand-in for a decoded 48 kHz buffer.
  const RATE = 48000, SECONDS = 2
  const buf = {
    sampleRate: RATE,
    numberOfChannels: 1,
    length: RATE * SECONDS,
    duration: SECONDS,
    getChannelData: () => {
      const a = new Float32Array(RATE * SECONDS)
      for (let i = 0; i < a.length; i++) a[i] = Math.sin(2 * Math.PI * 440 * (i / RATE)) * 0.5
      return a
    },
  }

  // THE TRAP, STATED AS AN ASSERTION.
  const forWhisper = W.monoSlice(buf, 0, SECONDS)
  ok('monoSlice resamples to 16 kHz even when asked for the whole buffer',
    near(forWhisper.length, 16000 * SECONDS, 100), String(forWhisper.length))
  ok('...which is why pairing it with the SOURCE rate is a 3x error',
    Math.abs(forWhisper.length - RATE * SECONDS) > 1000)

  ok('monoSlice can be asked for another rate explicitly',
    near(W.monoSlice(buf, 0, SECONDS, RATE).length, RATE * SECONDS, 100))

  // The safe pair.
  const audio = W.monoAudio(buf)
  ok('monoAudio defaults to the buffer\'s own rate', audio.rate === RATE, String(audio.rate))
  ok('...and returns that many samples', near(audio.samples.length, RATE * SECONDS, 100),
    String(audio.samples.length))
  ok('THE SAMPLES AND THE RATE TRAVEL TOGETHER — the whole point',
    typeof audio.rate === 'number' && audio.samples instanceof Float32Array)
  ok('monoAudio can still downsample when that is what is wanted',
    W.monoAudio(buf, 0, SECONDS, 16000).rate === 16000)

  // The header written from the pair.
  const blob = W.encodeWavFrom(audio)
  ok('encodeWavFrom produces a blob', blob && typeof blob.size === 'number')
  ok('...whose size matches 16-bit mono at THAT rate',
    near(blob.size, 44 + RATE * SECONDS * 2, 300), String(blob.size))
}

// ── and now with ffmpeg, which is the only witness that matters ──────────
let HAVE_FFMPEG = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { HAVE_FFMPEG = false }

if (!HAVE_FFMPEG) {
  const strict = process.argv.includes('--strict')
  console.log(strict ? '  FAIL: ffmpeg is required and missing' : '  (pitch checks skipped: no ffmpeg)')
  if (strict) fail++
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-rate-'))
  const RATE = 48000, SECONDS = 3, TONE = 440

  const buf = {
    sampleRate: RATE, numberOfChannels: 1, length: RATE * SECONDS, duration: SECONDS,
    getChannelData: () => {
      const a = new Float32Array(RATE * SECONDS)
      for (let i = 0; i < a.length; i++) a[i] = Math.sin(2 * Math.PI * TONE * (i / RATE)) * 0.5
      return a
    },
  }

  const save = async (blob, name) => {
    const p = path.join(dir, name)
    fs.writeFileSync(p, Buffer.from(await blob.arrayBuffer()))
    return p
  }

  const probe = (file, entries) => execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', entries, '-of', 'default=noprint_wrappers=1', file,
  ], { encoding: 'utf8' })

  /** The loudest frequency in the file, found by band-passing and comparing. */
  const dominantHz = (file, candidates) => {
    let best = null, bestDb = -Infinity
    for (const hz of candidates) {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file,
        '-af', `bandpass=f=${hz}:width_type=h:w=${Math.round(hz * 0.15)},volumedetect`,
        '-f', 'null', '-'], { encoding: 'utf8' })
      const m = String(r.stderr || '').match(/mean_volume:\s*(-?[\d.]+) dB/)
      const db = m ? Number(m[1]) : -Infinity
      if (db > bestDb) { bestDb = db; best = hz }
    }
    return best
  }

  ;(async () => {
    // THE CORRECT PATH.
    const good = await save(W.encodeWavFrom(W.monoAudio(buf)), 'good.wav')
    const info = probe(good, 'stream=sample_rate,channels:format=duration')
    ok('the header says the rate the samples are at', /sample_rate=48000/.test(info), info.replace(/\n/g, ' '))
    ok('...and it is mono', /channels=1/.test(info))
    const dur = Number((info.match(/duration=([\d.]+)/) || [])[1] || 0)
    ok('THE FILE IS THE RIGHT LENGTH', near(dur, SECONDS, 0.05), `${dur}s, expected ${SECONDS}s`)
    ok('THE TONE COMES BACK AT 440 Hz, not 1320',
      dominantHz(good, [440, 1320]) === 440, 'the dominant frequency was 1320 Hz — 3x too fast')

    // THE BUG, REPRODUCED ON PURPOSE. This is the line that shipped.
    const broken = await save(W.encodeWav(W.monoSlice(buf, 0, SECONDS), buf.sampleRate), 'broken.wav')
    const bInfo = probe(broken, 'format=duration')
    const bDur = Number((bInfo.match(/duration=([\d.]+)/) || [])[1] || 0)
    ok('the shipped line really did produce a file three times too short',
      near(bDur, SECONDS / 3, 0.05), `${bDur}s`)
    ok('...and three times too high in pitch, which is what "on speed" sounds like',
      dominantHz(broken, [440, 1320]) === 1320, 'it was not reproduced — check the fixture')

    // A DOWNSAMPLED PAIR IS STILL CORRECT, because the rate travels with it.
    const small = await save(W.encodeWavFrom(W.monoAudio(buf, 0, SECONDS, 16000)), 'small.wav')
    ok('a deliberately downsampled file declares 16 kHz',
      /sample_rate=16000/.test(probe(small, 'stream=sample_rate')))
    const sDur = Number((probe(small, 'format=duration').match(/duration=([\d.]+)/) || [])[1] || 0)
    ok('...and is STILL the right length', near(sDur, SECONDS, 0.05), `${sDur}s`)
    ok('...and still at 440 Hz', dominantHz(small, [440, 1320]) === 440)

    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* leave it */ }

    // ── the call site ────────────────────────────────────────────────────
    const studio = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
    ok('the clone path uses the pair', /encodeWavFrom\(audio\)/.test(studio))
    ok('...built by monoAudio', /const audio = monoAudio\(decoded\)/.test(studio))
    // Comments stripped first: the fix is DOCUMENTED by a comment naming
    // `monoSlice`, and a plain search cannot tell an explanation from a call.
    // (The first version of this assertion could not, and failed on the comment
    // that explains why the call is gone.)
    const code = studio
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')
    ok('THE CLONE PATH NO LONGER CALLS monoSlice', !/monoSlice\s*\(/.test(code),
      'monoSlice resamples to 16 kHz; a clone reference must not be downsampled')
    ok('...nor encodeWav with a separate rate argument',
      !/encodeWav\([^)]*,\s*[a-zA-Z]/.test(studio))

    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })()
}

if (!HAVE_FFMPEG) {
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
