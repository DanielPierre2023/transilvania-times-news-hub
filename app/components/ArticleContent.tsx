'use client'

import { useState } from 'react'

interface ArticleContentProps {
  titleRo: string | null
  titleEn: string | null
  summaryRo: string | null
  summaryEn: string | null
  contentRo: string | null
  contentEn: string | null
  coverImage: string | null
  authorName: string | null
  publishedAt: string | null
  timeAgoStr: string
  defaultLang: 'ro' | 'en'
}

function fmtDate(dateStr: string | null, lang: 'ro' | 'en'): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch { return '' }
}

function renderContent(raw: string | null): string {
  if (!raw) return ''
  // If already HTML (has tags), use as-is
  if (raw.includes('<p>') || raw.includes('<br') || raw.includes('<h2') || raw.includes('<h3')) {
    return raw
  }
  // Plain text: split on double newlines → <p> tags
  return raw
    .split(/\n\n+/)
    .filter(p => p.trim().length > 0)
    .map(p => `<p>${p.trim().replace(/\n/g, ' ')}</p>`)
    .join('\n')
}

export default function ArticleContent({
  titleRo, titleEn, summaryRo, summaryEn,
  contentRo, contentEn, coverImage,
  authorName, publishedAt, timeAgoStr, defaultLang,
}: ArticleContentProps) {
  const [lang, setLang] = useState<'ro' | 'en'>(defaultLang)

  const hasEn = !!(titleEn && contentEn)

  const title   = lang === 'en' && titleEn   ? titleEn   : (titleRo   || titleEn   || '')
  const summary = lang === 'en' && summaryEn ? summaryEn : (summaryRo || summaryEn || '')
  const body    = lang === 'en' && contentEn ? contentEn : (contentRo || contentEn || '')

  return (
    <div>
      {/* Language toggle — only shown if English version exists */}
      {hasEn && (
        <div className="flex items-center gap-1 mb-5">
          <button
            onClick={() => setLang('ro')}
            className={
              'text-[11px] font-sans font-bold uppercase tracking-wider px-3 py-1 transition-colors ' +
              (lang === 'ro'
                ? 'bg-brand-red text-white'
                : 'text-muted-foreground hover:text-brand-red border border-foreground/20')
            }
          >
            RO
          </button>
          <button
            onClick={() => setLang('en')}
            className={
              'text-[11px] font-sans font-bold uppercase tracking-wider px-3 py-1 transition-colors ' +
              (lang === 'en'
                ? 'bg-brand-red text-white'
                : 'text-muted-foreground hover:text-brand-red border border-foreground/20')
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
      <div className="flex flex-wrap items-center gap-4 text-[11px] font-sans text-muted-foreground mb-6">
        {authorName && (
          <span className="font-bold text-foreground">{authorName}</span>
        )}
        {publishedAt && (
          <span>{fmtDate(publishedAt, lang)}</span>
        )}
        {timeAgoStr && (
          <span className="text-brand-red">{timeAgoStr}</span>
        )}
      </div>

      {/* Summary / excerpt — shown prominently before cover image */}
      {summary && (
        <p className="font-sans text-base text-muted-foreground leading-relaxed mb-6 border-l-4 border-brand-red pl-4 italic">
          {summary}
        </p>
      )}

      {/* Cover image — correct position: after title/meta/summary, before body */}
      {coverImage && (
        <div className="mb-8 -mx-6">
          <img
            src={coverImage}
            alt={title}
            className="w-full max-h-[520px] object-cover"
          />
        </div>
      )}

      {/* Article body — justified text matching original */}
      {body && (
        <div
          className={[
            'prose prose-lg prose-neutral max-w-none font-sans',
            'prose-headings:font-serif prose-headings:font-bold prose-headings:text-foreground',
            'prose-p:text-foreground/85 prose-p:leading-relaxed prose-p:mb-4 [&_p]:text-justify',
            'prose-a:text-brand-red prose-a:no-underline hover:prose-a:underline',
            'prose-strong:text-foreground prose-strong:font-bold',
            'prose-blockquote:border-l-brand-red prose-blockquote:font-serif prose-blockquote:text-muted-foreground',
            'prose-img:rounded-none prose-img:w-full',
          ].join(' ')}
          dangerouslySetInnerHTML={{ __html: renderContent(body) }}
        />
      )}
    </div>
  )
}
