/**
 * Shared flight-board data layer for the Transilvania Times airport tool.
 *
 * Framework-agnostic: safe to import from Server Components, Route Handlers,
 * and 'use client' components alike (no server-only or Node/Deno imports).
 *
 * Covers the three Transylvanian airports whose boards the tool mirrors:
 *   - CLJ  Cluj-Napoca „Avram Iancu”
 *   - TGM  Târgu Mureș „Transilvania”
 *   - SBZ  Sibiu
 *
 * The live data is collected by the `flights-sync` Supabase Edge Function and
 * stored in the `airport_flights` table; this module defines the row shape the
 * UI consumes plus the status normalization and bilingual labels shared by the
 * scraper and the board.
 */

export type AirportCode = 'CLJ' | 'TGM' | 'SBZ'
export type Direction = 'departure' | 'arrival'

export interface AirportMeta {
  code: AirportCode
  iata: AirportCode
  icao: string
  /** Short display name for tabs. */
  short: string
  /** Full official name. */
  name: string
  city: string
  /** Whether the source publishes a live status (vs. schedule only). */
  hasLiveStatus: boolean
}

export const AIRPORTS: Record<AirportCode, AirportMeta> = {
  CLJ: {
    code: 'CLJ', iata: 'CLJ', icao: 'LRCL',
    short: 'Cluj-Napoca', name: 'Aeroportul Internațional „Avram Iancu” Cluj',
    city: 'Cluj-Napoca', hasLiveStatus: false,
  },
  TGM: {
    code: 'TGM', iata: 'TGM', icao: 'LRTM',
    short: 'Târgu Mureș', name: 'Aeroportul Internațional „Transilvania” Târgu Mureș',
    city: 'Târgu Mureș', hasLiveStatus: true,
  },
  SBZ: {
    code: 'SBZ', iata: 'SBZ', icao: 'LRSB',
    short: 'Sibiu', name: 'Aeroportul Internațional Sibiu',
    city: 'Sibiu', hasLiveStatus: true,
  },
}

export const AIRPORT_ORDER: AirportCode[] = ['CLJ', 'TGM', 'SBZ']

/**
 * Normalized status codes. Source labels (RO/EN, per airport) are mapped onto
 * these so the board colours and translates consistently.
 */
export type StatusCode =
  | 'SCHEDULED'
  | 'CHECKIN'
  | 'BOARDING'
  | 'GATE_CLOSED'
  | 'DEPARTED'
  | 'EN_ROUTE'
  | 'LANDED'
  | 'DELAYED'
  | 'CANCELLED'
  | 'DIVERTED'
  | 'NO_INFO'
  | 'UNKNOWN'

export type StatusColor = 'green' | 'blue' | 'amber' | 'red' | 'gray'

export interface StatusMeta {
  ro: string
  en: string
  color: StatusColor
}

export const STATUS_META: Record<StatusCode, StatusMeta> = {
  SCHEDULED:   { ro: 'Programat',    en: 'Scheduled',   color: 'amber' },
  CHECKIN:     { ro: 'Check-in',     en: 'Check-in',    color: 'blue'  },
  BOARDING:    { ro: 'Îmbarcare',    en: 'Boarding',    color: 'blue'  },
  GATE_CLOSED: { ro: 'Poartă închisă', en: 'Gate closed', color: 'red' },
  DEPARTED:    { ro: 'Decolat',      en: 'Departed',    color: 'green' },
  EN_ROUTE:    { ro: 'În zbor',      en: 'En route',    color: 'blue'  },
  LANDED:      { ro: 'Aterizat',     en: 'Landed',      color: 'green' },
  DELAYED:     { ro: 'Întârziat',    en: 'Delayed',     color: 'red'   },
  CANCELLED:   { ro: 'Anulat',       en: 'Cancelled',   color: 'red'   },
  DIVERTED:    { ro: 'Deviat',       en: 'Diverted',    color: 'red'   },
  NO_INFO:     { ro: 'Fără informații', en: 'No info',  color: 'gray'  },
  UNKNOWN:     { ro: 'Programat',    en: 'Scheduled',   color: 'gray'  },
}

/** Tailwind classes per status colour, aligned to the site's shadcn tokens. */
export const STATUS_CLASSES: Record<StatusColor, string> = {
  green: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25',
  blue:  'bg-sky-500/12 text-sky-700 dark:text-sky-400 ring-sky-500/25',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30',
  red:   'bg-brand-red/10 text-brand-red ring-brand-red/25',
  gray:  'bg-foreground/5 text-muted-foreground ring-foreground/15',
}

