// _verification/report.cjs
//
// THE FEATURE MATRIX, GENERATED RATHER THAN WRITTEN.
//
// A list of features typed by hand into a README is a claim. This walks the
// actual repository and answers, per feature, the five questions that between
// them are the difference between "built" and "usable":
//
//   1. CODE      — does the library module exist and compile?
//   2. PROOF     — is there a suite covering it, and how many assertions?
//   3. CONTROL   — is there something in a page that switches it on?
//   4. DOOR      — is that page reachable from the sidebar?
//   5. CONTRACT  — do the backend calls it makes match the deployed functions?
//
// Every one of those five has failed on its own in this project, silently, with
// the other four green. A feature that compiles and is tested and has no control
// does not exist. A feature with a control on a page nobody can navigate to does
// not exist either — that one shipped, and is why question 4 is on the list.
//
// Run: node _verification/report.cjs

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const ROOT = path.join(__dirname, '..')

const read = p => { try { return fs.readFileSync(path.join(ROOT, p), 'utf8') } catch { return '' } }
const exists = p => fs.existsSync(path.join(ROOT, p))

const PAGES = {
  studio: 'app/admin/studio/page.tsx',
  productie: 'app/admin/productie/page.tsx',
  podcast: 'app/admin/podcast/page.tsx',
}
const src = Object.fromEntries(Object.entries(PAGES).map(([k, v]) => [k, read(v)]))
const layout = read('app/admin/layout.tsx')
const NAV_HREFS = new Set([...layout.matchAll(/href:\s*'([^']+)'/g)].map(m => m[1]))
const HREF_OF = { studio: '/admin/studio', productie: '/admin/productie', podcast: '/admin/podcast' }

// ── the features, and how to recognise each one in the code ──────────────
//
// `control` is a string that must appear in the named page. It is deliberately
// a fragment of the CONTROL, not of the import — an import proves the library
// was linked, not that anyone can reach it.
//
// A WARNING ABOUT THIS COLUMN, WRITTEN AFTER IT LIED TWICE ON ITS FIRST RUN.
//
// The first version of this table reported "no control" for per-shot colour and
// for beat matching. Both controls were there; the strings guessed at here were
// wrong — `sc.gain` and `onBeats`, neither of which the page has ever contained.
// A false NU is cheap to notice (you go and look). A false DA is not, and it is
// what this whole file exists to prevent, so every string below was copied out
// of the page rather than remembered.
const FEATURES = [
  { name: 'Speed ramps',            lib: 'lib/timeline/speed.ts',        suite: '41-speed',        page: 'studio',    control: 'SPEED_PRESETS' },
  { name: 'Wipes (7 kinds)',        lib: 'lib/timeline/transitions.ts',  suite: '42-wipes',        page: 'studio',    control: 'TRANSITIONS' },
  { name: 'Ramp playback',          lib: 'render-worker/src/sources.js', suite: '43-ramp-render',  page: 'studio',    control: 'SPEED_PRESETS[sc.speed]' },
  { name: '4K + master ladder',     lib: 'lib/timeline/masters.ts',      suite: '44-masters',      page: 'studio',    control: 'MASTERS' },
  { name: 'Per-shot colour',        lib: 'lib/timeline/grade.ts',        suite: '40-shot-grade',   page: 'studio',    control: "mark('culoare plan')" },
  { name: 'Grade styles',           lib: 'lib/timeline/grade.ts',        suite: '57-grade-style-parity', page: 'studio', control: 'GRADE_STYLES' },
  { name: 'Beat-matched cuts',      lib: 'lib/timeline/beats.ts',        suite: '39-beats',        page: 'studio',    control: 'findBeats(true)' },
  { name: 'Animated graphics',      lib: 'lib/timeline/html.ts',         suite: '37-animated-compositions', page: 'studio', control: 'COMPOSITIONS' },
  { name: 'Transitions',            lib: 'lib/timeline/transitions.ts',  suite: '38-transitions',  page: 'studio',    control: 'sc.trans' },
  { name: 'Cut to speech',          lib: 'lib/timeline/sync.ts',         suite: '58-sync',         page: 'studio',    control: 'alignCutsToSpeech' },
  { name: 'Text on shots',          lib: 'lib/timeline/sync.ts',         suite: '58-sync',         page: 'studio',    control: 'splitScriptForShots' },
  { name: 'Same-person avatars',    lib: 'lib/avatars/index.ts',         suite: '48-avatars-campaign', page: 'productie', control: 'checkAvatar' },
  { name: 'Template library',       lib: 'lib/templates/library.ts',     suite: '46-templates',    page: 'productie', control: 'byCategory(cat)' },
  { name: 'Bulk from a list',       lib: 'lib/templates/merge.ts',       suite: '45-merge',        page: 'productie', control: 'parseRows' },
  { name: 'Campaign queue',         lib: 'lib/campaign/queue.ts',        suite: '52-queue',        page: 'productie', control: 'claim_campaign_job' },
  { name: 'Campaign runner',        lib: 'lib/campaign/runner.ts',       suite: '53-runner',       page: 'productie', control: 'runCampaign(' },
  { name: 'Per-row generation',     lib: 'lib/campaign/generate.ts',     suite: '60-generate-and-meter', page: 'productie', control: 'generateRow(' },
  { name: 'Usage metering',         lib: 'lib/campaign/generate.ts',     suite: '60-generate-and-meter', page: 'productie', control: 'studio_usage' },
  { name: 'Screen recording',       lib: 'lib/timeline/screen.ts',       suite: '49-screen',       page: 'productie', control: 'getDisplayMedia' },
  { name: 'Podcast alignment',      lib: 'lib/timeline/podcast.ts',      suite: '47-podcast',      page: 'podcast',   control: 'onClick={align}' },
  { name: 'Chunked transcription',  lib: 'lib/media/wav.ts',             suite: '56-audio-chunking', page: 'podcast', control: 'planChunks' },
  { name: 'Speaker attribution',    lib: 'lib/timeline/podcast.ts',      suite: '59-poller-diarise-clips', page: 'podcast', control: 'assignSpeakers' },
  { name: 'Episode for publishing', lib: 'lib/podcast/episode.ts',       suite: '61-episode',      page: 'podcast',   control: 'Randează episodul' },
  { name: 'Social verticals',       lib: 'lib/podcast/clip.ts',          suite: '61-episode',      page: 'podcast',   control: 'randează vertical' },
  { name: 'Project → timeline',     lib: 'lib/timeline/project.ts',      suite: '54-project-builder', page: 'studio', control: 'buildProjectTimeline' },
  { name: 'Railway poller',         lib: 'render-worker/src/campaign-poller.js', suite: '59-poller-diarise-clips', page: null, control: null },
  { name: 'Tenancy / seats',        lib: 'supabase/migrations/20260902090000_campaign_timelines_and_org.sql', suite: '50-migration', page: null, control: null },
]

// ── assertion counts, taken from the suites actually running ─────────────
const counts = {}
for (const f of fs.readdirSync(__dirname)) {
  if (!f.endsWith('.cjs') || f === 'run-all.cjs' || f === 'report.cjs') continue
  try {
    const out = execFileSync('node', [path.join(__dirname, f)], { encoding: 'utf8', timeout: 240000 })
    const m = out.match(/(\d+) passed, (\d+) failed/)
    counts[f.replace('.cjs', '')] = m ? { pass: +m[1], fail: +m[2] } : { pass: 0, fail: 0 }
  } catch (e) {
    const out = String(e.stdout || '')
    const m = out.match(/(\d+) passed, (\d+) failed/)
    counts[f.replace('.cjs', '')] = m ? { pass: +m[1], fail: +m[2] } : { pass: 0, fail: 1 }
  }
}

// ── the backend contracts, checked against the deployed functions ────────
const CONTRACTS = [
  { fn: 'align-subtitles',     sends: 'audio_url',    reads: /body\.audio_url/ },
  { fn: 'generate-image-edit', sends: 'image_urls',   reads: /body\.image_urls/ },
  { fn: 'generate-voiceover',  sends: 'text',         reads: /body\.text/ },
  { fn: 'generate-cover-image', sends: 'raw_prompt',  reads: /body\.raw_prompt/ },
  { fn: 'render-worker',       sends: "action:'create'", reads: /body\.action/ },
]
const allPages = Object.values(src).join('\n')
const contractRows = CONTRACTS.map(c => {
  const fnSrc = read(`supabase/functions/${c.fn}/index.ts`)
  return {
    fn: c.fn,
    deployedExists: fnSrc.length > 0,
    functionReads: c.reads.test(fnSrc),
    clientSends: allPages.includes(c.sends.replace("'", "'")) ||
      allPages.includes(c.sends) ||
      read('lib/campaign/build.ts').includes(c.sends.replace(/'/g, "'")),
    called: allPages.includes(c.fn) || read('lib/campaign/build.ts').includes(c.fn),
  }
})

// ── print ────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
const tick = b => b ? 'da ' : 'NU '

console.log('\nMATRICEA DE FUNCȚII — generată din cod, ' + new Date().toISOString().slice(0, 10))
console.log('='.repeat(104))
console.log(pad('FUNCȚIA', 26) + pad('COD', 5) + pad('DOVADĂ', 30) + pad('CONTROL', 9) + pad('UȘĂ', 6) + 'PAGINA')
console.log('-'.repeat(104))

let allGood = true
for (const f of FEATURES) {
  const hasLib = exists(f.lib)
  const c = counts[f.suite] || { pass: 0, fail: 1 }
  const proof = `${f.suite} ${c.pass}/${c.pass + c.fail}`
  const hasControl = f.control ? (src[f.page] || '').includes(f.control) : null
  const hasDoor = f.page ? NAV_HREFS.has(HREF_OF[f.page]) : null
  const row = pad(f.name, 26) + pad(tick(hasLib), 5) + pad(proof, 30) +
    pad(hasControl === null ? '—  ' : tick(hasControl), 9) +
    pad(hasDoor === null ? '—  ' : tick(hasDoor), 6) +
    (f.page ? PAGES[f.page].replace('app/admin/', '').replace('/page.tsx', '') : 'fără UI (server)')
  console.log(row)
  if (!hasLib || c.fail > 0 || hasControl === false || hasDoor === false) allGood = false
}

console.log('\nCONTRACTELE CU FUNCȚIILE DEPLOYATE')
console.log('-'.repeat(104))
for (const r of contractRows) {
  console.log(pad(r.fn, 26) + 'există: ' + tick(r.deployedExists) +
    ' · citește cheia: ' + tick(r.functionReads) +
    ' · e apelată: ' + tick(r.called))
  if (!r.deployedExists || !r.functionReads || !r.called) allGood = false
}

const totals = Object.values(counts).reduce((a, c) => ({ pass: a.pass + c.pass, fail: a.fail + c.fail }), { pass: 0, fail: 0 })
console.log('\n' + '='.repeat(104))
console.log(`${Object.keys(counts).length} suite · ${totals.pass} aserțiuni trecute · ${totals.fail} căzute`)
console.log(allGood ? 'Fiecare funcție are cod, dovadă, control și ușă.' : 'ATENȚIE: vezi NU în tabelul de mai sus.')
process.exit(allGood && totals.fail === 0 ? 0 : 1)
