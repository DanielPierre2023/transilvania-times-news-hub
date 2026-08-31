// _verification/24-motion-direction.cjs
//
// Two faults found by animating one real shot.
//
// 1. THE GRADE-HOLD WAS A TRAP FOR HALF OF ALL SHOTS.
//    A past failure — a golden-hour still returned as cold blue night — was
//    fixed by banning `blue hour, twilight, dusk` and `cold colour grade, blue
//    cast, teal tint` in the negative prompt. For every shot. Forever.
//    Then shot 1 of this film became a mechanic opening a shutter onto a blue
//    pre-dawn yard, and we were about to tell the model that everything the
//    picture is made of is a defect. Measured on the take that came back: the
//    warm practical lamp lost 26.7 points of warmth across five seconds while
//    the frame gained 13 points of luma — the warm/cold contrast the shot is
//    built on, flattening.
//
// 2. ONE GLOBAL MOTION PROMPT IS A STORYBOARD WITH ONE FRAME IN IT.
//    "Drifting haze, moving leaves, people walking softly" says nothing about a
//    shutter going up or a light being switched off — which is to say nothing
//    about the two shots carrying the first two lines of this film.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// Pull the three lists out of the source and reason about them for real.
const listOf = (name) => {
  const m = src.match(new RegExp(name + '\\s*=\\s*\\[([\\s\\S]*?)\\]'))
  if (!m) return null
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}
const always = listOf('MOTION_NEGATIVE_ALWAYS')
const warm = listOf('MOTION_NEGATIVE_KEEP_WARM')
const cold = listOf('MOTION_NEGATIVE_KEEP_COLD')

{
  ok('the negative is split into always / keep-warm / keep-cold', always && warm && cold)
  const j = a => (a || []).join(' ')
  ok('the always-list is about artefacts, not about light',
    !/blue hour|twilight|dusk|cold colour|teal|golden hour/.test(j(always)), j(always))
  ok('...and it still forbids the things that are always wrong',
    /watermark/.test(j(always)) && /identity change/.test(j(always)) && /cut/.test(j(always)))
  ok('keep-warm is where the time-of-day ban went', /blue hour/.test(j(warm)) && /teal tint/.test(j(warm)))
  ok('keep-cold defends a cold shot in the other direction',
    /golden hour/.test(j(cold)) && /warm orange/.test(j(cold)))
  ok('the two holds genuinely oppose each other',
    /blue/.test(j(warm)) && !/blue/.test(j(cold)) && /golden|warm/.test(j(cold)))
}

// A cold shot must never be sent the warm-holding terms. That is the whole bug.
{
  const fn = src.match(/function motionNegativeFor[\s\S]*?\n}/)
  ok('there is a function that picks the hold', !!fn)
  const body = fn ? fn[0] : ''
  ok("a 'cold' shot gets the cold hold", /'cold' \? MOTION_NEGATIVE_KEEP_COLD/.test(body))
  ok("a 'none' shot gets no hold at all", /'none' \? \[\]/.test(body))
  ok('every shot still gets the always-list', /MOTION_NEGATIVE_ALWAYS/.test(body))
  ok('the warm hold is no longer unconditional in the sent value',
    !/negative_prompt: MOTION_NEGATIVE\b/.test(src))
}

// Per-shot direction
{
  ok('a scene can carry its own motion prompt', /motionPrompt\?: string/.test(src))
  ok('...and declare which way its light runs', /look\?: SceneLook/.test(src))
  ok('the job sends the shot prompt, not the global one', /prompt: motionPromptFor\(sc\)/.test(src))
  ok('...and the negative chosen for that shot', /negative_prompt: motionNegativeFor\(/.test(src))
  const f = (src.match(/function motionPromptFor[\s\S]*?\n}/) || [''])[0]
  ok('an empty per-shot prompt falls back to the default', /own \|\| MOTION_PROMPT/.test(f))
  ok('the grade instruction is appended in the right direction', /same \$\{look\} lighting/.test(f))
  ok('the default prompt no longer hard-codes "warm"',
    !/same warm\s*'\s*\+/.test(src) && !/same warm lighting/.test((src.match(/const MOTION_PROMPT[\s\S]*?\n\n/)||[''])[0]))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
