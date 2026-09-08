// lib/categories.ts
//
// Canonical list of editorial categories and their RO/EN labels.
// Introduced with the Administrație / Infrastructură expansion (Sep 2026).
//
// This is the single source of truth for the category taxonomy. New code should
// import from here rather than re-declaring a local map. Several view components
// still carry inline label maps for now (blog, en/blog, ArticleCard, homepage,
// category page, RSS, buletin, autor, despre) — migrating those to this module
// is a tracked follow-up; until then, keep this list and those maps in sync.

export const CATEGORY_SLUGS = [
  'news', 'politics', 'administration', 'infrastructure', 'technology',
  'business', 'culture', 'travel', 'education', 'sports', 'health', 'opinion',
] as const

export type CategorySlug = (typeof CATEGORY_SLUGS)[number]

export const CAT_LABELS_RO: Record<string, string> = {
  news: 'Știri', politics: 'Politică', administration: 'Administrație',
  infrastructure: 'Infrastructură', technology: 'Tehnologie', business: 'Afaceri',
  culture: 'Cultură', travel: 'Călătorii', education: 'Educație', sports: 'Sport',
  health: 'Sănătate', opinion: 'Opinie',
}

export const CAT_LABELS_EN: Record<string, string> = {
  news: 'News', politics: 'Politics', administration: 'Administration',
  infrastructure: 'Infrastructure', technology: 'Technology', business: 'Business',
  culture: 'Culture', travel: 'Travel', education: 'Education', sports: 'Sports',
  health: 'Health', opinion: 'Opinion',
}

// label || slug fallback mirrors the `CAT_LABELS[x] || x` pattern used site-wide,
// so an unknown/legacy slug degrades to its raw value instead of blank.
export function getCategoryLabel(slug: string | null | undefined, lang: 'ro' | 'en' = 'ro'): string {
  if (!slug) return ''
  const map = lang === 'en' ? CAT_LABELS_EN : CAT_LABELS_RO
  return map[slug] || slug
}
