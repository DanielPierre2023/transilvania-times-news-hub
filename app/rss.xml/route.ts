// app/rss.xml/route.ts
//
// B6: RSS 2.0 feed — Romanian edition (primary language)
// Serves last 50 published articles.
// Discovered via <link rel="alternate"> in app/layout.tsx.
// English feed: /atom.xml (Atom 1.0, bilingual-friendly aggregators)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/src/integrations/supabase/types'

export const revalidate = 300 // 5 minutes

const SITE_URL    = 'https://transilvaniatimes.com'
const SITE_TITLE  = 'Transilvania Times'
const SITE_DESCR  = 'Jurnalism independent din inima Transilvaniei.'
const SITE_LANG   = 'ro-RO'
const SITE_EMAIL  = 'contact@add-individual-solutions.com'

function esc(text: string): string {
  return text
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;')
}

function toRfc2822(iso: string | null): string {
  if (!iso) return new Date().toUTCString()
  try { return new Date(iso).toUTCString() } catch { return new Date().toUTCString() }
}

function coverMimeType(url: string): string {
  if (url.endsWith('.webp')) return 'image/webp'
  if (url.endsWith('.png'))  return 'image/png'
  return 'image/jpeg'
}

export async function GET() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: posts, error } = await supabase
    .from('blog_posts')
    .select('slug, title_ro, excerpt_ro, cover_image, category, tags_ro, published_at, author_name')
    .eq('status', 'published')
    .not('slug',     'is', null)
    .not('title_ro', 'is', null)
    .order('published_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[rss.xml] Supabase error:', error.message)
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  const CAT_LABELS: Record<string, string> = {
    news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
    business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
    education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
  }

  const items = (posts ?? []).map(post => {
    const url         = `${SITE_URL}/blog/${post.slug}`
    const title       = esc(post.title_ro || '')
    const description = esc(post.excerpt_ro || '')
    const pubDate     = toRfc2822(post.published_at)
    const author      = post.author_name ? esc(post.author_name) : 'Redacția Transilvania Times'
    const catLabel    = post.category ? esc(CAT_LABELS[post.category] ?? post.category) : ''
    const enclosure   = post.cover_image
      ? `<enclosure url="${esc(post.cover_image)}" type="${coverMimeType(post.cover_image)}" length="0" />`
      : ''

    return `
    <item>
      <title>${title}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      <author>${SITE_EMAIL} (${author})</author>
      ${catLabel ? `<category>${catLabel}</category>` : ''}
      ${enclosure}
    </item>`
  }).join('')

  const lastBuild = toRfc2822(posts?.[0]?.published_at ?? null)
  const year      = new Date().getFullYear()

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${esc(SITE_TITLE)}</title>
    <link>${SITE_URL}</link>
    <description>${esc(SITE_DESCR)}</description>
    <language>${SITE_LANG}</language>
    <atom:link href="${SITE_URL}/rss.xml" rel="self" type="application/rss+xml" />
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <ttl>300</ttl>
    <managingEditor>${SITE_EMAIL} (Redacția ${esc(SITE_TITLE)})</managingEditor>
    <webMaster>${SITE_EMAIL}</webMaster>
    <copyright>© ${year} ${esc(SITE_TITLE)}. Toate drepturile rezervate.</copyright>
    <image>
      <url>${SITE_URL}/assets/logos/tt-logo-rss.png</url>
      <title>${esc(SITE_TITLE)}</title>
      <link>${SITE_URL}</link>
    </image>
    ${items}
  </channel>
</rss>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type':  'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
