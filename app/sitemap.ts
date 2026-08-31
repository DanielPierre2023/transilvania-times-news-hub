// app/sitemap.ts
//
// v3 (June 8, 2026): Full bilingual SEO coverage.
//
// Includes:
//   • Homepage (RO + EN at /en/)
//   • Static pages with both language variants where applicable
//   • All 14 county pages
//   • All 10 category pages
//   • All author pages from authors table
//   • All published articles with BOTH RO (/blog/{slug}/) and EN
//     (/en/blog/{slug}/) URLs, paired via hreflang language annotations
//   • Image extensions for Google Images indexing
//
// All URLs use trailing slash to match next.config.ts trailingSlash: true
// and avoid "Page with redirect" reports in Google Search Console.

import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { COUNTIES } from '@/lib/counties'

export const revalidate = 3600

const BASE_URL = 'https://transilvaniatimes.com'

const CATEGORIES = [
  'news', 'politics', 'technology', 'business', 'culture',
  'travel', 'education', 'sports', 'health', 'opinion',
]

const STATIC_PAGES = [
  { path: '/',                            priority: 1.0, freq: 'hourly'  as const },
  { path: '/en/',                         priority: 0.9, freq: 'hourly'  as const },
  { path: '/despre/',                     priority: 0.6, freq: 'monthly' as const },
  { path: '/zboruri/',                    priority: 0.8, freq: 'hourly'  as const },
  { path: '/en/zboruri/',                 priority: 0.7, freq: 'hourly'  as const },
  { path: '/zboruri/cluj/',               priority: 0.7, freq: 'hourly'  as const },
  { path: '/zboruri/targu-mures/',        priority: 0.7, freq: 'hourly'  as const },
  { path: '/zboruri/sibiu/',              priority: 0.7, freq: 'hourly'  as const },
  { path: '/zboruri/companii/',           priority: 0.6, freq: 'daily'   as const },
  { path: '/en/zboruri/cluj/',            priority: 0.6, freq: 'hourly'  as const },
  { path: '/en/zboruri/targu-mures/',     priority: 0.6, freq: 'hourly'  as const },
  { path: '/en/zboruri/sibiu/',           priority: 0.6, freq: 'hourly'  as const },
  { path: '/en/zboruri/companii/',        priority: 0.5, freq: 'daily'   as const },
  { path: '/buletin/',                    priority: 0.8, freq: 'daily'   as const },
  { path: '/standarde-editoriale/',       priority: 0.5, freq: 'monthly' as const },
  { path: '/contact/',                    priority: 0.5, freq: 'yearly'  as const },
  { path: '/cautare/',                    priority: 0.4, freq: 'monthly' as const },
  { path: '/politica-confidentialitate/', priority: 0.3, freq: 'yearly'  as const },
  { path: '/termeni-si-conditii/',        priority: 0.3, freq: 'yearly'  as const },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  // ── Static pages are computed FIRST and unconditionally ─────────────────
  // This route is prerendered. createClient() throws synchronously when an env
  // var is missing ("supabaseUrl is required"), and an unguarded throw in a
  // prerendered route fails the ENTIRE Netlify build — which is exactly what
  // happened on 31 Aug 2026. A missing env var must cost us the dynamic URLs,
  // never the deploy and never the whole sitemap.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  let supabase: ReturnType<typeof createClient<Database>> | null = null
  if (url && key) {
    try {
      supabase = createClient<Database>(url, key)
    } catch (e) {
      console.warn('[sitemap] Supabase client unavailable:', (e as Error).message)
    }
  } else {
    console.warn('[sitemap] Supabase env vars missing — static URLs only')
  }

  // ── Static pages ────────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = STATIC_PAGES.map(p => ({
    url: `${BASE_URL}${p.path}`,
    lastModified: now,
    changeFrequency: p.freq,
    priority: p.priority,
  }))

  // Add hreflang annotation pairing RO homepage ⟷ EN homepage
  staticPages[0].alternates = {
    languages: {
      ro: `${BASE_URL}/`,
      en: `${BASE_URL}/en/`,
      'x-default': `${BASE_URL}/`,
    },
  }
  staticPages[1].alternates = {
    languages: {
      ro: `${BASE_URL}/`,
      en: `${BASE_URL}/en/`,
      'x-default': `${BASE_URL}/`,
    },
  }

  // ── Category pages ──────────────────────────────────────────────────────
  const categoryPages: MetadataRoute.Sitemap = CATEGORIES.map(cat => ({
    url: `${BASE_URL}/categorie/${cat}/`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }))

  // ── County pages ────────────────────────────────────────────────────────
  const countyPages: MetadataRoute.Sitemap = COUNTIES.map(county => ({
    url: `${BASE_URL}/judet/${county.slug}/`,
    lastModified: now,
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }))

  // ── Author pages ────────────────────────────────────────────────────────
  // Every dynamic query is wrapped: supabase-js returns {data, error} for a
  // failed request, but a DNS or TLS failure can still throw, and a throw in a
  // prerendered route fails the build. The sitemap degrades to fewer URLs; it
  // never takes the deploy with it.
  const authors = await (async () => {
    if (!supabase) return null
    try {
      const { data } = await supabase.from('authors').select('slug').not('slug', 'is', null)
      return data
    } catch (e) { console.warn('[sitemap] authors skipped:', (e as Error).message); return null }
  })()

  const authorPages: MetadataRoute.Sitemap = (authors ?? []).map(a => ({
    url: `${BASE_URL}/autor/${a.slug}/`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  // ── Article pages — RO version (canonical) ─────────────────────────────
  const posts = await (async () => {
    if (!supabase) return null
    try {
      const { data } = await supabase
        .from('blog_posts')
        .select('slug, updated_at, cover_image, content_en')
        .eq('status', 'published')
        .not('slug', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1000)
      return data
    } catch (e) { console.warn('[sitemap] articles skipped:', (e as Error).message); return null }
  })()

  const articlesRo: MetadataRoute.Sitemap = (posts ?? []).map(post => ({
    url: `${BASE_URL}/blog/${post.slug}/`,
    lastModified: new Date(post.updated_at),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
    images: post.cover_image ? [post.cover_image] : undefined,
    // hreflang pairing — only add EN alternate if article has EN content
    alternates: post.content_en ? {
      languages: {
        ro:          `${BASE_URL}/blog/${post.slug}/`,
        en:          `${BASE_URL}/en/blog/${post.slug}/`,
        'x-default': `${BASE_URL}/blog/${post.slug}/`,
      },
    } : undefined,
  }))

  // ── Article pages — EN version (only for articles with EN content) ─────
  const articlesEn: MetadataRoute.Sitemap = (posts ?? [])
    .filter(post => Boolean(post.content_en))
    .map(post => ({
      url: `${BASE_URL}/en/blog/${post.slug}/`,
      lastModified: new Date(post.updated_at),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
      images: post.cover_image ? [post.cover_image] : undefined,
      alternates: {
        languages: {
          ro:          `${BASE_URL}/blog/${post.slug}/`,
          en:          `${BASE_URL}/en/blog/${post.slug}/`,
          'x-default': `${BASE_URL}/blog/${post.slug}/`,
        },
      },
    }))

  // ── Video bulletins ─────────────────────────────────────────────────────
  // ADDED 31 Aug 2026. Bulletins were only ever listed in sitemap-news.xml,
  // which is a strict 48-HOUR window: after two days a bulletin page appeared
  // in no sitemap at all and was reachable only from the /buletin index.
  //
  // That threw away the asset. A bulletin page carries VideoObject +
  // NewsArticle schema and is long-tail by nature — an edition covering Cluj
  // or Turda keeps earning video impressions for months. The news sitemap gets
  // it INDEXED FAST; this one keeps it indexed.
  //
  // changeFrequency is 'monthly', not 'daily': a published bulletin does not
  // change, and claiming otherwise wastes crawl budget on 200 unchanged pages.
  //
  // The generated Database type predates newsroom_bulletins, so this uses an
  // untyped handle — the same approach as app/sitemap-news.xml/route.ts.
  let bulletinPages: MetadataRoute.Sitemap = []
  if (supabase) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bulletins } = await (supabase as any)
        .from('newsroom_bulletins')
        .select('slug, published_at, poster_url')
        .eq('status', 'published')
        .not('published_at', 'is', null)
        .not('slug', 'is', null)
        .order('published_at', { ascending: false })
        .limit(500)

      bulletinPages = ((bulletins ?? []) as Array<{
        slug: string; published_at: string; poster_url: string | null
      }>).map(b => ({
        url: `${BASE_URL}/buletin/${b.slug}/`,
        lastModified: new Date(b.published_at),
        changeFrequency: 'monthly' as const,
        priority: 0.7,
        images: b.poster_url ? [b.poster_url] : undefined,
      }))
    } catch (e) {
      // Never let the bulletin query take the sitemap — or the build — down.
      console.warn('[sitemap] bulletins skipped:', (e as Error).message)
    }
  }

  return [
    ...staticPages,
    ...categoryPages,
    ...countyPages,
    ...authorPages,
    ...bulletinPages,
    ...articlesRo,
    ...articlesEn,
  ]
}
