// lib/text/truncate.ts
//
// SHORTENING TEXT WITHOUT AMPUTATING A WORD.
//
// This exists because of one frame of a published bulletin. The lower-third
// read:
//
//   Lucrările de modernizare a străzii Pet
//
// Thirty-eight characters, ending mid-word, with half the bar empty beside it.
// Two things caused it and both are the same mistake in different clothes:
//
//   The prompt asked the model for "max 38 caractere". A headline limit shorter
//   than one line of the bar it goes into leaves the model no way to obey
//   except by cutting a word in half — and models obey character limits
//   literally.
//
//   The server-side guard was `.slice(0, 44)`, which cuts at a code unit. A
//   hard slice cannot tell the middle of a word from the end of one, so the
//   moment anything overshoots, it produces exactly the frame above.
//
// A LIMIT MUST BE MEASURED AGAINST THE SPACE IT IS FOR.
//
// The bar is 1188px wide, drawn at 34px Lora with 26px of padding, wrapping to
// at most two lines. Measured with the real font: ONE line holds about 57
// characters and two hold about 118. So 38 was not a tight limit — it was
// smaller than the space by a factor of three, for no reason anyone recorded.
//
// `_verification/68-lower-third.cjs` measures that capacity with node-canvas
// and fails if the configured limit stops fitting.

/** What the lower-third bar can hold on two lines at the render font, with room to spare. */
export const LOWER_THIRD_MAX = 70

/**
 * Shorten to at most `max` characters, ending on a whole word.
 *
 * Returns the text unchanged when it already fits — no ellipsis, no surprise.
 * When it does not fit, the cut lands on the last space before the limit, and
 * trailing punctuation left dangling by that cut is removed, because "străzii
 * Petőfi," reads as a mistake and "străzii Petőfi" reads as a headline.
 *
 * A single word longer than the limit is the one case with no good answer: it
 * is cut hard, because the alternative is returning something longer than the
 * caller asked for, and a caller that asked for a maximum meant it.
 */
export function truncateWords(text: string, max: number, ellipsis = ''): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean

  const room = Math.max(1, max - ellipsis.length)
  const cut = clean.slice(0, room + 1)          // +1 so a space exactly at the
  const lastSpace = cut.lastIndexOf(' ')        // limit still counts as a break

  const body = lastSpace > 0 ? clean.slice(0, lastSpace) : clean.slice(0, room)
  return trimDangling(body) + ellipsis
}

/** Punctuation that means nothing once the words after it are gone. */
const trimDangling = (s: string) => s.replace(/[\s,;:–—-]+$/u, '').trim()

/**
 * Does this text survive the limit untouched?
 *
 * Used by the checks rather than by the app: a limit that trims most real
 * headlines is a limit that is too small, and this is how that gets measured
 * instead of argued about.
 */
export const fitsIn = (text: string, max: number): boolean =>
  String(text ?? '').replace(/\s+/g, ' ').trim().length <= max
