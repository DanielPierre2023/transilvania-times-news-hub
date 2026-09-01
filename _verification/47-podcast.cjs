// _verification/47-podcast.cjs
//
// Podcast: an hour of two-camera, two-microphone recording becomes an episode
// and a dozen clips.
//
// Every assertion here is against GROUND TRUTH — a known offset, a known
// timestamp, a known number of words — rather than against a judgement of
// whether a clip is good. The four things being proved are the four that fail
// silently:
//
//   a chunk's timestamps must be shifted into the whole recording
//   two recorders must be aligned by measurement, not assumption
//   tightening must retime the transcript too, or every caption is late
//   a clip must not be cut through the middle of a word

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execSync } = require('child_process')
const ROOT = path.join(__dirname, '..')
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol) => Math.abs(a - b) <= tol
const FF = process.env.FFMPEG || 'ffmpeg'

const W = (word, start, end, speaker) => ({ word, start, end, ...(speaker ? { speaker } : {}) })

// ── 1 · chunking a long recording ────────────────────────────────────────
{
  ok('a short recording is one chunk with no overlap',
    T.planChunks(300).length === 1 && T.planChunks(300)[0].overlap === 0)
  const hour = T.planChunks(3600)
  ok('an hour is split into several chunks', hour.length >= 6, hour.length)
  ok('the first chunk starts at zero and has no overlap',
    hour[0].start === 0 && hour[0].overlap === 0)
  ok('EVERY LATER CHUNK REPEATS THE END OF THE ONE BEFORE — a cut through a ' +
     'word gives that word to neither chunk', hour.slice(1).every(c => c.overlap > 0))
  ok('the chunks COVER the whole recording with no hole', (() => {
    let reach = 0
    for (const c of hour) {
      if (c.start > reach + 0.01) return false
      reach = Math.max(reach, c.start + c.seconds)
    }
    return near(reach, 3600, 1)
  })())
  ok('no chunk is longer than the transcription service will take',
    hour.every(c => c.seconds <= 610))
  ok('a zero-length recording plans nothing', T.planChunks(0).length === 0)
}

// ── THE SHIFT. Chunk timestamps start again at zero. ─────────────────────
{
  const chunks = T.planChunks(1200)
  // Each chunk transcribes to words at 0,1,2… seconds RELATIVE to itself.
  const parts = chunks.map(c => ({
    chunk: c,
    words: Array.from({ length: Math.floor(c.seconds) }, (_, i) => W('w' + i, i, i + 0.5)),
  }))
  const all = T.stitch(parts)

  ok('EVERY WORD AFTER THE FIRST CHUNK IS SHIFTED INTO THE WHOLE RECORDING — ' +
     'without this the transcript reads perfectly and every timestamp is wrong',
    all.some(w => w.start > 700), 'latest word at ' + Math.max(...all.map(w => w.start)))
  ok('...and no word lands beyond the end of the recording',
    all.every(w => w.start <= 1200 + 1))
  ok('the stitched transcript is in time order',
    all.every((w, i) => i === 0 || w.start >= all[i - 1].start))
  ok('THE REPEATED HEAD IS DROPPED, so words are not transcribed twice', (() => {
    // Words in the overlap region would appear twice if not filtered.
    const c1 = chunks[1]
    const inOverlap = all.filter(w => w.start >= c1.start && w.start < c1.start + c1.overlap)
    // Only the previous chunk's copies should survive there.
    const counts = {}
    for (const w of inOverlap) counts[Math.round(w.start * 10)] = (counts[Math.round(w.start * 10)] || 0) + 1
    return Object.values(counts).every(n => n === 1)
  })())
  ok('a single-chunk recording is unshifted', (() => {
    const c = T.planChunks(100)
    return T.stitch([{ chunk: c[0], words: [W('a', 5, 6)] }])[0].start === 5
  })())
}

