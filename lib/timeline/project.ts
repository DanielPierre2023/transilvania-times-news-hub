// lib/timeline/project.ts
//
// A saved project becomes a timeline. Once, in one place.
//
// WHY THIS MOVED OUT OF THE STUDIO PAGE.
//
// This was a function inside a three-and-a-half-thousand-line React component,
// closing over a dozen pieces of component state. That was fine while a film
// was only ever built by the person looking at it, and it stopped being fine
// the moment a campaign wanted to render four hundred films with nobody
// watching: a server cannot mount a React component, so a second builder would
// have had to exist, and two builders means two answers to "how long is this
// film" within a week.
//
// It closes over nothing now. Everything it needs is in the saved project —
// which was already true, because the project is what gets stored and reloaded;
// the state it read was just a copy of it. So this is a move, not a rewrite,
// and the golden frames are what prove that: the same project must produce
// byte-identical frames before and after.
//
// The order of operations is load-bearing and is commented where it matters.

import { AUDIO_PRESETS } from './audio'
import { addClip, emptyTrack } from './document'
import { migrateLegacyProject } from './migrate'
import { SPEED_PRESETS } from './speed'
import { applyTransitions, type TransitionSpec } from './transitions'
import { FPS, framesToSeconds } from './time'
import { MASTERS, type MasterTier } from './masters'
import type { Clip, TextStyle, Timeline } from './types'

/** Supplied by the caller so this module needs no knowledge of the brand layer. */
export interface ProjectHooks {
  readonly captionStyle: (kit: unknown, scale: number) => TextStyle
  readonly captionY: (kit: unknown, base: number) => number
  /** Wordmark, title cards, lower thirds, end cards, html blocks. */
  readonly overlayClips: (fps: { n: number; d: number }, filmFrames: number) => Clip[]
  readonly sfxLabel: Record<string, string>
  readonly sfxSeconds: Record<string, number>
  readonly subPos: Record<string, number>
  readonly uid: () => string
}

export interface SavedProject {
  aspect?: string
  master?: string
  fpsOut?: number
  scenes?: { id: string; trans?: string; transFrames?: number; speed?: string }[]
  subsOn?: boolean
  subPos?: string
  subScale?: number
  musicUrl?: string
  musicBed?: boolean
  voiceFx?: string
  musicFx?: string
  sfx?: { id: string; name: string; at: number; gain: number }[]
  brandKit?: { colour: { accent: string }; grade: unknown; loudness: unknown; wordmark?: string }
  [key: string]: unknown
}

export interface BuildOptions {
  /** Force captions on, for a sidecar .srt independent of the burn-in switch. */
  readonly forceCaptions?: boolean
  /** Overrides the project's own master, for a campaign delivering at one size. */
  readonly master?: MasterTier
}

/**
 * Build the timeline for a saved project.
 *
 * Everything downstream — the preview, the captions, the cost estimate, the
 * cloud render — reads this one object, so the preview and the export cannot
 * drift apart. That property is the reason this exists at all.
 */
