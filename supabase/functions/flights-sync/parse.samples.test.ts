import { extractFlightTable, mapRows, parseEwfList, type Source } from "./parse.ts";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ✓", name); }
  else { fail++; console.log("  ✗", name, extra ? JSON.stringify(extra) : ""); }
}

// ── Sibiu departures: scheduled + estimated + live status ──
const sbzDep = `<table class="flights"><thead><tr>
<th>Data</th><th>Spre</th><th>Indicativ</th><th>Companie</th>
<th>Oră programată plecare</th><th>Oră estimată plecare</th><th>Status</th>
</tr></thead><tbody>
<tr><td>23.08.2026</td><td>Larnaca</td><td>W4 9105</td><td>Wizz Air</td><td>06:00</td><td>06:01</td><td>DECOLAT</td></tr>
<tr><td>23.08.2026</td><td>Viena</td><td>OS 710</td><td>Austrian Airlines</td><td>13:40</td><td>13:40</td><td>CHECK-IN</td></tr>
<tr><td>23.08.2026</td><td>Creta Heraklion</td><td>A2 4154</td><td>Animawings</td><td>21:50</td><td>17:45</td><td>MODIFICARE ORA</td></tr>
</tbody></table>`;
{
  const src: Source = { airport: "SBZ", direction: "departure", url: "sbz" };
  const t = extractFlightTable(sbzDep)!;
  const r = mapRows(src, t, "NOW");
  console.log("SBZ departures →", r.length, "rows");
  ok("SBZ 3 rows", r.length === 3, r.map(x => x.flight_no));
  const f0 = r[0];
  ok("SBZ f0 flight W4 9105", f0.flight_no === "W4 9105", f0.flight_no);
  ok("SBZ f0 city Larnaca", f0.city === "Larnaca", f0.city);
  ok("SBZ f0 airline Wizz Air", f0.airline === "Wizz Air", f0.airline);
  ok("SBZ f0 sched 06:00", f0.scheduled_time === "06:00", f0.scheduled_time);
  ok("SBZ f0 est 06:01", f0.estimated_time === "06:01", f0.estimated_time);
  ok("SBZ f0 status DEPARTED", f0.status === "DEPARTED", f0.status);
  ok("SBZ f1 status CHECKIN", r[1].status === "CHECKIN", r[1].status);
  ok("SBZ f2 status DELAYED", r[2].status === "DELAYED", r[2].status);
  ok("SBZ f2 est 17:45 (not sched)", r[2].estimated_time === "17:45" && r[2].scheduled_time === "21:50", { s: r[2].scheduled_time, e: r[2].estimated_time });
}

// ── Cluj departures: schedule only, ORA PLECARE (not SOSIRE), CHARTER flag ──
const cljDep = `<table><tr>
<th>DATA</th><th>NR. ZBOR</th><th>LA</th><th>COMPANIE</th><th>AVION</th><th>ORA PLECARE</th><th>ORA SOSIRE</th><th>OBSERVATII</th>
</tr>
<tr><td>23/08/2026</td><td>W4 3331</td><td>Beauvais</td><td>Wizz Air</td><td>A320</td><td>06:00</td><td>08:10</td><td>—</td></tr>
<tr><td>23/08/2026</td><td>H4 8717</td><td>Hurghada</td><td>HiSky</td><td>A320</td><td>07:00</td><td>11:00</td><td>CHARTER</td></tr>
</table>`;
{
  const src: Source = { airport: "CLJ", direction: "departure", url: "clj" };
  const t = extractFlightTable(cljDep)!;
  const r = mapRows(src, t, "NOW");
  console.log("CLJ departures →", r.length, "rows");
  ok("CLJ 2 rows", r.length === 2, r.map(x => x.flight_no));
  ok("CLJ f0 sched 06:00 (ORA PLECARE)", r[0].scheduled_time === "06:00", r[0].scheduled_time);
  ok("CLJ f0 city Beauvais", r[0].city === "Beauvais", r[0].city);
  ok("CLJ f0 aircraft A320", r[0].aircraft === "A320", r[0].aircraft);
  ok("CLJ f0 status SCHEDULED", r[0].status === "SCHEDULED", r[0].status);
  ok("CLJ f1 charter flag", r[1].is_charter === true && r[1].status_raw === "CHARTER", { c: r[1].is_charter, s: r[1].status_raw });
  ok("CLJ f0 date 2026-08-23", r[0].flight_date === "2026-08-23", r[0].flight_date);
}

