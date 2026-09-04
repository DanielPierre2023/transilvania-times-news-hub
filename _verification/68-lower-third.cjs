// _verification/68-lower-third.cjs
//
// THE HEADLINE THAT WENT OUT AS "Lucrările de modernizare a străzii Pet".
//
// Thirty-eight characters, ending mid-word, with half the bar empty beside it.
// Two causes, and they are the same mistake wearing different clothes:
//
//   THE PROMPT ASKED FOR "max 38 caractere". A model given a character limit
//   obeys it literally, so when the headline it wants to write is longer, it
//   amputates a word. The limit was not tight — it was smaller than ONE LINE of
//   the bar it feeds, by a factor of three, and nothing recorded why.
//
//   THE GUARD WAS `.slice(0, 44)`. A slice cuts at a code unit. It cannot tell
//   the middle of a word from the end of one, so anything that overshoots comes
//   out looking exactly like the frame above.
//
// SO THIS SUITE MEASURES THE BAR INSTEAD OF TRUSTING A NUMBER.
//
// It draws with node-canvas at the renderer's own geometry — 1280 wide, 46px
// margins, 34px serif, wrapping to two lines — and asserts that the configured
// limit fits. If someone narrows the bar or grows the font, this goes red
// before a headline is cut on air.
//
// It also runs the app's copy of `truncateWords` and the edge function's copy
// over the same inputs and requires identical answers. Two runtimes genuinely
// cannot share a module here; what they can share is a check that fails the
// moment they disagree.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const T = require(path.join(ROOT, 'render-worker', 'dist', 'text', 'truncate.js'))

// ── the two copies must agree ────────────────────────────────────────────
//
// The Deno file is TypeScript with no imports, so it is turned into something
// runnable here by stripping the type annotations it uses. Crude on purpose:
// if that ever stops working the suite fails loudly instead of quietly testing
// one implementation twice.
// The Deno copy is INLINED in the edge function (a single-file paste into the
// Supabase dashboard cannot resolve a brand-new _shared import — that is the
// deploy error this markering was born from). It lives between TT_TRUNCATE
// markers so this suite can lift exactly that block and check it against the
// app copy.
const anchorSrc = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'newsroom-anchor', 'index.ts'), 'utf8')
const between = anchorSrc.split('>>> TT_TRUNCATE')[1]
// Drop the remainder of the marker line (everything up to its newline), then
// take the code up to the closing marker.
const denoSrc = between
  ? between.slice(between.indexOf('\n') + 1).split('<<< TT_TRUNCATE')[0]
  : ''
ok('the inlined Deno copy was found between its markers', denoSrc.length > 40,
  'the TT_TRUNCATE markers are gone — the function may have been reformatted')

const denoJs = denoSrc
  .replace(/\/\/[^\n]*/g, '')            // drop line comments, incl. the marker tails
  .replace(/:\s*string(\[\])?/g, '')
  .replace(/:\s*number/g, '')
const deno = (() => {
  const module = { exports: {} }
  new Function('module', 'exports', denoJs + '\nmodule.exports = { truncateWords, LOWER_THIRD_MAX }')(
    module, module.exports)
  return module.exports
})()

ok('the Deno copy was loadable', typeof deno.truncateWords === 'function')
ok('...and declares the same limit', deno.LOWER_THIRD_MAX === T.LOWER_THIRD_MAX,
  `${deno.LOWER_THIRD_MAX} vs ${T.LOWER_THIRD_MAX}`)

