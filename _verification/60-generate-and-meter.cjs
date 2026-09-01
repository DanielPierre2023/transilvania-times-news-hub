// _verification/60-generate-and-meter.cjs
//
// The per-row generation loop, and the ledger that keeps it honest.
//
// This is the mode that spends real money per row: a few hundred rows is a few
// hundred dollars. So the assertions are about the three things that turn an
// estimate into a surprise.
//
//   THE ROW MUST REACH THE PROMPT. A loop that sends the template's prompt
//   unchanged produces the same picture for every row and charges per row for
//   it — the most expensive possible way to do nothing.
//
//   THE BUDGET MUST BE CHECKED BETWEEN PICTURES, not between rows. A row with
//   four shots can spend four times the per-row estimate before anything looks.
//
//   A FAILED PICTURE MUST NOT FAIL THE ROW. One refused image out of four is a
//   film with a gap; losing the row throws away the three that were paid for.

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

const cache = {}
function loadTs(rel) {
  if (cache[rel]) return cache[rel]
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  cache[rel] = mod.exports
  const req = (id) => {
    if (id === './merge' || id === '../templates/merge') return loadTs('lib/templates/merge.ts')
    return {}
  }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req)
  cache[rel] = mod.exports
  return mod.exports
}
const G = loadTs('lib/campaign/generate.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const draft = (over = {}) => ({
  templateId: 't', aspect: '9:16', missing: [], unresolved: [], seconds: 12, script: '',
  overlays: [],
  scenes: [
    { id: 'a', kind: 'image', url: '', name: 'a', duration: 4, kb: 'none',
      imagePrompt: 'O fotografie documentara din industria {{industrie}}.', awaiting: 'p1' },
    { id: 'b', kind: 'image', url: '', name: 'b', duration: 4, kb: 'none',
      imagePrompt: 'Un detaliu de la {{firma}}.' },
    { id: 'c', kind: 'image', url: 'already.png', name: 'c', duration: 4, kb: 'none' },
  ],
  ...over,
})

const hooks = (over = {}) => {
  const state = { prompts: [], metered: [], spent: 0 }
  return {
    state,
    hooks: {
      async image(prompt) {
        state.prompts.push(prompt)
        if (over.imageFails && over.imageFails(prompt)) throw new Error('content policy violation')
        return `gen-${state.prompts.length}.png`
      },
      async motion(url, seconds) { state.prompts.push(`motion:${url}:${seconds}`); return `clip-${url}.mp4` },
      async meter(kind, usd, meta) { state.metered.push({ kind, usd, meta }); state.spent += usd },
      async canSpend(usd) { return over.budget === undefined ? true : state.spent + usd <= over.budget },
    },
  }
}