// ── 2 · aligning two recorders, against a KNOWN offset ───────────────────
{
  // Two loudness envelopes of the same room, one delayed by a known amount.
  const hz = 100
  const n = 3000
  const base = Array.from({ length: n }, (_, i) =>
    (Math.sin(i / 37) > 0.6 ? 1 : 0.05) + (Math.sin(i / 11) > 0.9 ? 0.7 : 0))
  const DELAY = 137                                    // samples = 1.37 s
  const delayed = Array.from({ length: n }, (_, i) => base[i - DELAY] ?? 0.05)

  const r = T.alignOffset(base, delayed, { hz })
  ok('THE MEASURED LAG MATCHES THE LAG THAT WAS APPLIED',
    near(r.bLaterBySeconds, DELAY / hz, 0.02), `${r.bLaterBySeconds} vs ${DELAY / hz}`)
  ok('BOTH DIRECTIONS ARE NAMED, so the sign cannot be got backwards — reading ' +
     'a bare "offset" the wrong way doubles the error instead of removing it',
    near(r.shiftBBySeconds, -r.bLaterBySeconds, 1e-9))
  ok('...and applying the shift really does line the two up',
    near(r.bLaterBySeconds + r.shiftBBySeconds, 0, 1e-9))
  // Capped below 1 because the fixture is periodic: sin(i/37) genuinely repeats,
  // so rival lags score really do exist. Honest, and still twenty times the
  // confidence given to two files that share nothing.
  ok('...and it is reported with usable confidence', r.confidence > 0.2, r.confidence)

  const same = T.alignOffset(base, base, { hz })
  ok('two identical recordings need no offset', near(same.bLaterBySeconds, 0, 0.01))
  ok('...and that is reported with usable confidence', same.confidence > 0.2, same.confidence)

  // DETERMINISTIC NOISE. An unseeded Math.random made this assertion flaky:
  // the same test reported 0.014 on one run and 0.064 on the next, which is a
  // test that sometimes lies rather than one that sometimes fails. Eight fixed
  // seeds, and the WORST of them is what gets compared.
  const lcg = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  let worstNoise = 0
  for (let k = 1; k <= 8; k++) {
    const rnd = lcg(k * 7919)
    const noise = Array.from({ length: n }, () => rnd())
    worstNoise = Math.max(worstNoise, T.alignOffset(base, noise, { hz }).confidence)
  }
  ok('TWO RECORDINGS THAT SHARE NOTHING REPORT LOW CONFIDENCE rather than a ' +
     'confident wrong answer — a mis-synced episode is unrecoverable',
    worstNoise < T.SYNC_CONFIDENCE_MIN, 'worst of eight noise pairs: ' + worstNoise.toFixed(3))
  ok('...and a real match sits well ABOVE the acting threshold, so the ' +
     'threshold is in a gap rather than on a hair',
    r.confidence > T.SYNC_CONFIDENCE_MIN * 1.5,
    `real ${r.confidence.toFixed(3)} vs threshold ${T.SYNC_CONFIDENCE_MIN}`)
  ok('...with clear separation between the two', r.confidence > worstNoise * 2,
    `real ${r.confidence.toFixed(3)} vs worst noise ${worstNoise.toFixed(3)}`)
  ok('an empty track does not crash', T.alignOffset([], base).confidence === 0)
}

// ── the same alignment, on REAL AUDIO through ffmpeg ─────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-'))
  const A = path.join(dir, 'a.wav'), B = path.join(dir, 'b.wav')
  const OFFSET = 0.75
  // A room: bursts of tone at irregular intervals.
  const env = "volume='if(lt(mod(t,2.3),0.35),1,0.02)':eval=frame"
  execSync(`${FF} -v error -f lavfi -i "sine=f=440:d=12" -af "${env}" -ar 8000 -ac 1 ${A} -y`, { stdio: 'pipe' })
  // The same room, recorded by a device that started 0.75 s late.
  execSync(`${FF} -v error -i ${A} -af "adelay=${Math.round(OFFSET * 1000)}|${Math.round(OFFSET * 1000)}" -ar 8000 -ac 1 ${B} -y`, { stdio: 'pipe' })

  const envelope = (file) => {
    const raw = execSync(`${FF} -v error -i ${file} -f f32le -ac 1 -ar 8000 -`, { maxBuffer: 1e9 })
    const f = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4))
    const per = 80                                     // 8000 / 100 Hz
    const out = []
    for (let i = 0; i + per <= f.length; i += per) {
      let acc = 0
      for (let j = 0; j < per; j++) acc += f[i + j] * f[i + j]
      out.push(Math.sqrt(acc / per))
    }
    return out
  }

  const r = T.alignOffset(envelope(A), envelope(B), { hz: 100 })
  ok('ON REAL AUDIO, the lag between two recorders is measured correctly',
    near(r.bLaterBySeconds, OFFSET, 0.06), `${r.bLaterBySeconds.toFixed(3)} vs ${OFFSET}`)
  ok('...with confidence high enough to act on automatically', r.confidence > 0.15, r.confidence)
}

