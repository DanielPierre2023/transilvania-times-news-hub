// _verification/24-motion-direction.cjs
//
// THIS SUITE WAS REWRITTEN, NOT DELETED.
//
// An earlier draft of this work told Daniel to delete the file by hand. That was
// a bad instruction twice over: a manual delete is a step that can be forgotten
// or fumbled during a commit, and deleting a suite deletes the memory of WHY the
// code is shaped this way. The two faults below are real and cost a reshoot to
// find. They are re-asserted here against `lib/prompts/library.ts`, which now
// owns the words, plus the one property a move like this can genuinely break:
// that the right words still reach the motion job for the right shot.
//
// 1. THE GRADE-HOLD WAS A TRAP FOR HALF OF ALL SHOTS.
//    A past failure — a golden-hour still returned as cold blue night — was
//    fixed by banning `blue hour, twilight, dusk` and `cold colour grade, blue
//    cast, teal tint` in the negative prompt. For every shot. Forever.
//    Then shot 1 of a film became a mechanic opening a shutter onto a blue
//    pre-dawn yard, and we were about to tell the model that everything the
//    picture is made of is a defect. Measured on the take that came back: the
//    warm practical lamp lost 26.7 points of warmth across five seconds while
//    the frame gained 13 points of luma — the warm/cold contrast the shot is
//    built on, flattening.
//
// 2. ONE GLOBAL MOTION PROMPT IS A STORYBOARD WITH ONE FRAME IN IT.
//    "Drifting haze, moving leaves, people walking softly" says nothing about a
//    shutter going up or a light being switched off — which is to say nothing
//    about the two shots carrying the first two lines of a film.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)
const libSrc = fs.readFileSync(path.join(ROOT, 'lib', 'prompts', 'library.ts'), 'utf8')


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// Behaviour, not pattern matching: the library is transpiled and run.
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const js = ts.transpileModule(libSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const mod = { exports: {} }
new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
const P = mod.exports
const SET = P.DEFAULT_PROMPTS

// ── fault 1: the negative is split, and the halves oppose each other ─────
{
  const warm = P.negativePrompt(SET, 'warm')
  const cold = P.negativePrompt(SET, 'cold')
  const none = P.negativePrompt(SET, 'none')

  ok('the negative differs by the light the shot is made of',
    warm !== cold && cold !== none && warm !== none)
  ok('...and every shot still gets the things that are always wrong',
    [warm, cold, none].every(s => /watermark/i.test(s) && /identity change/i.test(s)))
  ok('the always-list says nothing about light',
    !/blue hour|golden hour|teal/i.test(none), none)
  ok('keep-warm is where the time-of-day ban went', /blue hour/i.test(warm) && /teal tint/i.test(warm))
  ok('keep-cold defends a cold shot in the other direction',
    /golden hour/i.test(cold) && /warm orange/i.test(cold))
  ok('THE TWO HOLDS GENUINELY OPPOSE EACH OTHER — this is the whole fault',
    /blue hour/i.test(warm) && !/blue hour/i.test(cold) &&
    /golden hour/i.test(cold) && !/golden hour/i.test(warm))
  ok("a shot told not to fix its light gets no hold at all",
    !/blue hour|golden hour/i.test(none))
}

// ── fault 2: direction is per shot, not global ───────────────────────────
{
  const dflt = P.motionPrompt(SET, {})
  const own = P.motionPrompt(SET, { motionPrompt: 'The shutter rolls up.' })

  ok('a shot can carry its own direction', /The shutter rolls up/.test(own))
  ok('an empty per-shot prompt falls back to the default', dflt.length > 40)
  ok('...and the default is not silently glued onto a shot that has its own',
    !own.includes(dflt.slice(0, 40)))

  const warm = P.motionPrompt(SET, { motionPrompt: 'x', look: 'warm' })
  const cold = P.motionPrompt(SET, { motionPrompt: 'x', look: 'cold' })
  const none = P.motionPrompt(SET, { motionPrompt: 'x', look: 'none' })
  ok('the grade instruction is appended in the right direction',
    /warm/i.test(warm) && /cold/i.test(cold))
  ok("...and is absent when the shot says not to fix the light",
    warm !== none && cold !== none)
  ok('no shot is ever asked for a cut', [warm, cold, none].every(s => /no cuts/i.test(s)))
}

// ── the move itself: the words still reach the job ───────────────────────
//
// The library can be perfect and the page can still send the old global string.
// This is the property the refactor could actually have broken, and the reason
// the file still exists rather than being deleted.
{
  ok('the page builds the motion prompt from the library, per shot',
    /buildMotionPrompt\(prompts, sc\)/.test(src))
  ok("...and the negative for THAT SHOT'S look",
    /buildNegativePrompt\(prompts, sc\.look/.test(src))
  ok('the old page-level constants are gone, not merely shadowed',
    !/const MOTION_NEGATIVE_ALWAYS/.test(src) && !/const MOTION_PROMPT\s*=/.test(src))
  ok('the library is the single source — the page imports it',
    /from '@\/lib\/prompts\/library'/.test(raw))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
