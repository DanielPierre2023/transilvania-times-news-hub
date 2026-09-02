// _verification/63-audio-episode.cjs
//
// THE EPISODE COMES OUT AS AN MP3, AND IT IS THE RIGHT MP3.
//
// A podcast's primary deliverable is an audio file for the RSS feed. This
// pipeline could not make one: everything needed was there — the mixer, the
// sidechain ducking, the two-pass loudnorm — behind a function that draws every
// frame of a video first. So `renderAudioOnly` reaches the audio stage without
// the picture, and this suite runs it FOR REAL with ffmpeg on synthesised
// sources rather than asserting that a code path exists.
//
// WHAT IT CHECKS, AND WHY EACH ONE IS A BUG THAT HAS HAPPENED SOMEWHERE.
//
//   IT IS ACTUALLY AN MP3. Naming a file .mp3 and writing a WAV into it is a
//   file that plays in VLC on your desktop and is rejected by the podcast host.
//
//   IT IS THE RIGHT LENGTH. An episode that is silently truncated to the length
//   of its music bed is the classic amix failure, and it is invisible until
//   somebody listens to the end.
//
//   IT HITS THE LOUDNESS TARGET. -16 LUFS is not a preference, it is what the
//   platforms normalise to; missing it by 4 dB is why one podcast is quiet in
//   the car and the next one is not.
//
//   THE MUSIC DUCKS UNDER THE VOICE. Measured, by comparing the music's level
//   during speech against its level in the clear — not asserted from the
//   presence of a filter string.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const ROOT = path.join(__dirname, '..')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol

const ff = (args) => execFileSync('ffmpeg', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
// ffmpeg writes loudnorm's JSON and volumedetect's summary to STDERR, and
// `execFileSync` returns STDOUT. So on a successful run the first version of
// this helper returned an empty string, every measurement parsed as NaN, and
// three assertions failed against a file that was in fact correct — a harness
// bug that reads exactly like a product bug. spawnSync exposes both streams
// whatever the exit code.
const ffq = (args) => {
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  return String(r.stderr || '') + String(r.stdout || '')
}
const probe = (file, fields) => execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', fields, '-of', 'default=noprint_wrappers=1', file,
], { encoding: 'utf8' })

