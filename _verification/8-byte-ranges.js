const { execSync } = require('child_process')
const BASE = 'http://127.0.0.1:8099', TOKEN = 'test-secret-token-0123456789'
let pass=0, fail=0
const ok=(n,c,e='')=>{ if(c) pass++; else {fail++; console.log('  FAIL:',n,e)} }
process.env.TIMELINE_DIST='/tmp/repo/render-worker/dist/timeline/index.js'
const T = require('/tmp/repo/render-worker/dist/timeline/index.js')
const A='/tmp/assets'
const tl = (() => { const b = T.migrateLegacyProject({
  aspect:'9:16',
  scenes:[{id:'a',kind:'image',url:`${A}/img1.png`,name:'S',duration:3,kb:'in'}],
  voUrl:`${A}/voice.wav`, voDur:3,
}, { fps: T.FPS.pal })
  return { ...b, delivery: { loudness:'social', codec:'h264', captions:['burn'] } } })()

;(async () => {
  const H = { Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json' }
  const c = await fetch(`${BASE}/render`, { method:'POST', headers:H, body: JSON.stringify({ timeline: tl }) })
  const job = await c.json()
  let f=null
  for (let i=0;i<90;i++){ await new Promise(r=>setTimeout(r,2000))
    f = await fetch(`${BASE}/jobs/${job.id}`,{headers:H}).then(r=>r.json())
    if (f.state==='failed'||f.state.startsWith('done')) break }
  ok('job finished', f.state.startsWith('done'), JSON.stringify(f).slice(0,160))
  const url = `${BASE}/jobs/${job.id}/file?key=${encodeURIComponent(f.downloadKey)}`

  const full = await fetch(url)
  const total = Number(full.headers.get('content-length'))
  ok('advertises byte ranges', full.headers.get('accept-ranges') === 'bytes', full.headers.get('accept-ranges'))
  ok('serves inline so it plays in a tab',
     (full.headers.get('content-disposition')||'').startsWith('inline'), full.headers.get('content-disposition'))

  const mid = await fetch(url, { headers: { Range: `bytes=${Math.floor(total/2)}-${Math.floor(total/2)+999}` } })
  ok('honours a mid-file range with 206', mid.status === 206, String(mid.status))
  ok('range returns exactly the bytes asked for',
     Number(mid.headers.get('content-length')) === 1000, mid.headers.get('content-length'))
  ok('reports the range correctly',
     (mid.headers.get('content-range')||'').endsWith('/'+total), mid.headers.get('content-range'))

  const suffix = await fetch(url, { headers: { Range: 'bytes=-500' } })
  ok('suffix range gives the LAST bytes, not the first',
     suffix.status===206 && Number(suffix.headers.get('content-length'))===500,
     `${suffix.status} ${suffix.headers.get('content-range')}`)

  const openEnd = await fetch(url, { headers: { Range: 'bytes=100-' } })
  ok('open-ended range runs to EOF',
     openEnd.status===206 && Number(openEnd.headers.get('content-length'))===total-100,
     openEnd.headers.get('content-range'))

  const bad = await fetch(url, { headers: { Range: `bytes=${total+50}-${total+99}` } })
  ok('range past the end is a clean 416', bad.status===416, String(bad.status))

  const junk = await fetch(url, { headers: { Range: 'bytes=abc' } })
  ok('malformed range falls back to the whole file', junk.status===200, String(junk.status))

  const bytesFull = Buffer.from(await (await fetch(url)).arrayBuffer())
  const bytesTail = Buffer.from(await (await fetch(url,{headers:{Range:'bytes=-500'}})).arrayBuffer())
  ok('tail bytes match the end of the full file',
     bytesFull.subarray(total-500).equals(bytesTail))

  console.log('\n'+pass+' passed, '+fail+' failed')
  process.exit(fail?1:0)
})().catch(e=>{console.error('THREW:',e.message);process.exit(1)})