/**
 * Map a raw source status label (any of the three airports, RO or EN) onto a
 * normalized StatusCode. Diacritics- and case-insensitive; tolerant of the
 * "DECOLAT LA 12:14" / "ESTIMAT 13:20" style suffixes.
 */
export function normalizeStatus(raw: string | null | undefined): StatusCode {
  const s = stripDiacritics(String(raw ?? '')).toUpperCase().trim()
  if (!s || s === '-' || s === '—') return 'SCHEDULED'

  // Order matters: check terminal/most-specific states first.
  if (/\bANULAT|CANCEL/.test(s)) return 'CANCELLED'
  if (/\bDEVIAT|DIVERT/.test(s)) return 'DIVERTED'
  if (/\bATERIZAT|LANDED|SOSIT|ARRIVED/.test(s)) return 'LANDED'
  if (/\bDECOLAT|DEPARTED|PLECAT/.test(s)) return 'DEPARTED'
  if (/\bIMBARCARE|BOARDING/.test(s)) return 'BOARDING'
  if (/POARTA\s*INCHISA|GATE\s*CLOSED/.test(s)) return 'GATE_CLOSED'
  if (/CHECK.?IN/.test(s)) return 'CHECKIN'
  if (/\bIN\s*ZBOR|IN\s*TIMP|IN\s*CURS|EN.?ROUTE|IN\s*AER/.test(s)) return 'EN_ROUTE'
  if (/INTARZIAT|INTIRZIAT|DELAY|MODIFICARE\s*ORA|REPROGRAMAT|ESTIMAT/.test(s)) return 'DELAYED'
  if (/PROGRAMAT|SCHEDULED|LA\s*ORA|ON\s*TIME|CONFIRMAT/.test(s)) return 'SCHEDULED'
  return 'UNKNOWN'
}

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** A single flight row as delivered to the board (mirrors the DB row). */
export interface FlightRow {
  airport: AirportCode
  direction: Direction
  flight_date: string        // YYYY-MM-DD (local)
  flight_no: string
  airline: string | null
  city: string | null        // destination (departure) or origin (arrival)
  aircraft: string | null
  scheduled_time: string | null // HH:MM (local)
  estimated_time: string | null // HH:MM (local), when the source publishes it
  other_time: string | null     // time at the other end of the leg, when published
  status: StatusCode
  status_raw: string | null
  is_charter: boolean
  source_url: string | null
  updated_at: string | null
}

/* ── Date helpers, always in Europe/Bucharest (the airports' local time) ── */

