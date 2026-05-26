// app/atom.xml/route.ts
//
// B6: Atom 1.0 feed — preferred by Feedly, NewsBlur, and most EU aggregators.
// Serves last 50 published articles in Romanian (canonical language).
// English title/excerpt included as <summary xml:lang="en"> where available.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/src/integrations/supabase/types'

export const revalidate = 300 // 5 minutes

const SITE_URL    = 'https://transilvaniatimes.com'
const SITE_TITLE  = 'Transilvania Times'
const SITE_DESCR  = 'Jurnalism independent din inima Transilvaniei.'
const SITE_EMAIL  = 'contact@add-individual-solutions.com'

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toIso(iso: string | null): string {
  if (!iso) return new Date().toISOString()
  try { return new Date(iso).toISOString() } catch { return new Date().toISOString() }
}

export async function GET() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: posts, error } = await supabase
    .from('blog_posts')
    .select('slug, title_ro, title_en, excerpt_ro, excerpt_en, cover_image, category, published_at, updated_at, author_name')
    .eq('status', 'published')
    .not('slug',     'is', null)
    .not('title_ro', 'is', null)
    .order('published_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[atom.xml] Supabase error:', error.message)
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  const feedUpdated = toIso(posts?.[0]?.updated_at ?? posts?.[0]?.published_at ?? null)
  const year        = new Date().getFullYear()

  const entries = (posts ?? []).map(post => {
    const url       = `${SITE_URL}/blog/${post.slug}`
    const titleRo   = esc(post.title_ro || '')
    const titleEn   = post.title_en ? esc(post.title_en) : ''
    const summaryRo = esc(post.excerpt_ro || '')
    const summaryEn = post.excerpt_en ? esc(post.excerpt_en) : ''
    const published = toIso(post.published_at)
    const updated   = toIso(post.updated_at ?? post.published_at)
    const author    = post.author_name ? esc(post.author_name) : 'Redacția Transilvania Times'

    return `
  <entry>
    <id>${url}</id>
    <title xml:lang="ro">${titleRo}</title>
    ${titleEn ? `<title xml:lang="en">${titleEn}</title>` : ''}
    <link href="${url}" rel="alternate" type="text/html" />
    ${post.cover_image ? `<link href="${esc(post.cover_image)}" rel="enclosure" type="image/jpeg" />` : ''}
    <summary xml:lang="ro" type="text">${summaryRo}</summary>
    ${summaryEn ? `<summary xml:lang="en" type="text">${summaryEn}</summary>` : ''}
    <published>${published}</published>
    <updated>${updated}</updated>
    <author><name>${author}</name><email>${SITE_EMAIL}</email></author>
    ${post.category ? `<category term="${esc(post.category)}" />` : ''}
  </entry>`
  }).join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ro">
  <id>${SITE_URL}/atom.xml</id>
  <title>${esc(SITE_TITLE)}</title>
  <subtitle>${esc(SITE_DESCR)}</subtitle>
  <link href="${SITE_URL}" rel="alternate" type="text/html" />
  <link href="${SITE_URL}/atom.xml" rel="self" type="application/atom+xml" />
  <updated>${feedUpdated}</updated>
  <author>
    <name>${esc(SITE_TITLE)}</name>
    <email>${SITE_EMAIL}</email>
    <uri>${SITE_URL}</uri>
  </author>
  <rights>© ${year} ${esc(SITE_TITLE)}. Toate drepturile rezervate.</rights>
  ${entries}
</feed>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type':  'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