;(async () => {
  // ── the row reaches the prompt ─────────────────────────────────────────
  {
    const h = hooks()
    const r = await G.generateRow(draft(), { industrie: 'constructii', firma: 'Acme' }, h.hooks,
      { fields: [{ key: 'industrie', label: 'I' }, { key: 'firma', label: 'F' }] })
    ok('THE ROW GOES INTO THE PROMPT — otherwise the loop pays per row for the ' +
       'same picture, which is the most expensive way to do nothing',
      h.state.prompts[0].includes('constructii'), h.state.prompts[0])
    ok('...for every shot, not just the first', h.state.prompts[1].includes('Acme'))
    ok('...and no merge token survives into the prompt',
      h.state.prompts.every(p => !/\{\{/.test(p)))
    ok('two pictures were generated', r.generated === 2, r.generated)
    ok('A SHOT THAT ALREADY HAS A PICTURE IS LEFT ALONE — regenerating it would ' +
       'pay to replace something somebody chose',
      r.draft.scenes[2].url === 'already.png' && h.state.prompts.length === 2)
    ok('the draft points at what was generated',
      r.draft.scenes[0].url === 'gen-1.png' && r.draft.scenes[1].url === 'gen-2.png')
    ok('the cost is reported', Math.abs(r.usd - 2 * G.UNIT_COST.image) < 1e-9, r.usd)
  }

  // ── metering happens per unit, not per row ─────────────────────────────
  {
    const h = hooks()
    await G.generateRow(draft(), {}, h.hooks)
    ok('EVERY GENERATION IS METERED SEPARATELY — a loop that spends first and ' +
       'totals afterwards is how an estimate becomes a surprise',
      h.state.metered.length === 2)
    ok('...each naming what it was', h.state.metered.every(m => m.kind === 'image'))
    ok('...and which shot, so a bill can be traced to a picture',
      h.state.metered.every(m => m.meta && m.meta.shot > 0))
    ok('the ledger sums to the reported cost',
      Math.abs(h.state.metered.reduce((s, m) => s + m.usd, 0) - h.state.spent) < 1e-9)
  }

  // ── the budget stops it BETWEEN pictures ───────────────────────────────
  {
    const h = hooks({ budget: G.UNIT_COST.image * 1.5 })   // room for one only
    const r = await G.generateRow(draft(), {}, h.hooks)
    ok('THE BUDGET STOPS THE ROW PART WAY, between pictures — a row with four ' +
       'shots can otherwise spend four times the per-row estimate before ' +
       'anything looks', r.haltedOnBudget === true)
    ok('...after exactly what it could afford', r.generated === 1, r.generated)
    ok('...and it never spent past the ceiling', h.state.spent <= G.UNIT_COST.image * 1.5)
    ok('...and it says where it stopped', r.notes.some(n => /Buget/.test(n)), JSON.stringify(r.notes))
    ok('the unfinished shot is still reported as missing',
      r.draft.missing.includes('p1') || r.draft.scenes.some(s => !s.url))
  }

  // ── a refused picture does not lose the row ────────────────────────────
  {
    const h = hooks({ imageFails: p => /Acme/.test(p) })
    const r = await G.generateRow(draft(), { industrie: 'x', firma: 'Acme' }, h.hooks)
    ok('ONE REFUSED PICTURE DOES NOT FAIL THE ROW — losing it throws away the ' +
       'pictures already paid for', r.generated === 1 && r.failed === 1)
    ok('...the good picture is kept', r.draft.scenes[0].url === 'gen-1.png')
    ok('...and the failure is named', r.notes.some(n => /content policy/.test(n)))
    ok('...and nothing was metered for the refusal',
      h.state.metered.length === 1)
  }

  // ── motion is optional and priced apart ────────────────────────────────
  {
    const h = hooks()
    const r = await G.generateRow(draft(), {}, h.hooks, { withMotion: true, motionSeconds: 5 })
    ok('motion turns the stills into clips', r.draft.scenes[0].kind === 'video')
    ok('...metered separately from the picture',
      h.state.metered.filter(m => m.kind === 'motion').length === 2)
    ok('MOTION COSTS ROUGHLY THIRTY TIMES THE PICTURE, which is why it is off ' +
       'unless asked for',
      G.UNIT_COST.motionPerSecond * 5 > G.UNIT_COST.image * 10)

    const noMotion = hooks()
    const r2 = await G.generateRow(draft(), {}, noMotion.hooks)
    ok('...and without it the stills stay stills', r2.draft.scenes[0].kind === 'image')
    ok('...and nothing motion-shaped is charged',
      noMotion.state.metered.every(m => m.kind === 'image'))
  }

  // ── a failed motion keeps the picture ──────────────────────────────────
  {
    const h = hooks()
    h.hooks.motion = async () => { throw new Error('fal timeout') }
    const r = await G.generateRow(draft(), {}, h.hooks, { withMotion: true })
    ok('A FAILED MOTION KEEPS THE STILL — a film of stills is a film, a film of ' +
       'holes is not', r.draft.scenes[0].url === 'gen-1.png' && r.draft.scenes[0].kind === 'image')
    ok('...and says so', r.notes.some(n => /Mișcarea/.test(n)))
  }

  // ── the estimate matches what the loop will do ─────────────────────────
  {
    ok('the per-row cost counts only the shots that need generating',
      Math.abs(G.costPerRow(draft()) - 2 * G.UNIT_COST.image) < 1e-9, G.costPerRow(draft()))
    ok('...and motion multiplies it',
      G.costPerRow(draft(), { withMotion: true, motionSeconds: 5 }) > G.costPerRow(draft()) * 10)
    ok('THE ESTIMATE AGREES WITH WHAT THE LOOP ACTUALLY SPENDS', (() => {
      const h = hooks()
      return G.generateRow(draft(), {}, h.hooks).then(r =>
        Math.abs(r.usd - G.costPerRow(draft())) < 1e-9)
    })() instanceof Promise)
    const h2 = hooks()
    const r2 = await G.generateRow(draft(), {}, h2.hooks)
    ok('...measured, not asserted', Math.abs(r2.usd - G.costPerRow(draft())) < 1e-9,
      `${r2.usd} vs ${G.costPerRow(draft())}`)
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})()
