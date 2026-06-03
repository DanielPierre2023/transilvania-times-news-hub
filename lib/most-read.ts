// lib/most-read.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MostReadArticle {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
  category: string | null
  published_at: string | null
  cover_image: string | null
  view_count: number | null
}

/**
 * Most-read sidebar feed. Ordered by view_count DESC, tiebreak by recency.
 */
export async function getMostRead(
  supabase: SupabaseClient,
  currentPostId: string,
  limit = 6,
): Promise<MostReadArticle[]> {
  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, county, category, published_at, cover_image, view_count')
    .eq('status', 'published')
    .neq('id', currentPostId)
    .order('view_count', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as MostReadArticle[]
}
