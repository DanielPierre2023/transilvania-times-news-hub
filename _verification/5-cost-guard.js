function specDurationSeconds(spec) {
  if (typeof spec !== 'object' || spec === null) return 0;
  const root = spec ;
  let max = 0;

  const timeline = root.timeline ;
  const tracks = timeline?.tracks;
  if (Array.isArray(tracks)) {
    for (const track of tracks) {
      const clips = (track )?.clips;
      if (!Array.isArray(clips)) continue;
      for (const clip of clips) {
        const c = clip ;
        const end = Number(c.start || 0) + Number(c.length || 0);
        if (Number.isFinite(end)) max = Math.max(max, end);
      }
    }
  }

  const source = root.source ;
  const elements = source?.elements;
  if (Array.isArray(elements)) {
    for (const element of elements) {
      const e = element ;
      const end = Number(e.time || 0) + Number(e.duration || 0);
      if (Number.isFinite(end)) max = Math.max(max, end);
    }
  }

  return max;
}


const tests = [
  ['shotstack 3 tracks', {timeline:{tracks:[{clips:[{start:0,length:4},{start:4,length:5.5}]},{clips:[{start:0,length:15.5}]}]}}, 15.5],
  ['creatomate elements', {source:{elements:[{time:0,duration:4},{time:4,duration:6},{type:'audio',time:0,duration:12}]}}, 12],
  ['empty object', {}, 0],
  ['null', null, 0],
  ['string', 'nope', 0],
  ['missing lengths', {timeline:{tracks:[{clips:[{start:2}]}]}}, 2],
  ['runaway', {timeline:{tracks:[{clips:[{start:0,length:99999}]}]}}, 99999],
];
let pass=0, fail=0;
for (const [name, input, expected] of tests) {
  const got = specDurationSeconds(input);
  if (got === expected) pass++; else { fail++; console.log('FAIL', name, 'got', got, 'want', expected); }
}
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
