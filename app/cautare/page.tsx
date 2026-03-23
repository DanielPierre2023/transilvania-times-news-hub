import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import ArticleCard from '@/app/components/ArticleCard'

// Never cache search results
export const revalidate = 0

interface Post {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  category: string | null
  subcategory: string | null
  excerpt_ro: string | null
  published_at: string | null
}

interface PageProps {
  searchParams: Promise<{ q?: string }>
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  return {
    title: q ? `Rezultate pentru "${q}" — Transilvania Times` : 'Căutare — Transilvania Times',
    robots: { index: false }, // don't index search result pages
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams
  const query = (q || '').trim()

  let posts: Post[] = []

  if (query.length >= 2) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('blog_posts')
      .select('id, slug, title_ro, title_en, cover_image, category, subcategory, excerpt_ro, published_at')
      .eq('status', 'published')
      .or(
        `title_ro.ilike.%${query}%,title_en.ilike.%${query}%,category.ilike.%${query}%,excerpt_ro.ilike.%${query}%`
      )
      .order('published_at', { ascending: false })
      .limit(24)

    if (error) console.error('[SearchPage]', error.message)
    posts = ((data ?? []) as unknown as Post[])
  }

  function timeAgo(d: string | null) {
    if (!d) return ''
    try { return formatDistanceToNow(parseISO(d), { addSuffix: true, locale: ro }) }
    catch { return '' }
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10">

      {/* Search header */}
      <div className="border-b-2 border-brand-red mb-8 pb-4">
        {query ? (
          <>
            <p className="text-[11px] font-sans font-bold uppercase tracking-widest text-muted-foreground mb-1">
              Rezultate căutare
            </p>
            <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground italic">
              &ldquo;{query}&rdquo;
            </h1>
            <p className="text-[12px] font-sans text-muted-foreground mt-2 uppercase tracking-widest">
              {posts.length} {posts.length === 1 ? 'articol găsit' : 'articole găsite'}
            </p>
          </>
        ) : (
          <h1 className="font-serif text-3xl font-bold text-foreground">
            Căutare
          </h1>
        )}
      </div>

      {/* Inline search form */}
      <form action="/cautare" method="GET" className="mb-10">
        <div className="flex items-center border-b-2 border-foreground/30 focus-within:border-brand-red transition-colors max-w-2xl">
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder="Caută articole..."
            autoFocus={!query}
            className="flex-1 bg-transparent font-sans text-lg text-foreground py-3 pr-4 outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            className="font-sans font-bold text-[12px] uppercase tracking-widest text-brand-red hover:text-espresso transition-colors py-3 pl-4 shrink-0"
          >
            Caută →
          </button>
        </div>
      </form>

      {/* Results */}
      {!query && (
        <div className="text-center py-20">
          <p className="font-serif text-2xl text-foreground/30">
            Introduceți un termen de căutare
          </p>
        </div>
      )}

      {query && query.length < 2 && (
        <div className="text-center py-20">
          <p className="font-serif text-xl text-foreground/40">
            Termenul de căutare trebuie să aibă cel puțin 2 caractere
          </p>
        </div>
      )}

      {query && query.length >= 2 && posts.length === 0 && (
        <div className="text-center py-20">
          <p className="font-serif text-2xl text-foreground/40 mb-3">
            Niciun articol găsit
          </p>
          <p className="font-sans text-sm text-muted-foreground mb-8">
            Încearcă termeni diferiți sau navighează pe categorii.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {['news', 'business', 'culture', 'technology', 'sports'].map((cat) => (
              <Link
                key={cat}
                href={`/categorie/${cat}`}
                className="text-[11px] font-sans font-bold uppercase tracking-widest px-3 py-1.5 border border-foreground/20 text-muted-foreground hover:border-brand-red hover:text-brand-red transition-colors"
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>
      )}

      {posts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {posts.map((post) => (
            <ArticleCard
              key={post.id}
              slug={post.slug}
              category={post.category}
              subcategory={post.subcategory}
              title={post.title_ro || post.title_en || ''}
              image={post.cover_image}
              excerpt={post.excerpt_ro}
              timeAgo={timeAgo(post.published_at)}
              variant="grid"
            />
          ))}
        </div>
      )}
    </div>
  )
}