export function buildProjectTimeline(
  project: SavedProject,
  hooks: ProjectHooks,
  opts: BuildOptions = {},
): Timeline {
  const kit = project.brandKit as ProjectHooks extends never ? never : NonNullable<SavedProject['brandKit']>
  const fps = (project.fpsOut ?? 25) === 25 ? FPS.pal : FPS.web
  const tier = (opts.master ?? project.master ?? '1080') as MasterTier
  const aspect = (project.aspect ?? '9:16') as keyof (typeof MASTERS)['1080']
  const [W, H] = (MASTERS[tier] ?? MASTERS['1080'])[aspect] ?? MASTERS['1080']['9:16']

  const base = opts.forceCaptions ? { ...project, subsOn: true } : project
  let tl = migrateLegacyProject(base as Parameters<typeof migrateLegacyProject>[0], { fps })
  tl = { ...tl, timebase: { ...tl.timebase, width: W, height: H } }

  // THE KIT IS AUTHORITATIVE. Captions take their face, size and colour from it,
  // and their vertical position is clamped into the safe area — which is what
  // stops a caption rendering underneath TikTok's own caption block, where it is
  // technically present and practically invisible.
  const capStyle = hooks.captionStyle(kit, project.subScale ?? 1)
  const capY = hooks.captionY(kit, hooks.subPos[project.subPos ?? 'jos'] ?? 0.88)
  tl = {
    ...tl,
    tracks: tl.tracks.map(track => track.z !== 10 || track.kind !== 'video' ? track : {
      ...track,
      clips: track.clips.map(c => c.source.kind !== 'text' ? c : {
        ...c,
        source: { ...c.source, style: { ...capStyle, ...(c.source.words ? { maxLines: 1 } : {}) } },
        transform: { ...c.transform, position: { x: 0.5, y: capY } },
      }),
    }),
    delivery: { ...tl.delivery, grade: kit?.grade as never, loudness: kit?.loudness as never },
  }

  // TRANSITIONS, AS A TIMELINE TRANSFORM. Nothing in the renderer changes.
  const scenes = project.scenes ?? []
  const specs: (TransitionSpec | undefined)[] = scenes.map(sc =>
    sc.trans && sc.trans !== 'cut'
      ? { kind: sc.trans as TransitionSpec['kind'], frames: Math.max(2, Math.round(sc.transFrames ?? 12)) }
      : undefined)
  if (specs.some(Boolean)) {
    tl = applyTransitions(tl, specs, { brandColour: kit?.colour?.accent }).timeline
  }

  // SPEED RAMPS, AFTER THE TRANSITIONS.
  //
  // A transition MOVES clips and a ramp is expressed against a clip's own
  // frames, so building the ramp first would attach a curve to a clip that then
  // changes length underneath it. A ramp is only meaningful on a video clip: a
  // still has no frames to walk through faster.
  if (scenes.some(sc => sc.speed)) {
    const picture = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
    if (picture) {
      // SHOTS ARE MATCHED BY INDEX, NOT BY ID.
      //
      // This was matched by id first, and it silently did nothing:
      // `migrateLegacyProject` mints fresh clip ids (`cl_…`), so a lookup keyed
      // on the scene's own id never hit. The selector was in the interface, the
      // preset was built, the timeline came back without a single ramp on it,
      // and no error appeared anywhere — a control that is reachable and inert,
      // which is worse than one that is missing.
      //
      // Index is the convention the rest of the pipeline already uses:
      // `applyTransitions` takes `specs[i]` for the cut before clip i, and the
      // worker matches its measured grades the same way. Picture clips stay
      // one-per-scene and in order — a dissolve moves them, a dip goes on its
      // own track — so the index holds after the transitions have run.
      tl = {
        ...tl,
        tracks: tl.tracks.map(t => t !== picture ? t : {
          ...t,
          clips: t.clips.map((c, i) => {
            const sc = scenes[i]
            if (!sc?.speed || c.source.kind !== 'video') return c
            const preset = SPEED_PRESETS[sc.speed]
            return preset ? { ...c, speed: preset.build(c.duration) } : c
          }),
        }),
      }
    }
  }

  // THE PROCESSING CHAINS, ONTO THE AUDIO CLIPS.
  const voiceChain = AUDIO_PRESETS[project.voiceFx ?? '']?.chain
  const musicChain = AUDIO_PRESETS[project.musicFx ?? '']?.chain
  tl = {
    ...tl,
    tracks: tl.tracks.map(track => track.kind !== 'audio' ? track : {
      ...track,
      clips: track.clips.map(c => {
        const chain = track.z === 0 ? voiceChain : musicChain
        if (!chain || chain.length === 0) return c
        return { ...c, audio: { ...(c.audio || { gain: 1 }), effects: chain } }
      }),
    }),
  }

  // A synthesised bed, only when no real track was uploaded — an uploaded track
  // always wins, because somebody chose it.
  if (project.musicBed && !project.musicUrl) {
    let mTrack = tl.tracks.find(t => t.kind === 'audio' && t.z === 1)
    if (!mTrack) {
      mTrack = emptyTrack('audio', 'Muzică', 1)
      tl = { ...tl, tracks: [...tl.tracks, mTrack] }
    }
    const secs = Math.max(2, framesToSeconds(tl.duration, fps))
    tl = addClip(tl, mTrack.id, {
      id: hooks.uid(), name: 'Pat muzical',
      source: { kind: 'audio', url: `builtin:bed@${secs.toFixed(1)}` },
      start: 0, duration: tl.duration, sourceIn: 0,
      transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
      fit: 'contain',
      audio: { gain: 0.5, duckTarget: true },
      fadeIn: 0, fadeOut: 0, enabled: true,
    })
  }

  // Sound design on its own track, under the voice and beside the music.
  const sfx = project.sfx ?? []
  if (sfx.length) {
    const sTrack = emptyTrack('audio', 'Sunete', 2)
    tl = { ...tl, tracks: [...tl.tracks, sTrack] }
    for (const s of sfx) {
      tl = addClip(tl, sTrack.id, {
        id: hooks.uid(), name: hooks.sfxLabel[s.name] ?? s.name,
        source: { kind: 'audio', url: `builtin:${s.name}` },
        start: Math.round((s.at * fps.n) / fps.d),
        duration: Math.max(1, Math.round(((hooks.sfxSeconds[s.name] ?? 0.5) * fps.n) / fps.d)),
        sourceIn: 0,
        transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
        fit: 'contain',
        // Not a duck target: an accent that ducks under the voice is not an
        // accent. Not a duck source either — it must never pull the music down.
        audio: { gain: s.gain },
        fadeIn: 0, fadeOut: 0, enabled: true,
      })
    }
  }

  // Titles ride ABOVE the captions: a title card's scrim is meant to cover
  // everything under it, including a caption that happens to be on screen.
  const extra = hooks.overlayClips(fps, tl.duration)
  if (extra.length) {
    const track = emptyTrack('video', 'Titluri', 20)
    tl = { ...tl, tracks: [...tl.tracks, track] }
    for (const c of extra) tl = addClip(tl, track.id, c)
    const end = Math.max(...extra.map(c => c.start + c.duration))
    if (end > tl.duration) tl = { ...tl, duration: end }
  }

  return tl
}
