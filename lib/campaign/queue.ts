// lib/campaign/queue.ts
//
// The decisions a campaign runner makes, as pure functions.
//
// A campaign is a loop that spends money per iteration and runs for hours
// without anyone watching. Everything below is the part that decides whether
// money is spent twice, never, or forever — kept out of the driver so it can be
// tested against ground truth rather than by starting a real campaign and
// watching the bill.
//
// THE FIVE WAYS AN UNATTENDED QUEUE COSTS SOMEBODY REAL MONEY:
//
//   1. TWO DRIVERS CLAIM THE SAME ROW. Two films, twice the spend, and the
//      second overwrites the first so nothing looks wrong. Prevented in SQL, by
//      an atomic claim — not here. This file assumes that guarantee and the
//      migration provides it; `52-queue.cjs` proves it with concurrent claimers
//      against a real Postgres.
//
//   2. A DRIVER DIES MID-RENDER. The row stays 'running' forever and the
//      campaign never finishes, with no error anywhere. Fixed by a LEASE: a
//      claim expires, and an expired claim is reclaimable.
//
//   3. A ROW THAT CAN NEVER SUCCEED IS RETRIED FOREVER. A malformed row, a
//      deleted asset, a voice provider that refuses that text — retried every
//      few seconds for as long as the campaign runs, paying each time.
//      Fixed by an attempt cap, and by telling retryable and permanent errors
//      apart rather than treating every failure the same.
//
//   4. A RETRY STORM. The provider has a bad minute, four hundred rows fail at
//      once, and all four hundred retry immediately — turning a blip into an
//      outage and a bill. Fixed by exponential backoff with jitter.
//
//   5. THE ESTIMATE WAS WRONG. Estimates are estimates; the real cost is what
//      the providers actually charged. A run that quietly drifts past its
//      ceiling is the failure the ceiling existed to prevent, so spend is
//      checked against what has ACTUALLY been spent, before every row.

export type JobState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Job {
  readonly rowIndex: number
  readonly state: JobState
  readonly attempts: number
  /** Unix ms when the current claim expires. Null when not claimed. */
  readonly leaseUntil: number | null
  readonly costUsd: number
  readonly error?: string
  /** Unix ms before which this row must not be tried again. */
  readonly notBefore?: number
}

export interface RunnerConfig {
  /** How long a claim is good for. Longer than the slowest render, or a slow
   *  row gets reclaimed and rendered twice while the first one is still going. */
  readonly leaseMs: number
  readonly maxAttempts: number
  readonly ceilingUsd: number
  /** Rows in flight at once. */
  readonly concurrency: number
}

export const DEFAULTS: RunnerConfig = {
  // Ten minutes. A 30-second film renders in about four and a half; a 4K one in
  // eighteen. The lease is deliberately NOT sized for the worst case — a 4K
  // campaign should raise it rather than every campaign paying for the
  // possibility, and a lease that never expires is the same as no lease.
  leaseMs: 10 * 60_000,
  maxAttempts: 3,
  ceilingUsd: 25,
  // Two at a time. The render worker is one box; more concurrency does not make
  // it faster, it makes every film slower and the failures harder to read.
  concurrency: 2,
}

// ── which rows are workable ────────────────────────────────────────────────

/**
 * Is this row available to be claimed right now?
 *
 * A row is workable when it is pending, or when it is 'running' with an EXPIRED
 * lease — that second case is how a driver that died gets its work back. It is
 * the whole reason the queue survives a browser tab being closed.
 */
export function isClaimable(job: Job, now: number, cfg: RunnerConfig = DEFAULTS): boolean {
  if (job.state === 'done' || job.state === 'cancelled') return false
  if (job.attempts >= cfg.maxAttempts) return false
  if (job.notBefore && now < job.notBefore) return false
  if (job.state === 'pending' || job.state === 'failed') return true
  // running: only if the lease has lapsed
  return job.state === 'running' && job.leaseUntil !== null && now > job.leaseUntil
}

/** Rows that will never be tried again, whatever happens. */
export const isTerminal = (job: Job, cfg: RunnerConfig = DEFAULTS): boolean =>
  job.state === 'done' || job.state === 'cancelled' || job.attempts >= cfg.maxAttempts

// ── backoff ────────────────────────────────────────────────────────────────

