import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { formatDistanceToNow, parseISO, format } from 'date-fns'
import { ro } from 'date-fns/locale'
import ArticleCard from '@/app/components/ArticleCard'

// ISR: revalidate each article page at most every 60 seconds
export const revalidate = 60

const SITE_NAME = 'Transilvania Times'
const CANONICAL_DOMAIN = 'https://transilvaniatimes.com'

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

const SUBCAT_LABELS: Record<string, string> = {
  regional: 'Regional', national: 'Național', international: 'Internațional',
}

interface Post {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  content_ro: string | null
  content_en: string | null
  summary_ro: string | null
  summary_en: string | null
  excerpt_ro: string | null
  excerpt_en: string | null
  cover_image: string | null
  category: string | null
  subcategory: string | null
  author_name: string | null
  published_at: string | null
  seo_title_ro: string | null
  seo_title_en: string | null
  seo_description_ro: string | null
  seo_description_en: string | null
  tags_ro: string[] | null
  tags_en: string[] | null
}

interface RelatedPost {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  category: string | null
  published_at: string | null
}

async function getPost(slug: string): Promise<Post | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()
  return (data as unknown as Post) ?? null
}

async function getRelated(category: string | null, excludeId: string): Promise<RelatedPost[]> {
  if (!category) return []
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('blog_posts')
    .select('id, slug, title_ro, title_en, cover_image, category, published_at')
    .eq('status', 'published')
    .eq('category', category)
    .neq('id', excludeId)
    .order('published_at', { ascending: false })
    .limit(3)
  return ((data ?? []) as RelatedPost[])
}

// Generate metadata for SEO + OG + Twitter cards
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: 'Articol negăsit' }

  const title = post.seo_title_ro || post.title_ro || post.title_en || SITE_NAME
  const description = post.seo_description_ro || post.summary_ro || post.excerpt_ro || ''
  const imageUrl = post.cover_image ?? undefined
  const articleUrl = `${CANONICAL_DOMAIN}/blog/${slug}`

  return {
    title,
    description,
    alternates: {
      canonical: articleUrl,
      languages: {
        ro: articleUrl,
        en: articleUrl,
        'x-default': articleUrl,
      },
    },
    openGraph: {
      title,
      description,
      url: articleUrl,
      siteName: SITE_NAME,
      type: 'article',
      locale: 'ro_RO',
      alternateLocale: 'en_US',
      images: imageUrl ? [{ url: imageUrl }] : [],
      publishedTime: post.published_at ?? undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: imageUrl ? [imageUrl] : [],
    },
  }
}

