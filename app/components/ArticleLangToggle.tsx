'use client'

import { useState } from 'react'

interface ArticleLangToggleProps {
  titleRo: string | null
  titleEn: string | null
  contentRo: string | null
  contentEn: string | null
  articleUrl: string
  articleTitle: string
  articleExcerpt: string
  authorName: string | null
  publishedAt: string | null
  timeAgoStr: string
}

export default function ArticleLangToggle({
  titleRo, titleEn, contentRo, contentEn,
  authorName, publishedAt, timeAgoStr,
}: ArticleLangToggleProps) {
  const [lang, setLang] = useState<'ro' | 'en'>('ro')

  const hasEn = !!(titleEn && contentEn)
  const title = lang === 'en' && titleEn ? titleEn : (titleRo || titleEn || '')
  const content = lang === 'en' && contentEn ? contentEn : (contentRo || contentEn || '')

  function fmtDate(dateStr: string | null): string {
    if (!dateStr) return ''
    try {
      return new Date(dateStr).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    } catch { return '' }
  }

  return (
    <div>
      {/* Language switcher — only show if EN version exists */}
      {hasEn && (
        <div className="flex items-center gap-1 mb-5">
          <button
            onClick={() => setLang('ro')}
            className={'text-[11px] font-sans font-bold uppercase tracking-wider px-3 py-1 transition-colors ' +
              (lang === 'ro'
                ? 'bg-brand-red text-white'
                : 'text-muted-foreground hover:text-brand-red border border-foreground/20'
              )
            }
          >
            RO
          </button>
          <button
            onClick={() => setLang('en')}
            className={'text-[11px] font-sans font-bold uppercase tracking-wider px-3 py-1 transition-colors ' +
              (lang === 'en'
                ? 'bg-brand-red text-white'
                : 'text-muted-foreground hover:text-brand-red border border-foreground/20'
              )
            }
          >
            EN
          </button>
        </div>
      )}

      {/* Title */}
      <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold leading-tight tracking-tight text-foreground mb-5">
        {title}
      </h1>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-sans text-muted-foreground mb-8">
        {authorName && (
          <span className="font-bold text-foreground">{authorName}</span>
        )}
        {publishedAt && (
          <span>{fmtDate(publishedAt)}</span>
        )}
        {timeAgoStr && (
          <span className="text-brand-red">{timeAgoStr}</span>
        )}
      </div>

      {/* Article body */}
      {content && (
        <div
          className="prose prose-lg prose-neutral max-w-none font-sans
            prose-headings:font-serif prose-headings:font-bold prose-headings:text-foreground
            prose-p:text-foreground/85 prose-p:leading-relaxed
            prose-a:text-brand-red prose-a:no-underline hover:prose-a:underline
            prose-strong:text-foreground prose-strong:font-bold
            prose-blockquote:border-l-brand-red prose-blockquote:font-serif prose-blockquote:text-muted-foreground
            prose-img:rounded-none"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      )}
    </div>
  )
}
