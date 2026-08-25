// ─────────────────────────────────────────────────────────────────────────────
// Airline directory + baggage / ground-handling map for the three Transylvanian
// airports. Powers /zboruri/companii (the Hermes-style "Airlines" page) and the
// luggage-tracing guide.
//
// DATA HONESTY: ground-handling contracts change every few years. The handler
// assignments below reflect the airports' published directories as of early
// 2026 and MUST carry the "confirm before travelling" caveat in the UI. Phone
// numbers and e-mails are reproduced exactly. We do NOT invent airline call-
// centre numbers — for baggage the number that matters is the handler's desk,
// which is what we publish.
// ─────────────────────────────────────────────────────────────────────────────

import type { AirportCode } from './flights'

/* ── Ground handlers ──────────────────────────────────────────────────────── */

export interface Handler {
  id: string
  name: string
  phone?: string
  email?: string
  phone2?: string
  email2?: string
  hours?: { ro: string; en: string }
}

/** The physical desk a passenger reports lost baggage to, per airport. */
export const HANDLERS: Record<string, Handler> = {
  'menzies-clj': {
    id: 'menzies-clj',
    name: 'Menzies Aviation Romania',
    phone: '+40 264 307 562',
    phone2: '+40 264 307 506',
    email: 'clj.admin@menziesaviation.com',
    email2: 'clj.tkt@menziesaviation.com',
    hours: { ro: 'Zilnic 04:30–20:00', en: 'Daily 04:30–20:00' },
  },
  'menzies-sbz': {
    id: 'menzies-sbz',
    name: 'Menzies Aviation Romania',
    phone: '+40 758 255 710',
  },
  'tgm-inhouse': {
    id: 'tgm-inhouse',
    name: 'Handling propriu — Aeroportul Transilvania',
    phone: '+40 265 328 258',
    email: 'handling@transylvaniaairport.ro',
  },
  'self-tarom': {
    id: 'self-tarom',
    name: 'TAROM — stația proprie Cluj',
    phone: '+40 264 307 569',
    email: 'agcluj@tarom.ro',
  },
  'self-turkish': {
    id: 'self-turkish',
    name: 'Turkish Airlines — stația proprie Cluj',
    phone: '+40 264 307 566',
    email: 'tk.cluj@thy.com',
  },
}

/** The default ramp/baggage handler at each airport. Overrides below. */
const AIRPORT_DEFAULT_HANDLER: Record<AirportCode, string> = {
  CLJ: 'menzies-clj',
  SBZ: 'menzies-sbz',
  TGM: 'tgm-inhouse',
}

/** Per-airline exceptions, keyed by `${airport}:${iata}`. */
const HANDLER_OVERRIDES: Record<string, { rampBaggage: string; passengerNote?: { ro: string; en: string } }> = {
  // TAROM self-handles its PASSENGER services at its Cluj home base (own station
  // +40 264 307 569, agcluj@tarom.ro). Its ramp/baggage arrangement is not
  // published by the airport, so for a lost bag passengers use TAROM's own desk.
  'CLJ:RO': {
    rampBaggage: 'self-tarom',
    passengerNote: {
      ro: 'TAROM își asigură singur check-in-ul, biletele și îmbarcarea. Aranjamentul de rampă/bagaje nu e publicat de aeroport — pentru un bagaj, adresați-vă stației TAROM (mai sus) sau aeroportului (+40 264 307 500).',
      en: 'TAROM self-handles check-in, ticketing and boarding. Its ramp/baggage arrangement is not published by the airport — for a lost bag, contact TAROM’s own station (above) or the airport (+40 264 307 500).',
    },
  },
  // Turkish self-handles PASSENGER services (own station +40 264 307 566,
  // tk.cluj@thy.com); ramp AND baggage are Menzies — so a lost bag goes to
  // the Menzies desk, while check-in/passenger matters go to Turkish's station.
  'CLJ:TK': {
    rampBaggage: 'menzies-clj',
    passengerNote: {
      ro: 'Bagajele sunt la Menzies (mai sus). Check-in și asistență pasageri: stația proprie Turkish Airlines — +40 264 307 566, tk.cluj@thy.com.',
      en: 'Baggage is handled by Menzies (above). Check-in and passenger assistance: Turkish Airlines’ own station — +40 264 307 566, tk.cluj@thy.com.',
    },
  },
}

export function resolveHandler(airport: AirportCode, iata: string): {
  handler: Handler
  passengerNote?: { ro: string; en: string }
} {
  const ov = HANDLER_OVERRIDES[`${airport}:${iata}`]
  const id = ov?.rampBaggage ?? AIRPORT_DEFAULT_HANDLER[airport]
  return { handler: HANDLERS[id], passengerNote: ov?.passengerNote }
}

/* ── Per-airport baggage-claim / lost & found desks ───────────────────────── */

export interface LostAndFound {
  handlerId: string
  hours: { ro: string; en: string }
  location: { ro: string; en: string }
}

