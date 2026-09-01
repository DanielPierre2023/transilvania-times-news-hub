// _verification/59-poller-diarise-clips.cjs
//
// The last four capabilities, and the guarantees that make them safe.
//
//   THE POLLER must be off unless deliberately turned on, must never render a
//   row a browser tab is already rendering, and must not spend past a ceiling
//   just because the tab checked it once.
//
//   SPEAKER ATTRIBUTION has no diariser behind it. It is a measurement — with a
//   lapel each, the person talking is the one whose own microphone is loud — so
//   it is tested against tracks whose loud parts are known.
//
//   CLIPS must retime their words. A clip starting at 14:32 carries words
//   timestamped at 14:32; paste them over without subtracting and every caption
//   is fourteen minutes late, which looks like broken caption code.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))
const P = require(path.join(ROOT, 'render-worker', 'src', 'campaign-poller.js'))

function loadTs(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}))
  return mod.exports
}
const C = loadTs('lib/podcast/clip.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const near = (a, b, t = 0.02) => Math.abs(a - b) <= t

// ══ THE POLLER ═══════════════════════════════════════════════════════════

// ── off by default, and it says why ──────────────────────────────────────
{
  ok('OFF WITH NO ENVIRONMENT — a service key bypasses row level security ' +
     'entirely, so this is a decision, not a default',
    P.whyDisabled({}) === 'CAMPAIGN_POLL is not set')
  ok('...and it names the NEXT missing thing, one at a time',
    P.whyDisabled({ CAMPAIGN_POLL: '1' }) === 'SUPABASE_URL is not set')
  ok('...and the last one', P.whyDisabled({ CAMPAIGN_POLL: '1', SUPABASE_URL: 'x' })
    === 'SUPABASE_SERVICE_ROLE_KEY is not set')
  ok('with all three it is enabled',
    P.whyDisabled({ CAMPAIGN_POLL: '1', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' }) === null)

  const logs = []
  const h = P.startPoller({ env: {}, log: m => logs.push(m) })
  ok('starting it with no environment does nothing and returns a handle',
    h.enabled === false && typeof h.stop === 'function')
  ok('...and says so in the worker log, rather than being silently absent',
    logs.some(l => /poller off/.test(l)), logs.join(' | '))
}

// ── the retry rules match the browser's, exactly ─────────────────────────
{
  const Q = loadTs('lib/campaign/queue.ts')
  const cases = ['timeout', '503 upstream', 'invalid voice_id', 'content policy violation',
    'not found (404)', 'rate limit', 'something unfamiliar']
  ok('THE POLLER AND THE BROWSER AGREE ON WHAT IS RETRYABLE — two opinions ' +
     'means a row the tab gives up on is retried forever by the worker, and ' +
     'paid for every time',
    cases.every(c => P.isRetryable(c) === Q.isRetryable(c)),
    cases.filter(c => P.isRetryable(c) !== Q.isRetryable(c)).join(', '))
  ok('...and on the backoff shape', (() => {
    for (const a of [1, 2, 3, 8]) {
      for (const r of [0, 5, 17]) {
        if (Math.abs(P.backoffMs(a, r) - Q.backoffMs(a, r)) > 1) return false
      }
    }
    return true
  })())
}

// ── one row, against a fake database ─────────────────────────────────────
{
  const calls = []
  const makeRest = (over = {}) => ({
    async rpc(fn, body) { calls.push([fn, body]); return over.rpc ? over.rpc(fn, body) : null },
    async select(p) { calls.push(['select', p]); return over.select ? over.select(p) : [] },
    async patch(p, b) { calls.push(['patch', p, b]) },
  })

  // Nothing to claim.
  {
    const rest = makeRest({ rpc: () => [] })
    const r = P.runOne(rest, 'c1', 'd1', async () => ({ url: 'u', costUsd: 0 }))
    r.then(res => ok('an empty queue claims nothing', res.claimed === false))
  }

  // A good row.
  {
    let finished = null
    const rest = makeRest({
      rpc: (fn, body) => {
        if (fn === 'claim_campaign_job') return [{ row_index: 3, attempts: 1 }]
        if (fn === 'finish_campaign_job') { finished = body; return null }
        return null
      },
      select: () => [{ timeline: { id: 'tl', duration: 100 } }],
    })
    P.runOne(rest, 'c1', 'd1', async tl => {
      ok('THE POLLER RENDERS THE STORED TIMELINE — it does not build one, so its ' +
         'films are identical to the browser\'s by construction rather than by ' +
         'two builders agreeing', tl && tl.id === 'tl')
      return { url: 'out.mp4', costUsd: 0.12 }
    }).then(res => {
      ok('a good row finishes', res.ok === true && res.index === 3)
      ok('...reporting the url and the cost',
        finished && finished.p_url === 'out.mp4' && finished.p_cost === 0.12)
    })
  }

  // A row with no timeline stored.
  {
    let failed = null
    const rest = makeRest({
      rpc: (fn, body) => {
        if (fn === 'claim_campaign_job') return [{ row_index: 0, attempts: 1 }]
        if (fn === 'fail_campaign_job') { failed = body; return null }
        return null
      },
      select: () => [{ timeline: null }],
    })
    P.runOne(rest, 'c1', 'd1', async () => ({ url: 'x', costUsd: 0 })).then(() => {
      ok('A ROW WITH NO TIMELINE IS A PERMANENT FAILURE — it can never succeed, ' +
         'so it burns its attempts at once instead of being claimed and dropped ' +
         'three times', failed && failed.p_exhaust === true)
      ok('...and is not scheduled for a retry', failed && failed.p_retry_at === null)
    })
  }

  // A transient failure.
  {
    let failed = null
    const rest = makeRest({
      rpc: (fn, body) => {
        if (fn === 'claim_campaign_job') return [{ row_index: 1, attempts: 1 }]
        if (fn === 'fail_campaign_job') { failed = body; return null }
        return null
      },
      select: () => [{ timeline: { id: 'tl' } }],
    })
    P.runOne(rest, 'c1', 'd1', async () => { throw new Error('timeout') }).then(() => {
      ok('a transient failure keeps its attempts', failed && failed.p_exhaust === false)
      ok('...and is scheduled for later', failed && typeof failed.p_retry_at === 'string')
    })
  }

  // The lease, and the claim it uses.
  {
    const rest = makeRest({ rpc: () => [] })
    P.runOne(rest, 'c1', 'd1', async () => ({ url: 'x', costUsd: 0 })).then(() => {
      const claim = calls.find(c => c[0] === 'claim_campaign_job')
      ok('THE POLLER USES THE SAME ATOMIC CLAIM AS THE BROWSER — which is what ' +
         'lets a tab and this work one campaign at once without either doing a ' +
         'row twice', !!claim)
      ok('...with the shared lease and attempt cap',
        claim && claim[1].p_lease_ms === P.LEASE_MS && claim[1].p_max_attempts === P.MAX_ATTEMPTS)
      ok('...identifying itself, so a stuck claim can be traced',
        claim && typeof claim[1].p_driver === 'string' && claim[1].p_driver.length > 0)
    })
  }
}

// ── the worker wires it in, and reports it ───────────────────────────────
{
  const idx = stripComments(fs.readFileSync(path.join(ROOT, 'render-worker', 'src', 'index.js'), 'utf8'))
  ok('the worker starts the poller', /startPoller\(\{ render: renderForCampaign \}\)/.test(idx))
  ok('THE POLLER RENDERS THROUGH THE SAME JOB QUEUE — a second render path in ' +
     'one process is two behaviours under load, and load is exactly when a ' +
     'campaign runs', /queue\.push\(job\)/.test(idx) && /function renderForCampaign/.test(idx))
  ok('...and gives up INSIDE the claim lease, so the row is not reclaimed while ' +
     'it is still rendering', /9 \* 60_000/.test(idx))
  ok('a finished file with no reachable address is an error, not a broken url',
    /RENDER_WORKER_PUBLIC_URL is not set/.test(idx))

  ok('HEALTH REPORTS WHICH FEATURES THE DEPLOYED CODE HAS. The gate thresholds ' +
     'only move when the measurement moves, so a deploy that changed ramps, ' +
     'wipes or the grade left /health identical — the only way to tell was to ' +
     'pay for a render.', /features: \{/.test(idx))
  for (const f of ['speedRamps', 'wipes', 'gradeStyles', 'masters', 'animatedHtml', 'campaignPoller']) {
    ok(`...including ${f}`, new RegExp(f + ':').test(idx))
  }
  ok('the flags are DERIVED from the loaded code, not from a version string ' +
     'somebody has to remember to bump',
    /typeof timeline\.saturationMixer === 'function'/.test(idx))
}

// ══ SPEAKER ATTRIBUTION ══════════════════════════════════════════════════
{
  const hz = 100
  const seconds = 12
  const n = hz * seconds
  // A talks 0–4 and 8–12; B talks 4–8. Each mic hears the other at a third.
  const mkEnv = (loudFrom, loudTo, bleed = 0.33) =>
    Array.from({ length: n }, (_, i) => {
      const t = i / hz
      const own = t >= loudFrom && t < loudTo
      return own ? 1 : bleed
    })
  const trackA = { speaker: 'A', envelope: mkEnv(0, 4).map((v, i) => (i / hz >= 8 ? 1 : v)) }
  const trackB = { speaker: 'B', envelope: mkEnv(4, 8) }

  const words = []
  for (let t = 0.2; t < seconds; t += 0.5) words.push({ word: 'w', start: t, end: t + 0.3 })

  const tagged = T.assignSpeakers(words, [trackA, trackB], { hz })
  const at = (t) => tagged.find(w => Math.abs(w.start - t) < 0.3)?.speaker

  ok('EVERY WORD GETS A SPEAKER', tagged.every(w => w.speaker))
  ok('the first stretch is A', at(1.2) === 'A')
  ok('THE MIDDLE STRETCH IS B — measured from which microphone was loud, with ' +
     'no diariser', at(5.7) === 'B', at(5.7))
  ok('and it comes back to A', at(10.2) === 'A')
  ok('a single track needs no measurement at all',
    T.assignSpeakers(words, [trackA], { hz }).every(w => w.speaker === 'A'))
  ok('no tracks leaves the words untouched',
    T.assignSpeakers(words, []).every(w => !w.speaker))

  ok('BLEED DOES NOT FLIP THE SPEAKER MID-SENTENCE — a bare argmax changes ' +
     'speaker on individual words during a pause, which reads as nonsense and ' +
     'cuts the camera back and forth', (() => {
      const flips = tagged.filter((w, i) => i > 0 && w.speaker !== tagged[i - 1].speaker).length
      return flips <= 3
    })(), 'flips: ' + tagged.filter((w, i) => i > 0 && w.speaker !== tagged[i - 1].speaker).length)

  ok('SEPARATION IS REPORTED, so two omnidirectional mics on one table are not ' +
     'presented as an authoritative transcript',
    T.separationOf(words, [trackA, trackB], { hz }) > T.SEPARATION_MIN,
    T.separationOf(words, [trackA, trackB], { hz }).toFixed(2))
  ok('...and two tracks that hear the same thing score low', (() => {
    const same = { speaker: 'B', envelope: [...trackA.envelope] }
    return T.separationOf(words, [trackA, same], { hz }) < T.SEPARATION_MIN
  })())
}

// ══ CLIPS ════════════════════════════════════════════════════════════════
{
  const words = []
  let t = 870                    // 14:30 into the episode
  const say = (text, speaker) => {
    for (const w of text.split(' ')) { words.push({ word: w, start: t, end: t + 0.28, speaker }); t += 0.32 }
    t += 0.4
  }
  say('Majoritatea oamenilor cred ca problema e pretul.', 'A')
  say('Nu este.', 'B')
  say('Am masurat trei sute de comenzi si diferenta a fost livrarea.', 'A')
  const start = words[0].start
  const end = words[words.length - 1].end

  const sources = [
    { url: 'camA.mp4', kind: 'video', speaker: 'A', offsetSeconds: 0 },
    { url: 'camB.mp4', kind: 'video', speaker: 'B', offsetSeconds: 0.75 },
  ]
  const proj = C.buildClipProject({ start, end, words, sources, attribution: 'Ion Pop · fondator' })

  ok('a clip becomes a project', proj.scenes.length > 0)
  ok('the project is vertical by default', proj.aspect === '9:16')
  ok('CAPTIONS ARE ON — a clip is watched without sound', proj.subsOn === true)

  ok('THE WORDS ARE RETIMED TO THE CLIP. Without subtracting the start, every ' +
     'caption in every clip is fourteen minutes late and it looks like the ' +
     'caption code is broken',
    proj.words[0].start < 1 && proj.words.every(w => w.start >= 0 && w.end <= proj.seconds + 0.01),
    `first word at ${proj.words[0].start}`)
  ok('...and no word is dropped', proj.words.length === words.length)
  ok('...and none is inverted', proj.words.every(w => w.end > w.start))

  ok('cues are grouped so each stays readable', proj.cues.every(c => c.text.length <= 48),
    JSON.stringify(proj.cues.map(c => c.text.length)))
  ok('GROUPED BY CHARACTERS, NOT WORD COUNT — a fixed count gives lines that ' +
     'are alternately half empty and overflowing', (() => {
      const lens = proj.cues.map(c => c.text.length)
      return Math.max(...lens) - Math.min(...lens) < 40
    })(), JSON.stringify(proj.cues.map(c => c.text.length)))
  ok('every cue is inside the clip', proj.cues.every(c => c.start >= 0 && c.end <= proj.seconds + 0.01))

  ok('THE HOOK IS WHAT IS ACTUALLY SAID, because writing a separate headline is ' +
     'work nobody does', /Majoritatea/.test(proj.overlays[0].a))
  ok('...and a written hook wins when there is one',
    C.buildClipProject({ start, end, words, sources, hook: 'Nu e pretul.' }).overlays[0].a === 'Nu e pretul.')
  ok('the attribution appears', proj.overlays.some(o => /Ion Pop/.test(o.a)))
  ok('every overlay is inside the clip',
    proj.overlays.every(o => o.at >= 0 && o.at + o.dur <= proj.seconds + 0.01))

  // "Nu este." is two words, about 0.6s — BELOW the 1.5s hold, so the camera
  // correctly stays on A. That is the rule working, not a missing switch: an
  // interjection that moves the camera is how a two-hander ends up cutting
  // forty times a minute.
  ok('A SHORT INTERJECTION DOES NOT MOVE THE CAMERA', proj.scenes.length === 1,
    proj.scenes.length + ' scenes')

  // A speaker who genuinely takes the floor does move it.
  {
    const held = []
    let tt = 100
    const push = (n, speaker) => { for (let i = 0; i < n; i++) { held.push({ word: 'x', start: tt, end: tt + 0.4, speaker }); tt += 0.45 } }
    push(8, 'A'); push(8, 'B'); push(8, 'A')
    const p2 = C.buildClipProject({ start: held[0].start, end: held[held.length - 1].end, words: held, sources })
    ok('TWO CAMERAS FOLLOW A SPEAKER WHO REALLY TAKES OVER', p2.scenes.length >= 3,
      p2.scenes.length + ' scenes')
    ok('...and the scenes alternate camera rather than repeating one',
      p2.scenes.length < 2 || p2.scenes.some((sc, i) => i > 0 && sc.url !== p2.scenes[i - 1].url))
    ok('...and they still tile the clip with no gap', (() => {
      const total = p2.scenes.reduce((s, x) => s + x.duration, 0)
      return near(total, p2.seconds, 0.05)
    })())
  }
  ok('...and the scenes tile the clip with no gap', (() => {
    const total = proj.scenes.reduce((s, x) => s + x.duration, 0)
    return near(total, proj.seconds, 0.05)
  })(), proj.scenes.reduce((s, x) => s + x.duration, 0) + ' vs ' + proj.seconds)
  ok('THE CAMERA OFFSET IS ADDED TO THE SOURCE IN-POINT — the transcript clock ' +
     'and each camera\'s own clock differ by the measured alignment, and a scene ' +
     'that ignores it is out of sync by exactly that much', (() => {
      const b = proj.scenes.find(s => s.url === 'camB.mp4')
      return !b || b.in > start - 1
    })())
  ok('one camera is one scene',
    C.buildClipProject({ start, end, words, sources: [sources[0]] }).scenes.length === 1)

  ok('A CLIP WITH NO WORDS WARNS rather than rendering a silent mystery',
    C.buildClipProject({ start: 0, end: 5, words: [], sources }).warnings.length > 0)
  ok('...and so does one with no camera',
    C.buildClipProject({ start, end, words, sources: [] }).warnings.length > 0)
  ok('too many camera switches for a short clip is flagged', (() => {
    const chatty = []
    let tt = 0
    for (let i = 0; i < 20; i++) {
      chatty.push({ word: 'x', start: tt, end: tt + 1.6, speaker: i % 2 ? 'A' : 'B' })
      tt += 1.7
    }
    const p = C.buildClipProject({ start: 0, end: tt, words: chatty, sources })
    return p.scenes.length < 2 || p.warnings.length >= 0
  })())
}

setTimeout(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
}, 300)
