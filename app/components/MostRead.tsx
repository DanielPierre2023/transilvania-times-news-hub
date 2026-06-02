import Link from 'next/link'
import { getCounty } from '@/lib/counties'

interface MostReadArticle {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
  category: string | null
  published_at: string | null
}

interface Props {
  articles: MostReadArticle[]
  locale?: 'ro' | 'en'
}

export default function MostRead({ articles, locale = 'ro' }: Props) {
  if (!articles || articles.length === 0) return null

  const heading = locale === 'ro' ? 'Cele mai citite' : 'Most read'

  return (
    <aside className="sticky top-6">
      <div className="border border-foreground/10 bg-foreground/[0.01]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-foreground/10">
          <div className="w-2 h-2 bg-brand-red" />
          <h3 className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
            {heading}
          </h3>
        </div>
        <ol className="divide-y divide-foreground/[0.06]">
          {articles.map((article, idx) => {
            const title = locale === 'ro'
              ? (article.title_ro || article.title_en)
              : (article.title_en || article.title_ro)
            if (!title) return null
            const countyData = article.county ? getCounty(article.county) : null

            return (
              <li key={article.id} className="px-4 py-3 hover:bg-foreground/[0.02] transition-colors">
                <Link
                  href={`/blog/${article.slug}${locale === 'en' ? '?lang=en' : ''}`}
                  className="flex gap-3 group no-underline"
                >
                  <span className="font-serif text-2xl font-bold text-brand-red/30 group-hover:text-brand-red shrink-0 leading-none w-7">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    {countyData && (
                      <div className="font-sans text-[9px] uppercase tracking-[0.15em] text-brand-red font-bold mb-1">
                        {countyData.label}
                      </div>
                    )}
                    <h4 className="font-serif text-[13px] font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-3">
                      {title}
                    </h4>
                  </div>
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </aside>
  )
}
