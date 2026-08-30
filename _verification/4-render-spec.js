const T = require('/tmp/tlout/index.js')
let pass=0, fail=0
const ok=(n,c,e='')=>{ if(c) pass++; else {fail++; console.log('  FAIL:',n,e)} }

const legacy = {
  aspect:'16:9',
  scenes:[
    { id:'a', kind:'image', url:'https://x/1.jpg', name:'Deschidere', duration:4, kb:'in' },
    { id:'b', kind:'image', url:'https://x/2.jpg', name:'Pan',        duration:5, kb:'left' },
    { id:'c', kind:'video', url:'https://x/3.mp4', name:'Ioana',      duration:6, kb:'none' },
  ],
  cues:[{start:0,end:2.4,text:'Bună seara.'},{start:2.4,end:5,text:'Iată știrile.'}],
  voUrl:'https://x/vo.mp3', voDur:15,
  musicUrl:'https://x/bed.mp3', musicVol:0.18,
  subsOn:true, subScale:1, subPos:'jos',
}
const tl = T.migrateLegacyProject(legacy, { fps: T.FPS.pal })
const edit = T.toShotstackEdit(tl)

// --- output block ---
ok('format is mp4', edit.output.format === 'mp4')
ok('renders at the master size', edit.output.size.width === 1920 && edit.output.size.height === 1080,
   JSON.stringify(edit.output.size))
ok('fps carried from the timebase', edit.output.fps === 25, String(edit.output.fps))
ok('quality defaults to high', edit.output.quality === 'high')
ok('size override is honoured',
   T.toShotstackEdit(tl,{size:{width:1280,height:720}}).output.size.width === 1280)

// --- layering: Shotstack puts the FIRST track on top ---
const first = edit.timeline.tracks[0].clips[0]
ok('captions are on the first (top) track', first.asset.type === 'html', first.asset.type)
const kinds = edit.timeline.tracks.map(t => t.clips[0].asset.type)
ok('picture sits below captions', kinds.indexOf('html') < kinds.indexOf('image'), JSON.stringify(kinds))
ok('every track has clips', edit.timeline.tracks.every(t => t.clips.length > 0))

// --- picture clips ---
const pictureTrack = edit.timeline.tracks.find(t => ['image','video'].includes(t.clips[0].asset.type))
ok('all three scenes present', pictureTrack.clips.length === 3, String(pictureTrack.clips.length))
ok('starts are seconds, not frames', pictureTrack.clips[1].start === 4, String(pictureTrack.clips[1].start))
ok('lengths are seconds', pictureTrack.clips[1].length === 5, String(pictureTrack.clips[1].length))
ok('butt-joined with no gap',
   pictureTrack.clips[0].start + pictureTrack.clips[0].length === pictureTrack.clips[1].start)
ok('fit carried', pictureTrack.clips[0].fit === 'cover')

// --- Ken Burns -> preset ---
ok('zoom in became zoomIn', pictureTrack.clips[0].effect === 'zoomIn', String(pictureTrack.clips[0].effect))
ok('pan left became slideLeft', pictureTrack.clips[1].effect === 'slideLeft', String(pictureTrack.clips[1].effect))
ok('static scene has no effect', pictureTrack.clips[2].effect === undefined, String(pictureTrack.clips[2].effect))

// --- video clip: trim and muted like the old renderer ---
const vid = pictureTrack.clips[2]
ok('video asset carries trim', typeof vid.asset.trim === 'number', JSON.stringify(vid.asset))
ok('video is muted', vid.asset.volume === 0, String(vid.asset.volume))

// --- audio ---
const audioTracks = edit.timeline.tracks.filter(t => t.clips[0].asset.type === 'audio')
ok('voice and music both present', audioTracks.length === 2, String(audioTracks.length))
const allAudio = audioTracks.flatMap(t => t.clips)
ok('voice at unity', allAudio.some(c => c.asset.src.includes('vo.mp3') && c.asset.volume === 1))
ok('music at the slider level', allAudio.some(c => c.asset.src.includes('bed.mp3') && Math.abs(c.asset.volume - 0.18) < 1e-6))

