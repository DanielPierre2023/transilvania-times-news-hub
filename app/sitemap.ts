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
import type { Database } from '@/src/integrations/supabase/types'
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
  { path: '/standarde-editoriale/',       priority: 0.5, freq: 'monthly' as const },
  { path: '/contact/',                    priority: 0.5, freq: 'yearly'  as const },
  { path: '/cautare/',                    priority: 0.4, freq: 'monthly' as const },
  { path: '/politica-confidentialitate/', priority: 0.3, freq: 'yearly'  as const },
  { path: '/termeni-si-conditii/',        priority: 0.3, freq: 'yearly'  as const },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const now = new Date()

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
  const { data: authors } = await supabase
    .from('authors')
    .select('slug')
    .not('slug', 'is', null)

  const authorPages: MetadataRoute.Sitemap = (authors ?? []).map(a => ({
    url: `${BASE_URL}/autor/${a.slug}/`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  // ── Article pages — RO version (canonical) ─────────────────────────────
  const { data: posts } = await supabase
    .from('blog_posts')
    .select('slug, updated_at, cover_image, content_en')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1000)

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

  return [
    ...staticPages,
    ...categoryPages,
    ...countyPages,
    ...authorPages,
    ...articlesRo,
    ...articlesEn,
  ]
}
