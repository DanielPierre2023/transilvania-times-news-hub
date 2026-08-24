/**
 * Regression tests for the "DELAYED rows whose estimate has passed" cleanup.
 *
 * The bug: on 2026-08-24 08:37 Bucharest, Animawings A2 107 was still shown
 * on the board as "Delayed → 01:00" — but 01:00 was 7½ hours ago and the row
 * had not been updated since 22:40 the previous night (the airport dropped
 * it from its published timetable once it completed, so no fresh upsert ever
 * touched it; the sticky-restore only fires on SCHEDULED → terminal).
 *
 * The fix promotes DELAYED rows whose estimated time is 60+ min in the past
 * to DEPARTED (departures) / LANDED (arrivals), preserving the estimate as
 * the actual. Runs both in-memory (this test) and against the DB (in the
 * live function, separately).
 *
 * Run:  node supabase/functions/flights-sync/stale.regression.mjs
 */

const rec = (dir, dateTime, extra = {}) => {
  const [flight_date, scheduled_time] = dateTime.split(' ')
  return { direction: dir, flight_date, scheduled_time, status: 'DELAYED', estimated_time: '01:00', ...extra }
}
const dayUtc = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d) }
const minutesOf = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

// The exact in-function block, extracted verbatim from index.ts.
function cleanup(all, todayIso, nowMin) {
  for (const rec of all) {
    if (rec.status !== 'DELAYED' || !rec.estimated_time) continue
    const estIdx = Math.round((dayUtc(rec.flight_date) - dayUtc(todayIso)) / 86_400_000) * 1440 +
      minutesOf(String(rec.estimated_time).slice(0, 5))
    if (estIdx < nowMin - 60) {
      rec.status = rec.direction === 'departure' ? 'DEPARTED' : 'LANDED'
    }
  }
}

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}`)
  else { failed++; console.log(`FAIL  ${name}  ${detail}`) }
}

// 1. THE INCIDENT: scheduled 22:00 Aug 23, est 01:00 Aug 24. Now Aug 24 08:37.
{
  const r = [rec('departure', '2026-08-23 22:00', { estimated_time: '01:00', flight_date: '2026-08-23' })]
  // The estimate 01:00 is the next-day arrival at destination — but for this
  // flight `estimated_time` is the DEPARTURE revised time, so 01:00 on the
  // SAME flight_date. The estimate crosses midnight visually; the record's
  // flight_date is still Aug 23. Test the exact production case:
  cleanup(r, '2026-08-24', 8 * 60 + 37)
  check('A2 107: DELAYED 22:00→01:00 promoted to DEPARTED after 08:37 next day',
    r[0].status === 'DEPARTED', `got ${r[0].status}`)
}

// 2. Not yet time — must NOT promote (est 30 min in the future).
{
  const r = [rec('departure', '2026-08-24 08:00', { estimated_time: '09:00', flight_date: '2026-08-24' })]
  cleanup(r, '2026-08-24', 8 * 60 + 30)
  check('DELAYED with est 30 min ahead stays DELAYED', r[0].status === 'DELAYED')
}

// 3. Just 30 min past estimate — grace window, still DELAYED.
{
  const r = [rec('departure', '2026-08-24 07:00', { estimated_time: '08:00', flight_date: '2026-08-24' })]
  cleanup(r, '2026-08-24', 8 * 60 + 30)
  check('DELAYED with est 30 min past stays DELAYED (grace)', r[0].status === 'DELAYED')
}

// 4. Arrival direction → LANDED, not DEPARTED.
{
  const r = [rec('arrival', '2026-08-24 05:00', { estimated_time: '06:00', flight_date: '2026-08-24' })]
  cleanup(r, '2026-08-24', 8 * 60 + 30)
  check('DELAYED arrival with old estimate → LANDED', r[0].status === 'LANDED')
}

// 5. DELAYED with no estimated_time at all — leave alone.
{
  const r = [{ direction: 'departure', flight_date: '2026-08-23', scheduled_time: '22:00', status: 'DELAYED', estimated_time: null }]
  cleanup(r, '2026-08-24', 8 * 60 + 30)
  check('DELAYED with no estimate stays DELAYED', r[0].status === 'DELAYED')
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
