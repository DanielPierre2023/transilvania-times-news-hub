// lib/related-articles.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RelatedArticle {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  county: string | null
  cover_image: string | null
  published_at: string | null
  category: string | null
  tags_ro: string[] | null
}

const FIELDS =
  'id, slug, title_ro, title_en, excerpt_ro, excerpt_en, county, cover_image, published_at, category, tags_ro'

/**
 * Fetch related articles by (county match) OR (tag overlap), scored and deduped.
 *
 * Scoring:
 *   county match     = +3
 *   each tag overlap = +1
 *   tiebreak         = newest published_at
 *
 * Fallback when matches are thin: most recent published articles.
 */
export async function getRelatedArticles(
  supabase: SupabaseClient,
  currentPostId: string,
  county: string | null,
  tagsRo: string[] | null,
  limit = 6,
): Promise<RelatedArticle[]> {
  const countyQuery = county
    ? supabase
        .from('blog_posts')
        .select(FIELDS)
        .eq('status', 'published')
        .eq('county', county)
        .neq('id', currentPostId)
        .order('published_at', { ascending: false })
        .limit(limit * 2)
    : Promise.resolve({ data: [] as RelatedArticle[] })

  const tagsQuery =
    tagsRo && tagsRo.length > 0
      ? supabase
          .from('blog_posts')
          .select(FIELDS)
          .eq('status', 'published')
          .overlaps('tags_ro', tagsRo)
          .neq('id', currentPostId)
          .order('published_at', { ascending: false })
          .limit(limit * 2)
      : Promise.resolve({ data: [] as RelatedArticle[] })

  const [countyResp, tagsResp] = await Promise.all([countyQuery, tagsQuery])
  const fromCounty = ((countyResp as { data: RelatedArticle[] | null }).data ?? []) as RelatedArticle[]
  const fromTags = ((tagsResp as { data: RelatedArticle[] | null }).data ?? []) as RelatedArticle[]

  const seen = new Set<string>()
  const currentTagSet = new Set(tagsRo ?? [])
  const scored: { article: RelatedArticle; score: number }[] = []

  for (const a of [...fromCounty, ...fromTags]) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    let score = 0
    if (county && a.county === county) score += 3
    if (a.tags_ro) {
      for (const t of a.tags_ro) if (currentTagSet.has(t)) score += 1
    }
    scored.push({ article: a, score })
  }

  if (scored.length < limit) {
    const { data: recent } = await supabase
      .from('blog_posts')
      .select(FIELDS)
      .eq('status', 'published')
      .neq('id', currentPostId)
      .order('published_at', { ascending: false })
      .limit(limit * 2)

    for (const a of (recent ?? []) as RelatedArticle[]) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      scored.push({ article: a, score: 0 })
      if (scored.length >= limit * 2) break
    }
  }

  scored.sort(
    (x, y) =>
      y.score - x.score ||
      new Date(y.article.published_at ?? 0).getTime() -
        new Date(x.article.published_at ?? 0).getTime(),
  )

  return scored.slice(0, limit).map((s) => s.article)
}