{
  const cases = [
    ['Lucrările de modernizare a străzii Petőfi Sándor continuă în cartierul Oprișani', 70],
    ['Seceta scoate la iveală resturi în râul Crișul Repede din Oradea', 70],
    ['Scurt', 70],
    ['', 70],
    ['   spații   multiple   peste tot   ', 70],
    ['Exact-șaptezeci-de-caractere-fără-niciun-spațiu-în-el-deloc-abcdefghij', 70],
    ['unCuvântFoarteFoarteFoarteLungCareNuAreNiciUnSpațiuÎnElNicăieriDeloc', 20],
    ['Titlu, cu virgulă chiar la limita de tăiere aici', 30],
    ['a b c d e f g h i j k l m n o p q r s t u v w x y z', 11],
    ['Două cuvinte', 5],
  ]
  let same = true
  for (const [text, max] of cases) {
    for (const ell of ['', '…']) {
      const a = T.truncateWords(text, max, ell)
      const b = deno.truncateWords(text, max, ell)
      if (a !== b) { same = false; console.log('  DIVERGED:', JSON.stringify({ text, max, ell, app: a, deno: b })) }
    }
  }
  ok('THE APP AND THE EDGE FUNCTION GIVE IDENTICAL ANSWERS', same)
}

// ── truncateWords itself ─────────────────────────────────────────────────
{
  const long = 'Lucrările de modernizare a străzii Petőfi Sándor continuă în cartierul Oprișani'

  ok('a title that fits is returned untouched',
    T.truncateWords('Scurt și clar', 70) === 'Scurt și clar')
  ok('...with no ellipsis added', !T.truncateWords('Scurt', 70).includes('…'))

  const cut = T.truncateWords(long, 70)
  ok('a long title is shortened', cut.length <= 70, `${cut.length}: ${cut}`)
  ok('IT NEVER ENDS MID-WORD — the whole point',
    long.startsWith(cut) && (long[cut.length] === ' ' || long.length === cut.length),
    JSON.stringify(cut))
  ok('...and the original still begins with it', long.startsWith(cut))

  // The exact shape of the bug, as an assertion.
  const amputated = 'Lucrările de modernizare a străzii Petőfi Sándor'.slice(0, 38)
  ok('a hard slice DOES produce the broken headline', amputated === 'Lucrările de modernizare a străzii Pet',
    amputated)
  ok('...and truncateWords at the same limit does not',
    T.truncateWords('Lucrările de modernizare a străzii Petőfi Sándor', 38) ===
      'Lucrările de modernizare a străzii', T.truncateWords('Lucrările de modernizare a străzii Petőfi Sándor', 38))

  ok('a dangling comma is removed with the words after it',
    !/[,;:]$/.test(T.truncateWords('Primăria Turda, prin hotărârea de ieri, a decis', 20)),
    T.truncateWords('Primăria Turda, prin hotărârea de ieri, a decis', 20))
  ok('a dangling dash is removed too',
    !/[-–—]$/.test(T.truncateWords('Bugetul local — aprobat ieri de consiliu', 15)),
    T.truncateWords('Bugetul local — aprobat ieri de consiliu', 15))

  ok('an ellipsis fits INSIDE the limit rather than pushing past it',
    T.truncateWords(long, 40, '…').length <= 40, T.truncateWords(long, 40, '…'))
  ok('...and is actually appended', T.truncateWords(long, 40, '…').endsWith('…'))

  ok('empty text is empty, not a crash', T.truncateWords('', 70) === '')
  ok('null does not throw', T.truncateWords(null, 70) === '')
  ok('whitespace is collapsed', T.truncateWords('  a   b  ', 70) === 'a b')

  // The one case with no good answer, stated rather than hidden.
  const oneWord = 'unCuvântFoarteLungCareNuAreSpații'
  ok('a single word longer than the limit is cut hard, because a maximum is a maximum',
    T.truncateWords(oneWord, 10).length === 10, T.truncateWords(oneWord, 10))

  ok('the limit is never exceeded, for any input', (() => {
    let r = 3
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648 }
    const words = ['Primăria', 'a', 'anunțat', 'modernizarea', 'străzii', 'Petőfi', 'în', 'Turda', 'astăzi']
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 14)
      const text = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ')
      const max = 5 + Math.floor(rnd() * 70)
      for (const ell of ['', '…']) {
        if (T.truncateWords(text, max, ell).length > max) return false
      }
    }
    return true
  })())

  ok('...and a result that was shortened never ends inside a word', (() => {
    let r = 11
    const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648 }
    const words = ['Consiliul', 'Local', 'Turda', 'a', 'aprobat', 'bugetul', 'pentru', 'reabilitarea', 'termică']
    for (let i = 0; i < 500; i++) {
      const n = 2 + Math.floor(rnd() * 12)
      const text = Array.from({ length: n }, () => words[Math.floor(rnd() * words.length)]).join(' ')
      const max = 12 + Math.floor(rnd() * 60)
      const out = T.truncateWords(text, max)
      if (out === text) continue
      // Whatever survived must be a whole-word prefix of the original.
      if (!text.startsWith(out)) return false
      const next = text[out.length]
      if (next !== undefined && next !== ' ' && !/[\s,;:–—-]/.test(text[out.length - 1] || '')) {
        // allow the dangling-punctuation trim to have removed a character
        if (!text.startsWith(out + ' ') && !/[,;:–—-]/.test(text[out.length])) return false
      }
    }
    return true
  })())
}

