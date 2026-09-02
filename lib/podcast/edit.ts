// lib/podcast/edit.ts
//
// CUTTING BY READING.
//
// The honest description of the old podcast surface is that it computed an edit
// and never showed it to anybody. It printed "38 tăieturi · 214.6s scoase" and
// offered no way to see which 38, hear any of them, disagree with one, or make
// a thirty-ninth. Asked "how do I cut?", the only true answer was "you don't —
// it cuts, and you hope".
//
// This is the model behind cutting the way a person actually edits speech:
// BY READING THE TRANSCRIPT AND DELETING WORDS. Select "ăăă, deci, cum să
// spun", press cut, and those words leave the episode. It is how Descript works
// and it is the right interface for talk, because the unit a person reasons
// about is a sentence, not a waveform peak.
//
// THE IDEA THAT MAKES THIS CHEAP.
//
// A cut list already drives everything downstream: `keptRanges` turns it into
// what survives and `buildEpisodeProject` turns that into a film. So editing by
// transcript does not need a new pipeline — it needs the SAME `Cut[]`, with a
// user able to add to it and take away from it. Everything here produces cuts.
//
// THREE KINDS OF CUT, AND WHY THEY ARE NOT MERGED INTO ONE LIST.
//
//   AUTOMATIC ones come from `planTighten` and are RE-DERIVED whenever the
//   settings change. They are not stored, because storing them would mean a
//   stale copy the moment the silence threshold moved.
//
//   MANUAL ones are stored, because nothing can re-derive a human decision.
//
//   RESTORED is a set of automatic cuts the person put back. Stored as keys
//   rather than as cuts, so a restore survives the settings changing.
//
// THE KEY IS ANCHORED TO A WORD, NOT TO A TIMESTAMP.
//
// The obvious key for a cut is `from-to`. It is also wrong: move the silence
// threshold by a tenth of a second and every silence cut gets new boundaries,
// so every restore the person made is silently forgotten and their edit
// partially undoes itself. Keys here are anchored to the INDEX OF THE WORD the
// cut sits before, which does not move when a threshold does.

import type { Word, Cut } from '../timeline/podcast'
import { planTighten, DEFAULT_FILLERS } from '../timeline/podcast'

export type CutSource = 'filler' | 'silence' | 'manual'

/** A cut that can be pointed at, switched off, and put back. */
export interface KeyedCut extends Cut {
  readonly key: string
  readonly source: CutSource
  /** Index of the word this cut sits immediately before. -1 at the very end. */
  readonly anchor: number
}

export interface EditSettings {
  /** Take out "ăăă", "deci", "gen" and the rest. */
  readonly removeFillers: boolean
  /** Take out pauses. Off means keep every breath. */
  readonly removeSilences: boolean
  /** A pause longer than this is shortened, in seconds. */
  readonly maxGap: number
  /** What is left of a shortened pause, in seconds. Never zero — see below. */
  readonly keepGap: number
  readonly fillers: readonly string[]
}

export const DEFAULT_SETTINGS: EditSettings = {
  removeFillers: true,
  removeSilences: true,
  // 0.7s is where a pause stops reading as breathing and starts reading as a
  // gap. Under it, tightening makes people sound like they are interrupting
  // each other; over about 1.2s an interview starts to feel slack.
  maxGap: 0.7,
  // NEVER ZERO. Closing a pause completely is the single commonest way an
  // automatically edited podcast announces that it was automatically edited:
  // two sentences butt-joined with no breath sound machine-made, however clean
  // each half is.
  keepGap: 0.25,
  fillers: DEFAULT_FILLERS,
}

export interface Edit {
  readonly settings: EditSettings
  /** Cuts a person made. Nothing can re-derive these. */
  readonly manual: readonly KeyedCut[]
  /** Keys of automatic cuts the person put back. */
  readonly restored: readonly string[]
}

export const EMPTY_EDIT: Edit = { settings: DEFAULT_SETTINGS, manual: [], restored: [] }

/**
 * Which word a cut sits before.
 *
 * The first word that starts at or after the cut ends. A cut running past the
 * last word anchors to -1, which is the end of the recording and is stable.
 */
export function anchorOf(cut: Pick<Cut, 'from' | 'to'>, words: readonly Word[]): number {
  for (let i = 0; i < words.length; i++) if (words[i].start >= cut.to - 1e-6) return i
  return -1
}

