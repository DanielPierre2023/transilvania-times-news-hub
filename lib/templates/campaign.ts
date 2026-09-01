// lib/templates/campaign.ts
//
// One film per row, and an honest number before anything is spent.
//
// THIS IS THE ONLY LOOP IN THE STUDIO THAT SPENDS MONEY PER ITERATION, so it
// is the one place where being wrong is expensive rather than embarrassing. The
// design follows from that:
//
//   THE COST IS SHOWN BEFORE, NOT AFTER. Every mode is priced from the same
//   per-unit numbers the rest of the tool uses, the total is displayed against
//   the actual row count, and the run cannot start until somebody has seen it.
//
//   THE CAP IS IN THE FUNCTION. A limit enforced by disabling a button is not a
//   limit; it is a suggestion that an API call ignores. `MAX_ROWS` is applied in
//   `buildCampaign`, and the ceiling here is applied again against the estimate.
//
//   THE THREE MODES ARE PRICED APART BY ORDERS OF MAGNITUDE, and the interface
//   has to say so, because they look almost identical when described in words
//   and differ by a factor of several hundred when run over a list.

import type { FilmTemplate } from './library'
import { seconds as templateSeconds } from './library'

export type PersonalisationMode = 'textOnly' | 'spokenName' | 'fullyGenerated'

export interface ModeInfo {
  readonly label: string
  readonly note: string
  /** What is regenerated for each row. */
  readonly regenerates: string
}

export const MODES: Readonly<Record<PersonalisationMode, ModeInfo>> = {
  textOnly: {
    label: 'Doar textul pe ecran',
    note: 'O singură voce pentru toate filmele; numele și firma apar scrise. ' +
      'Practic gratuit pe rând și acoperă majoritatea campaniilor de outreach.',
    regenerates: 'randarea',
  },
  spokenName: {
    label: 'Numele și rostit',
    note: 'O linie de voce nouă pentru fiecare rând, ca avatarul să spună numele. ' +
      'Mult mai puternic și cu un cost real pe rând.',
    regenerates: 'o linie de voce + randarea',
  },
  fullyGenerated: {
    label: 'Imagini noi pentru fiecare rând',
    note: 'Se regenerează și imaginile și mișcarea. Foarte scump — de obicei greșit ' +
      'pentru o listă, potrivit pentru cinci filme cu miză mare.',
    regenerates: 'imagini + mișcare + voce + randarea',
  },
}

/**
 * Per-unit costs, in USD.
 *
 * Taken from the same numbers the rest of the Studio quotes, so a campaign
 * estimate and a single-film estimate cannot disagree. Rendering is counted as
 * zero because it runs on a box that is already paid for — the honest figure
 * is time, not money, and time is reported separately.
 */
export const COSTS = {
  /** Per character of generated speech, averaged across the wired providers. */
  voicePerCharacter: 0.00018,
  /** One generated still. */
  imagePerPicture: 0.04,
  /** One second of generated motion, on the default model. */
  motionPerSecond: 0.112,
  /** One lipsync pass. */
  lipsyncPerClip: 0.20,
}

export interface CampaignEstimate {
  readonly rows: number
  readonly mode: PersonalisationMode
  readonly usd: number
  readonly usdPerRow: number
  readonly renderMinutes: number
  readonly breakdown: readonly { readonly what: string; readonly usd: number }[]
  readonly warnings: readonly string[]
}

/**
 * Price a campaign before running it.
 *
 * `scriptChars` is the length of ONE film's script after substitution, which is
 * what a voice provider actually bills for. Using the template's raw script
 * would under-count every row by the length of the merge fields — small per
 * row, and consistently in the flattering direction across five hundred of them.
 */
