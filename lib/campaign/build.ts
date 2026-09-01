// lib/campaign/build.ts
//
// A campaign row becomes a renderable project.
//
// THIS FILE EXISTS BECAUSE THE FIRST VERSION OF THE RUNNER INVENTED A PAYLOAD.
//
// The driver posted `{ draft, aspect, master, campaignId, rowIndex }` to the
// render-worker function. That function's contract is
// `{ action: 'create', timeline }` and it answers anything else with
// "timeline is required" — so every row of every campaign would have failed
// immediately, on the first thing anybody tried. Nothing in the type system
// catches that: an edge function takes JSON, and JSON accepts any shape.
//
// The lesson is narrow and worth writing down: a boundary that is not typed has
// to be READ, not remembered. `55-campaign-render.cjs` now asserts the payload
// this builds against the shape the deployed function actually parses.
//
// What is here is the translation, in one place, so the browser driver and any
// future server poller build a row the same way.

import { buildProjectTimeline, type SavedProject } from '../timeline/project'
import { overlayClipsFor, type OverlayIntent } from '../brand/overlays'
import { captionStyle, captionY, resolveKit, type BrandKit } from '../brand/kit'
import type { MasterTier } from '../timeline/masters'
import type { Timeline } from '../timeline/types'
import type { Draft } from '../templates/build'

/** Sound-design names and lengths, mirrored from the Studio's own table. */
const SFX_LABEL: Record<string, string> = {
  whoosh: 'whoosh · tranziție', impact: 'impact · greutate',
  riser: 'riser · tensiune', click: 'click · marcaj',
}
const SFX_SECONDS: Record<string, number> = { whoosh: 0.6, impact: 0.5, riser: 1.5, click: 0.12 }
const SUB_POS: Record<string, number> = { jos: 0.88, treime: 0.76, sus: 0.14 }

let counter = 0
const uid = () => `cmp${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export interface RowMedia {
  /** The voice for THIS row. Absent in text-only campaigns, where one is shared. */
  readonly voiceUrl?: string
  readonly voiceSeconds?: number
  /** Word timings, when the voice was aligned. */
  readonly words?: readonly { word: string; start: number; end: number }[]
  readonly musicUrl?: string
}

export interface RowBuildOptions {
  readonly kit: Partial<BrandKit> | null
  readonly master?: MasterTier
  readonly fpsOut?: 25 | 30
  readonly subsOn?: boolean
  readonly voiceFx?: string
  readonly musicFx?: string
}

/**
 * A draft plus this row's media becomes the project document the Studio saves.
 *
 * Deliberately the SAME shape a hand-made project has. A campaign film that is
 * a different kind of object from a hand-made one cannot be opened, fixed and
 * re-rendered when a client asks for a change — which is the first thing that
 * happens to any film anyone actually uses.
 */
export function draftToProject(
  draft: Draft,
  media: RowMedia,
  opts: RowBuildOptions,
): SavedProject {
  const kit = resolveKit(opts.kit)
  return {
    aspect: draft.aspect,
    master: opts.master ?? '1080',
    fpsOut: opts.fpsOut ?? 25,
    scenes: draft.scenes.map(s => ({
      id: s.id,
      kind: s.kind,
      url: s.url,
      name: s.name,
      duration: s.duration,
      kb: s.kb,
      ...(s.motionPrompt ? { motionPrompt: s.motionPrompt } : {}),
      ...(s.trans ? { trans: s.trans } : {}),
      ...(s.speed ? { speed: s.speed } : {}),
    })),
    overlays: draft.overlays as unknown as OverlayIntent[],
    script: draft.script,
    voUrl: media.voiceUrl ?? '',
    voDur: media.voiceSeconds ?? 0,
    words: media.words ?? [],
    cues: [],
    subsOn: opts.subsOn ?? false,
    subPos: 'jos',
    subScale: 1,
    musicUrl: media.musicUrl ?? '',
    musicVol: 0.18,
    musicBed: false,
    sfx: [],
    voiceFx: opts.voiceFx ?? 'none',
    musicFx: opts.musicFx ?? 'none',
    brandKit: kit as unknown as SavedProject['brandKit'],
  }
}

/** The project as a timeline, built by the one builder every caller uses. */
export function rowTimeline(project: SavedProject, master?: MasterTier): Timeline {
  const kit = resolveKit(project.brandKit as unknown as Partial<BrandKit>)
  return buildProjectTimeline(project, {
    captionStyle: (k, scale) => captionStyle(k as BrandKit, scale),
    captionY: (k, base) => captionY(k as BrandKit, base),
    overlayClips: (fps, frames) =>
      overlayClipsFor((project.overlays ?? []) as OverlayIntent[], kit, fps, frames),
    sfxLabel: SFX_LABEL,
    sfxSeconds: SFX_SECONDS,
    subPos: SUB_POS,
    uid,
  }, master ? { master } : {})
}

/**
 * The exact body the render-worker edge function parses.
 *
 * A named function rather than an object literal at the call site, so the shape
 * is asserted in one place instead of being retyped — and retyped slightly
 * differently — by every caller that ever renders something.
 */
export const createRenderBody = (timeline: Timeline) => ({ action: 'create', timeline })
export const statusRenderBody = (jobId: string) => ({ action: 'status', job_id: jobId })

/** Terminal job states, so a poll knows when to stop. */
export const isFinished = (state: string): boolean =>
  state === 'done' || state === 'failed' || state === 'error' || state === 'cancelled'
export const isFailure = (state: string): boolean =>
  state === 'failed' || state === 'error'
