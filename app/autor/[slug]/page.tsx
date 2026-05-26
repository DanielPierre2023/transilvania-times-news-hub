import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import type { Metadata } from 'next'

export const revalidate = 3600

const SITE_URL = 'https://transilvaniatimes.com'

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

interface Author {
  id: string
  slug: string
  name_ro: string
  name_en: string
  title_ro: string
  title_en: string
  bio_ro: string
  bio_en: string
  avatar_url: string | null
  specialties: string[]
}

interface AuthorPost {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  cover_image: string | null
  category: string | null
  published_at: string | null
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('authors')
    .select('name_ro, title_ro, bio_ro, slug')
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (!data) return { title: 'Autor negăsit' }
  const author = data as unknown as { name_ro: string; title_ro: string; bio_ro: string; slug: string }

  return {
    title: `${author.name_ro} — ${author.title_ro}`,
    description: author.bio_ro.slice(0, 155),
    alternates: { canonical: `${SITE_URL}/autor/${author.slug}` },
    openGraph: {
      title: author.name_ro,
      description: author.bio_ro.slice(0, 155),
      url: `${SITE_URL}/autor/${author.slug}`,
      type: 'profile',
    },
  }
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createSupabaseServerClient()

  const { data: authorData, error: authorErr } = await supabase
    .from('authors')
    .select('id, slug, name_ro, name_en, title_ro, title_en, bio_ro, bio_en, avatar_url, specialties')
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (authorErr || !authorData) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h1 className="font-serif text-3xl font-bold text-foreground mb-4">Autor negăsit</h1>
        <p className="font-sans text-muted-foreground mb-8">Această pagină nu există.</p>
        <Link href="/" className="text-brand-red hover:underline font-sans text-sm">
          ← Înapoi la pagina principală
        </Link>
      </div>
    )
  }

  const author = authorData as unknown as Author

  // Fetch articles by this author
  const { data: posts } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, excerpt_ro, excerpt_en, cover_image, category, published_at')
    .eq('status', 'published')
    .eq('author_id', author.id)
    .order('published_at', { ascending: false })
    .limit(50)

  const articles = (posts ?? []) as unknown as AuthorPost[]

  // JSON-LD for author
  const personLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: author.name_ro,
    description: author.bio_ro,
    url: `${SITE_URL}/autor/${author.slug}`,
    jobTitle: author.title_ro,
    worksFor: {
      '@type': 'Organization',
      name: 'Transilvania Times',
      url: SITE_URL,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
      />

      <div className="max-w-7xl mx-auto border-x border-foreground/10">
        <div className="max-w-3xl mx-auto px-6 pt-10 pb-12">

          {/* Author header */}
          <div className="flex items-start gap-5 mb-8 pb-8 border-b border-foreground/10">
            {author.avatar_url ? (
              <div className="w-20 h-20 border border-foreground/10 overflow-hidden shrink-0">
                <img src={author.avatar_url} alt={author.name_ro} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-20 h-20 bg-brand-red/10 border border-brand-red/20 flex items-center justify-center shrink-0">
                <span className="font-serif text-brand-red text-2xl font-bold">
                  {author.name_ro.charAt(0)}
                </span>
              </div>
            )}
            <div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground mb-1">
                {author.name_ro}
              </h1>
              <p className="font-sans text-[12px] font-bold uppercase tracking-[0.15em] text-brand-red mb-3">
                {author.title_ro}
              </p>
              {author.specialties && author.specialties.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {author.specialties.map(spec => (
                    <Link
                      key={spec}
                      href={`/categorie/${spec}`}
                      className="text-[10px] font-sans font-bold uppercase tracking-wider text-muted-foreground border border-foreground/15 px-2 py-0.5 hover:text-brand-red hover:border-brand-red/30 transition-colors"
                    >
                      {CAT_LABELS[spec] || spec}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Bio */}
          <div className="mb-10">
            <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
              {author.bio_ro}
            </p>
          </div>

          {/* Articles by this author */}
          {articles.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-2 h-2 bg-brand-red" />
                <h2 className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
                  Articole de {author.name_ro}
                </h2>
                <div className="flex-1 h-px bg-foreground/10" />
                <span className="font-sans text-[11px] text-muted-foreground">
                  {articles.length} articol{articles.length !== 1 ? 'e' : ''}
                </span>
              </div>

              <div className="space-y-6">
                {articles.map(article => {
                  const catSlug = article.category || 'news'
                  return (
                    <Link
                      key={article.id}
                      href={`/blog/${article.slug}`}
                      className="group flex gap-4 items-start"
                    >
                      {article.cover_image && (
                        <div className="w-24 h-16 md:w-32 md:h-20 overflow-hidden shrink-0">
                          <img
                            src={article.cover_image}
                            alt={article.title_ro || article.title_en || ''}
                            className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-sans text-[10px] font-bold uppercase tracking-[0.15em] text-brand-red">
                            {CAT_LABELS[catSlug] || catSlug}
                          </span>
                          {article.published_at && (
                            <span className="font-sans text-[10px] text-muted-foreground">
                              {new Date(article.published_at).toLocaleDateString('ro-RO', {
                                day: 'numeric', month: 'short', year: 'numeric',
                              })}
                            </span>
                          )}
                        </div>
                        <h3 className="font-serif text-base font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-2">
                          {article.title_ro || article.title_en}
                        </h3>
                        {(article.excerpt_ro || article.excerpt_en) && (
                          <p className="font-sans text-[12px] text-muted-foreground mt-1 line-clamp-2">
                            {article.excerpt_ro || article.excerpt_en}
                          </p>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}

          {articles.length === 0 && (
            <p className="font-sans text-sm text-muted-foreground text-center py-8">
              Niciun articol publicat încă.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