/** Local calendar date (YYYY-MM-DD) in Europe/Bucharest for a given instant. */
export function bucharestDate(d: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** Add whole days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export type DayKey = 'yesterday' | 'today' | 'tomorrow'

export function dateForDay(day: DayKey, today = bucharestDate()): string {
  return day === 'today' ? today : addDays(today, day === 'tomorrow' ? 1 : -1)
}

/** UI label dictionary (RO default, EN mirror). */
export const LABELS = {
  ro: {
    title: 'Zboruri — Aeroporturile Transilvaniei',
    subtitle: 'Sosiri și plecări în timp real: Cluj-Napoca, Târgu Mureș și Sibiu',
    departures: 'Plecări',
    arrivals: 'Sosiri',
    yesterday: 'Ieri',
    today: 'Azi',
    tomorrow: 'Mâine',
    search: 'Caută zbor, companie sau oraș…',
    allAirlines: 'Toate companiile',
    allCities: 'Toate orașele',
    colScheduled: 'Programat',
    colEstimated: 'Estimat',
    colFlight: 'Zbor',
    colAirline: 'Companie',
    colTo: 'Destinație',
    colFrom: 'Origine',
    colAircraft: 'Avion',
    colStatus: 'Status',
    noFlights: 'Niciun zbor pentru criteriile selectate.',
    noInfo: 'Fără informații',
    updated: 'Actualizat',
    refresh: 'Reîmprospătează',
    charter: 'Charter',
    scheduleOnly: 'Program orar (fără status live)',
    liveNote: 'Statusurile se actualizează automat.',
    liveWindow: 'Live + 12h',
    allDay: 'Toată ziua',
    share: 'Distribuie zborul',
    disclaimer:
      'Date preluate din sursele oficiale ale aeroporturilor, cu titlu informativ. Verificați întotdeauna cu compania aeriană.',
    loadError: 'Nu am putut încărca zborurile. Reîncercați în câteva momente.',
  },
  en: {
    title: 'Flights — Transylvania Airports',
    subtitle: 'Real-time arrivals and departures: Cluj-Napoca, Târgu Mureș and Sibiu',
    departures: 'Departures',
    arrivals: 'Arrivals',
    yesterday: 'Yesterday',
    today: 'Today',
    tomorrow: 'Tomorrow',
    search: 'Search flight, airline or city…',
    allAirlines: 'All airlines',
    allCities: 'All cities',
    colScheduled: 'Scheduled',
    colEstimated: 'Estimated',
    colFlight: 'Flight',
    colAirline: 'Airline',
    colTo: 'Destination',
    colFrom: 'Origin',
    colAircraft: 'Aircraft',
    colStatus: 'Status',
    noFlights: 'No flights match the current filters.',
    noInfo: 'No info',
    updated: 'Updated',
    refresh: 'Refresh',
    charter: 'Charter',
    scheduleOnly: 'Timetable only (no live status)',
    liveNote: 'Statuses update automatically.',
    liveWindow: 'Live + 12h',
    allDay: 'All day',
    share: 'Share flight',
    disclaimer:
      'Data sourced from the airports’ official pages, for information only. Always confirm with your airline.',
    loadError: 'Could not load flights. Please try again shortly.',
  },
} as const

export type Lang = keyof typeof LABELS

/* ── Hermes-style helpers ─────────────────────────────────────────────────── */

/** 2–3 letter airline designator from a flight number (e.g. "W4 3453" → "W4"). */
export function airlineCode(flightNo: string): string {
  const m = String(flightNo).trim().match(/^[A-Z0-9]{2,3}/i)
  return m ? m[0].toUpperCase() : '?'
}

/** Curated brand colours for the carriers that actually fly these airports;
 *  anything else gets a stable hashed colour so the monogram is never blank. */
export const AIRLINE_COLORS: Record<string, string> = {
  W4: '#c6007e', W6: '#c6007e',            // Wizz Air
  RO: '#0a3d91',                            // TAROM
  OS: '#cc0000',                            // Austrian
  TK: '#c70a0c',                            // Turkish
  FR: '#073590',                            // Ryanair
  H4: '#e4002b',                            // HiSky
  A2: '#0aa3a1',                            // Animawings
  GQ: '#0a4aa0',                            // Sky Express
  XC: '#e30613',                            // Corendon
  NE: '#0b6e4f',                            // Nesma
  NSM: '#1a4f9c', SM: '#1a4f9c',            // Air Cairo
  LH: '#05164d',                            // Lufthansa
  LO: '#11397d',                            // LOT
}

export function airlineColor(flightNo: string): string {
  const c = airlineCode(flightNo)
  if (AIRLINE_COLORS[c]) return AIRLINE_COLORS[c]
  let h = 0
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h} 52% 36%)`
}

/**
 * Hermes-style status phrase with the actual/estimated time folded in:
 *   Landed/Departed → "Aterizat 00:45" / "Decolat 06:12"
 *   Delayed         → "Estimat 17:45"
 *   otherwise       → the plain status word.
 */
export function statusLabel(f: FlightRow, lang: Lang): string {
  const m = STATUS_META[f.status] ?? STATUS_META.UNKNOWN
  const base = lang === 'ro' ? m.ro : m.en
  // DB time columns serialize as HH:MM:SS — display as HH:MM.
  const time = f.estimated_time ? String(f.estimated_time).slice(0, 5) : null
  if ((f.status === 'LANDED' || f.status === 'DEPARTED') && time) return `${base} ${time}`
  if (f.status === 'DELAYED' && time) return `${lang === 'ro' ? 'Estimat' : 'Est.'} ${time}`
  return base
}

/** Long, localized date heading for a YYYY-MM-DD group (e.g. "Duminică, 23 august 2026"). */
export function dateHeading(isoDate: string, lang: Lang): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const s = new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(dt)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Current wall-clock minutes-since-midnight in Europe/Bucharest. */
export function bucharestNowMinutes(d: Date = new Date()): number {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const hh = Number(p.find(x => x.type === 'hour')?.value ?? '0')
  const mm = Number(p.find(x => x.type === 'minute')?.value ?? '0')
  return hh * 60 + mm
}

/** Absolute minute index for a flight (day offset from `today` * 1440 + time). */
export function flightMinuteIndex(flight_date: string, time: string, today: string): number {
  const utc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  const dayOffset = Math.round((utc(flight_date) - utc(today)) / 86_400_000)
  const [h, mnt] = time.split(':').map(Number)
  return dayOffset * 1440 + h * 60 + mnt
}
