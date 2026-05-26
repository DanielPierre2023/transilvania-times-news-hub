'use client'

import Link from 'next/link'

export interface AuthorData {
  slug: string
  name_ro: string
  name_en: string
  title_ro: string
  title_en: string
  bio_ro: string
  bio_en: string
  avatar_url: string | null
  avatar_style: string | null
}

interface AuthorBylineProps {
  author: AuthorData | null
  authorName: string | null   // fallback when no author record
  timeAgoStr: string
  lang: 'ro' | 'en'
}

export default function AuthorByline({ author, authorName, timeAgoStr, lang }: AuthorBylineProps) {
  const displayName = author
    ? (lang === 'ro' ? author.name_ro : author.name_en)
    : (authorName || 'Transilvania Times')

  const displayTitle = author
    ? (lang === 'ro' ? author.title_ro : author.title_en)
    : null

  const initial = displayName.charAt(0).toUpperCase()

  const content = (
    <div className="flex items-center gap-3">
      {/* Avatar — illustrated or fallback initial */}
      {author?.avatar_url ? (
        <div className="w-8 h-8 border border-foreground/10 overflow-hidden">
          <img
            src={author.avatar_url}
            alt={displayName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className="w-8 h-8 bg-brand-red/10 border border-brand-red/20 flex items-center justify-center">
          <span className="font-serif text-brand-red text-sm font-bold">
            {initial}
          </span>
        </div>
      )}

      {/* Name + title + time */}
      <div>
        <p className="font-sans text-[12px] font-bold text-foreground">
          {displayName}
        </p>
        {displayTitle && (
          <p className="font-sans text-[10px] text-muted-foreground/70 leading-tight">
            {displayTitle}
          </p>
        )}
        {timeAgoStr && (
          <p className="font-sans text-[11px] text-muted-foreground">{timeAgoStr}</p>
        )}
      </div>
    </div>
  )

  // If we have an author profile, wrap in link to author page
  if (author?.slug) {
    return (
      <Link href={`/autor/${author.slug}`} className="group hover:opacity-80 transition-opacity">
        {content}
      </Link>
    )
  }

  return content
}
