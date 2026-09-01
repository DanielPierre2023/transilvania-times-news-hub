// lib/campaign/runner.ts
//
// The driver loop, written once so a browser tab and a server poller cannot
// drift apart.
//
// Everything the loop DECIDES lives in queue.ts and everything it TOUCHES is
// passed in here as four functions. That separation is not tidiness: it is what
// lets the loop be tested without a database, a render worker, or money — and
// it is what stops there being two subtly different runners the first time
// somebody wants this to run on a server as well as in a tab.
//
// WHAT THE LOOP GUARANTEES, AND WHAT IT DOES NOT.
//
//   It will not start a row it has not claimed, and the claim is atomic in SQL,
//   so a row is never rendered twice. It will not exceed the ceiling, because
//   it checks BEFORE each row rather than after. It gives back rows it is
//   holding when it stops cleanly, so a closed tab costs nothing.
//
//   It does NOT guarantee that a row which is rendering right now finishes if
//   the process dies — the render is somebody else's job and may well complete
//   on the worker. The lease expires, the row is claimed again, and it is
//   rendered a second time. Paying twice for one row after a crash is the
//   deliberate trade against never finishing at all, and `onDuplicate` exists
//   so a caller that can detect an already-rendered output can skip it.

import {
  DEFAULTS, afterFailure, nextStep, progressOf,
  type HaltReason, type Job, type Progress, type RunnerConfig,
} from './queue'

export interface RowResult {
  readonly url: string
  readonly costUsd: number
}

export interface Driver {
  /** Atomically take one row, or null when there is nothing to take. */
  claim(): Promise<{ rowIndex: number; attempts: number } | null>
  /** Render one row. Throwing is a failure; the message decides the retry. */
  render(rowIndex: number, signal: AbortSignal): Promise<RowResult>
  finish(rowIndex: number, result: RowResult): Promise<void>
  fail(rowIndex: number, error: string, retryAt: number | null, exhausted: boolean): Promise<void>
  /** Hand a held row back without counting the attempt. */
  release(rowIndex: number): Promise<void>
  /** The current state of every row. Re-read each tick; another driver may be working too. */
  load(): Promise<Job[]>
}

export interface RunnerEvents {
  onProgress?(p: Progress): void
  onRowStart?(rowIndex: number): void
  onRowDone?(rowIndex: number, r: RowResult): void
  onRowFail?(rowIndex: number, error: string, willRetry: boolean): void
  onHalt?(reason: HaltReason, message: string): void
  /** A row whose output already exists — see the note about crashes above. */
  onDuplicate?(rowIndex: number): void
}

export interface RunHandle {
  /** Stop after the rows in flight finish, handing back anything unstarted. */
  stop(): void
  /** Stop now, abandoning renders in flight and releasing their rows. */
  abort(): void
  readonly done: Promise<{ reason: HaltReason; progress: Progress }>
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(res => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
})

/**
 * Run a campaign until it finishes, halts, or is stopped.
 *
 * The loop re-reads every row on each tick rather than trusting what it did
 * last time. That costs a query per tick and buys the thing that matters: two
 * drivers on the same campaign converge instead of fighting, because both see
 * the same truth and the claim decides who does what.
 */
export function runCampaign(
  driver: Driver,
  cfg: RunnerConfig = DEFAULTS,
  events: RunnerEvents = {},
): RunHandle {
  const controller = new AbortController()
  let stopping = false
  const inFlight = new Map<number, AbortController>()
  const durations: number[] = []

  const done = (async () => {
    let reason: HaltReason = null
    let jobs: Job[] = []

    while (!controller.signal.aborted) {
      jobs = await driver.load()
      const step = nextStep(jobs, inFlight.size, cfg)

      if (step.halt) { reason = step.halt; break }
      if (stopping && inFlight.size === 0) { reason = null; break }

      if (!stopping && step.claim.length > 0) {
        // The runner asks for N rows but takes them ONE AT A TIME through the
        // atomic claim. Asking the database for "the next row" repeatedly is
        // what makes several drivers safe; asking for a list would not be.
        for (let i = 0; i < step.claim.length; i++) {
          const taken = await driver.claim()
          if (!taken) break
          startRow(taken.rowIndex)
        }
      }

      // PROGRESS IS REPORTED WITH THIS DRIVER'S OWN IN-FLIGHT SET OVERLAID.
      //
      // `jobs` was read at the top of the tick, before this tick's claims, so a
      // row this driver is rendering right now still reads as pending in it.
      // Reported raw, the interface says "0 running" for the entire length of a
      // short campaign — which is exactly what it did until this was measured.
      // The driver knows what it is doing; the database is merely behind.
      const view = jobs.map(j => inFlight.has(j.rowIndex) && j.state !== 'done'
        ? { ...j, state: 'running' as const }
        : j)
      const p = progressOf(view, durations.length
        ? durations.reduce((s, d) => s + d, 0) / durations.length
        : null, cfg)
      events.onProgress?.(p)

      if (inFlight.size === 0 && step.claim.length === 0) {
        await sleep(step.sleepMs ?? 2_000, controller.signal)
      } else {
        // Short while work is in flight. A 500 ms tick meant a campaign of fast
        // rows could finish inside one sleep, so the interface saw the start and
        // the end and nothing in between.
        await sleep(100, controller.signal)
      }
    }

    // Give back anything still held, so the next driver does not wait out a
    // ten-minute lease on work nobody is doing.
    await Promise.all([...inFlight.keys()].map(async row => {
      inFlight.get(row)?.abort()
      try { await driver.release(row) } catch { /* the lease will cover it */ }
    }))
    inFlight.clear()

    jobs = await driver.load().catch(() => jobs)
    const progress = progressOf(jobs, null, cfg)
    if (reason) {
      const { HALT_MESSAGE } = await import('./queue')
      events.onHalt?.(reason, HALT_MESSAGE[reason])
    }
    return { reason, progress }
  })()

  function startRow(rowIndex: number) {
    const ac = new AbortController()
    inFlight.set(rowIndex, ac)
    events.onRowStart?.(rowIndex)
    const began = Date.now()

    driver.render(rowIndex, ac.signal)
      .then(async result => {
        durations.push(Date.now() - began)
        await driver.finish(rowIndex, result)
        events.onRowDone?.(rowIndex, result)
      })
      .catch(async err => {
        if (ac.signal.aborted) {
          // Abandoned by us, not failed by the provider. Hand it back whole.
          try { await driver.release(rowIndex) } catch { /* lease covers it */ }
          return
        }
        const message = (err as Error)?.message || String(err)
        const current = { rowIndex, state: 'running' as const, attempts: 0, leaseUntil: null, costUsd: 0 }
        const after = afterFailure(current, message, Date.now(), cfg)
        const willRetry = after.notBefore !== undefined
        await driver.fail(rowIndex, message, after.notBefore ?? null, !willRetry)
        events.onRowFail?.(rowIndex, message, willRetry)
      })
      .finally(() => { inFlight.delete(rowIndex) })
  }

  return {
    stop() { stopping = true },
    abort() { controller.abort() },
    done,
  }
}
