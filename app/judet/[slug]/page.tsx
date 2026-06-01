import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import { notFound } from 'next/navigation'
import ArticleCard from '@/app/components/ArticleCard'
import { getCounty, COUNTIES, isValidCounty } from '@/lib/counties'

export const revalidate = 300

const PAGE_SIZE = 12

interface Post {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  category: string | null
  subcategory: string | null
  county: string | null
  excerpt_ro: string | null
  published_at: string | null
  author_name: string | null
}

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const county = getCounty(slug)
  if (!county) {
    return { title: 'Județ negăsit — Transilvania Times' }
  }
  const title = `Știri din ${county.label} — Transilvania Times`
  const description = county.isTransylvania
    ? `Ultimele știri și articole din județul ${county.label}, publicate pe Transilvania Times.`
    : `Știri naționale și internaționale relevante pentru cititorii din Transilvania.`

  return {
    title,
    description,
    alternates: {
      canonical: `https://transilvaniatimes.com/judet/${county.slug}`,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `https://transilvaniatimes.com/judet/${county.slug}`,
    },
  }
}

export function generateStaticParams() {
  return COUNTIES.map(c => ({ slug: c.slug }))
}

export default async function CountyPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { page: pageStr } = await searchParams

  if (!isValidCounty(slug)) {
    notFound()
  }
  const county = getCounty(slug)
  if (!county) {
    notFound()
  }

  const page = Math.max(1, parseInt(pageStr || '1', 10))
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const supabase = await createSupabaseServerClient()

  const { data, count, error } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, cover_image, category, subcategory, county, excerpt_ro, published_at, author_name', { count: 'exact' })
    .eq('status', 'published')
    .eq('county', slug)
    .order('published_at', { ascending: false })
    .range(from, to)

  if (error) console.error('[CountyPage]', error.message)

  const posts = ((data ?? []) as unknown as Post[])
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  function timeAgo(d: string | null) {
    if (!d) return ''
    try { return formatDistanceToNow(parseISO(d), { addSuffix: true, locale: ro }) }
    catch { return '' }
  }

  function buildUrl(p: number) {
    const qs = p > 1 ? `?page=${p}` : ''
    return `/judet/${slug}${qs}`
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-10">

      <div className="border-b-2 border-brand-red mb-8 pb-4">
        <div className="flex items-center gap-3 mb-2">
          <span className="w-3 h-3 bg-brand-red inline-block" />
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground">
            {county.isTransylvania ? `Județul ${county.label}` : county.label}
          </h1>
        </div>
        <p className="text-[12px] font-sans text-muted-foreground uppercase tracking-widest">
          {count !== null && count !== undefined
            ? `${count} articole publicate`
            : '—'}
          {county.isTransylvania && (
            <span className="ml-3 text-foreground/40 normal-case tracking-normal">
              · Știri și reportaje din regiunea Transilvania
            </span>
          )}
        </p>
      </div>

      {posts.length === 0 ? (
        <div className="text-center py-20">
          <p className="font-serif text-2xl text-foreground/40 mb-4">
            Niciun articol publicat încă din {county.label}
          </p>
          <p className="font-sans text-sm text-muted-foreground mb-8">
            Lucrăm la extinderea acoperirii editoriale.
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
              county={post.county}
              title={post.title_ro || post.title_en || ''}
              image={post.cover_image}
              excerpt={post.excerpt_ro}
              timeAgo={timeAgo(post.published_at)}
              variant="grid"
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2 pt-8 border-t border-foreground/10">
          {page > 1 && (
            <Link
              href={buildUrl(page - 1)}
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
                  href={buildUrl(p as number)}
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
              href={buildUrl(page + 1)}
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
