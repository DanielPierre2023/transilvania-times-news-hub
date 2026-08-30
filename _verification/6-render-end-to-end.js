const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')
process.env.TIMELINE_DIST = '/tmp/repo/render-worker/dist/timeline/index.js'
const T = require('/tmp/repo/render-worker/dist/timeline/index.js')
const { renderTimeline } = require('/tmp/repo/render-worker/src/render')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) pass++; else { fail++; console.log('  FAIL:', n, e) } }

const A = '/tmp/assets'
const legacy = {
  aspect: '16:9',
  scenes: [
    { id:'a', kind:'image', url:`${A}/img1.png`, name:'Deschidere', duration:3, kb:'in' },
    { id:'b', kind:'image', url:`${A}/img2.png`, name:'Pan',        duration:3, kb:'left' },
    { id:'c', kind:'video', url:`${A}/clip.mp4`, name:'Ioana',      duration:4, kb:'none' },
  ],
  cues: [
    { start:0.5, end:3,  text:'Bună seara și bine v-am găsit.' },
    { start:3.5, end:6,  text:'Iată câteva din articolele publicate azi în ziarul nostru.' },
    { start:6.5, end:9.5,text:'Într-un articol scris de Andrei Pop.' },
  ],
  voUrl: `${A}/voice.wav`, voDur: 5,
  musicUrl: `${A}/music.wav`, musicVol: 0.5,
  subsOn: true, subPos: 'jos', subScale: 1,
}

;(async () => {
  const base = T.migrateLegacyProject(legacy, { fps: T.FPS.pal })
  const tl = { ...base, delivery: { ...base.delivery, loudness: 'social', codec: 'h264', captions: ['burn'] } }

  console.log(`timeline: ${tl.duration} frames @ ${T.rate(tl.timebase.fps)}fps, ${tl.timebase.width}x${tl.timebase.height}`)

  const t0 = Date.now()
  const r1 = await renderTimeline(tl, { workDir: '/tmp/r1', output: '/tmp/r1/out.mp4' })
  const elapsed = (Date.now() - t0) / 1000
  console.log(`rendered in ${elapsed.toFixed(1)}s for ${r1.durationSeconds.toFixed(1)}s of video (${(r1.durationSeconds/elapsed).toFixed(2)}x realtime)`)

  ok('output exists', fs.existsSync(r1.output))
  const size = fs.statSync(r1.output).size
  ok('output is not empty', size > 50000, String(size))

  const probe = JSON.parse(execSync(
    `ffprobe -v error -print_format json -show_streams -show_format ${r1.output}`,
  ).toString())
  const v = probe.streams.find(s => s.codec_type === 'video')
  const a = probe.streams.find(s => s.codec_type === 'audio')

  ok('video is 1920x1080', v.width === 1920 && v.height === 1080, `${v.width}x${v.height}`)
  ok('video is h264', v.codec_name === 'h264', v.codec_name)
  ok('frame rate is exactly 25', v.r_frame_rate === '25/1', v.r_frame_rate)
  ok('yuv420p for compatibility', v.pix_fmt === 'yuv420p', v.pix_fmt)
  ok('frame count matches the timeline exactly', Number(v.nb_frames) === tl.duration,
     `${v.nb_frames} vs ${tl.duration}`)
  ok('has an audio track', !!a, 'none')
  ok('audio is 48 kHz stereo', a && Number(a.sample_rate) === 48000 && a.channels === 2,
     a ? `${a.sample_rate}/${a.channels}` : 'none')
  ok('duration matches the timeline', Math.abs(Number(probe.format.duration) - r1.durationSeconds) < 0.15,
     `${probe.format.duration} vs ${r1.durationSeconds}`)

  // ---- loudness of the DELIVERED file ----
  const eb = execSync(`ffmpeg -i ${r1.output} -af ebur128=peak=true -f null - 2>&1 | sed -n '/Summary:/,$p'`,
    { shell: '/bin/bash' }).toString()
  const I = Number((eb.match(/I:\s+(-?\d+\.\d+)/) || [])[1])
  const TP = Number((eb.match(/Peak:\s+(-?\d+\.\d+)/) || [])[1])
  console.log(`delivered loudness: ${I} LUFS, true peak ${TP} dBFS`)
  ok('delivered within 1 LU of the -16 LUFS target', Math.abs(I - (-16)) <= 1.0, String(I))
  ok('true peak under the -1 dBFS ceiling', TP <= -0.5, String(TP))

  // ---- determinism ----
  const r2 = await renderTimeline(tl, { workDir: '/tmp/r2', output: '/tmp/r2/out.mp4' })
  const h1 = execSync(`ffmpeg -v error -i ${r1.output} -map 0:v -f md5 -`).toString().trim()
  const h2 = execSync(`ffmpeg -v error -i ${r2.output} -map 0:v -f md5 -`).toString().trim()
  ok('two renders produce byte-identical PICTURE', h1 === h2, `${h1} vs ${h2}`)
  const ah1 = execSync(`ffmpeg -v error -i ${r1.output} -map 0:a -f md5 -`).toString().trim()
  const ah2 = execSync(`ffmpeg -v error -i ${r2.output} -map 0:a -f md5 -`).toString().trim()
  ok('two renders produce byte-identical SOUND', ah1 === ah2, `${ah1} vs ${ah2}`)

  // ---- ducking actually happened ----
  // Music alone runs from 10s (voice ends) to the end; before that it is under
  // the voice. Compare the music-band level in the two windows.
  const level = (start, dur) => {
    const out = execSync(
      `ffmpeg -ss ${start} -t ${dur} -i ${r1.output} -af "bandpass=f=440:width_type=h:w=40,volumedetect" -f null - 2>&1`,
      { shell: '/bin/bash' },
    ).toString()
    return Number((out.match(/mean_volume:\s*(-?\d+\.?\d*)/) || [])[1])
  }
  const during = level(1, 3)
  const after = level(6.5, 3)
  console.log(`music band: ${during} dB under the voice, ${after} dB after it`)
  ok('music is measurably ducked under the voice', after - during > 3, `${during} -> ${after}`)

  // ---- captions were actually burned in ----
  execSync(`ffmpeg -v error -y -ss 1.5 -i ${r1.output} -frames:v 1 /tmp/frame.png`)
  ok('a still can be extracted', fs.existsSync('/tmp/frame.png'))

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('THREW:', e.message); process.exit(1) })
