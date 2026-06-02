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
  view_count: number | null
}

/**
 * Most-read sidebar feed. Ordered by view_count DESC, tiebreak by recency.
 *
 * For new posts with zero views, recency takes over naturally because of
 * the tiebreak — so the sidebar never goes empty as new content rolls in.
 */
export async function getMostRead(
  supabase: SupabaseClient,
  currentPostId: string,
  limit = 6,
): Promise<MostReadArticle[]> {
  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, county, category, published_at, view_count')
    .eq('status', 'published')
    .neq('id', currentPostId)
    .order('view_count', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as MostReadArticle[]
}
