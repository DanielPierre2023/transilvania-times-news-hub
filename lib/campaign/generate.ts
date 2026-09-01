// lib/campaign/generate.ts
//
// The per-row generation loop for `fullyGenerated` campaigns.
//
// The other two modes reuse one set of pictures: `textOnly` swaps text on a
// shared film, `spokenName` adds a voice line per row. This mode regenerates the
// PICTURES for every row, which is why it was costed and gated long before it
// was built — a few hundred rows is a few hundred dollars, and it is almost
// always the wrong choice for a list.
//
// It is the right choice for five films with real money behind them: a pitch to
// five named accounts, where the shot behind the offer is the account's own
// industry rather than stock.
//
// WHAT MAKES THIS DIFFERENT FROM A LOOP THAT CALLS AN IMAGE MODEL.
//
//   THE PROMPT CARRIES THE ROW. A generation loop that sends the template's
//   prompt unchanged produces the same picture every time and charges per row
//   for it. The row's own values are substituted into the prompt first, so the
//   shot is about that customer.
//
//   EVERY GENERATION IS METERED BEFORE THE NEXT ONE STARTS. A loop that spends
//   first and totals afterwards is how an estimate becomes a surprise. The
//   budget is checked between pictures, not between rows.
//
//   A FAILED PICTURE DOES NOT FAIL THE ROW. One refused image out of four is a
//   film with a gap, not a lost row — the beat falls back to whatever the
//   template supplied and the row is reported as partial.

import { substitute, type MergeField } from '../templates/merge'
import type { Draft } from '../templates/build'

export interface GenerateHooks {
  /** Text to picture. Returns a public url. */
  image(prompt: string, aspect: string): Promise<string>
  /** Optional: still to motion clip. Absent means stills stay stills. */
  motion?(imageUrl: string, seconds: number, prompt?: string): Promise<string>
  /** Record what was just spent. Called after each unit, never batched. */
  meter(kind: 'image' | 'motion', usd: number, meta?: Record<string, unknown>): Promise<void>
  /** Is there budget for this next unit? Checked BEFORE spending it. */
  canSpend(usd: number): Promise<boolean>
}

export const UNIT_COST = {
  image: 0.04,
  motionPerSecond: 0.112,
}

export interface RowGeneration {
  readonly draft: Draft
  readonly generated: number
  readonly failed: number
  readonly usd: number
  /** Set when the budget stopped the row part way. */
  readonly haltedOnBudget: boolean
  readonly notes: readonly string[]
}

/**
 * Generate this row's pictures and return the draft pointing at them.
 *
 * `withMotion` turns each generated still into a clip. It multiplies the cost by
 * roughly thirty, so it is off unless asked for — and the estimate the campaign
 * showed already reflected whichever way it was set.
 */
export async function generateRow(
  draft: Draft,
  row: Readonly<Record<string, string>>,
  hooks: GenerateHooks,
  { fields = [], withMotion = false, motionSeconds = 5 }: {
    fields?: readonly MergeField[]
    withMotion?: boolean
    motionSeconds?: number
  } = {},
): Promise<RowGeneration> {
  const scenes = [...draft.scenes]
  const notes: string[] = []
  let generated = 0
  let failed = 0
  let usd = 0
  let haltedOnBudget = false

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]
    // A beat that already has a picture — a slot the campaign filled, an avatar
    // frame — is left alone. Regenerating it would cost money to replace
    // something somebody chose.
    if (scene.url) continue
    const basePrompt = scene.imagePrompt
    if (!basePrompt) { notes.push(`Planul ${i + 1} nu are prompt de imagine.`); continue }

    // THE ROW GOES INTO THE PROMPT. Without this the loop pays per row for the
    // same picture.
    const prompt = substitute(basePrompt, row, fields).text

    if (!(await hooks.canSpend(UNIT_COST.image))) {
      haltedOnBudget = true
      notes.push(`Buget epuizat înainte de planul ${i + 1}.`)
      break
    }
    let url: string
    try {
      url = await hooks.image(prompt, draft.aspect)
      await hooks.meter('image', UNIT_COST.image, { shot: i + 1 })
      usd += UNIT_COST.image
      generated += 1
    } catch (err) {
      // A refused picture is a gap, not a lost row.
      failed += 1
      notes.push(`Planul ${i + 1}: ${String((err as Error)?.message || err).slice(0, 90)}`)
      continue
    }
    scenes[i] = { ...scene, url, kind: 'image' }

    if (withMotion && hooks.motion) {
      const cost = UNIT_COST.motionPerSecond * motionSeconds
      if (!(await hooks.canSpend(cost))) {
        haltedOnBudget = true
        notes.push(`Buget epuizat înainte de mișcarea planului ${i + 1} — planul rămâne fotografie.`)
        break
      }
      try {
        const clip = await hooks.motion(url, motionSeconds, scene.motionPrompt)
        await hooks.meter('motion', cost, { shot: i + 1, seconds: motionSeconds })
        usd += cost
        scenes[i] = { ...scenes[i], url: clip, kind: 'video' }
      } catch (err) {
        // The still survives. A film of stills is a film; a film of holes is not.
        notes.push(`Mișcarea planului ${i + 1} a eșuat, rămâne fotografia.`)
        void err
      }
    }
  }

  const stillMissing = scenes.filter(s => !s.url).map(s => s.awaiting).filter(Boolean) as string[]
  return {
    draft: { ...draft, scenes, missing: [...new Set([...draft.missing, ...stillMissing])] },
    generated,
    failed,
    usd,
    haltedOnBudget,
    notes,
  }
}

/** What a fully-generated campaign will cost, per row, before it starts. */
export function costPerRow(
  draft: Draft,
  { withMotion = false, motionSeconds = 5 }: { withMotion?: boolean; motionSeconds?: number } = {},
): number {
  const toGenerate = draft.scenes.filter(s => !s.url && s.imagePrompt).length
  const perPicture = UNIT_COST.image + (withMotion ? UNIT_COST.motionPerSecond * motionSeconds : 0)
  return toGenerate * perPicture
}
