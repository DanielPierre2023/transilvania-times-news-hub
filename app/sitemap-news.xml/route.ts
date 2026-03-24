import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SITE_URL = 'https://transilvaniatimes.com'
const PUBLICATION_NAME = 'Transilvania Times'
const PUBLICATION_LANGUAGE = 'ro'

export const revalidate = 3600 // regenerate every hour

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Google News sitemap: only articles from the last 48 hours
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: posts } = await supabase
    .from('blog_posts')
    .select('slug, title_ro, title_en, published_at, category')
    .eq('status', 'published')
    .gte('published_at', cutoff)
    .order('published_at', { ascending: false })
    .limit(1000)

  const articles = (posts ?? []).map(post => {
    const title = (post.title_ro || post.title_en || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const pubDate = post.published_at
      ? new Date(post.published_at).toISOString()
      : new Date().toISOString()

    return `  <url>
    <loc>${SITE_URL}/blog/${post.slug}</loc>
    <news:news>
      <news:publication>
        <news:name>${PUBLICATION_NAME}</news:name>
        <news:language>${PUBLICATION_LANGUAGE}</news:language>
      </news:publication>
      <news:publication_date>${pubDate}</news:publication_date>
      <news:title>${title}</news:title>
    </news:news>
    <lastmod>${pubDate}</lastmod>
  </url>`
  }).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
>
${articles}
</urlset>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
