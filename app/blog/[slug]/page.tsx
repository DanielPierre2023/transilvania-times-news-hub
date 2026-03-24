import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import Link from 'next/link'
import type { Metadata } from 'next'
import ShareButtons from '@/app/components/ShareButtons'
import CommentSection from '@/app/components/CommentSection'
import ArticleContent from '@/app/components/ArticleContent'

export const revalidate = 60

const SITE_URL = 'https://transilvaniatimes.com'

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

interface MetaPost {
  title_ro: string | null
  title_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  cover_image: string | null
  slug: string
}

interface Post {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  content_ro: string | null
  content_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  summary_ro: string | null
  summary_en: string | null
  category: string | null
  subcategory: string | null
  cover_image: string | null
  cover_image_credit: string | null  // ← added
  author_name: string | null
  published_at: string | null
  tags_ro: string[] | null
  tags_en: string[] | null
  is_breaking: boolean | null
  source_url: string | null
}

interface RelatedPost {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  category: string | null
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('title_ro, title_en, excerpt_ro, excerpt_en, cover_image, slug')
    .eq('slug', slug)
    .single()

  if (!data) return { title: 'Article Not Found' }

  const post = data as unknown as MetaPost
  const title = post.title_ro || post.title_en || ''
  const description = post.excerpt_ro || post.excerpt_en || ''
  const image = post.cover_image || ''
  const url = `${SITE_URL}/blog/${post.slug}`

  return {
    title,
    description,
    alternates: { canonical: url, languages: { ro: url, en: url } },
    openGraph: {
      title, description, url, type: 'article',
      images: image ? [{ url: image, width: 1200, height: 630 }] : [],
    },
    twitter: {
      card: 'summary_large_image', title, description,
      images: image ? [image] : [],
    },
  }
}

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { slug } = await params
  const { lang: langParam } = await searchParams
  const defaultLang: 'ro' | 'en' = langParam === 'en' ? 'en' : 'ro'

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, content_ro, content_en, excerpt_ro, excerpt_en, summary_ro, summary_en, category, subcategory, cover_image, cover_image_credit, author_name, published_at, tags_ro, tags_en, is_breaking, source_url')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  if (error || !data) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h1 className="font-serif text-3xl font-bold text-foreground mb-4">Articol negăsit</h1>
        <p className="font-sans text-muted-foreground mb-8">Articolul nu există sau a fost eliminat.</p>
        <Link href="/" className="text-brand-red hover:underline font-sans text-sm">
          ← Înapoi la pagina principală
        </Link>
      </div>
    )
  }

  const post = data as unknown as Post
  const articleUrl = `${SITE_URL}/blog/${post.slug}`
  const catLabel = post.category ? (CAT_LABELS[post.category] || post.category).toUpperCase() : ''
  const tags = (post.tags_ro || post.tags_en || []) as string[]

  let timeAgoStr = ''
  if (post.published_at) {
    try {
      timeAgoStr = formatDistanceToNow(parseISO(post.published_at), { addSuffix: true, locale: ro })
    } catch { /* noop */ }
  }

  const { data: related } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, cover_image, category')
    .eq('status', 'published')
    .eq('category', post.category || 'news')
    .neq('slug', slug)
    .order('published_at', { ascending: false })
    .limit(4)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title_ro || post.title_en || '',
    description: post.excerpt_ro || post.excerpt_en || '',
    image: post.cover_image || '',
    datePublished: post.published_at || '',
    author: { '@type': 'Person', name: post.author_name || 'Transilvania Times' },
    publisher: {
      '@type': 'Organization', name: 'Transilvania Times',
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    url: articleUrl,
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article className="max-w-7xl mx-auto border-x border-foreground/10">
        <div className="max-w-3xl mx-auto px-6 pt-10 pb-4">

          <div className="flex items-center gap-2 mb-4">
            {post.is_breaking && (
              <span className="inline-flex items-center gap-1 bg-brand-red text-white text-[10px] font-sans font-bold uppercase tracking-widest px-3 py-1">
                <span className="text-yellow-300">⚡</span> ULTIMA ORĂ
              </span>
            )}
            {post.category && (
              <Link
                href={'/categorie/' + post.category}
                className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red hover:underline"
              >
                {catLabel}
              </Link>
            )}
            {post.subcategory && (
              <span className="text-[10px] font-sans text-muted-foreground">· {post.subcategory}</span>
            )}
          </div>

          <ArticleContent
            titleRo={post.title_ro}
            titleEn={post.title_en}
            summaryRo={post.summary_ro}
            summaryEn={post.summary_en}
            contentRo={post.content_ro}
            contentEn={post.content_en}
            coverImage={post.cover_image}
            coverImageCredit={post.cover_image_credit}
            authorName={post.author_name}
            publishedAt={post.published_at}
            timeAgoStr={timeAgoStr}
            defaultLang={defaultLang}
          />

          <ShareButtons
            url={articleUrl}
            title={post.title_ro || post.title_en || ''}
            summary={post.excerpt_ro || post.excerpt_en || ''}
          />

          {tags.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-2">
              {tags.map((tag: string) => (
                <span key={tag} className="text-[11px] font-sans font-bold uppercase tracking-wider text-muted-foreground border border-foreground/20 px-3 py-1">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {post.source_url && (
            <div className="mt-4">
              <p className="font-sans text-[11px] text-muted-foreground">
                Sursă:{' '}
                <a href={post.source_url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-brand-red underline">
                  {(() => { try { return new URL(post.source_url!).hostname } catch { return post.source_url } })()}
                </a>
              </p>
            </div>
          )}

          <CommentSection articleId={post.id} />
        </div>

        {related && related.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-foreground/10 pb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-2 bg-brand-red" />
              <h3 className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">Articole similare</h3>
              <div className="flex-1 h-px bg-foreground/10" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {(related as unknown as RelatedPost[]).map(rel => (
                <Link key={rel.id} href={'/blog/' + rel.slug + (defaultLang === 'en' ? '?lang=en' : '')} className="group">
                  {rel.cover_image && (
                    <div className="overflow-hidden mb-3 aspect-[4/3]">
                      <img src={rel.cover_image} alt={rel.title_ro || rel.title_en || ''} className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                    </div>
                  )}
                  <h4 className="font-serif text-sm font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-3">
                    {defaultLang === 'en' ? (rel.title_en || rel.title_ro) : (rel.title_ro || rel.title_en)}
                  </h4>
                </Link>
              ))}
            </div>
          </div>
        )}
      </article>
    </>
  )
}