/**
 * How long to wait before trying a failed row again.
 *
 * Exponential, with jitter. THE JITTER IS NOT DECORATION: without it, four
 * hundred rows that failed in the same second retry in the same second, and a
 * provider having a bad minute gets a synchronised stampede from us on top of
 * whatever it was already struggling with. The jitter is deterministic in the
 * row index so the same row does not move around between calls, which would
 * make the queue impossible to reason about while watching it.
 */
export function backoffMs(attempts: number, rowIndex = 0, base = 4_000, cap = 5 * 60_000): number {
  const raw = Math.min(cap, base * Math.pow(2, Math.max(0, attempts - 1)))
  // ±25%, from the row index rather than from Math.random.
  const spread = ((Math.sin(rowIndex * 12.9898) * 43758.5453) % 1 + 1) % 1  // 0..1
  return Math.round(raw * (0.75 + spread * 0.5))
}

/**
 * Errors worth retrying, and errors that will fail identically forever.
 *
 * Retrying a permanent failure is the third way to burn money: a row whose text
 * a provider refuses does not start working because it is asked again, and
 * three attempts at it cost three times as much as one.
 */
export function isRetryable(error: string): boolean {
  const e = error.toLowerCase()
  const permanent = [
    'invalid', 'not found', '404', 'unsupported', 'malformed',
    'forbidden', '403', 'unauthorized', '401', 'content policy', 'safety',
    'too long', 'quota exceeded permanently',
  ]
  if (permanent.some(p => e.includes(p))) return false
  const transient = ['timeout', 'timed out', '429', '500', '502', '503', '504',
    'econnreset', 'socket hang up', 'rate limit', 'temporarily', 'overloaded']
  if (transient.some(t => e.includes(t))) return true
  // Unknown errors are retried, but the attempt cap still bounds the damage.
  // Defaulting the other way would mark a whole campaign permanently failed on
  // one unfamiliar message.
  return true
}

// ── spend ──────────────────────────────────────────────────────────────────

export interface Spend {
  readonly spentUsd: number
  readonly doneRows: number
  /** Mean cost of the rows that actually completed. */
  readonly perRowUsd: number
  /** Projected total if the remaining rows cost what the finished ones did. */
  readonly projectedUsd: number
}

/**
 * What this campaign has ACTUALLY cost, and where it is heading.
 *
 * Projected from measured rows rather than from the original estimate. The
 * estimate is what somebody approved; this is what is happening, and when the
 * two disagree it is the estimate that is wrong.
 */
export function spendOf(jobs: readonly Job[]): Spend {
  const done = jobs.filter(j => j.state === 'done')
  const spentUsd = jobs.reduce((s, j) => s + (j.costUsd || 0), 0)
  const perRowUsd = done.length ? done.reduce((s, j) => s + j.costUsd, 0) / done.length : 0
  const remaining = jobs.filter(j => j.state !== 'done' && j.state !== 'cancelled').length
  return {
    spentUsd,
    doneRows: done.length,
    perRowUsd,
    projectedUsd: spentUsd + remaining * perRowUsd,
  }
}

export type HaltReason =
  | 'ceilingReached'
  | 'ceilingProjected'
  | 'allAttemptsExhausted'
  | 'complete'
  | null

/**
 * Should the runner stop, and why?
 *
 * `ceilingProjected` stops the campaign BEFORE the ceiling is crossed rather
 * than after. Stopping on the row that breaches it means the breach already
 * happened and was paid for; a ceiling that can only be enforced retroactively
 * is not a ceiling.
 */
export function haltReason(
  jobs: readonly Job[],
  cfg: RunnerConfig = DEFAULTS,
  now = Date.now(),
): HaltReason {
  const spend = spendOf(jobs)
  if (spend.spentUsd >= cfg.ceilingUsd) return 'ceilingReached'

  const workable = jobs.filter(j => !isTerminal(j, cfg))
  if (workable.length === 0) {
    return jobs.every(j => j.state === 'done' || j.state === 'cancelled')
      ? 'complete'
      : 'allAttemptsExhausted'
  }
  // One more row at the measured rate would cross the line.
  if (spend.perRowUsd > 0 && spend.spentUsd + spend.perRowUsd > cfg.ceilingUsd) {
    return 'ceilingProjected'
  }
  // A row is workable but every one of them is waiting out its backoff: that is
  // not a halt, it is a pause. Deliberately not reported as a halt so the runner
  // sleeps rather than declaring the campaign over.
  void now
  return null
}

