// Pure parsing logic for flights-sync (no Deno/Node APIs) so it can be unit
// tested off-runtime. index.ts imports SOURCES, extractFlightTable and mapRows
// from here; everything network/DB-related stays in index.ts.

export type AirportCode = "CLJ" | "TGM" | "SBZ";
export type Direction = "departure" | "arrival";

export interface Source {
  airport: AirportCode;
  direction: Direction;
  url: string;
}

export const SOURCES: Source[] = [
  { airport: "CLJ", direction: "departure", url: "https://www.airportcluj.ro/informatii-zboruri/program-zboruri-plecari/" },
  { airport: "CLJ", direction: "arrival",   url: "https://www.airportcluj.ro/informatii-zboruri/program-zboruri-sosiri/" },
  { airport: "TGM", direction: "departure", url: "https://aeroportultransilvania.ro/plecari/" },
  { airport: "TGM", direction: "arrival",   url: "https://aeroportultransilvania.ro/sosiri/" },
  { airport: "SBZ", direction: "departure", url: "https://www.sibiuairport.ro/ro/informatii-zboruri/plecari/" },
  { airport: "SBZ", direction: "arrival",   url: "https://www.sibiuairport.ro/ro/informatii-zboruri/sosiri/" },
];

export interface FlightRecord {
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

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function decodeEntities(s: string): string {
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

export function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function normKey(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeStatus(raw: string | null | undefined): string {
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

export function parseDate(s: string): string | null {
  const m = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!m) return null;
  const d = m[1].padStart(2, "0");
  const mo = m[2].padStart(2, "0");
  let y = m[3];
  if (y.length === 2) y = "20" + y;
  return `${y}-${mo}-${d}`;
}

export function parseTime(s: string): string | null {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function parseFlightNo(s: string): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  const m = t.match(/[A-Z0-9]{1,3}\s?\d{1,4}[A-Z]?/i);
  return m ? m[0].replace(/\s+/g, " ").toUpperCase() : (t || null);
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  rowsRaw: string[]; // raw <tr> HTML, aligned to rows (for input-value status)
}

export function extractFlightTable(html: string): ParsedTable | null {
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

// Resolve a column by keyword PRIORITY (not header order): the earliest
// keyword that matches any header wins, so specific labels like
// "ora sosire" beat the generic "ora" fallback on arrivals pages.
export function col(headers: string[], ...keywords: string[]): number {
  for (const k of keywords) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      if (h === k || h.includes(k)) return i;
    }
  }
  return -1;
}

function clean(s: string): string | null {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t && t !== "-" && t !== "—" ? t : null;
}

// City cell can carry a leading IATA airport code glued to the name
// (e.g. "LCA Larnaca" / "LCALarnaca"); strip it when a Titlecase name follows.
function cleanCity(s: string): string | null {
  const t = (s || "").replace(/\s+/g, " ").trim().replace(/^[A-Z]{3}\s*(?=[A-Z][a-z])/, "");
  return t && t !== "-" && t !== "—" ? t : null;
}

// Some airports (Sibiu) scramble the visible Status column to block scraping
// but keep the real value in a hidden <input value="…">. Pull it from the raw row.
const STATUS_WORD_RE =
  /(DECOLAT|ATERIZAT|ANULAT|INTARZIAT|INTIRZIAT|IMBARCARE|CHECK.?IN|PROGRAMAT|IN\s*CURS|IN\s*TIMP|IN\s*ZBOR|POARTA\s*INCHISA|MODIFICARE\s*ORA|CONFIRMAT|SOSIT|BOARDING|DEPARTED|LANDED|CANCEL|DELAY|GATE\s*CLOSED|ESTIMAT)/;

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

export function mapRows(src: Source, table: ParsedTable, nowIso = new Date().toISOString()): FlightRecord[] {
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
    // Prefer the hidden input value (real status) over the visible cell,
    // which may be scrambled; fall back to the header-matched Status cell.
    let statusRaw = iStatus >= 0 ? get(iStatus) : "";
    if (src.airport !== "CLJ") {
      const fromInput = statusFromRaw(rowRaw);
      if (fromInput) statusRaw = fromInput;
    }
    const is_charter = /charter/.test(normKey(r.join(" ")));
    const status = src.airport === "CLJ" ? "SCHEDULED" : normalizeStatus(statusRaw);

    out.push({
      airport: src.airport,
      direction: src.direction,
      flight_date,
      flight_no,
      airline: clean(get(iAirline)),
      city: cleanCity(get(iCity)),
      aircraft: clean(get(iAircraft)),
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

// Parser for the "ewf" WordPress flights plugin (Târgu Mureș): rows made of
// <span class="ewf-flight-{date,time,number,airline,location,details}">. Each
// row is captured as one sequential unit so fields never misalign.
const EWF_ROW =
  /ewf-flight-date[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-time[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-number[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-airline[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-location[^>]*>([\s\S]*?)<\/span>[\s\S]*?ewf-flight-details[^>]*>([\s\S]*?)<\/span>/gi;

export function parseEwfList(src: Source, html: string, nowIso: string): FlightRecord[] {
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
      airport: src.airport,
      direction: src.direction,
      flight_date,
      flight_no,
      airline: clean(cellText(m[4])),
      city: clean(cellText(m[5])),
      aircraft: null,
      scheduled_time,
      estimated_time: parseTime(statusRaw), // e.g. "DECOLAT LA 12:14" → 12:14
      status: normalizeStatus(statusRaw),
      status_raw: statusRaw || null,
      is_charter: /charter/i.test(statusRaw + " " + (cellText(m[4]) || "")),
      source_url: src.url,
      updated_at: nowIso,
    });
  }
  return dedupe(out);
}
