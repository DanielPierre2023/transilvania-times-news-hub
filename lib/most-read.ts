import type { SupabaseClient } from '@supabase/supabase-js'

export interface MostReadArticle {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
  category: string | null
  published_at: string | null
}

/**
 * Most-read sidebar feed.
 *
 * Currently uses "most recent published" as a proxy for popularity, since
 * the platform doesn't yet track view counts. When view tracking is added,
 * change the order clause to `order('view_count', { ascending: false })`.
 */
export async function getMostRead(
  supabase: SupabaseClient,
  currentPostId: string,
  limit = 6,
): Promise<MostReadArticle[]> {
  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, county, category, published_at')
    .eq('status', 'published')
    .neq('id', currentPostId)
    .order('published_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as MostReadArticle[]
}
