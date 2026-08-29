const T = require('/tmp/tlout/index.js')
let pass = 0, fail = 0
const ok = (name, cond, extra='') => { if (cond) { pass++ } else { fail++; console.log('  FAIL:', name, extra) } }

// ---------- 1. timecode ----------
const pal = T.FPS.pal, ntsc = T.FPS.ntsc, web = T.FPS.web

ok('25fps 1 hour', T.formatTimecode(25*3600, pal) === '01:00:00:00', T.formatTimecode(25*3600, pal))
ok('25fps frame 26', T.formatTimecode(26, pal) === '00:00:01:01', T.formatTimecode(26, pal))
ok('30fps non-drop uses colon', T.formatTimecode(30, web) === '00:00:01:00', T.formatTimecode(30, web))
ok('29.97 is drop frame', T.isDropFrame(ntsc) === true)
ok('25 is not drop frame', T.isDropFrame(pal) === false)
ok('DF uses semicolon', T.formatTimecode(0, ntsc) === '00:00:00;00', T.formatTimecode(0, ntsc))
ok('DF last label before the drop', T.formatTimecode(1799, ntsc) === '00:00:59;29', T.formatTimecode(1799, ntsc))
ok('DF skips 00:01:00;00 and ;01', T.formatTimecode(1800, ntsc) === '00:01:00;02', T.formatTimecode(1800, ntsc))
ok('DF tenth minute not skipped', T.formatTimecode(17982, ntsc) === '00:10:00;00', T.formatTimecode(17982, ntsc))

// round trip across an hour
let rtFail = 0, rtExample = null
for (let f = 0; f < 30*3600; f += 7) {
  const tc = T.formatTimecode(f, ntsc)
  const back = T.parseTimecode(tc, ntsc)
  if (back !== f) { rtFail++; if (!rtExample) rtExample = [f, tc, back] }
}
ok('DF round-trip over 1 hour (15430 samples)', rtFail === 0, rtFail + ' failures, e.g. ' + JSON.stringify(rtExample))

let rtFail2 = 0
for (let f = 0; f < 25*3600; f += 11) {
  if (T.parseTimecode(T.formatTimecode(f, pal), pal) !== f) rtFail2++
}
ok('25fps round-trip over 1 hour', rtFail2 === 0, rtFail2 + ' failures')

// DF clock accuracy: at 1h the timecode should read ~01:00:00 wall time
const oneHourFrames = Math.round(29.97 * 3600)
const tc1h = T.formatTimecode(oneHourFrames, ntsc)
ok('DF tracks wall clock at 1h', tc1h.startsWith('00:59:59') || tc1h.startsWith('01:00:00'), tc1h)

ok('rejects bad timecode', T.parseTimecode('99:99:99:99', pal) === null)
ok('rejects frame >= base', T.parseTimecode('00:00:00:25', pal) === null)

// ---------- 2. migration is lossless ----------
const legacy = {
  aspect: '16:9',
  script: 'Buletin de seară',
  scenes: [
    { id:'a', kind:'image', url:'https://x/1.jpg', name:'Deschidere', duration:4,   kb:'in' },
    { id:'b', kind:'image', url:'https://x/2.jpg', name:'Csoma Botond', duration:5.5, kb:'left' },
    { id:'c', kind:'video', url:'https://x/3.mp4', name:'Ioana',      duration:6,   kb:'none' },
  ],
  cues: [
    { start:0,   end:2.4, text:'Bună seara.' },
    { start:2.4, end:5.0, text:'Iată știrile de azi.' },
    { start:5.0, end:9.0, text:'Într-un articol scris de Andrei Pop.' },
  ],
  voUrl:'https://x/vo.mp3', voDur: 15.5,
  musicUrl:'https://x/bed.mp3', musicVol: 0.18,
  subPos:'jos', subsOn:true, subScale:1, capMode:'clasic',
}
const tl = T.migrateLegacyProject(legacy)

ok('detects legacy shape', T.isLegacyProject(legacy) === true)
ok('does not treat a timeline as legacy', T.isLegacyProject(tl) === false)
ok('master upgraded to 1080p', tl.timebase.width === 1920 && tl.timebase.height === 1080,
   tl.timebase.width + 'x' + tl.timebase.height)
ok('defaults to 25 fps', T.rate(tl.timebase.fps) === 25)