let HAVE_FFMPEG = true
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) } catch { HAVE_FFMPEG = false }
if (!HAVE_FFMPEG) {
  // --strict turns a skip into a failure in CI, where ffmpeg is installed.
  const strict = process.argv.includes('--strict')
  console.log(strict ? '  FAIL: ffmpeg is required and missing' : '  (skipped: no ffmpeg)')
  console.log(`\n${strict ? 0 : 1} passed, ${strict ? 1 : 0} failed`)
  process.exit(strict ? 1 : 0)
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-audio-'))
const { renderAudioOnly } = require(path.join(ROOT, 'render-worker', 'src', 'render.js'))
const { TARGETS } = require(path.join(ROOT, 'render-worker', 'src', 'audio.js'))

// ── the target itself ────────────────────────────────────────────────────
{
  ok('there is a podcast loudness target', Boolean(TARGETS.podcast))
  ok('...at -16 LUFS, which is what the platforms normalise to', TARGETS.podcast.I === -16)
  ok('...with a -1 dBTP ceiling', TARGETS.podcast.TP === -1)
  ok('...and a range narrower than the social preset, because this is speech',
    TARGETS.podcast.LRA < TARGETS.social.LRA,
    `${TARGETS.podcast.LRA} vs ${TARGETS.social.LRA}`)
}

// ── sources: 20s of "speech" with two gaps, and 20s of steady "music" ────
//
// The voice is a tone burst pattern rather than noise so its position is known
// exactly, which is what makes the ducking measurable.
const voice = path.join(dir, 'voice.wav')
const music = path.join(dir, 'music.wav')

ff(['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=220:duration=20',
  // speech present 0-6s and 12-20s; silent 6-12s, which is where the music
  // must come back up.
  '-af', "volume='if(between(t,6,12),0,1)':eval=frame",
  voice])

ff(['-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'sine=frequency=880:duration=20',
  '-af', 'volume=0.5', music])

// The rational is { n, d } — not { num, den }. Getting this wrong makes every
// duration NaN and ffmpeg refuses the filter graph, which is the loud version
// of this mistake; the quiet version is a shape that coerces to a number.
const FPS = { n: 25, d: 1 }
const sec = s => Math.round(s * 25)

const timeline = {
  timebase: { width: 1920, height: 1080, fps: FPS, sampleRate: 48000 },
  duration: sec(20),
  delivery: { audioOnly: true, loudness: 'podcast', tags: { title: 'Episodul de test', artist: 'Transilvania Times' } },
  tracks: [
    {
      kind: 'audio', name: 'Voce', z: 0, enabled: true,
      clips: [{
        enabled: true, name: 'voce', start: 0, duration: sec(20), sourceIn: 0,
        fadeIn: 0, fadeOut: 0,
        source: { kind: 'audio', url: voice },
        audio: { gain: 1, duckSource: true },
      }],
    },
    {
      kind: 'audio', name: 'Muzică', z: 1, enabled: true,
      clips: [{
        enabled: true, name: 'muzica', start: 0, duration: sec(20), sourceIn: 0,
        fadeIn: 0, fadeOut: 0,
        source: { kind: 'audio', url: music },
        audio: { gain: 1, duckTarget: true },
      }],
    },
  ],
}

// ── render ───────────────────────────────────────────────────────────────
const out = path.join(dir, 'episode.mp3')
let result = null
let threw = null
;(async () => {
  try {
    result = await renderAudioOnly(timeline, { workDir: dir, output: out })
  } catch (e) { threw = e }

  ok('renderAudioOnly does not throw', !threw, threw && threw.message)

  if (!threw) {
    ok('it wrote a file', fs.existsSync(out))
    ok('...that is not empty', fs.existsSync(out) && fs.statSync(out).size > 10000,
      fs.existsSync(out) ? String(fs.statSync(out).size) : 'missing')

    // IT IS REALLY AN MP3. The extension proves nothing.
    const info = probe(out, 'stream=codec_name,sample_rate,channels:format=format_name,duration')
    ok('the codec really is mp3', /codec_name=mp3/.test(info), info.replace(/\n/g, ' '))
    ok('...at 44.1 kHz, which every feed accepts', /sample_rate=44100/.test(info))
    ok('...in stereo', /channels=2/.test(info))

    const dur = Number((info.match(/duration=([\d.]+)/) || [])[1] || 0)
    ok('the episode is the length of the timeline, not of one of its inputs',
      near(dur, 20, 0.6), `got ${dur}s`)

    ok('the tags travel with the file', /title=/i.test(
      probe(out, 'format_tags=title')) , probe(out, 'format_tags=title'))

    // IT HITS THE TARGET. Measured on the finished file with the same
    // algorithm the platforms use.
    const measured = ffq(['-hide_banner', '-i', out, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
    const m = measured.match(/"input_i"\s*:\s*"(-?[\d.]+)"/)
    const lufs = m ? Number(m[1]) : NaN
    ok('the finished MP3 is at the podcast target', near(lufs, -16, 1.5), `measured ${lufs} LUFS`)

    const tp = measured.match(/"input_tp"\s*:\s*"(-?[\d.]+)"/)
    ok('...and under the true-peak ceiling', tp && Number(tp[1]) <= -0.5, tp && tp[1])

    ok('the loudness report comes back with the result', Boolean(result.loudness))
    ok('...naming the target that was applied', result.loudness.target.I === -16)
    ok('the result says it was audio only', result.audioOnly === true)
    ok('...and reports the codec honestly', result.codec === 'mp3')

    // THE MUSIC DUCKS. Measure the 880 Hz band while speech is present
    // (2-5s) against the same band in the clear (8-11s). Ducking means the
    // second is louder. This is the assertion that a filter graph which
    // *contains* sidechaincompress but never routes through it fails.
    const bandLevel = (from, to) => {
      const err = ffq(['-hide_banner', '-ss', String(from), '-t', String(to - from), '-i', out,
        '-af', 'bandpass=f=880:width_type=h:w=120,volumedetect', '-f', 'null', '-'])
      const mm = err.match(/mean_volume:\s*(-?[\d.]+) dB/)
      return mm ? Number(mm[1]) : NaN
    }
    const under = bandLevel(2, 5)
    const clear = bandLevel(8, 11)
    ok('the music is measurably quieter under the voice than in the clear',
      Number.isFinite(under) && Number.isFinite(clear) && clear - under > 2.5,
      `under speech ${under} dB vs in the clear ${clear} dB (difference ${(clear - under).toFixed(1)} dB)`)
  }

  // ── an episode with no audio is an error, not a silent file ─────────────
  {
    let e2 = null
    try {
      await renderAudioOnly(
        { ...timeline, tracks: [] },
        { workDir: dir, output: path.join(dir, 'empty.mp3') })
    } catch (e) { e2 = e }
    ok('an episode with nothing on it is refused rather than shipped silent', Boolean(e2),
      'it returned a file instead of complaining')
  }

  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* leave it */ }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
