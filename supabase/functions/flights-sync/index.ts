// ───────────────────────────────────────────────────────────────────────────
// flights-sync — collects arrivals & departures for the three Transylvanian
// airports (Cluj-Napoca, Târgu Mureș, Sibiu) from their official public flight
// boards, normalizes them into one schema, and upserts into `airport_flights`.
//
// Invoked every 10 minutes by pg_cron (see the airport_flights_cron migration).
// Guarded by the `x-sync-secret` header so only the scheduler can trigger it.
//
//   POST            → sync all sources, write to DB, return a summary.
//   GET  ?test=1    → DRY RUN: parse all sources, return counts + samples,
//                     write nothing. Use this to validate parsers after deploy.
//
// SELF-CONTAINED single file (no sibling imports) so it deploys via the
// Supabase Dashboard editor or the CLI without bundling issues. The pure
// parsing functions below are mirrored in ./parse.ts, which is exercised by
// ./parse.samples.test.ts — keep the two in sync if you edit the parser.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ═══════════════ Pure parsing logic (mirrors parse.ts) ═══════════════ */

type AirportCode = "CLJ" | "TGM" | "SBZ";
type Direction = "departure" | "arrival";

interface Source {
  airport: AirportCode;
  direction: Direction;
  url: string;
}

const SOURCES: Source[] = [
  { airport: "CLJ", direction: "departure", url: "https://www.airportcluj.ro/informatii-zboruri/program-zboruri-plecari/" },
  { airport: "CLJ", direction: "arrival",   url: "https://www.airportcluj.ro/informatii-zboruri/program-zboruri-sosiri/" },
  { airport: "TGM", direction: "departure", url: "https://aeroportultransilvania.ro/plecari/" },
  { airport: "TGM", direction: "arrival",   url: "https://aeroportultransilvania.ro/sosiri/" },
  { airport: "SBZ", direction: "departure", url: "https://www.sibiuairport.ro/ro/informatii-zboruri/plecari/" },
  { airport: "SBZ", direction: "arrival",   url: "https://www.sibiuairport.ro/ro/informatii-zboruri/sosiri/" },
];

interface FlightRecord {
  airport: AirportCode;
  direction: Direction;
  flight_date: string;
  flight_no: string;
  airline: string | null;
  city: string | null;
  aircraft: string | null;
  scheduled_time: string;
  estimated_time: string | null;
  other_time: string | null;
  status: string;
  status_raw: string | null;
  is_charter: boolean;
  gate: string | null;         // from the CLJ FIDS board (with permission)
  checkin_desk: string | null; // idem — e.g. "13" from "CHECK-IN 13"
  source_url: string;
  updated_at: string;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normKey(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeStatus(raw: string | null | undefined): string {
  const s = stripDiacritics(String(raw ?? "")).toUpperCase().trim();
  if (!s || s === "-" || s === "—") return "SCHEDULED";
  if (/\bANULAT|CANCEL/.test(s)) return "CANCELLED";
  if (/\bDEVIAT|DIVERT/.test(s)) return "DIVERTED";
  if (/\bATERIZAT|LANDED|SOSIT|ARRIVED/.test(s)) return "LANDED";
  if (/\bDECOLAT|DEPARTED|PLECAT/.test(s)) return "DEPARTED";
  if (/\bIMBARCARE|BOARDING/.test(s)) return "BOARDING";
  if (/POARTA\s*INCHISA|GATE\s*CLOSED/.test(s)) return "GATE_CLOSED";
  if (/POARTA\s*DESCHISA|GATE\s*OPEN/.test(s)) return "GATE_OPEN";
  if (/CHECK.?IN/.test(s)) return "CHECKIN";
  if (/\bIN\s*ZBOR|IN\s*TIMP|IN\s*CURS|EN.?ROUTE|IN\s*AER/.test(s)) return "EN_ROUTE";
  if (/INTARZIAT|INTIRZIAT|DELAY|MODIFICARE\s*ORA|REPROGRAMAT|ESTIMAT/.test(s)) return "DELAYED";
  if (/PROGRAMAT|SCHEDULED|LA\s*ORA|ON\s*TIME|CONFIRMAT/.test(s)) return "SCHEDULED";
  return "UNKNOWN";
}

function parseDate(s: string): string | null {
  const m = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  let y = m[3];
  if (y.length === 2) y = "20" + y;
  return `${y}-${mo}-${d}`;
}

function parseTime(s: string): string | null {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function parseFlightNo(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/[A-Z0-9]{1,3}\s?\d{1,4}[A-Z]?/i);
  return m ? m[0].replace(/\s+/g, " ").toUpperCase() : (t || null);
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
  rowsRaw: string[];
}

function extractFlightTable(html: string): ParsedTable | null {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  const tables = clean.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  let best: ParsedTable | null = null;

  for (const table of tables) {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
    if (trs.length < 2) continue;

    const rowsCells: string[][] = trs.map((tr) => {
      const cells = tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? [];
      return cells.map(cellText);
    });

    let headerIdx = 0;
    for (let i = 0; i < Math.min(rowsCells.length, 3); i++) {
      const joined = normKey(rowsCells[i].join(" "));
      if (/(zbor|indicativ|cursa|flight|companie|status|data|ora|destinat|origine|spre|dinspre)/.test(joined)) {
        headerIdx = i;
        break;
      }
    }
    const headers = rowsCells[headerIdx].map(normKey);
    const isFlightTable = /(zbor|indicativ|cursa|flight)/.test(headers.join(" ")) ||
      /(companie|status|ora|data)/.test(headers.join(" "));
    if (!isFlightTable) continue;

    const rows: string[][] = [];
    const rowsRaw: string[] = [];
    trs.slice(headerIdx + 1).forEach((tr) => {
      const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText);
      if (cells.length >= 2) { rows.push(cells); rowsRaw.push(tr); }
    });
    const candidate: ParsedTable = { headers, rows, rowsRaw };
    if (!best || candidate.rows.length > best.rows.length) best = candidate;
  }
  return best;
}

// Resolve a column by keyword PRIORITY (specific labels beat generic fallbacks).
function col(headers: string[], ...keywords: string[]): number {
  for (const k of keywords) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h === k || h.includes(k)) return i;
    }
  }
  return -1;
}

