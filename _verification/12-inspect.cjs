// _verification/12-inspect.cjs
//
// End-to-end test of the /inspect endpoint — the closed loop's public face.
// A local static server stands in for Supabase storage and serves the
// calibration corpus; the worker is started in-process with a known token.
//
// Nothing here is mocked except the asset host. The route, the auth, the
// measurement and the selection are the real ones.

const http = require('http')
const fs = require('fs')
const path = require('path')

process.env.RENDER_WORKER_TOKEN = 'test-token-' + 'x'.repeat(20)
process.env.PORT = '0'
const TOKEN = process.env.RENDER_WORKER_TOKEN

const CAL = process.env.CAL_DIR || '/tmp/grade'
const CLIPS = { still: 'cal_static.mp4', push: 'cal_push.mp4', pan: 'cal_pan.mp4', blue: 'cal_pan_blue.mp4' }
const REF = 'ref_still.png'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('  FAIL:', name, extra) } }

// ── the asset host ────────────────────────────────────────────────────────
// It MUST honour byte ranges. ffmpeg seeks an mp4 by asking for the moov atom
// near the end of the file; a server that answers every request with the first
// N bytes hands it garbage and it reports "partial file". Real storage does
// this correctly, and a stand-in that does not would test the wrong thing.
const assets = http.createServer((req, res) => {
  const file = path.join(CAL, path.basename(decodeURIComponent(req.url)))
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end() }
  const total = fs.statSync(file).size
  const type = file.endsWith('.png') ? 'image/png' : 'video/mp4'
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim())
  if (m) {
    const start = m[1] !== '' ? Number(m[1]) : Math.max(0, total - Number(m[2]))
    const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), total - 1) : total - 1
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end()
    }
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${total}`,
    })
    return fs.createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': total, 'Accept-Ranges': 'bytes' })
  fs.createReadStream(file).pipe(res)
})

function post(port, route, body, token = TOKEN) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request({
      port, path: route, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, res => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

;(async () => {
  for (const f of [...Object.values(CLIPS), REF]) {
    if (!fs.existsSync(path.join(CAL, f))) {
      console.error(`missing calibration asset ${f} in ${CAL} — set CAL_DIR`); process.exit(1)
    }
  }

  await new Promise(r => assets.listen(0, r))
  const aPort = assets.address().port
  const url = n => `http://127.0.0.1:${aPort}/${n}`

  const { server } = require('../render-worker/src/index.js')
  await new Promise(r => (server.listening ? r() : server.once('listening', r)))
  const wPort = server.address().port

  // ── health reports which gate is actually deployed ──────────────────────
  // Railway has served a stale build more than once here, and /health said
  // "ok" either way. The thresholds are the fingerprint.
  const health = await new Promise((resolve, reject) => {
    http.get({ port: wPort, path: '/health' }, r => {
      let d = ''; r.on('data', c => { d += c }); r.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
  ok('health needs no token', health.ok === true)
  ok('health names the live movement floor', typeof health.spec.minCoherentMotion === 'number')
  ok('health names the live stability ceiling', typeof health.spec.maxShimmerRatio === 'number')
  ok('and it is the ratio gate, not the absolute shimmer one that rejected good takes',
    health.spec.maxShimmer === undefined, JSON.stringify(health.spec))

  // ── auth ────────────────────────────────────────────────────────────────
  const noAuth = await post(wPort, '/inspect', { clips: [{ url: url(CLIPS.pan) }] }, '')
  ok('inspect refuses an unauthenticated caller', noAuth.status === 401, String(noAuth.status))

  // ── input validation ────────────────────────────────────────────────────
  ok('an empty batch is rejected', (await post(wPort, '/inspect', { clips: [] })).status === 400)
  const localPath = await post(wPort, '/inspect', { clips: [{ url: '/etc/passwd' }] })
  ok('a local path is refused — ffmpeg would happily have opened it',
    localPath.status === 400, JSON.stringify(localPath.body).slice(0, 120))
  const tooMany = await post(wPort, '/inspect', { clips: new Array(9).fill({ url: url(CLIPS.pan) }) })
  ok('an oversized batch is refused rather than occupying the box', tooMany.status === 400)
  const badRef = await post(wPort, '/inspect', { clips: [{ url: url(CLIPS.pan) }], referenceImage: 'file:///etc/passwd' })
  ok('a non-http reference image is refused too', badRef.status === 400)

  // ── the real thing: three takes, one of which is dead ────────────────────
  const r = await post(wPort, '/inspect', {
    clips: [
      { id: 'dead', url: url(CLIPS.still) },
      { id: 'push', url: url(CLIPS.push) },
      { id: 'pan', url: url(CLIPS.pan) },
    ],
    referenceImage: url(REF),
    samples: 5,
  })
  ok('inspect answers 200', r.status === 200, JSON.stringify(r.body).slice(0, 200))
  const t = r.body.takes || []
  ok('every take comes back', t.length === 3, String(t.length))
  ok('ids survive the round trip', t.map(x => x.id).join(',') === 'dead,push,pan')
  ok('the motionless take is rejected', t[0].judgement.accepted === false)
  ok('and the rejection names the reason', (t[0].judgement.failed || []).includes('the shot actually moves'),
    JSON.stringify(t[0].judgement.failed))
  ok('the push is accepted', t[1].judgement.accepted === true, JSON.stringify(t[1].judgement.failed))
  ok('the pan is accepted', t[2].judgement.accepted === true, JSON.stringify(t[2].judgement.failed))
  ok('a winner is chosen', r.body.best && r.body.best.index >= 0, JSON.stringify(r.body.best))
  ok('the winner is never the dead take', r.body.best.id !== 'dead')
  ok('the verdict is written in words, not just numbers', /takes are usable/.test(String(r.body.verdict)), String(r.body.verdict))
  ok('measurements are attached, not just a pass/fail',
    typeof t[1].analysis.motion.coherentPercentPerSecond === 'number' &&
    typeof t[1].analysis.motion.shimmerPerSecond === 'number')
  ok('the reference comparison ran', typeof t[1].analysis.colour.reference.chromaDistance === 'number')

  // ── all takes bad: the loop must say so, not pick the least-bad ──────────
  const allBad = await post(wPort, '/inspect', {
    clips: [{ url: url(CLIPS.still) }, { url: url(CLIPS.still) }], samples: 4,
  })
  ok('an all-rejected batch reports no winner', allBad.body.best === null, JSON.stringify(allBad.body.best))
  ok('...and says reshoot in words', /reshoot/i.test(String(allBad.body.verdict)), String(allBad.body.verdict))
  ok('...and anyAccepted is false', allBad.body.anyAccepted === false)

  // ── one unreadable take must not sink the batch ──────────────────────────
  const mixed = await post(wPort, '/inspect', {
    clips: [{ id: 'gone', url: url('does-not-exist.mp4') }, { id: 'pan', url: url(CLIPS.pan) }], samples: 4,
  })
  ok('a broken take fails alone', mixed.status === 200 && mixed.body.takes.length === 2)
  ok('the broken take is marked not-ok', mixed.body.takes[0].ok === false)
  ok('and the good take still wins', mixed.body.best && mixed.body.best.id === 'pan', JSON.stringify(mixed.body.best))

  // ── colour drift caught against the approved still ───────────────────────
  const drift = await post(wPort, '/inspect', {
    clips: [{ id: 'blue', url: url(CLIPS.blue) }], referenceImage: url(REF), samples: 5,
  })
  ok('a colour-drifted take is rejected against its still', drift.body.takes[0].judgement.accepted === false)
  ok('and the colour check is the one that named it',
    (drift.body.takes[0].judgement.failed || []).includes('holds the colour of the approved still'),
    JSON.stringify(drift.body.takes[0].judgement.failed))

  // ── spec override, so a locked-off plate can be allowed on purpose ────────
  const plate = await post(wPort, '/inspect', {
    clips: [{ url: url(CLIPS.still) }], spec: { requireMotion: false }, samples: 4,
  })
  ok('requireMotion:false lets a deliberate locked-off plate through',
    plate.body.takes[0].judgement.accepted === true, JSON.stringify(plate.body.takes[0].judgement.failed))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  server.close(); assets.close()
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
