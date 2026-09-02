// lib/supabase/edgeError.ts
//
// THE FUNCTION SAID WHY. THE CLIENT THREW IT AWAY.
//
// `supabase.functions.invoke` returns a `FunctionsHttpError` whose `.message` is
// the fixed string "Edge Function returned a non-2xx status code" — the same
// sentence for a missing API key, an expired credit balance, a sample that is
// too short, a wrong payload and a crashed function. The function's real answer
// (`{ error: "FAL_KEY not set — ..." }`) is in `error.context`, which is the raw
// `Response`, and reading it is two lines that almost nobody writes.
//
// The cost of not writing them, measured on this project: every voice-cloning
// failure, every motion generation, every render and every TTS call in the
// Studio reported one identical sentence that named no step and no cause. The
// edge functions were careful — they return 400 with a specific message, 403
// with a consent explanation, 502 with the provider's own text — and none of it
// reached the screen.
//
// WHY THIS IS A MODULE AND NOT A HELPER INSIDE A PAGE.
//
// The Newsroom page already had this, written correctly, including a
// translation of fal's `TOP_UP` into "your prepaid credits ran out". The Studio,
// Producție and Podcast pages each had their own copy of the two-line version
// that throws `e.message`. Four call sites, one of them right — which is the
// normal outcome of a fix that lives in a page. So it lives here now, and a
// page that calls `invokeEdge` cannot get it wrong.
//
// A NOTE ON `.clone()`.
//
// A `Response` body can be read once. `error.context` is the live response, and
// anything else that has already read it leaves it consumed, so this clones
// before reading. Without the clone the second reader gets an empty string and
// the failure reads as "the function returned nothing" — a false trail that
// looks like a crashed function.

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Provider failures worth translating, and NOTHING ELSE.
 *
 * Each of these is a message that is technically accurate and practically
 * useless to the person reading it — they name a provider's internal state and
 * not the thing to go and do. The list is deliberately short: a wrong
 * translation is worse than no translation, because it sends someone to fix
 * something that is not broken. Anything not listed is shown verbatim.
 */
const TRANSLATIONS: { match: RegExp; say: string }[] = [
  {
    // Observed on this project, which is why the Newsroom page already carried
    // this exact translation before it moved here.
    match: /TOP_UP|User is locked/i,
    say: 'Creditele fal.ai s-au terminat (cont blocat: TOP_UP). Deschide fal.ai → Billing → ' +
      'Add credits (preplătit, fără abonament) și încearcă din nou.',
  },
  {
    match: /FAL_KEY not set/i,
    say: 'Cheia fal.ai nu e configurată în Supabase. Settings → Edge Functions → Secrets → FAL_KEY.',
  },
  {
    match: /ELEVENLABS_API_KEY|ElevenLabs key/i,
    say: 'Cheia ElevenLabs nu e configurată sau nu e validă. ' +
      'Supabase → Settings → Edge Functions → Secrets → ELEVENLABS_API_KEY.',
  },
  {
    match: /CONSENT_REQUIRED/i,
    say: 'Clonarea cere consimțământul explicit al persoanei: bifează caseta și scrie numele ei.',
  },
]

export function humaniseEdgeError(message: string): string {
  for (const t of TRANSLATIONS) if (t.match.test(message)) return t.say
  return message
}

/**
 * The function's own explanation, dug out of the error.
 *
 * Returns an empty string when there is nothing to dig — the caller then falls
 * back to the generic message rather than showing a blank failure.
 */
export async function readEdgeError(e: unknown): Promise<string> {
  const ctx = (e as { context?: unknown } | null)?.context
  if (!ctx || typeof (ctx as Response).clone !== 'function') return ''
  try {
    const body = await (ctx as Response).clone().json() as Record<string, unknown>
    if (typeof body?.error === 'string' && body.error) return body.error
    // Some functions answer `{ message }` or a bare string.
    if (typeof body?.message === 'string' && body.message) return body.message
    if (body && Object.keys(body).length) return JSON.stringify(body).slice(0, 400)
  } catch { /* not JSON — fall through to text */ }
  try {
    const text = await (ctx as Response).clone().text()
    if (text) return text.slice(0, 400)
  } catch { /* the body was already consumed elsewhere */ }
  return ''
}

/** The HTTP status, when it is available. Worth naming: 401 and 500 mean very different things. */
export function edgeStatus(e: unknown): number | null {
  const ctx = (e as { context?: unknown } | null)?.context
  const s = (ctx as Response | undefined)?.status
  return typeof s === 'number' ? s : null
}

export interface InvokeOptions {
  /**
   * Treat a 2xx body containing `{ error }` as a failure.
   *
   * Several functions here answer 200 with an error field — deliberately, so a
   * sleeping render worker reads as a clear message rather than as a generic
   * edge-function failure. A caller that wants to inspect that body itself
   * passes false.
   */
  readonly errorInBodyIsFatal?: boolean
}

/**
 * Call an edge function and fail with the reason it gave.
 *
 * The thrown message is always prefixed with the function name, because "non-2xx"
 * was not the only thing missing: a page that makes eleven different function
 * calls also has to say WHICH one failed.
 */
export async function invokeEdge<T = Record<string, unknown>>(
  client: SupabaseClient,
  fn: string,
  body: Record<string, unknown>,
  opts: InvokeOptions = {},
): Promise<T> {
  const { data, error } = await client.functions.invoke(fn, { body })
  if (error) {
    const detail = await readEdgeError(error)
    const status = edgeStatus(error)
    const raw = detail || (error as Error).message
    const said = humaniseEdgeError(raw)
    // The status is appended only when there is no real message: with one, it
    // is noise; without one, it is the only thing distinguishing "not deployed"
    // from "crashed".
    throw new Error(`${fn}: ${said}${!detail && status ? ` (HTTP ${status})` : ''}`)
  }
  if (opts.errorInBodyIsFatal !== false) {
    const d = data as { error?: string } | null
    if (d && typeof d.error === 'string' && d.error) {
      throw new Error(`${fn}: ${humaniseEdgeError(d.error)}`)
    }
  }
  return (data ?? {}) as T
}
