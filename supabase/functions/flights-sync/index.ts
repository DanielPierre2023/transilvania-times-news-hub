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
  status: string;
  status_raw: string | null;
  is_charter: boolean;
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

    const rows = rowsCells.slice(headerIdx + 1).filter((r) => r.length >= 2);
    const candidate: ParsedTable = { headers, rows };
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

  const out: FlightRecord[] = [];

  for (const r of table.rows) {
    const get = (i: number) => (i >= 0 && i < r.length ? r[i] : "");

    const flight_no = parseFlightNo(get(iFlight));
    if (!flight_no) continue;

    const flight_date = parseDate(get(iDate)) ?? scanDate(r);
    if (!flight_date) continue;

    let scheduled_time = parseTime(get(iSched));
    if (!scheduled_time) scheduled_time = scanTime(r, iEst);
    if (!scheduled_time) continue;

    const estimated_time = iEst >= 0 ? parseTime(get(iEst)) : null;
    const statusRaw = iStatus >= 0 ? get(iStatus) : "";
    const is_charter = /charter/.test(normKey(r.join(" ")));
    const status = src.airport === "CLJ" ? "SCHEDULED" : normalizeStatus(statusRaw);

    out.push({
      airport: src.airport,
      direction: src.direction,
      flight_date,
      flight_no,
      airline: cleanCell(get(iAirline)),
      city: cleanCell(get(iCity)),
      aircraft: cleanCell(get(iAircraft)),
      scheduled_time,
      estimated_time,
      status,
      status_raw: src.airport === "CLJ" ? (is_charter ? "CHARTER" : null) : (statusRaw || null),
      is_charter,
      source_url: src.url,
      updated_at: nowIso,
    });
  }
  return dedupe(out);
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
    const table = extractFlightTable(html);
    if (!table) return { records: [], error: "no flight table found" };
    return { records: mapRows(src, table, new Date().toISOString()) };
  } catch (e) {
    return { records: [], error: String((e as Error)?.message ?? e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const secret = Deno.env.get("FLIGHTS_SYNC_SECRET");
  const provided = req.headers.get("x-sync-secret");
  if (!secret || provided !== secret) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const dryRun = req.method === "GET" && url.searchParams.get("test") === "1";

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

  if (dryRun) return json({ dryRun: true, total: all.length, sources: perSource });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
