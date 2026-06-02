// app/components/InlineRelated.tsx
import Link from 'next/link'

interface Props {
  article: {
    slug: string
    title_ro: string | null
    title_en: string | null
    county: string | null
    category: string | null
  }
  locale?: 'ro' | 'en'
}

const COUNTY_LABELS: Record<string, string> = {
  alba: 'Alba',
  bihor: 'Bihor',
  'bistrita-nasaud': 'Bistrița-Năsăud',
  brasov: 'Brașov',
  cluj: 'Cluj',
  covasna: 'Covasna',
  harghita: 'Harghita',
  hunedoara: 'Hunedoara',
  maramures: 'Maramureș',
  mures: 'Mureș',
  salaj: 'Sălaj',
  'satu-mare': 'Satu Mare',
  sibiu: 'Sibiu',
  national: 'România',
}

export default function InlineRelated({ article, locale = 'ro' }: Props) {
  const title =
    locale === 'ro'
      ? article.title_ro || article.title_en
      : article.title_en || article.title_ro
  if (!title) return null

  const label = locale === 'ro' ? 'Citește și' : 'Read also'
  const countyLabel = article.county ? COUNTY_LABELS[article.county] ?? article.county : null

  return (
    <aside className="my-8 border-l-4 border-[#C41E3A] bg-gray-50 px-5 py-4 not-prose">
      <div className="text-xs uppercase tracking-wider text-[#C41E3A] font-semibold mb-1">
        {label}
        {countyLabel ? ` · ${countyLabel}` : ''}
      </div>
      <Link
        href={`/blog/${article.slug}`}
        className="text-lg font-semibold text-[#0D1B4B] hover:text-[#C41E3A] leading-snug block no-underline"
      >
        {title}
      </Link>
    </aside>
  )
}