export const keyOf = (source: CutSource, anchor: number, from: number): string =>
  // The `from` is in the key only for MANUAL cuts, where two cuts can legitimately
  // share an anchor (cut a word, then cut the word before it). Automatic cuts
  // cannot, and leaving the timestamp out is what makes them survive a threshold
  // change.
  source === 'manual' ? `manual@${anchor}:${from.toFixed(3)}` : `${source}@${anchor}`

/**
 * The automatic cuts for these settings, keyed and labelled.
 *
 * `planTighten` stays the one implementation of what is worth cutting. This
 * adds identity and honours the two toggles, and does not re-decide anything.
 */
export function autoCuts(words: readonly Word[], settings: EditSettings): KeyedCut[] {
  if (words.length === 0) return []
  const raw = planTighten(words, {
    maxGap: settings.maxGap,
    keepGap: settings.keepGap,
    fillers: settings.fillers as string[],
  })
  const out: KeyedCut[] = []
  for (const c of raw) {
    const source: CutSource = c.reason === 'filler' ? 'filler' : 'silence'
    if (source === 'filler' && !settings.removeFillers) continue
    if (source === 'silence' && !settings.removeSilences) continue
    const anchor = anchorOf(c, words)
    out.push({ ...c, source, anchor, key: keyOf(source, anchor, c.from) })
  }
  return out
}

/**
 * A manual cut over words i..j inclusive.
 *
 * IT TAKES HALF THE SURROUNDING PAUSE WITH IT, up to a quarter of a second.
 *
 * Cutting exactly from the first word's start to the last word's end is the
 * obvious implementation and it leaves a hole: the pause before the removed
 * words and the pause after them are now adjacent, so deleting a stumble adds
 * a suspicious silence exactly where the stumble was. Taking half of each
 * neighbouring pause closes the join. The quarter-second cap is what stops a
 * cut before a genuine long pause from eating that pause as well.
 */
export function cutWordRange(
  words: readonly Word[], i: number, j: number, pad = 0.25,
): KeyedCut {
  const a = Math.max(0, Math.min(i, j))
  const b = Math.min(words.length - 1, Math.max(i, j))
  const first = words[a], last = words[b]
  const prevEnd = a > 0 ? words[a - 1].end : null
  const nextStart = b + 1 < words.length ? words[b + 1].start : null

  const from = prevEnd === null ? first.start
    : first.start - Math.min(pad, Math.max(0, (first.start - prevEnd) / 2))
  const to = nextStart === null ? last.end
    : last.end + Math.min(pad, Math.max(0, (nextStart - last.end) / 2))

  const cut = { from: Number(from.toFixed(3)), to: Number(to.toFixed(3)), reason: 'filler' as const }
  const anchor = anchorOf(cut, words)
  return { ...cut, source: 'manual', anchor, key: keyOf('manual', anchor, cut.from) }
}

/** Every cut that is actually in force. */
export function effectiveCuts(words: readonly Word[], edit: Edit): KeyedCut[] {
  const off = new Set(edit.restored)
  const auto = autoCuts(words, edit.settings).filter(c => !off.has(c.key))
  return [...auto, ...edit.manual].sort((x, y) => x.from - y.from)
}

/** The plain cut list the episode builder wants. */
export const asCuts = (keyed: readonly KeyedCut[]): Cut[] =>
  keyed.map(c => ({ from: c.from, to: c.to, reason: c.reason }))

export type WordStatus = 'kept' | 'filler' | 'silence' | 'manual'

/**
 * What happened to each word, for drawing the transcript.
 *
 * A word counts as removed when it lies INSIDE a cut, not when it merely
 * touches one: a cut that takes half the pause before a word overlaps that
 * word's start by nothing, and marking it removed would strike out a word the
 * listener still hears.
 */
export function wordStatuses(words: readonly Word[], edit: Edit): WordStatus[] {
  const cuts = effectiveCuts(words, edit)
  return words.map(w => {
    const mid = (w.start + w.end) / 2
    for (const c of cuts) {
      if (mid > c.from && mid < c.to) return c.source
    }
    return 'kept'
  })
}

/** The cut that removed this word, so a click can put it back. */
export function cutAtWord(words: readonly Word[], edit: Edit, index: number): KeyedCut | null {
  const w = words[index]
  if (!w) return null
  const mid = (w.start + w.end) / 2
  return effectiveCuts(words, edit).find(c => mid > c.from && mid < c.to) ?? null
}

