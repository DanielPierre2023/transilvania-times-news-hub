// lib/prompts/library.ts
//
// The direction language, as data.
//
// WHY THIS IS NOT A TYPESCRIPT CONSTANT ANY MORE.
//
// The motion prompt, the three negative lists and the whole shot library lived
// as consts inside a three-thousand-line React component. That is why the day a
// negative list was found fighting a deliberately cold shot — telling the model
// that blue hour, twilight and a cold cast were defects, on a picture made of
// exactly those things — the fix was a code change, a build and a deploy.
//
// Nobody in marketing can edit a TypeScript const. Everybody can edit a line of
// text. The words a model is given are copy, not code, and copy belongs in a
// place a writer can reach.
//
// The shape is borrowed from an idea worth borrowing: assemble the instruction
// from named parts, in order, with template variables, so a change to how shots
// are directed is an edit rather than a release.

export interface PromptPart {
  readonly id: string
  /** Shown in the editor. Romanian, because that is who edits it. */
  readonly label: string
  readonly text: string
  /** Parts with the same slot are alternatives; one is chosen at build time. */
  readonly slot: string
  readonly note?: string
}

export interface PromptSet {
  readonly version: number
  readonly parts: readonly PromptPart[]
}

/**
 * The default library. A saved override replaces a part by id, so an edit
 * survives a deploy and a part we later improve still reaches projects that
 * never overrode it.
 */
export const DEFAULT_PROMPTS: PromptSet = {
  version: 1,
  parts: [
    // ── how a shot moves ────────────────────────────────────────────────
    {
      id: 'motion.default',
      slot: 'motion',
      label: 'Mișcare implicită',
      note: 'Folosit doar când planul nu are regie proprie. Un singur prompt global este un storyboard cu un singur cadru — scrie regia pe plan ori de câte ori conteaza.',
      text:
        'Subtle cinematic motion only: a slow gentle camera drift and small natural movement ' +
        'in the scene — drifting haze, moving leaves, people walking softly. ' +
        'KEEP THE ORIGINAL PHOTOGRAPH EXACTLY: same composition, same colours, same ' +
        'lighting, same time of day. Do NOT change the time of day. ' +
        'No cuts, no shot changes, no text.',
    },

    // ── holding the light, in the direction the shot actually runs ──────
    {
      id: 'hold.warm',
      slot: 'hold',
      label: 'Ține lumina caldă',
      text: ' KEEP THE ORIGINAL PHOTOGRAPH EXACTLY: same composition, same colours, same warm lighting, same time of day.',
    },
    {
      id: 'hold.cold',
      slot: 'hold',
      label: 'Ține lumina rece',
      text: ' KEEP THE ORIGINAL PHOTOGRAPH EXACTLY: same composition, same colours, same cold lighting, same time of day.',
    },
    {
      id: 'hold.none',
      slot: 'hold',
      label: 'Nu fixa lumina',
      text: '',
    },

    // ── what is always wrong, in any shot, in any film ──────────────────
    {
      id: 'negative.always',
      slot: 'negative.always',
      label: 'Interdicții permanente',
      note: 'Artefacte și identitate. Adevărate pentru orice plan, oricând.',
      text: [
        'text, watermark, logo, subtitles, caption',
        'extra fingers, deformed hands, warped face, identity change',
        'cut, shot change, morphing background',
        'season change, snow, rain added',
      ].join(', '),
    },
    {
      id: 'negative.keepWarm',
      slot: 'negative.warm',
      label: 'Apără o lumină caldă',
      note: 'Scris după un plan de oră de aur întors rece. Corect pentru un plan cald — și fals pentru unul rece, motiv pentru care nu mai pleacă la toate.',
      text: [
        'night, nighttime, moonlight, blue hour, twilight, dusk',
        'colour shift, color shift, changed lighting, changed time of day',
        'cold colour grade, blue cast, teal tint, desaturated, washed out',
      ].join(', '),
    },
    {
      id: 'negative.keepCold',
      slot: 'negative.cold',
      label: 'Apără o lumină rece',
      note: 'Oglinda celei de sus. Un răsărit albastru trebuie apărat în cealaltă direcție.',
      text: [
        'golden hour, warm orange cast, sunny daylight, midday sun',
        'colour shift, color shift, changed lighting, changed time of day',
        'oversaturated, warm colour grade',
      ].join(', '),
    },

    // ── the house style every still is asked for ────────────────────────
    {
      id: 'still.house',
      slot: 'still',
      label: 'Stil casă · fotografie',
      note: 'Adăugat la finalul fiecărui prompt de imagine. {{aspect}} și {{safe}} se înlocuiesc.',
      text:
        'Documentary photography, 35mm lens at f/2.8, natural skin texture with no retouching, ' +
        'fine grain. The subject sits inside the middle third horizontally and its head is about ' +
        'one third of the way down the frame with clear space above it. The lower fifth of the ' +
        'frame carries nothing important, because captions sit there. ' +
        'No text, no letters, no signage, no brand names, no logos, no watermark, no captions, ' +
        'no on-screen graphics.',
    },
  ],
}

/** Replace default parts by id. Anything not overridden keeps improving. */
export function mergePrompts(base: PromptSet, overrides?: Partial<Record<string, string>> | null): PromptSet {
  if (!overrides) return base
  return {
    ...base,
    parts: base.parts.map(p =>
      typeof overrides[p.id] === 'string' ? { ...p, text: overrides[p.id] as string } : p),
  }
}

export function partText(set: PromptSet, id: string): string {
  return set.parts.find(p => p.id === id)?.text ?? ''
}

/** `{{name}}` substitution, so a part can carry the shot's own words. */
export function fill(text: string, vars: Record<string, string | number | undefined>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    const v = vars[k]
    return v === undefined || v === null ? '' : String(v)
  })
}

export type SceneLook = 'warm' | 'cold' | 'none'

/** The positive prompt for one shot: its own direction, then the grade hold. */
export function motionPrompt(
  set: PromptSet,
  shot: { motionPrompt?: string; look?: SceneLook },
  vars: Record<string, string | number | undefined> = {},
): string {
  const own = (shot.motionPrompt || '').trim()
  const base = own || partText(set, 'motion.default')
  const look = shot.look ?? 'warm'
  const hold = partText(set, look === 'cold' ? 'hold.cold' : look === 'none' ? 'hold.none' : 'hold.warm')
  return fill(`${base}${hold} No cuts, no shot changes, no text.`, vars).replace(/\s+/g, ' ').trim()
}

/** The negative prompt for one shot: always-true terms, then the right hold. */
export function negativePrompt(set: PromptSet, look: SceneLook = 'warm'): string {
  const always = partText(set, 'negative.always')
  const hold = look === 'cold' ? partText(set, 'negative.keepCold')
    : look === 'none' ? ''
    : partText(set, 'negative.keepWarm')
  return [always, hold].filter(Boolean).join(', ')
}
