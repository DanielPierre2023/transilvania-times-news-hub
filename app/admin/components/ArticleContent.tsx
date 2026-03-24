'use client'

import { useState } from 'react'
import { Camera, Bot } from 'lucide-react'

interface ArticleContentProps {
  titleRo: string | null
  titleEn: string | null
  summaryRo: string | null
  summaryEn: string | null
  contentRo: string | null
  contentEn: string | null
  coverImage: string | null
  coverImageCredit?: string | null
  authorName: string | null
  publishedAt: string | null
  timeAgoStr: string
  defaultLang: 'ro' | 'en'
}

export default function ArticleContent({
  titleRo,
  titleEn,
  summaryRo,
  summaryEn,
  contentRo,
  contentEn,
  coverImage,
  coverImageCredit,
  authorName,
  publishedAt,
  timeAgoStr,
  defaultLang,
}: ArticleContentProps) {
  const [lang, setLang] = useState<'ro' | 'en'>(defaultLang)

  const title   = lang === 'ro' ? (titleRo   || titleEn)   : (titleEn   || titleRo)
  const summary = lang === 'ro' ? (summaryRo || summaryEn) : (summaryEn || summaryRo)
  const content = lang === 'ro' ? (contentRo || contentEn) : (contentEn || contentRo)

  const hasBoth = (titleRo && titleEn) || (contentRo && contentEn)

  const isAiGenerated = coverImageCredit
    ? coverImageCredit.toLowerCase().includes('generat') ||
      coverImageCredit.toLowerCase().includes('artificial') ||
      coverImageCredit.toLowerCase().includes('ai')
    : false

  // Parse summary bullets
  const summaryLines = summary
    ? summary.split('\n').map(l => l.trim()).filter(Boolean)
    : []

  return (
    <div>
      {/* Language switcher */}
      {hasBoth && (
        <div className="flex gap-1 mb-6">
          <button
            onClick={() => setLang('ro')}
            className={`font-sans text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 border transition-colors ${
              lang === 'ro'
                ? 'bg-brand-red border-brand-red text-white'
                : 'border-foreground/20 text-muted-foreground hover:text-foreground'
            }`}
          >
            🇷🇴 Română
          </button>
          <button
            onClick={() => setLang('en')}
            className={`font-sans text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 border transition-colors ${
              lang === 'en'
                ? 'bg-brand-red border-brand-red text-white'
                : 'border-foreground/20 text-muted-foreground hover:text-foreground'
            }`}
          >
            🇬🇧 English
          </button>
        </div>
      )}

      {/* Title */}
      <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
        {title}
      </h1>

      {/* Summary bullets */}
      {summaryLines.length > 0 && (
        <div className="border-l-2 border-brand-red pl-4 mb-6 space-y-1">
          {summaryLines.map((line, i) => (
            <p key={i} className="font-sans text-sm text-muted-foreground leading-relaxed">
              {line.startsWith('•') || line.startsWith('-') || line.startsWith('·')
                ? line.substring(1).trim()
                : line}
            </p>
          ))}
        </div>
      )}

      {/* Author + date */}
      <div className="flex items-center gap-3 mb-8 pb-6 border-b border-foreground/10">
        <div className="w-8 h-8 bg-brand-red/10 border border-brand-red/20 flex items-center justify-center">
          <span className="font-serif text-brand-red text-sm font-bold">
            {authorName ? authorName.charAt(0).toUpperCase() : 'T'}
          </span>
        </div>
        <div>
          <p className="font-sans text-[12px] font-bold text-foreground">
            {authorName || 'Transilvania Times'}
          </p>
          {timeAgoStr && (
            <p className="font-sans text-[11px] text-muted-foreground">{timeAgoStr}</p>
          )}
        </div>
      </div>

      {/* Cover image */}
      {coverImage && (
        <div className="mb-8">
          <div className="overflow-hidden">
            <img
              src={coverImage}
              alt={title || ''}
              className="w-full aspect-video object-cover"
            />
          </div>

          {/* Image credit — shown below image if present */}
          {coverImageCredit && (
            <p className="font-sans text-[11px] text-muted-foreground/70 mt-2 flex items-center gap-1.5 italic">
              {isAiGenerated
                ? <Bot className="w-3 h-3 shrink-0 text-blue-400" />
                : <Camera className="w-3 h-3 shrink-0" />
              }
              {coverImageCredit}
            </p>
          )}
        </div>
      )}

      {/* Article body */}
      {content && (
        <div
          className="prose prose-lg max-w-none font-serif text-foreground
            prose-p:leading-relaxed prose-p:mb-5
            prose-headings:font-serif prose-headings:font-bold prose-headings:text-foreground
            prose-a:text-brand-red prose-a:no-underline hover:prose-a:underline
            prose-strong:font-bold prose-strong:text-foreground
            prose-blockquote:border-l-brand-red prose-blockquote:text-muted-foreground
            [&_p]:font-serif [&_p]:text-[17px] [&_p]:leading-[1.8] [&_p]:mb-5"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      )}
    </div>
  )
}
