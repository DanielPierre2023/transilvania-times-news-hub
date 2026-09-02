// lib/podcast/deliver.ts
//
// WHAT LEAVES THE BUILDING.
//
// An edited episode is not a deliverable. A published podcast episode is about
// eight files, and the reason podcast editing takes an afternoon rather than an
// hour is almost never the editing — it is assembling these afterwards, by hand,
// from a finished master:
//
//   the audio (MP3, for the RSS feed)          the video (for YouTube)
//   captions (SRT and VTT)                     chapters (two formats, see below)
//   a title                                    a description
//   show notes                                 the social clips
//
// Everything here produces one of those from things the editor already has, so
// none of it is retyped and none of it can disagree with the episode.
//
// TWO CHAPTER FORMATS, BECAUSE THE WORLD HAS TWO.
//
//   YouTube, Spotify and most podcast apps read chapters out of the DESCRIPTION
//   as plain `mm:ss Title` lines, and YouTube additionally requires the first
//   one to be at 00:00 or it ignores the entire list — a rule that silently
//   discards the chapters of anybody who starts theirs after the intro.
//
//   Podcasting 2.0 apps read a JSON file linked from the feed.
//
// Both are generated from the same chapter list, so they cannot drift.

import type { Word } from '../timeline/podcast'

export interface Chapter { readonly start: number; readonly title: string }

/** m:ss for anything under an hour, h:mm:ss above it. */
export function timecode(seconds: number, forceHours = false): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 || forceHours ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * Chapters as description lines.
 *
 * A 00:00 chapter is PREPENDED if the list does not start with one, rather than
 * the list being shipped as it is. YouTube ignores a chapter list whose first
 * entry is not at zero — the whole list, not just the first entry — so an
 * episode whose chapters start after a 40-second intro publishes with no
 * chapters at all and nothing anywhere says why.
 */
export function chapterLines(chapters: readonly Chapter[], intro = 'Introducere'): string {
  if (!chapters.length) return ''
  const list = chapters[0].start > 0.5
    ? [{ start: 0, title: intro }, ...chapters]
    : [{ ...chapters[0], start: 0 }, ...chapters.slice(1)]
  return list.map(c => `${timecode(c.start)} ${c.title}`).join('\n')
}

/** The Podcasting 2.0 chapters document. */
export function chaptersJson(chapters: readonly Chapter[], opts: { title?: string } = {}) {
  return {
    version: '1.2.0',
    ...(opts.title ? { podcastName: opts.title } : {}),
    chapters: chapters.map(c => ({ startTime: Number(c.start.toFixed(3)), title: c.title })),
  }
}

/** The transcript as running text, for the show-notes prompt and for the archive. */
export function transcriptText(words: readonly Word[], { withSpeakers = true } = {}): string {
  const out: string[] = []
  let speaker: string | null = null
  let line: string[] = []
  const flush = () => {
    if (!line.length) return
    out.push((withSpeakers && speaker ? `${speaker}: ` : '') + line.join(' ')
      .replace(/\s+([.,!?;:…])/g, '$1'))
    line = []
  }
  for (const w of words) {
    const s = w.speaker ?? ''
    if (withSpeakers && s !== speaker) { flush(); speaker = s }
    line.push(w.word)
  }
  flush()
  return out.join('\n\n')
}

/** The transcript with a timecode every so often, for a page on the site. */
export function transcriptWithTimecodes(words: readonly Word[], everySeconds = 30): string {
  const out: string[] = []
  let nextMark = 0
  let line: string[] = []
  let lineStart = 0
  const flush = () => {
    if (!line.length) return
    out.push(`[${timecode(lineStart)}] ${line.join(' ').replace(/\s+([.,!?;:…])/g, '$1')}`)
    line = []
  }
  for (const w of words) {
    if (w.start >= nextMark) { flush(); lineStart = w.start; nextMark = w.start + everySeconds }
    line.push(w.word)
  }
  flush()
  return out.join('\n\n')
}

// ── show notes ───────────────────────────────────────────────────────────
//
// THE ANSWER IS PUT THROUGH A NEWS-ARTICLE SANITISER ON THE WAY BACK, AND THE
// PROMPT IS SHAPED AROUND THAT RATHER THAN AGAINST IT.
//
// `ai-blog-assistant` is the deployed text endpoint and it runs every reply
// through `sanitizeContent`, which was written for articles. Read it and it
// does three things that would quietly wreck a structured answer:
//
//   it strips `#` headings and unwraps any line that is only **bold**;
//   it deletes a line that is exactly a conclusion heading ("Concluzii", …);
//   it DELETES THE WHOLE FINAL PARAGRAPH if it opens with "În concluzie",
//     "Pe scurt", "Astfel," and about fifteen others.
//
// So: no markdown headings, no bold-only lines, plain `CHEIE:` markers, and a
// sentinel as the last line — if anything gets eaten for looking like a
// conclusion, it is the sentinel and not the show notes.

