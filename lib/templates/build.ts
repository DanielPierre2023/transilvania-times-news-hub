// lib/templates/build.ts
//
// Beats → a project the Studio can open.
//
// The builder deliberately produces the SAME shape a hand-built project has —
// scenes, overlays, a script — rather than a timeline. Two reasons, and the
// second is the important one:
//
//   A template that emitted a finished timeline would be a second way to build
//   a film, running beside the one the Studio already uses. Two builders is two
//   sets of bugs and, sooner or later, two different answers to "how long is
//   this film". Everything here goes through the existing path.
//
//   A project made from a template must stay EDITABLE AS A PROJECT. If the
//   output were a timeline, opening a template would mean losing the scene list
//   the whole interface is built around, and the template would be a one-way
//   door: usable once, never adjustable.
//
// So this file is a translator, not an engine.

import { substitute, type MergeField } from './merge'
import type { Beat, FilmTemplate } from './library'

export interface DraftScene {
  id: string
  kind: 'image' | 'video'
  url: string
  name: string
  duration: number
  kb: 'none' | 'in' | 'out' | 'left' | 'right'
  motionPrompt?: string
  imagePrompt?: string
  trans?: string
  speed?: string
  /** The slot this shot is waiting for, when it has no picture yet. */
  awaiting?: string
  /** What this shot is FOR. Carried into the project so the note survives. */
  job?: string
}

export interface DraftOverlay {
  id: string
  kind: 'title' | 'lower' | 'end'
  at: number
  dur: number
  a: string
  b?: string
  c?: string
}

export interface Draft {
  templateId: string
  aspect: string
  scenes: DraftScene[]
  overlays: DraftOverlay[]
  script: string
  /** Slots with no value yet. The film cannot be rendered until these are filled. */
  missing: string[]
  /** Merge fields that had no column, when built from a spreadsheet row. */
  unresolved: string[]
  seconds: number
}

const uid = (n: number) => `t${n}_${Math.random().toString(36).slice(2, 7)}`

/**
 * How long an overlay stays up.
 *
 * Not the whole beat: a title that appears with the cut and leaves with the cut
 * reads as a caption burned into the shot rather than as a title. It comes up a
 * beat late and goes out a beat early — except on short beats, where there is
 * no room and it simply holds.
 */
function overlayWindow(beat: Beat, start: number): { at: number; dur: number } {
  if (beat.seconds <= 4) return { at: start, dur: beat.seconds }
  const lead = 0.4
  return { at: start + lead, dur: Math.max(2, beat.seconds - lead - 0.6) }
}

/**
 * Build a project draft from a template.
 *
 * `values` are the slot values; `row` is a spreadsheet row for merge fields.
 * Both are optional — a template opened with neither produces a fully-formed
 * film with empty slots, which is exactly what somebody starting from a
 * template wants to see before they fill it in.
 */
export function buildDraft(
  template: FilmTemplate,
  values: Readonly<Record<string, string>> = {},
  row?: Readonly<Record<string, string>>,
  fields: readonly MergeField[] = template.merge ?? [],
): Draft {
  const scenes: DraftScene[] = []
  const overlays: DraftOverlay[] = []
  const missing: string[] = []
  const unresolved: string[] = []
  let t = 0

  const fill = (text: string): string => {
    if (!row) return text
    const r = substitute(text, row, fields)
    for (const u of r.unresolved) if (!unresolved.includes(u)) unresolved.push(u)
    return r.text
  }

  template.beats.forEach((beat, i) => {
    const url = beat.pictureSlot ? (values[beat.pictureSlot] ?? '') : ''
    if (beat.pictureSlot && !url && !missing.includes(beat.pictureSlot)) missing.push(beat.pictureSlot)

    scenes.push({
      id: uid(i),
      // A slot that has been filled with a video keeps being a video; an empty
      // slot is an image placeholder, because that is what generating one makes.
      kind: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? 'video' : 'image',
      url,
      name: beat.job.slice(0, 60),
      duration: beat.seconds,
      kb: 'none',
      ...(beat.motion ? { motionPrompt: beat.motion } : {}),
      ...(beat.prompt ? { imagePrompt: fill(beat.prompt) } : {}),
      ...(beat.transition && i > 0 ? { trans: beat.transition } : {}),
      ...(beat.speed ? { speed: beat.speed } : {}),
      ...(beat.pictureSlot && !url ? { awaiting: beat.pictureSlot } : {}),
      job: beat.job,
    })

    if (beat.title) {
      const raw = values[beat.title.slot] ?? ''
      if (!raw) { if (!missing.includes(beat.title.slot)) missing.push(beat.title.slot) }
      else {
        const w = overlayWindow(beat, t)
        overlays.push({ id: uid(100 + i), kind: beat.title.kind, at: w.at, dur: w.dur, a: fill(raw) })
      }
    }
    t += beat.seconds
  })

  // A required slot with no value is missing even when no beat referenced it —
  // a template can declare a slot the beats only use through the script.
  for (const s of template.slots) {
    if (s.required && !(values[s.key] ?? '').trim() && !missing.includes(s.key)) missing.push(s.key)
  }

  return {
    templateId: template.id,
    aspect: template.aspect,
    scenes,
    overlays,
    script: template.script ? fill(template.script) : '',
    missing,
    unresolved,
    seconds: t,
  }
}

/** Can this draft be rendered, or is it still waiting for something? */
export const isComplete = (d: Draft): boolean =>
  d.missing.length === 0 && d.unresolved.length === 0

/**
 * One draft per spreadsheet row.
 *
 * Bounded on purpose. A campaign is a loop that spends money per iteration, and
 * an unbounded loop over a pasted spreadsheet is the single most expensive
 * mistake this tool could make. The cap is enforced HERE, in the pure function,
 * rather than only in the interface — a cap that lives in a button is a cap that
 * an API call skips.
 */
export const MAX_ROWS = 500

export function buildCampaign(
  template: FilmTemplate,
  values: Readonly<Record<string, string>>,
  rows: readonly Readonly<Record<string, string>>[],
): { drafts: Draft[]; skipped: number } {
  const use = rows.slice(0, MAX_ROWS)
  return {
    drafts: use.map(r => buildDraft(template, values, r)),
    skipped: Math.max(0, rows.length - use.length),
  }
}
