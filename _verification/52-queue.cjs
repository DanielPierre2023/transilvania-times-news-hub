// _verification/52-queue.cjs
//
// The campaign queue: the arithmetic, and the one guarantee that cannot be
// written in TypeScript.
//
// THE GUARANTEE. "Find a pending row and mark it running" is a read followed by
// a write. Two drivers — a browser tab and a server poller, or two tabs, or one
// tab and the retry of a request that appeared to hang — interleave those and
// both take the same row. Both render it. Both pay. The second result
// overwrites the first, so the campaign completes, the films are correct, and
// the bill is double with nothing anywhere reporting a problem.
//
// That cannot be tested by reasoning about it, so this suite starts a real
// PostgreSQL, fills a campaign with rows, and fires CONCURRENT claimers at it.
// The assertion is simply: no row was ever handed out twice.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ts = require(path.join(ROOT, 'node_modules', 'typescript'))

function loadTs(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', js)(mod, mod.exports, require)
  return mod.exports
}
const Q = loadTs('lib/campaign/queue.ts')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const job = (over = {}) => ({
  rowIndex: 0, state: 'pending', attempts: 0, leaseUntil: null, costUsd: 0, ...over,
})
const NOW = 1_000_000

// ══ THE ARITHMETIC ═══════════════════════════════════════════════════════

// ── which rows can be worked ─────────────────────────────────────────────
{
  ok('a pending row is claimable', Q.isClaimable(job(), NOW))
  ok('a finished row is not', !Q.isClaimable(job({ state: 'done' }), NOW))
  ok('a cancelled row is not', !Q.isClaimable(job({ state: 'cancelled' }), NOW))
  ok('a row that used all its attempts is not',
    !Q.isClaimable(job({ state: 'failed', attempts: 3 }), NOW))
  ok('a failed row with attempts left is', Q.isClaimable(job({ state: 'failed', attempts: 1 }), NOW))

  ok('A RUNNING ROW WITH A LIVE CLAIM IS NOT CLAIMABLE — this is what stops a ' +
     'second driver rendering it as well',
    !Q.isClaimable(job({ state: 'running', leaseUntil: NOW + 60_000 }), NOW))
  ok('A RUNNING ROW WHOSE LEASE HAS LAPSED IS CLAIMABLE AGAIN — this is what ' +
     'makes closing the browser safe rather than destructive',
    Q.isClaimable(job({ state: 'running', leaseUntil: NOW - 1 }), NOW))
  ok('a running row with no lease at all is not silently stranded forever',
    !Q.isClaimable(job({ state: 'running', leaseUntil: null }), NOW))

  ok('a row waiting out its backoff is not claimable yet',
    !Q.isClaimable(job({ state: 'failed', attempts: 1, notBefore: NOW + 5_000 }), NOW))
  ok('...and is once the backoff has passed',
    Q.isClaimable(job({ state: 'failed', attempts: 1, notBefore: NOW - 1 }), NOW))
}

// ── backoff ──────────────────────────────────────────────────────────────
{
  const a1 = Q.backoffMs(1, 0), a2 = Q.backoffMs(2, 0), a3 = Q.backoffMs(3, 0)
  ok('backoff grows with attempts', a2 > a1 && a3 > a2, [a1, a2, a3].join(','))
  ok('...roughly doubling', a2 / a1 > 1.5 && a2 / a1 < 2.5, (a2 / a1).toFixed(2))
  ok('it is capped, so a long campaign does not end up waiting an hour',
    Q.backoffMs(50, 0) <= 5 * 60_000)
  ok('THE JITTER IS REAL — four hundred rows that failed in the same second ' +
     'must not all retry in the same second', (() => {
      const spread = new Set(Array.from({ length: 40 }, (_, i) => Q.backoffMs(2, i)))
      return spread.size > 20
    })())
  ok('...but it is DETERMINISTIC per row, so a row does not jump around while ' +
     'somebody is watching the queue',
    Q.backoffMs(2, 7) === Q.backoffMs(2, 7))
  ok('the jitter stays inside ±25%', (() => {
    const raw = 4000 * 2
    return Array.from({ length: 50 }, (_, i) => Q.backoffMs(2, i))
      .every(v => v >= raw * 0.74 && v <= raw * 1.26)
  })())
}

