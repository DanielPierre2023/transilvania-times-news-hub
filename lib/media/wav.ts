// lib/media/wav.ts
//
// Slice a long recording into pieces a transcriber will accept.
//
// WHY THIS IS DONE IN THE BROWSER AND NOT IN THE EDGE FUNCTION.
//
// Whisper takes 25 MB. An hour of podcast audio is several times that, so it
// has to be split. The obvious place is the edge function that already talks to
// Whisper — except a Deno edge function has no ffmpeg, so it cannot cut audio
// at a time offset at all. It could take a byte range and hope the file is
// constant bitrate, which is a guess that goes wrong quietly on exactly the
// files people record podcasts with.
//
// The browser can do it exactly: it already decodes the audio to measure the
// alignment envelope, and a decoded buffer can be cut at a sample. So the split
// happens here, each piece is uploaded as its own small file, and the edge
// function keeps its existing contract — one URL in, a transcript out. No
// function redeploy, and no guessing.
//
// SIXTEEN KILOHERTZ MONO, BECAUSE THAT IS WHAT SPEECH RECOGNITION USES.
// Downsampling is not a compromise here: Whisper resamples to 16 kHz itself, so
// sending 48 kHz stereo is three times the bytes for identical output. At 16 kHz
// mono, eight minutes of audio is about 15 MB — comfortably inside the limit
// with room for a file that runs slightly long.

/** Whisper's own working rate. Sending more is wasted bytes, not extra accuracy. */
export const TARGET_RATE = 16000

/** Eight minutes at 16 kHz mono ≈ 15 MB, against a 25 MB ceiling. */
export const CHUNK_SECONDS = 480

/** Repeated at the head of each later chunk, so a word cut in half survives. */
export const OVERLAP_SECONDS = 5

interface Decoded {
  readonly getChannelData: (c: number) => Float32Array
  readonly numberOfChannels: number
  readonly sampleRate: number
  readonly length: number
  readonly duration: number
}

/**
 * Mono, at the target rate, for one slice of a decoded buffer.
 *
 * Averaging the channels rather than taking the left one matters for a podcast:
 * two lapel microphones are often hard-panned, and taking one channel would
 * transcribe one speaker and drop the other entirely.
 */
export function monoSlice(buffer: Decoded, fromSeconds: number, toSeconds: number): Float32Array {
  const rate = buffer.sampleRate
  const from = Math.max(0, Math.floor(fromSeconds * rate))
  const to = Math.min(buffer.length, Math.ceil(toSeconds * rate))
  const span = Math.max(0, to - from)
  if (span === 0) return new Float32Array(0)

  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))

  const ratio = rate / TARGET_RATE
  const outLength = Math.max(1, Math.floor(span / ratio))
  const out = new Float32Array(outLength)

  for (let i = 0; i < outLength; i++) {
    const src = from + Math.floor(i * ratio)
    let acc = 0
    for (const ch of channels) acc += ch[src] || 0
    out[i] = acc / channels.length
  }
  return out
}

/** 16-bit PCM WAV. The one format every transcriber accepts without negotiation. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(bytes)
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)          // PCM header length
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, 1, true)           // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)    // byte rate
  view.setUint16(32, 2, true)           // block align
  view.setUint16(34, 16, true)          // bits
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let o = 44
  for (let i = 0; i < samples.length; i++, o += 2) {
    // Clamp before scaling: a sample above 1.0 wraps to a loud click otherwise,
    // and a clipped podcast has plenty of those.
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

/** Bytes a slice will occupy, so a caller can check before uploading. */
export const wavBytes = (seconds: number, rate = TARGET_RATE): number =>
  44 + Math.round(seconds * rate) * 2

/** Whisper's hard limit, with a margin for a file that runs slightly long. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024

export const fitsWhisper = (seconds: number): boolean => wavBytes(seconds) <= MAX_UPLOAD_BYTES
