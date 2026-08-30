// _verification/17-sound.cjs
//
// Built-in sound design: synthesised, deterministic, and actually audible where
// it is supposed to be.
//
// The risk with generating sound from noise and a sine is not that it crashes —
// it is that it produces a file of the right length containing nothing, or
// containing a constant hiss where an envelope was intended. Both pass a
// "renders without error" check. So this measures the shape.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const sfx = require(path.join(ROOT, 'render-worker', 'src', 'sfx.js'))
const { renderTimeline } = require(path.join(ROOT, 'render-worker', 'src', 'render.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-'))

function probeSeconds(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]).toString().trim())
}
/** Mean volume in dBFS over a window, via ffmpeg's own volumedetect. */
function meanDb(file, from, to) {
  const out = execFileSync('ffmpeg', ['-v', 'info', '-ss', String(from), '-to', String(to),
    '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] })
  const err = execFileSync('bash', ['-c',
    `ffmpeg -v info -ss ${from} -to ${to} -i "${file}" -af volumedetect -f null - 2>&1 | grep mean_volume`])
    .toString()
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(err)
  void out
  return m ? Number(m[1]) : -999
}

;(async () => {
  // ── the sounds themselves ───────────────────────────────────────────────
  for (const name of ['whoosh', 'impact', 'riser', 'click']) {
    const f = await sfx.materialise('builtin:' + name, dir)
    const d = probeSeconds(f)
    ok(`${name} renders at its documented length`,
      Math.abs(d - sfx.DEFAULT_SECONDS[name]) < 0.02, `${d} vs ${sfx.DEFAULT_SECONDS[name]}`)
    ok(`${name} is not silence`, meanDb(f, 0, d) > -60, String(meanDb(f, 0, d)))
  }

  // Shape, not just presence. A whoosh swells and drops; a constant hiss of the
  // right length would pass every check above and sound wrong.
  const wh = await sfx.materialise('builtin:whoosh', dir)
  const early = meanDb(wh, 0, 0.12), middle = meanDb(wh, 0.25, 0.4)
  ok('a whoosh swells rather than sitting at one level', middle > early + 6,
    `start ${early} dB, middle ${middle} dB`)

  const im = await sfx.materialise('builtin:impact', dir)
  ok('an impact decays', meanDb(im, 0, 0.1) > meanDb(im, 0.3, 0.5) + 10,
    `${meanDb(im, 0, 0.1)} then ${meanDb(im, 0.3, 0.5)}`)

  const ri = await sfx.materialise('builtin:riser', dir)
  ok('a riser rises', meanDb(ri, 1.1, 1.5) > meanDb(ri, 0, 0.4) + 10,
    `${meanDb(ri, 0, 0.4)} then ${meanDb(ri, 1.1, 1.5)}`)

  // ── the bed ─────────────────────────────────────────────────────────────
  const bed = await sfx.materialise('builtin:bed@12', dir)
  ok('a bed can be as long as a film', Math.abs(probeSeconds(bed) - 12) < 0.05, String(probeSeconds(bed)))
  ok('a bed fades in rather than starting on full', meanDb(bed, 5, 7) > meanDb(bed, 0, 1) + 4,
    `${meanDb(bed, 0, 1)} then ${meanDb(bed, 5, 7)}`)
  ok('...and fades out', meanDb(bed, 5, 7) > meanDb(bed, 11, 12) + 4,
    `${meanDb(bed, 5, 7)} then ${meanDb(bed, 11, 12)}`)
  ok('a bed sits below the voice, not on top of it', meanDb(bed, 5, 7) < -8, String(meanDb(bed, 5, 7)))
  ok('an accent still cannot be a minute long', sfx.parse('builtin:whoosh@60').seconds === 6)
  ok('...but a bed can', sfx.parse('builtin:bed@60').seconds === 60)

  // ── determinism, which the render depends on ────────────────────────────
  const a = await sfx.materialise('builtin:whoosh', dir)
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sound2-'))
  const b = await sfx.materialise('builtin:whoosh', dir2)
  ok('the same sound generates the same bytes every time',
    fs.readFileSync(a).equals(fs.readFileSync(b)))
  fs.rmSync(dir2, { recursive: true, force: true })

  // ── parsing ─────────────────────────────────────────────────────────────
  ok('a duration can be asked for', sfx.parse('builtin:whoosh@1.2').seconds === 1.2)
  ok('an absurd duration is clamped', sfx.parse('builtin:whoosh@99').seconds === 6)
  ok('an unknown sound is refused rather than guessed', sfx.parse('builtin:nope') === null)
  ok('an ordinary url is not mistaken for one', !sfx.isBuiltin('https://x/y.wav'))

  // ── end to end, through the real mix ────────────────────────────────────
  const fps = T.FPS.web
  let tl = T.createTimeline({ name: 'sound', fps, width: 320, height: 240 })
  const vid = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  tl = T.addClip(tl, vid.id, {
    id: 'bg', name: 'pic', source: { kind: 'shape', shape: 'rect', fill: '#333333' },
    start: 0, duration: 60, sourceIn: 0, transform: T.IDENTITY_TRANSFORM,
    fit: 'fill', fadeIn: 0, fadeOut: 0, enabled: true,
  })
  const aud = T.emptyTrack('audio', 'Sunete', 2)
  tl = { ...tl, tracks: [...tl.tracks, aud] }
  tl = T.addClip(tl, aud.id, {
    id: 'w1', name: 'whoosh', source: { kind: 'audio', url: 'builtin:whoosh' },
    start: 30, duration: 18, sourceIn: 0,
    transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
    fit: 'contain', audio: { gain: 0.6 }, fadeIn: 0, fadeOut: 0, enabled: true,
  })
  tl = { ...tl, duration: 60, delivery: { loudness: 'none', codec: 'h264', captions: [], grade: { look: 'none', strength: 0 } } }
  const out = path.join(dir, 'film.mp4')
  const res = await renderTimeline(tl, { workDir: dir, output: out, onProgress: () => {} })

  ok('a film with a built-in sound renders', fs.existsSync(out) && res.frames === 60)
  const streams = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a',
    '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).toString().trim()
  ok('...and carries an audio stream', streams.includes('audio'), streams)
  // The sound is at one second in, not at the top.
  const quiet = meanDb(out, 0, 0.8), loud = meanDb(out, 1.0, 1.6)
  ok('the sound lands where the timeline put it, not at the start',
    loud > quiet + 12, `0–0.8s ${quiet} dB, 1.0–1.6s ${loud} dB`)

  fs.rmSync(dir, { recursive: true, force: true })
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
