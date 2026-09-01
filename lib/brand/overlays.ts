// lib/brand/overlays.ts
//
// Overlay intent → real clips. One implementation, two callers.
//
// This was a `useCallback` inside the Studio component, closing over `overlays`
// and `kit`. It has to move for the same reason the timeline builder did: a
// campaign renders hundreds of films with nobody watching, and a server cannot
// mount a React component. Left where it was, a campaign would have had to
// build its own titles — and two implementations of "what a lower third looks
// like" is how a brand stops being one brand.
//
// Overlays are stored as INTENT — kind, when, how long, what it says — and
// expanded here. Storing the expansion instead would freeze every film against
// the version of the design that made it; storing the intent means a fix to a
// template improves every project that has one.

import type { BrandKit } from './kit'
import { endCard, lowerThird, titleCard, wordmark } from './templates'
import type { Clip } from '../timeline/types'

export interface OverlayIntent {
  readonly id: string
  readonly kind: 'title' | 'lower' | 'end' | 'html'
  /** Seconds on the timeline. */
  readonly at: number
  readonly dur: number
  readonly a: string
  readonly b?: string
  readonly c?: string
  readonly html?: string
  readonly url?: string
  readonly frames?: readonly string[]
  readonly frameFps?: number
  readonly stamp?: string
  readonly w?: number
  readonly h?: number
}

export function overlayClipsFor(
  overlays: readonly OverlayIntent[],
  kit: BrandKit,
  fps: { n: number; d: number },
  filmFrames = 0,
): Clip[] {
  const out: Clip[] = []

  if (kit.wordmark !== 'none' && filmFrames > 0) {
    out.push(...wordmark({ kit, fps, start: 0, frames: filmFrames }))
  }

  for (const o of overlays) {
    const start = Math.round((o.at * fps.n) / fps.d)
    const duration = Math.max(2, Math.round((o.dur * fps.n) / fps.d))
    const ctx = { kit, fps, start, duration }

    if (o.kind === 'title') {
      out.push(...titleCard(ctx, { kicker: o.b || undefined, title: o.a, sub: o.c || undefined }))
    } else if (o.kind === 'lower') {
      out.push(...lowerThird(ctx, { name: o.a, role: o.b || undefined }))
    } else if (o.kind === 'html') {
      // An unrasterised block would render as a hole where the lower third was.
      // Skipped here and reported by the linter, rather than drawn empty.
      if (!o.url && !(o.frames || []).length) continue
      out.push({
        id: o.id, name: 'Compoziție HTML',
        source: {
          kind: 'html', html: o.html || '', url: o.url, stamp: o.stamp,
          frames: o.frames, frameFps: o.frameFps,
          naturalWidth: o.w, naturalHeight: o.h,
        },
        start, duration, sourceIn: 0,
        transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
        fit: 'contain', fadeIn: 0, fadeOut: 0, enabled: true,
      })
    } else {
      out.push(...endCard(ctx, { title: o.a, line: o.b || undefined, url: o.c || undefined }))
    }
  }

  return out
}