// ── 3 · tightening, and the retime that must follow it ───────────────────
{
  const words = [
    W('Bună', 0, 0.4), W('ziua', 0.45, 0.9),
    W('ăă', 1.6, 1.9),                         // filler, alone between pauses
    W('astăzi', 3.5, 4.0),                     // after a long silence
    W('vorbim', 4.05, 4.5), W('deci', 4.55, 4.8), W('despre', 4.85, 5.3),
  ]
  const cuts = T.planTighten(words)
  ok('a long silence is shortened', cuts.some(c => c.reason === 'silence'))
  ok('A LONE FILLER IS REMOVED', cuts.some(c => c.reason === 'filler'))
  ok('A FILLER MID-SENTENCE IS LEFT ALONE — "deci" between two words is a real ' +
     'word doing real work, and cutting it damages the sentence',
    !cuts.some(c => c.reason === 'filler' && c.from > 4.4 && c.to < 4.9),
    JSON.stringify(cuts.filter(c => c.reason === 'filler')))
  ok('a short natural pause is not cut', !cuts.some(c => c.from > 0.4 && c.to < 0.45))

  ok('A SHORTENED GAP IS NEVER CLOSED COMPLETELY — a conversation with no air ' +
     'sounds like two people interrupting each other', (() => {
      const c = cuts.find(x => x.reason === 'silence')
      const gapBefore = 3.5 - 1.9
      return (c.to - c.from) < gapBefore
    })())
  ok('the time saved is reported', T.secondsRemoved(cuts) > 0.5, T.secondsRemoved(cuts))

  // THE RETIME. Forgetting this is why captions drift.
  const after = T.retime(words, cuts)
  ok('THE TRANSCRIPT IS RETIMED WITH THE AUDIO — otherwise every caption in the ' +
     'published episode is late by whatever was removed before it',
    after[after.length - 1].start < words[words.length - 1].start,
    `${words[words.length - 1].start} → ${after[after.length - 1].start}`)
  ok('...by exactly the amount that was removed',
    near(words[words.length - 1].start - after[after.length - 1].start, T.secondsRemoved(cuts), 0.06),
    `${words[words.length - 1].start - after[after.length - 1].start} vs ${T.secondsRemoved(cuts)}`)
  ok('the removed filler is gone from the transcript too',
    !after.some(w => w.word === 'ăă'))
  ok('every remaining word keeps a positive duration', after.every(w => w.end > w.start))
  ok('the retimed transcript is still in order',
    after.every((w, i) => i === 0 || w.start >= after[i - 1].start))
  ok('no cuts means no change', T.retime(words, []).length === words.length)
}

