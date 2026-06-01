// lib/counties.ts
//
// Single source of truth for the 14 county slugs used across the site.
// blog_posts.county and rss_sources.county both store these slug values.

export interface County {
  slug: string         // canonical database value, used in URLs
  label: string        // Romanian display name with diacritics
  shortLabel?: string  // optional shorter form for tight spaces
  isTransylvania: boolean
}

export const COUNTIES: County[] = [
  { slug: 'alba',            label: 'Alba',             isTransylvania: true },
  { slug: 'bihor',           label: 'Bihor',            isTransylvania: true },
  { slug: 'bistrita-nasaud', label: 'Bistrița-Năsăud',  shortLabel: 'Bistrița', isTransylvania: true },
  { slug: 'brasov',          label: 'Brașov',           isTransylvania: true },
  { slug: 'cluj',            label: 'Cluj',             isTransylvania: true },
  { slug: 'covasna',         label: 'Covasna',          isTransylvania: true },
  { slug: 'harghita',        label: 'Harghita',         isTransylvania: true },
  { slug: 'hunedoara',       label: 'Hunedoara',        isTransylvania: true },
  { slug: 'maramures',       label: 'Maramureș',        isTransylvania: true },
  { slug: 'mures',           label: 'Mureș',            isTransylvania: true },
  { slug: 'salaj',           label: 'Sălaj',            isTransylvania: true },
  { slug: 'satu-mare',       label: 'Satu Mare',        isTransylvania: true },
  { slug: 'sibiu',           label: 'Sibiu',            isTransylvania: true },
  { slug: 'national',        label: 'Național',         isTransylvania: false },
]

const SLUG_TO_COUNTY: Record<string, County> = Object.fromEntries(
  COUNTIES.map(c => [c.slug, c])
)

export function getCounty(slug: string | null | undefined): County | null {
  if (!slug) return null
  return SLUG_TO_COUNTY[slug] || null
}

export function getCountyLabel(slug: string | null | undefined): string {
  return getCounty(slug)?.label || ''
}

export function getCountyShortLabel(slug: string | null | undefined): string {
  const c = getCounty(slug)
  return c?.shortLabel || c?.label || ''
}

export function isValidCounty(slug: string | null | undefined): slug is string {
  return !!slug && slug in SLUG_TO_COUNTY
}

export const TRANSYLVANIA_COUNTIES = COUNTIES.filter(c => c.isTransylvania)