function cleanCell(s: string): string | null {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t && t !== "-" && t !== "—" ? t : null;
}

function cleanCity(s: string): string | null {
  const t = (s || "").replace(/\s+/g, " ").trim().replace(/^[A-Z]{3}\s*(?=[A-Z][a-z])/, "");
  return t && t !== "-" && t !== "—" ? t : null;
}

// Sibiu scrambles the visible Status column but keeps the real value in a
// hidden <input value="…">; recover it from the raw row HTML.
const STATUS_WORD_RE =
  /(DECOLAT|ATERIZAT|ANULAT|INTARZIAT|INTIRZIAT|IMBARCARE|CHECK.?IN|PROGRAMAT|IN\s*CURS|IN\s*TIMP|IN\s*ZBOR|POARTA\s*INCHISA|POARTA\s*DESCHISA|MODIFICARE\s*ORA|CONFIRMAT|SOSIT|BOARDING|DEPARTED|LANDED|CANCEL|DELAY|GATE\s*CLOSED|GATE\s*OPEN|ESTIMAT)/;

function statusFromRaw(rowHtml: string): string | null {
  const re = /<input[^>]*\bvalue=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowHtml))) {
    if (STATUS_WORD_RE.test(stripDiacritics(m[1]).toUpperCase())) return m[1];
  }
  return null;
}

function scanDate(cells: string[]): string | null {
  for (const c of cells) {
    const d = parseDate(c);
    if (d) return d;
  }
  return null;
}

function scanTime(cells: string[], skipIdx: number): string | null {
  for (let i = 0; i < cells.length; i++) {
    if (i === skipIdx) continue;
    const t = parseTime(cells[i]);
    if (t) return t;
  }
  return null;
}