// ── Cluj arrivals: DE LA city, ORA SOSIRE time ──
const cljArr = `<table><tr>
<th>DATA</th><th>NR. ZBOR</th><th>DE LA</th><th>COMPANIE</th><th>AVION</th><th>ORA PLECARE</th><th>ORA SOSIRE</th><th>OBSERVATII</th>
</tr>
<tr><td>23/08/2026</td><td>W4 3332</td><td>Beauvais</td><td>Wizz Air</td><td>A320</td><td>05:00</td><td>07:30</td><td>—</td></tr>
</table>`;
{
  const src: Source = { airport: "CLJ", direction: "arrival", url: "clj" };
  const t = extractFlightTable(cljArr)!;
  const r = mapRows(src, t, "NOW");
  console.log("CLJ arrivals →", r.length, "rows");
  ok("CLJ arr sched 07:30 (ORA SOSIRE)", r[0].scheduled_time === "07:30", r[0].scheduled_time);
  ok("CLJ arr city Beauvais (DE LA)", r[0].city === "Beauvais", r[0].city);
}

// ── Târgu Mureș departures: live status, generic Ora column ──
const tgmDep = `<table><tr>
<th>Data</th><th>Ora</th><th>Zbor</th><th>Companie</th><th>Destinație</th><th>Status</th>
</tr>
<tr><td>23.08.2026</td><td>06:10</td><td>W4 3453</td><td>Wizzair Malta</td><td>Charleroi</td><td>DECOLAT LA 06:12</td></tr>
<tr><td>23.08.2026</td><td>13:20</td><td>W4 3459</td><td>Wizzair Malta</td><td>Dortmund</td><td>ÎN TIMP</td></tr>
</table>`;
{
  const src: Source = { airport: "TGM", direction: "departure", url: "tgm" };
  const t = extractFlightTable(tgmDep)!;
  const r = mapRows(src, t, "NOW");
  console.log("TGM departures →", r.length, "rows");
  ok("TGM 2 rows", r.length === 2, r.map(x => x.flight_no));
  ok("TGM f0 sched 06:10", r[0].scheduled_time === "06:10", r[0].scheduled_time);
  ok("TGM f0 city Charleroi", r[0].city === "Charleroi", r[0].city);
  ok("TGM f0 status DEPARTED", r[0].status === "DEPARTED", r[0].status);
  ok("TGM f1 status EN_ROUTE", r[1].status === "EN_ROUTE", r[1].status);
}

// ── Târgu Mureș: "ewf" plugin list (spans, not a table) ──
const tgmEwf = `<ul class="ewf-flights">
<li><div class="left-info">
<span class="ewf-flight-date list-date">25.08.2026</span>
<span class="ewf-flight-time list-time">15:30</span>
<span class="ewf-flight-number list-number">NSM3806</span></div>
<div class="right-info">
<span class="ewf-flight-airline list-airline">AIR CAIRO</span>
<span class="ewf-flight-location list-location">HURGADA</span>
<span class="ewf-flight-details list-details">In curs</span></div></li>
<li><div class="left-info">
<span class="ewf-flight-date list-date">23.08.2026</span>
<span class="ewf-flight-time list-time">06:10</span>
<span class="ewf-flight-number list-number">W4 3453</span></div>
<div class="right-info">
<span class="ewf-flight-airline list-airline">WIZZAIR MALTA</span>
<span class="ewf-flight-location list-location">Charleroi</span>
<span class="ewf-flight-details list-details">DECOLAT LA 06:12</span></div></li>
</ul>`;
{
  const src: Source = { airport: "TGM", direction: "departure", url: "tgm" };
  const r = parseEwfList(src, tgmEwf, "NOW");
  console.log("TGM ewf list →", r.length, "rows");
  ok("TGM ewf 2 rows", r.length === 2, r.map(x => x.flight_no));
  ok("TGM f0 flight NSM3806", r[0].flight_no === "NSM3806", r[0].flight_no);
  ok("TGM f0 city HURGADA", r[0].city === "HURGADA", r[0].city);
  ok("TGM f0 airline AIR CAIRO", r[0].airline === "AIR CAIRO", r[0].airline);
  ok("TGM f0 status EN_ROUTE (In curs)", r[0].status === "EN_ROUTE", r[0].status);
  ok("TGM f1 status DEPARTED", r[1].status === "DEPARTED", r[1].status);
  ok("TGM f1 estimated 06:12 (from DECOLAT LA)", r[1].estimated_time === "06:12", r[1].estimated_time);
  ok("TGM f1 sched 06:10", r[1].scheduled_time === "06:10", r[1].scheduled_time);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
