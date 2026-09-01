// render-worker/src/campaign-poller.js
//
// A campaign that finishes with nobody watching.
//
// OFF UNLESS EXPLICITLY TURNED ON. It needs a Supabase service key in the
// worker's environment, which is a real decision with real consequences — that
// key bypasses row level security entirely. So the poller does nothing at all
// unless CAMPAIGN_POLL is set AND both credentials are present, and it says
// which of the three is missing rather than failing silently.
//
//   CAMPAIGN_POLL=1
//   SUPABASE_URL=https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...
//
// WHY THIS IS SMALL.
//
// It does not build timelines. Each row carries the finished timeline it was
// created with, so this file claims a row, renders a document that already
// exists, and reports the result. The films it makes are identical to the ones
// the browser makes — not because two builders agree, but because there is one
// document and both render it.
//
// The claim is the same atomic SQL function the browser uses, so a tab and this
// poller can work the same campaign at the same time without either doing a row
// twice. That property is not a nice-to-have here: the common case is somebody
// starting a campaign in a tab, closing the laptop, and the worker finishing it.

const LEASE_MS = 10 * 60_000
const MAX_ATTEMPTS = 3
const IDLE_MS = 15_000
const BUSY_MS = 1_500

/** What is missing, in words, or null when the poller can run. */
function whyDisabled(env = process.env) {
  if (!env.CAMPAIGN_POLL) return 'CAMPAIGN_POLL is not set'
  if (!env.SUPABASE_URL) return 'SUPABASE_URL is not set'
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY is not set'
  return null
}

/**
 * Errors worth trying again.
 *
 * Deliberately the same rules as lib/campaign/queue.ts. Two different opinions
 * about what is retryable means a row that the browser gives up on is retried
 * forever by the worker, and paid for every time.
 */
function isRetryable(message) {
  const e = String(message || '').toLowerCase()
  const permanent = ['invalid', 'not found', '404', 'unsupported', 'malformed',
    'forbidden', '403', 'unauthorized', '401', 'content policy', 'safety', 'too long']
  if (permanent.some(p => e.includes(p))) return false
  return true
}

/** Exponential with jitter, from the row index — same shape as the browser's. */
function backoffMs(attempts, rowIndex = 0) {
  const raw = Math.min(5 * 60_000, 4_000 * Math.pow(2, Math.max(0, attempts - 1)))
  const spread = ((Math.sin(rowIndex * 12.9898) * 43758.5453) % 1 + 1) % 1
  return Math.round(raw * (0.75 + spread * 0.5))
}

function makeRest(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }
  return {
    async rpc(fn, body) {
      const r = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers, body: JSON.stringify(body),
      })
      const text = await r.text()
      if (!r.ok) throw new Error(`rpc ${fn} ${r.status}: ${text.slice(0, 200)}`)
      try { return text ? JSON.parse(text) : null } catch { return null }
    },
    async select(path) {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers })
      const text = await r.text()
      if (!r.ok) throw new Error(`select ${r.status}: ${text.slice(0, 200)}`)
      return text ? JSON.parse(text) : []
    },
    async patch(path, body) {
      const r = await fetch(`${base}/rest/v1/${path}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`patch ${r.status}: ${(await r.text()).slice(0, 200)}`)
    },
  }
}

/**
 * Run one row: claim, render the stored timeline, report.
 *
 * `render` is injected rather than required, so this whole file is testable
 * without ffmpeg, a database or money.
 */
async function runOne(rest, campaignId, driver, render, log = () => {}) {
  const claimed = await rest.rpc('claim_campaign_job', {
    p_campaign: campaignId, p_driver: driver,
    p_lease_ms: LEASE_MS, p_max_attempts: MAX_ATTEMPTS,
  })
  const row = Array.isArray(claimed) ? claimed[0] : claimed
  if (!row) return { claimed: false }

  const index = row.row_index
  try {
    const jobs = await rest.select(
      `studio_campaign_jobs?campaign_id=eq.${encodeURIComponent(campaignId)}` +
      `&row_index=eq.${index}&select=timeline`)
    const timeline = jobs && jobs[0] && jobs[0].timeline
    if (!timeline) {
      // A row with no timeline can never succeed — the campaign was created by
      // an older client. Permanent, so it burns its attempts at once rather
      // than being claimed and dropped three times.
      throw new Error('invalid row: no timeline stored')
    }

    log(`row ${index + 1}: rendering`)
    const out = await render(timeline)
    await rest.rpc('finish_campaign_job', {
      p_campaign: campaignId, p_row: index,
      p_url: out.url, p_cost: Number(out.costUsd || 0),
    })
    log(`row ${index + 1}: done`)
    return { claimed: true, ok: true, index }
  } catch (err) {
    const message = String((err && err.message) || err)
    const retryable = isRetryable(message)
    const exhausted = !retryable || row.attempts >= MAX_ATTEMPTS
    await rest.rpc('fail_campaign_job', {
      p_campaign: campaignId, p_row: index, p_error: message.slice(0, 500),
      p_retry_at: exhausted ? null : new Date(Date.now() + backoffMs(row.attempts, index)).toISOString(),
      p_exhaust: exhausted, p_max_attempts: MAX_ATTEMPTS,
    })
    log(`row ${index + 1}: failed${exhausted ? ' (final)' : ', will retry'} — ${message.slice(0, 120)}`)
    return { claimed: true, ok: false, index, message, exhausted }
  }
}

/** Campaigns asking to be worked on. */
async function runningCampaigns(rest) {
  return rest.select(
    'studio_campaigns?run_state=eq.running&select=id,ceiling_usd,spent_usd&order=started_at.asc&limit=5')
}

/**
 * The loop.
 *
 * Returns a handle rather than blocking, so the worker starts it and forgets
 * it, and a test can stop it.
 */
function startPoller({ render, env = process.env, log = console.log } = {}) {
  const why = whyDisabled(env)
  if (why) {
    log(`[campaign] poller off — ${why}`)
    return { enabled: false, stop() {}, reason: why }
  }
  const rest = makeRest(env)
  const driver = `worker-${process.pid}-${Math.random().toString(36).slice(2, 7)}`
  let stopped = false
  log(`[campaign] poller on as ${driver}`)

  ;(async () => {
    while (!stopped) {
      let worked = false
      try {
        for (const c of await runningCampaigns(rest)) {
          if (stopped) break
          // THE CEILING IS CHECKED HERE TOO, not only in the browser. A poller
          // that trusts the tab's gate is a second way to spend money that
          // nobody is watching.
          if (Number(c.spent_usd) >= Number(c.ceiling_usd)) {
            await rest.patch(`studio_campaigns?id=eq.${encodeURIComponent(c.id)}`,
              { run_state: 'halted', halt_reason: 'ceilingReached' })
            continue
          }
          const r = await runOne(rest, c.id, driver, render, m => log(`[campaign ${c.id}] ${m}`))
          if (r.claimed) worked = true
        }
      } catch (err) {
        log(`[campaign] poll error: ${String((err && err.message) || err).slice(0, 200)}`)
      }
      await new Promise(r => setTimeout(r, worked ? BUSY_MS : IDLE_MS))
    }
  })()

  return { enabled: true, driver, stop() { stopped = true } }
}

module.exports = { startPoller, runOne, whyDisabled, isRetryable, backoffMs, makeRest, LEASE_MS, MAX_ATTEMPTS }