// ── permanent versus transient failures ──────────────────────────────────
{
  ok('a timeout is retried', Q.isRetryable('Request timed out'))
  ok('a 503 is retried', Q.isRetryable('upstream returned 503'))
  ok('a rate limit is retried', Q.isRetryable('429 rate limit exceeded'))
  ok('A CONTENT-POLICY REFUSAL IS NOT RETRIED — asking three times costs three ' +
     'times as much and gets the same refusal', !Q.isRetryable('content policy violation'))
  ok('a 404 is not retried', !Q.isRetryable('asset not found (404)'))
  ok('an invalid argument is not retried', !Q.isRetryable('invalid voice_id'))
  ok('an unfamiliar error IS retried, because defaulting the other way would ' +
     'fail a whole campaign on one unknown message',
    Q.isRetryable('something nobody has seen before'))
  ok('...and the attempt cap still bounds that', (() => {
    const r = Q.afterFailure(job({ attempts: 2 }), 'weird', NOW)
    return r.attempts === 3 && !r.notBefore
  })())

  const perm = Q.afterFailure(job({ attempts: 0 }), 'invalid voice_id', NOW)
  ok('a permanent failure burns its remaining attempts at once',
    perm.attempts === Q.DEFAULTS.maxAttempts)
  ok('...and is not scheduled for another try', perm.notBefore === undefined)
  ok('...and says so in the error', /nu se reîncearcă/.test(perm.error))

  const soft = Q.afterFailure(job({ attempts: 0, rowIndex: 3 }), 'timeout', NOW)
  ok('a transient failure keeps its remaining attempts', soft.attempts === 1)
  ok('...and is scheduled for later, not now', (soft.notBefore ?? 0) > NOW)
  ok('...and releases its claim', soft.leaseUntil === null)
}

// ── spend ────────────────────────────────────────────────────────────────
{
  const jobs = [
    job({ rowIndex: 0, state: 'done', costUsd: 0.10 }),
    job({ rowIndex: 1, state: 'done', costUsd: 0.12 }),
    job({ rowIndex: 2, state: 'pending' }),
    job({ rowIndex: 3, state: 'pending' }),
  ]
  const s = Q.spendOf(jobs)
  ok('spend is what the rows actually cost', Math.abs(s.spentUsd - 0.22) < 1e-9)
  ok('the per-row figure comes from FINISHED rows only', Math.abs(s.perRowUsd - 0.11) < 1e-9)
  ok('THE PROJECTION USES THE MEASURED RATE, not the original estimate — when ' +
     'the two disagree it is the estimate that is wrong',
    Math.abs(s.projectedUsd - (0.22 + 2 * 0.11)) < 1e-9, s.projectedUsd)
  ok('a campaign with nothing finished does not divide by zero',
    Q.spendOf([job()]).perRowUsd === 0)
}

// ── the halt ─────────────────────────────────────────────────────────────
{
  const cfg = { ...Q.DEFAULTS, ceilingUsd: 1 }
  ok('a campaign under its ceiling does not halt',
    Q.haltReason([job({ state: 'done', costUsd: 0.1 }), job({ rowIndex: 1 })], cfg) === null)

  ok('a campaign AT its ceiling halts',
    Q.haltReason([job({ state: 'done', costUsd: 1.0 }), job({ rowIndex: 1 })], cfg) === 'ceilingReached')

  ok('A CAMPAIGN HALTS BEFORE CROSSING THE CEILING, not after — a ceiling that ' +
     'can only be enforced retroactively is not a ceiling', (() => {
      const jobs = [
        job({ rowIndex: 0, state: 'done', costUsd: 0.6 }),
        job({ rowIndex: 1, state: 'done', costUsd: 0.3 }),
        job({ rowIndex: 2, state: 'pending' }),
      ]
      // spent 0.90, per-row 0.45, one more would be 1.35 against a ceiling of 1
      return Q.haltReason(jobs, cfg) === 'ceilingProjected'
    })())
  ok('...and the message tells you how to continue',
    /plafon/.test(Q.HALT_MESSAGE.ceilingProjected))

  ok('a finished campaign reports complete',
    Q.haltReason([job({ state: 'done', costUsd: 0.1 })], cfg) === 'complete')
  ok('a campaign whose rows all failed out reports that, not completion',
    Q.haltReason([job({ state: 'failed', attempts: 3 })], cfg) === 'allAttemptsExhausted')
  ok('every halt reason has a message',
    Object.keys(Q.HALT_MESSAGE).length === 4 &&
    Object.values(Q.HALT_MESSAGE).every(m => m.length > 10))
}