export const HALT_MESSAGE: Record<Exclude<HaltReason, null>, string> = {
  ceilingReached: 'Oprit: s-a atins plafonul de cheltuială.',
  ceilingProjected:
    'Oprit ÎNAINTE de plafon: încă un film la costul măsurat până acum l-ar depăși. ' +
    'Ridică plafonul ca să continui.',
  allAttemptsExhausted: 'Oprit: rândurile rămase au epuizat încercările.',
  complete: 'Gata: toate rândurile s-au terminat.',
}

// ── what to do next ────────────────────────────────────────────────────────

export interface NextStep {
  readonly claim: number[]
  readonly halt: HaltReason
  /** When nothing is claimable now but something will be, how long to sleep. */
  readonly sleepMs: number | null
}

/**
 * The single decision the driver asks for on every tick.
 *
 * Returning the whole decision — claim these, or halt, or sleep this long —
 * rather than exposing the pieces means a browser driver and a server driver
 * cannot drift apart in their behaviour, which they otherwise would within a
 * week.
 */
export function nextStep(
  jobs: readonly Job[],
  inFlight: number,
  cfg: RunnerConfig = DEFAULTS,
  now = Date.now(),
): NextStep {
  const halt = haltReason(jobs, cfg, now)
  if (halt) return { claim: [], halt, sleepMs: null }

  const room = Math.max(0, cfg.concurrency - inFlight)
  const ready = jobs
    .filter(j => isClaimable(j, now, cfg))
    .sort((a, b) => a.attempts - b.attempts || a.rowIndex - b.rowIndex)
    .slice(0, room)
    .map(j => j.rowIndex)

  if (ready.length > 0) return { claim: ready, halt: null, sleepMs: null }

  // Nothing ready. Either everything is in flight, or rows are waiting out a
  // backoff — sleep until the earliest of them is due rather than spinning.
  const waiting = jobs
    .filter(j => !isTerminal(j, cfg) && j.notBefore && j.notBefore > now)
    .map(j => j.notBefore as number)
  const leases = jobs
    .filter(j => j.state === 'running' && j.leaseUntil !== null)
    .map(j => j.leaseUntil as number)
  const soonest = [...waiting, ...leases].sort((a, b) => a - b)[0]
  return {
    claim: [],
    halt: null,
    sleepMs: soonest ? Math.max(1_000, Math.min(60_000, soonest - now)) : 2_000,
  }
}

/** The row's new state after an attempt failed. */
export function afterFailure(
  job: Job,
  error: string,
  now: number,
  cfg: RunnerConfig = DEFAULTS,
): Pick<Job, 'state' | 'attempts' | 'notBefore' | 'error' | 'leaseUntil'> {
  const attempts = job.attempts + 1
  const retryable = isRetryable(error)
  const exhausted = attempts >= cfg.maxAttempts || !retryable
  return {
    state: 'failed',
    attempts: exhausted ? cfg.maxAttempts : attempts,
    error: retryable ? error : `${error} (nu se reîncearcă)`,
    notBefore: exhausted ? undefined : now + backoffMs(attempts, job.rowIndex),
    leaseUntil: null,
  }
}

export interface Progress {
  readonly total: number
  readonly done: number
  readonly failed: number
  readonly running: number
  readonly pending: number
  readonly percent: number
  readonly spend: Spend
  readonly etaMs: number | null
}

/** Where a campaign stands, including when it will finish. */
export function progressOf(
  jobs: readonly Job[],
  msPerRow: number | null,
  cfg: RunnerConfig = DEFAULTS,
): Progress {
  const count = (s: JobState) => jobs.filter(j => j.state === s).length
  const done = count('done')
  const failed = jobs.filter(j => j.state === 'failed' && isTerminal(j, cfg)).length
  const running = count('running')
  const remaining = jobs.filter(j => !isTerminal(j, cfg)).length
  return {
    total: jobs.length,
    done,
    failed,
    running,
    pending: jobs.length - done - failed - running,
    percent: jobs.length ? Math.round(((done + failed) / jobs.length) * 100) : 0,
    spend: spendOf(jobs),
    etaMs: msPerRow && remaining
      ? Math.round((remaining / Math.max(1, cfg.concurrency)) * msPerRow)
      : null,
  }
}
