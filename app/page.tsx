import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, format, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import Link from 'next/link'
import ArticleCard from './components/ArticleCard'
import SponsorBanner from './components/SponsorBanner'

export const revalidate = 0

interface Post {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  category: string | null
  subcategory: string | null
  cover_image: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  summary_ro: string | null
  summary_en: string | null
  author_name: string | null
  published_at: string | null
}

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

function getLabel(cat: string | null) {
  if (!cat) return ''
  return (CAT_LABELS[cat] || cat).toUpperCase()
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  try { return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: ro }) }
  catch { return '' }
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try { return format(parseISO(dateStr), 'dd MMM yyyy') }
  catch { return '' }
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, category, subcategory, cover_image, excerpt_ro, excerpt_en, summary_ro, summary_en, author_name, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50)

  if (error) console.error('[HomePage]', error.message)
  const posts = ((data ?? []) as unknown as Post[])

  const heroMain        = posts[0]  ?? null
  const heroRight       = posts[1]  ?? null
  const secondaryText   = posts[2]  ?? null
  const secondaryImage  = posts[3]  ?? null
  const gridArticles    = posts.slice(4, 8)
  const editorialLeft   = posts.slice(8, 14)
  const editorialCenter = posts.slice(14, 19)
  const editorialRight  = posts.slice(19, 22)
  const restPosts       = posts.slice(22)

  function getTitle(p: Post) { return p.title_ro || p.title_en || '' }
  function getExcerpt(p: Post) { return p.excerpt_ro || p.excerpt_en || '' }
  function getSummary(p: Post) { return p.summary_ro || p.summary_en || '' }

  const heroBullets: string[] = (() => {
    if (!heroMain) return []
    const summary = getSummary(heroMain)
    if (!summary) return []
    return summary
      .split(/(?:\n|(?<=\.)\s)/)
      .filter((l: string) => l.trim().length > 10)
      .slice(0, 4)
  })()

  const categoryGroups: [string, Post[]][] = (() => {
    const groups: Record<string, Post[]> = {}
    restPosts.forEach(post => {
      const cat = post.category || 'news'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(post)
    })
    return Object.entries(groups)
  })()

  return (
    <div className="max-w-7xl mx-auto border-x border-foreground/10">

      {/* ═══ SECTION 1: 3-ZONE EDITORIAL SPREAD ═══ */}
      {heroMain ? (
        <section className="grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10">

          {/* LEFT — Large grayscale image (4 cols) */}
          <div className="lg:col-span-4 lg:border-r border-foreground/10">
            <Link href={'/blog/' + heroMain.slug} className="block group h-full">
              <div className="relative overflow-hidden h-full min-h-[300px] lg:min-h-full">
                {heroMain.cover_image && (
                  <img
                    src={heroMain.cover_image}
                    alt={getTitle(heroMain)}
                    className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                  />
                )}
              </div>
            </Link>
          </div>

          {/* CENTER — Category + Title + Bullet Summaries (4 cols) */}
          <div className="lg:col-span-4 p-6 lg:p-8 lg:border-r border-foreground/10 flex flex-col justify-center">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-brand-red" />
              <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                {getLabel(heroMain.category)}
                {heroMain.subcategory && (
                  <span className="text-muted-foreground ml-1.5">· {heroMain.subcategory}</span>
                )}
              </span>
            </div>
            <Link href={'/blog/' + heroMain.slug}>
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-serif font-bold leading-[1.05] tracking-tight mb-6 text-foreground hover:text-brand-red transition-colors">
                {getTitle(heroMain)}
              </h1>
            </Link>
            {heroBullets.length > 0 ? (
              <ul className="flex flex-col">
                {heroBullets.map((bullet, i) => (
                  <li key={i} className="py-3 border-b border-dotted border-foreground/15 last:border-0 text-sm font-sans text-muted-foreground leading-relaxed flex items-start gap-2">
                    <span className="text-brand-red mt-1 shrink-0">•</span>
                    <span>{bullet.trim()}</span>
                  </li>
                ))}
              </ul>
            ) : getExcerpt(heroMain) ? (
              <p className="text-muted-foreground font-sans text-sm leading-relaxed">{getExcerpt(heroMain)}</p>
            ) : null}
          </div>

          {/* RIGHT — heroRight: image + category + title (4 cols) */}
          <div className="lg:col-span-4 flex flex-col">
            {heroRight ? (
              <Link href={'/blog/' + heroRight.slug} className="group flex flex-col h-full">
                <div className="relative overflow-hidden flex-1 min-h-[250px]">
                  {heroRight.cover_image && (
                    <img
                      src={heroRight.cover_image}
                      alt={getTitle(heroRight)}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                  )}
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-2 h-2 bg-brand-red" />
                    <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                      {getLabel(heroRight.category)}
                      {heroRight.subcategory && (
                        <span className="text-muted-foreground ml-1.5">· {heroRight.subcategory}</span>
                      )}
                    </span>
                  </div>
                  <h2 className="font-serif font-bold text-xl leading-tight text-foreground group-hover:text-brand-red transition-colors">
                    {getTitle(heroRight)}
                  </h2>
                </div>
              </Link>
            ) : (
              <div className="p-6 flex items-center justify-center text-muted-foreground italic font-serif">—</div>
            )}
          </div>
        </section>
      ) : (
        <div className="p-6 text-center text-muted-foreground font-serif italic text-xl py-20">
          Nu există articole publicate.
        </div>
      )}

      {/* ═══ SECTION 2: SECONDARY SPREAD (text | image | promo) ═══ */}
      {(secondaryText || secondaryImage) && (
        <section className="grid grid-cols-1 lg:grid-cols-3 border-b border-foreground/10">

          {/* Col 1 — Thumbnail + text article */}
          <div className="p-6 lg:border-r border-foreground/10 flex flex-col">
            {secondaryText && (
              <Link href={'/blog/' + secondaryText.slug} className="group">
                {secondaryText.cover_image && (
                  <div className="relative overflow-hidden mb-4 aspect-[4/3] max-h-[180px]">
                    <img
                      src={secondaryText.cover_image}
                      alt={getTitle(secondaryText)}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                    <div className="absolute bottom-0 left-0 bg-brand-red text-white px-2 py-1 text-[9px] font-sans font-bold uppercase tracking-widest">
                      {getLabel(secondaryText.category)}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-brand-red" />
                  <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                    {getLabel(secondaryText.category)}
                    {secondaryText.subcategory && (
                      <span className="text-muted-foreground ml-1.5">· {secondaryText.subcategory}</span>
                    )}
                  </span>
                </div>
                <h3 className="font-serif font-bold text-2xl leading-tight text-foreground mb-3 group-hover:text-brand-red transition-colors">
                  {getTitle(secondaryText)}
                </h3>
                {secondaryText.published_at && (
                  <span className="text-[10px] font-sans font-bold text-muted-foreground uppercase tracking-widest">
                    {fmtDate(secondaryText.published_at)}
                  </span>
                )}
                {getExcerpt(secondaryText) && (
                  <p className="mt-3 text-muted-foreground font-sans text-sm leading-relaxed line-clamp-3">
                    {getExcerpt(secondaryText)}
                  </p>
                )}
              </Link>
            )}
          </div>

          {/* Col 2 — Large grayscale image + title below */}
          <div className="lg:border-r border-foreground/10 flex flex-col">
            {secondaryImage ? (
              <Link href={'/blog/' + secondaryImage.slug} className="block group flex-1 flex flex-col">
                <div className="relative overflow-hidden flex-1 min-h-[280px]">
                  {secondaryImage.cover_image && (
                    <img
                      src={secondaryImage.cover_image}
                      alt={getTitle(secondaryImage)}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                  )}
                  <div className="absolute bottom-0 left-0 bg-brand-red text-white px-2 py-1 text-[9px] font-sans font-bold uppercase tracking-widest">
                    {getLabel(secondaryImage.category)}
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 bg-brand-red" />
                    <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                      {getLabel(secondaryImage.category)}
                      {secondaryImage.subcategory && (
                        <span className="text-muted-foreground ml-1.5">· {secondaryImage.subcategory}</span>
                      )}
                    </span>
                  </div>
                  <h3 className="font-serif font-bold text-xl leading-tight text-foreground group-hover:text-brand-red transition-colors mb-2">
                    {getTitle(secondaryImage)}
                  </h3>
                  {secondaryImage.published_at && (
                    <span className="text-[10px] font-sans font-bold text-muted-foreground uppercase tracking-widest">
                      {fmtDate(secondaryImage.published_at)}
                    </span>
                  )}
                </div>
              </Link>
            ) : (
              <div className="min-h-[280px] bg-foreground/[0.03]" />
            )}
          </div>

          {/* Col 3 — Newsletter promo */}
          <div className="flex items-center justify-center p-6">
            <div className="bg-brand-red p-6 w-full text-center">
              <p className="text-[9px] font-sans font-bold uppercase tracking-[0.2em] text-white/60 mb-3">Buletin informativ</p>
              <p className="font-serif text-xl font-bold text-white mb-2">Fii primul informat</p>
              <p className="text-[12px] font-sans text-white/70 leading-relaxed">
                Știri exclusive din inima Transilvaniei, direct în inbox-ul tău.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ═══ 4-COLUMN ARTICLE GRID ═══ */}
      {gridArticles.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border-b border-foreground/10">
          {gridArticles.map((post, i) => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              subcategory={post.subcategory}
              title={getTitle(post)}
              timeAgo={post.published_at ? fmtDate(post.published_at) : undefined}
              image={post.cover_image}
              variant="grid"
              className={i < 3 ? 'lg:border-r border-foreground/10' : ''}
            />
          ))}
        </section>
      )}

      {/* ═══ 3-COLUMN EDITORIAL BLOCK ═══ */}
      <section className="grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10">

        {/* LEFT — 2-col grid of text snippets */}
        <div className="lg:col-span-4 lg:border-r border-foreground/10 p-6">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {editorialLeft.map(post => (
              <Link key={post.id} href={'/blog/' + post.slug} className="group">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-1.5 h-1.5 bg-brand-red" />
                  <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-brand-red">
                    {getLabel(post.category)}
                  </span>
                </div>
                <h4 className="font-serif font-bold text-sm leading-snug text-foreground group-hover:text-brand-red transition-colors line-clamp-3">
                  {getTitle(post)}
                </h4>
                <span className="text-[9px] font-sans text-muted-foreground mt-1 block">
                  {timeAgo(post.published_at)}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* CENTER — Horizontal mini-cards with thumbnails */}
        <div className="lg:col-span-4 lg:border-r border-foreground/10 p-6">
          <div className="flex flex-col">
            {editorialCenter.map((post, i) => (
              <Link
                key={post.id}
                href={'/blog/' + post.slug}
                className={'flex gap-4 py-4 group cursor-pointer' + (i < editorialCenter.length - 1 ? ' border-b border-dotted border-foreground/15' : '')}
              >
                <div className="w-[120px] shrink-0 aspect-[4/3] overflow-hidden">
                  {post.cover_image ? (
                    <img
                      src={post.cover_image}
                      alt={getTitle(post)}
                      className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                    />
                  ) : (
                    <div className="w-full h-full bg-foreground/10" />
                  )}
                </div>
                <div className="flex flex-col justify-center min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 bg-brand-red" />
                    <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-brand-red">
                      {getLabel(post.category)}
                    </span>
                  </div>
                  <h4 className="font-serif font-bold text-sm leading-snug text-foreground group-hover:text-brand-red transition-colors line-clamp-2">
                    {getTitle(post)}
                  </h4>
                  <span className="text-[9px] font-sans text-muted-foreground mt-1">
                    {timeAgo(post.published_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* RIGHT — Avatar + title list + sponsor banner */}
        <div className="lg:col-span-4 p-6 flex flex-col">
          <div className="flex flex-col flex-1">
            {editorialRight.map((post, i) => (
              <Link
                key={post.id}
                href={'/blog/' + post.slug}
                className={'flex items-start gap-3 py-3 group' + (i < editorialRight.length - 1 ? ' border-b border-foreground/10' : '')}
              >
                <div className="w-8 h-8 rounded-full bg-brand-red/10 shrink-0 flex items-center justify-center text-[10px] font-bold text-brand-red">
                  {(post.author_name || 'T')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h4 className="font-serif font-bold text-sm leading-snug text-foreground group-hover:text-brand-red transition-colors line-clamp-2">
                    {getTitle(post)}
                  </h4>
                  <span className="text-[9px] font-sans text-muted-foreground mt-0.5 block">
                    {timeAgo(post.published_at)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {/* Sponsor banner */}
          <div className="mt-4">
            <SponsorBanner />
          </div>
        </div>
      </section>

      {/* ═══ CATEGORY SECTIONS ═══ */}
      {categoryGroups.map(([cat, catPosts]) => (
        <section key={cat} className="border-b border-foreground/10">
          <div className="flex items-center gap-3 px-6 pt-8 pb-4">
            <div className="w-2 h-2 bg-brand-red" />
            <Link
              href={'/categorie/' + cat}
              className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red hover:underline"
            >
              {getLabel(cat)}
            </Link>
            <div className="flex-1 h-px bg-foreground/10" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 px-6 pb-6 gap-0">
            {catPosts.slice(0, 3).map((post, i) => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                subcategory={post.subcategory}
                title={getTitle(post)}
                timeAgo={post.published_at ? fmtDate(post.published_at) : undefined}
                image={post.cover_image}
                variant="simple"
                className={i < 2 ? 'lg:border-r border-foreground/10' : ''}
              />
            ))}
          </div>
        </section>
      ))}

      {/* ═══ VIEW ALL ═══ */}
      {posts.length > 0 && (
        <div className="py-10 text-center border-b border-foreground/10">
          <Link
            href="/categorie/news"
            className="inline-block font-sans text-sm font-semibold text-brand-red hover:underline uppercase tracking-widest"
          >
            Toate articolele →
          </Link>
        </div>
      )}
    </div>
  )
}
