// app/components/AirportQuickLinks.tsx
//
// Server-rendered, crawlable links from the main flight board to the three
// per-airport landing pages. The FlightBoard's airport tabs are client-side
// <button> filters, which Google does not follow — before this strip existed
// the /zboruri/{cluj,targu-mures,sibiu} pages had zero internal links
// pointing at them (orphan pages) and were not indexed.

import Link from 'next/link'
import { AIRPORTS } from '@/lib/flights'
import { AIRPORT_SLUG } from '@/lib/airport-seo'
import type { AirportCode } from '@/lib/flights'

const ORDER: AirportCode[] = ['CLJ', 'TGM', 'SBZ']

interface Props {
  lang: 'ro' | 'en'
}

export default function AirportQuickLinks({ lang }: Props) {
  const prefix = lang === 'en' ? '/en/zboruri' : '/zboruri'
  const heading = lang === 'ro' ? 'Pagina fiecărui aeroport:' : 'Dedicated airport pages:'

  return (
    <nav
      aria-label={lang === 'ro' ? 'Aeroporturi' : 'Airports'}
      className="max-w-7xl mx-auto border-x border-foreground/10"
    >
      <div className="px-4 sm:px-6 pt-6 flex flex-wrap items-center gap-2">
        <span className="font-sans text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mr-1">
          {heading}
        </span>
        {ORDER.map(code => {
          const a = AIRPORTS[code]
          const slug = AIRPORT_SLUG[code]
          const text =
            lang === 'ro' ? `Zboruri ${a.short} (${code})` : `${a.short} (${code}) flights`
          return (
            <Link
              key={code}
              href={`${prefix}/${slug}/`}
              className="font-sans text-[12px] font-bold uppercase tracking-wider text-brand-red border border-brand-red/20 px-3 py-1.5 hover:bg-brand-red/[0.06] transition-colors"
            >
              {text}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
