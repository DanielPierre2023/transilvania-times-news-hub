// ═══════════════════════════════════════════════════════════════════════════
// tt-column-worker — Phase 2 async columnist engine PUMP.
//
// pg_cron invokes this every minute (see the cron migration). It claims ONE
// column_jobs row with an atomic conditional claim, then runs that row's CURRENT
// phase by invoking tt-generate-article { mode:'column_phase', job_id }. One
// phase per tick; the generator advances the job's status and releases the claim.
// A single Opus draft, one enforcement pass, or one translate each finish well
// under the ~200s edge limit, so the wall never applies.
//
// DEPLOY with "Verify JWT" OFF (Functions → tt-column-worker → Details), exactly
// like your flights-sync function — it authenticates via the x-worker-secret it
// checks below. Set the COLUMN_WORKER_SECRET function secret to the same random
// string you store in Vault as column_worker_secret.
// ═══════════════════════════════════════════════════════════════════════════

const SB_URL        = Deno.env.get('SUPABASE_URL') || ''
const SB_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const WORKER_SECRET = Deno.env.get('COLUMN_WORKER_SECRET') || ''
const STALE_MS      = 3 * 60 * 1000   // reclaim a job whose phase has run > 3 min (crash recovery)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-worker-secret, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  // Fail closed. This function runs with Verify JWT off, so it does its own auth.
  if (!WORKER_SECRET || req.headers.get('x-worker-secret') !== WORKER_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (!SB_URL || !SB_KEY) return json({ ok: false, error: 'missing service env' }, 500)

  const staleIso = new Date(Date.now() - STALE_MS).toISOString()

  // 1) Find one claimable job: active status, not currently claimed (or claim stale).
  const findUrl = `${SB_URL}/rest/v1/column_jobs`
    + `?select=id,status`
    + `&status=in.(queued,drafting,revising,translating)`
    + `&or=(claimed_at.is.null,claimed_at.lt.${staleIso})`
    + `&order=created_at.asc&limit=1`
  const findRes = await fetch(findUrl, { headers: H })
  if (!findRes.ok) return json({ ok: false, error: `find failed: ${findRes.status}` }, 500)
  const candidates = await findRes.json() as { id: string; status: string }[]
  if (!candidates.length) return json({ ok: true, note: 'no claimable jobs' })
  const jobId = candidates[0].id

  // 2) Atomic conditional claim. The same not-claimed/stale filter on the PATCH
  //    means two concurrent ticks cannot both win: Postgres serialises the update
  //    and the loser's filter no longer matches. return=representation says if we won.
  const claimUrl = `${SB_URL}/rest/v1/column_jobs`
    + `?id=eq.${jobId}`
    + `&or=(claimed_at.is.null,claimed_at.lt.${staleIso})`
  const claimRes = await fetch(claimUrl, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ claimed_at: new Date().toISOString() }),
  })
  if (!claimRes.ok) return json({ ok: false, error: `claim failed: ${claimRes.status}` }, 500)
  const claimed = await claimRes.json() as unknown[]
  if (!claimed.length) return json({ ok: true, note: 'already claimed by another tick' })

  // 3) Run the job's current phase. The generator advances status + releases the
  //    claim (claimed_at:null). Each phase completes in a single sub-200s call.
  try {
    const genRes = await fetch(`${SB_URL}/functions/v1/tt-generate-article`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'column_phase', job_id: jobId }),
    })
    const out = await genRes.json().catch(() => ({}))
    return json({ ok: genRes.ok, job_id: jobId, phase: out })
  } catch (e) {
    // Release the claim so the next tick retries this job.
    await fetch(`${SB_URL}/rest/v1/column_jobs?id=eq.${jobId}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({ claimed_at: null }),
    })
    return json({ ok: false, job_id: jobId, error: (e as Error).message }, 500)
  }
})