export function estimateCampaign(
  template: FilmTemplate,
  mode: PersonalisationMode,
  rows: number,
  opts: {
    scriptChars?: number
    picturesPerFilm?: number
    motionSecondsPerFilm?: number
    lipsync?: boolean
    renderSecondsPerFilm?: number
  } = {},
): CampaignEstimate {
  const n = Math.max(0, Math.floor(rows))
  const chars = opts.scriptChars ?? (template.script?.length ?? 0)
  const pictures = opts.picturesPerFilm ?? template.beats.filter(b => !b.pictureSlot).length
  const motionSeconds = opts.motionSecondsPerFilm ?? 0
  const renderPer = opts.renderSecondsPerFilm ?? templateSeconds(template) / 0.11

  const items: { what: string; usd: number }[] = []
  const warnings: string[] = []

  if (mode === 'spokenName' || mode === 'fullyGenerated') {
    const usd = chars * COSTS.voicePerCharacter * n
    items.push({ what: `Voce · ${chars} caractere × ${n} filme`, usd })
    if (opts.lipsync) items.push({ what: `Lipsync × ${n}`, usd: COSTS.lipsyncPerClip * n })
  } else {
    items.push({ what: 'Voce · o singură dată, refolosită', usd: chars * COSTS.voicePerCharacter })
  }

  if (mode === 'fullyGenerated') {
    items.push({ what: `Imagini · ${pictures} × ${n} filme`, usd: COSTS.imagePerPicture * pictures * n })
    if (motionSeconds > 0) {
      items.push({ what: `Mișcare · ${motionSeconds}s × ${n} filme`, usd: COSTS.motionPerSecond * motionSeconds * n })
    }
  }

  const usd = items.reduce((s, i) => s + i.usd, 0)
  const renderMinutes = Math.round((renderPer * n) / 60)

  if (mode === 'fullyGenerated' && n > 20) {
    warnings.push(
      `${n} filme cu imagini noi costă ${usd.toFixed(0)} $. Aproape sigur vrei ` +
      `„${MODES.textOnly.label}” sau „${MODES.spokenName.label}”.`)
  }
  if (renderMinutes > 240) {
    warnings.push(
      `Randarea durează în jur de ${Math.round(renderMinutes / 60)} ore pe un singur worker. ` +
      'Pornește campania când nu ai nevoie de studio pentru altceva.')
  }
  if (usd > 100) warnings.push(`Peste 100 $ într-o singură campanie. Verifică lista înainte.`)

  return {
    rows: n,
    mode,
    usd,
    usdPerRow: n > 0 ? usd / n : 0,
    renderMinutes,
    breakdown: items,
    warnings,
  }
}

/** Above this, a campaign must be confirmed a second time, whatever the mode. */
export const CONFIRM_ABOVE_USD = 25

export interface CampaignGate {
  readonly allowed: boolean
  readonly needsConfirmation: boolean
  readonly reason?: string
}

/**
 * Should this campaign be allowed to start?
 *
 * A pure function, so the same decision is reachable from a button, an API
 * route and a test. A gate that exists only in a click handler is a gate that
 * the next feature to call this code will not have.
 */
export function gate(estimate: CampaignEstimate, ceilingUsd: number): CampaignGate {
  if (estimate.rows === 0) {
    return { allowed: false, needsConfirmation: false, reason: 'Lista e goală.' }
  }
  if (estimate.usd > ceilingUsd) {
    return {
      allowed: false,
      needsConfirmation: false,
      reason: `Estimarea e ${estimate.usd.toFixed(2)} $, peste plafonul de ${ceilingUsd.toFixed(2)} $ ` +
        'pe care l-ai fixat. Ridică plafonul sau scurtează lista.',
    }
  }
  return {
    allowed: true,
    needsConfirmation: estimate.usd > CONFIRM_ABOVE_USD,
    ...(estimate.usd > CONFIRM_ABOVE_USD
      ? { reason: `${estimate.usd.toFixed(2)} $ pentru ${estimate.rows} filme.` }
      : {}),
  }
}

export type JobState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface CampaignJob {
  readonly index: number
  readonly state: JobState
  readonly url?: string
  readonly error?: string
}

/**
 * How a partly-finished campaign stands.
 *
 * Campaigns fail halfway. What matters then is being able to resume exactly the
 * rows that did not finish, without re-spending on the ones that did — so
 * failures are per-row state rather than one boolean for the whole run.
 */
export function progress(jobs: readonly CampaignJob[]): {
  done: number; failed: number; pending: number; running: number; percent: number
} {
  const count = (s: JobState) => jobs.filter(j => j.state === s).length
  const done = count('done'), failed = count('failed')
  return {
    done,
    failed,
    pending: count('pending'),
    running: count('running'),
    percent: jobs.length ? Math.round(((done + failed) / jobs.length) * 100) : 0,
  }
}

/** Rows to run when resuming: everything not already finished. */
export const toResume = (jobs: readonly CampaignJob[]): number[] =>
  jobs.filter(j => j.state !== 'done').map(j => j.index)
