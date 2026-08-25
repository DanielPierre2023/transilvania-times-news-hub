import type { Metadata } from 'next'
import FlightBoard from '@/app/components/FlightBoard'
import AirportQuickLinks from '@/app/components/AirportQuickLinks'
import AdUnit from '@/app/components/AdUnit'
import { AD_SLOTS } from '@/lib/ads'
import { createSupabaseAnonClient } from '@/lib/supabase/service'
import { bucharestDate, addDays, type FlightRow } from '@/lib/flights'

export const revalidate = 60

const SITE_URL = 'https://transilvaniatimes.com'

export const metadata: Metadata = {
  title: 'Zboruri — Aeroporturile Transilvaniei (Cluj, Târgu Mureș, Sibiu)',
  description:
    'Sosiri și plecări în timp real de la aeroporturile Cluj-Napoca, Târgu Mureș și Sibiu: oră programată și estimată, companie, destinație și status live.',
  alternates: {
    canonical: `${SITE_URL}/zboruri/`,
    languages: { 'ro-RO': `${SITE_URL}/zboruri/`, 'en': `${SITE_URL}/en/zboruri/` },
  },
  openGraph: {
    title: 'Zboruri — Aeroporturile Transilvaniei',
    description: 'Sosiri și plecări în timp real: Cluj-Napoca, Târgu Mureș și Sibiu.',
    url: `${SITE_URL}/zboruri/`,
    type: 'website',
  },
}

async function loadInitial(): Promise<{ flights: FlightRow[]; today: string }> {
  const today = bucharestDate()
  const supabase = createSupabaseAnonClient()
  const { data } = await supabase
    .from('airport_flights')
    .select(
      'airport, direction, flight_date, flight_no, airline, city, aircraft, scheduled_time, estimated_time, other_time, gate, checkin_desk, status, status_raw, is_charter, source_url, updated_at',
    )
    .gte('flight_date', addDays(today, -1))
    .lte('flight_date', addDays(today, 1))
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
  return { flights: (data ?? []) as FlightRow[], today }
}

export default async function ZboruriPage() {
  const { flights, today } = await loadInitial()

  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Zboruri — Aeroporturile Transilvaniei',
    description:
      'Sosiri și plecări în timp real de la aeroporturile Cluj-Napoca, Târgu Mureș și Sibiu.',
    url: `${SITE_URL}/zboruri/`,
    inLanguage: 'ro-RO',
    isPartOf: { '@type': 'WebSite', name: 'Transilvania Times', url: SITE_URL },
    about: [
      { '@type': 'Airport', name: 'Aeroportul Internațional „Avram Iancu” Cluj', iataCode: 'CLJ', icaoCode: 'LRCL' },
      { '@type': 'Airport', name: 'Aeroportul Internațional „Transilvania” Târgu Mureș', iataCode: 'TGM', icaoCode: 'LRTM' },
      { '@type': 'Airport', name: 'Aeroportul Internațional Sibiu', iataCode: 'SBZ', icaoCode: 'LRSB' },
    ],
  },
  {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Acasă', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Zboruri', item: `${SITE_URL}/zboruri/` },
    ],
  }]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <AirportQuickLinks lang="ro" />
      <FlightBoard initialFlights={flights} initialToday={today} initialLang="ro" />
      <div className="max-w-7xl mx-auto border-x border-foreground/10 px-4 sm:px-6 pb-8">
        <AdUnit type="leaderboard" slot={AD_SLOTS.zboruriBelowBoard} />
      </div>
    </>
  )
}
