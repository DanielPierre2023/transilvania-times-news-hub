// render-worker/src/index.js
//
// The render worker's HTTP face.
//
// It is a public endpoint that spends CPU and disk on request, so it refuses
// anything without the shared secret. Renders run one at a time: a second
// concurrent 1080p job on a small container does not finish twice as fast, it
// makes both slower and risks running the box out of memory.

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

const { renderTimeline } = require('./render')
const { inspect } = require('./qc')
const { analyseClip, judge, selectBest, DEFAULT_SPEC } = require('./vision')
const timeline = require('./timeline')

const PORT = Number(process.env.PORT || 8080)
const TOKEN = process.env.RENDER_WORKER_TOKEN || ''
const MAX_SECONDS = Number(process.env.MAX_RENDER_SECONDS || 600)
// SEVEN DAYS, NOT SIX HOURS.
//
// Six hours was defensible when a restart destroyed everything anyway. Now that
// the index survives, retention is the only thing deciding how long an approved
// version stays downloadable, and "until tomorrow morning" is not an answer for
// a review workflow. The Studio also mirrors finished renders into storage, so
// this is the fast path rather than the only copy.
const RETENTION_MS = Number(process.env.JOB_RETENTION_MS || 7 * 24 * 60 * 60 * 1000)
// Inspection costs CPU per take. Six is enough to choose from and small enough
// that a mistyped request cannot occupy the box for an hour.
const MAX_TAKES = Number(process.env.MAX_TAKES || 6)

// HOW MANY FILMS AT ONCE, AND WHERE THE INDEX LIVES.
//
// Concurrency used to be a single boolean called `running`, so two people
// rendering meant one waited behind the other for the full three-times-realtime.
// ffmpeg already uses every core it can find, so this is deliberately small: two
// jobs is enough to stop one person blocking another, and more than that just
// makes both slower. Set RENDER_CONCURRENCY if the box is bigger.
const CONCURRENCY = Math.max(1, Number(process.env.RENDER_CONCURRENCY || 2))

// A render that dies on a transient fetch or a killed ffmpeg is retried once.
// Not more: a job that fails twice is failing for a reason, and burning a third
// three-minute render on it delays everyone behind it.
const MAX_ATTEMPTS = Math.max(1, Number(process.env.RENDER_ATTEMPTS || 2))

// THE JOB INDEX SURVIVES A RESTART.
//
// Jobs lived only in a Map and the download key was checked against it, so a
// sweep or a redeploy turned every finished render into a 401 with the file
// gone. Three of the four links on a live Studio page were already dead when
// this was measured. Railway restarts on every deploy, so "the worker restarted"
// is not an edge case — it is Tuesday.
//
// The index is a single JSON file rewritten atomically next to the work
// directories. It holds no timelines and no video, only what is needed to serve
// a finished file: id, state, key, path, QC.
const WORK_ROOT = process.env.RENDER_WORK_ROOT || path.join(os.tmpdir(), 'tt-render')
const INDEX_FILE = path.join(WORK_ROOT, 'jobs.json')

/** ffmpeg will happily open a local path or a pipe; this endpoint must not. */
function isFetchable(u) {
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch { return false }
}

const STARTED_AT = Date.now()
const jobs = new Map()
const queue = []
let running = 0            // how many renders are in flight, not whether one is

fs.mkdirSync(WORK_ROOT, { recursive: true })

/** Only the fields needed to serve a finished file after a restart. */
function indexable(job) {
  return {
    id: job.id, state: job.state, error: job.error || null, qc: job.qc || null,
    file: job.file || null, workDir: job.workDir, downloadKey: job.downloadKey || null,
    queuedAt: job.queuedAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
    seconds: job.result?.durationSeconds ?? job.seconds ?? null,
  }
}

