import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { enUS } from 'date-fns/locale'
import Link from 'next/link'
import ArticleCard from '../components/ArticleCard'
import type { Metadata } from 'next'

export const revalidate = 0

export const metadata: Metadata = {
  title: 'Transilvania Times — News from the Heart of Transylvania',
  description: 'Latest news from Cluj, Transylvania and Romania — in English.',
  alternates: {
    canonical: 'https://transilvaniatimes.com/en',
    languages: {
      ro: 'https://transilvaniatimes.com',
      en: 'https://transilvaniatimes.com/en',
    },
  },
}

const CAT_LABELS_EN: Record<string, string> = {
  news: 'News', politics: 'Politics', technology: 'Technology',
  business: 'Business', culture: 'Culture', travel: 'Travel',
  education: 'Education', sports: 'Sports', health: 'Health', opinion: 'Opinion',
}

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

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  try { return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: enUS }) }
  catch { return '' }
}

export default async function HomePageEN() {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, category, subcategory, cover_image, excerpt_ro, excerpt_en, summary_ro, summary_en, author_name, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50)

  if (error) console.error('[HomePageEN]', error.message)
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

  function getTitle(p: Post)   { return p.title_en   || p.title_ro   || '' }
  function getExcerpt(p: Post) { return p.excerpt_en  || p.excerpt_ro  || '' }

  const heroBullets = heroRight
    ? (heroRight.summary_en || heroRight.summary_ro || '').split('\n').filter(Boolean).slice(0, 3)
    : []

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-10">

      <div className="flex items-center gap-2 text-[11px] font-sans text-muted-foreground border-b border-foreground/10 pb-4">
        <span>Reading in</span>
        <span className="font-bold text-foreground">English</span>
        <span>·</span>
        <Link href="/" className="text-brand-red hover:underline">
          Switch to Romanian →
        </Link>
      </div>

      {(heroMain || heroRight) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-foreground/10">

          {heroMain && (
            <div className="md:col-span-2 border-r border-foreground/10">
              {heroMain.cover_image && (
                <img
                  src={heroMain.cover_image}
                  alt={getTitle(heroMain)}
                  className="w-full max-h-[480px] object-cover"
                />
              )}
              <div className="p-5 md:p-7">
                {heroMain.category && (
                  <Link
                    href={`/categorie/${heroMain.category}`}
                    className="text-[11px] font-sans font-bold text-brand-red uppercase tracking-widest hover:underline"
                  >
                    {CAT_LABELS_EN[heroMain.category] || heroMain.category}
                  </Link>
                )}
                <Link href={`/blog/${heroMain.slug}`}>
                  <h2 className="font-serif text-2xl md:text-4xl font-bold text-foreground leading-tight mt-2 hover:text-brand-red transition-colors">
                    {getTitle(heroMain)}
                  </h2>
                </Link>
                {getExcerpt(heroMain) && (
                  <p className="font-sans text-sm text-muted-foreground mt-2 line-clamp-2">
                    {getExcerpt(heroMain)}
                  </p>
                )}
                <p className="text-[11px] font-sans text-muted-foreground mt-2">
                  {timeAgo(heroMain.published_at)}
                </p>
              </div>
            </div>
          )}

          {heroRight && (
            <div className="p-5">
              <ArticleCard
                slug={heroRight.slug}
                category={heroRight.category}
                title={getTitle(heroRight)}
                image={heroRight.cover_image}
                excerpt={getExcerpt(heroRight)}
                timeAgo={timeAgo(heroRight.published_at)}
                variant="grid"
              />
              {heroBullets.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {heroBullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] font-sans text-foreground/80">
                      <span className="w-1.5 h-1.5 bg-brand-red rounded-full mt-1.5 shrink-0" />
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {(secondary1 || secondary2) && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 border-b border-foreground/10 pb-10">
          {secondary1 && (
            <ArticleCard
              slug={secondary1.slug}
              category={secondary1.category}
              title={getTitle(secondary1)}
              image={secondary1.cover_image}
              excerpt={getExcerpt(secondary1)}
              timeAgo={timeAgo(secondary1.published_at)}
              variant="grid"
            />
          )}
          {secondary2 && (
            <ArticleCard
              slug={secondary2.slug}
              category={secondary2.category}
              title={getTitle(secondary2)}
              image={secondary2.cover_image}
              excerpt={getExcerpt(secondary2)}
              timeAgo={timeAgo(secondary2.published_at)}
              variant="grid"
            />
          )}
        </section>
      )}

      {gridPosts.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6 border-b border-foreground/10 pb-10">
          {gridPosts.map(post => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              title={getTitle(post)}
              image={post.cover_image}
              excerpt={getExcerpt(post)}
              timeAgo={timeAgo(post.published_at)}
              variant="grid"
            />
          ))}
        </section>
      )}

      {(leftColPosts.length > 0 || centerColPosts.length > 0 || rightColPosts.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-foreground/10 pb-10">
          <div className="space-y-0 divide-y divide-foreground/10">
            {leftColPosts.map(post => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                image={post.cover_image}
                timeAgo={timeAgo(post.published_at)}
                variant="simple"
              />
            ))}
          </div>
          <div className="space-y-0 divide-y divide-foreground/10 border-x border-foreground/10 px-6">
            {centerColPosts.map(post => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                image={post.cover_image}
                timeAgo={timeAgo(post.published_at)}
                variant="compact"
              />
            ))}
          </div>
          <div className="space-y-0 divide-y divide-foreground/10">
            {rightColPosts.map(post => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                image={post.cover_image}
                timeAgo={timeAgo(post.published_at)}
                variant="compact"
              />
            ))}
          </div>
        </section>
      )}

      {restPosts.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {restPosts.map(post => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              title={getTitle(post)}
              image={post.cover_image}
              timeAgo={timeAgo(post.published_at)}
              variant="grid"
            />
          ))}
        </section>
      )}

    </div>
  )
}