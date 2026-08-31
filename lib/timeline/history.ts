// lib/timeline/history.ts
//
// Undo, as a value rather than as a hook.
//
// An editor without undo is not an editor; it is a form that happens to produce
// video. This is the smallest thing that fixes that, and it is deliberately not
// a React hook so it can be tested without a renderer.
//
// TWO DECISIONS WORTH THE WORDS:
//
// Coalescing. Dragging a slider fires a change per pixel. Without coalescing,
// one drag becomes eighty undo steps and Ctrl+Z becomes useless — you press it
// eight times and the caption is still the wrong size. Pushes that share a
// `label` inside `coalesceMs` replace the previous entry instead of stacking.
//
// Equality. The state is a plain project object rebuilt on every keystroke, so
// reference equality would record a step for typing a single character with no
// change. The caller supplies how to compare; the default compares serialised
// JSON, which is right for a project document and wrong for anything holding a
// function or a DOM node — hence the parameter.

export interface HistoryOptions<T> {
  /** Cap on remembered steps. Old entries fall off the bottom. */
  readonly limit?: number
  /** Same-label pushes inside this many ms replace the last entry. */
  readonly coalesceMs?: number
  readonly equal?: (a: T, b: T) => boolean
  readonly now?: () => number
}

interface Entry<T> {
  readonly value: T
  readonly label: string
  readonly at: number
}

export interface HistoryState<T> {
  readonly past: readonly Entry<T>[]
  readonly present: Entry<T>
  readonly future: readonly Entry<T>[]
}

const DEFAULTS = { limit: 80, coalesceMs: 600 }

function sameJson<T>(a: T, b: T): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return a === b }
}

export function createHistory<T>(initial: T, label = 'start', now = Date.now): HistoryState<T> {
  return { past: [], present: { value: initial, label, at: now() }, future: [] }
}

/**
 * Record a new state. Returns the SAME object when nothing changed, so a caller
 * can skip a re-render on a no-op push.
 */
export function push<T>(
  h: HistoryState<T>,
  value: T,
  label: string,
  opts: HistoryOptions<T> = {},
): HistoryState<T> {
  const equal = opts.equal ?? sameJson
  const now = opts.now ?? Date.now
  const limit = opts.limit ?? DEFAULTS.limit
  const coalesceMs = opts.coalesceMs ?? DEFAULTS.coalesceMs

  if (equal(h.present.value, value)) return h

  const t = now()
  const entry: Entry<T> = { value, label, at: t }

  // A continuing gesture replaces its own last step rather than adding one.
  if (label && label === h.present.label && t - h.present.at <= coalesceMs) {
    return { past: h.past, present: entry, future: [] }
  }

  const past = [...h.past, h.present]
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: entry,
    future: [],
  }
}

export function canUndo<T>(h: HistoryState<T>): boolean { return h.past.length > 0 }
export function canRedo<T>(h: HistoryState<T>): boolean { return h.future.length > 0 }

export function undo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h
  const present = h.past[h.past.length - 1]
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future] }
}

export function redo<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h
  const [present, ...rest] = h.future
  return { past: [...h.past, h.present], present, future: rest }
}

/** What the next Ctrl+Z would undo, for a tooltip that says so. */
export function undoLabel<T>(h: HistoryState<T>): string | null {
  return h.past.length ? h.present.label : null
}
export function redoLabel<T>(h: HistoryState<T>): string | null {
  return h.future.length ? h.future[0].label : null
}