let indexTimer = null
function saveIndex() {
  // Debounced and atomic: progress updates fire many times a second, and a
  // half-written index is worse than a missing one.
  if (indexTimer) return
  indexTimer = setTimeout(() => {
    indexTimer = null
    try {
      const done = [...jobs.values()].filter(j => j.state.startsWith('done') || j.state === 'failed')
      const tmp = INDEX_FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(done.map(indexable)))
      fs.renameSync(tmp, INDEX_FILE)
    } catch (e) { console.error('job index not written:', e.message) }
  }, 400)
  if (indexTimer.unref) indexTimer.unref()
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return 0
    const rows = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'))
    let restored = 0
    for (const r of rows) {
      // A row whose file has gone is not worth restoring: it would hand out a
      // key that resolves to nothing, which is the failure we are fixing.
      if (!r.file || !fs.existsSync(r.file)) continue
      jobs.set(r.id, { ...r, timeline: null, progress: null, result: null, restored: true })
      restored++
    }
    return restored
  } catch (e) { console.error('job index not read:', e.message); return 0 }
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function authorised(req) {
  if (!TOKEN) return false // fail closed: an unset secret is not an open door
  const header = req.headers.authorization || ''
  const supplied = header.replace(/^Bearer\s+/i, '').trim()
  if (supplied.length !== TOKEN.length) return false
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(TOKEN))
}

function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')) }
      catch (e) { reject(new Error('Body is not valid JSON: ' + e.message)) }
    })
    req.on('error', reject)
  })
}

async function pump() {
  while (running < CONCURRENCY && queue.length) startOne()
}

async function startOne() {
  const job = queue.shift()
  if (!job) return
  running += 1
  job.state = 'rendering'
  job.attempt = (job.attempt || 0) + 1
  job.startedAt = job.startedAt || Date.now()

  try {
    const result = await renderTimeline(job.timeline, {
      workDir: job.workDir,
      output: path.join(job.workDir, `master.${job.timeline.delivery?.codec === 'prores422' ? 'mov' : 'mp4'}`),
      onProgress: p => { job.progress = p },
    })
    job.result = result
    job.qc = await inspect(result.output, {
      width: result.width,
      height: result.height,
      fps: result.fps,
      frames: result.frames,
      durationSeconds: result.durationSeconds,
      loudness: job.timeline.delivery?.loudness || 'social',
      fonts: result.fonts,
    })
    job.file = result.output
    job.downloadKey = crypto.randomBytes(32).toString('base64url')
    job.state = job.qc.passed ? 'done' : 'done_with_warnings'
    saveIndex()
  } catch (err) {
    // ONE RETRY, AND ONLY FOR THE FAILURES THAT ARE WORTH RETRYING.
    // A killed ffmpeg or a source that timed out is usually transient. A
    // timeline the validator would have rejected is not, and retrying it just
    // spends another three minutes arriving at the same answer.
    const transient = /ffmpeg|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|429|502|503|504/i.test(err.message)
    if (transient && job.attempt < MAX_ATTEMPTS) {
      job.state = 'queued'
      job.error = null
      job.retryOf = err.message
      queue.push(job)
      console.error(`job ${job.id} attempt ${job.attempt} failed (${err.message}) — retrying`)
    } else {
      job.state = 'failed'
      job.error = err.message
    }
  } finally {
    if (job.state !== 'queued') job.finishedAt = Date.now()
    running -= 1
    saveIndex()
    setImmediate(pump)
  }
}

function publicJob(job) {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress || null,
    error: job.error || null,
    qc: job.qc || null,
    seconds: job.result?.durationSeconds ?? null,
    renderSeconds: job.finishedAt ? (job.finishedAt - job.startedAt) / 1000 : null,
    // A one-time key, scoped to this job and gone when the job is swept. It
    // lets a browser fetch the finished file directly without ever holding the
    // worker's token — the same idea as a storage signed URL. The key only
    // appears once the render is finished, so it cannot be handed out early.
    downloadKey: job.state.startsWith('done') ? job.downloadKey : null,
    path: job.state.startsWith('done') ? `/jobs/${job.id}/file` : null,
  }
}

function sweep() {
  const now = Date.now()
  let dirty = false
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > RETENTION_MS) {
      try { fs.rmSync(job.workDir, { recursive: true, force: true }) } catch { /* gone */ }
      jobs.delete(id)
      dirty = true
    }
  }
  if (dirty) saveIndex()
}
setInterval(sweep, 15 * 60 * 1000).unref()

/**
 * Serves the master, with byte-range support.
 *
 * Without ranges a browser can start a video but cannot SCRUB it — every seek
 * silently snaps back to zero. That makes the preview useless for review, which
 * is exactly when you need to check a frame at 0:12. Range handling is the
 * difference between a player and a download.
 *
 * Disposition WAS unconditionally `inline`, with a comment claiming that this
 * "plays in a tab as well as downloading". It does not. `inline` is precisely
 * the instruction NOT to download: the browser opens the video and plays it,
 * and the Descarcă button did nothing but navigate. Reported as "opens in a new
 * browser but no download", which is exactly what the header asked for.
 *
 * So the caller chooses. `?download=1` sends `attachment` and the browser saves
 * it; without it the file still streams inline for review, ranges and all.
 */