const vTrack = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
const gTrack = tl.tracks.find(t => t.kind === 'video' && t.z === 10)
const aVoice = tl.tracks.find(t => t.kind === 'audio' && t.z === 0)
const aMusic = tl.tracks.find(t => t.kind === 'audio' && t.z === 1)

ok('all 3 scenes carried over', vTrack.clips.length === 3, String(vTrack.clips.length))
ok('all 3 cues carried over', gTrack.clips.length === 3, String(gTrack.clips.length))
ok('voice carried over', aVoice.clips.length === 1)
ok('music carried over', aMusic.clips.length === 1)

const expectedPicture = Math.round(4*25) + Math.round(5.5*25) + Math.round(6*25) // 100+138+150
ok('scene durations preserved exactly', vTrack.clips.reduce((s,c)=>s+c.duration,0) === expectedPicture,
   vTrack.clips.reduce((s,c)=>s+c.duration,0) + ' vs ' + expectedPicture)
ok('scenes are butt-joined, no gaps', vTrack.clips[1].start === vTrack.clips[0].duration)
ok('duration = longest track', tl.duration === Math.max(expectedPicture, Math.round(15.5*25)),
   String(tl.duration))
ok('names preserved', vTrack.clips[1].name === 'Csoma Botond')
ok('video clip muted like the old renderer', vTrack.clips[2].audio.gain === 0)

// ---------- 3. Ken Burns became real keyframes ----------
const zoomIn = vTrack.clips[0]
ok('kb:in produced a curve', typeof zoomIn.transform.scale === 'object' && Array.isArray(zoomIn.transform.scale.keys))
const s0 = T.evalNumber(zoomIn.transform.scale, 0)
const sMid = T.evalNumber(zoomIn.transform.scale, 50)
const sEnd = T.evalNumber(zoomIn.transform.scale, 99)
ok('zoom actually moves', s0 < sMid && sMid < sEnd, `${s0} ${sMid} ${sEnd}`)
ok('zoom starts at 1.0', Math.abs(s0 - 1) < 1e-9, String(s0))

const pan = vTrack.clips[1]
const p0 = T.evalPoint(pan.transform.position, 0)
const pEnd = T.evalPoint(pan.transform.position, 137)
ok('pan actually moves left', p0.x > pEnd.x, `${p0.x} -> ${pEnd.x}`)
ok('pan holds vertical', p0.y === 0.5 && pEnd.y === 0.5)

// easing clamps outside the curve
ok('before first key holds', T.evalNumber(zoomIn.transform.scale, -50) === s0)
ok('after last key holds', T.evalNumber(zoomIn.transform.scale, 99999) === T.evalNumber(zoomIn.transform.scale, 100))

// ---------- 4. compile ----------
const f0 = T.compileFrame(tl, 0)
ok('frame 0 draws picture + subtitle', f0.video.length === 2, String(f0.video.length))
ok('subtitle drawn on top', f0.video[f0.video.length-1].source.kind === 'text')
ok('frame 0 has voice + music', f0.audio.length === 2, String(f0.audio.length))
ok('time is derived from frames', f0.time === 0)

// ducking is real
const voice = f0.audio.find(a => a.duckSource)
const music = f0.audio.find(a => a.duckTarget)
ok('voice at unity', voice.gain === 1)
ok('music ducked under voice', Math.abs(music.gain - 0.18 * T.DUCK_GAIN) < 1e-9,
   `${music.gain} expected ${0.18*T.DUCK_GAIN}`)

// after the voice ends the music comes back up
const shortVo = T.migrateLegacyProject({
  aspect:'16:9',
  scenes:[{ id:'a', kind:'image', url:'https://x/1.jpg', name:'S', duration:10, kb:'none' }],
  voUrl:'https://x/vo.mp3', voDur: 4,
  musicUrl:'https://x/bed.mp3', musicVol: 0.5,
})
const duringVo  = T.compileFrame(shortVo, 25)
const afterVo   = T.compileFrame(shortVo, 200)
const mDuring = duringVo.audio.find(a => a.duckTarget)
const mAfter  = afterVo.audio.find(a => a.duckTarget)
ok('music ducked while the voice sounds', Math.abs(mDuring.gain - 0.5*T.DUCK_GAIN) < 1e-9, String(mDuring.gain))
ok('music returns to full once the voice ends', Math.abs(mAfter.gain - 0.5) < 1e-9, String(mAfter.gain))
ok('voice clip is gone after it ends', afterVo.audio.every(a => !a.duckSource))

