import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
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

  const heroMain = posts[0] ?? null
  const heroRight = posts[1] ?? null
  const secondary1 = posts[2] ?? null
  const secondary2 = posts[3] ?? null
  const gridPosts = posts.slice(4, 8)
  const leftColPosts = posts.slice(8, 14)
  const centerColPosts = posts.slice(14, 19)
  const rightColPosts = posts.slice(19, 22)
  const restPosts = posts.slice(22)

  function getTitle(p: Post) {
    return p.title_ro || p.title_en || ''
  }

  const heroBullets = heroRight?.summary_ro
    ? heroRight.summary_ro.split('\n').filter(Boolean).slice(0, 3)
    : []

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-10">

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
                <ArticleCard
                  slug={heroMain.slug}
                  category={heroMain.category}
                  subcategory={heroMain.subcategory}
                  title={getTitle(heroMain)}
                  image={null}
                  excerpt={heroMain.excerpt_ro}
                  timeAgo={timeAgo(heroMain.published_at)}
                  variant="hero"
                />
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
                excerpt={heroRight.excerpt_ro}
                timeAgo={timeAgo(heroRight.published_at)}
                variant="grid"
              />
              {heroBullets.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {heroBullets.map((bullet, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[13px] font-sans text-foreground/80"
                    >
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
              subcategory={secondary1.subcategory}
              title={getTitle(secondary1)}
              image={secondary1.cover_image}
              excerpt={secondary1.excerpt_ro}
              timeAgo={timeAgo(secondary1.published_at)}
              variant="grid"
            />
          )}
          {secondary2 && (
            <ArticleCard
              slug={secondary2.slug}
              category={secondary2.category}
              subcategory={secondary2.subcategory}
              title={getTitle(secondary2)}
              image={secondary2.cover_image}
              excerpt={secondary2.excerpt_ro}
              timeAgo={timeAgo(secondary2.published_at)}
              variant="grid"
            />
          )}
        </section>
      )}

      {gridPosts.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6 border-b border-foreground/10 pb-10">
          {gridPosts.map((post) => (
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

      {(leftColPosts.length > 0 || centerColPosts.length > 0 || rightColPosts.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-foreground/10 pb-10">
          <div className="space-y-0 divide-y divide-foreground/10">
            {leftColPosts.map((post) => (
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
            {centerColPosts.map((post) => (
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
            {rightColPosts.map((post) => (
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
          {restPosts.map((post) => (
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
