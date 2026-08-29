const C = require('/tmp/tlout/captions.js')
const T = require('/tmp/tlout/index.js')
const L = require('/tmp/tlout/loudness.js')
let pass=0, fail=0
const ok=(n,c,e='')=>{ if(c) pass++; else {fail++; console.log('  FAIL:',n,e)} }
const pal = T.FPS.pal

// --- SRT / VTT formatting ---
const cues = [
  { start: 0,   end: 60,  text: 'Bună seara.' },
  { start: 62,  end: 150, text: 'Iată câteva din articolele publicate azi în ziarul nostru.' },
  { start: 152, end: 240, text: 'Într-un articol scris de Andrei Pop.' },
]
const srt = C.toSRT(cues, pal)
const vtt = C.toVTT(cues, pal)

ok('SRT numbers cues from 1', srt.startsWith('1\r\n'))
ok('SRT uses comma for milliseconds', /00:00:00,000 --> 00:00:02,400/.test(srt), srt.split('\r\n')[1])
ok('SRT uses CRLF', srt.includes('\r\n') && !/[^\r]\n/.test(srt))
ok('SRT ends with a blank line', srt.endsWith('\r\n\r\n'))
ok('VTT starts with the signature', vtt.startsWith('WEBVTT\n'))
ok('VTT uses a dot for milliseconds', /00:00:00\.000 --> 00:00:02\.400/.test(vtt))
ok('all three cues present in SRT', (srt.match(/-->/g)||[]).length === 3)
ok('frame 62 at 25fps is 2.480s', /00:00:02,480 --> /.test(srt), srt)

// millisecond rounding must not produce ,1000
const edge = C.toSRT([{ start: 0, end: 1, text: 'x' }], { n: 30000, d: 1001 })
ok('no ,1000 from rounding', !edge.includes(',1000'), edge)

// --- wrapping ---
const long = 'Într-un articol scris de Andrei Pop despre situația drumurilor județene din Cluj'
const lines = C.wrapCaption(long)
ok('wraps to two lines', lines.length === 2, JSON.stringify(lines))
ok('each line within 42 chars', lines.every(l => l.length <= 42), JSON.stringify(lines.map(l=>l.length)))
ok('split is balanced', Math.abs(lines[0].length - lines[1].length) < 14, JSON.stringify(lines.map(l=>l.length)))
ok('short text is not wrapped', C.wrapCaption('Bună seara.').length === 1)
ok('empty text gives no lines', C.wrapCaption('   ').length === 0)
ok('collapses whitespace', C.wrapCaption('a   b\n\nc')[0] === 'a b c')

// --- quality checks ---
const bad = [
  { start: 0,  end: 5,   text: 'Prea repede pentru citit chiar și pentru un cititor rapid.' }, // 0.2s
  { start: 5,  end: 30,  text: '' },
  { start: 25, end: 60,  text: 'Se suprapune.' },
  { start: 200, end: 400, text: 'Rămâne prea mult pe ecran, mult peste limita de șapte secunde impusă.' },
]
const probs = C.checkCaptions(bad, pal)
const msgs = probs.map(p=>p.message).join(' | ')
ok('flags a caption that is too short', /under the/.test(msgs), msgs)
ok('flags reading speed', /characters per second/.test(msgs), msgs)
ok('flags an empty caption', /Empty/.test(msgs))
ok('flags an overlap', /Overlaps/.test(msgs))
ok('flags a caption left up too long', /ceiling/.test(msgs))
ok('a clean set produces no errors',
   C.checkCaptions(cues, pal).filter(p=>p.severity==='error').length === 0,
   JSON.stringify(C.checkCaptions(cues, pal)))

// --- conform ---
const fixed = C.conformCues(bad, pal)
const after = C.checkCaptions(fixed, pal)
ok('conform removes overlaps', !after.some(p=>/Overlaps/.test(p.message)), JSON.stringify(after.map(p=>p.message)))
ok('conform extends short cues to the floor',
   fixed.every(c => (c.end - c.start) >= Math.ceil(5/6*25)),
   JSON.stringify(fixed))
ok('conform drops empty cues', fixed.every(c => c.text.length > 0), JSON.stringify(fixed.map(c=>c.text)))
ok('conform keeps chronological order',
   fixed.every((c,i) => i===0 || c.start >= fixed[i-1].start))

// --- extraction from a real timeline ---
const tl = T.migrateLegacyProject({
  aspect:'16:9',
  scenes:[{id:'a',kind:'image',url:'u',name:'n',duration:12,kb:'none'}],
  cues:[
    {start:0,end:2,text:'Bună seara.'},
    {start:2.5,end:5,text:'Iată știrile.'},
  ],
  subsOn:true,
})
const extracted = C.extractCues(tl)
ok('extracts captions from the timeline', extracted.length === 2, String(extracted.length))
ok('extracted cues are in timecode order', extracted[0].start < extracted[1].start)
ok('extraction round-trips into SRT', C.toSRT(extracted, tl.timebase.fps).includes('Bună seara.'))
ok('picture clips are not treated as captions',
   !C.toSRT(extracted, tl.timebase.fps).includes('undefined'))

// --- loudness performance on a realistic bulletin ---
const sr = 48000, secs = 180
const ch = [new Float32Array(sr*secs), new Float32Array(sr*secs)]
for (let i=0;i<ch[0].length;i++){ const v = Math.sin(2*Math.PI*220*i/sr)*0.2*(0.5+0.5*Math.sin(i/sr)); ch[0][i]=v; ch[1][i]=v }
const t0 = Date.now()
const r = L.measureLoudness(ch, sr)
const ms = Date.now()-t0
ok('measures a 3-minute stereo bulletin under 3s', ms < 3000, ms+'ms')
ok('and returns a sane number', r.integrated < 0 && r.integrated > -60, String(r.integrated))
console.log(`  (3-minute stereo measurement took ${ms} ms)`)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail?1:0)
