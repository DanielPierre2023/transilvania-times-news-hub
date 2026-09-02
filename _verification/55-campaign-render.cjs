// _verification/55-campaign-render.cjs
//
// THE PAYLOAD A CAMPAIGN SENDS MUST BE THE PAYLOAD THE FUNCTION PARSES.
//
// This suite exists because of a defect that would have broken the entire
// campaign feature on the first row anybody ran. The driver posted
//
//     { draft, aspect, master, campaignId, rowIndex }
//
// to the render-worker edge function. That function's contract is
//
//     { action: 'create', timeline }  ->  { id, state }
//     { action: 'status', job_id }    ->  { state, downloadUrl }
//
// and it answers anything else with `{ error: 'timeline is required' }`.
// Every row would have failed immediately.
//
// NOTHING IN THE TYPE SYSTEM COULD HAVE CAUGHT IT. An edge function receives
// JSON; JSON accepts any shape; `tsc` is perfectly happy. A boundary that is
// not typed has to be READ, not remembered — so these assertions read the
// deployed function's own source and check the client against it.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

const T = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'index.js'))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const fnSrc = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'render-worker', 'index.ts'), 'utf8')
const fn = stripComments(fnSrc)
const prodRaw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'productie', 'page.tsx'), 'utf8')
const prod = stripComments(prodRaw)

// ── what the deployed function actually requires ─────────────────────────
{
  ok('the function dispatches on an `action` field', /body\.action/.test(fn))
  ok('...and defaults to create', /String\(body\.action \|\| 'create'\)/.test(fn))
  ok('CREATE REQUIRES A `timeline`, and refuses anything without one',
    /body\.timeline/.test(fn) && /timeline is required/.test(fn))
  ok('STATUS REQUIRES A `job_id`', /body\.job_id/.test(fn) && /job_id is required/.test(fn))
  ok('...and answers with a downloadUrl', /downloadUrl/.test(fn))
  ok('create answers with an id', /id: job\.id|json\(\{[^}]*id/.test(fn))
}

// ── what the client sends ────────────────────────────────────────────────
{
  const build = fs.readFileSync(path.join(ROOT, 'lib', 'campaign', 'build.ts'), 'utf8')
  const js = ts.transpileModule(build, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  // Only the two payload helpers are exercised; the rest of the module pulls in
  // the brand layer, which is not what this suite is about.
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js.replace(/^\s*(const|var)\s+\w+\s*=\s*require\([^)]*\);?\s*$/gm, ''))(
    mod, mod.exports, () => ({}))
  const B = mod.exports

  const created = B.createRenderBody({ id: 'tl' })
  ok('THE CREATE BODY CARRIES action:create', created.action === 'create')
  ok('...AND A TIMELINE — the field the function refuses to work without',
    'timeline' in created, JSON.stringify(Object.keys(created)))
  ok('...and nothing the function does not read', Object.keys(created).length === 2)

  const status = B.statusRenderBody('j1')
  ok('the status body carries action:status and job_id',
    status.action === 'status' && status.job_id === 'j1')

  ok('a finished job is recognised', B.isFinished('done') && B.isFinished('failed'))
  ok('...and a running one is not', !B.isFinished('running') && !B.isFinished('queued'))
  ok('failure is told apart from success', B.isFailure('failed') && !B.isFailure('done'))
}

