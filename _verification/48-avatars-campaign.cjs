// _verification/48-avatars-campaign.cjs
//
// Two features that only matter at scale, and fail expensively at scale.
//
// AVATARS. The old presenter was a description, not a person: generated fresh
// each time, so two films a month apart had two different women in the same
// job. The fix is two mechanisms with genuinely different guarantees, and the
// assertion that matters is that the tool SAYS WHICH — a team shipping a
// thousand videos must know whether the face is identical or merely close.
//
// CAMPAIGNS. This is the only loop in the Studio that spends money per
// iteration. The assertions are about the cap being real, the estimate being
// honest, and a half-finished run being resumable without paying twice.

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
  cache[rel] = mod.exports
  const req = (id) => {
    if (id === './merge') return load('lib/templates/merge.ts')
    if (id === './library') return load('lib/templates/library.ts')
    return require(id)
  }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req)
  cache[rel] = mod.exports
  return mod.exports
}
const A = load('lib/avatars/index.ts')
const C = load('lib/templates/campaign.ts')
const L = load('lib/templates/library.ts')
const B = load('lib/templates/build.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const avatar = (over = {}) => ({
  id: 'a1', name: 'Ioana Mureșan',
  heroUrl: 'https://x/hero.png',
  referenceUrls: ['https://x/r1.png', 'https://x/r2.png', 'https://x/r3.png'],
  basePrompt: 'A fictional Romanian presenter...',
  voiceId: 'v1', voiceProvider: 'elevenlabs',
  ...over,
})

// ── the two mechanisms differ IN KIND, and say so ────────────────────────
{
  const a = avatar()
  const hero = A.shotSpec(a, 'hero')
  const ref = A.shotSpec(a, 'reference')

  ok('hero mode uses the exact saved photograph', hero.heroUrl === a.heroUrl)
  ok('...and says the face CANNOT vary, because it is the same pixels',
    /[Ii]dentic/.test(hero.identityNote), hero.identityNote)
  ok('...and admits the real limit: one framing, one outfit, one background',
    /încadrarea|fixe/.test(hero.identityNote))

  ok('reference mode conditions on the saved photographs',
    ref.referenceUrls.length === 4 && ref.referenceUrls[0] === a.heroUrl)
  ok('THE HERO IS INCLUDED AS A REFERENCE — leaving out the best likeness of ' +
     'the person would be a strange way to describe them',
    ref.referenceUrls.includes(a.heroUrl))
  ok('...and it does NOT claim to be identical',
    /nu garantat identic|apropiat/.test(ref.identityNote), ref.identityNote)
  ok('THE TWO NOTES ARE DIFFERENT — the difference is the whole point',
    hero.identityNote !== ref.identityNote)
  ok('reference mode carries the base description forward, so the person ' +
     'stays described the same way', /fictional Romanian/.test(ref.prompt))

  ok('references are capped at what the model actually accepts', (() => {
    const many = avatar({ referenceUrls: Array.from({ length: 40 }, (_, i) => 'u' + i) })
    return A.shotSpec(many, 'reference').referenceUrls.length === A.MAX_REFERENCES
  })())
  ok('duplicate references are not sent twice', (() => {
    const dup = avatar({ referenceUrls: ['https://x/r1.png', 'https://x/r1.png'] })
    return A.shotSpec(dup, 'reference').referenceUrls.length === 2
  })())
}

