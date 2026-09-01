// lib/avatars/index.ts
//
// An avatar that is the SAME PERSON in March and in June.
//
// The Studio could already generate a presenter and lipsync them. What it could
// not do is generate them twice. Each shot was a fresh prompt, so "Ioana" was a
// description of a kind of person rather than a person, and two films made a
// month apart featured two different women wearing the same job title. For a
// news brand or a sales team that is not a cosmetic problem — it is the whole
// reason the avatar exists.
//
// TWO MECHANISMS, BECAUSE ONE IS NOT ENOUGH AND THE OTHER IS NOT EXACT.
//
//   The HERO STILL is one saved photograph. Every shot that uses it is that
//   exact file, animated and lipsynced. Identity is not "consistent", it is
//   IDENTICAL, because it is the same pixels. The limit is real and worth
//   stating plainly: one framing, one outfit, one background, forever.
//
//   REFERENCE CONDITIONING generates a new shot from up to sixteen saved
//   photographs of that person (gpt-image-1 accepts sixteen references). This
//   gives different framings, settings and wardrobe, and it is very close but
//   NOT guaranteed identical. Which is why it is a separate, labelled choice
//   rather than a silent upgrade: a sales team sending a thousand videos needs
//   to know which of the two they are shipping.
//
// What this module does NOT do is pretend a third option exists. Training a
// model per avatar would beat both, needs a service that is not wired up, and
// saying so is more useful than implying the reference path is a face lock.

export type AvatarMode = 'hero' | 'reference'

export interface AvatarShotSpec {
  /** The exact still to animate, when the mode is `hero`. */
  readonly heroUrl?: string
  /** References to condition on, when the mode is `reference`. */
  readonly referenceUrls?: readonly string[]
  readonly prompt?: string
  readonly mode: AvatarMode
  /** Said out loud in the interface, because the two modes differ in kind. */
  readonly identityNote: string
}

export interface Avatar {
  readonly id: string
  readonly name: string
  /** The one photograph that IS this person. Nothing else is identity-exact. */
  readonly heroUrl: string
  /**
   * Extra photographs of the same person, for reference-conditioned shots.
   * The hero counts as one, so at most fifteen more are useful.
   */
  readonly referenceUrls: readonly string[]
  /** The description that produced them, kept so more can be generated later. */
  readonly basePrompt: string
  /** Voice this person always speaks with. An avatar with two voices is two people. */
  readonly voiceId?: string
  readonly voiceProvider?: 'elevenlabs' | 'minimax'
  /** Which way this person's light runs, so the grade is held correctly. */
  readonly look?: 'warm' | 'cold' | 'none'
  readonly aspect?: string
  readonly createdAt?: string
  readonly notes?: string
}

/** gpt-image-1 takes sixteen references; beyond that the extras are ignored. */
export const MAX_REFERENCES = 16

export interface AvatarIssue {
  readonly level: 'error' | 'warning'
  readonly message: string
}

/**
 * What is wrong with this avatar, before it is used in a hundred films.
 *
 * The warnings matter more than the errors here. An avatar with one reference
 * image is perfectly valid and will produce a different face every time it is
 * used in reference mode — valid, usable, and not what anyone wanted.
 */
export function checkAvatar(a: Avatar): AvatarIssue[] {
  const out: AvatarIssue[] = []
  if (!a.name.trim()) out.push({ level: 'error', message: 'Avatarul are nevoie de un nume.' })
  if (!a.heroUrl) {
    out.push({ level: 'error', message:
      'Fără un cadru de referință salvat, acest avatar nu e o persoană — e o descriere. ' +
      'Generează un cadru și fixează-l.' })
  }
  const refs = uniqueReferences(a)
  if (refs.length < 3) {
    out.push({ level: 'warning', message:
      `Doar ${refs.length} ${refs.length === 1 ? 'imagine' : 'imagini'} de referință. ` +
      'Pentru cadre noi generate, sub trei referințe fața variază vizibil de la un plan la altul. ' +
      'Cadrul fix rămâne exact.' })
  }
  if (refs.length > MAX_REFERENCES) {
    out.push({ level: 'warning', message:
      `${refs.length} referințe, dar modelul folosește primele ${MAX_REFERENCES}. Restul se ignoră.` })
  }
  if (!a.voiceId) {
    out.push({ level: 'warning', message:
      'Fără o voce fixată, aceeași persoană va suna diferit de la un film la altul.' })
  }
  return out
}

/** The hero first, then the extras, deduplicated and capped. */
export function uniqueReferences(a: Avatar): string[] {
  const seen: string[] = []
  for (const u of [a.heroUrl, ...a.referenceUrls]) {
    if (u && !seen.includes(u)) seen.push(u)
  }
  return seen
}

/**
 * How to make one shot of this person.
 *
 * The `identityNote` is not decoration. It is the difference between a team
 * that knows its avatar varies between shots and a team that finds out from a
 * client, and it travels with the spec so no interface can forget to show it.
 */
export function shotSpec(a: Avatar, mode: AvatarMode, prompt?: string): AvatarShotSpec {
  if (mode === 'hero') {
    return {
      mode: 'hero',
      heroUrl: a.heroUrl,
      identityNote:
        'Identic: e exact aceeași fotografie, animată. Fața nu poate varia. ' +
        'În schimb, încadrarea, ținuta și fundalul sunt fixe.',
    }
  }
  const refs = uniqueReferences(a).slice(0, MAX_REFERENCES)
  return {
    mode: 'reference',
    referenceUrls: refs,
    prompt: [a.basePrompt, prompt].filter(Boolean).join(' '),
    identityNote:
      `Foarte apropiat, dar nu garantat identic — cadru nou, generat din ${refs.length} ` +
      `${refs.length === 1 ? 'referință' : 'referințe'}. Alege asta când ai nevoie de altă ` +
      'încadrare sau alt decor; alege cadrul fix când fața trebuie să fie exact aceeași.',
  }
}

/**
 * Is this avatar safe to run across a whole campaign?
 *
 * Hero mode always is. Reference mode across hundreds of films means hundreds
 * of slightly different faces, which reads as carelessness at exactly the
 * moment personalisation is supposed to read as care.
 */
export function campaignAdvice(a: Avatar, mode: AvatarMode, rows: number): AvatarIssue[] {
  const out = checkAvatar(a).filter(i => i.level === 'error')
  if (mode === 'reference' && rows > 20) {
    out.push({ level: 'warning', message:
      `${rows} filme în modul „cadru nou” înseamnă ${rows} fețe ușor diferite. ` +
      'Pentru o campanie, cadrul fix este aproape întotdeauna alegerea corectă.' })
  }
  if (mode === 'hero' && !a.heroUrl) {
    out.push({ level: 'error', message: 'Modul „cadru fix” are nevoie de un cadru salvat.' })
  }
  return out
}
