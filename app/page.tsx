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
  image: string | null
  excerpt_ro: string | null
  summary_ro: string | null
  author: string | null
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
    .select('id, slug, title_ro, title_en, category, subcategory, image, excerpt_ro, summary_ro, author, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(50)

  if (error) console.error('[HomePage]', error.message)
  const posts = (data ?? []) as Post[]

  // Layout slices matching the original Index.tsx
  const heroMain        = posts[0] ?? null
  const heroRight       = posts[1] ?? null
  const secondary1      = posts[2] ?? null
  const secondary2      = posts[3] ?? null
  const gridPosts       = posts.slice(4, 8)
  const leftColPosts    = posts.slice(8, 14)
  const centerColPosts  = posts.slice(14, 19)
  const rightColPosts   = posts.slice(19, 22)
  const restPosts       = posts.slice(22)

  function getTitle(p: Post) { return p.title_ro || p.title_en || '' }

  // Parse summary bullets for the hero right article
  const heroBullets = heroRight?.summary_ro
    ? heroRight.summary_ro.split('\n').filter(Boolean).slice(0, 3)
    : []

  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 space-y-10">

      {/* ── HERO ROW ── */}
      {(heroMain || heroRight) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-0 border border-foreground/10">
          {/* Hero main — left 2/3 */}
          {heroMain && (
            <div className="md:col-span-2 border-r border-foreground/10">
              <ArticleCard
                slug={heroMain.slug}
                category={heroMain.category}
                subcategory={heroMain.subcategory}
                title={getTitle(heroMain)}
                image={heroMain.image}
                excerpt={heroMain.excerpt_ro}
                variant="hero"
                className="p-0 [&>div:first-child]:mb-0 [&_img]:aspect-auto [&_img]:max-h-[480px] [&_img]:w-full"
              />
              <div className="p-5 md:p-7">
                <ArticleCard
                  slug={heroMain.slug}
                  category={heroMain.category}
                  subcategory={heroMain.subcategory}
                  title={getTitle(heroMain)}
                  excerpt={heroMain.excerpt_ro}
                  variant="hero"
                  image={null}
                  className="[&_h2]:text-2xl md:[&_h2]:text-4xl"
                />
              </div>
            </div>
          )}

          {/* Hero right — 1/3 */}
          {heroRight && (
            <div className="p-5">
              <ArticleCard
                slug={heroRight.slug}
                category={heroRight.category}
                subcategory={heroRight.subcategory}
                title={getTitle(heroRight)}
                image={heroRight.image}
                variant="grid"
                image={null}
                className="mb-4"
              />
              {heroBullets.length > 0 && (
                <ul className="space-y-2 mt-3">
                  {heroBullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] font-sans text-muted-foreground">
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
              variant="grid"
              image={null}
            />
          )}
          {secondary2 && (
            <ArticleCard
              slug={secondary2.slug}
              category={secondary2.category}
              subcategory={secondary2.subcategory}
              title={getTitle(secondary2)}
              timeAgo={timeAgo(secondary2.published_at)}
              image={secondary2.image}
              variant="grid"
            />
          )}
        </section>
      )}

      {/* ── 4-COL GRID ── */}
      {gridPosts.length > 0 && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-5 border-b border-foreground/10 pb-8">
          {gridPosts.map(post => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              subcategory={post.subcategory}
              title={getTitle(post)}
              timeAgo={timeAgo(post.published_at)}
              image={post.image}
              variant="grid"
            />
          ))}
        </section>
      )}

      {/* ── EDITORIAL 3-COL ── */}
      {(leftColPosts.length > 0 || centerColPosts.length > 0 || rightColPosts.length > 0) && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8 border-b border-foreground/10 pb-8">
          <div className="space-y-0">
            {leftColPosts.map(post => (
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
            {centerColPosts.map(post => (
              <ArticleCard
                key={post.id}
                slug={post.slug}
                category={post.category}
                title={getTitle(post)}
                timeAgo={timeAgo(post.published_at)}
                image={post.image}
                variant="simple"
              />
            ))}
          </div>
          <div className="space-y-0">
            {rightColPosts.map(post => (
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

      {/* ── REMAINING POSTS ── */}
      {restPosts.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {restPosts.slice(0, 9).map(post => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              title={getTitle(post)}
              timeAgo={timeAgo(post.published_at)}
              image={post.image}
              variant="grid"
            />
          ))}
        </section>
      )}
    </div>
  )
}
