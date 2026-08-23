/**
 * Regression tests for the Cluj FIDS date-matching logic.
 *
 * The FIDS board publishes HH:MM with NO date, and it keeps showing the
 * previous day's completed flights for a while after midnight. On 2026-08-24
 * that produced a live incident: at 00:40 the board's "AIRBORNE 06:02" rows
 * were stamped onto the SAME DAY's 06:00 departures, so the site told readers
 * that flights leaving in five hours had already taken off.
 *
 * These tests pin the fix: each board row is matched against the scraped
 * timetable (which has real dates), and a row's status decides which days are
 * even admissible (fidsWindow). Run with:  node fids.regression.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import ts from '../../../node_modules/typescript/lib/typescript.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'index.ts'), 'utf8')
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return src.slice(i, j) }

const code = [
  cut('function flightKey', '// "2026-08-23'),
  cut('function fidsWindow', '/* ═══════════════ Networking'),
  cut('function minutesOf', 'function buildDisruptions'),
].join('\n')
const js = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText
const { applyFids } = (0, eval)(js + '; ({ applyFids })')

const rec = (date, no, t, status = 'SCHEDULED') => ({
  airport: 'CLJ', direction: 'departure', flight_date: date, flight_no: no,
  scheduled_time: t, status, status_raw: null, estimated_time: null,
  gate: null, checkin_desk: null,
})
const row = (no, t, status, est = null, gate = null) => ({
  direction: 'departure', flight_no_key: no, timeHHMM: t, dayOffset: 0,
  status, statusRaw: status, estHHMM: est, gate, checkinDesk: null,
})

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) { console.log(`  ok  ${name}`) }
  else { failed++; console.log(`FAIL  ${name}  ${detail}`) }
}

// 1. THE INCIDENT: 00:40, board still on yesterday. AIRBORNE must land on
//    yesterday's row, never on the identical flight leaving in five hours.
{
  const recs = [rec('2026-08-23', 'W4 3331', '06:00'), rec('2026-08-24', 'W4 3331', '06:00')]
  applyFids(recs, [row('W43331', '06:00', 'DEPARTED', '06:02', 'A6')], '2026-08-24', 40)
  check('AIRBORNE after midnight lands on yesterday', recs[0].status === 'DEPARTED')
  check('...and today\'s flight stays SCHEDULED', recs[1].status === 'SCHEDULED', recs[1].status)
}

// 2. Board rolled over: same time, no status yet → today's row gets the gate.
{
  const recs = [rec('2026-08-23', 'W4 3331', '06:00', 'DEPARTED'), rec('2026-08-24', 'W4 3331', '06:00')]
  applyFids(recs, [row('W43331', '06:00', '', null, 'A6')], '2026-08-24', 50)
  check('statusless row assigns gate to today', recs[1].gate === 'A6' && recs[0].gate === null)
}

// 3. Normal daytime case still works.
{
  const recs = [rec('2026-08-23', 'W4 3331', '06:00'), rec('2026-08-24', 'W4 3331', '06:00')]
  applyFids(recs, [row('W43331', '06:00', 'DEPARTED', '06:02')], '2026-08-23', 21 * 60)
  check('same-day AIRBORNE at 21:00', recs[0].status === 'DEPARTED' && recs[1].status === 'SCHEDULED')
}

// 4. Weekly flight whose only timetable entry is days away must NOT be stamped
//    (this produced phantom "departed" rows dated a week ahead).
{
  const recs = [rec('2026-08-30', 'H4 275', '15:50')]
  const n = applyFids(recs, [row('H4275', '15:50', 'DEPARTED', '15:58', 'A7')], '2026-08-24', 40)
  check('no stamp onto a far-future date', n === 0 && recs[0].status === 'SCHEDULED')
}

// 5. Check-in windows: implausible 10h out, correct 2h out.
{
  const far = [rec('2026-08-24', 'A2 107', '22:00')]
  check('CHECK-IN 10h out rejected', applyFids(far, [row('A2107', '22:00', 'CHECKIN')], '2026-08-24', 12 * 60) === 0)
  const near = [rec('2026-08-24', 'A2 107', '22:00')]
  applyFids(near, [row('A2107', '22:00', 'CHECKIN', null, 'A7')], '2026-08-24', 20 * 60)
  check('CHECK-IN 2h out accepted', near[0].status === 'CHECKIN' && near[0].gate === 'A7')
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
