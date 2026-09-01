// _verification/46-templates.cjs
//
// "Every film starts blank."
//
// A template library is easy to write and easy to write badly. The assertions
// worth having are not "there are twelve templates" but the ones that catch a
// library that would waste somebody's afternoon:
//
//   A TEMPLATE THAT CANNOT BE FILLED IN. A slot referenced by a beat but never
//   declared is invisible in the interface, so the film can never be completed
//   and nothing says why.
//   A TEMPLATE THAT LIES ABOUT ITS LENGTH. The advertised duration has to be
//   the sum of its beats, or a "15 second ad" is 19 seconds and gets rejected
//   by the ad platform after it is made.
//   A BULK TEMPLATE WHOSE MERGE FIELDS ARE NOT DECLARED. The campaign then
//   fails per row, at spend time, rather than once, before it starts.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))
const cache = {}
function load(rel) {
  if (cache[rel]) return cache[rel]
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = { exports: {} }
  const req = (id) => {
    if (id === './merge') return load('lib/templates/merge.ts')
    if (id === './library') return load('lib/templates/library.ts')
    return require(id)
  }
  cache[rel] = mod.exports
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req)
  cache[rel] = mod.exports
  return mod.exports
}
const L = load('lib/templates/library.ts')
const B = load('lib/templates/build.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

// ── the library covers what was asked for ────────────────────────────────
{
  const cats = new Set(L.TEMPLATES.map(t => t.category))
  ok('every category asked for exists',
    ['sales', 'ads', 'marketing', 'general', 'podcast'].every(c => cats.has(c)),
    [...cats].join(','))
  ok('there are enough templates to choose from', L.TEMPLATES.length >= 10, L.TEMPLATES.length)
  ok('every category has a human label', [...cats].every(c => L.CATEGORY_LABEL[c]))
  ok('ids are unique', new Set(L.TEMPLATES.map(t => t.id)).size === L.TEMPLATES.length)
  ok('lookup by id works', L.byId('ad-bumper') && L.byId('ad-bumper').category === 'ads')
  ok('an unknown id returns nothing rather than throwing', L.byId('nope') === undefined)
  ok('podcast templates cover the three real jobs — episode, vertical clip, audiogram',
    L.byCategory('podcast').length >= 3)
}

// ── every template is actually usable ────────────────────────────────────
{
  for (const t of L.TEMPLATES) {
    const slots = new Set(t.slots.map(s => s.key))
    const referenced = new Set()
    for (const b of t.beats) {
      if (b.pictureSlot) referenced.add(b.pictureSlot)
      if (b.title) referenced.add(b.title.slot)
    }
    const undeclared = [...referenced].filter(k => !slots.has(k))
    ok(`${t.id}: EVERY SLOT A BEAT USES IS DECLARED — an undeclared slot can ` +
       `never be filled in`, undeclared.length === 0, undeclared.join(','))
    ok(`${t.id}: every beat says what it is FOR`, t.beats.every(b => b.job && b.job.length > 10))
    ok(`${t.id}: every beat has a real duration`, t.beats.every(b => b.seconds > 0.5))
    ok(`${t.id}: every slot has a hint, not just a label`,
      t.slots.every(s => s.hint && s.hint.length > 8))
    ok(`${t.id}: the note says WHEN to use it, not what is in it`, t.note.length > 40)
    ok(`${t.id}: a beat with no picture slot has its own prompt`,
      t.beats.every(b => b.pictureSlot || b.prompt))
    ok(`${t.id}: no transition on the first beat, where there is nothing to come from`,
      !t.beats[0].transition)
    ok(`${t.id}: text slots that hold a headline declare a length budget`,
      t.slots.filter(s => s.kind === 'text').every(s => typeof s.maxChars === 'number'))
  }
}

// ── a template that lies about its length ────────────────────────────────
{
  const bumper = L.byId('ad-bumper')
  ok('THE 6-SECOND BUMPER REALLY IS 6 SECONDS', L.seconds(bumper) === 6, L.seconds(bumper))
  const ad15 = L.byId('ad-15-cta')
  ok('THE 15-SECOND AD REALLY IS 15 SECONDS', L.seconds(ad15) === 15, L.seconds(ad15))
  ok('the 30s launch really is 30', L.seconds(L.byId('mk-launch')) === 30, L.seconds(L.byId('mk-launch')))
  ok('the 60s explainer really is 60', L.seconds(L.byId('gen-explainer')) === 60, L.seconds(L.byId('gen-explainer')))
}

// ── building a draft ─────────────────────────────────────────────────────
{
  const t = L.byId('ad-bumper')
  const empty = B.buildDraft(t)
  ok('an unfilled template still builds a complete film structure',
    empty.scenes.length === t.beats.length)
  ok('...and reports exactly which slots it is waiting for',
    empty.missing.includes('gand'), empty.missing.join(','))
  ok('...and is NOT complete', !B.isComplete(empty))
  ok('every scene carries the job of its beat, so the note survives into the project',
    empty.scenes.every(s => s.job && s.job.length > 10))

  const filled = B.buildDraft(t, { gand: 'Trei zile devin patru ore.', imagine: 'https://x/i.png' })
  ok('a filled template is complete', B.isComplete(filled), filled.missing.join(','))
  ok('...and the text becomes an overlay', filled.overlays.some(o => /patru ore/.test(o.a)))
  ok('...and the picture lands on the right scene', filled.scenes[0].url === 'https://x/i.png')
  ok('the draft duration matches the template', filled.seconds === L.seconds(t))
  ok('a video url makes a video scene, not an image',
    B.buildDraft(t, { gand: 'x', imagine: 'https://x/a.mp4' }).scenes[0].kind === 'video')
}

// ── an overlay must not read as a burned-in caption ──────────────────────
{
  const t = L.byId('mk-launch')
  const d = B.buildDraft(t, { nume: 'Aurora', promisiune: 'Se montează într-o oră.', produs: 'p.png', context: 'c.png' })
  const long = d.overlays.find(o => o.a === 'Aurora')
  ok('A TITLE OVER A LONG SHOT COMES UP LATE AND LEAVES EARLY — otherwise it ' +
     'reads as burned into the shot rather than as a title',
    long && long.dur < 7 && long.at % 1 !== 0, long && `${long.at}/${long.dur}`)
  const shortT = L.byId('ad-15-cta')
  const shortB = B.buildDraft(shortT, { carlig: 'x', oferta: 'y', cta: 'z', produs: 'p.png' })
  ok('...but on a SHORT beat it simply holds, because there is no room to be clever',
    shortB.overlays[0].at === 0 && shortB.overlays[0].dur === shortT.beats[0].seconds,
    `${shortB.overlays[0].at}/${shortB.overlays[0].dur} vs beat ${shortT.beats[0].seconds}`)
  ok('every overlay ends inside the film', d.overlays.every(o => o.at + o.dur <= d.seconds + 0.01))
  ok('no overlay starts before the film does', d.overlays.every(o => o.at >= 0))
}

// ── bulk: the campaign path ──────────────────────────────────────────────
{
  const t = L.byId('sales-outreach')
  ok('the outreach template is marked for bulk', t.bulk === true)
  ok('...and DECLARES its merge fields, so a campaign fails once rather than per row',
    Array.isArray(t.merge) && t.merge.length >= 2)
  ok('every field the script uses is declared', (() => {
    const M = load('lib/templates/merge.ts')
    const used = M.fieldsUsed(t.script)
    return used.every(u => t.merge.some(f => f.key === u))
  })(), t.script)

  const values = { vorbitor: 'a.png', oferta: 'Montaj în patru ore.', cta: 'Vorbim?' }
  const rows = [
    { prenume: 'ana', firma: 'Acme', motiv: 'linia nouă' },
    { prenume: 'BOGDAN', firma: '', motiv: '' },
  ]
  const c = B.buildCampaign(t, values, rows)
  ok('one draft per row', c.drafts.length === 2)
  ok('the name really is substituted', /Ana/.test(c.drafts[0].script), c.drafts[0].script)
  ok('A SHOUTING SPREADSHEET IS TIDIED — "BOGDAN" from a CRM export must not ' +
     'reach a customer as "Bună, BOGDAN"',
    /Bogdan/.test(c.drafts[1].script) && !/BOGDAN/.test(c.drafts[1].script), c.drafts[1].script)
  ok('...and only where the template DECLARED it — tidying every field would ' +
     'corrupt product codes and slogans',
    L.byId('sales-outreach').merge.some(f => !f.transform))
  ok('AN EMPTY CELL TAKES ITS FALLBACK rather than leaving a hole',
    /echipa ta/.test(c.drafts[1].script), c.drafts[1].script)
  ok('nothing is left unresolved when the columns are all present',
    c.drafts.every(d => d.unresolved.length === 0))

  const bad = B.buildCampaign(t, values, [{ prenume: 'Ana' }])
  ok('A MISSING COLUMN IS REPORTED ON THE DRAFT, not silently emptied',
    bad.drafts[0].unresolved.length > 0, bad.drafts[0].script)
  ok('...and such a draft is not complete', !B.isComplete(bad.drafts[0]))
}

// ── the spend cap lives in the function, not in a button ─────────────────
{
  const t = L.byId('sales-outreach')
  const many = Array.from({ length: B.MAX_ROWS + 40 }, (_, i) => ({ prenume: 'A' + i, firma: 'F', motiv: 'm' }))
  const c = B.buildCampaign(t, { vorbitor: 'a.png', oferta: 'o', cta: 'c' }, many)
  ok('THE CAP IS ENFORCED IN THE PURE FUNCTION — a cap that lives in a button ' +
     'is a cap an API call skips', c.drafts.length === B.MAX_ROWS)
  ok('...and it says how many it left out', c.skipped === 40, c.skipped)
  ok('a normal-sized campaign skips nothing',
    B.buildCampaign(t, {}, many.slice(0, 3)).skipped === 0)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
