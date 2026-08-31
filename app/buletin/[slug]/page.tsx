// app/buletin/[slug]/page.tsx
//
// PUBLIC BULLETIN PAGE — the SEO surface for the daily AI bulletin.
//
// Server-rendered on purpose. The whole point is that Google, Discover and
// the social crawlers get real HTML: a headline, a transcript, links to the
// source articles, and VideoObject + NewsArticle structured data. A client
// -rendered page would give them an empty shell, which is exactly the Phase 2
// problem this project already has elsewhere.
//
// Access is granted by the "bulletins public read published" RLS policy added
// in supabase/sql/01_newsroom_upgrade.sql. Unpublished bulletins 404 for
// everyone, including you — publishing is an explicit act in the newsroom.

import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import {
  getBulletin, getBulletinStories, listBulletins, transcriptOf,
  bulletinTitle, bulletinDescription, bulletinUrl, isoDuration,
  SITE_URL, BRAND,
} from '@/lib/bulletin'

// Five minutes: a bulletin never changes after publication, but the list of
// "other bulletins" below it does.
export const revalidate = 300

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params
  const b = await getBulletin(slug)
  if (!b) return { title: 'Buletin negăsit — Transilvania Times' }
  const stories = await getBulletinStories(b)
  const title = bulletinTitle(b)
  const description = bulletinDescription(b, stories)
  const url = bulletinUrl(b.slug)
  const image = b.poster_url || `${SITE_URL}/assets/logos/logo-transilvania-times.png`

  return {
    title: `${title} | ${BRAND}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'video.other',
      url,
      title,
      description,
      siteName: BRAND,
      images: [{ url: image, width: 1280, height: 720, alt: title }],
      locale: b.language === 'en' ? 'en_GB' : 'ro_RO',
      publishedTime: b.published_at || b.created_at,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}

export default async function BulletinPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const b = await getBulletin(slug)
  if (!b) notFound()

  const stories = await getBulletinStories(b)
  const transcript = transcriptOf(b)
  const title = bulletinTitle(b)
  const description = bulletinDescription(b, stories)
  const url = bulletinUrl(b.slug)
  const video = b.bulletin_video_url || b.anchor_video_url || ''
  const published = b.published_at || b.created_at
  const others = (await listBulletins(7)).filter(x => x.slug !== b.slug).slice(0, 5)

  const publisher = {
    '@type': 'NewsMediaOrganization',
    name: BRAND,
    url: SITE_URL,
    logo: { '@type': 'ImageObject', url: `${SITE_URL}/assets/logos/logo-transilvania-times.png` },
  }

  // One @graph rather than three separate script tags: it lets the entities
  // reference each other, and Google prefers a single connected graph.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoObject',
        '@id': `${url}#video`,
        name: title,
        description,
        thumbnailUrl: b.poster_url ? [b.poster_url] : undefined,
        uploadDate: published,
        duration: isoDuration(b.duration_seconds),
        contentUrl: video || undefined,
        embedUrl: url,
        inLanguage: b.language === 'en' ? 'en-GB' : 'ro-RO',
        isFamilyFriendly: true,
        publisher,
        // The transcript is genuinely on the page, so declaring it is accurate.
        transcript: transcript.join('\n\n') || undefined,
      },
      {
        '@type': 'NewsArticle',
        '@id': `${url}#article`,
        headline: title.slice(0, 110),
        description,
        datePublished: published,
        dateModified: published,
        inLanguage: b.language === 'en' ? 'en-GB' : 'ro-RO',
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        image: b.poster_url ? [b.poster_url] : undefined,
        publisher,
        author: { '@type': 'Organization', name: BRAND, url: SITE_URL },
        video: { '@id': `${url}#video` },
        // Declaring the sources makes this an editorial hub rather than a
        // thin page that duplicates nine headlines.
        mentions: stories.filter(s => s.slug).map(s => ({
          '@type': 'NewsArticle',
          headline: s.title,
          url: `${SITE_URL}/blog/${s.slug}/`,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND, item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Buletine video', item: `${SITE_URL}/buletin/` },
          { '@type': 'ListItem', position: 3, name: title, item: url },
        ],
      },
    ],
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="text-[12px] text-neutral-500 mb-4">
        <Link href="/" className="hover:underline">Acasă</Link>
        <span className="mx-1.5">/</span>
        <Link href="/buletin/" className="hover:underline">Buletine video</Link>
      </nav>

      <header className="mb-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-brand-red mb-2">
          Buletin video · realizat cu asistență AI
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl font-bold leading-tight">{title}</h1>
        <p className="text-[13px] text-neutral-500 mt-2">
          <time dateTime={published}>
            {new Date(published).toLocaleDateString('ro-RO', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </time>
          {b.duration_seconds ? ` · ${Math.round(b.duration_seconds / 60)} min` : ''}
          {stories.length ? ` · ${stories.length} subiecte` : ''}
        </p>
      </header>

      {video ? (
        <video
          controls
          preload="metadata"
          poster={b.poster_url || undefined}
          className="w-full rounded-lg bg-black mb-6"
        >
          <source src={video} />
          Browserul tău nu poate reda acest video.
        </video>
      ) : (
        <p className="text-[13px] text-neutral-500 mb-6">Videoul nu este disponibil.</p>
      )}

      <p className="text-[15px] leading-relaxed mb-8">{description}</p>

      {stories.length > 0 && (
        <section className="mb-10">
          <h2 className="font-serif text-xl font-bold mb-3">Știrile din acest buletin</h2>
          <ul className="space-y-3">
            {stories.map((s, i) => (
              <li key={`${s.slug || 'x'}-${i}`} className="flex gap-3 items-start">
                {s.cover_image && (
                  <Image
                    src={s.cover_image}
                    alt=""
                    width={96}
                    height={64}
                    className="w-24 h-16 object-cover rounded shrink-0"
                  />
                )}
                <div className="min-w-0">
                  {s.category && (
                    <span className="text-[10px] uppercase tracking-widest text-brand-red">
                      {CAT_LABELS[s.category.toLowerCase()] || s.category}
                    </span>
                  )}
                  {s.slug ? (
                    <Link href={`/blog/${s.slug}/`} className="block font-semibold hover:underline leading-snug">
                      {s.title}
                    </Link>
                  ) : (
                    <span className="block font-semibold leading-snug">{s.title}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {transcript.length > 0 && (
        <section className="mb-10">
          <h2 className="font-serif text-xl font-bold mb-3">Transcrierea buletinului</h2>
          {/* Real text, not a decoration: a video page with no words on it has
              nothing for a search engine to rank. */}
          <div className="space-y-3 text-[15px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            {transcript.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </section>
      )}

      <section className="mb-10 text-[12.5px] text-neutral-500 border-t pt-4">
        <p>
          Buletinul este citit de un prezentator generat cu inteligență artificială, pe baza
          articolelor publicate de redacția {BRAND}. Textul rostit este scris redacțional și
          verificat înainte de publicare.{' '}
          <Link href="/standarde-editoriale/" className="underline">Standardele noastre editoriale</Link>.
        </p>
      </section>

      {others.length > 0 && (
        <section>
          <h2 className="font-serif text-xl font-bold mb-3">Buletine anterioare</h2>
          <ul className="space-y-2">
            {others.map(o => (
              <li key={o.id}>
                <Link href={`/buletin/${o.slug}/`} className="hover:underline">
                  {bulletinTitle(o)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
