// _verification/36-tabs.cjs
//
// The page had become a scroll: library, brand, review, compositions, prompts,
// timeline, voice, subtitles, music and delivery in one column, ordered by the
// sequence the features were built in rather than the order the work happens in.

const fs = require('fs')
const path = require('path')
const { stripComments } = require(path.join(__dirname, 'lib', 'source.cjs'))
const ROOT = path.join(__dirname, '..')
const raw = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'studio', 'page.tsx'), 'utf8')
const src = stripComments(raw)


let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const TABS = ['compune', 'aspect', 'sunet', 'livrare']

ok('there is a tab state', /const \[tab, setTab\] = useState</.test(src))
ok('...with exactly the four working modes',
  TABS.every(t => new RegExp(`'${t}'`).test(src)))
ok('every tab has a button', TABS.every(t => new RegExp(`\\['${t}',`).test(src)))
ok('...and every button explains itself', (src.match(/title=\{hint\}/g) || []).length === 1)
ok('the active tab is marked, not just remembered', /border-brand-red text-white/.test(src))

// Every panel must belong to a tab, or it becomes unreachable the moment tabs
// exist — the specific way a refactor like this loses a feature.
//
// COUNTED ON THE RAW FILE, DELIBERATELY. The comment-stripped copy is the right
// input when the question is "does this line of behaviour exist", because a
// commented-out line must not pass. It is the wrong input when the question is
// "how many of these are there": the block-comment regex is non-greedy across
// newlines, and a JSX comment sitting above a panel swallowed one of the eight
// guards. It reported 7 and the file had 8.
const guards = raw.match(/hidden=\{tab !== '(\w+)'\}/g) || []
ok('eight panels are assigned to tabs', guards.length === 8, String(guards.length))
for (const t of TABS) {
  ok(`the "${t}" tab has at least one panel`,
    guards.some(g => g.includes(`'${t}'`)), guards.join(' '))
}

// PANELS ARE HIDDEN, NOT UNMOUNTED. A half-typed prompt, a scroll position and
// an open composition must survive a trip to another tab, or these are four
// pages wearing the costume of tabs.
ok('panels hide rather than unmount', !/\{tab === '\w+' && \(/.test(src))
ok('the preview is outside the tabs — the film is the point of all four',
  src.indexOf('Previzualizare') > src.lastIndexOf("hidden={tab !== '"))

// The layout classes must not fight the hidden attribute: `display:flex` from a
// utility class overrides `[hidden]{display:none}` and the panel stays visible.
const hiddenLines = raw.split('\n').filter(l => /hidden=\{tab !== /.test(l))
ok('no hidden panel carries a display utility that would override it',
  hiddenLines.every(l => !/className="[^"]*\b(flex|grid|inline-block|block)\b/.test(l)),
  hiddenLines.find(l => /className="[^"]*\b(flex|grid)\b/.test(l)) || '')

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