// Convert basic markdown to HTML — inline, no external dependency
function mdToHtml(md: string): string {
  if (!md) return ''
  return md
    .replace(/^### (.+)$/gm, '<h3 class="font-serif text-xl font-bold mt-8 mb-3">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-serif text-2xl font-bold mt-10 mb-4">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-serif text-3xl font-bold mt-10 mb-4">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-brand-red underline hover:no-underline" target="_blank" rel="noopener">$1</a>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-brand-red pl-4 my-4 italic text-muted-foreground">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-4 leading-relaxed">')
    .replace(/^(?!<[hblp])(.+)$/gm, (m) => m.trim() ? m : '')
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = await getPost(slug)

  if (!post) notFound()

  const title = post.title_ro || post.title_en || ''
  const rawContent = post.content_ro || post.content_en || ''
  const content = mdToHtml(rawContent)
  const summary = post.summary_ro || post.summary_en || ''
  const catLabel = post.category ? CAT_LABELS[post.category] || post.category : ''
  const subcatLabel = post.subcategory ? SUBCAT_LABELS[post.subcategory] || post.subcategory : null
  const related = await getRelated(post.category, post.id)

  const publishDate = post.published_at
    ? format(parseISO(post.published_at), "d MMMM yyyy", { locale: ro })
    : ''
  
  // Reading time estimate
  const wordCount = rawContent.split(/\s+/).length
  const readingMinutes = Math.max(1, Math.round(wordCount / 200))

  // JSON-LD NewsArticle schema
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: title,
    description: post.seo_description_ro || post.excerpt_ro || summary,
    image: post.cover_image ? [post.cover_image] : [],
    datePublished: post.published_at,
    dateModified: post.published_at,
    author: { '@type': 'Person', name: post.author_name || SITE_NAME },
    publisher: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: CANONICAL_DOMAIN,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${CANONICAL_DOMAIN}/blog/${slug}`,
    },
    inLanguage: 'ro',
    keywords: (post.tags_ro || post.tags_en || []).join(', '),
  }

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <article className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12">

          {/* Category breadcrumb */}
          {post.category && (
            <div className="flex items-center gap-2 mb-6">
              <span className="w-2 h-2 bg-brand-red inline-block" />
              <Link
                href={`/categorie/${post.category}`}
                className="text-[11px] font-sans font-bold text-brand-red uppercase tracking-widest hover:underline"
              >
                {catLabel}
              </Link>
              {subcatLabel && (
                <span className="text-[11px] font-sans text-muted-foreground uppercase tracking-widest">
                  · {subcatLabel}
                </span>
              )}
            </div>
          )}

          {/* Headline */}
          <h1 className="font-serif text-3xl md:text-5xl font-bold text-foreground leading-tight mb-6">
            {title}
          </h1>

          {/* Byline */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-8 pb-6 border-b border-foreground/10">
            <span className="text-[13px] font-sans text-muted-foreground">
              De{' '}
              <span className="font-semibold text-foreground">
                {post.author_name || SITE_NAME}
              </span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <time
              dateTime={post.published_at ?? ''}
              className="text-[13px] font-sans text-muted-foreground"
            >
              {publishDate}
            </time>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[13px] font-sans text-muted-foreground">
              {readingMinutes} min citit
            </span>
          </div>

          {/* Cover image */}
          {post.cover_image && (
            <figure className="mb-8 -mx-4 md:mx-0">
              <img
                src={post.cover_image}
                alt={title}
                className="w-full max-h-[480px] object-cover"
              />
              <figcaption className="text-[10px] font-sans uppercase tracking-widest text-muted-foreground text-center mt-2">
                Imagine generată cu AI de redacție
              </figcaption>
            </figure>
          )}

          {/* Summary bullets */}
          {summary && (
            <div className="bg-foreground/[0.03] border border-foreground/10 p-5 mb-8">
              <p className="text-[11px] font-sans font-bold uppercase tracking-widest text-muted-foreground mb-3">
                Rezumat
              </p>
              <ul className="space-y-2">
                {summary.split('\n').filter(Boolean).map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-[14px] font-sans text-foreground/80">
                    <span className="w-1.5 h-1.5 bg-brand-red rounded-full mt-2 shrink-0" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Article body */}
          <div
            className="prose prose-lg max-w-none font-sans text-foreground/90 leading-relaxed
              prose-headings:font-serif prose-headings:text-foreground
              prose-a:text-brand-red prose-a:no-underline hover:prose-a:underline
              prose-blockquote:border-l-4 prose-blockquote:border-brand-red prose-blockquote:italic
              prose-strong:text-foreground prose-img:rounded-none"
            dangerouslySetInnerHTML={{
              __html: `<p class="mb-4 leading-relaxed">${content}</p>`,
            }}
          />
         
          {/* Social sharing */}
          <ShareButtons
            url={`${process.env.NEXT_PUBLIC_SITE_URL || 'https://transilvaniatimes.com'}/blog/${slug}`}
            title={title}
            summary={post.excerpt_ro || post.summary_ro || ''}
          />
          
          {/* Tags */}
          {(post.tags_ro || post.tags_en) && ((post.tags_ro || post.tags_en) ?? []).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-10 pt-6 border-t border-foreground/10">
              {(post.tags_ro || post.tags_en || []).map((tag, i) => (
                <span
                  key={i}
                  className="text-[11px] font-sans uppercase tracking-widest text-muted-foreground border border-foreground/15 px-2.5 py-1 hover:border-brand-red hover:text-brand-red transition-colors cursor-default"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Back link */}
          <div className="mt-10 pt-6 border-t border-foreground/10">
            <Link
              href="/"
              className="text-[12px] font-sans font-bold uppercase tracking-widest text-brand-red hover:underline flex items-center gap-2"
            >
              ← Înapoi la pagina principală
            </Link>
          </div>
        </div>

        {/* Related articles */}
        {related.length > 0 && (
          <section className="border-t border-foreground/10 bg-foreground/[0.02] py-10">
            <div className="max-w-7xl mx-auto px-4">
              <h2 className="font-serif text-2xl font-bold text-foreground mb-6">
                Articole similare
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {related.map((rel) => (
                  <ArticleCard
                    key={rel.id}
                    slug={rel.slug}
                    category={rel.category}
                    title={rel.title_ro || rel.title_en || ''}
                    image={rel.cover_image}
                    timeAgo={
                      rel.published_at
                        ? formatDistanceToNow(parseISO(rel.published_at), {
                            addSuffix: true,
                            locale: ro,
                          })
                        : ''
                    }
                    variant="grid"
                  />
                ))}
              </div>
            </div>
          </section>
        )}
      </article>
    </>
  )
}
