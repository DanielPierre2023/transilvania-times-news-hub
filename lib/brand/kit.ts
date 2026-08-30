// lib/brand/kit.ts
//
// tt-brand — the brand kit.
//
// WHY THIS EXISTS
//
// Until now a Studio film had exactly one piece of typography in it: the
// subtitle. Everything else that makes a spot look made rather than generated —
// a title card, a name under a face, an end card with the masthead on it — had
// no representation at all, so no film could have any of it.
//
// It also had no rules. Nothing stopped a project rendering with the wrong red,
// the wrong face, captions in the wrong place, or a −16 LUFS social mix sent to
// a broadcaster who asked for −23. A brand kit is the object that makes those
// answerable once, for every film, instead of being remembered each time.
//
// THE ONE DESIGN RULE HERE
//
// Every size is a fraction of the SHORT edge of the frame, never the height.
// Sizing type off height is what made a caption render at 86 px in a vertical
// film and 49 px in a horizontal one from the same setting — the same bug,
// twice, if it is allowed back in.

import type { GradeSpec, LoudnessTarget, TextStyle } from '@/lib/timeline'

export type SafeAreaName = 'none' | 'broadcast' | 'tiktok' | 'reels' | 'shorts' | 'feed'

/** Normalised insets, 0..1 of the frame. */
export interface Insets {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * Where it is safe to put something that must be read.
 *
 * `broadcast` is the only one of these with a standard behind it: EBU R 95
 * puts the 16:9 graphics-safe area at a 3.5% margin, and 5% is the long-standing practice
 * for title safe. The social figures are house defaults measured off the apps'
 * own overlays; they move whenever those apps redesign, which is exactly why
 * they live in an editable kit rather than in the renderer.
 */
export const SAFE_AREAS: Record<SafeAreaName, Insets> = {
  none: { top: 0, right: 0, bottom: 0, left: 0 },
  broadcast: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  // Caption block and the account name sit low; the action rail is on the right.
  tiktok: { top: 0.10, right: 0.17, bottom: 0.22, left: 0.05 },
  reels: { top: 0.08, right: 0.14, bottom: 0.20, left: 0.05 },
  shorts: { top: 0.07, right: 0.14, bottom: 0.18, left: 0.05 },
  // In-feed square/4:5: only the caption strip underneath matters.
  feed: { top: 0.05, right: 0.05, bottom: 0.08, left: 0.05 },
}

export interface BrandColour {
  /** Primary type colour on a light ground. */
  readonly ink: string
  /** The brand's light ground — end cards, straps. */
  readonly paper: string
  /** The one accent. Used for rules, bars and emphasis, never for body type. */
  readonly accent: string
  /** Type colour that sits ON the accent. */
  readonly onAccent: string
  /** Type colour over picture. */
  readonly overPicture: string
  /** Scrim laid over a plate so type over it stays legible. */
  readonly scrim: string
}

export interface BrandType {
  /** CSS family list. The renderer resolves the first name it can load. */
  readonly displayFamily: string
  readonly bodyFamily: string
  /** All sizes are fractions of the SHORT edge. */
  readonly display: number
  readonly title: number
  readonly subtitle: number
  readonly caption: number
  readonly kicker: number
  readonly displayWeight: number
  readonly bodyWeight: number
  readonly lineHeight: number
}

export interface BrandKit {
  readonly version: 1
  readonly id: string
  readonly name: string
  readonly colour: BrandColour
  readonly type: BrandType
  /** Optional marks, drawn on the end card when present. */
  readonly logoUrl?: string
  readonly mastheadUrl?: string
  /** The house look every film is graded to. */
  readonly grade: GradeSpec
  /** The delivery target every film is mixed to unless overridden. */
  readonly loudness: LoudnessTarget
  /** Where captions and templates are allowed to sit. */
  readonly safeArea: SafeAreaName
  /** Fraction of the short edge: thickness of the accent rule under a title. */
  readonly ruleWeight: number
  /** Seconds a lower third stays on screen by default. */
  readonly lowerThirdSeconds: number
}

/**
 * Transilvania Times. Read off what the newsroom already uses: the site's
 * brand red, and the "warm parchment and cream, one deep-crimson accent"
 * grade the picture prompts have been asking for all along.
 */
export const TT_KIT: BrandKit = {
  version: 1,
  id: 'tt',
  name: 'Transilvania Times',
  colour: {
    ink: '#14110E',
    paper: '#F4F0E8',
    accent: '#CA2222',
    onAccent: '#FFFFFF',
    overPicture: '#FFFFFF',
    scrim: 'rgba(12,10,8,0.55)',
  },
  type: {
    displayFamily: 'Playfair Display, Georgia, serif',
    bodyFamily: 'Inter, Helvetica, Arial, sans-serif',
    display: 0.115,
    title: 0.075,
    subtitle: 0.040,
    caption: 0.045,
    kicker: 0.024,
    displayWeight: 700,
    bodyWeight: 600,
    lineHeight: 1.14,
  },
  grade: { look: 'warm', strength: 0.85 },
  loudness: 'social',
  safeArea: 'reels',
  ruleWeight: 0.006,
  lowerThirdSeconds: 4,
}

/** A neutral kit, for a client who is not us. */
export const PLAIN_KIT: BrandKit = {
  ...TT_KIT,
  id: 'plain',
  name: 'Neutru',
  colour: {
    ink: '#111111',
    paper: '#FFFFFF',
    accent: '#1F6FEB',
    onAccent: '#FFFFFF',
    overPicture: '#FFFFFF',
    scrim: 'rgba(0,0,0,0.5)',
  },
  type: { ...TT_KIT.type, displayFamily: 'Inter, Helvetica, Arial, sans-serif' },
  grade: { look: 'neutral', strength: 0.6 },
}

export const KITS: readonly BrandKit[] = [TT_KIT, PLAIN_KIT]

/**
 * Fills a partial kit — anything loaded from the database, where a column may
 * be missing because the row predates a field — against the house default, so
 * a kit is always complete by the time the renderer sees it.
 */
export function resolveKit(partial?: Partial<BrandKit> | null): BrandKit {
  if (!partial) return TT_KIT
  return {
    ...TT_KIT,
    ...partial,
    colour: { ...TT_KIT.colour, ...(partial.colour || {}) },
    type: { ...TT_KIT.type, ...(partial.type || {}) },
    grade: { ...TT_KIT.grade, ...(partial.grade || {}) },
    version: 1,
  }
}

/** The safe box in normalised coordinates. */
export function safeBox(kit: BrandKit, override?: SafeAreaName) {
  const i = SAFE_AREAS[override ?? kit.safeArea] ?? SAFE_AREAS.none
  return { x: i.left, y: i.top, w: 1 - i.left - i.right, h: 1 - i.top - i.bottom }
}

/** The caption style the kit dictates. Replaces the hard-coded subtitle style. */
export function captionStyle(kit: BrandKit, scale = 1): TextStyle {
  return {
    family: kit.type.bodyFamily,
    size: kit.type.caption * scale,
    weight: kit.type.bodyWeight,
    color: kit.colour.overPicture,
    align: 'center',
    lineHeight: 1.22,
    background: 'rgba(0,0,0,0.55)',
    padding: 0.012,
    maxWidth: 0.86,
  }
}

/**
 * The vertical position captions may occupy, respecting the safe area.
 *
 * A caption pinned to 0.88 of frame height sits underneath TikTok's own caption
 * block. This is the function that stops that happening: the requested position
 * is clamped into the safe box.
 */
export function captionY(kit: BrandKit, wanted: number, override?: SafeAreaName): number {
  const box = safeBox(kit, override)
  const lo = box.y + 0.04
  const hi = box.y + box.h - 0.04
  return Math.max(lo, Math.min(hi, wanted))
}
