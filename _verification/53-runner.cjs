// _verification/53-runner.cjs
//
// The driver loop, against a fake database and a fake render.
//
// 52-queue.cjs proves the decisions and the SQL guarantee. This proves the loop
// that uses them, and it does so with a driver that COUNTS THINGS: how many
// times each row was rendered, how much was spent, what was released. The
// assertions are about money and about work not being lost, because those are
// the two ways an unattended runner hurts somebody.

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
  const req = (id) => id === './queue' ? loadTs('lib/campaign/queue.ts') : require(id)
  // The runner uses a dynamic `import('./queue')` for the halt messages; under
  // CommonJS the transpiler turns that into a Promise.resolve().then(require).
  new Function('module', 'exports', 'require', js)(mod, mod.exports, req)
  cache[rel] = mod.exports
  return mod.exports
}
const Q = loadTs('lib/campaign/queue.ts')
const R = loadTs('lib/campaign/runner.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

/**
 * A fake campaign that behaves like the real SQL: the claim is atomic because
 * JavaScript is single threaded here, and it applies the same rules.
 */
function makeDriver(n, opts = {}) {
  const cost = opts.cost ?? 0.10
  const failRows = new Set(opts.failRows ?? [])
  const failTimes = opts.failTimes ?? Infinity
  const errorFor = opts.errorFor ?? (() => 'timeout')
  const maxAttempts = opts.maxAttempts ?? 3
  const jobs = Array.from({ length: n }, (_, i) => ({
    rowIndex: i, state: 'pending', attempts: 0, leaseUntil: null, costUsd: 0,
  }))
  const rendered = []           // every row index ever rendered, in order
  const released = []
  const failsSoFar = new Map()

  const driver = {
    async claim() {
      const now = Date.now()
      const j = jobs
        .filter(x => Q.isClaimable(x, now, { ...Q.DEFAULTS, maxAttempts }))
        .sort((a, b) => a.attempts - b.attempts || a.rowIndex - b.rowIndex)[0]
      if (!j) return null
      j.state = 'running'
      j.attempts += 1
      j.leaseUntil = now + 600_000
      return { rowIndex: j.rowIndex, attempts: j.attempts }
    },
    async render(rowIndex) {
      rendered.push(rowIndex)
      await new Promise(r => setTimeout(r, opts.renderMs ?? 1))
      const seen = failsSoFar.get(rowIndex) ?? 0
      if (failRows.has(rowIndex) && seen < failTimes) {
        failsSoFar.set(rowIndex, seen + 1)
        throw new Error(errorFor(rowIndex))
      }
      return { url: `row-${rowIndex}.mp4`, costUsd: cost }
    },
    async finish(rowIndex, r) {
      const j = jobs[rowIndex]
      j.state = 'done'; j.costUsd = r.costUsd; j.leaseUntil = null
    },
    async fail(rowIndex, error, retryAt, exhausted) {
      const j = jobs[rowIndex]
      j.state = 'failed'; j.error = error; j.leaseUntil = null
      j.notBefore = retryAt ?? undefined
      if (exhausted) j.attempts = maxAttempts
    },
    async release(rowIndex) {
      released.push(rowIndex)
      const j = jobs[rowIndex]
      if (j.state === 'running') { j.state = 'pending'; j.leaseUntil = null; j.attempts = Math.max(0, j.attempts - 1) }
    },
    async load() { return jobs.map(j => ({ ...j })) },
  }
  return { driver, jobs, rendered, released }
}

const cfg = (over = {}) => ({ ...Q.DEFAULTS, concurrency: 2, ceilingUsd: 100, ...over })

;(async () => {
  // ── a clean run ────────────────────────────────────────────────────────
  {
    const { driver, jobs, rendered } = makeDriver(6)
    const h = R.runCampaign(driver, cfg(), {})
    const { reason } = await h.done
    ok('a clean campaign completes', reason === 'complete', reason)
    ok('every row was rendered', jobs.every(j => j.state === 'done'))
    ok('EVERY ROW WAS RENDERED EXACTLY ONCE — the whole point of the claim',
      rendered.length === 6 && new Set(rendered).size === 6, rendered.join(','))
    ok('and every row got a url', jobs.every(j => j.costUsd > 0))
  }

  // ── concurrency is respected ───────────────────────────────────────────
  {
    const { driver, rendered } = makeDriver(8, { renderMs: 30 })
    let peak = 0
    const h = R.runCampaign(driver, cfg({ concurrency: 3 }), {
      onProgress: p => { peak = Math.max(peak, p.running) },
    })
    await h.done
    ok('rows run in parallel up to the concurrency', peak > 1, 'peak ' + peak)
    ok('...and never above it', peak <= 3, 'peak ' + peak)
    ok('...and all eight still ran exactly once',
      rendered.length === 8 && new Set(rendered).size === 8)
  }

  // ── a transient failure is retried, and only so often ──────────────────
  {
    const { driver, jobs, rendered } = makeDriver(3, { failRows: [1], failTimes: 1 })
    const h = R.runCampaign(driver, cfg(), {})
    await h.done
    ok('A ROW THAT FAILS ONCE IS RETRIED AND SUCCEEDS', jobs[1].state === 'done')
    ok('...and it really was rendered twice',
      rendered.filter(r => r === 1).length === 2, rendered.join(','))
    ok('...and the other rows were not disturbed',
      jobs[0].state === 'done' && jobs[2].state === 'done')
  }

  {
    const { driver, jobs, rendered } = makeDriver(2, { failRows: [0] })
    const h = R.runCampaign(driver, cfg({ maxAttempts: 3 }), {})
    const { reason } = await h.done
    ok('A ROW THAT ALWAYS FAILS STOPS BEING RETRIED', jobs[0].attempts >= 3)
    ok('...after exactly the attempt cap, not forever — this is the difference ' +
       'between a failed row and an unbounded bill',
      rendered.filter(r => r === 0).length === 3, rendered.filter(r => r === 0).length + ' attempts')
    ok('...and the campaign still finishes rather than hanging',
      reason === 'allAttemptsExhausted', reason)
    ok('...and the healthy row completed', jobs[1].state === 'done')
  }

  // ── a permanent failure is not retried at all ──────────────────────────
  {
    const { driver, rendered } = makeDriver(1, {
      failRows: [0], errorFor: () => 'invalid voice_id',
    })
    await R.runCampaign(driver, cfg(), {}).done
    ok('A PERMANENT FAILURE IS RENDERED ONCE, NOT THREE TIMES — asking again ' +
       'costs three times as much and gets the same refusal',
      rendered.length === 1, rendered.length + ' attempts')
  }

  // ── the ceiling ────────────────────────────────────────────────────────
  {
    const { driver, jobs } = makeDriver(20, { cost: 0.5 })
    const h = R.runCampaign(driver, cfg({ ceilingUsd: 2, concurrency: 1 }), {})
    const { reason, progress } = await h.done
    ok('THE CEILING STOPS THE CAMPAIGN', /ceiling/.test(reason || ''), reason)
    ok('AND IT STOPS BEFORE CROSSING, NOT AFTER — a ceiling that can only be ' +
       'enforced retroactively is not a ceiling',
      progress.spend.spentUsd <= 2, '$' + progress.spend.spentUsd)
    ok('...so most of the campaign was never paid for',
      jobs.filter(j => j.state === 'done').length < 20)
    ok('...and the rest is still pending, ready to resume if the ceiling is raised',
      jobs.some(j => j.state === 'pending'))
  }

  // ── stopping cleanly ───────────────────────────────────────────────────
  {
    const { driver, jobs, rendered } = makeDriver(20, { renderMs: 40 })
    const h = R.runCampaign(driver, cfg({ concurrency: 2 }), {})
    await new Promise(r => setTimeout(r, 120))
    h.stop()
    await h.done
    const done = jobs.filter(j => j.state === 'done').length
    ok('stopping ends the run', done > 0 && done < 20, done + ' of 20')
    ok('NOTHING IS LEFT HELD — a closed tab must not strand rows behind a ' +
       'ten-minute lease', jobs.every(j => j.state !== 'running'))
    ok('...and every unfinished row is claimable again',
      jobs.filter(j => j.state !== 'done').every(j => Q.isClaimable(j, Date.now(), cfg())))
    ok('...and no row was rendered twice on the way out',
      rendered.length === new Set(rendered).size, rendered.join(','))
  }

  // ── aborting mid-render gives the rows back ────────────────────────────
  {
    const { driver, jobs, released } = makeDriver(10, { renderMs: 200 })
    const h = R.runCampaign(driver, cfg({ concurrency: 2 }), {})
    await new Promise(r => setTimeout(r, 60))
    h.abort()
    await h.done
    ok('ABORTING RELEASES THE ROWS IT WAS HOLDING', released.length > 0, released.join(','))
    ok('...so none is stuck running', jobs.every(j => j.state !== 'running'))
    ok('...and the attempt is given back, because an abandoned row is not a ' +
       'failed one', jobs.filter(j => j.state === 'pending').every(j => j.attempts === 0))
  }

  // ── resuming picks up exactly where it stopped ──────────────────────────
  {
    const { driver, jobs, rendered } = makeDriver(10)
    const h1 = R.runCampaign(driver, cfg({ ceilingUsd: 0.35, concurrency: 1 }), {})
    await h1.done
    const firstPass = jobs.filter(j => j.state === 'done').length
    ok('the first run stopped part way', firstPass > 0 && firstPass < 10, firstPass)

    const before = rendered.length
    const h2 = R.runCampaign(driver, cfg({ ceilingUsd: 100, concurrency: 2 }), {})
    await h2.done
    ok('RESUMING FINISHES THE CAMPAIGN', jobs.every(j => j.state === 'done'))
    ok('AND DOES NOT RE-RENDER THE ROWS ALREADY PAID FOR — this is the ' +
       'difference between resuming and starting again',
      rendered.length - before === 10 - firstPass,
      `${rendered.length - before} new renders for ${10 - firstPass} unfinished rows`)
    ok('...and in total every row was rendered exactly once',
      rendered.length === 10 && new Set(rendered).size === 10, rendered.join(','))
  }

  // ── the events a UI needs ──────────────────────────────────────────────
  {
    const { driver } = makeDriver(4, { failRows: [2], failTimes: 1 })
    const seen = { start: 0, done: 0, fail: 0, halt: 0, progress: 0 }
    const h = R.runCampaign(driver, cfg(), {
      onRowStart: () => seen.start++,
      onRowDone: () => seen.done++,
      onRowFail: () => seen.fail++,
      onHalt: () => seen.halt++,
      onProgress: () => seen.progress++,
    })
    await h.done
    ok('the runner reports every row starting', seen.start === 5, seen.start)
    ok('...and finishing', seen.done === 4, seen.done)
    ok('...and failing', seen.fail === 1, seen.fail)
    ok('...and halting once at the end', seen.halt === 1, seen.halt)
    ok('...and progress along the way', seen.progress > 0)
  }

  // ── an empty campaign ──────────────────────────────────────────────────
  {
    const { driver } = makeDriver(0)
    const { reason } = await R.runCampaign(driver, cfg(), {}).done
    ok('an empty campaign completes rather than spinning', reason === 'complete', reason)
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})()