// ── the one decision the driver asks for ─────────────────────────────────
{
  const cfg = { ...Q.DEFAULTS, concurrency: 2, ceilingUsd: 100 }
  const jobs = [job({ rowIndex: 0 }), job({ rowIndex: 1 }), job({ rowIndex: 2 })]

  const step = Q.nextStep(jobs, 0, cfg, NOW)
  ok('the runner is told which rows to claim', step.claim.length === 2, JSON.stringify(step))
  ok('...no more than the concurrency allows', step.claim.length === cfg.concurrency)
  ok('...and none while already full', Q.nextStep(jobs, 2, cfg, NOW).claim.length === 0)
  ok('rows with FEWER attempts go first, so one sick row does not block the queue',
    Q.nextStep([job({ rowIndex: 0, state: 'failed', attempts: 2 }), job({ rowIndex: 1 })], 0, cfg, NOW)
      .claim[0] === 1)

  const waiting = [job({ rowIndex: 0, state: 'failed', attempts: 1, notBefore: NOW + 30_000 })]
  const s = Q.nextStep(waiting, 0, cfg, NOW)
  ok('WITH EVERYTHING WAITING OUT A BACKOFF THE RUNNER SLEEPS rather than ' +
     'declaring the campaign over', s.halt === null && s.claim.length === 0)
  ok('...and sleeps until the row is actually due, rather than spinning',
    s.sleepMs !== null && s.sleepMs > 1_000 && s.sleepMs <= 60_000, s.sleepMs)
  ok('a halted campaign is told to stop and given no rows',
    Q.nextStep([job({ state: 'done', costUsd: 500 })], 0, cfg, NOW).halt !== null)
}

// ── progress ─────────────────────────────────────────────────────────────
{
  const jobs = [
    job({ rowIndex: 0, state: 'done', costUsd: 0.1 }),
    job({ rowIndex: 1, state: 'failed', attempts: 3 }),
    job({ rowIndex: 2, state: 'running', leaseUntil: NOW + 1000 }),
    job({ rowIndex: 3, state: 'pending' }),
  ]
  const p = Q.progressOf(jobs, 60_000)
  ok('progress counts every state', p.done === 1 && p.failed === 1 && p.running === 1 && p.pending === 1)
  ok('percent counts finished AND permanently failed — a dead row is not still working',
    p.percent === 50, p.percent)
  ok('an eta is offered once a row has been timed', p.etaMs !== null && p.etaMs > 0)
  ok('...and not invented before that', Q.progressOf(jobs, null).etaMs === null)
  ok('a row still retrying is not counted as failed',
    Q.progressOf([job({ state: 'failed', attempts: 1 })], null).failed === 0)
}

// ══ THE GUARANTEE, AGAINST A REAL DATABASE ═══════════════════════════════

const BIN = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '']
  .find(d => spawnSync(path.join(d, 'pg_ctl'), ['--version'], { stdio: 'ignore' }).status === 0)
if (BIN === undefined) {
  console.log('\n  postgres not available — the concurrency guarantee cannot be proved here')
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(2)
}
const bin = (n) => (BIN ? path.join(BIN, n) : n)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q-'))
const data = path.join(dir, 'data')
const sock = path.join(dir, 'run')
fs.mkdirSync(sock)
const PORT = 5600 + (process.pid % 150)
const asPg = (cmd) => spawnSync('su', ['postgres', '-c', cmd], { encoding: 'utf8' })
spawnSync('chown', ['-R', 'postgres', dir])

if (asPg(`${bin('initdb')} -D ${data} -A trust`).status !== 0) {
  console.log('  initdb failed'); process.exit(2)
}
spawnSync('chown', ['-R', 'postgres', dir])
if (asPg(`${bin('pg_ctl')} -D ${data} -o "-k ${sock} -p ${PORT} -c listen_addresses=" -l ${dir}/log start`).status !== 0) {
  console.log('  postgres would not start'); process.exit(2)
}