/** Put an automatic cut back, or drop a manual one. */
export function restore(edit: Edit, cut: KeyedCut): Edit {
  if (cut.source === 'manual') {
    return { ...edit, manual: edit.manual.filter(c => c.key !== cut.key) }
  }
  if (edit.restored.includes(cut.key)) return edit
  return { ...edit, restored: [...edit.restored, cut.key] }
}

export function addCut(edit: Edit, cut: KeyedCut): Edit {
  if (edit.manual.some(c => c.key === cut.key)) return edit
  return { ...edit, manual: [...edit.manual, cut] }
}

export interface EditSummary {
  readonly removedSeconds: number
  readonly keptSeconds: number
  readonly fillerCuts: number
  readonly silenceCuts: number
  readonly manualCuts: number
  readonly wordsRemoved: number
}

/**
 * What the edit does, in the numbers a person checks.
 *
 * `removedSeconds` counts DISTINCT seconds. Adding up cut lengths double-counts
 * a manual cut that overlaps an automatic one — which happens constantly, since
 * the first thing anyone does is cut a stumble the filler pass already took
 * half of — and reports an episode shorter than the one that comes out.
 */
export function editSummary(words: readonly Word[], edit: Edit, duration: number): EditSummary {
  const cuts = effectiveCuts(words, edit)
  const merged: { from: number; to: number }[] = []
  for (const c of [...cuts].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1]
    if (last && c.from <= last.to) last.to = Math.max(last.to, c.to)
    else merged.push({ from: c.from, to: c.to })
  }
  const removed = merged.reduce((s, r) =>
    s + Math.max(0, Math.min(r.to, duration) - Math.max(0, r.from)), 0)
  const statuses = wordStatuses(words, edit)
  return {
    removedSeconds: Number(removed.toFixed(3)),
    keptSeconds: Number(Math.max(0, duration - removed).toFixed(3)),
    fillerCuts: cuts.filter(c => c.source === 'filler').length,
    silenceCuts: cuts.filter(c => c.source === 'silence').length,
    manualCuts: cuts.filter(c => c.source === 'manual').length,
    wordsRemoved: statuses.filter(s => s !== 'kept').length,
  }
}

// ── history ──────────────────────────────────────────────────────────────
//
// Undo is not a luxury on an editor whose main gesture is destructive. It is
// the thing that makes a person willing to try a cut at all.

export interface History { readonly past: Edit[]; readonly present: Edit; readonly future: Edit[] }

export const newHistory = (edit: Edit = EMPTY_EDIT): History =>
  ({ past: [], present: edit, future: [] })

/** Depth is capped so a long session cannot grow without bound. */
export function commit(h: History, next: Edit, cap = 100): History {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-cap), present: next, future: [] }
}

export function undo(h: History): History {
  if (!h.past.length) return h
  const past = h.past.slice(0, -1)
  return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function redo(h: History): History {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

// ── reading the transcript ───────────────────────────────────────────────

export interface Paragraph {
  readonly speaker: string
  readonly start: number
  readonly end: number
  /** Indices into the original word list, so a click maps back exactly. */
  readonly indices: number[]
}

/**
 * Words grouped into readable blocks.
 *
 * Breaks on a change of speaker, on a long pause, and on length — a paragraph
 * that runs for two minutes is a wall nobody edits inside of. Indices rather
 * than copies, because the editor needs to say "cut words 412 to 418" and a
 * copied word cannot answer which one it was.
 */
export function paragraphs(
  words: readonly Word[],
  { maxSeconds = 30, breakGap = 1.2 } = {},
): Paragraph[] {
  const out: Paragraph[] = []
  let cur: { speaker: string; indices: number[]; start: number; end: number } | null = null
  const flush = () => { if (cur && cur.indices.length) out.push({ ...cur }); cur = null }

  words.forEach((w, i) => {
    const speaker = w.speaker ?? ''
    const gap = cur ? w.start - cur.end : 0
    const tooLong = cur ? w.end - cur.start > maxSeconds : false
    if (!cur || cur.speaker !== speaker || gap > breakGap || tooLong) {
      flush()
      cur = { speaker, indices: [i], start: w.start, end: w.end }
      return
    }
    cur.indices.push(i)
    cur.end = w.end
  })
  flush()
  return out
}
