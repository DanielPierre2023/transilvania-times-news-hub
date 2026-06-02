// app/components/EnhancedArticleContent.tsx
import GoogleNewsBadge from './GoogleNewsBadge'
import InlineRelated from './InlineRelated'

interface InlineArticle {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
  category: string | null
}

interface Props {
  content: string | null
  inlineRelated?: InlineArticle[]
  locale?: 'ro' | 'en'
  showGoogleBadge?: boolean
}

/**
 * Split article content into paragraphs.
 * Accepts either \n\n-separated plain text OR pre-wrapped <p>...</p> HTML
 * (the pipeline output format depends on the source / sanitize path).
 */
function splitParagraphs(content: string): string[] {
  if (!content) return []
  const t = content.trim()
  if (/<p[\s>]/i.test(t)) {
    const matches = t.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []
    return matches.map((m) => m.replace(/<p[^>]*>|<\/p>/gi, '').trim()).filter(Boolean)
  }
  return t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
}

export default function EnhancedArticleContent({
  content,
  inlineRelated = [],
  locale = 'ro',
  showGoogleBadge = true,
}: Props) {
  if (!content) return null
  const paragraphs = splitParagraphs(content)
  if (paragraphs.length === 0) return null

  // Inline injection positions: 1/3 and 2/3 through the article.
  // Inject only if the article is long enough AND we have related articles.
  const inlinePositions: number[] = []
  if (inlineRelated.length >= 1 && paragraphs.length >= 6) {
    inlinePositions.push(Math.floor(paragraphs.length / 3))
  }
  if (inlineRelated.length >= 2 && paragraphs.length >= 10) {
    inlinePositions.push(Math.floor((paragraphs.length * 2) / 3))
  }

  // Mid-content GoogleNewsBadge: just after the first inline card if any,
  // otherwise around halfway. Skipped if showGoogleBadge=false.
  const midBadgePosition = showGoogleBadge
    ? inlinePositions[0] != null
      ? inlinePositions[0] + 1
      : Math.floor(paragraphs.length / 2)
    : -1

  return (
    <div className="article-content">
      {showGoogleBadge && <GoogleNewsBadge locale={locale} variant="top" />}

      {paragraphs.map((para, idx) => {
        const inlineIdx = inlinePositions.indexOf(idx)
        const article = inlineIdx >= 0 ? inlineRelated[inlineIdx] : null
        return (
          <div key={idx}>
            {article && <InlineRelated article={article} locale={locale} />}
            {idx === midBadgePosition && (
              <GoogleNewsBadge locale={locale} variant="inline" />
            )}
            <p
              className="my-4 leading-relaxed text-gray-800 text-lg"
              dangerouslySetInnerHTML={{ __html: para }}
            />
          </div>
        )
      })}
    </div>
  )
}
