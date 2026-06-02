// app/components/RelatedArticles.tsx
import Link from 'next/link'
import Image from 'next/image'

interface Article {
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
}

interface Props {
  articles: Article[]
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

function formatDate(iso: string | null, locale: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function RelatedArticles({ articles, locale = 'ro' }: Props) {
  if (!articles || articles.length === 0) return null

  const heading = locale === 'ro' ? 'Citește și' : 'Read also'

  return (
    <section className="mt-12 pt-8 border-t border-gray-200">
      <h2 className="text-2xl font-bold text-[#0D1B4B] mb-6 font-serif">{heading}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {articles.map((article) => {
          const title =
            locale === 'ro'
              ? article.title_ro || article.title_en
              : article.title_en || article.title_ro
          const excerpt =
            locale === 'ro'
              ? article.excerpt_ro || article.excerpt_en
              : article.excerpt_en || article.excerpt_ro
          if (!title) return null
          const countyLabel = article.county
            ? COUNTY_LABELS[article.county] ?? article.county
            : null

          return (
            <Link
              key={article.id}
              href={`/blog/${article.slug}`}
              className="group block bg-white rounded-lg overflow-hidden border border-gray-200 hover:border-[#C41E3A] hover:shadow-md transition-all no-underline"
            >
              {article.cover_image && (
                <div className="relative aspect-[16/9] bg-gray-100 overflow-hidden">
                  <Image
                    src={article.cover_image}
                    alt={title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}
              <div className="p-4">
                {countyLabel && (
                  <div className="text-xs uppercase tracking-wider text-[#C41E3A] font-semibold mb-2">
                    {countyLabel}
                  </div>
                )}
                <h3 className="text-base font-semibold text-[#0D1B4B] group-hover:text-[#C41E3A] leading-snug mb-2 line-clamp-3 font-serif">
                  {title}
                </h3>
                {excerpt && (
                  <p className="text-sm text-gray-600 line-clamp-2 mb-3">{excerpt}</p>
                )}
                <div className="text-xs text-gray-500">
                  {formatDate(article.published_at, locale)}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
