import type { Metadata } from 'next'
import AirlinesPageContent from '@/app/components/AirlinesPageContent'
import { loadDestinations } from '@/lib/load-destinations'
import { AIRLINE_DIRECTORY } from '@/lib/airline-directory'

export const revalidate = 300
const SITE_URL = 'https://transilvaniatimes.com'

export const metadata: Metadata = {
  title: 'Companii aeriene & bagaje — Aeroporturile Transilvaniei (CLJ, TGM, SBZ)',
  description:
    'Toate companiile aeriene de la Cluj-Napoca, Târgu Mureș și Sibiu: destinații, agent de handling și birou de bagaje/obiecte pierdute cu telefon și e-mail pentru fiecare aeroport.',
  alternates: {
    canonical: `${SITE_URL}/zboruri/companii/`,
    languages: {
      'ro-RO': `${SITE_URL}/zboruri/companii/`,
      'en': `${SITE_URL}/en/zboruri/companii/`,
    },
  },
  openGraph: {
    title: 'Companii aeriene & bagaje — Aeroporturile Transilvaniei',
    description: 'Companii, destinații, handling și obiecte pierdute la Cluj, Târgu Mureș și Sibiu.',
    url: `${SITE_URL}/zboruri/companii/`,
    type: 'website',
  },
}

export default async function CompaniiPage() {
  const destinations = await loadDestinations()
  const ld = [
    {
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: 'Companii aeriene & bagaje — Aeroporturile Transilvaniei',
      url: `${SITE_URL}/zboruri/companii/`, inLanguage: 'ro-RO',
      isPartOf: { '@type': 'WebSite', name: 'Transilvania Times', url: SITE_URL },
    },
    {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Companii aeriene', itemListElement: AIRLINE_DIRECTORY.map((a, i) => ({
        '@type': 'ListItem', position: i + 1, name: a.name,
      })),
    },
  ]
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <AirlinesPageContent lang="ro" destinations={destinations} />
    </>
  )
}
