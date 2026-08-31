// app/buletin/page.tsx
//
// Index of published video bulletins. Exists for three reasons:
//   1. Internal linking — every bulletin page needs a parent that links to it,
//      or each one is an orphan and gets crawled late or not at all.
//   2. A landing page for "buletin video Transilvania Times" style queries.
//   3. ItemList structured data, which is what makes a hub page eligible for
//      a carousel rather than a plain blue link.

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { listBulletins, bulletinTitle, bulletinUrl, SITE_URL, BRAND } from '@/lib/bulletin'

export const revalidate = 300

const TITLE = 'Buletine video — știrile zilei din Ardeal'
const DESCRIPTION =
  'Buletinul video zilnic Transilvania Times: știrile din Cluj, Turda și județele Transilvaniei, ' +
  'prezentate în câteva minute. Arhiva completă a edițiilor.'

export const metadata: Metadata = {
  title: `${TITLE} | ${BRAND}`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/buletin/` },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/buletin/`,
    title: TITLE,
    description: DESCRIPTION,
    siteName: BRAND,
    locale: 'ro_RO',
  },
}

export default async function BulletinIndex() {
  const bulletins = await listBulletins(40)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: TITLE,
    description: DESCRIPTION,
    itemListElement: bulletins.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: bulletinUrl(b.slug),
      name: bulletinTitle(b),
    })),
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="mb-6">
        <h1 className="font-serif text-3xl font-bold">{TITLE}</h1>
        <p className="text-[14px] text-neutral-500 mt-2 max-w-xl">{DESCRIPTION}</p>
      </header>

      {bulletins.length === 0 ? (
        <p className="text-[14px] text-neutral-500">
          Nu există încă buletine publicate.
        </p>
      ) : (
        <ul className="space-y-4">
          {bulletins.map(b => (
            <li key={b.id} className="flex gap-4 items-start border-b pb-4">
              {b.poster_url && (
                <Link href={`/buletin/${b.slug}/`} className="shrink-0">
                  <Image
                    src={b.poster_url}
                    alt=""
                    width={160}
                    height={90}
                    className="w-40 h-[90px] object-cover rounded"
                  />
                </Link>
              )}
              <div className="min-w-0">
                <Link href={`/buletin/${b.slug}/`} className="font-serif text-lg font-bold hover:underline leading-snug">
                  {bulletinTitle(b)}
                </Link>
                <p className="text-[12px] text-neutral-500 mt-1">
                  <time dateTime={b.published_at || b.created_at}>
                    {new Date(b.published_at || b.created_at).toLocaleDateString('ro-RO', {
                      day: 'numeric', month: 'long', year: 'numeric',
                    })}
                  </time>
                  {b.duration_seconds ? ` · ${Math.round(b.duration_seconds / 60)} min` : ''}
                </p>
                {!!(b.story_titles || []).length && (
                  <p className="text-[13px] text-neutral-600 dark:text-neutral-400 mt-1 line-clamp-2">
                    {(b.story_titles || []).slice(0, 3).join(' · ')}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
