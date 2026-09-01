// _verification/45-merge.cjs
//
// Merge fields for bulk campaigns.
//
// Every failure here is SILENT — a wrong film gets made and sent — so the
// assertions are about the three silent ones, not about whether replace works.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const load = (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
  return mod.exports
}
const M = load('lib/templates/merge.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── finding the fields ───────────────────────────────────────────────────
{
  ok('fields are found', M.fieldsUsed('Bună, {{prenume}} de la {{firma}}!').join(',') === 'prenume,firma')
  ok('whitespace inside the braces is tolerated', M.fieldsUsed('{{ prenume }}')[0] === 'prenume')
  ok('a repeated field is listed once', M.fieldsUsed('{{a}} {{a}}').length === 1)
  ok('text without fields yields none', M.fieldsUsed('salut').length === 0)
  ok('a single brace is not a field', M.fieldsUsed('{prenume}').length === 0)
}

// ── SILENT FAILURE 1: a misspelled field renders as itself ───────────────
{
  const r = M.substitute('Bună, {{prenmue}}', { prenume: 'Ana' })
  ok('AN UNKNOWN FIELD IS REPORTED, not silently emptied', r.unresolved.includes('prenmue'))
  ok('...and it is LEFT VISIBLE in the text, so it cannot be missed',
    r.text.includes('{{prenmue}}'), r.text)
  ok('a known field still substitutes normally',
    M.substitute('Bună, {{prenume}}', { prenume: 'Ana' }).text === 'Bună, Ana')
  ok('nothing is reported unresolved when everything resolves',
    M.substitute('{{a}}', { a: 'x' }).unresolved.length === 0)
}

// ── SILENT FAILURE 2: an empty cell is not a missing column ──────────────
{
  const fields = [{ key: 'firma', label: 'Firma', fallback: 'echipa ta' }]
  const r = M.substitute('pentru {{firma}}', { firma: '' }, fields)
  ok('AN EMPTY CELL TAKES THE FALLBACK', r.text === 'pentru echipa ta', r.text)
  ok('...and is NOT reported as unresolved — it is a real row', r.unresolved.length === 0)
  ok('an empty cell with no fallback becomes empty rather than the token',
    M.substitute('x{{f}}y', { f: '' }).text === 'xy')
  ok('A MISSING COLUMN AND AN EMPTY CELL ARE DIFFERENT STATES', (() => {
    const missing = M.substitute('{{f}}', {}, fields)
    const empty = M.substitute('{{f}}', { f: '' }, fields)
    return missing.unresolved.length === 1 && empty.unresolved.length === 0
  })())
}

// ── SILENT FAILURE 3: a long value breaks the layout ─────────────────────
{
  const fields = [{ key: 'firma', label: 'Firma', maxChars: 24 }]
  const rows = [
    { firma: 'Acme' },
    { firma: 'Întreprinderea Individuală de Construcții Metalice' },
  ]
  const issues = M.validateRows(rows, ['pentru {{firma}}'], fields)
  ok('A VALUE TOO LONG FOR ITS SLOT IS CAUGHT BEFORE THE CAMPAIGN RUNS',
    issues.length === 1 && issues[0].kind === 'tooLong')
  ok('...and the message names the row and both numbers',
    /Rândul 2/.test(issues[0].message) && /24/.test(issues[0].message), issues[0].message)
  ok('a value inside the budget is not flagged', !issues.some(i => i.row === 0))
}

// ── validation reports EVERY problem, not the first ──────────────────────
{
  const rows = [{ nume: '' }, { nume: '' }, { nume: 'Ana' }]
  const issues = M.validateRows(rows, ['{{nume}}'], [])
  ok('EVERY BAD ROW IS REPORTED IN ONE PASS — fixing a sheet one error at a ' +
     'time is how a hundred-row campaign takes an evening', issues.length === 2)
  ok('...and the good row is not among them', !issues.some(i => i.row === 2))
  ok('a missing column is reported for every row',
    M.validateRows([{}, {}], ['{{x}}'], []).filter(i => i.kind === 'unknown').length === 2)
  ok('a clean sheet produces no issues at all',
    M.validateRows([{ a: '1' }], ['{{a}}'], []).length === 0)
}

// ── declared transforms, and the fallback that must not be touched ──────
{
  const f = [{ key: 'nume', label: 'N', transform: 'firstName' },
             { key: 'firma', label: 'F', fallback: 'echipa ta', transform: 'name' }]
  ok('a declared firstName transform is applied',
    M.substitute('{{nume}}', { nume: 'ANA MARIA POP' }, f).text === 'Ana')
  ok('a declared name transform tidies a shouting export',
    M.substitute('{{firma}}', { firma: 'ACME SRL' }, f).text === 'Acme Srl')
  ok('A FALLBACK IS AUTHORED TEXT AND IS NEVER TRANSFORMED — otherwise the ' +
     'fallback "echipa ta" reaches the customer as "Echipa Ta"',
    M.substitute('{{firma}}', { firma: '' }, f).text === 'echipa ta',
    M.substitute('{{firma}}', { firma: '' }, f).text)
  ok('an UNDECLARED field is left exactly as typed — tidying everything would ' +
     'corrupt product codes',
    M.substitute('{{cod}}', { cod: 'XR-200b' }, f).text === 'XR-200b')
  ok('the length budget measures the TRANSFORMED value, not the raw cell',
    M.validateRows([{ nume: 'ANA MARIA POPESCU' }], ['{{nume}}'],
      [{ key: 'nume', label: 'N', transform: 'firstName', maxChars: 6 }]).length === 0)
}

// ── names arrive from spreadsheets in a state ────────────────────────────
{
  ok('an ALL CAPS name is tidied', M.tidyName('ANA-MARIA POP') === 'Ana-Maria Pop', M.tidyName('ANA-MARIA POP'))
  ok('an all-lowercase name is tidied', M.tidyName('ana pop') === 'Ana Pop')
  ok('A DELIBERATELY STYLED NAME IS LEFT ALONE — "van der Berg" is not a typo',
    M.tidyName('van der Berg') === 'van der Berg')
  ok('...and so is an acronym in a mixed-case value', M.tidyName('Firma IKEA SRL') === 'Firma IKEA SRL')
  ok('first name only, for a greeting', M.firstName('ANA MARIA POP') === 'Ana')
  ok('an empty name does not crash', M.firstName('') === '')
}

// ── parsing what people actually paste ───────────────────────────────────
{
  const tsv = M.parseRows('prenume\tfirma\nAna\tAcme\nBogdan\tBeta')
  ok('a paste from a spreadsheet is tab separated', tsv.rows.length === 2)
  ok('...with headers', tsv.headers.join(',') === 'prenume,firma')
  ok('...and values in the right columns', tsv.rows[1].firma === 'Beta')

  const csv = M.parseRows('prenume,firma\nAna,Acme')
  ok('a comma file works too', csv.rows[0].firma === 'Acme')

  const quoted = M.parseRows('prenume,firma\nAna,"Pop, Ionescu si Asociatii"')
  ok('A COMMA INSIDE A QUOTED COMPANY NAME IS NOT A NEW COLUMN — otherwise ' +
     'every value in the row shifts one place left',
    quoted.rows[0].firma === 'Pop, Ionescu si Asociatii', JSON.stringify(quoted.rows[0]))
  ok('...and the column before it is still right', quoted.rows[0].prenume === 'Ana')

  ok('blank lines are skipped', M.parseRows('a\n1\n\n2\n').rows.length === 2)
  ok('an empty paste yields nothing rather than throwing', M.parseRows('').rows.length === 0)
  ok('a header-only paste yields no rows', M.parseRows('a,b').rows.length === 0)
  ok('a short row does not lose its remaining columns',
    M.parseRows('a,b\n1').rows[0].b === '')
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