// --- captions ---
const cap = edit.timeline.tracks[0].clips[0]
ok('caption html contains the text', cap.asset.html.includes('Bună seara.'), cap.asset.html)
ok('caption css sets a font size in px', /font-size:\d+px/.test(cap.asset.css), cap.asset.css)
ok('caption is centred with an offset', cap.position === 'center' && typeof cap.offset.y === 'number')
// y is flipped: the timeline puts captions at 0.88 from the top => below centre
ok('offset y is flipped for Shotstack', cap.offset.y < 0, String(cap.offset.y))
ok('offset x is centred', Math.abs(cap.offset.x) < 1e-9, String(cap.offset.x))

const nasty = T.toShotstackEdit(T.migrateLegacyProject({
  aspect:'16:9', scenes:[{id:'a',kind:'image',url:'u',name:'n',duration:2,kb:'none'}],
  cues:[{start:0,end:2,text:'A & B <script> "x"'}], subsOn:true,
}))
ok('caption html is escaped',
   nasty.timeline.tracks[0].clips[0].asset.html.includes('&amp;') &&
   nasty.timeline.tracks[0].clips[0].asset.html.includes('&lt;script&gt;'),
   nasty.timeline.tracks[0].clips[0].asset.html)

// --- limitations are reported, not hidden ---
const limits = T.describeLimitations(tl)
const msgs = limits.map(l=>l.message).join(' | ')
ok('motion curves reported as lossy', /nearest preset/.test(msgs), msgs)
ok('ducking reported as not applied', /Ducking is not applied/.test(msgs), msgs)
ok('a flat timeline reports nothing',
   T.describeLimitations(T.migrateLegacyProject({
     aspect:'16:9', scenes:[{id:'a',kind:'image',url:'u',name:'n',duration:2,kb:'none'}],
   })).length === 0)

// --- provider response adapters ---
ok('shotstack id', T.readJobId('shotstack', {success:true,response:{id:'abc-123'}}) === 'abc-123')
ok('creatomate id', T.readJobId('creatomate', [{id:'cm-1',status:'planned'}]) === 'cm-1')
ok('missing id returns null', T.readJobId('shotstack', {success:false}) === null)
ok('shotstack done', T.readJobStatus('shotstack',{response:{status:'done',url:'https://x/o.mp4'}}).state === 'done')
ok('shotstack url', T.readJobStatus('shotstack',{response:{status:'done',url:'https://x/o.mp4'}}).url === 'https://x/o.mp4')
ok('shotstack queued', T.readJobStatus('shotstack',{response:{status:'queued'}}).state === 'queued')
ok('shotstack fetching counts as queued', T.readJobStatus('shotstack',{response:{status:'fetching'}}).state === 'queued')
ok('shotstack rendering', T.readJobStatus('shotstack',{response:{status:'rendering'}}).state === 'rendering')
ok('shotstack failed', T.readJobStatus('shotstack',{response:{status:'failed',error:'bad src'}}).message === 'bad src')
ok('creatomate succeeded maps to done', T.readJobStatus('creatomate',[{status:'succeeded',url:'u'}]).state === 'done')
ok('creatomate failed carries the message',
   T.readJobStatus('creatomate',[{status:'failed',error_message:'nope'}]).message === 'nope')
ok('empty response fails safely', T.readJobStatus('shotstack', null).state === 'failed')

// --- cost ---
const secs = T.billableSeconds(tl)
ok('billable seconds is the longest track', Math.abs(secs - 15) < 0.05, String(secs))
ok('cost at $0.20/min', Math.abs(T.estimateCostUsd(tl) - (15/60)*0.2) < 1e-9, String(T.estimateCostUsd(tl)))
ok('payg rate is higher', T.RENDER_RATES.shotstack.payAsYouGoPerMinute > T.RENDER_RATES.shotstack.subscriptionPerMinute)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail?1:0)
