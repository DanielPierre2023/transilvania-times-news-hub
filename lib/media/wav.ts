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
 * Mono, at a chosen rate, for one slice of a decoded buffer.
 *
 * Averaging the channels rather than taking the left one matters for a podcast:
 * two lapel microphones are often hard-panned, and taking one channel would
 * transcribe one speaker and drop the other entirely.
 *
 * THIS FUNCTION RESAMPLES. IT DEFAULTS TO 16 kHz. READ THAT AGAIN.
 *
 * It was written for Whisper, where 16 kHz is free accuracy-wise and a third of
 * the bytes. The name does not say so, the return value is a bare Float32Array
 * that does not carry its rate, and `encodeWav` takes the rate as a SEPARATE
 * argument — three things that together make one specific mistake very easy:
 *
 *   encodeWav(monoSlice(buf, 0, buf.duration), buf.sampleRate)
 *
 * That reads correctly and is wrong. The samples are at 16 kHz; the header says
 * 48 kHz; the file plays at three times speed. It shipped, it was used to clone
 * a voice, and the clone came back sounding like a chipmunk — which is what a
 * 3× speed error sounds like when a human voice goes through it.
 *
 * Use `monoAudio` and `encodeWavFrom` below, which keep the samples and their
 * rate in one object so the two cannot be paired wrongly.
 */
export function monoSlice(
  buffer: Decoded, fromSeconds: number, toSeconds: number, outRate = TARGET_RATE,
): Float32Array {
  const rate = buffer.sampleRate
  const from = Math.max(0, Math.floor(fromSeconds * rate))
  const to = Math.min(buffer.length, Math.ceil(toSeconds * rate))
  const span = Math.max(0, to - from)
  if (span === 0) return new Float32Array(0)

  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))

  const ratio = rate / outRate
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

/**
 * Samples that carry their own rate.
 *
 * The whole point: a `Float32Array` cannot say what rate it is at, so any code
 * that passes one around has to remember, and remembering is what failed. This
 * pairs them, and `encodeWavFrom` takes the pair — so the header can no longer
 * disagree with the samples it describes.
 */
export interface MonoAudio {
  readonly samples: Float32Array
  readonly rate: number
}

/**
 * Mono at the buffer's OWN rate by default — the opposite default to `monoSlice`.
 *
 * For a transcription chunk, 16 kHz is right and free. For a voice-cloning
 * reference it is the one thing you must not do: the sample IS the thing being
 * copied, and handing the model a 16 kHz version of a voice throws away the
 * upper half of what makes it that person's voice.
 */
export function monoAudio(
  buffer: Decoded,
  fromSeconds = 0,
  toSeconds = buffer.duration,
  outRate = buffer.sampleRate,
): MonoAudio {
  return { samples: monoSlice(buffer, fromSeconds, toSeconds, outRate), rate: outRate }
}

/** A WAV whose header cannot disagree with its samples. */
export const encodeWavFrom = (audio: MonoAudio): Blob => encodeWav(audio.samples, audio.rate)

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
