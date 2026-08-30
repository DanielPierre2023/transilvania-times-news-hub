// _verification/10-vision.cjs
//
// The measurement layer itself, against a calibration corpus with known
// properties. Set CAL_DIR if the clips live somewhere else.
const path = require('path')
const CAL = process.env.CAL_DIR || '/tmp/grade'
const v = require(path.join(__dirname, '..', 'render-worker', 'src', 'vision.js'))
let pass=0, fail=0
const ok=(n,c,e='')=>{ if(c) pass++; else {fail++; console.log('  FAIL:',n,e)} }
const W = { start:0.4, end:3.6, samples:5 }

;(async () => {
  const still = await v.analyseClip(CAL + '/cal_static.mp4', W)
  const push  = await v.analyseClip(CAL + '/cal_push.mp4',   W)
  const pan   = await v.analyseClip(CAL + '/cal_pan.mp4',    W)
  const blue  = await v.analyseClip(CAL + '/cal_pan_blue.mp4',
                  { ...W, referenceImage:CAL + '/ref_still.png' })
  const panRef= await v.analyseClip(CAL + '/cal_pan.mp4',
                  { ...W, referenceImage:CAL + '/ref_still.png' })

  // --- motion detection ---
  ok('a still image reports zero movement', still.motion.coherentPercentPerSecond === 0)
  ok('a still image reports no shimmer either', still.motion.shimmerPerSecond < 0.05,
     String(still.motion.shimmerPerSecond))
  ok('a slow push is detected as movement', push.motion.coherentPercentPerSecond > 1,
     String(push.motion.coherentPercentPerSecond))
  ok('a real pan moves more than a slow push',
     pan.motion.coherentPercentPerSecond > push.motion.coherentPercentPerSecond,
     `${pan.motion.coherentPercentPerSecond} vs ${push.motion.coherentPercentPerSecond}`)

  // --- judgements ---
  ok('a still is rejected for not moving', !v.judge(still).accepted)
  ok('the rejection names the reason', v.judge(still).failed.includes('the shot actually moves'))
  ok('a slow push is accepted', v.judge(push).accepted, JSON.stringify(v.judge(push).failed))
  ok('a real pan is accepted', v.judge(pan).accepted, JSON.stringify(v.judge(pan).failed))
  ok('requireMotion:false lets a locked-off shot through',
     v.judge(still,{requireMotion:false}).accepted)

  // --- boiling: no movement but lots of change ---
  const boiling = { motion:{coherentPercentPerSecond:0, zoomPercentPerSecond:0,
                            shimmerPerSecond:1.9, peakCoherent:0}, colour:{meanLinear:[0.1,0.1,0.1], reference:null} }
  const bj = v.judge(boiling)
  ok('a boiling shot is rejected', !bj.accepted)
  ok('boiling is named specifically, not just "no motion"',
     bj.failed.includes('not boiling in place'), JSON.stringify(bj.failed))

  // --- colour drift against the approved still ---
  // A camera move changes what is in frame, so some colour change is innocent.
  // Measured: 0.05 locked-off, 0.25 panned-honest, 1.68 panned-and-drifted.
  ok('an honest pan stays under the drift threshold',
     panRef.colour.reference.chromaDistance < 0.45,
     String(panRef.colour.reference.chromaDistance))
  ok('and a locked-off shot is closer still than a panned one',
     (await v.analyseClip(CAL + '/cal_static.mp4',{...W,referenceImage:CAL + '/ref_still.png'}))
       .colour.reference.chromaDistance < panRef.colour.reference.chromaDistance)
  ok('a blue-shifted clip is measurably far from its reference',
     blue.colour.reference.chromaDistance > panRef.colour.reference.chromaDistance * 4,
     `${blue.colour.reference.chromaDistance.toFixed(3)} vs ${panRef.colour.reference.chromaDistance.toFixed(3)}`)
  ok('the blue-shifted clip is rejected for colour', !v.judge(blue).accepted)
  ok('and the colour reason is named',
     v.judge(blue).failed.includes('holds the colour of the approved still'),
     JSON.stringify(v.judge(blue).failed))

  // --- take selection ---
  const takes = [v.judge(still), v.judge(push), v.judge(pan)]
  const sel = v.selectBest(takes)
  ok('selection ignores rejected takes', sel.index !== 0, String(sel.index))
  ok('selection returns an accepted take', takes[sel.index].accepted)
  ok('selection reports that something was usable', sel.anyAccepted === true)
  const none = v.selectBest([v.judge(still), v.judge(still)])
  ok('all-rejected returns no winner', none.index === -1 && none.anyAccepted === false)

  // --- determinism ---
  const a1 = v.judge(pan), a2 = v.judge(pan)
  ok('judging is deterministic', a1.score === a2.score && a1.accepted === a2.accepted)

  console.log(`\n  reference numbers — still ${still.motion.coherentPercentPerSecond.toFixed(2)}/${still.motion.shimmerPerSecond.toFixed(2)}` +
              `  push ${push.motion.coherentPercentPerSecond.toFixed(2)}/${push.motion.shimmerPerSecond.toFixed(2)}` +
              `  pan ${pan.motion.coherentPercentPerSecond.toFixed(2)}/${pan.motion.shimmerPerSecond.toFixed(2)}` +
              `  (move %/s / shimmer)`)
  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail?1:0)
})().catch(e=>{console.error('THREW:',e.message);process.exit(1)})
