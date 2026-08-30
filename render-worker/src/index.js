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
const timeline = require('./timeline')

const PORT = Number(process.env.PORT || 8080)
const TOKEN = process.env.RENDER_WORKER_TOKEN || ''
const MAX_SECONDS = Number(process.env.MAX_RENDER_SECONDS || 600)
const RETENTION_MS = Number(process.env.JOB_RETENTION_MS || 6 * 60 * 60 * 1000)

const jobs = new Map()
const queue = []
let running = false

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
  if (running) return
  const job = queue.shift()
  if (!job) return
  running = true
  job.state = 'rendering'
  job.startedAt = Date.now()

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
    })
    job.file = result.output
    job.state = job.qc.passed ? 'done' : 'done_with_warnings'
  } catch (err) {
    job.state = 'failed'
    job.error = err.message
  } finally {
    job.finishedAt = Date.now()
    running = false
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
    url: job.state.startsWith('done') ? `/jobs/${job.id}/file` : null,
  }
}

function sweep() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > RETENTION_MS) {
      try { fs.rmSync(job.workDir, { recursive: true, force: true }) } catch { /* gone */ }
      jobs.delete(id)
    }
  }
}
setInterval(sweep, 15 * 60 * 1000).unref()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, running, queued: queue.length, jobs: jobs.size })
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
      workDir: fs.mkdtempSync(path.join(os.tmpdir(), `job-${id.slice(0, 8)}-`)),
      queuedAt: Date.now(),
    }
    jobs.set(id, job)
    queue.push(job)
    setImmediate(pump)
    return json(res, 202, { ...publicJob(job), queuePosition: queue.length })
  }

  const match = url.pathname.match(/^\/jobs\/([0-9a-f-]{36})(\/file)?$/i)
  if (req.method === 'GET' && match) {
    const job = jobs.get(match[1])
    if (!job) return json(res, 404, { error: 'No such job' })
    if (!match[2]) return json(res, 200, publicJob(job))
    if (!job.file || !fs.existsSync(job.file)) return json(res, 409, { error: `Job is ${job.state}` })
    const stat = fs.statSync(job.file)
    res.writeHead(200, {
      'Content-Type': job.file.endsWith('.mov') ? 'video/quicktime' : 'video/mp4',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${path.basename(job.file)}"`,
    })
    return fs.createReadStream(job.file).pipe(res)
  }

  return json(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  if (!TOKEN) {
    console.error('RENDER_WORKER_TOKEN is not set — every request will be refused. Set it and redeploy.')
  }
  console.log(`render worker listening on ${PORT}`)
})

module.exports = { server }
