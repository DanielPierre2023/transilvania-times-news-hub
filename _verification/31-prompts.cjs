// _verification/31-prompts.cjs
//
// "The words a model is given are copy, not code."
//
// The motion prompt, three negative lists and the house style lived as consts
// inside a three-thousand-line React component. Which is why, the day a negative
// list was found telling a deliberately blue pre-dawn shot that blue hour and a
// cold cast were defects, the fix was a code change, a build and a deploy.
//
// It is data now. This suite exists to keep it that way, and to make sure the
// assembly rules — which hold is sent, what a shot's own direction overrides —
// keep behaving after somebody edits the words.
//
// SUPERSEDES 24-motion-direction.cjs, WHICH IS DELETED.
//
// That suite asserted the SHAPE of the constants: that MOTION_NEGATIVE_ALWAYS
// existed, that MOTION_NEGATIVE_KEEP_COLD named golden hour, that the page sent
// motionNegativeFor(). Every one of those was a pattern match against source
// that no longer exists. The properties that actually mattered — a cold shot is
// never told blue hour is a defect, a shot's own direction beats the default,
// look 'none' holds nothing — are asserted here against the running code
// instead, which is stronger. Deleting a suite needs a reason; that is the
// reason, and it cost nothing: every behaviour 24 checked is checked below.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)
const lib = fs.readFileSync(path.join(ROOT, 'lib', 'prompts', 'library.ts'), 'utf8')


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// The library is TypeScript, so it is exercised through a tiny transpile rather
// than by pattern-matching its source — the behaviour is what matters.
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const js = ts.transpileModule(lib, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
const P = mod.exports

// ── the words are out of the component ───────────────────────────────────
{
  ok('no motion prompt const survives in the page', !/const MOTION_PROMPT/.test(src))
  ok('no negative lists survive either',
    !/MOTION_NEGATIVE_ALWAYS/.test(src) && !/MOTION_NEGATIVE_KEEP_WARM/.test(src))
  ok('the page builds prompts from the library',
    /buildMotionPrompt\(prompts, sc\)/.test(src) && /buildNegativePrompt\(prompts, sc\.look/.test(src))
  ok('the house style is appended from the library, not retyped',
    /partText\(prompts, 'still\.house'\)/.test(src))
  ok('overrides travel with the project, like the kit', /brandKit: kit[^}]*promptOverrides/.test(src))
  ok('...and are read back when a project opens', /d\.promptOverrides/.test(src))
  ok('a writer can edit every part', /prompts\.parts\.map\(part/.test(src))
  ok('...and revert one without touching the others', /revino la implicit/.test(src))
}

// ── assembly: a shot's own direction beats the default ───────────────────
{
  const set = P.DEFAULT_PROMPTS
  const dflt = P.motionPrompt(set, {})
  const own = P.motionPrompt(set, { motionPrompt: 'The roller shutter goes on rising.' })
  ok('with no direction, the default is used', /drifting haze/.test(dflt))
  ok('a shot with its own direction does not get the default',
    /roller shutter/.test(own) && !/drifting haze/.test(own))
  ok('an empty direction falls back rather than sending nothing',
    /drifting haze/.test(P.motionPrompt(set, { motionPrompt: '   ' })))
}

// ── the hold runs in the direction the shot actually does ────────────────
{
  const set = P.DEFAULT_PROMPTS
  ok('a warm shot is told to hold warm light', /same warm lighting/.test(P.motionPrompt(set, { look: 'warm' })))
  ok('a cold shot is told to hold cold light', /same cold lighting/.test(P.motionPrompt(set, { look: 'cold' })))
  ok('...and is NOT told to hold warm light',
    !/same warm lighting/.test(P.motionPrompt(set, { look: 'cold' })))
  ok("look 'none' holds nothing", !/same \w+ lighting/.test(P.motionPrompt(set, { look: 'none' })))
  ok('the default look is warm, as it always was',
    P.motionPrompt(set, {}) === P.motionPrompt(set, { look: 'warm' }))
}

// ── the negative is the actual bug, so it is tested hardest ──────────────
{
  const set = P.DEFAULT_PROMPTS
  const warm = P.negativePrompt(set, 'warm')
  const cold = P.negativePrompt(set, 'cold')
  const none = P.negativePrompt(set, 'none')
  ok('every shot forbids watermarks and identity change',
    [warm, cold, none].every(n => /watermark/.test(n) && /identity change/.test(n)))
  ok('a warm shot forbids drifting to blue hour', /blue hour/.test(warm))
  ok('A COLD SHOT IS NEVER TOLD BLUE HOUR IS A DEFECT', !/blue hour/.test(cold), cold)
  ok('...it is told the opposite instead', /golden hour/.test(cold))
  ok('a warm shot is not told golden hour is a defect', !/golden hour/.test(warm))
  ok("look 'none' carries no colour hold at all",
    !/blue hour/.test(none) && !/golden hour/.test(none))
  ok('the two holds are genuinely opposed',
    /blue/.test(warm) && !/blue/.test(cold))
}

// ── overrides ────────────────────────────────────────────────────────────
{
  const edited = P.mergePrompts(P.DEFAULT_PROMPTS, { 'motion.default': 'Hold absolutely still.' })
  ok('an override replaces one part', /Hold absolutely still/.test(P.motionPrompt(edited, {})))
  ok('...and only that part', /watermark/.test(P.negativePrompt(edited, 'warm')))
  ok('an empty override object changes nothing',
    P.mergePrompts(P.DEFAULT_PROMPTS, {}) !== null &&
    P.motionPrompt(P.mergePrompts(P.DEFAULT_PROMPTS, {}), {}) === P.motionPrompt(P.DEFAULT_PROMPTS, {}))
  ok('null overrides return the same object', P.mergePrompts(P.DEFAULT_PROMPTS, null) === P.DEFAULT_PROMPTS)
  ok('an override to empty string is honoured, not ignored',
    P.partText(P.mergePrompts(P.DEFAULT_PROMPTS, { 'hold.warm': '' }), 'hold.warm') === '')
}

// ── template variables ───────────────────────────────────────────────────
{
  ok('a variable is substituted', P.fill('a {{x}} b', { x: 'cat' }) === 'a cat b')
  ok('a missing variable leaves nothing behind, not the braces',
    P.fill('a {{missing}} b', {}) === 'a  b')
  ok('numbers work', P.fill('{{n}}', { n: 5 }) === '5')
}

// ── the shipped words still say what they must ───────────────────────────
{
  const house = P.partText(P.DEFAULT_PROMPTS, 'still.house')
  ok('the house style keeps the lower fifth clear for captions', /lower fifth/.test(house))
  ok('...and bans invented lettering', /no text/i.test(house) && /no signage/i.test(house))
  ok('...and asks for the middle third, which a crop depends on', /middle third/.test(house))
  ok('every part has a label a person can read',
    P.DEFAULT_PROMPTS.parts.every(p => p.label && p.label.length > 3))
  ok('every part declares a slot', P.DEFAULT_PROMPTS.parts.every(p => !!p.slot))
  ok('ids are unique', new Set(P.DEFAULT_PROMPTS.parts.map(p => p.id)).size === P.DEFAULT_PROMPTS.parts.length)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
