import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import FlightBoard from '@/app/components/FlightBoard'
import { createSupabaseAnonClient } from '@/lib/supabase/service'
import { AIRPORTS, bucharestDate, addDays, type FlightRow } from '@/lib/flights'
import { SLUG_TO_AIRPORT, AIRPORT_SLUG, AIRPORT_SEO } from '@/lib/airport-seo'

export const revalidate = 60
const SITE_URL = 'https://transilvaniatimes.com'

interface PageProps { params: Promise<{ airport: string }> }

export function generateStaticParams() {
  return [{ airport: 'cluj' }, { airport: 'targu-mures' }, { airport: 'sibiu' }]
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { airport } = await params
  const code = SLUG_TO_AIRPORT[airport]
  if (!code) return {}
  const m = AIRPORTS[code]
  const slug = AIRPORT_SLUG[code]
  const title = `${m.short} Airport (${code}) Flights — Live Departures & Arrivals`
  const description = AIRPORT_SEO[code].en.intro.slice(0, 155)
  return {
    title,
    description,
    alternates: {
      canonical: `${SITE_URL}/en/zboruri/${slug}/`,
      languages: { 'ro-RO': `${SITE_URL}/zboruri/${slug}/`, 'en': `${SITE_URL}/en/zboruri/${slug}/` },
    },
    openGraph: { title, description, url: `${SITE_URL}/en/zboruri/${slug}/`, type: 'website' },
  }
}

async function loadInitial(): Promise<{ flights: FlightRow[]; today: string }> {
  const today = bucharestDate()
  const supabase = createSupabaseAnonClient()
  const { data } = await supabase
    .from('airport_flights')
    .select('airport, direction, flight_date, flight_no, airline, city, aircraft, scheduled_time, estimated_time, other_time, status, status_raw, is_charter, source_url, updated_at')
    .gte('flight_date', addDays(today, -1))
    .lte('flight_date', addDays(today, 1))
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
  return { flights: (data ?? []) as FlightRow[], today }
}

export default async function AirportFlightsPageEn({ params }: PageProps) {
  const { airport } = await params
  const code = SLUG_TO_AIRPORT[airport]
  if (!code) notFound()

  const m = AIRPORTS[code]
  const slug = AIRPORT_SLUG[code]
  const copy = AIRPORT_SEO[code].en
  const { flights, today } = await loadInitial()

  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: `${m.short} Airport (${code}) Flights`, description: copy.intro,
      url: `${SITE_URL}/en/zboruri/${slug}/`, inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'Transilvania Times', url: SITE_URL },
      about: { '@type': 'Airport', name: m.name, iataCode: m.iata, icaoCode: m.icao },
    },
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: copy.faq.map(f => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <div className="max-w-7xl mx-auto border-x border-foreground/10">
        <div className="px-4 sm:px-6 pt-8">
          <nav className="font-sans text-[11px] text-muted-foreground mb-4">
            <Link href="/en/zboruri/" className="hover:text-brand-red">Flights</Link> <span className="mx-1">/</span> {m.short}
          </nav>
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground leading-tight mb-3">
            {m.short} Airport <span className="font-mono text-muted-foreground">({code})</span> Flights
          </h1>
          <p className="font-sans text-[15px] leading-relaxed text-foreground/80 max-w-3xl">{copy.intro}</p>
        </div>
      </div>

      <FlightBoard initialFlights={flights} initialToday={today} initialLang="en" initialAirport={code} />

      <div className="max-w-7xl mx-auto border-x border-foreground/10">
        <div className="px-4 sm:px-6 py-10 max-w-3xl">
          <h2 className="font-serif text-xl font-bold text-foreground mb-5">Frequently asked questions</h2>
          <div className="space-y-5">
            {copy.faq.map((f, i) => (
              <div key={i} className="border-t border-foreground/10 pt-4">
                <h3 className="font-sans text-[14px] font-bold text-foreground mb-1.5">{f.q}</h3>
                <p className="font-sans text-[14px] leading-relaxed text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            {(['cluj', 'targu-mures', 'sibiu'] as const).filter(s => s !== slug).map(s => (
              <Link key={s} href={`/en/zboruri/${s}/`} className="font-sans text-[12px] font-bold uppercase tracking-wider text-brand-red border border-brand-red/20 px-3 py-1.5 hover:bg-brand-red/[0.06] transition-colors">
                {AIRPORTS[SLUG_TO_AIRPORT[s]].short}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
