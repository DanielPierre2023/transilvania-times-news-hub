// app/components/InlineRelatedBlock.tsx
import Link from 'next/link'

export interface InlineRelatedItem {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
  cover_image: string | null
}

interface Props {
  articles: InlineRelatedItem[]
  lang?: 'ro' | 'en'
}

export default function InlineRelatedBlock({ articles, lang = 'ro' }: Props) {
  if (!articles || articles.length === 0) return null

  return (
    <div className="my-10 not-prose">
      {/* Top hairline */}
      <div className="h-px bg-foreground/15 mb-5" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {articles.slice(0, 2).map((article) => {
          const title = lang === 'ro'
            ? (article.title_ro || article.title_en)
            : (article.title_en || article.title_ro)
          if (!title) return null
          const href = `/blog/${article.slug}/${lang === 'en' ? '?lang=en' : ''}`

          return (
            <Link
              key={article.id}
              href={href}
              className="flex gap-3 group no-underline items-start"
            >
              {article.cover_image && (
                <div className="w-28 h-20 sm:w-32 sm:h-24 shrink-0 overflow-hidden bg-foreground/[0.05]">
                  <img
                    src={article.cover_image}
                    alt=""
                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                  />
                </div>
              )}
              <h4 className="flex-1 font-serif text-[15px] font-bold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-4">
                {title}
              </h4>
            </Link>
          )
        })}
      </div>

      {/* Bottom hairline */}
      <div className="h-px bg-foreground/15 mt-5" />
    </div>
  )
}