function dedupe(rows: FlightRecord[]): FlightRecord[] {
  const seen = new Set<string>();
  const out: FlightRecord[] = [];
  for (const r of rows) {
    const k = `${r.flight_date}|${r.flight_no}|${r.scheduled_time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function mapRows(src: Source, table: ParsedTable, nowIso: string): FlightRecord[] {
  const H = table.headers;
  const isDep = src.direction === "departure";

  const iDate = col(H, "data", "date", "ziua");
  const iFlight = col(H, "indicativ", "nr. zbor", "nr zbor", "zbor", "cursa", "flight", "zborul");
  const iAirline = col(H, "companie", "operator", "airline", "compania");
  const iCity = isDep
    ? col(H, "spre", "destinatie", "la", "destination", "catre", "oras")
    : col(H, "dinspre", "origine", "de la", "origin", "provenienta", "oras");
  const iAircraft = col(H, "avion", "aeronava", "aircraft", "tip");
  const iSched = isDep
    ? col(H, "ora programata plecare", "ora plecare", "programata", "ora plecarii", "plecare", "ora", "scheduled", "programat")
    : col(H, "ora programata sosire", "ora sosire", "programata", "ora sosirii", "sosire", "ora", "scheduled", "programat");
  const iEst = isDep
    ? col(H, "ora estimata plecare", "estimata", "estimated", "ora estimata")
    : col(H, "ora estimata sosire", "estimata", "estimated", "ora estimata");
  const iStatus = col(H, "status", "stare", "detalii", "observatii", "remarks", "info");
  // Time at the OTHER end of the leg (Cluj publishes both ORA PLECARE and
  // ORA SOSIRE); departures -> arrival at destination, arrivals -> origin departure.
  const iOther = isDep
    ? col(H, "ora sosire", "sosire")
    : col(H, "ora plecare", "plecare");

  const out: FlightRecord[] = [];

  for (let ri = 0; ri < table.rows.length; ri++) {
    const r = table.rows[ri];
    const rowRaw = table.rowsRaw[ri] ?? "";
    const get = (i: number) => (i >= 0 && i < r.length ? r[i] : "");

    const flight_no = parseFlightNo(get(iFlight));
    if (!flight_no) continue;

    const flight_date = parseDate(get(iDate)) ?? scanDate(r);
    if (!flight_date) continue;

    let scheduled_time = parseTime(get(iSched));
    if (!scheduled_time) scheduled_time = scanTime(r, iEst);
    if (!scheduled_time) continue;

    const estimated_time = iEst >= 0 ? parseTime(get(iEst)) : null;
    let statusRaw = iStatus >= 0 ? get(iStatus) : "";
    if (src.airport !== "CLJ") {
      const fromInput = statusFromRaw(rowRaw);
      if (fromInput) statusRaw = fromInput;
    }
    const is_charter = /charter/.test(normKey(r.join(" ")));
    let status = src.airport === "CLJ" ? "SCHEDULED" : normalizeStatus(statusRaw);
    // Derive lateness the source shows only via the estimated column
    // (e.g. Sibiu: status still PROGRAMAT but est ≥15 min after schedule).
    if (status === "SCHEDULED" && estimated_time && scheduled_time) {
      const slip = minutesOf(estimated_time) - minutesOf(scheduled_time);
      if (slip >= 15) status = "DELAYED";
    }

    out.push({
      airport: src.airport,
      direction: src.direction,
      flight_date,
      flight_no,
      airline: cleanCell(get(iAirline)),
      city: cleanCity(get(iCity)),
      aircraft: cleanCell(get(iAircraft)),
      scheduled_time,
      estimated_time,
      other_time: iOther >= 0 && iOther !== iSched ? parseTime(get(iOther)) : null,
      status,
      status_raw: src.airport === "CLJ" ? (is_charter ? "CHARTER" : null) : (statusRaw || null),
      is_charter,
      gate: null,
      checkin_desk: null,
      source_url: src.url,
      updated_at: nowIso,
    });
  }
  return dedupe(out);
}

// Parser for the "ewf" WordPress flights plugin (Târgu Mureș): spans, not a table.
const EWF_ROW =
  /ewf-flight-date[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-time[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-number[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-airline[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-location[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-details[^>]*>([\s\S]*?)<\/span>/gi;

function parseEwfList(src: Source, html: string, nowIso: string): FlightRecord[] {
  const out: FlightRecord[] = [];
  EWF_ROW.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EWF_ROW.exec(html))) {
    const flight_date = parseDate(cellText(m[1]));
    const scheduled_time = parseTime(cellText(m[2]));
    const flight_no = parseFlightNo(cellText(m[3]));
    if (!flight_date || !scheduled_time || !flight_no) continue;
    const statusRaw = cellText(m[6]);
    out.push({
      airport: src.airport, direction: src.direction, flight_date, flight_no,
      airline: cleanCell(cellText(m[4])), city: cleanCell(cellText(m[5])), aircraft: null,
      scheduled_time, estimated_time: parseTime(statusRaw), other_time: null,
      status: normalizeStatus(statusRaw), status_raw: statusRaw || null,
      is_charter: /charter/i.test(statusRaw + " " + (cellText(m[4]) || "")),
      gate: null, checkin_desk: null,
      source_url: src.url, updated_at: nowIso,
    });
  }
  return dedupe(out);
}

/* ── AeroDataBox (via RapidAPI) live-status enrichment.
 *    Primary use: Cluj, whose own site has no live status. Matching is by
 *    flight number + date, so it composes safely with the scraped schedule. ── */

interface AdxItem {
  direction: Direction;
  flight_no_key: string;   // normalized: no spaces, uppercase
  flight_date: string;     // YYYY-MM-DD (local)
  scheduledHHMM: string | null;
  revisedHHMM: string | null;
  status: string;          // our normalized StatusCode
  statusRaw: string;
  terminal: string | null;   // at this airport, when the airport publishes it
  gate: string | null;
  checkInDesk: string | null; // departures only, when published
}

// AeroDataBox status → our status codes.
function mapAdxStatus(s: string): string {
  const t = String(s || "").toLowerCase();
  if (t.includes("cancel")) return "CANCELLED";
  if (t.includes("divert")) return "DIVERTED";
  if (t.includes("arrived")) return "LANDED";
  if (t.includes("departed")) return "DEPARTED";
  if (t.includes("boarding")) return "BOARDING";
  if (t.includes("gate")) return "GATE_CLOSED";
  if (t.includes("check")) return "CHECKIN";
  if (t.includes("enroute") || t.includes("en route") || t.includes("approach")) return "EN_ROUTE";
  if (t.includes("delay")) return "DELAYED";
  if (t.includes("expected") || t.includes("scheduled")) return "SCHEDULED";
  return "UNKNOWN";
}

function flightKey(no: string): string {
  return String(no || "").toUpperCase().replace(/\s+/g, "");
}

// "2026-08-23 06:00+03:00" → { date, hhmm }
function splitAdxLocal(s: string | undefined): { date: string | null; hhmm: string | null } {
  const m = String(s ?? "").match(/(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? { date: m[1], hhmm: m[2] } : { date: null, hhmm: null };
}

// One call covers a 12h window. Sticky statuses preserve the past, so the
// window looks mostly FORWARD (now-1h → now+11h): delays, revisions and
// boarding states become visible hours before departure — which is what
// readers actually want from an estimate.
async function fetchAdxBoard(icao: string, key: string, pastOnly = false): Promise<AdxItem[]> {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d).replace(" ", "T");
  // pastOnly: one-off backfill of the previous 12h (e.g. after a gap).
  const from = fmt(new Date(Date.now() - (pastOnly ? 12 : 1) * 3600_000));
  const to = fmt(new Date(Date.now() + (pastOnly ? 0 : 11) * 3600_000));
  const url = `https://aerodatabox.p.rapidapi.com/flights/airports/icao/${icao}/${from}/${to}` +
    `?withLeg=false&direction=Both&withCancelled=true&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" },
      signal: controller.signal,
    });
    if (!r.ok) return [];
    const j = await r.json();
    const out: AdxItem[] = [];
    for (const dir of ["departures", "arrivals"] as const) {
      for (const f of (j?.[dir] ?? [])) {
        const sched = splitAdxLocal(f?.movement?.scheduledTime?.local);
        const revised = splitAdxLocal(f?.movement?.revisedTime?.local ?? f?.movement?.actualTime?.local);
        if (!f?.number || !sched.date) continue;
        out.push({
          direction: dir === "departures" ? "departure" : "arrival",
          flight_no_key: flightKey(f.number),
          flight_date: sched.date,
          scheduledHHMM: sched.hhmm,
          revisedHHMM: revised.hhmm,
          status: mapAdxStatus(f.status),
          statusRaw: String(f.status ?? ""),
          terminal: f?.movement?.terminal ? String(f.movement.terminal) : null,
          gate: f?.movement?.gate ? String(f.movement.gate) : null,
          checkInDesk: f?.movement?.checkInDesk ? String(f.movement.checkInDesk) : null,
        });
      }
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Stamp AeroDataBox statuses onto scraped records (match: flight no + date + direction). */
function applyAdx(records: FlightRecord[], items: AdxItem[], airport: AirportCode): number {
  const idx = new Map<string, AdxItem>();
  for (const it of items) idx.set(`${it.direction}|${it.flight_date}|${it.flight_no_key}`, it);
  let stamped = 0;
  for (const rec of records) {
    if (rec.airport !== airport) continue;
    const it = idx.get(`${rec.direction}|${rec.flight_date}|${flightKey(rec.flight_no)}`);
    if (!it || it.status === "UNKNOWN") continue;
    rec.status = it.status;
    if (it.revisedHHMM) rec.estimated_time = it.revisedHHMM;
    // ADX often reports a late flight as "Expected" + a revised time rather
    // than "Delayed" — derive it: ≥15 min slip ⇒ DELAYED.
    if (rec.status === "SCHEDULED" && it.revisedHHMM && it.scheduledHHMM) {
      const slip = minutesOf(it.revisedHHMM) - minutesOf(it.scheduledHHMM);
      if (slip >= 15) rec.status = "DELAYED";
    }
    rec.status_raw = it.statusRaw || rec.status_raw;
    stamped++;
  }
  return stamped;
}

/* ── Cluj VisionAir FIDS live board (used WITH THE AIRPORT'S PERMISSION).
 *    This is the airport's own display system — the authoritative source for
 *    gates, check-in desks and statuses like GATE OPEN / GATE CLOSED /
 *    AIRBORNE hh:mm / CHECK-IN 13/DELAYED hh:mm. Server-rendered table:
 *      <td class="flightNumber">W43331</td><td class="remote">Beauvais</td>
 *      <td class="time">06:00</td><td class="status">AIRBORNE 06:02</td>
 *      <td class="gate">A6</td>   (gate column: departures only)
 *    No date column — rows are chronological across ~2 days, so dates are
 *    inferred from midnight wraps and anchored against "now". ── */

const FIDS_BASE = "https://clj-ws.visionairfids.com/static-flights?type=";

interface FidsItem {
  direction: Direction;
  flight_no_key: string;
  timeHHMM: string;        // scheduled time on the board
  dayOffset: number;       // chronological day index within the board (0-based)
  status: string;          // our normalized StatusCode ("" = board shows none)
  statusRaw: string;
  estHHMM: string | null;  // actual/estimated time embedded in the status
  gate: string | null;
  checkinDesk: string | null;
}

/** "CHECK-IN 13/DELAYED 01:00" → parts; returns our status + extras. */
function parseFidsStatus(raw: string): { status: string; est: string | null; checkinDesk: string | null } {
  const parts = String(raw).split("/").map((p) => p.trim()).filter(Boolean);
  let status = "";
  let est: string | null = null;
  let checkinDesk: string | null = null;
  const rank: Record<string, number> = { // higher = more definitive
    CHECKIN: 1, GATE_OPEN: 2, BOARDING: 3, GATE_CLOSED: 4,
    DELAYED: 5, DEPARTED: 6, LANDED: 6, CANCELLED: 7, DIVERTED: 7,
  };
  for (const p of parts) {
    const u = stripDiacritics(p).toUpperCase();
    const time = parseTime(u);
    let s = "";
    if (/AIRBORNE|DEPARTED|DECOLAT/.test(u)) s = "DEPARTED";
    else if (/LANDED|ATERIZAT|ARRIVED|SOSIT/.test(u)) s = "LANDED";
    else if (/GATE\s*CLOSED|POARTA\s*INCHISA/.test(u)) s = "GATE_CLOSED";
    else if (/GATE\s*OPEN|POARTA\s*DESCHISA/.test(u)) s = "GATE_OPEN";
    else if (/BOARDING|IMBARCARE/.test(u)) s = "BOARDING";
    else if (/CHECK.?IN/.test(u)) {
      s = "CHECKIN";
      const d = u.replace(/CHECK.?IN/, "").trim();
      if (d && /^[\d\s,–-]+$/.test(d)) checkinDesk = d.replace(/\s+/g, "");
    } else if (/DELAYED|INTARZIAT|INTIRZIAT/.test(u)) s = "DELAYED";
    else if (/CANCEL|ANULAT/.test(u)) s = "CANCELLED";
    else if (/DIVERT|DEVIAT/.test(u)) s = "DIVERTED";
    else if (/^EST/.test(u)) s = ""; // "EST. 00:35" — time only, status neutral
    if (time && (s === "DEPARTED" || s === "LANDED" || s === "DELAYED" || /^EST/.test(u))) est = time;
    if (s && (rank[s] ?? 0) >= (rank[status] ?? 0)) status = s;
  }
  return { status, est, checkinDesk };
}

async function fetchFidsBoard(direction: Direction): Promise<FidsItem[]> {
  const html = await fetchHtml(FIDS_BASE + direction);
  const re = /<td class="flightNumber">([\s\S]*?)<\/td>\s*<td class="remote">([\s\S]*?)<\/td>\s*<td class="time">([\s\S]*?)<\/td>\s*<td class="status">([\s\S]*?)<\/td>(?:\s*<td class="gate">([\s\S]*?)<\/td>)?/gi;
  const out: FidsItem[] = [];
  let m: RegExpExecArray | null;
  let prevMin = -1;
  let dayOffset = 0;
  while ((m = re.exec(html))) {
    const flightNo = cellText(m[1]);
    const timeHHMM = parseTime(cellText(m[3]));
    if (!flightNo || !timeHHMM) continue;
    const t = minutesOf(timeHHMM);
    // Rows are chronological; a big backwards jump means midnight passed.
    if (prevMin >= 0 && t < prevMin - 300) dayOffset++;
    prevMin = t;
    const statusRaw = cellText(m[4]);
    const parsed = parseFidsStatus(statusRaw);
    const gate = m[5] !== undefined ? (cellText(m[5]) || null) : null;
    out.push({
      direction,
      flight_no_key: flightKey(flightNo),
      timeHHMM,
      dayOffset,
      status: parsed.status,
      statusRaw,
      estHHMM: parsed.est,
      gate,
      checkinDesk: parsed.checkinDesk,
    });
  }
  return out;
}

/** Anchor the board's relative day offsets to real dates: pick the start date
 *  (today-1 / today) under which no past-tense row (AIRBORNE/LANDED) lands in
 *  the future — the chronologically consistent reading. */
function fidsStartDelta(items: FidsItem[], nowMinOfToday: number): number {
  const score = (startDelta: number) => {
    let violations = 0;
    for (const it of items) {
      const idx = (startDelta + it.dayOffset) * 1440 + minutesOf(it.timeHHMM);
      if ((it.status === "DEPARTED" || it.status === "LANDED") && idx > nowMinOfToday + 45) violations++;
      if (idx < nowMinOfToday - 30 * 60) violations++; // implausibly old
    }
    return violations;
  };
  const a = score(-1), b = score(0);
  return a <= b ? -1 : 0;
}

/** Stamp FIDS statuses/gates onto CLJ records. Airport-official → wins over
 *  AeroDataBox where the board actually shows something. */
function applyFids(records: FlightRecord[], items: FidsItem[], todayIso: string, nowMinOfToday: number): number {
  if (!items.length) return 0;
  const addDaysIso = (iso: string, days: number) => {
    const [y, mo, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d + days));
    return dt.toISOString().slice(0, 10);
  };
  // Index CLJ records by direction|date|flight|schedtime, plus a loose index
  // without the date for single-candidate fallback.
  const byExact = new Map<string, FlightRecord>();
  const byLoose = new Map<string, FlightRecord[]>();
  for (const rec of records) {
    if (rec.airport !== "CLJ") continue;
    const k = `${rec.direction}|${rec.flight_date}|${flightKey(rec.flight_no)}|${rec.scheduled_time}`;
    byExact.set(k, rec);
    const lk = `${rec.direction}|${flightKey(rec.flight_no)}|${rec.scheduled_time}`;
    const arr = byLoose.get(lk) ?? [];
    arr.push(rec);
    byLoose.set(lk, arr);
  }
  let stamped = 0;
  const perDir: Record<string, number> = {};
  for (const it of items) {
    // day offsets are per-direction boards; compute start anchor per direction once
    if (!(it.direction in perDir)) {
      perDir[it.direction] = fidsStartDelta(items.filter((x) => x.direction === it.direction), nowMinOfToday);
    }
    const date = addDaysIso(todayIso, perDir[it.direction] + it.dayOffset);
    let rec = byExact.get(`${it.direction}|${date}|${it.flight_no_key}|${it.timeHHMM}`);
    if (!rec) {
      const cands = byLoose.get(`${it.direction}|${it.flight_no_key}|${it.timeHHMM}`) ?? [];
      if (cands.length === 1) rec = cands[0]; // unambiguous → date inference was off by one
    }
    if (!rec) continue;
    if (it.gate) rec.gate = it.gate;
    if (it.checkinDesk) rec.checkin_desk = it.checkinDesk;
    if (it.estHHMM) rec.estimated_time = it.estHHMM;
    if (it.status) {
      rec.status = it.status;
      rec.status_raw = it.statusRaw || rec.status_raw;
      // DELAYED with a revised time ≥15 min late is already DELAYED; a plain
      // "EST. hh:mm" only revises the estimate — derive lateness if large.
    } else if (it.estHHMM && rec.status === "SCHEDULED") {
      const slip = minutesOf(it.estHHMM) - minutesOf(it.timeHHMM);
      if (slip >= 15) { rec.status = "DELAYED"; rec.status_raw = it.statusRaw || rec.status_raw; }
    }
    if (it.status || it.estHHMM || it.gate || it.checkinDesk) stamped++;
  }
  return stamped;
}

/* ═══════════════ Networking + handler ═══════════════ */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sync-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const USER_AGENT =
  "TransilvaniaTimesFlightBot/1.0 (+https://transilvaniatimes.com; contact@transilvaniatimes.com)";
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024;

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ro,en;q=0.8", "Accept": "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) return await res.text();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function collectSource(src: Source): Promise<{ records: FlightRecord[]; error?: string }> {
  try {
    const html = await fetchHtml(src.url);
    const now = new Date().toISOString();
    // Table sites (Cluj, Sibiu) first; fall back to the ewf list (Târgu Mureș).
    const table = extractFlightTable(html);
    if (table) {
      const recs = mapRows(src, table, now);
      if (recs.length) return { records: recs };
    }
    const ewf = parseEwfList(src, html, now);
    if (ewf.length) return { records: ewf };
    return { records: [], error: table ? "table parsed 0 rows" : "no flight table/list found" };
  } catch (e) {
    return { records: [], error: String((e as Error)?.message ?? e) };
  }
}

// (OpenSky ADS-B path removed: its airport endpoints refuse recent windows —
//  "You cannot access historical flights" — so it can't power a live board.)
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("FLIGHTS_SYNC_SECRET");
  const provided = req.headers.get("x-sync-secret");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const dryRun = req.method === "GET" && url.searchParams.get("test") === "1";
  const adxKey = Deno.env.get("AERODATABOX_KEY") ?? "";

  // ?adxtest=1 — DRY RUN against AeroDataBox only: shows what live data it has
  // for each of the three airports, writes nothing, costs 3 API calls.
  if (req.method === "GET" && url.searchParams.get("adxtest") === "1") {
    if (!adxKey) return json({ error: "AERODATABOX_KEY not set" }, 400);
    const report: Record<string, unknown> = {};
    for (const [ap, icao] of [["CLJ", "LRCL"], ["TGM", "LRTM"], ["SBZ", "LRSB"]] as const) {
      const items = await fetchAdxBoard(icao, adxKey);
      const statuses: Record<string, number> = {};
      items.forEach((i) => { statuses[i.statusRaw || "?"] = (statuses[i.statusRaw || "?"] ?? 0) + 1; });
      report[ap] = {
        flightsIn12h: items.length,
        statuses,
        withTerminal: items.filter((i) => i.terminal).length,
        withGate: items.filter((i) => i.gate).length,
        withCheckInDesk: items.filter((i) => i.checkInDesk).length,
        sample: items.slice(0, 4),
      };
    }
    return json({ adxTest: true, report });
  }

  // ?fidstest=1 — DRY RUN against the Cluj FIDS board only: parsed rows,
  // status vocabulary and inferred dates. Writes nothing.
  if (req.method === "GET" && url.searchParams.get("fidstest") === "1") {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const nowMin = Number(parts.find((x) => x.type === "hour")?.value ?? 0) * 60 +
      Number(parts.find((x) => x.type === "minute")?.value ?? 0);
    const report: Record<string, unknown> = {};
    for (const dir of ["departure", "arrival"] as const) {
      try {
        const items = await fetchFidsBoard(dir);
        const statuses: Record<string, number> = {};
        items.forEach((i) => {
          const k = (i.statusRaw || "(empty)").replace(/\d{2}:\d{2}/g, "HH:MM");
          statuses[k] = (statuses[k] ?? 0) + 1;
        });
        report[dir] = {
          rows: items.length,
          startDelta: fidsStartDelta(items, nowMin),
          statuses,
          withGate: items.filter((i) => i.gate).length,
          withCheckinDesk: items.filter((i) => i.checkinDesk).length,
          sample: items.slice(-5),
        };
      } catch (e) {
        report[dir] = { error: String((e as Error)?.message ?? e) };
      }
    }
    return json({ fidsTest: true, report });
  }

  const perSource: Record<string, { count: number; error?: string; sample?: FlightRecord[] }> = {};
  const all: FlightRecord[] = [];
  for (const src of SOURCES) {
    const { records, error } = await collectSource(src);
    perSource[`${src.airport}:${src.direction}`] = {
      count: records.length,
      error,
      sample: dryRun ? records.slice(0, 3) : undefined,
    };
    all.push(...records);
  }

  // Enrich Cluj (schedule-only) with real live status from AeroDataBox.
  // One call per run (rolling 12h window) keeps usage inside small paid tiers.
  let adxStamped = 0;
  if (adxKey) {
    try {
      const pastOnly = url.searchParams.get("window") === "past";
      const items = await fetchAdxBoard("LRCL", adxKey, pastOnly);
      adxStamped = applyAdx(all, items, "CLJ");
    } catch { /* best-effort */ }
  }

  // Cluj FIDS live board (airport's own displays, used with permission):
  // authoritative statuses + gates + check-in desks. Stamped AFTER AeroDataBox
  // so the airport's own data wins wherever the board shows something.
  let fidsStamped = 0;
  {
    const todayIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const nowMin = Number(parts.find((x) => x.type === "hour")?.value ?? 0) * 60 +
      Number(parts.find((x) => x.type === "minute")?.value ?? 0);
    try {
      const [deps, arrs] = await Promise.all([fetchFidsBoard("departure"), fetchFidsBoard("arrival")]);
      fidsStamped = applyFids(all, [...deps, ...arrs], todayIso, nowMin);
    } catch { /* best-effort — ADX and the timetable still stand */ }
  }

  if (dryRun) return json({ dryRun: true, total: all.length, adxStamped, fidsStamped, sources: perSource });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Terminal statuses are STICKY: the CLJ scrape is schedule-only, so a fresh
  // upsert would revert flights already stamped DEPARTED/LANDED/CANCELLED once
  // they fall outside the AeroDataBox window. Preserve them from the DB.
  try {
    const TERMINAL = ["DEPARTED", "LANDED", "CANCELLED", "DIVERTED"];
    const cljDates = [...new Set(all.filter((r) => r.airport === "CLJ").map((r) => r.flight_date))];
    if (cljDates.length) {
      const { data: prev } = await supabase
        .from("airport_flights")
        .select("direction,flight_date,flight_no,scheduled_time,status,estimated_time,status_raw,gate,checkin_desk")
        .eq("airport", "CLJ")
        .in("status", TERMINAL)
        .in("flight_date", cljDates);
      const prevMap = new Map(
        (prev ?? []).map((p) => [
          `${p.direction}|${p.flight_date}|${flightKey(p.flight_no)}|${String(p.scheduled_time).slice(0, 5)}`,
          p,
        ]),
      );
      for (const rec of all) {
        if (rec.airport !== "CLJ" || rec.status !== "SCHEDULED") continue;
        const p = prevMap.get(
          `${rec.direction}|${rec.flight_date}|${flightKey(rec.flight_no)}|${rec.scheduled_time}`,
        );
        if (p) {
          rec.status = p.status;
          rec.estimated_time = p.estimated_time ? String(p.estimated_time).slice(0, 5) : rec.estimated_time;
          rec.status_raw = p.status_raw ?? rec.status_raw;
          rec.gate = rec.gate ?? (p.gate as string | null);
          rec.checkin_desk = rec.checkin_desk ?? (p.checkin_desk as string | null);
        }
      }
    }
  } catch { /* best-effort — worst case a stamp is redone next run */ }

  // Flights well past their scheduled time (90+ min) that still carry no live
  // information get an explicit NO_INFO status instead of a misleading
  // "Scheduled" — covers carriers absent from AeroDataBox, windows the
  // enrichment missed, and any future residue. Runs AFTER the sticky restore,
  // so a known real status always wins; re-derived idempotently every run.
  {
    const todayIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const nowMin = Number(parts.find((x) => x.type === "hour")?.value ?? 0) * 60 +
      Number(parts.find((x) => x.type === "minute")?.value ?? 0);
    const dayUtc = (iso: string) => {
      const [y, m, d] = iso.split("-").map(Number);
      return Date.UTC(y, m - 1, d);
    };
    for (const rec of all) {
      if (rec.status !== "SCHEDULED") continue;
      const idx = Math.round((dayUtc(rec.flight_date) - dayUtc(todayIso)) / 86_400_000) * 1440 +
        minutesOf(rec.scheduled_time);
      if (idx < nowMin - 90) rec.status = "NO_INFO";
    }
  }

  let upserted = 0;
  const errors: string[] = [];
  const BATCH = 200;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const { error } = await supabase
      .from("airport_flights")
      .upsert(batch, { onConflict: "airport,direction,flight_date,flight_no,scheduled_time" });
    if (error) errors.push(error.message);
    else upserted += batch.length;
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 2);
  const { error: delErr } = await supabase
    .from("airport_flights")
    .delete()
    .lt("flight_date", cutoff.toISOString().slice(0, 10));
  if (delErr) errors.push(`prune: ${delErr.message}`);

  // Health alert on a dead source.
  const dead = Object.entries(perSource).filter(([, v]) => v.count === 0);
  let alerted = false;
  if (dead.length) alerted = await sendAlert(dead.map(([k, v]) => `${k}: ${v.error ?? "0 rows"}`));

  // Disruption → editor brief (editor-in-the-loop; no auto-publish).
  let disruptionsNew = 0;
  const disruptions = buildDisruptions(all);
  if (disruptions.length) {
    const { data: inserted, error: dErr } = await supabase
      .from("flight_disruptions")
      .upsert(disruptions, {
        onConflict: "airport,direction,flight_date,flight_no,scheduled_time,kind",
        ignoreDuplicates: true,
      })
      .select("airport,direction,flight_date,flight_no,scheduled_time,airline,city,kind,detail");
    if (dErr) errors.push(`disruptions: ${dErr.message}`);
    const fresh = inserted ?? [];
    disruptionsNew = fresh.length;
    if (fresh.length) await sendDisruptionDigest(fresh as DisruptionRow[]);
  }

  return json({
    ok: errors.length === 0 && dead.length === 0,
    parsed: all.length,
    upserted,
    adxStamped,
    fidsStamped,
    disruptionsNew,
    sources: Object.fromEntries(Object.entries(perSource).map(([k, v]) => [k, { count: v.count, error: v.error }])),
    deadSources: dead.length ? dead.map(([k]) => k) : undefined,
    alerted: dead.length ? alerted : undefined,
    errors: errors.length ? errors : undefined,
  });
});

/* ═══════════════ Alerts + disruptions ═══════════════ */

async function sendAlert(lines: string[]): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("FLIGHTS_ALERT_EMAIL");
  if (!key || !to) return false;
  const from = Deno.env.get("FLIGHTS_ALERT_FROM") ?? "Transilvania Times <alerts@transilvaniatimes.com>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to,
        subject: "⚠️ Zboruri: o sursă de aeroport nu returnează date",
        html: `<p>Sincronizarea zborurilor a găsit surse fără rânduri (posibil parser stricat după un redesign):</p><ul>${
          lines.map((l) => `<li>${l}</li>`).join("")
        }</ul><p>Rulează <code>?test=1</code> pe funcția <code>flights-sync</code> pentru diagnostic.</p>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const DELAY_ALERT_MIN = 60;
const AIRPORT_NAMES: Record<string, string> = {
  CLJ: "Aeroportul Cluj-Napoca", TGM: "Aeroportul Târgu Mureș", SBZ: "Aeroportul Sibiu",
};

interface DisruptionRow {
  airport: string; direction: string; flight_date: string; flight_no: string;
  scheduled_time: string; airline: string | null; city: string | null;
  kind: string; detail: string | null;
}

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function buildDisruptions(rows: FlightRecord[]): DisruptionRow[] {
  const out: DisruptionRow[] = [];
  for (const f of rows) {
    let kind = "", detail = "";
    if (f.status === "CANCELLED") {
      kind = "CANCELLED"; detail = "Zbor anulat";
    } else if (f.status === "DELAYED" && f.estimated_time) {
      const d = minutesOf(f.estimated_time) - minutesOf(f.scheduled_time);
      if (d >= DELAY_ALERT_MIN) { kind = "DELAYED"; detail = `Întârziere ~${d} min (estimat ${f.estimated_time})`; }
    }
    if (!kind) continue;
    out.push({
      airport: f.airport, direction: f.direction, flight_date: f.flight_date,
      flight_no: f.flight_no, scheduled_time: f.scheduled_time,
      airline: f.airline, city: f.city, kind, detail,
    });
  }
  return out;
}

async function sendDisruptionDigest(list: DisruptionRow[]): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  const to = Deno.env.get("FLIGHTS_NEWS_EMAIL") ?? Deno.env.get("FLIGHTS_ALERT_EMAIL");
  if (!key || !to) return false;
  const from = Deno.env.get("FLIGHTS_ALERT_FROM") ?? "Transilvania Times <alerts@transilvaniatimes.com>";
  const items = list.map((d) => {
    const arrow = d.direction === "departure" ? "spre" : "dinspre";
    const label = d.kind === "CANCELLED" ? "Zbor anulat" : "Întârziere majoră";
    return `<li><strong>${label}</strong> — ${AIRPORT_NAMES[d.airport] ?? d.airport}: ${d.flight_no}${
      d.airline ? " (" + d.airline + ")" : ""
    } ${arrow} ${d.city ?? "—"}, programat ${d.flight_date} ${d.scheduled_time}. ${d.detail ?? ""}</li>`;
  }).join("");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to,
        subject: `✈️ Zboruri: ${list.length} perturbare(i) — brief pentru redacție`,
        html: `<p>Perturbări nou detectate la aeroporturile din Transilvania (verificați cu compania aeriană înainte de publicare):</p><ul>${items}</ul>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
