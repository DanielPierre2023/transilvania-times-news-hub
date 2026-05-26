// app/sitemap.ts
//
// B7: Added missing static editorial pages (editorial, legal, author profiles).
// The Google News sitemap lives at /sitemap-news.xml — submit it separately
// in Google Search Console. Standard XML sitemap does not support <news:>
// namespace; the two sitemaps serve distinct purposes.

import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/src/integrations/supabase/types'

export const revalidate = 3600 // 1 hour

const BASE_URL = 'https://transilvaniatimes.com'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ── Articles ─────────────────────────────────────────────────────────────
  const { data: posts } = await supabase
    .from('blog_posts')
    .select('slug, updated_at')
    .eq('status', 'published')
    .not('slug', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1000)

  // ── Author profiles ───────────────────────────────────────────────────────
  const { data: authors } = await supabase
    .from('authors')
    .select('slug, updated_at')
    .not('slug', 'is', null)

  // ── Static pages ──────────────────────────────────────────────────────────
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/en`,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.9,
    },
    // Category hubs
    ...['news','politics','technology','business','culture','travel','education','sports','health','opinion'].map(cat => ({
      url: `${BASE_URL}/categorie/${cat}`,
      lastModified: new Date(),
      changeFrequency: 'hourly' as const,
      priority: 0.8,
    })),
    // Editorial pages (added in Batch A)
    {
      url: `${BASE_URL}/despre`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/standarde-editoriale`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
    // Legal
    {
      url: `${BASE_URL}/politica-confidentialitate`,
      lastModified: new Date(),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/termeni-si-conditii`,
      lastModified: new Date(),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/contact`,
      lastModified: new Date(),
      changeFrequency: 'yearly' as const,
      priority: 0.4,
    },
  ]

  // ── Author profile pages ──────────────────────────────────────────────────
  const authorPages: MetadataRoute.Sitemap = (authors ?? []).map(author => ({
    url: `${BASE_URL}/autor/${author.slug}`,
    lastModified: author.updated_at ? new Date(author.updated_at) : new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))

  // ── Article pages (RO canonical only — EN served via ?lang=en) ───────────
  const articlePages: MetadataRoute.Sitemap = (posts ?? []).map(post => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(post.updated_at),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  return [...staticPages, ...authorPages, ...articlePages]
}