export const LOST_AND_FOUND: Record<AirportCode, LostAndFound> = {
  CLJ: {
    handlerId: 'menzies-clj',
    hours: { ro: 'Zilnic 04:30–20:00 (ghișeul Menzies)', en: 'Daily 04:30–20:00 (Menzies desk)' },
    location: {
      ro: 'Ghișeul Menzies din sala de recuperare bagaje (zona de sosiri). Depuneți reclamația (PIR) ÎNAINTE de a părăsi zona de bagaje.',
      en: 'Menzies desk in the baggage reclaim hall (arrivals). File the report (PIR) BEFORE leaving the baggage area.',
    },
  },
  SBZ: {
    handlerId: 'menzies-sbz',
    hours: { ro: '24/7', en: '24/7' },
    location: {
      ro: 'Ghișeul Menzies din terminalul de pasageri, disponibil non-stop. Reclamația se depune înainte de a ieși din zona de bagaje.',
      en: 'Menzies desk in the passenger terminal, available around the clock. File your report before leaving the baggage area.',
    },
  },
  TGM: {
    handlerId: 'tgm-inhouse',
    hours: { ro: 'La sosirea zborurilor', en: 'On flight arrivals' },
    location: {
      ro: 'Biroul de handling al aeroportului, în zona de sosiri. Bagajele sunt gestionate direct de personalul aeroportului.',
      en: 'The airport handling office in arrivals. Baggage is handled directly by the airport staff.',
    },
  },
}

/* ── Airline directory ────────────────────────────────────────────────────── */

export interface DirectoryAirline {
  iata: string
  name: string
  website?: string
  /** Airports the carrier is known to serve (used when live data is thin). */
  airports: AirportCode[]
  /** Marked seasonal/charter → shown with a caveat. */
  seasonal?: boolean
  /** Official baggage-tracing / delayed-bag page (verified). Used for the
   *  "track your bag" links. Only set where confirmed, never guessed. */
  baggageTracking?: string
}

/** Ordered alphabetically by display name at render time. Websites are the
 *  carriers' official domains. */
export const AIRLINE_DIRECTORY: DirectoryAirline[] = [
  { iata: 'A3', name: 'Aegean Airlines', website: 'https://www.aegeanair.com', airports: ['CLJ'], seasonal: true },
  { iata: 'SM', name: 'Air Cairo', website: 'https://www.aircairo.com', airports: ['TGM'], seasonal: true },
  { iata: 'A2', name: 'Animawings', website: 'https://www.animawings.com', airports: ['CLJ', 'SBZ'] },
  { iata: 'OS', name: 'Austrian Airlines', website: 'https://www.austrian.com', airports: ['SBZ'] },
  { iata: 'XC', name: 'Corendon Airlines', website: 'https://www.corendonairlines.com', airports: ['CLJ', 'SBZ'], seasonal: true },
  { iata: 'H4', name: 'HiSky', website: 'https://www.hisky.aero', airports: ['CLJ', 'SBZ'] },
  { iata: 'LO', name: 'LOT Polish Airlines', website: 'https://www.lot.com', airports: ['CLJ'] },
  { iata: 'LH', name: 'Lufthansa', website: 'https://www.lufthansa.com', airports: ['CLJ', 'SBZ'], baggageTracking: 'https://www.lufthansa.com/us/en/baggage-irregularities' },
  { iata: 'NE', name: 'Nesma Airlines', website: 'https://www.nesmaairlines.com', airports: ['SBZ'], seasonal: true },
  { iata: 'DY', name: 'Norwegian', website: 'https://www.norwegian.com', airports: ['CLJ'], seasonal: true },
  { iata: 'PC', name: 'Pegasus Airlines', website: 'https://www.flypgs.com', airports: ['CLJ'] },
  { iata: 'FR', name: 'Ryanair', website: 'https://www.ryanair.com', airports: ['CLJ'], baggageTracking: 'https://help.ryanair.com/hc/en-us/sections/12489260303377-Damaged-Lost-or-Delayed-Bags' },
  { iata: 'GQ', name: 'Sky Express', website: 'https://www.skyexpress.gr', airports: ['CLJ', 'TGM', 'SBZ'], seasonal: true },
  { iata: 'U5', name: 'SkyUp Airlines', website: 'https://www.skyup.aero', airports: ['CLJ'], seasonal: true },
  { iata: 'LX', name: 'SWISS', website: 'https://www.swiss.com', airports: ['CLJ'] },
  { iata: 'TI', name: 'Tailwind Airlines', website: 'https://www.tailwind.com.tr', airports: ['TGM'], seasonal: true },
  { iata: 'RO', name: 'TAROM', website: 'https://www.tarom.ro', airports: ['CLJ', 'SBZ', 'TGM'], baggageTracking: 'https://www.tarom.ro/en/lost-or-delayed-baggage' },
  { iata: 'TK', name: 'Turkish Airlines', website: 'https://www.turkishairlines.com', airports: ['CLJ'], baggageTracking: 'https://www.turkishairlines.com/en-int/any-questions/baggage-issues/' },
  { iata: 'W4', name: 'Wizz Air', website: 'https://wizzair.com', airports: ['CLJ', 'TGM', 'SBZ'], baggageTracking: 'https://www.wizzair.com/en-gb/help-centre/damaged-or-lost-bags-and-items/damaged-delayed-and-lost-bags/lost-baggage-tracking' },
]