// ── what is wrong with an avatar, before a hundred films use it ──────────
{
  ok('a good avatar has no errors', A.checkAvatar(avatar()).every(i => i.level !== 'error'))
  ok('AN AVATAR WITH NO SAVED FRAME IS AN ERROR — it is a description, not a person',
    A.checkAvatar(avatar({ heroUrl: '' })).some(i => i.level === 'error'))
  ok('a nameless avatar is an error', A.checkAvatar(avatar({ name: ' ' })).some(i => i.level === 'error'))
  ok('TOO FEW REFERENCES IS A WARNING, NOT AN ERROR — it works, and it will ' +
     'produce a visibly different face each time, which is worth saying',
    A.checkAvatar(avatar({ referenceUrls: [] })).some(i => i.level === 'warning'))
  ok('...and the warning explains that the fixed frame is still exact',
    /fix/.test(A.checkAvatar(avatar({ referenceUrls: [] })).find(i => i.level === 'warning').message))
  ok('no fixed voice is a warning — one person with two voices is two people',
    A.checkAvatar(avatar({ voiceId: undefined })).some(i => /voce|voci/i.test(i.message)))
  ok('more references than the model reads is flagged rather than silently ignored',
    A.checkAvatar(avatar({ referenceUrls: Array.from({ length: 30 }, (_, i) => 'u' + i) }))
      .some(i => /ignor/.test(i.message)))
}

// ── the advice that matters for a campaign ───────────────────────────────
{
  ok('REFERENCE MODE ACROSS A BIG LIST IS WARNED ABOUT — hundreds of slightly ' +
     'different faces reads as carelessness exactly where personalisation is ' +
     'supposed to read as care',
    A.campaignAdvice(avatar(), 'reference', 200).some(i => i.level === 'warning'))
  ok('...and the warning names the number of films', 
    /200/.test(A.campaignAdvice(avatar(), 'reference', 200).find(i => i.level === 'warning').message))
  ok('hero mode across a big list is fine', A.campaignAdvice(avatar(), 'hero', 500).length === 0)
  ok('a handful of reference-mode films is fine',
    A.campaignAdvice(avatar(), 'reference', 5).length === 0)
  ok('hero mode with no saved frame is an error, not a warning',
    A.campaignAdvice(avatar({ heroUrl: '' }), 'hero', 10).some(i => i.level === 'error'))
}

// ── the three modes are priced APART ─────────────────────────────────────
{
  const t = L.byId('sales-outreach')
  const cheap = C.estimateCampaign(t, 'textOnly', 500, { scriptChars: 90 })
  const spoken = C.estimateCampaign(t, 'spokenName', 500, { scriptChars: 90 })
  const full = C.estimateCampaign(t, 'fullyGenerated', 500, { scriptChars: 90, picturesPerFilm: 3, motionSecondsPerFilm: 10 })

  ok('text-only costs almost nothing across 500 rows', cheap.usd < 1, cheap.usd)
  ok('...because the voice is generated ONCE and reused',
    cheap.breakdown.some(b => /o singură dată/.test(b.what)))
  ok('spoken names cost real money', spoken.usd > cheap.usd * 100, `${cheap.usd} vs ${spoken.usd}`)
  ok('FULL REGENERATION IS ORDERS OF MAGNITUDE MORE — the three modes look ' +
     'almost identical in words and differ by hundreds of times in money',
    full.usd > spoken.usd * 20, `${spoken.usd.toFixed(2)} vs ${full.usd.toFixed(2)}`)
  ok('every mode reports a per-row figure', [cheap, spoken, full].every(e => e.usdPerRow >= 0))
  ok('the breakdown adds up to the total', [cheap, spoken, full].every(e =>
    Math.abs(e.breakdown.reduce((s, b) => s + b.usd, 0) - e.usd) < 1e-9))
  ok('an expensive campaign warns in plain words', full.warnings.length > 0, JSON.stringify(full.warnings))
  ok('...and the warning names a cheaper mode that would do', 
    full.warnings.some(w => /Doar textul|rostit/.test(w)))
  ok('a small cheap campaign is not nagged at',
    C.estimateCampaign(t, 'textOnly', 50, { scriptChars: 90 }).warnings.length === 0)
  ok('A CAMPAIGN THAT IS NEARLY FREE IN MONEY BUT ENORMOUS IN TIME IS STILL ' +
     'WARNED ABOUT — 500 films at 13 seconds each is 16 hours on one worker, ' +
     'and a cost model that only counted dollars would call that "free"',
    cheap.warnings.some(w => /ore|Randarea/.test(w)), JSON.stringify(cheap.warnings))
  ok('...and that warning is about time, not money',
    cheap.warnings.every(w => !/\$/.test(w)), JSON.stringify(cheap.warnings))
  ok('render time is reported separately from money — the render costs time, ' +
     'not dollars, and pretending otherwise is dishonest', spoken.renderMinutes > 0)
  ok('zero rows costs zero', C.estimateCampaign(t, 'spokenName', 0).usd === 0)

  ok('THE ESTIMATE USES THE SUBSTITUTED SCRIPT LENGTH, not the template\'s — ' +
     'the raw script under-counts every row by the length of the merge fields',
    C.estimateCampaign(t, 'spokenName', 100, { scriptChars: 200 }).usd >
    C.estimateCampaign(t, 'spokenName', 100, { scriptChars: 100 }).usd)
}

