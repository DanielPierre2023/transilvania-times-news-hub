const fs = require('fs')
const L = require('/tmp/tlout/loudness.js')

// --- minimal 32-bit float WAV reader --------------------------------------
function readWav(path) {
  const buf = fs.readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV: ' + path)
  }
  let pos = 12, fmt = null, dataOffset = 0, dataLength = 0
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(pos + 8),
        channels: buf.readUInt16LE(pos + 10),
        sampleRate: buf.readUInt32LE(pos + 12),
        bits: buf.readUInt16LE(pos + 22),
      }
    } else if (id === 'data') {
      dataOffset = pos + 8
      dataLength = size
    }
    pos += 8 + size + (size % 2)
  }
  if (!fmt || fmt.bits !== 32) throw new Error('expected 32-bit float WAV')
  const frames = Math.floor(dataLength / (4 * fmt.channels))
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      channels[c][i] = buf.readFloatLE(dataOffset + (i * fmt.channels + c) * 4)
    }
  }
  return { channels, sampleRate: fmt.sampleRate }
}

// ffmpeg ebur128 reference, measured on the same files
const REF = {
  A: { I: -38.1, LRA: 0.0,  note: '1 kHz tone, 48 kHz'          },
  B: { I: -32.1, LRA: 5.7,  note: 'tone / silence / tone — gates'},
  C: { I: -15.1, LRA: 0.0,  note: 'white noise'                  },
  D: { I: -31.2, LRA: 20.0, note: 'three levels — relative gate' },
  E: { I: -38.1, LRA: 0.0,  note: '1 kHz tone, 44.1 kHz'         },
}

let pass = 0, fail = 0
console.log('file  mine      ffmpeg    delta    LRA mine/ffmpeg   signal')
for (const [name, ref] of Object.entries(REF)) {
  const { channels, sampleRate } = readWav(`/tmp/lufs/${name}.wav`)
  const r = L.measureLoudness(channels, sampleRate)
  const delta = r.integrated - ref.I
  const lraDelta = r.range - ref.LRA
  const okI = Math.abs(delta) <= 0.15
  const okL = Math.abs(lraDelta) <= 0.5
  if (okI) pass++; else fail++
  if (okL) pass++; else fail++
  console.log(
    `${name}     ${r.integrated.toFixed(2).padStart(7)}  ${ref.I.toFixed(2).padStart(7)}  ` +
    `${delta >= 0 ? '+' : ''}${delta.toFixed(2).padStart(5)}   ` +
    `${r.range.toFixed(1)}/${ref.LRA.toFixed(1)}`.padEnd(16) +
    `  ${ref.note}${okI && okL ? '' : '   <-- MISMATCH'}`
  )
}

// normalisation planning
const { channels, sampleRate } = readWav('/tmp/lufs/C.wav')
const c = L.measureLoudness(channels, sampleRate)
const broadcast = L.planNormalisation(c, 'broadcast')
const social = L.planNormalisation(c, 'social')
const ok = (n, cond, extra='') => { if (cond) pass++; else { fail++; console.log('  FAIL:', n, extra) } }
ok('broadcast target is -23', broadcast.target === -23)
ok('social target is -16', social.target === -16)
ok('gain moves measured to target',
   Math.abs((c.integrated + broadcast.gainDb) - (-23)) < 1e-9)
ok('clipping is reported, not hidden', typeof broadcast.wouldClip === 'boolean')
ok('safe gain never exceeds the ceiling',
   c.samplePeakDb + 20*Math.log10(broadcast.safeGain) <= -1 + 1e-9,
   String(c.samplePeakDb + 20*Math.log10(broadcast.safeGain)))
ok('silence measures as -Infinity, not 0',
   !Number.isFinite(L.measureLoudness([new Float32Array(48000)], 48000).integrated))
ok('empty input does not throw', L.measureLoudness([], 48000).durationSeconds === 0)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail ? 1 : 0)