export const NOTES_SENTINEL = 'GATA'

export function showNotesPrompt(opts: { minutes: number; speakers: string[] }): string {
  const who = opts.speakers.filter(Boolean)
  return [
    'Ai transcrierea unui episod de podcast de aproximativ ' + Math.round(opts.minutes) + ' de minute' +
      (who.length ? `, cu vorbitorii: ${who.join(', ')}.` : '.'),
    '',
    'Scrie materialele de publicare în ROMÂNĂ. Răspunde EXACT în formatul de mai jos.',
    'Fără markdown, fără titluri cu diez, fără linii scrise doar cu bold.',
    '',
    'TITLU: un titlu de maximum 70 de caractere, concret, fără clickbait',
    'SUBTITLU: o singură frază care spune despre ce e episodul',
    'DESCRIERE: două-trei paragrafe pentru descrierea din feed si de pe YouTube',
    'CUVINTE: cinci-opt cuvinte cheie separate prin virgulă',
    'CITATE: trei citate scurte din episod, fiecare pe linia lui, prefixate cu -',
    NOTES_SENTINEL,
  ].join('\n')
}

export interface ShowNotes {
  readonly title: string
  readonly subtitle: string
  readonly description: string
  readonly keywords: string[]
  readonly quotes: string[]
  /** Everything, verbatim, so nothing the parser missed is lost. */
  readonly raw: string
}

/**
 * Read the answer back, tolerantly.
 *
 * Tolerantly is the operative word: a model asked for six labelled fields
 * returns five and a half of them often enough that a strict parser is a
 * feature that works on Tuesdays. Anything unrecognised stays available in
 * `raw`, which the page shows, so a field this misses is still in front of the
 * person rather than silently gone.
 */
export function parseShowNotes(raw: string): ShowNotes {
  const clean = String(raw || '').replace(/\r/g, '')
  // NO `m` FLAG, AND THE REASON IS A BUG THIS COST TWO ASSERTIONS.
  //
  // With `m`, `$` matches the end of every LINE, so the lazy `[\s\S]*?` stopped
  // at the first newline and a two-paragraph description came back as its first
  // paragraph — and a three-quote list as one quote. Both look like the model
  // gave a short answer, which is exactly the wrong place to go looking.
  //
  // So: the label is anchored with an explicit `(?:^|\n)` instead of `^`, and
  // `$` keeps its whole-string meaning. The field runs until the next known
  // label at the start of a line, or the end of the answer.
  const LABELS = `TITLU|SUBTITLU|DESCRIERE|CUVINTE|CITATE|${NOTES_SENTINEL}`
  const field = (label: string): string => {
    const re = new RegExp(
      `(?:^|\\n)[ \\t]*${label}[ \\t]*:[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*(?:${LABELS})[ \\t]*:|\\n[ \\t]*${NOTES_SENTINEL}[ \\t]*$|$)`,
      'i')
    const m = clean.match(re)
    return m ? m[1].trim() : ''
  }
  const quotes = field('CITATE')
    .split('\n')
    .map(l => l.replace(/^[-–—•*]\s*/, '').trim())
    .filter(Boolean)
  return {
    title: field('TITLU').split('\n')[0].trim().slice(0, 140),
    subtitle: field('SUBTITLU').split('\n')[0].trim(),
    description: field('DESCRIERE').replace(new RegExp(`\\n?${NOTES_SENTINEL}\\s*$`), '').trim(),
    keywords: field('CUVINTE').split(/[,;]/).map(s => s.trim()).filter(Boolean),
    quotes,
    raw: clean,
  }
}

/**
 * The description a person pastes into YouTube or the feed: the written
 * description, then the chapter list, then the credits line.
 */
export function fullDescription(
  notes: Pick<ShowNotes, 'description'>,
  chapters: readonly Chapter[],
  extra = '',
): string {
  const parts = [notes.description.trim()]
  const lines = chapterLines(chapters)
  if (lines) parts.push('Capitole:\n' + lines)
  if (extra.trim()) parts.push(extra.trim())
  return parts.filter(Boolean).join('\n\n')
}