// ── the gate ─────────────────────────────────────────────────────────────
{
  const t = L.byId('sales-outreach')
  const big = C.estimateCampaign(t, 'fullyGenerated', 500, { scriptChars: 90, picturesPerFilm: 3, motionSecondsPerFilm: 10 })
  const small = C.estimateCampaign(t, 'textOnly', 50, { scriptChars: 90 })

  ok('A CAMPAIGN OVER THE CEILING IS REFUSED', !C.gate(big, 50).allowed)
  ok('...and the refusal says the estimate and the ceiling',
    /\$/.test(C.gate(big, 50).reason) && /plafon/.test(C.gate(big, 50).reason))
  ok('a small campaign is allowed with no ceremony',
    C.gate(small, 50).allowed && !C.gate(small, 50).needsConfirmation)
  ok('a campaign above the confirmation line is ALLOWED BUT CONFIRMED', (() => {
    const mid = C.estimateCampaign(t, 'spokenName', 3000, { scriptChars: 90 })
    const g = C.gate(mid, 10000)
    return g.allowed && g.needsConfirmation
  })())
  ok('an empty list is refused rather than run', !C.gate(C.estimateCampaign(t, 'textOnly', 0), 100).allowed)
  ok('THE GATE IS A PURE FUNCTION — a gate that lives in a click handler is one ' +
     'the next caller of this code will not have', typeof C.gate === 'function')
}

// ── the cap is in the builder, not in a button ───────────────────────────
{
  const t = L.byId('sales-outreach')
  const rows = Array.from({ length: B.MAX_ROWS + 100 }, () => ({ prenume: 'A', firma: 'B', motiv: 'c' }))
  ok('the row cap is enforced in the pure builder',
    B.buildCampaign(t, {}, rows).drafts.length === B.MAX_ROWS)
  ok('...and the overflow is reported, not silently dropped',
    B.buildCampaign(t, {}, rows).skipped === 100)
}

// ── a half-finished campaign ─────────────────────────────────────────────
{
  const jobs = [
    { index: 0, state: 'done', url: 'a.mp4' },
    { index: 1, state: 'done', url: 'b.mp4' },
    { index: 2, state: 'failed', error: 'timeout' },
    { index: 3, state: 'pending' },
  ]
  const p = C.progress(jobs)
  ok('progress counts each state', p.done === 2 && p.failed === 1 && p.pending === 1)
  ok('percent counts finished AND failed — a failed row is not still working',
    p.percent === 75, p.percent)
  ok('RESUMING RUNS EXACTLY THE ROWS THAT DID NOT FINISH, so a half-spent ' +
     'campaign is not paid for twice',
    C.toResume(jobs).join(',') === '2,3')
  ok('a finished campaign has nothing to resume',
    C.toResume(jobs.map(j => ({ ...j, state: 'done' }))).length === 0)
  ok('an empty campaign does not divide by zero', C.progress([]).percent === 0)
}

// ── the modes are described for a human ──────────────────────────────────
{
  ok('every mode has a label and a note', Object.values(C.MODES).every(m => m.label && m.note.length > 30))
  ok('every mode says what it regenerates per row', Object.values(C.MODES).every(m => m.regenerates))
  ok('the cheap mode says it is cheap and the expensive one says it is expensive',
    /gratuit/.test(C.MODES.textOnly.note) && /scump/.test(C.MODES.fullyGenerated.note))
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
