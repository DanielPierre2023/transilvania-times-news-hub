// app/sitemap-news.xml/route.ts
//
// B7: Google News sitemap — Google News requirements:
//   • xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
//   • Required: <news:publication>, <news:publication_date> (ISO 8601 + TZ), <news:title>
//   • Max 1000 URLs per sitemap
//   • No <changefreq> or <priority> (Google ignores them in News sitemaps)
//   • No hard 48-hour date filter — Google determines recency from
//     <news:publication_date> itself. A date filter causes an empty sitemap on
//     low-frequency publishing days, which Google reports as "Missing XML tag: url".
//     Serving recent articles is correct; Google News ignores entries older than
//     2 days when deciding what to surface in results.
//
// Submit in Google Search Console → Sitemaps → Add:
//   https://transilvaniatimes.com/sitemap-news.xml

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/src/integrations/supabase/types'

export const revalidate = 300 // 5 minutes — stays fresh for breaking news

const SITE_URL         = 'https://transilvaniatimes.com'
const PUBLICATION_NAME = 'Transilvania Times'
const PUBLICATION_LANG = 'ro'

function esc(text: string): string {
  return text
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;')
}

function toIso(iso: string | null): string {
  if (!iso) return new Date().toISOString()
  try { return new Date(iso).toISOString() } catch { return new Date().toISOString() }
}

// Sanitize pipe-delimited compound categories ("STIRI|POLITICA") and tag arrays
// into clean comma-separated keywords for <news:keywords>
function sanitizeKeywords(tags: string[] | null, category: string | null): string {
  const CAT_LABELS: Record<string, string> = {
    news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
    business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
    education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
  }
  if (tags && tags.length > 0) {
    return tags.slice(0, 5).join(', ')
  }
  if (category) {
    return category
      .split('|')
      .map(c => CAT_LABELS[c.toLowerCase().trim()] ?? c.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(', ')
  }
  return ''
}

export async function GET() {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Fetch the 200 most recent published articles — no date cutoff.
  // Google News reads <news:publication_date> to determine recency.
  // A hard cutoff here produces an empty sitemap on low-frequency publishing
  // days, which causes the Google Search Console "Missing XML tag: url" error.
  const { data: posts, error } = await supabase
    .from('blog_posts')
    .select('slug, title_ro, category, tags_ro, published_at')
    .eq('status', 'published')
    .not('slug',     'is', null)
    .not('title_ro', 'is', null)
    .order('published_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[sitemap-news.xml] Supabase error:', error.message)
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  const urls = (posts ?? []).map(post => {
    const loc      = `${SITE_URL}/blog/${post.slug}`
    const title    = esc(post.title_ro || '')
    const pubDate  = toIso(post.published_at)
    const keywords = sanitizeKeywords(post.tags_ro, post.category)

    return `  <url>
    <loc>${loc}</loc>
    <news:news>
      <news:publication>
        <news:name>${esc(PUBLICATION_NAME)}</news:name>
        <news:language>${PUBLICATION_LANG}</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${title}</news:title>
      ${keywords ? `<news:keywords>${esc(keywords)}</news:keywords>` : ''}
    </news:news>
  </url>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type':  'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
