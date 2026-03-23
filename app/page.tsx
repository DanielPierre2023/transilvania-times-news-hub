import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import Link from 'next/link'
import ArticleCard from './components/ArticleCard'

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
  summary_ro: string | null
  author_name: string | null
  published_at: string | null
}

const CAT_LABELS: Record<string, string> = {
  news: 'Stiri', politics: 'Politica', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultura', travel: 'Calatorii',
  education: 'Educatie', sports: 'Sport', health: 'Sanatate', opinion: 'Opinie',
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: ro })
  } catch {
    return ''
  }
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('blog_posts')
    .select(
      'id, slug, title_ro, title_en, category, subcategory, cover_image, excerpt_ro, summary_ro, author_name, published_at'
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50)

  if (error) console.error('[HomePage]', error.message)
  const posts = ((data ?? []) as unknown as Post[])

  const heroMain       = posts[0]  ?? null
  const heroRight      = posts[1]  ?? null
  const secondary1     = posts[2]  ?? null
  const secondary2     = posts[3]  ?? null
  const gridPosts      = posts.slice(4, 8)
  const leftColPosts   = posts.slice(8, 14)
  const centerColPosts = posts.slice(14, 19)
  const rightColPosts  = posts.slice(19, 22)
  const restPosts      = posts.slice(22)

  function getTitle(p: Post) { return p.title_ro || p.title_en || '' }

  const heroBullets = heroMain?.summary_ro
    ? heroMain.summary_ro.split(/(?<=[.!?])\s+|[\n]/).filter(l => l.trim().length > 10).slice(0, 4)
    : []

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-10">

      {/* ── SECTION 1: 3-ZONE EDITORIAL SPREAD ── */}
      {heroMain && (
        <section className="grid grid-cols-1 lg:grid-cols-12 border border-foreground/10">

          {/* LEFT – Large grayscale image (4 cols) */}
          {heroMain.cover_image && (
            <div className="lg:col-span-4 lg:border-r border-foreground/10">
              <Link href={'/blog/' + heroMain.slug} className="block h-full">
                <div className="relative overflow-hidden h-full min-h-[300px] lg:min-h-full">
                  <img
                    src={heroMain.cover_image}
                    alt={getTitle(heroMain)}
                    className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-700"
                  />
                </div>
              </Link>
            </div>
          )}

          {/* CENTER – Category + Title + Bullet Summaries (4 cols) */}
          <div className={'lg:p-8 p-5 lg:border-r border-foreground/10 flex flex-col justify-center ' + (heroMain.cover_image ? 'lg:col-span-4' : 'lg:col-span-8')}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-brand-red" />
              <Link
                href={'/categorie/' + (heroMain.category || 'news')}
                className="text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest hover:underline"
              >
                {CAT_LABELS[heroMain.category || ''] || heroMain.category || ''}
              </Link>
              {heroMain.subcategory && (
                <span className="text-[10px] font-sans text-muted-foreground uppercase tracking-widest">
                  · {heroMain.subcategory}
                </span>
              )}
            </div>
            <Link href={'/blog/' + heroMain.slug}>
              <h2 className="font-serif text-2xl md:text-3xl font-bold text-foreground leading-tight hover:text-brand-red transition-colors mb-4">
                {getTitle(heroMain)}
              </h2>
            </Link>
            {heroMain.excerpt_ro && (
              <p className="font-sans text-sm text-muted-foreground leading-relaxed mb-4 line-clamp-3">
                {heroMain.excerpt_ro}
              </p>
            )}
            {heroBullets.length > 0 && (
              <ul className="space-y-2 mt-2">
                {heroBullets.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] font-sans text-muted-foreground">
                    <span className="w-1.5 h-1.5 bg-brand-red rounded-full mt-1.5 shrink-0" />
                    {bullet}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] font-sans text-muted-foreground mt-4">
              {timeAgo(heroMain.published_at)}
            </p>
          </div>

          {/* RIGHT – heroRight article with image (4 cols) */}
          {heroRight && (
            <div className="lg:col-span-4 p-5 flex flex-col">
              <ArticleCard
                slug={heroRight.slug}
                category={heroRight.category}
                subcategory={heroRight.subcategory}
                title={getTitle(heroRight)}
                image={heroRight.cover_image}
                excerpt={heroRight.excerpt_ro}
                timeAgo={timeAgo(heroRight.published_at)}
                variant="grid"
              />
            </div>
          )}
        </section>
      )}

      {/* ── SECONDARY ROW ── */}
      {(secondary1 || secondary2) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-foreground/10 pb-8">
          {secondary1 && (
            <ArticleCard
              slug={secondary1.slug}
              category={secondary1.category}
              subcategory={secondary1.subcategory}
              title={getTitle(secondary1)}
              timeAgo={timeAgo(secondary1.published_at)}
              excerpt={secondary1.excerpt_ro}
              image={secondary1.cover_image}
              variant="grid"
            />
          )}
          {secondary2 && (
            <ArticleCard
              slug={secondary2.slug}
              category={secondary2.category}
              subcategory={secondary2.subcategory}
              title={getTitle(secondary2)}
              timeAgo={timeAgo(secondary2.published_at)}
              image={secondary2.cover_image}
              variant="grid"
            />
          )}
        </section>
      )}

      {/* ── 4-COL GRID ── */}
      {gridPosts.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-5 border-b border-foreground/10 pb-8">
          {gridPosts.map((post) => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              subcategory={post.subcategory}
              title={getTitle(post)}
              timeAgo={timeAgo(post.published_at)}
              image={post.cover_image}
              variant="grid"
            />
          ))}
        </section>
      )}

      {/* ── EDITORIAL 3-COL ── */}
      {(leftColPosts.length > 0 || centerColPosts.length > 0 || rightColPosts.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-foreground/10 pb-8">
          <div className="space-y-0">
            {leftColPosts.map((post) => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                timeAgo={timeAgo(post.published_at)}
                variant="compact"
              />
            ))}
          </div>
          <div className="space-y-0">
            {centerColPosts.map((post) => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                timeAgo={timeAgo(post.published_at)}
                image={post.cover_image}
                variant="simple"
              />
            ))}
          </div>
          <div className="space-y-0">
            {rightColPosts.map((post) => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                timeAgo={timeAgo(post.published_at)}
                variant="compact"
              />
            ))}
          </div>
        </section>
      )}

      {/* ── REST ── */}
      {restPosts.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {restPosts.slice(0, 9).map((post) => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              title={getTitle(post)}
              timeAgo={timeAgo(post.published_at)}
              image={post.cover_image}
              variant="grid"
            />
          ))}
        </section>
      )}
    </div>
  )
}
