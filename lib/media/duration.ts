// lib/media/duration.ts
//
// How long is this audio file?
//
// A question with a surprisingly bad answer, which is why it is written once.
//
// `generate-voiceover` returns `{ success, publicUrl, fileName, provider }` and
// NO DURATION. The campaign runner assumed it did — read `seconds` off the
// response, got `undefined`, and would have put a voice clip of zero length on
// every film in every campaign. Silent films, no error.
//
// The measurement itself has a browser quirk that the fallback exists for: a
// streamed MP3 often reports `duration === Infinity` on `loadedmetadata`,
// because the browser has the header but not the length. Seeking far past the
// end forces it to resolve, which is what the absurd `currentTime` is doing.
// Some files still refuse, so there is a text-based estimate behind it — a
// wrong-but-close duration produces a film that needs trimming, where a zero
// produces a film with no voice at all.

/** Roughly what a news read runs at in Romanian, measured across this Studio's own voices. */
export const CHARS_PER_SECOND = 14

/** Estimate from the script, for when the file will not say. */
export const secondsFromText = (text: string): number =>
  Math.max(1, Math.ceil((text || '').trim().length / CHARS_PER_SECOND))

/**
 * Measure an audio file in the browser.
 *
 * Resolves 0 rather than rejecting: a duration that could not be measured is a
 * normal outcome here, and a caller that has to try/catch around a measurement
 * ends up not measuring.
 */
export function audioDuration(url: string): Promise<number> {
  return new Promise(resolve => {
    if (typeof Audio === 'undefined') return resolve(0)
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => {
      if (isFinite(a.duration) && a.duration > 0) return resolve(a.duration)
      // Streamed MP3: the header is there, the length is not. Seeking past the
      // end makes the browser work it out.
      a.currentTime = 1e101
      a.ontimeupdate = () => { a.ontimeupdate = null; resolve(isFinite(a.duration) ? a.duration : 0) }
    }
    a.onerror = () => resolve(0)
    a.src = url
  })
}

/** Measured if possible, estimated if not. Never zero when there is text. */
export async function voiceSeconds(url: string, script: string): Promise<number> {
  const measured = await audioDuration(url)
  return measured > 0 ? measured : secondsFromText(script)
}
