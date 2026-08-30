const { execSync } = require('child_process')
process.env.TIMELINE_DIST = '/tmp/repo/render-worker/dist/timeline/index.js'
const T = require('/tmp/repo/render-worker/dist/timeline/index.js')
const fs = require('fs')

const BASE = 'http://127.0.0.1:8099'
const TOKEN = 'test-secret-token-0123456789'
let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const A = '/tmp/assets'
const tl = (() => {
  const base = T.migrateLegacyProject({
    aspect: '9:16',
    scenes: [
      { id:'a', kind:'image', url:`${A}/img1.png`, name:'S1', duration:2, kb:'in' },
      { id:'b', kind:'image', url:`${A}/img2.png`, name:'S2', duration:2, kb:'right' },
    ],
    cues: [{ start:0.2, end:2, text:'Bună seara.' }, { start:2.2, end:3.8, text:'Iată știrile.' }],
    voUrl: `${A}/voice.wav`, voDur: 3,
    musicUrl: `${A}/music.wav`, musicVol: 0.4,
    subsOn: true,
  }, { fps: T.FPS.pal })
  return { ...base, delivery: { loudness: 'broadcast', codec: 'h264', captions: ['burn'] } }
})()

;(async () => {
  // health is open; everything else is not
  const health = await fetch(`${BASE}/health`).then(r => r.json())
  ok('health responds without a token', health.ok === true)

  const noAuth = await fetch(`${BASE}/render`, { method:'POST', body:'{}' })
  ok('render refuses without a token', noAuth.status === 401, String(noAuth.status))

  const wrongAuth = await fetch(`${BASE}/render`, {
    method:'POST', headers:{ Authorization:'Bearer wrong-token-0123456789' }, body:'{}',
  })
  ok('render refuses a wrong token', wrongAuth.status === 401, String(wrongAuth.status))

  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

  const noTl = await fetch(`${BASE}/render`, { method:'POST', headers:H, body:'{}' })
  ok('render rejects a missing timeline', noTl.status === 400, String(noTl.status))

  const badTl = await fetch(`${BASE}/render`, {
    method:'POST', headers:H,
    body: JSON.stringify({ timeline: { ...tl, timebase: { ...tl.timebase, width: 1081 } } }),
  })
  const badBody = await badTl.json()
  ok('render rejects an invalid timeline', badTl.status === 400 && Array.isArray(badBody.problems),
     JSON.stringify(badBody).slice(0,140))

  const created = await fetch(`${BASE}/render`, { method:'POST', headers:H, body: JSON.stringify({ timeline: tl }) })
  const job = await created.json()
  ok('render accepts a valid job', created.status === 202 && !!job.id, JSON.stringify(job).slice(0,140))
  ok('job starts queued', ['queued','rendering'].includes(job.state), job.state)

  let final = null
  for (let i = 0; i < 120; i++) {
    await sleep(2000)
    final = await fetch(`${BASE}/jobs/${job.id}`, { headers: H }).then(r => r.json())
    if (final.state === 'failed' || final.state.startsWith('done')) break
  }
  ok('job completed', final && final.state.startsWith('done'), JSON.stringify(final).slice(0,300))
  if (!final || !final.state.startsWith('done')) { console.log('\n'+pass+' passed, '+(fail)+' failed'); process.exit(1) }

  console.log(`  rendered ${final.seconds.toFixed(1)}s of video in ${final.renderSeconds.toFixed(1)}s`)

  // ---- QC report ----
  ok('QC ran', !!final.qc && Array.isArray(final.qc.checks))
  const failed = final.qc.checks.filter(c => !c.ok)
  ok('every QC check passed', final.qc.passed === true,
     failed.map(c => `${c.name}: ${c.detail}`).join(' | '))
  const names = final.qc.checks.map(c => c.name)
  ok('QC checks the frame count', names.some(n => /frame count/.test(n)), JSON.stringify(names))
  ok('QC checks loudness against the delivery target',
     names.some(n => /-23 LUFS/.test(n)), JSON.stringify(names))
  ok('QC checks true peak', names.some(n => /true peak/i.test(n)))
  console.log('  QC: ' + final.qc.checks.map(c => `${c.ok ? 'ok' : 'FAIL'} ${c.name} (${c.detail})`).join('\n      '))

  // ---- download ----
  const file = await fetch(`${BASE}/jobs/${job.id}/file`, { headers: H })
  ok('file downloads', file.status === 200, String(file.status))
  ok('served as mp4', (file.headers.get('content-type') || '').includes('mp4'), file.headers.get('content-type'))
  const bytes = Buffer.from(await file.arrayBuffer())
  fs.writeFileSync('/tmp/served.mp4', bytes)
  ok('downloaded file is a real mp4', bytes.length > 20000, String(bytes.length))

  const probe = JSON.parse(execSync('ffprobe -v error -print_format json -show_streams /tmp/served.mp4').toString())
  const v = probe.streams.find(s => s.codec_type === 'video')
  ok('vertical master is 1080x1920', v.width === 1080 && v.height === 1920, `${v.width}x${v.height}`)

  const eb = execSync("ffmpeg -i /tmp/served.mp4 -af ebur128=peak=true -f null - 2>&1 | awk '/Summary:/,0'",
    { shell:'/bin/bash' }).toString()
  const I = Number((eb.match(/I:\s+(-?\d+\.\d+)/) || [])[1])
  ok('delivered at the broadcast target of -23 LUFS', Math.abs(I - (-23)) <= 1, String(I))
  console.log(`  broadcast delivery measured ${I} LUFS`)

  // ---- one-time download key (how the browser gets the file) ----
  ok('status carries a download key once finished', typeof final.downloadKey === 'string' && final.downloadKey.length > 30,
     String(final.downloadKey))
  ok('status carries the file path', final.path === `/jobs/${job.id}/file`, String(final.path))

  const noKey = await fetch(`${BASE}/jobs/${job.id}/file`)
  ok('file refuses with neither token nor key', noKey.status === 401, String(noKey.status))

  const badKey = await fetch(`${BASE}/jobs/${job.id}/file?key=${'x'.repeat(final.downloadKey.length)}`)
  ok('file refuses a wrong key of the same length', badKey.status === 401, String(badKey.status))

  const shortKey = await fetch(`${BASE}/jobs/${job.id}/file?key=abc`)
  ok('file refuses a short key without throwing', shortKey.status === 401, String(shortKey.status))

  const byKey = await fetch(`${BASE}/jobs/${job.id}/file?key=${encodeURIComponent(final.downloadKey)}`)
  ok('file downloads with the job key and NO token', byKey.status === 200, String(byKey.status))
  ok('key download is not cacheable', (byKey.headers.get('cache-control') || '').includes('no-store'),
     byKey.headers.get('cache-control'))
  ok('key download is CORS-readable by the browser',
     byKey.headers.get('access-control-allow-origin') === '*', byKey.headers.get('access-control-allow-origin'))
  const keyBytes = Buffer.from(await byKey.arrayBuffer())
  ok('key download is the same file as the token download', keyBytes.length === bytes.length,
     `${keyBytes.length} vs ${bytes.length}`)

  const otherJob = await fetch(`${BASE}/jobs/00000000-0000-0000-0000-000000000000/file?key=${encodeURIComponent(final.downloadKey)}`)
  ok("a job's key does not open another job", otherJob.status === 401, String(otherJob.status))

  const missing = await fetch(`${BASE}/jobs/00000000-0000-0000-0000-000000000000`, { headers: H })
  ok('unknown job is a 404', missing.status === 404, String(missing.status))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