// cover fit fills the frame
const cover = T.fitRect('cover', 16/9, {x:0,y:0,w:1080,h:1920}, 1)
ok('cover fills height and overflows width', cover.h === 1920 && cover.w > 1080, JSON.stringify(cover))
const contain = T.fitRect('contain', 16/9, {x:0,y:0,w:1080,h:1920}, 1)
ok('contain fits inside', contain.w === 1080 && contain.h < 1920, JSON.stringify(contain))
ok('contain is centred', Math.abs(contain.y - (1920-contain.h)/2) < 1e-9)

// cut points
const cuts = T.cutFrames(tl)
ok('cut list includes every scene boundary', cuts.includes(100) && cuts.includes(238), JSON.stringify(cuts.slice(0,8)))

// ---------- 5. editing ----------
let e = tl
const target = vTrack.clips[1].id
e = T.trimClip(e, target, 'head', 25)
const trimmed = T.findClip(e, target)
ok('head trim advances sourceIn', trimmed.sourceIn === 25, String(trimmed.sourceIn))
ok('head trim shortens duration', trimmed.duration === 138 - 25, String(trimmed.duration))
ok('original is untouched (immutable)', T.findClip(tl, target).duration === 138)

e = T.splitClip(tl, vTrack.clips[0].id, 40)
const vt2 = e.tracks.find(t => t.kind==='video' && t.z===0)
ok('split makes two clips', vt2.clips.length === 4, String(vt2.clips.length))
ok('split halves sum to the original', vt2.clips[0].duration + vt2.clips[1].duration === 100)
ok('right half reads further into source', vt2.clips[1].sourceIn === 40, String(vt2.clips[1].sourceIn))

// ---------- 6. validation ----------
ok('a clean timeline is renderable', T.isRenderable(tl) === true, JSON.stringify(T.validate(tl)))

const bad = T.updateClip(tl, vTrack.clips[2].id, {
  source: { kind:'video', url:'https://x/3.mp4', naturalDuration: 2 },
  duration: 150,
})
const probs = T.validate(bad)
ok('catches a trim past the end of the source',
   probs.some(p => p.severity==='error' && /Reads/.test(p.message)),
   JSON.stringify(probs))
ok('an invalid timeline is not renderable', T.isRenderable(bad) === false)

const odd = T.createTimeline({ name:'x', width: 1081, height: 1080 })
ok('catches odd dimensions for H.264',
   T.validate(odd).some(p => /even dimensions/.test(p.message)))
ok('catches an empty timeline', T.validate(odd).some(p => /empty/i.test(p.message)))

// ---------- 7. karaoke word timings survive ----------
const kara = T.migrateLegacyProject({
  aspect:'9:16',
  scenes:[{ id:'a', kind:'image', url:'https://x/1.jpg', name:'S', duration:6, kb:'none' }],
  cues:[{ start:0, end:2, text:'Bună seara tuturor' }],
  capMode:'karaoke',
  words:[
    { word:'Bună',   start:0.0, end:0.5 },
    { word:'seara',  start:0.5, end:1.2 },
    { word:'tuturor',start:1.2, end:2.0 },
  ],
  subsOn:true, subScale:1.5,
})
const kg = kara.tracks.find(t => t.kind==='video' && t.z===10)
ok('karaoke caption imported', kg.clips.length === 1)
ok('word timings preserved', kg.clips[0].source.words && kg.clips[0].source.words.length === 3,
   JSON.stringify(kg.clips[0].source.words))
ok('word timings are clip-relative frames', kg.clips[0].source.words[1].start === 13,
   String(kg.clips[0].source.words && kg.clips[0].source.words[1].start))
ok('subScale applied to caption size', Math.abs(kg.clips[0].source.style.size - 0.045*1.5) < 1e-9,
   String(kg.clips[0].source.style.size))

const noSubs = T.migrateLegacyProject({
  aspect:'9:16',
  scenes:[{ id:'a', kind:'image', url:'https://x/1.jpg', name:'S', duration:6, kb:'none' }],
  cues:[{ start:0, end:2, text:'x' }], subsOn:false,
})
ok('subsOn:false suppresses captions',
   noSubs.tracks.find(t=>t.kind==='video'&&t.z===10).clips.length === 0)

const empty = T.migrateLegacyProject({})
ok('an empty project does not throw', empty.duration === 0)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
