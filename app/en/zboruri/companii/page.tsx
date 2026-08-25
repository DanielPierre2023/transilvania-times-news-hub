import type { Metadata } from 'next'
import AirlinesPageContent from '@/app/components/AirlinesPageContent'
import { loadDestinations } from '@/lib/load-destinations'
import { AIRLINE_DIRECTORY } from '@/lib/airline-directory'

export const revalidate = 300
const SITE_URL = 'https://transilvaniatimes.com'

export const metadata: Metadata = {
  title: 'Airlines & baggage — Transylvania Airports (CLJ, TGM, SBZ)',
  description:
    'Every airline at Cluj-Napoca, Târgu Mureș and Sibiu: destinations, ground handler and the baggage / lost-property desk with phone and e-mail for each airport.',
  alternates: {
    canonical: `${SITE_URL}/en/zboruri/companii/`,
    languages: {
      'ro-RO': `${SITE_URL}/zboruri/companii/`,
      'en': `${SITE_URL}/en/zboruri/companii/`,
    },
  },
  openGraph: {
    title: 'Airlines & baggage — Transylvania Airports',
    description: 'Airlines, destinations, handling and lost property at Cluj, Târgu Mureș and Sibiu.',
    url: `${SITE_URL}/en/zboruri/companii/`,
    type: 'website',
  },
}

export default async function AirlinesPageEn() {
  const destinations = await loadDestinations()
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: 'Airlines & baggage — Transylvania Airports',
      url: `${SITE_URL}/en/zboruri/companii/`, inLanguage: 'en',
      isPartOf: { '@type': 'WebSite', name: 'Transilvania Times', url: SITE_URL },
    },
    {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Airlines', itemListElement: AIRLINE_DIRECTORY.map((a, i) => ({
        '@type': 'ListItem', position: i + 1, name: a.name,
      })),
    },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/en/` },
        { '@type': 'ListItem', position: 2, name: 'Flights', item: `${SITE_URL}/en/zboruri/` },
        { '@type': 'ListItem', position: 3, name: 'Airlines & baggage', item: `${SITE_URL}/en/zboruri/companii/` },
      ],
    },
  ]
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <AirlinesPageContent lang="en" destinations={destinations} />
    </>
  )
}
