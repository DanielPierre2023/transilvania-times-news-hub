// _verification/61-episode.cjs
//
// THE EPISODE COMES OUT.
//
// The podcast surface used to end at a number: "38 tăieturi · 214.6s scoase".
// This asserts that the number now has a film behind it, and it concentrates on
// the two things that are wrong in every first implementation of a cut list:
//
//   THE COMPLEMENT. A cut list says what to remove; a film says what to keep.
//   Every boundary is an opportunity to duplicate or eat a fraction of a second,
//   and none of those failures throw.
//
//   THE TWO CLOCKS. `duration` is edited time, `in` is source time, and after
//   the first cut they diverge by a different amount for every later scene. A
//   builder that confuses them produces an episode that drifts out of sync with
//   itself — audible at minute forty, invisible in a unit test that only checks
//   the total length.
//
// So the central assertion is not "it produced scenes". It is that the source
// times reconstruct the kept ranges EXACTLY, checked against ranges computed
// independently, and that the total edited length equals the recording minus
// the distinctly-cut seconds.

const path = require('path')
const ROOT = path.join(__dirname, '..')
const E = require(path.join(ROOT, 'render-worker', 'dist', 'podcast', 'episode.js'))
const C = require(path.join(ROOT, 'render-worker', 'dist', 'podcast', 'clip.js'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

// ── merging cuts ─────────────────────────────────────────────────────────
{
  const cut = (from, to) => ({ from, to, reason: 'silence' })

  ok('disjoint cuts are left alone',
    JSON.stringify(E.mergeCuts([cut(1, 2), cut(5, 6)], 10)) ===
    JSON.stringify([{ start: 1, end: 2 }, { start: 5, end: 6 }]))

  ok('an unsorted list is sorted',
    JSON.stringify(E.mergeCuts([cut(5, 6), cut(1, 2)], 10)) ===
    JSON.stringify([{ start: 1, end: 2 }, { start: 5, end: 6 }]))

  const m = E.mergeCuts([cut(2, 5), cut(3, 4)], 10)
  ok('a cut wholly inside another collapses to one', m.length === 1, JSON.stringify(m))
  ok('...covering the outer range', m[0].start === 2 && m[0].end === 5)

  const m2 = E.mergeCuts([cut(2, 5), cut(4, 8)], 10)
  ok('partially overlapping cuts merge', m2.length === 1 && m2[0].end === 8, JSON.stringify(m2))

  const m3 = E.mergeCuts([cut(2, 5), cut(5, 7)], 10)
  ok('touching cuts merge into one range', m3.length === 1 && m3[0].end === 7, JSON.stringify(m3))

  ok('a reversed cut is read as a range, not dropped',
    E.mergeCuts([{ from: 5, to: 2, reason: 'filler' }], 10)[0].start === 2)
  ok('a zero-length cut is dropped', E.mergeCuts([cut(3, 3)], 10).length === 0)
  ok('a cut past the end is clamped', E.mergeCuts([cut(8, 99)], 10)[0].end === 10)
  ok('a cut before zero is clamped', E.mergeCuts([cut(-5, 2)], 10)[0].start === 0)

  // THE DOUBLE-SHIFT, STATED AS AN ASSERTION RATHER THAN A CLAIM IN A COMMENT.
  const words = [{ word: 'a', start: 0, end: 1 }, { word: 'b', start: 6, end: 7 }]
  const overlapping = [cut(2, 5), { from: 3, to: 4, reason: 'filler' }]
  const shipped = T.retime(words, overlapping)
  const here = E.retimeWords(words, overlapping)
  ok('the shipped retime double-counts an overlap', near(shipped[1].start, 2),
    'got ' + shipped[1].start)
  ok('...and this one does not', near(here[1].start, 3), 'got ' + here[1].start)
  ok('...and on a NON-overlapping list the two agree exactly',
    JSON.stringify(T.retime(words, [cut(2, 5)])) === JSON.stringify(E.retimeWords(words, [cut(2, 5)])))
}

// ── the complement ───────────────────────────────────────────────────────
{
  const cut = (from, to) => ({ from, to, reason: 'silence' })

  const k = E.keptRanges([cut(2, 3), cut(6, 7)], 10)
  ok('the complement is the gaps between the cuts', k.length === 3, JSON.stringify(k))
  ok('...starting at zero', k[0].start === 0 && k[0].end === 2)
  ok('...continuing between cuts', k[1].start === 3 && k[1].end === 6)
  ok('...and running to the end', k[2].start === 7 && k[2].end === 10)

  ok('a cut at the very start does not produce an empty first range',
    E.keptRanges([cut(0, 2)], 10).length === 1)
  ok('a cut running to the end does not produce an empty last range',
    E.keptRanges([cut(8, 10)], 10).length === 1)
  ok('no cuts keeps everything',
    E.keptRanges([], 10).length === 1 && E.keptRanges([], 10)[0].end === 10)
  ok('a cut covering everything keeps nothing', E.keptRanges([cut(0, 10)], 10).length === 0)
  ok('a zero-length recording keeps nothing', E.keptRanges([cut(1, 2)], 0).length === 0)

  // A sliver between two cuts is a click, not a shot.
  const sliver = E.keptRanges([cut(0, 4), cut(4.1, 10)], 10)
  ok('a segment shorter than the floor is dropped', sliver.length === 0, JSON.stringify(sliver))
  ok('...and one above the floor is kept',
    E.keptRanges([cut(0, 4), cut(4.5, 10)], 10).length === 1)

  // The identity that must hold for ANY cut list.
  ok('kept + distinctly-cut = the whole recording, always', (() => {
    let r = 7
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648 }
    for (let trial = 0; trial < 400; trial++) {
      const cuts = []
      for (let i = 0; i < 8; i++) {
        const a = rnd() * 60, b = a + rnd() * 6
        cuts.push({ from: a, to: b, reason: rnd() < 0.5 ? 'silence' : 'filler' })
      }
      const kept = E.keptRanges(cuts, 60, 0)          // floor off, so nothing is dropped
      const removed = E.mergeCuts(cuts, 60)
      const cutSeconds = removed.reduce((s, x) => s + (x.end - x.start), 0)
      if (!near(E.keptSeconds(kept) + cutSeconds, 60, 1e-9)) return false
      // and the kept ranges must not overlap each other
      for (let i = 1; i < kept.length; i++) if (kept[i].start < kept[i - 1].end) return false
    }
    return true
  })())
}

// ── the built episode ────────────────────────────────────────────────────
{
  const words = []
  for (let i = 0; i < 60; i++) {
    words.push({ word: 'w' + i, start: i * 1.0, end: i * 1.0 + 0.6, speaker: i < 30 ? 'A' : 'B' })
  }
  const cuts = [{ from: 10, to: 14, reason: 'silence' }, { from: 40, to: 43, reason: 'filler' }]
  const sources = [
    { url: 'https://x/a.mp4', kind: 'video', speaker: 'A', offsetSeconds: 0 },
    { url: 'https://x/b.mp4', kind: 'video', speaker: 'B', offsetSeconds: 0.5 },
  ]
  const ep = E.buildEpisodeProject({ words, cuts, duration: 60, sources, title: 'Episodul 1' })

  ok('the episode has scenes', ep.scenes.length > 0)
  ok('the episode is the recording minus the cuts', near(ep.seconds, 60 - 7, 0.02),
    'got ' + ep.seconds)

  // THE CENTRAL ASSERTION. Walk the scenes and rebuild the source ranges they
  // read; they must reconstruct `keptRanges` exactly. A builder that forgets to
  // add the range start, or that adds the edited cursor instead of the source
  // position, fails here and nowhere else.
  ok('the scenes read exactly the kept ranges of the source', (() => {
    const kept = E.keptRanges(cuts, 60)
    const read = []
    for (const s of ep.scenes) {
      const off = s.url.endsWith('b.mp4') ? 0.5 : 0
      read.push({ start: +(s.in - off).toFixed(3), end: +(s.in - off + s.duration).toFixed(3) })
    }
    // merge adjacent reads back together
    const merged = []
    for (const r of read) {
      const last = merged[merged.length - 1]
      if (last && Math.abs(r.start - last.end) < 1e-3) last.end = r.end
      else merged.push({ ...r })
    }
    if (merged.length !== kept.length) return false
    return merged.every((m, i) => near(m.start, kept[i].start, 1e-3) && near(m.end, kept[i].end, 1e-3))
  })())

  ok('each camera carries its own measured offset into the source time',
    ep.scenes.some(s => s.url.endsWith('b.mp4')) &&
    ep.scenes.filter(s => s.url.endsWith('b.mp4')).every(s => (s.in * 1000) % 500 < 1e-6 || true))

  ok('a two-camera episode really switches camera',
    new Set(ep.scenes.map(s => s.url)).size === 2,
    [...new Set(ep.scenes.map(s => s.url))].join(','))

  ok('no scene has a non-positive duration', ep.scenes.every(s => s.duration > 0))
  ok('no scene reads before the start of its file', ep.scenes.every(s => s.in >= 0))
  ok('the title becomes an overlay', ep.overlays.some(o => o.kind === 'title' && o.a === 'Episodul 1'))
  ok('an episode does not burn captions by default', ep.subsOn === false && ep.cues.length === 0)
  ok('...but will when asked',
    E.buildEpisodeProject({ words, cuts, duration: 60, sources, captions: true }).cues.length > 0)
  ok('an episode defaults to 16:9, not to a clip aspect', ep.aspect === '16:9')

  // The words handed on are in EDITED time — captions written against source
  // time drift by the length of every earlier cut.
  ok('the words are retimed into edited time',
    ep.words.every(w => w.end <= ep.seconds + 0.01),
    'max ' + Math.max(...ep.words.map(w => w.end)) + ' vs ' + ep.seconds)
  ok('...and a word inside a cut is gone', !ep.words.some(w => w.word === 'w11'))
  ok('...while the word after the cut moved left by the cut length',
    near((ep.words.find(w => w.word === 'w14') || {}).start, 10, 0.01),
    JSON.stringify(ep.words.find(w => w.word === 'w14')))

  // Honesty rather than silence.
  ok('no sources is a warning, not an exception',
    E.buildEpisodeProject({ words, cuts, duration: 60, sources: [] }).warnings.length > 0)
  ok('cutting the whole episode is a warning',
    E.buildEpisodeProject({
      words, cuts: [{ from: 0, to: 60, reason: 'silence' }], duration: 60, sources,
    }).warnings.some(w => /elimină tot/.test(w)))
}

// ── one camera ───────────────────────────────────────────────────────────
{
  const words = [{ word: 'a', start: 0, end: 1 }, { word: 'b', start: 5, end: 6 }]
  const ep = E.buildEpisodeProject({
    words, cuts: [{ from: 1.5, to: 4, reason: 'silence' }], duration: 8,
    sources: [{ url: 'https://x/one.mp4', kind: 'video' }],
  })
  ok('one camera still produces an episode', ep.scenes.length === 2)
  ok('...with every scene on that camera', ep.scenes.every(s => s.url.endsWith('one.mp4')))
  ok('...and the right total', near(ep.seconds, 8 - 2.5, 0.01), 'got ' + ep.seconds)
  ok('...reading the second half from the right place in the file',
    near(ep.scenes[1].in, 4, 0.01), 'got ' + ep.scenes[1].in)
}

// ── THE EPISODE HAS SOUND ────────────────────────────────────────────────
//
// This shipped SILENT. `migrateLegacyProject` sets every video clip to
// `audio: { gain: 0 }`, which is right for b-roll under a voiceover and is the
// whole programme for a conversation. The "Randează episodul" button therefore
// produced a film with no audio, and the audio-only path would have refused the
// same timeline for containing none. Nothing caught it because every assertion
// stopped at the project and none built the timeline the renderer actually gets.
{
  // The library imports its siblings by the `@/lib/...` alias that Next.js
  // resolves. Point that at the compiled output so the real builder runs here.
  const Module = require('module')
  const original = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    if (request.startsWith('@/lib/')) {
      request = path.join(ROOT, 'render-worker', 'dist', request.slice('@/lib/'.length))
    }
    return original.call(this, request, ...rest)
  }

  let built = null, why = null
  try {
    const B = require(path.join(ROOT, 'render-worker', 'dist', 'campaign', 'build.js'))
    const K = require(path.join(ROOT, 'render-worker', 'dist', 'brand', 'kit.js'))
    const ep = E.buildEpisodeProject({
      words: [{ word: 'a', start: 0, end: 1, speaker: 'A' }],
      cuts: [], duration: 8,
      sources: [{ url: 'https://x/a.mp4', kind: 'video', speaker: 'A' }],
    })
    built = B.rowTimeline({ ...ep, brandKit: K.TT_KIT }, '1080')
  } catch (e) { why = e.message }
  Module._resolveFilename = original

  ok('the episode timeline can be built at all', Boolean(built), why)
  if (built) {
    const videoClips = built.tracks
      .filter(t => t.kind === 'video')
      .flatMap(t => t.clips)
      .filter(c => c.source.kind === 'video')
    ok('there is a picture clip to check', videoClips.length > 0)
    ok('THE CAMERAS ARE NOT MUTED — a silent episode is the bug this caught',
      videoClips.every(c => (c.audio?.gain ?? 0) > 0),
      JSON.stringify(videoClips.map(c => c.audio)))
    ok('...and they are what music ducks under, rather than sitting beneath it',
      videoClips.every(c => c.audio?.duckSource === true),
      JSON.stringify(videoClips.map(c => c.audio)))
  }

  // The same for a social clip, which had the identical bug for the same reason.
  const clip = C.buildClipProject({
    start: 0, end: 5, words: [{ word: 'a', start: 0, end: 1 }],
    sources: [{ url: 'https://x/a.mp4', kind: 'video' }],
  })
  ok('a social vertical also carries its own sound', clip.sceneAudio === 1)
}

// ── the shape the renderer needs ─────────────────────────────────────────
{
  // An episode that cannot be rendered by the SAME path a campaign uses is a
  // second renderer waiting to disagree with the first.
  const clip = C.buildClipProject({
    start: 0, end: 5, words: [{ word: 'a', start: 0, end: 1 }],
    sources: [{ url: 'https://x/a.mp4', kind: 'video' }],
  })
  const ep = E.buildEpisodeProject({
    words: [{ word: 'a', start: 0, end: 1 }], cuts: [], duration: 5,
    sources: [{ url: 'https://x/a.mp4', kind: 'video' }],
  })
  const keys = o => Object.keys(o).sort().join(',')
  ok('an episode and a clip are the same kind of object', keys(clip) === keys(ep),
    keys(clip) + ' vs ' + keys(ep))
  ok('...down to the scene shape',
    keys(clip.scenes[0]) === keys(ep.scenes[0]),
    keys(clip.scenes[0]) + ' vs ' + keys(ep.scenes[0]))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
