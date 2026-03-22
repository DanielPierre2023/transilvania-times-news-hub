import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import ArticleCard from '@/app/components/ArticleCard'

export const revalidate = 300

const PAGE_SIZE = 12

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

const SUBCAT_LABELS: Record<string, string> = {
  regional: 'Regional', national: 'Național', international: 'Internațional',
}

const SUBCATEGORIES = ['regional', 'national', 'international'] as const

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
  author_name: string | null
}

interface PageProps {
  params: Promise<{ category: string }>
  searchParams: Promise<{ page?: string; sub?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { category } = await params
  const label = CAT_LABELS[category] || category
  return {
    title: `${label} — Transilvania Times`,
    description: `Ultimele știri din categoria ${label} pe Transilvania Times.`,
  }
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { category } = await params
  const { page: pageStr, sub } = await searchParams

  const page = Math.max(1, parseInt(pageStr || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const catLabel = CAT_LABELS[category] || category
  const subcatLabel = sub ? SUBCAT_LABELS[sub] || sub : null

  const supabase = await createSupabaseServerClient()

  // Build query
  let query = supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, cover_image, category, subcategory, excerpt_ro, published_at, author_name', { count: 'exact' })
    .eq('status', 'published')
    .eq('category', category)
    .order('published_at', { ascending: false })
    .range(from, to)

  if (sub) {
    query = query.eq('subcategory', sub)
  }

  const { data, count, error } = await query

  if (error) console.error('[CategoryPage]', error.message)

  const posts = ((data ?? []) as unknown as Post[])
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  function timeAgo(d: string | null) {
    if (!d) return ''
    try { return formatDistanceToNow(parseISO(d), { addSuffix: true, locale: ro }) }
    catch { return '' }
  }

  function buildUrl(p: number, s?: string) {
    const params = new URLSearchParams()
    if (p > 1) params.set('page', String(p))
    if (s) params.set('sub', s)
    const qs = params.toString()
    return `/categorie/${category}${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10">

      {/* Category header */}
      <div className="border-b-2 border-brand-red mb-8 pb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-3 h-3 bg-brand-red inline-block" />
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground">
            {catLabel}
          </h1>
        </div>
        {count !== null && (
          <p className="text-[12px] font-sans text-muted-foreground uppercase tracking-widest">
            {count} articole publicate
          </p>
        )}
      </div>

      {/* Subcategory filters */}
      <div className="flex flex-wrap gap-2 mb-8">
        <Link
          href={buildUrl(1)}
          className={`text-[11px] font-sans font-bold uppercase tracking-widest px-3 py-1.5 border transition-colors ${
            !sub
              ? 'bg-brand-red text-white border-brand-red'
              : 'border-foreground/20 text-muted-foreground hover:border-brand-red hover:text-brand-red'
          }`}
        >
          Toate
        </Link>
        {SUBCATEGORIES.map((s) => (
          <Link
            key={s}
            href={buildUrl(1, s)}
            className={`text-[11px] font-sans font-bold uppercase tracking-widest px-3 py-1.5 border transition-colors ${
              sub === s
                ? 'bg-brand-red text-white border-brand-red'
                : 'border-foreground/20 text-muted-foreground hover:border-brand-red hover:text-brand-red'
            }`}
          >
            {SUBCAT_LABELS[s]}
          </Link>
        ))}
      </div>

      {/* Articles grid */}
      {posts.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-serif text-2xl text-foreground/40 mb-4">
            Niciun articol găsit
          </p>
          <Link href="/" className="text-[12px] font-sans font-bold uppercase tracking-widest text-brand-red hover:underline">
            ← Înapoi la pagina principală
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
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

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2 pt-8 border-t border-foreground/10">
          {page > 1 && (
            <Link
              href={buildUrl(page - 1, sub)}
              className="text-[12px] font-sans font-bold uppercase tracking-widest px-4 py-2 border border-foreground/20 text-muted-foreground hover:border-brand-red hover:text-brand-red transition-colors"
            >
              ← Anterior
            </Link>
          )}

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
            .reduce<(number | '...')[]>((acc, p, i, arr) => {
              if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...')
              acc.push(p)
              return acc
            }, [])
            .map((p, i) =>
              p === '...' ? (
                <span key={`ellipsis-${i}`} className="text-[12px] font-sans text-muted-foreground px-2">
                  …
                </span>
              ) : (
                <Link
                  key={p}
                  href={buildUrl(p as number, sub)}
                  className={`text-[12px] font-sans font-bold px-4 py-2 border transition-colors ${
                    p === page
                      ? 'bg-brand-red text-white border-brand-red'
                      : 'border-foreground/20 text-muted-foreground hover:border-brand-red hover:text-brand-red'
                  }`}
                >
                  {p}
                </Link>
              )
            )}

          {page < totalPages && (
            <Link
              href={buildUrl(page + 1, sub)}
              className="text-[12px] font-sans font-bold uppercase tracking-widest px-4 py-2 border border-foreground/20 text-muted-foreground hover:border-brand-red hover:text-brand-red transition-colors"
            >
              Următor →
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
