import Link from 'next/link'

interface ArticleCardProps {
  slug: string
  category: string | null
  subcategory?: string | null
  title: string
  timeAgo?: string
  image?: string | null
  excerpt?: string | null
  author?: string | null
  variant?: 'hero' | 'grid' | 'simple' | 'compact'
  className?: string
  lang?: 'ro' | 'en'
}

const CAT_LABELS_RO: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

const CAT_LABELS_EN: Record<string, string> = {
  news: 'News', politics: 'Politics', technology: 'Technology',
  business: 'Business', culture: 'Culture', travel: 'Travel',
  education: 'Education', sports: 'Sports', health: 'Health', opinion: 'Opinion',
}

const SUBCAT_LABELS: Record<string, string> = {
  regional: 'Regional', national: 'Național', international: 'Internațional',
}

export default function ArticleCard({
  slug, category, subcategory, title, timeAgo, image, excerpt,
  variant = 'grid', className = '', lang = 'ro',
}: ArticleCardProps) {
  const labels = lang === 'en' ? CAT_LABELS_EN : CAT_LABELS_RO
  const catLabel = (category ? labels[category] || category : '').toUpperCase()
  const subcatLabel = subcategory ? SUBCAT_LABELS[subcategory] || subcategory : null
  const href = `/blog/${slug}`

  if (variant === 'hero') {
    return (
      <div className={`group ${className}`}>
        {image && (
          <Link href={href}>
            <div className="overflow-hidden mb-3">
              <img
                src={image}
                alt={title}
                className="w-full h-full object-cover grayscale transition-all duration-700 group-hover:grayscale-0 group-hover:scale-[1.02] aspect-[4/3]"
              />
            </div>
          </Link>
        )}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest">
              <span className="w-2 h-2 bg-brand-red inline-block" />
              {catLabel}
            </span>
            {subcatLabel && (
              <span className="text-[10px] font-sans text-muted-foreground uppercase tracking-widest">
                · {subcatLabel}
              </span>
            )}
          </div>
          <Link href={href}>
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-tight group-hover:text-brand-red transition-colors mb-3">
              {title}
            </h2>
          </Link>
          {excerpt && (
            <p className="font-sans text-sm text-muted-foreground leading-relaxed line-clamp-3">
              {excerpt}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (variant === 'simple') {
    return (
      <div className={`group flex gap-3 py-3 border-b border-foreground/10 last:border-0 ${className}`}>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest mb-1">
            {catLabel}
          </div>
          <Link href={href}>
            <h3 className="font-serif text-base font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-2">
              {title}
            </h3>
          </Link>
          {timeAgo && (
            <p className="text-[11px] font-sans text-muted-foreground mt-1">{timeAgo}</p>
          )}
        </div>
        {image && (
          <Link href={href} className="shrink-0">
            <img
              src={image}
              alt={title}
              className="w-20 h-16 object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
            />
          </Link>
        )}
      </div>
    )
  }

  if (variant === 'compact') {
    return (
      <div className={`group py-2.5 border-b border-foreground/10 last:border-0 ${className}`}>
        <div className="text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest mb-1">
          {catLabel}
        </div>
        <Link href={href}>
          <h3 className="font-serif text-sm font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-2">
            {title}
          </h3>
        </Link>
        {timeAgo && (
          <p className="text-[11px] font-sans text-muted-foreground mt-1">{timeAgo}</p>
        )}
      </div>
    )
  }

  // Default: grid variant
  return (
    <div className={`group ${className}`}>
      {image && (
        <Link href={href} className="block overflow-hidden mb-3 relative">
          <img
            src={image}
            alt={title}
            className="w-full object-cover grayscale transition-all duration-700 group-hover:grayscale-0 group-hover:scale-[1.02] aspect-[4/3]"
          />
          {category && (
            <span className="absolute bottom-2 left-2 bg-brand-red text-white text-[10px] font-sans font-bold uppercase tracking-wider px-2 py-0.5">
              {catLabel}
            </span>
          )}
        </Link>
      )}
      <div>
        {!image && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest">
              <span className="w-2 h-2 bg-brand-red inline-block mr-1.5" />{catLabel}
            </span>
            {subcatLabel && (
              <span className="text-[10px] font-sans text-muted-foreground uppercase tracking-widest">
                · {subcatLabel}
              </span>
            )}
          </div>
        )}
        <Link href={href}>
          <h3 className="font-serif text-lg font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-3">
            {title}
          </h3>
        </Link>
        {timeAgo && (
          <p className="text-[11px] font-sans text-muted-foreground mt-2">{timeAgo}</p>
        )}
        {excerpt && (
          <p className="text-[13px] font-sans text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
            {excerpt}
          </p>
        )}
      </div>
    </div>
  )
}