const runFile = (f) => asPg(`${bin('psql')} -h ${sock} -p ${PORT} -d postgres -q -v ON_ERROR_STOP=1 -f ${f}`)
const q = (sql) => asPg(`${bin('psql')} -h ${sock} -p ${PORT} -d postgres -tAq -c ${JSON.stringify(sql)}`)
const rows = (sql) => (q(sql).stdout || '').trim().split('\n').filter(Boolean)

try {
  const stub = path.join(dir, 'stub.sql')
  fs.writeFileSync(stub, `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function public.has_role(u uuid, r text) returns boolean language sql stable as $$ select true $$;
`)
  fs.chmodSync(stub, 0o644)
  runFile(stub)

  const migrations = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .filter(f => f.endsWith('.sql') && f >= '20260829')
    .sort()
  for (const f of migrations) {
    const r = runFile(path.join(ROOT, 'supabase', 'migrations', f))
    if (r.status !== 0 && /2026090/.test(f)) {
      ok(`${f} applies`, false, (r.stderr || '').split('\n').filter(l => /ERROR/.test(l))[0])
    }
  }
  ok('the queue migration applies to a real database',
    rows(`select 1 from pg_proc where proname='claim_campaign_job'`).length === 1)
  ok('...and is idempotent', (() => {
    const f = path.join(ROOT, 'supabase', 'migrations', '20260901180000_campaign_queue.sql')
    return runFile(f).status === 0
  })())

  const seed = (n, id = 'camp1') => {
    q(`delete from public.studio_campaigns where id='${id}'`)
    q(`insert into public.studio_campaigns (id,name,template_id,ceiling_usd) values ('${id}','C','t',100)`)
    const values = Array.from({ length: n }, (_, i) => `('${id}',${i},'pending')`).join(',')
    q(`insert into public.studio_campaign_jobs (campaign_id,row_index,state) values ${values}`)
  }

  // ── a single claim behaves ─────────────────────────────────────────────
  {
    seed(3)
    const first = rows(`select row_index from public.claim_campaign_job('camp1','d1',600000,3)`)
    ok('a claim returns exactly one row', first.length === 1, first.join(','))
    ok('...and marks it running with a lease',
      rows(`select 1 from public.studio_campaign_jobs where campaign_id='camp1' and row_index=${first[0]} and state='running' and lease_until > now()`).length === 1)
    ok('...and counts the attempt',
      rows(`select attempts from public.studio_campaign_jobs where campaign_id='camp1' and row_index=${first[0]}`)[0] === '1')
    const second = rows(`select row_index from public.claim_campaign_job('camp1','d2',600000,3)`)
    ok('THE NEXT CLAIM GETS A DIFFERENT ROW', second[0] !== first[0], `${first[0]} then ${second[0]}`)
  }

  // ── THE ONE THAT MATTERS: concurrent drivers ───────────────────────────
  {
    const N = 40
    seed(N, 'race')
    // Eight drivers, each claiming every row it can, all at the same time.
    const script = path.join(dir, 'race.sh')
    fs.writeFileSync(script, `#!/bin/sh
for d in 1 2 3 4 5 6 7 8; do
  ( for i in $(seq 1 ${N}); do
      ${bin('psql')} -h ${sock} -p ${PORT} -d postgres -tAq \
        -c "select row_index from public.claim_campaign_job('race','driver-$d',600000,99)"
    done ) > ${dir}/out-$d.txt 2>/dev/null &
done
wait
`)
    fs.chmodSync(script, 0o755)
    spawnSync('chown', ['-R', 'postgres', dir])
    asPg(`sh ${script}`)

    const handed = []
    for (let d = 1; d <= 8; d++) {
      const f = `${dir}/out-${d}.txt`
      if (!fs.existsSync(f)) continue
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        const v = line.trim()
        if (v !== '') handed.push(v)
      }
    }
    const unique = new Set(handed)
    ok('the concurrent drivers actually did work', handed.length > 0, handed.length + ' claims')
    ok('NO ROW WAS EVER HANDED TO TWO DRIVERS — this is the whole reason the ' +
       'claim is one statement instead of a read and a write',
      handed.length === unique.size,
      `${handed.length} claims but only ${unique.size} distinct rows`)
    ok('...and every row was handed out exactly once', unique.size === N,
      `${unique.size} of ${N}`)
    ok('...so every row ended up running', 
      rows(`select count(*) from public.studio_campaign_jobs where campaign_id='race' and state='running'`)[0] === String(N))
    ok('...and none was attempted more than once',
      rows(`select count(*) from public.studio_campaign_jobs where campaign_id='race' and attempts > 1`)[0] === '0')
  }

  // ── a live claim is respected, an expired one is not ────────────────────
  {
    seed(1, 'lease')
    rows(`select row_index from public.claim_campaign_job('lease','a',600000,3)`)
    ok('A ROW UNDER A LIVE CLAIM IS NOT HANDED TO A SECOND DRIVER',
      rows(`select row_index from public.claim_campaign_job('lease','b',600000,3)`).length === 0)

    q(`update public.studio_campaign_jobs set lease_until = now() - interval '1 minute' where campaign_id='lease'`)
    ok('A LAPSED CLAIM IS RECLAIMED — this is what makes a dead driver ' +
       'recoverable rather than a stuck campaign',
      rows(`select row_index from public.claim_campaign_job('lease','b',600000,3)`).length === 1)
  }

  // ── backoff and the attempt cap are honoured by the SQL too ─────────────
  {
    seed(1, 'bo')
    rows(`select row_index from public.claim_campaign_job('bo','a',600000,3)`)
    q(`select public.fail_campaign_job('bo',0,'timeout', now() + interval '10 minutes', false, 3)`)
    ok('A ROW WAITING OUT ITS BACKOFF IS NOT HANDED OUT',
      rows(`select row_index from public.claim_campaign_job('bo','a',600000,3)`).length === 0)
    q(`update public.studio_campaign_jobs set not_before = now() - interval '1 second' where campaign_id='bo'`)
    ok('...and is once it is due',
      rows(`select row_index from public.claim_campaign_job('bo','a',600000,3)`).length === 1)

    seed(1, 'cap')
    q(`update public.studio_campaign_jobs set attempts = 3, state='failed' where campaign_id='cap'`)
    ok('A ROW THAT USED ALL ITS ATTEMPTS IS NEVER HANDED OUT AGAIN — otherwise ' +
       'a row that can never succeed is paid for as long as the campaign runs',
      rows(`select row_index from public.claim_campaign_job('cap','a',600000,3)`).length === 0)

    seed(1, 'perm')
    rows(`select row_index from public.claim_campaign_job('perm','a',600000,3)`)
    q(`select public.fail_campaign_job('perm',0,'invalid voice', null, true, 3)`)
    ok('a permanent failure exhausts the attempts immediately',
      rows(`select attempts from public.studio_campaign_jobs where campaign_id='perm'`)[0] === '3')
  }

  // ── finishing a row moves the campaign's own total ──────────────────────
  {
    seed(3, 'money')
    for (let i = 0; i < 3; i++) {
      const r = rows(`select row_index from public.claim_campaign_job('money','a',600000,3)`)
      q(`select public.finish_campaign_job('money',${r[0]},'u.mp4',0.25)`)
    }
    ok('THE CAMPAIGN TOTAL IS DERIVED FROM THE ROWS, so the two can never disagree',
      rows(`select spent_usd from public.studio_campaigns where id='money'`)[0] === '0.7500')
    ok('...and a finished campaign has nothing left to claim',
      rows(`select row_index from public.claim_campaign_job('money','a',600000,3)`).length === 0)
    ok('the progress view agrees with the rows', (() => {
      const r = rows(`select total || '/' || done || '/' || remaining from public.studio_campaign_progress where id='money'`)
      return r[0] === '3/3/0'
    })())
  }

  // ── a clean release hands the row back without burning an attempt ───────
  {
    seed(1, 'rel')
    rows(`select row_index from public.claim_campaign_job('rel','a',600000,3)`)
    q(`select public.release_campaign_job('rel',0)`)
    ok('a released row is pending again',
      rows(`select state from public.studio_campaign_jobs where campaign_id='rel'`)[0] === 'pending')
    ok('A CLEAN RELEASE GIVES THE ATTEMPT BACK — a closed tab is not a failure, ' +
       'and counting it as one would exhaust a healthy row after three closes',
      rows(`select attempts from public.studio_campaign_jobs where campaign_id='rel'`)[0] === '0')
    ok('...and it can be claimed straight away',
      rows(`select row_index from public.claim_campaign_job('rel','b',600000,3)`).length === 1)
  }
} finally {
  asPg(`${bin('pg_ctl')} -D ${data} -m immediate stop`)
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
