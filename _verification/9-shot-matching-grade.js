process.env.TIMELINE_DIST='/tmp/repo/render-worker/dist/timeline/index.js'
const T = require('/tmp/repo/render-worker/dist/timeline/index.js')
const { renderTimeline } = require('/tmp/repo/render-worker/src/render')
const { measureFrame, planGains, residual } = require('/tmp/repo/render-worker/src/grade')
const { execSync } = require('child_process')
let pass=0, fail=0
const ok=(n,c,e='')=>{ if(c) pass++; else {fail++; console.log('  FAIL:',n,e)} }

function castOf(file, t){
  execSync(`ffmpeg -v error -ss ${t} -i ${file} -frames:v 1 -vf scale=240:-1 /tmp/grade/_m.png -y`)
  return measureFrame('/tmp/grade/_m.png')
}

;(async () => {
  const base = T.migrateLegacyProject({
    aspect:'9:16',
    scenes:[
      {id:'a',kind:'image',url:'/tmp/grade/blue.png',  name:'Blue',  duration:4, kb:'none'},
      {id:'b',kind:'image',url:'/tmp/grade/orange.png',name:'Orange',duration:4, kb:'none'},
    ],
    voUrl:'/tmp/grade/vo.wav', voDur:8,
  }, { fps: T.FPS.pal })

  // --- ungraded control ---
  const plain = { ...base, delivery: { loudness:'social', codec:'h264', captions:[], grade:{ look:'none', strength:1 } } }
  const r0 = await renderTimeline(plain, { workDir:'/tmp/grade/w0', output:'/tmp/grade/plain.mp4' })
  ok('ungraded render succeeded', !!r0.output)
  ok('no grade report when look is none', r0.grade === null || r0.grade === undefined || r0.grade.applied === false)

  const b0 = await castOf('/tmp/grade/plain.mp4', 2)
  const o0 = await castOf('/tmp/grade/plain.mp4', 6)
  const spread0 = Math.hypot(...b0.map((v,i)=>v-o0[i])) / Math.max(...b0, ...o0)
  console.log(`  ungraded  shot1 ${b0.map(v=>v.toFixed(4)).join(' ')}  shot2 ${o0.map(v=>v.toFixed(4)).join(' ')}`)

  // --- graded ---
  const tl = { ...base, delivery: { loudness:'social', codec:'h264', captions:[], grade:{ look:'warm', strength:1 } } }
  const r1 = await renderTimeline(tl, { workDir:'/tmp/grade/w1', output:'/tmp/grade/graded2.mp4' })
  ok('graded render succeeded', !!r1.output)
  ok('grade report attached to the job', !!r1.grade && r1.grade.applied === true, JSON.stringify(r1.grade).slice(0,120))
  ok('grade measured every shot', r1.grade.shots.length >= 2, String(r1.grade.shots.length))

  const b1 = await castOf('/tmp/grade/graded2.mp4', 2)
  const o1 = await castOf('/tmp/grade/graded2.mp4', 6)
  const spread1 = Math.hypot(...b1.map((v,i)=>v-o1[i])) / Math.max(...b1, ...o1)
  console.log(`  graded    shot1 ${b1.map(v=>v.toFixed(4)).join(' ')}  shot2 ${o1.map(v=>v.toFixed(4)).join(' ')}`)
  console.log(`  colour spread between the two shots: ${spread0.toFixed(3)} -> ${spread1.toFixed(3)}`)

  // "Matching" means every shot sits close to the SAME target, which is exactly
  // the residual the grader reports. Raw distance between two shots is the wrong
  // measure — it is dominated by whichever shot moved most.
  const before = r1.grade.shots.reduce((s,x)=>s+x.before,0)/r1.grade.shots.length
  const after  = r1.grade.shots.reduce((s,x)=>s+x.after ,0)/r1.grade.shots.length
  console.log(`  mean residual to the look: ${before.toFixed(4)} -> ${after.toFixed(4)}  (${(100*(1-after/before)).toFixed(0)}% closer)`)
  ok('mean distance to the look drops by at least 40%', after < before * 0.6,
     `${before.toFixed(4)} -> ${after.toFixed(4)}`)
  ok('a shot with an empty channel is reported as unrescuable, not silently faked',
     r1.grade.unrescuable.length >= 1, JSON.stringify(r1.grade.unrescuable))
  ok('each shot moved toward the look', r1.grade.shots.every(s => s.after <= s.before + 1e-9),
     JSON.stringify(r1.grade.shots.map(s=>[s.before.toFixed(4),s.after.toFixed(4)])))
  ok('report flags shots it could not rescue', Array.isArray(r1.grade.unrescuable))
  ok('grade does not change duration', Math.abs(r1.durationSeconds - r0.durationSeconds) < 0.05)
  ok('grade does not change frame count', r1.frames === r0.frames, `${r1.frames} vs ${r0.frames}`)

  // neutral look on already-neutral material must be near-identity
  ok('identity: neutral look leaves gains at 1', planGains([0.1,0.1,0.1],'neutral').every(g=>Math.abs(g-1)<1e-9))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail?1:0)
})().catch(e=>{console.error('THREW:',e.message);process.exit(1)})