/* ── Handler spotlight: Menzies Aviation Romania ──────────────────────────────
 *  The dominant ramp & baggage handler at CLJ and the sole handler at SBZ.
 *  Shown as a presentation card at the top of /zboruri/companii so passengers
 *  know where lost checked baggage and items left on board are dealt with. */

export interface HandlerSpotlight {
  name: string
  logo: string
  brand: string
  tagline: { ro: string; en: string }
  about: { ro: string; en: string }
  stations: {
    airport: AirportCode
    role: { ro: string; en: string }
    phones: string[]
    emails: string[]
    hours: { ro: string; en: string }
  }[]
  website: string
}

export const MENZIES: HandlerSpotlight = {
  name: 'Menzies Aviation Romania',
  logo: '/handlers/menzies.png',
  brand: '#213768',
  tagline: {
    ro: 'Agentul principal de handling (rampă & bagaje) la Cluj-Napoca și Sibiu',
    en: 'The main ground handler (ramp & baggage) at Cluj-Napoca and Sibiu',
  },
  about: {
    ro: 'Menzies asigură serviciile „sub aripă” — descărcarea și încărcarea avionului, sortarea și transportul bagajelor, plus check-in și îmbarcare pentru majoritatea companiilor. Dacă un bagaj de cală lipsește sau e deteriorat, ori ați uitat un obiect la bord, ghișeul Menzies este primul punct de contact la Cluj și Sibiu. La Târgu Mureș, handlingul e făcut de aeroport (mai jos).',
    en: 'Menzies runs the “below-the-wing” services — aircraft loading/unloading, baggage sorting and transport, plus check-in and boarding for most airlines. If a checked bag is missing or damaged, or you left something on board, the Menzies desk is the first point of contact at Cluj and Sibiu. At Târgu Mureș, handling is done by the airport itself (below).',
  },
  stations: [
    {
      airport: 'CLJ',
      role: { ro: 'Aeroportul Cluj-Napoca — pasageri, rampă, bagaje', en: 'Cluj-Napoca Airport — passenger, ramp, baggage' },
      phones: ['+40 264 307 562', '+40 264 307 506'],
      emails: ['clj.admin@menziesaviation.com', 'clj.tkt@menziesaviation.com'],
      hours: { ro: 'Zilnic 04:30–20:00', en: 'Daily 04:30–20:00' },
    },
    {
      airport: 'SBZ',
      role: { ro: 'Aeroportul Sibiu — pasageri, rampă, bagaje', en: 'Sibiu Airport — passenger, ramp, baggage' },
      phones: ['+40 758 255 710'],
      emails: [],
      hours: { ro: 'Non-stop, 24/7', en: 'Around the clock, 24/7' },
    },
  ],
  website: 'https://www.menziesaviation.com',
}

/* ── Two contexts for a lost item ─────────────────────────────────────────────
 *  (1) AT THE AIRPORT — a checked bag missing/damaged at reclaim (the handler
 *      desks above), or an item dropped in the terminal (airport lost & found).
 *  (2) DURING THE FLIGHT / ON BOARD — a personal item left on the aircraft,
 *      which is the airline's responsibility; at CLJ/SBZ items found on board
 *      are collected by Menzies, at TGM by the airport. */

export interface TerminalLostFound {
  name: { ro: string; en: string }
  phone?: string
  email?: string
}

/** Airport-operator lost property for items dropped in the TERMINAL (not the
 *  baggage-handler desk). */
export const TERMINAL_LOST_FOUND: Record<AirportCode, TerminalLostFound> = {
  CLJ: {
    name: { ro: 'Aeroportul Cluj-Napoca — obiecte pierdute', en: 'Cluj-Napoca Airport — lost property' },
    phone: '+40 264 307 500',
    email: 'office@airportcluj.ro',
  },
  TGM: {
    name: { ro: 'Aeroportul Transilvania (Târgu Mureș) — handling propriu', en: 'Transylvania Airport (Târgu Mureș) — in-house handling' },
    phone: '+40 265 328 258',
    email: 'handling@transylvaniaairport.ro',
  },
  SBZ: {
    name: { ro: 'Aeroportul Sibiu — ghișeul Menzies (24/7)', en: 'Sibiu Airport — Menzies desk (24/7)' },
    phone: '+40 758 255 710',
  },
}

/** Guidance for an item left ON BOARD / during the flight. */
export const ONBOARD_GUIDANCE = {
  ro: 'Un obiect uitat în avion aparține companiei aeriene, nu aeroportului. Anunțați cât mai repede compania cu care ați zburat (numărul zborului și locul). La Cluj și Sibiu, obiectele găsite la bord sunt de regulă colectate de Menzies (contact mai sus); la Târgu Mureș, de aeroport. Confirmați întotdeauna cu compania aeriană.',
  en: 'An item left on the aircraft is the airline’s responsibility, not the airport’s. Contact the airline you flew with as soon as possible (flight number and seat). At Cluj and Sibiu, items found on board are usually collected by Menzies (contact above); at Târgu Mureș, by the airport. Always confirm with your airline.',
} as const
