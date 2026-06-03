// app/components/MostRead.tsx
import Link from 'next/link'
import SectionHeader from './SectionHeader'
import { getCounty } from '@/lib/counties'

interface MostReadArticle {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
  category: string | null
  published_at: string | null
  cover_image: string | null
  view_count?: number | null
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
      <SectionHeader className="pb-3 border-b border-foreground/15">
        {heading}
      </SectionHeader>
      <ol className="divide-y divide-foreground/[0.08]">
        {articles.map((article) => {
          const title = locale === 'ro'
            ? (article.title_ro || article.title_en)
            : (article.title_en || article.title_ro)
          if (!title) return null
          const countyData = article.county ? getCounty(article.county) : null

          return (
            <li key={article.id}>
              <Link
                href={`/blog/${article.slug}${locale === 'en' ? '?lang=en' : ''}`}
                className="flex gap-3 group py-4 no-underline items-start"
              >
                <div className="flex-1 min-w-0">
                  {countyData && (
                    <div className="font-sans font-bold text-[10px] uppercase tracking-[0.15em] text-brand-red mb-1.5">
                      {countyData.label}
                    </div>
                  )}
                  <h4 className="font-serif text-[14px] font-bold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-3">
                    {title}
                  </h4>
                </div>
                {article.cover_image && (
                  <div className="w-20 h-20 shrink-0 overflow-hidden bg-foreground/[0.05]">
                    <img
                      src={article.cover_image}
                      alt=""
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                    />
                  </div>
                )}
              </Link>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
