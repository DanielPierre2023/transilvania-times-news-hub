import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import FlightBoard from '@/app/components/FlightBoard'
import { createSupabaseAnonClient } from '@/lib/supabase/service'
import { AIRPORTS, bucharestDate, addDays, dateHeading, statusLabel, type FlightRow, type AirportCode, type Direction } from '@/lib/flights'

/**
 * Per-flight permalink used by social shares (Facebook, Messenger, WhatsApp,
 * X, Telegram). Facebook and Messenger IGNORE any text passed to their share
 * dialog — they only display what they scrape from the target URL's
 * OpenGraph tags. This route exists so those scrapers see flight-specific
 * title/description/image, and the shared post reads as "flight A2 107 to
 * Bucharest, delayed to 01:00" instead of the generic homepage summary.
 *
 * Slug: {airport}-{d|a}-{YYYYMMDD}-{flightNoNoSpaces}-{HHMM}
 *   e.g. cluj-d-20260823-a2107-2200
 *
 * Humans clicking the link land on the airport's board (a server-rendered
 * <meta refresh> redirect — scrapers stop at the metadata). Canonical URL
 * points at the parent airport page so search engines don't index thousands
 * of per-flight variants.
 */

const SITE_URL = 'https://transilvaniatimes.com'
const AIRPORT_SLUG: Record<AirportCode, string> = { CLJ: 'cluj', TGM: 'targu-mures', SBZ: 'sibiu' }
const SLUG_AIRPORT: Record<string, AirportCode> = { cluj: 'CLJ', 'targu-mures': 'TGM', sibiu: 'SBZ' }

interface PageProps { params: Promise<{ slug: string }> }

interface Parsed {
  airport: AirportCode
  direction: Direction
  flight_date: string
  flight_no: string
  scheduled_time: string
}

function parseSlug(slug: string): Parsed | null {
  const m = slug.match(/^([a-z-]+)-([da])-(\d{4})(\d{2})(\d{2})-([a-z0-9]+)-(\d{2})(\d{2})$/i)
  if (!m) return null
  const airport = SLUG_AIRPORT[m[1].toLowerCase()]
  if (!airport) return null
  const flight_no = m[6].toUpperCase().replace(/^([A-Z0-9]{2,3})(\d+)$/, '$1 $2')
  return {
    airport,
    direction: m[2].toLowerCase() === 'd' ? 'departure' : 'arrival',
    flight_date: `${m[3]}-${m[4]}-${m[5]}`,
    flight_no,
    scheduled_time: `${m[7]}:${m[8]}`,
  }
}

async function loadFlight(p: Parsed): Promise<FlightRow | null> {
  const supabase = createSupabaseAnonClient()
  const { data } = await supabase
    .from('airport_flights')
    .select('airport, direction, flight_date, flight_no, airline, city, aircraft, scheduled_time, estimated_time, other_time, gate, checkin_desk, status, status_raw, is_charter, source_url, updated_at')
    .eq('airport', p.airport).eq('direction', p.direction)
    .eq('flight_date', p.flight_date).eq('flight_no', p.flight_no)
    .eq('scheduled_time', p.scheduled_time + ':00')
    .maybeSingle()
  return (data as FlightRow | null) ?? null
}

async function loadAirportContext(airport: AirportCode): Promise<{ flights: FlightRow[]; today: string }> {
  const today = bucharestDate()
  const supabase = createSupabaseAnonClient()
  const { data } = await supabase
    .from('airport_flights')
    .select('airport, direction, flight_date, flight_no, airline, city, aircraft, scheduled_time, estimated_time, other_time, gate, checkin_desk, status, status_raw, is_charter, source_url, updated_at')
    .eq('airport', airport)
    .gte('flight_date', addDays(today, -1))
    .lte('flight_date', addDays(today, 1))
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
  return { flights: (data ?? []) as FlightRow[], today }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const p = parseSlug(slug)
  if (!p) return { robots: { index: false, follow: false } }
  const f = await loadFlight(p)
  const a = AIRPORTS[p.airport]
  const boardHref = `${SITE_URL}/en/zboruri/${AIRPORT_SLUG[p.airport]}/`
  if (!f) return { title: `${p.flight_no} — Aeroportul ${a.short}`, robots: { index: false, follow: false }, alternates: { canonical: boardHref } }
  const dir = p.direction === 'departure'
    ? `${a.short} (${a.iata}) → ${f.city ?? '—'}`
    : `${f.city ?? '—'} → ${a.short} (${a.iata})`
  const sched = String(f.scheduled_time).slice(0, 5)
  const est = f.estimated_time ? String(f.estimated_time).slice(0, 5) : null
  const label = statusLabel(f, 'en')
  const bits = [
    `${p.direction === 'departure' ? 'Departure' : 'Arrival'} ${dir}`,
    `Scheduled: ${dateHeading(f.flight_date, 'en')} ${sched}`,
  ]
  if (est && est !== sched) bits.push(`Estimated: ${est}`)
  if (f.gate) bits.push(`Gate ${f.gate}`)
  if (f.checkin_desk) bits.push(`Check-in ${f.checkin_desk}`)
  bits.push(`Status: ${label}`)
  const title = `✈️ ${f.flight_no}${f.airline ? ' · ' + f.airline : ''} — ${dir}`
  const description = bits.join(' · ')
  return {
    title,
    description,
    alternates: { canonical: boardHref },
    robots: { index: false, follow: true },
    openGraph: { title, description, url: `${SITE_URL}/en/zboruri/f/${slug}/`, type: 'website', siteName: 'Transilvania Times' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export const revalidate = 60

export default async function FlightPermalinkPage({ params }: PageProps) {
  const { slug } = await params
  const p = parseSlug(slug)
  if (!p) { notFound(); return null }
  const { flights, today } = await loadAirportContext(p.airport)
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=/en/zboruri/${AIRPORT_SLUG[p.airport]}/`} />
      <FlightBoard initialFlights={flights} initialToday={today} initialLang="en" initialAirport={p.airport} />
    </>
  )
}