// ── THE LIMIT FITS THE BAR IT IS FOR ─────────────────────────────────────
let canvas = null
try { canvas = require(path.join(ROOT, 'render-worker', 'node_modules', 'canvas')) }
catch { try { canvas = require('canvas') } catch { canvas = null } }

if (!canvas) {
  const strict = process.argv.includes('--strict')
  console.log(strict ? '  FAIL: node-canvas is required and missing' : '  (bar measurement skipped: no node-canvas)')
  if (strict) fail++
} else {
  // The renderer's own geometry, read from the page rather than retyped, so a
  // change there fails this instead of silently invalidating it.
  const page = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'newsroom', 'page.tsx'), 'utf8')
  const marginX = Number((page.match(/const marginX = isWide \? (\d+)/) || [])[1])
  // Anchored on the Lora serif line specifically: the page sets ctx.font a
  // dozen times and the first match was an 11px sans-serif label.
  const fontPx = Number(
    (page.match(/ctx\.font = `700 \$\{isWide \? (\d+) : \d+\}px Lora/) || [])[1])
  const pad = Number((page.match(/wrapText\(ctx, cur\?\.title \|\| '', barW - (\d+)\)/) || [])[1])
  const maxLines = Number((page.match(/allLines\.slice\(0, (\d+)\)/) || [])[1])

  ok('the margin was read from the page', marginX === 46, String(marginX))
  ok('the headline font size was read from the page', fontPx === 34, String(fontPx))
  ok('the bar padding was read from the page', pad === 60, String(pad))
  ok('the line clamp was read from the page', maxLines === 2, String(maxLines))

  const W = 1280
  const maxW = W - marginX * 2 - pad
  const ctx = canvas.createCanvas(W, 720).getContext('2d')
  ctx.font = `700 ${fontPx}px Georgia, serif`

  const wrap = (text) => {
    const words = String(text).split(' '); const lines = []; let line = ''
    for (const w of words) {
      const t = line ? line + ' ' + w : w
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t
    }
    if (line) lines.push(line)
    return lines
  }

  // Real Romanian headlines at the configured limit must fit the clamp.
  const HEADLINES = [
    'Lucrările de modernizare a străzii Petőfi Sándor continuă',
    'Seceta scoate la iveală resturi în râul Crișul Repede din Oradea',
    'Elevii din familii defavorizate pot primi 500 de lei pentru rechizite',
    'Consiliul Local a aprobat bugetul pentru reabilitarea termică a blocurilor',
    'Spitalul Municipal Turda primește aparatură nouă de radiologie',
    'Circulația pe DN1 este restricționată între Turda și Cluj-Napoca',
  ]
  let worst = 0, worstText = ''
  for (const h of HEADLINES) {
    const shortened = T.truncateWords(h, T.LOWER_THIRD_MAX)
    const n = wrap(shortened).length
    if (n > worst) { worst = n; worstText = shortened }
  }
  ok(`EVERY REAL HEADLINE FITS THE ${maxLines}-LINE BAR at the configured limit`,
    worst <= maxLines, `${worst} lines needed for ${JSON.stringify(worstText)}`)

  // The limit must not be absurdly under capacity either — that is what caused
  // the bug, and a number nobody re-derives drifts back down.
  const capacity = (() => {
    // Longest string of real words that still wraps to `maxLines`.
    const filler = ('Lucrările de modernizare a străzii Petőfi Sándor continuă în cartierul ' +
      'Oprișani până la sfârșitul lunii octombrie anul acesta și mai departe').split(' ')
    let best = ''
    for (let i = 1; i <= filler.length; i++) {
      const t = filler.slice(0, i).join(' ')
      if (wrap(t).length <= maxLines) best = t; else break
    }
    return best.length
  })()
  console.log(`  (measured: one line ≈ ${wrap(HEADLINES[0]).length === 1 ? HEADLINES[0].length : '?'} chars, ` +
    `${maxLines} lines ≈ ${capacity} chars, limit is ${T.LOWER_THIRD_MAX})`)

  ok('the limit is not larger than the bar can hold', T.LOWER_THIRD_MAX <= capacity,
    `limit ${T.LOWER_THIRD_MAX} > capacity ${capacity}`)
  ok('THE LIMIT IS NOT ABSURDLY SMALL EITHER — 38 was a third of one line, ' +
     'which is what forced the model to cut a word',
    T.LOWER_THIRD_MAX >= capacity * 0.4,
    `limit ${T.LOWER_THIRD_MAX} against capacity ${capacity}`)
}

// ── nothing may go back to a hard slice ──────────────────────────────────
{
  const anchor = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'newsroom-anchor', 'index.ts'), 'utf8')
  const code = anchor.split('\n').map(l => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n')

  ok('the anchor function no longer slices a lower-third',
    !/lower_third[^\n]{0,80}\.slice\(0,\s*\d+\)/.test(code), 'a hard slice is back')
  ok('...and uses the word-safe helper instead', /truncateWords\(/.test(code))
  ok('...defined inline, so a single-file paste deploys without a missing module',
    /function truncateWords/.test(code) && !/import[^\n]*_shared\/text/.test(code),
    'it imports _shared/text.ts — a single-file dashboard paste cannot resolve that')
  ok('the fallback label is word-safe too',
    /fallbackLabel[\s\S]{0,200}truncateWords\(/.test(code))
  ok('NO PROMPT ASKS FOR 38 CHARACTERS ANY MORE', !/max(im|imum)? 38|38 (de )?characters|38 de caractere/i.test(code),
    'a prompt still carries the limit that caused this')
  ok('...and both prompts tell the model to end on a whole word',
    (code.match(/CUVÂNT ÎNTREG|CUVANT INTREG|WHOLE WORD/gi) || []).length >= 4,
    'a prompt still lets the model amputate')

  const page = fs.readFileSync(path.join(ROOT, 'app', 'admin', 'newsroom', 'page.tsx'), 'utf8')
  // THE IN-SYNC BRANCH — the one the failing bulletin actually used. It passed
  // the edge function's `lower_third` straight to the screen; when that came
  // back as a spoken sentence sliced at 38, the fragment WAS the headline. This
  // asserts the branch no longer trusts the raw label.
  ok('the in-sync headline is derived word-safe, not passed through raw',
    /const headline = truncateWords\(chosen, LOWER_THIRD_MAX\)/.test(page),
    'the in-sync branch still renders st.lower_third untouched')
  ok('...and a label that is a prefix of the spoken text is treated as a fragment',
    /labelIsSpokenFragment = label\.length > 0 && say\.startsWith/.test(page))
  ok('...preferring the article\'s own headline when a story is matched',
    /articleTitle \|\| \(st\.text/.test(page))
  ok('...and NO branch renders a bare st.lower_third any more',
    !/title: st\.lower_third \|\|/.test(page),
    'a raw lower_third is still going to the screen somewhere')
  ok('the page fallback title is word-safe',
    /title: truncateWords\(/.test(page), 'still slicing an article title')
  ok('the renderer marks a headline it had to shorten rather than dropping it',
    /allLines\.length > 2/.test(page))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
