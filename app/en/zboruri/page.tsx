import type { Metadata } from 'next'
import FlightBoard from '@/app/components/FlightBoard'
import { createSupabaseAnonClient } from '@/lib/supabase/service'
import { bucharestDate, addDays, type FlightRow } from '@/lib/flights'

export const revalidate = 60

const SITE_URL = 'https://transilvaniatimes.com'

export const metadata: Metadata = {
  title: 'Flights — Transylvania Airports (Cluj, Târgu Mureș, Sibiu)',
  description:
    'Real-time arrivals and departures for Cluj-Napoca, Târgu Mureș and Sibiu airports: scheduled and estimated times, airline, destination and live status.',
  alternates: {
    canonical: `${SITE_URL}/en/zboruri/`,
    languages: { 'ro-RO': `${SITE_URL}/zboruri/`, 'en': `${SITE_URL}/en/zboruri/` },
  },
  openGraph: {
    title: 'Flights — Transylvania Airports',
    description: 'Real-time arrivals and departures: Cluj-Napoca, Târgu Mureș and Sibiu.',
    url: `${SITE_URL}/en/zboruri/`,
    type: 'website',
  },
}

async function loadInitial(): Promise<{ flights: FlightRow[]; today: string }> {
  const today = bucharestDate()
  const supabase = createSupabaseAnonClient()
  const { data } = await supabase
    .from('airport_flights')
    .select(
      'airport, direction, flight_date, flight_no, airline, city, aircraft, scheduled_time, estimated_time, status, status_raw, is_charter, source_url, updated_at',
    )
    .gte('flight_date', addDays(today, -1))
    .lte('flight_date', addDays(today, 1))
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
  return { flights: (data ?? []) as FlightRow[], today }
}

export default async function FlightsPageEn() {
  const { flights, today } = await loadInitial()

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Flights — Transylvania Airports',
    description: 'Real-time arrivals and departures for Cluj-Napoca, Târgu Mureș and Sibiu airports.',
    url: `${SITE_URL}/en/zboruri/`,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'Transilvania Times', url: SITE_URL },
    about: [
      { '@type': 'Airport', name: 'Cluj-Napoca „Avram Iancu” International Airport', iataCode: 'CLJ', icaoCode: 'LRCL' },
      { '@type': 'Airport', name: 'Târgu Mureș „Transilvania” International Airport', iataCode: 'TGM', icaoCode: 'LRTM' },
      { '@type': 'Airport', name: 'Sibiu International Airport', iataCode: 'SBZ', icaoCode: 'LRSB' },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <FlightBoard initialFlights={flights} initialToday={today} initialLang="en" />
    </>
  )
}
