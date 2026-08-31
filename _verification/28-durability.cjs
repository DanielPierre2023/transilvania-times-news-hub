// _verification/28-durability.cjs
//
// "One process, one job at a time, in-memory queue, 6-hour retention, restart
// loses everything."
//
// The download key was checked against an in-memory Map, so a sweep or a
// redeploy turned every finished render into 401 with the file gone. Measured
// on the live Studio page: three of four render links were already dead.
// Railway restarts on every deploy, so this was not an edge case.
//
// This suite starts a real worker on a real port, gives it a real finished job,
// KILLS IT, starts a new one against the same work root, and asks for the file.

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { spawn } = require('child_process')

const ROOT = path.join(__dirname, '..')
const ENTRY = path.join(ROOT, 'render-worker', 'src', 'index.js')
const TOKEN = 'test-token-' + 'x'.repeat(20)

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, headers }, res => {
      let b = ''
      res.on('data', d => { b += d })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }))
    })
    req.on('error', reject)
  })
}

function boot(port, workRoot) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, PORT: String(port), RENDER_WORKER_TOKEN: TOKEN,
           RENDER_WORK_ROOT: workRoot, RENDER_CONCURRENCY: '3' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  return { child, log: () => out }
}

async function waitUp(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await get(port, '/health'); if (r.status === 200) return JSON.parse(r.body) } catch { /* not yet */ }
    await sleep(120)
  }
  throw new Error('worker did not start')
}

;(async () => {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'durability-'))
  const PORT = 8477

  // ── first life ─────────────────────────────────────────────────────────
  let w = boot(PORT, workRoot)
  const health = await waitUp(PORT)
  ok('the worker reports its concurrency', health.concurrency === 3, JSON.stringify(health.concurrency))
  ok('concurrency is no longer a boolean', typeof health.running === 'number', typeof health.running)
  ok('retention is reported so it can be checked', typeof health.retention === 'number')
  ok('retention is days, not hours', health.retention >= 24 * 60 * 60 * 1000,
    String(health.retention))

  // Plant a finished job the way a completed render leaves one behind: a work
  // directory with a real file, and a row in the index.
  const jobId = '11111111-2222-4333-8444-555555555555'
  const jobDir = path.join(workRoot, 'job-11111111-fixture')
  fs.mkdirSync(jobDir, { recursive: true })
  const file = path.join(jobDir, 'master.mp4')
  fs.writeFileSync(file, Buffer.from('not really an mp4, but it is bytes'))
  const key = 'k'.repeat(43)
  fs.writeFileSync(path.join(workRoot, 'jobs.json'), JSON.stringify([{
    id: jobId, state: 'done', error: null, qc: { passed: true }, file, workDir: jobDir,
    downloadKey: key, queuedAt: Date.now(), startedAt: Date.now(), finishedAt: Date.now(), seconds: 30,
  }]))

  // ── the restart ────────────────────────────────────────────────────────
  w.child.kill('SIGKILL')
  await sleep(400)
  w = boot(PORT, workRoot)
  await waitUp(PORT)
  await sleep(300)
  ok('the worker says how many renders it restored', /restored/.test(w.log()), w.log().slice(-160))

  const after = await get(PORT, `/jobs/${jobId}/file?key=${key}`)
  ok('a finished film survives a restart', after.status === 200 || after.status === 206,
    `${after.status} ${after.body.slice(0, 80)}`)
  ok('...and comes back as video, not as an error', /video\//.test(after.headers['content-type'] || ''),
    after.headers['content-type'])
  ok('...with the disposition the caller asked for', /inline/.test(after.headers['content-disposition'] || ''),
    after.headers['content-disposition'])

  const dl = await get(PORT, `/jobs/${jobId}/file?key=${key}&download=1`)
  ok('download=1 still forces an attachment after a restart',
    /attachment/.test(dl.headers['content-disposition'] || ''), dl.headers['content-disposition'])

  const wrong = await get(PORT, `/jobs/${jobId}/file?key=${'z'.repeat(43)}`)
  ok('a wrong key is still refused', wrong.status === 401, String(wrong.status))

  const gone = await get(PORT, `/jobs/99999999-2222-4333-8444-555555555555/file?key=${key}`)
  ok('an unknown job is still refused', gone.status === 401, String(gone.status))

  // A row whose file has been deleted must not be restored — it would hand out
  // a key that resolves to nothing, which is the bug being fixed.
  fs.rmSync(file)
  w.child.kill('SIGKILL'); await sleep(400)
  w = boot(PORT, workRoot); await waitUp(PORT); await sleep(300)
  const orphan = await get(PORT, `/jobs/${jobId}/file?key=${key}`)
  ok('a row whose file has gone is not restored', orphan.status === 401, String(orphan.status))
  ok('...and it says it restored none', /0 renders restored/.test(w.log()), w.log().slice(-120))

  w.child.kill('SIGKILL')
  fs.rmSync(workRoot, { recursive: true, force: true })

  // ── the source, for the parts a live worker cannot show ────────────────
  const src = fs.readFileSync(ENTRY, 'utf8')
  ok('the queue drains up to the concurrency limit', /while \(running < CONCURRENCY && queue\.length\)/.test(src))
  ok('a transient failure is retried', /job\.attempt < MAX_ATTEMPTS/.test(src))
  ok('...but a bad timeline is not retried forever',
    /const transient = /.test(src) && /ffmpeg\|ECONN/.test(src))
  ok('the index is written atomically', /renameSync\(tmp, INDEX_FILE\)/.test(src))
  ok('...and debounced, so progress ticks do not thrash the disk', /if \(indexTimer\) return/.test(src))
  ok('the sweep rewrites the index after deleting', /if \(dirty\) saveIndex\(\)/.test(src))
  ok('work directories live under the persistent root', /mkdtempSync\(path\.join\(WORK_ROOT/.test(src))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.log('  FAIL: suite crashed —', e.message); process.exit(1) })