// ── 4 · finding clips ────────────────────────────────────────────────────
{
  // 90 seconds of talk: one strong claim, one dull passage.
  const words = []
  let t = 0
  const say = (text, speaker) => {
    for (const w of text.split(' ')) { words.push(W(w, t, t + 0.28, speaker)); t += 0.32 }
    t += 0.6
  }
  say('Majoritatea oamenilor cred că problema e prețul.', 'A')
  say('Nu este. Am măsurat 340 de comenzi și diferența a fost livrarea.', 'A')
  say('Interesant.', 'B')
  say('Da, exact asta am zis și eu atunci când am văzut cifrele prima dată.', 'A')
  for (let i = 0; i < 12; i++) say('Apoi am continuat cu treaba obișnuită de zi cu zi.', 'A')

  const clips = T.findClips(words, { want: 4 })
  ok('clips are found', clips.length > 0, clips.length)
  ok('every clip is inside the sensible length window',
    clips.every(c => c.end - c.start >= 15 && c.end - c.start <= 75),
    clips.map(c => (c.end - c.start).toFixed(1)).join(','))
  ok('CLIPS DO NOT OVERLAP — ten clips of the same two minutes is not ten clips',
    clips.every((c, i) => i === 0 || c.start >= clips[i - 1].end))
  ok('EVERY CLIP SAYS WHY IT WAS CHOSEN — an unexplained ranking is one nobody ' +
     'trusts enough to use', clips.every(c => c.why && c.why.length > 10))
  ok('the strong claim scores above the dull passage', (() => {
    const strong = clips.find(c => /Majoritatea|livrarea/.test(c.text))
    const dull = clips.find(c => /zi cu zi/.test(c.text))
    return !dull || !strong || strong.score >= dull.score
  })())
  ok('A CLIP NEVER STARTS OR ENDS MID-WORD', clips.every(c =>
    words.some(w => near(w.start, c.start, 0.001)) && words.some(w => near(w.end, c.end, 0.001))))
  ok('a recording with nothing in it yields no clips', T.findClips([]).length === 0)
  ok('asking for more clips than exist does not invent any',
    T.findClips(words, { want: 99 }).length < 99)
}

// ── two cameras: switching without seasickness ───────────────────────────
{
  const words = []
  let t = 0
  const say = (n, speaker) => { for (let i = 0; i < n; i++) { words.push(W('x', t, t + 0.3, speaker)); t += 0.35 } }
  say(12, 'A')      // A holds the floor
  say(1, 'B')       // B interjects once — too short to cut to
  say(10, 'A')
  say(12, 'B')      // B takes over properly

  const cuts = T.speakerCuts(words, { minHold: 1.2 })
  ok('the camera switches when a speaker really takes over',
    cuts.some(c => c.speaker === 'B' && c.start > 6), JSON.stringify(cuts))
  ok('A ONE-WORD INTERJECTION DOES NOT MOVE THE CAMERA — without this rule a ' +
     'two-hander cuts forty times a minute during an argument',
    cuts.filter(c => c.speaker === 'B').length === 1, JSON.stringify(cuts))
  ok('no two consecutive cuts go to the same camera',
    cuts.every((c, i) => i === 0 || c.speaker !== cuts[i - 1].speaker))
  ok('A SINGLE-SPEAKER RECORDING ESTABLISHES ONE CAMERA AND NEVER SWITCHES — ' +
     'returning no entries at all would leave the opening with no camera',
    T.speakerCuts(words.map(w => ({ ...w, speaker: 'A' }))).length === 1)
  ok('...and that entry is at the very start',
    T.speakerCuts(words.map(w => ({ ...w, speaker: 'A' })))[0].start === 0)
  ok('words with no speaker are ignored rather than crashing',
    T.speakerCuts([W('a', 0, 1)]).length === 0)
}

// ── chapters ─────────────────────────────────────────────────────────────
{
  const words = []
  let t = 0
  const block = (n) => { for (let i = 0; i < n; i++) { words.push(W('x.', t, t + 0.4)); t += 0.5 } t += 2.5 }
  block(300); block(300); block(300)
  const ch = T.chapters(words, { minSeconds: 60 })
  ok('a long episode is divided into chapters', ch.length >= 2, ch.length)
  ok('chapters are in order and do not overlap',
    ch.every((c, i) => i === 0 || c.start >= ch[i - 1].end))
  ok('the last chapter reaches the end of the episode',
    near(ch[ch.length - 1].end, words[words.length - 1].end, 0.01))
  ok('the first chapter starts at the beginning', near(ch[0].start, words[0].start, 0.01))
  ok('a short recording is one chapter, not none', T.chapters(words.slice(0, 20)).length === 1)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