// ── the driver uses those helpers rather than an object literal ──────────
{
  // The `body:` wrapper went away when the page moved to `invokeEdge`, which
  // takes the body as an argument rather than inside an options object. What
  // is being asserted is unchanged: the payload comes from the named builder
  // and is not retyped at the call site.
  ok('THE DRIVER SENDS THE BUILT BODY, not a hand-typed one',
    /createRenderBody\(timeline\)/.test(prod))
  ok('...and polls with the built status body', /statusRenderBody\(jobId\)/.test(prod))
  ok('THE INVENTED PAYLOAD IS GONE', !/body: \{ draft, aspect/.test(prod))
  ok('the driver builds a real timeline first', /rowTimeline\(project/.test(prod))
  // `rowDraft` rather than `draft`: a fully-generated row has its pictures made
  // first, so the draft the project is built from is the generated one.
  ok('...from a project in the SAME shape a hand-made film has, so a campaign ' +
     'film can be opened and fixed later', /draftToProject\(rowDraft, media/.test(prod))
  ok('...and the generated draft is what gets built, not the template one',
    /const gen = await generateRow\(draft/.test(prod) && /rowDraft = gen\.draft/.test(prod))
  ok('the poll stops on a terminal state', /isFinished\(state\)/.test(prod))
  ok('...and treats failure as failure', /isFailure\(state\)/.test(prod))
  ok('a render that never finishes times out INSIDE its own lease, so the row ' +
     'is not reclaimed while it is still being polled',
    /QUEUE_DEFAULTS\.leaseMs - 30_000/.test(prod))
  ok('an aborted row stops polling', /if \(signal\.aborted\) throw/.test(prod))
}

// ── the voice, which is the difference between films and silent films ────
{
  ok('TEXT-ONLY CAMPAIGNS HAVE A CONTROL TO GENERATE THE SHARED VOICE — without ' +
     'one the driver has nothing to put on the voice track and every film is silent',
    /sharedVoiceUrl/.test(prod) && /generate-voiceover/.test(prod))
  ok('...and it says so when the voice is missing', /fără sunet/.test(prod))
  ok('a spoken-name campaign generates a voice PER ROW', 
    /mode !== 'textOnly' && draft\.script/.test(prod))
  ok('...and fails the row rather than rendering it mute',
    /voice generation returned no file/.test(prod))
  ok('the shared voice is reused, not regenerated per row',
    /voiceUrl: sharedVoiceUrl/.test(prod))
}

// ── the timeline a row builds is actually renderable ─────────────────────
{
  const P = require(path.join(ROOT, 'render-worker', 'dist', 'timeline', 'project.js'))
  const hooks = {
    captionStyle: () => ({ family: 'x', size: 0.04, weight: 600, color: '#fff', align: 'center', lineHeight: 1.2 }),
    captionY: () => 0.88, overlayClips: () => [], sfxLabel: {}, sfxSeconds: {},
    subPos: { jos: 0.88 }, uid: () => 'u' + Math.random(),
  }
  const project = {
    aspect: '9:16', master: '1080', fpsOut: 25,
    scenes: [
      { id: 'a', kind: 'image', url: 'a.png', name: 'plan 1', duration: 4, kb: 'none' },
      { id: 'b', kind: 'image', url: 'b.png', name: 'plan 2', duration: 6, kb: 'none' },
    ],
    overlays: [], cues: [], subsOn: false,
    voUrl: 'v.mp3', voDur: 9,
    brandKit: { colour: { accent: '#CA2222' }, grade: { look: 'warm', strength: 0.85 }, loudness: 'social' },
  }
  const tl = P.buildProjectTimeline(project, hooks, {})
  ok('a campaign row builds a valid timeline',
    T.validate(tl).filter(p => p.severity === 'error').length === 0,
    JSON.stringify(T.validate(tl).filter(p => p.severity === 'error').slice(0, 2)))
  ok('...with the voice on it', tl.tracks.some(t => t.kind === 'audio' && t.clips.length > 0))
  ok('...and picture', tl.tracks.some(t => t.kind === 'video' && t.z === 0 && t.clips.length === 2))
  ok('...and a real duration', tl.duration > 0)
  ok('...and it compiles a frame', !!T.compileFrame(tl, 25))
  ok('A ROW WITH NO VOICE STILL BUILDS — a silent film is a fixable mistake, a ' +
     'crashed campaign is not', (() => {
      const silent = P.buildProjectTimeline({ ...project, voUrl: '', voDur: 0 }, hooks, {})
      return T.validate(silent).filter(p => p.severity === 'error').length === 0
    })())
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
