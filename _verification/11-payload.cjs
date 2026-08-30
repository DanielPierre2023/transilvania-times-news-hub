// _verification/11-payload.js
//
// Asserts the payload generate-motion actually builds, per model, against the
// schemas published by fal on 30 Aug 2026. This is the file that would have
// caught the two bugs that cost us the last two films:
//
//   * o3 has no negative_prompt, so the anti-drift instruction was silently
//     discarded on the default model;
//   * v3 defaults generate_audio to TRUE, which is +50% on the bill for audio
//     Studio's own voiceover covers up.
//
// It reads the REAL source file — no copy to drift out of date — strips the
// Deno server tail, transpiles it, and calls buildPayload directly. No network,
// no fal key, no spend.

const fs = require('fs')
const path = require('path')
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '..')] }))

const SRC = path.join(__dirname, '..', 'supabase', 'functions', 'generate-motion', 'index.ts')
const raw = fs.readFileSync(SRC, 'utf8')

const head = raw.slice(0, raw.indexOf('serve(async (req)'))
  .split('\n').filter(l => !l.startsWith('import ')).join('\n')
const js = ts.transpileModule(head, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const mod = { exports: {} }
new Function('exports', 'module', 'require', 'Deno', js)(mod.exports, mod, require, { env: { get: () => '' } })
const { buildPayload } = mod.exports
if (typeof buildPayload !== 'function') { console.error('buildPayload did not load — the source shape changed'); process.exit(1) }

// The catalogue is module-private, so rebuild the two shapes the tests need
// from the same declarations by re-reading them out of the transpiled scope.
const MODELS = new Function('exports', 'module', 'require', 'Deno', js + '\nmodule.exports.__M = MODELS')(
  {}, mod, require, { env: { get: () => '' } }) || mod.exports.__M

if (!MODELS || !MODELS['v3-pro'] || !MODELS['o3-standard'] || !MODELS['v2.1']) {
  console.error('the model catalogue did not load — the source shape changed'); process.exit(1)
}

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL:', name, extra) } }

const IMG = 'https://example.com/still.jpg'
const base = { image_url: IMG, prompt: 'a slow push', negative_prompt: 'night, blue hour', cfg_scale: 0.7, duration: 6 }

// ── v3 pro ────────────────────────────────────────────────────────────────
{
  const { payload, seconds, dropped } = buildPayload(MODELS['v3-pro'], base)
  ok('v3 names the start frame start_image_url', payload.start_image_url === IMG, JSON.stringify(Object.keys(payload)))
  ok('v3 never sends image_url', payload.image_url === undefined)
  ok('v3 carries the negative prompt', payload.negative_prompt === 'night, blue hour')
  ok('v3 carries cfg_scale', payload.cfg_scale === 0.7)
  ok('v3 sends generate_audio explicitly false', payload.generate_audio === false)
  ok('duration is a STRING — fal enums are string-typed', payload.duration === '6')
  ok('seconds is reported back as a number', seconds === 6)
  ok('nothing was dropped for v3', dropped.length === 0, JSON.stringify(dropped))
}

// ── o3: the silent-drop bug, now loud ─────────────────────────────────────
{
  const { payload, dropped } = buildPayload(MODELS['o3-standard'], base)
  ok('o3 names the start frame image_url', payload.image_url === IMG)
  ok('o3 never sends start_image_url', payload.start_image_url === undefined)
  ok('o3 cannot take a negative prompt', payload.negative_prompt === undefined)
  ok('...and SAYS SO instead of dropping it silently', dropped.includes('negative_prompt'), JSON.stringify(dropped))
  ok('o3 cannot take cfg_scale', payload.cfg_scale === undefined)
  ok('...and says that too', dropped.includes('cfg_scale'))
}

// ── the loop, which is what killed the motion ─────────────────────────────
{
  const withLoop = buildPayload(MODELS['v3-pro'], { ...base, end_image_url: IMG })
  ok('an explicit end frame is honoured when asked for', withLoop.payload.end_image_url === IMG)
  const noLoop = buildPayload(MODELS['v3-pro'], base)
  ok('and is ABSENT unless asked for', noLoop.payload.end_image_url === undefined)
  const old = buildPayload(MODELS['v2.1'], { ...base, end_image_url: IMG })
  ok('2.1 has no end frame and reports the drop', old.payload.end_image_url === undefined && old.dropped.includes('end_image_url'))
}

// ── audio economics ───────────────────────────────────────────────────────
{
  const on = buildPayload(MODELS['v3-pro'], { ...base, generate_audio: true })
  ok('audio can still be turned on deliberately', on.payload.generate_audio === true)
  const off = buildPayload(MODELS['v3-pro'], base)
  ok('but the default is off, against fal’s default of on', off.payload.generate_audio === false)
  const v21 = buildPayload(MODELS['v2.1'], { ...base, generate_audio: true })
  ok('2.1 has no audio field at all', v21.payload.generate_audio === undefined)
}

// ── duration clamping ─────────────────────────────────────────────────────
{
  ok('v3 clamps 40s down to its 15s ceiling', buildPayload(MODELS['v3-pro'], { ...base, duration: 40 }).payload.duration === '15')
  ok('v3 clamps 1s up to its 3s floor', buildPayload(MODELS['v3-pro'], { ...base, duration: 1 }).payload.duration === '3')
  ok('2.1 snaps 6s to the 5s it actually knows', buildPayload(MODELS['v2.1'], { ...base, duration: 6 }).payload.duration === '5')
  ok('2.1 snaps 9s to 10s', buildPayload(MODELS['v2.1'], { ...base, duration: 9 }).payload.duration === '10')
}

// ── prompt XOR multi_prompt ───────────────────────────────────────────────
{
  const multi = buildPayload(MODELS['v3-pro'], { ...base, multi_prompt: [{ prompt: 'shot one', duration: 4 }, { prompt: 'shot two' }] })
  ok('multi_prompt replaces prompt — fal rejects both together',
    multi.payload.prompt === undefined && Array.isArray(multi.payload.multi_prompt))
  ok('each shot keeps its own duration as a string', multi.payload.multi_prompt[0].duration === '4')
  ok('a shot without a duration simply omits it', multi.payload.multi_prompt[1].duration === undefined)
  const onO3 = buildPayload(MODELS['v2.1'], { ...base, multi_prompt: [{ prompt: 'x' }] })
  ok('a model without multi_prompt falls back to prompt and reports it',
    typeof onO3.payload.prompt === 'string' && onO3.dropped.includes('multi_prompt'))
}

// ── elements: forwarded, never invented ───────────────────────────────────
{
  const good = buildPayload(MODELS['v3-pro'], { ...base, elements: [{ frontal_image_url: 'https://x/y.png' }] })
  ok('a well-formed element is forwarded', Array.isArray(good.payload.elements) && good.payload.elements.length === 1)
  const bad = buildPayload(MODELS['v3-pro'], { ...base, elements: [{ nonsense: 1 }] })
  ok('an element with no usable URL is not sent', bad.payload.elements === undefined)
  const noSupport = buildPayload(MODELS['o3-standard'], { ...base, elements: [{ frontal_image_url: 'https://x/y.png' }] })
  ok('a model without elements reports the drop', noSupport.dropped.includes('elements'))
}

// ── defaults ──────────────────────────────────────────────────────────────
{
  const bare = buildPayload(MODELS['v3-pro'], { image_url: IMG })
  ok('a bare request still gets a prompt', String(bare.payload.prompt).length > 40)
  ok('a bare request still gets the anti-drift negative prompt',
    /night/.test(String(bare.payload.negative_prompt)) && /blur/.test(String(bare.payload.negative_prompt)))
  ok('and carries fal’s own three default terms rather than replacing them with nothing',
    /low quality/.test(String(bare.payload.negative_prompt)))
  ok('cfg defaults to Kling’s own 0.5', bare.payload.cfg_scale === 0.5)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