function sendFile(res, job, req) {
  if (!job || !job.file || !fs.existsSync(job.file)) {
    return json(res, 409, { error: `Job is ${job ? job.state : 'unknown'}` })
  }
  const stat = fs.statSync(job.file)
  const total = stat.size
  const name = path.basename(job.file)
  const wantsDownload = (() => {
    try {
      const q = new URL(req && req.url ? req.url : '/', 'http://localhost').searchParams.get('download')
      return q === '1' || q === 'true'
    } catch { return false }
  })()
  const base = {
    'Content-Type': job.file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
    'Content-Disposition': `${wantsDownload ? 'attachment' : 'inline'}; filename="${name}"`,
    'Accept-Ranges': 'bytes',
    // The key is a capability, not a session. Never let a proxy keep the file.
    'Cache-Control': 'private, no-store',
  }

  const header = req && req.headers ? req.headers.range : null
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(String(header).trim()) : null

  if (match) {
    const hasStart = match[1] !== ''
    const hasEnd = match[2] !== ''
    let start
    let end
    if (!hasStart && hasEnd) {
      // "bytes=-500" means the LAST 500 bytes, not the first 500.
      const suffix = Number(match[2])
      start = Math.max(0, total - suffix)
      end = total - 1
    } else {
      start = hasStart ? Number(match[1]) : 0
      end = hasEnd ? Math.min(Number(match[2]), total - 1) : total - 1
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${total}` })
      return res.end()
    }

    res.writeHead(206, { ...base, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}` })
    return fs.createReadStream(job.file, { start, end }).pipe(res)
  }

  res.writeHead(200, { ...base, 'Content-Length': total })
  return fs.createReadStream(job.file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  // Only the finished file is ever fetched cross-origin, and only with a job
  // key. Everything else is called server-to-server by the edge function.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  // Without this a cross-origin fetch cannot READ the disposition it was sent,
  // which makes the header untestable from the browser that depends on it.
  res.setHeader('Access-Control-Expose-Headers', 'content-disposition, content-length, content-range')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  if (url.pathname === '/health') {
    // WHICH CODE IS ACTUALLY RUNNING.
    //
    // Railway has silently served a stale build more than once in this
    // project's life — a GitHub App without repo access, auto-deploy off, a
    // Redeploy that rebuilt the same snapshot. Every one of those cost an hour
    // of debugging the wrong thing, because /health said "ok" either way.
    //
    // So health now reports the live gate thresholds. They change whenever the
    // measurement changes, which makes them a fingerprint of the deployed
    // code that needs no build metadata and cannot drift out of date.
    return json(res, 200, {
      ok: true,
      running,
      concurrency: CONCURRENCY,
      queued: queue.length,
      jobs: jobs.size,
      retention: RETENTION_MS,
      startedAt: new Date(STARTED_AT).toISOString(),
      spec: DEFAULT_SPEC,
    })
  }

  // The finished file may also be fetched with the job's own download key, so
  // a browser can download a render without being given the worker's token.
  const fileRoute = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})\/file$/i)
  const suppliedKey = url.searchParams.get('key') || ''
  if (req.method === 'GET' && fileRoute && suppliedKey) {
    const job = jobs.get(fileRoute[1])
    const expected = job?.downloadKey || ''
    const keyOk =
      expected.length > 0 &&
      suppliedKey.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(suppliedKey), Buffer.from(expected))
    if (!keyOk) return json(res, 401, { error: 'Unauthorized' })
    return sendFile(res, job, req)
  }

  if (!authorised(req)) return json(res, 401, { error: 'Unauthorized' })

  if (req.method === 'POST' && url.pathname === '/render') {
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }

    const tl = body.timeline
    if (!tl || typeof tl !== 'object') return json(res, 400, { error: 'timeline is required' })

    const problems = timeline.validate(tl).filter(p => p.severity === 'error')
    if (problems.length) {
      return json(res, 400, { error: 'Timeline is not renderable', problems })
    }

    const seconds = timeline.framesToSeconds(tl.duration, tl.timebase.fps)
    if (seconds > MAX_SECONDS) {
      return json(res, 400, {
        error: `Job is ${Math.round(seconds)}s, over the ${MAX_SECONDS}s cap.`,
      })
    }

    const id = crypto.randomUUID()
    const job = {
      id,
      timeline: tl,
      state: 'queued',
      workDir: fs.mkdtempSync(path.join(WORK_ROOT, `job-${id.slice(0, 8)}-`)),
      queuedAt: Date.now(),
    }
    jobs.set(id, job)
    queue.push(job)
    setImmediate(pump)
    return json(res, 202, { ...publicJob(job), queuePosition: queue.length })
  }

  // ── /inspect ───────────────────────────────────────────────────────────
  // The closed loop. Give it the takes a generator produced and the still they
  // were grown from; it measures each one and says which — if any — is usable.
  //
  // This is the endpoint the rest of the market does not have. Every other tool
  // generates, shows you the result, and lets you decide. A shot that goes
  // nowhere while its pixels boil is a measurable defect, and measuring it is
  // what makes an unattended reshoot possible.
  if (req.method === 'POST' && url.pathname === '/inspect') {
    let body
    try { body = await readBody(req) } catch (e) { return json(res, 400, { error: e.message }) }

    const raw = Array.isArray(body.clips) ? body.clips : []
    if (!raw.length) return json(res, 400, { error: 'clips is required' })
    if (raw.length > MAX_TAKES) {
      return json(res, 400, { error: `At most ${MAX_TAKES} takes per call, got ${raw.length}.` })
    }

    const clips = []
    for (const c of raw) {
      const u = typeof c === 'string' ? c : String(c?.url || '')
      if (!isFetchable(u)) return json(res, 400, { error: `Not a fetchable http(s) URL: ${u.slice(0, 80)}` })
      clips.push({ id: typeof c === 'string' ? null : (c.id ?? null), url: u })
    }

    const referenceImage = String(body.referenceImage || body.reference_image || '').trim() || null
    if (referenceImage && !isFetchable(referenceImage)) {
      return json(res, 400, { error: 'referenceImage must be an http(s) URL' })
    }

    const spec = body.spec && typeof body.spec === 'object' ? body.spec : {}
    const samples = Math.max(3, Math.min(10, Number(body.samples) || 6))

    // Sequential on purpose: this box renders too, and two ffmpeg fan-outs at
    // once make both slower rather than either faster.
    const takes = []
    for (const clip of clips) {
      try {
        const analysis = await analyseClip(clip.url, { samples, referenceImage })
        takes.push({ ...clip, ok: true, analysis, judgement: judge(analysis, spec) })
      } catch (err) {
        // An unreadable take is a failed take, not a failed request — the other
        // takes still deserve to be scored.
        takes.push({
          ...clip, ok: false, error: err.message, analysis: null,
          judgement: { accepted: false, score: 0, checks: [], failed: ['the take could be read at all'] },
        })
      }
    }

    const best = selectBest(takes.map(t => t.judgement))
    return json(res, 200, {
      takes,
      best: best.index >= 0
        ? { index: best.index, id: takes[best.index].id, url: takes[best.index].url, score: best.score }
        : null,
      anyAccepted: best.anyAccepted,
      // Said plainly so the caller does not have to interpret the numbers.
      verdict: best.anyAccepted
        ? `${takes.filter(t => t.judgement.accepted).length} of ${takes.length} takes are usable.`
        : `All ${takes.length} takes were rejected — reshoot.`,
    })
  }

  const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})(\/file)?$/i)
  if (req.method === 'GET' && match) {
    const job = jobs.get(match[1])
    if (!job) return json(res, 404, { error: 'No such job' })
    if (!match[2]) return json(res, 200, publicJob(job))
    return sendFile(res, job, req)
  }

  return json(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  if (!TOKEN) {
    console.error('RENDER_WORKER_TOKEN is not set — every request will be refused. Set it and redeploy.')
  }
  // Finished films come back after a redeploy instead of turning into 401s.
  const restored = loadIndex()
  console.log(`render worker listening on ${PORT} · concurrency ${CONCURRENCY} · ${restored} render${restored === 1 ? '' : 's'} restored`)
})

module.exports = { server }
