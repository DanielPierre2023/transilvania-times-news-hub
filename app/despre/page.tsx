/* eslint-disable react/no-unescaped-entities */
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Metadata } from 'next'

export const revalidate = 3600

const SITE_URL = 'https://transilvaniatimes.com'

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

export const metadata: Metadata = {
  title: 'Despre Transilvania Times',
  description: 'Jurnalism independent din inima Transilvaniei. Misiunea editorială, echipa și standardele noastre.',
  alternates: { canonical: `${SITE_URL}/despre` },
  openGraph: {
    title: 'Despre Transilvania Times',
    description: 'Jurnalism independent din inima Transilvaniei.',
    url: `${SITE_URL}/despre`,
    type: 'website',
  },
}

interface Author {
  slug: string
  name_ro: string
  title_ro: string
  bio_ro: string
  avatar_url: string | null
  specialties: string[]
}

export default async function DesprePage() {
  const supabase = await createSupabaseServerClient()

  const { data: authorsData } = await supabase
    .from('authors')
    .select('slug, name_ro, title_ro, bio_ro, avatar_url, specialties')
    .eq('active', true)
    .order('created_at', { ascending: true })

  const authors = (authorsData ?? []) as unknown as Author[]

  const orgLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: 'Transilvania Times',
    url: SITE_URL,
    description: 'Jurnalism independent din inima Transilvaniei.',
    foundingDate: '2024',
    founder: { '@type': 'Person', name: 'Daniel Dobos' },
    address: [
      {
        '@type': 'PostalAddress',
        streetAddress: 'str. Frunzișului nr. 89',
        addressLocality: 'Cluj-Napoca',
        addressRegion: 'Cluj',
        addressCountry: 'RO',
      },
      {
        '@type': 'PostalAddress',
        streetAddress: 'Sunset Valley, 7081 Pyla',
        addressCountry: 'CY',
      },
    ],
    parentOrganization: {
      '@type': 'Organization',
      name: 'Transilvania Times',
      url: 'https://transilvaniatimes.com',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgLd) }}
      />

      <div className="max-w-7xl mx-auto border-x border-foreground/10">
        <div className="max-w-3xl mx-auto px-6 pt-10 pb-16">

          {/* Page header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-2 h-2 bg-brand-red" />
              <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                Despre noi
              </span>
              <div className="flex-1 h-px bg-foreground/10" />
            </div>
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-tight mb-6">
              Jurnalism independent din inima Transilvaniei
            </h1>
          </div>

          {/* Mission */}
          <div className="mb-10">
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
              Transilvania Times este o publicație digitală dedicată jurnalismului de calitate despre România, cu un focus special pe Transilvania — regiune cu o identitate culturală distinctă, un ecosistem economic în creștere rapidă și o viață politică complexă care merită acoperire profesionistă.
            </p>
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
              Publicăm zilnic în română și engleză, acoperind politică, tehnologie, afaceri, cultură, educație, sănătate și sport. Fiecare articol trece printr-un proces editorial riguros care include verificarea faptelor, editare stilistică și revizuire finală înainte de publicare.
            </p>
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
              Misiunea noastră este simplă: să oferim cititorilor informații exacte, analize de substanță și perspective locale pe care nu le găsesc în altă parte. Nu publicăm clickbait. Nu publicăm articole fără fapte verificabile. Nu amestecăm știrile cu opiniile.
            </p>
          </div>

          {/* Ownership */}
          <div className="mb-10 border-t border-foreground/10 pt-8">
            <h2 className="font-serif text-xl font-bold text-foreground mb-4">Proprietate și independență editorială</h2>
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
              Transilvania Times este o publicație de știri regionale din Transilvania, România. Redacția funcționează independent de orice afiliere politică, partid sau grup de interese.
            </p>
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
              Finanțarea publicației provine din publicitate, parteneriate editoriale și servicii digitale. Niciun sponsor, niciun client și niciun partener comercial nu influențează conținutul editorial. Articolele sponsorizate sunt marcate vizibil și separat de conținutul editorial.
            </p>
          </div>

          {/* AI Transparency — required for AdSense + ethical */}
          <div className="mb-10 border-t border-foreground/10 pt-8">
            <h2 className="font-serif text-xl font-bold text-foreground mb-4">Tehnologie și transparență</h2>
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
              Transilvania Times utilizează instrumente de inteligență artificială în procesul editorial pentru agregarea surselor, cercetare și asistență la redactare. Toate materialele publicate sunt verificate, editate și aprobate conform standardelor noastre editoriale înainte de publicare.
            </p>
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
              Atribuirea autorilor reflectă biroul editorial responsabil pentru forma finală a fiecărui articol. Fiecare autor are o specializare tematică și un stil distinct care se regăsesc consistent în materialele semnate. Considerăm că transparența despre instrumentele pe care le folosim este o obligație față de cititorii noștri.
            </p>
          </div>

          {/* Editorial Team */}
          {authors.length > 0 && (
            <div className="border-t border-foreground/10 pt-8">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-2 h-2 bg-brand-red" />
                <h2 className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                  Echipa editorială
                </h2>
                <div className="flex-1 h-px bg-foreground/10" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {authors.map(author => (
                  <Link
                    key={author.slug}
                    href={`/autor/${author.slug}`}
                    className="group flex gap-4 items-start p-4 border border-foreground/[0.06] hover:border-foreground/15 transition-colors"
                  >
                    {author.avatar_url ? (
                      <div className="w-14 h-14 border border-foreground/10 overflow-hidden shrink-0">
                        <img src={author.avatar_url} alt={author.name_ro} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-14 h-14 bg-brand-red/10 border border-brand-red/20 flex items-center justify-center shrink-0">
                        <span className="font-serif text-brand-red text-lg font-bold">
                          {author.name_ro.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-[13px] font-bold text-foreground group-hover:text-brand-red transition-colors">
                        {author.name_ro}
                      </p>
                      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.1em] text-brand-red/80 mb-1.5">
                        {author.title_ro}
                      </p>
                      {author.specialties && author.specialties.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {author.specialties.map(spec => (
                            <span
                              key={spec}
                              className="text-[9px] font-sans uppercase tracking-wider text-muted-foreground border border-foreground/10 px-1.5 py-0.5"
                            >
                              {CAT_LABELS[spec] || spec}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Contact CTA */}
          <div className="mt-10 pt-6 border-t border-foreground/10 text-center">
            <p className="font-sans text-[13px] text-muted-foreground mb-3">
              Întrebări, sugestii sau corecții?
            </p>
            <Link
              href="/contact"
              className="inline-block font-sans text-[11px] font-bold uppercase tracking-widest text-white bg-brand-red px-6 py-2.5 hover:bg-brand-red/90 transition-colors"
            >
              Contactează redacția
            </Link>
          </div>

        </div>
      </div>
    </>
  )
}
