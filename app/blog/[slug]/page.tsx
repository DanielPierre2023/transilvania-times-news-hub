// app/blog/[slug]/page.tsx
//
// B4: hreflang — both ro and en alternates correctly declared
// B5: OG article namespace — publishedTime, modifiedTime, authors, section, tags
// Tier 2 (June 2026):
//   - GoogleNewsBadge placed after article body + a second one mid-content (inside ArticleContent)
//   - Related articles use county + tag overlap scoring (via getRelatedArticles)
//   - Inline "Citește și" cards injected at 1/3 and 2/3 through the body
//   - Two-column layout on desktop with "Cele mai citite" sidebar

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ro } from 'date-fns/locale'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import ShareButtons from '@/app/components/ShareButtons'
import CommentSection from '@/app/components/CommentSection'
import ArticleContent, { type InlineRelatedItem } from '@/app/components/ArticleContent'
import GoogleNewsBadge from '@/app/components/GoogleNewsBadge'
import MostRead from '@/app/components/MostRead'
import { getCounty } from '@/lib/counties'
import { getRelatedArticles, type RelatedArticle } from '@/lib/related-articles'
import { getMostRead } from '@/lib/most-read'

export const revalidate = 60

const SITE_URL = 'https://transilvaniatimes.com'

const CAT_LABELS: Record<string, string> = {
  news: 'Știri', politics: 'Politică', technology: 'Tehnologie',
  business: 'Afaceri', culture: 'Cultură', travel: 'Călătorii',
  education: 'Educație', sports: 'Sport', health: 'Sănătate', opinion: 'Opinie',
}

interface MetaPost {
  title_ro:     string | null
  title_en:     string | null
  excerpt_ro:   string | null
  excerpt_en:   string | null
  cover_image:  string | null
  slug:         string
  published_at: string | null
  updated_at:   string | null
  category:     string | null
  tags_ro:      string[] | null
  tags_en:      string[] | null
  authors: {
    slug: string
  } | null
}

interface AuthorRecord {
  slug: string
  name_ro: string
  name_en: string
  title_ro: string
  title_en: string
  bio_ro: string
  bio_en: string
  avatar_url: string | null
  avatar_style: string | null
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
  county: string | null
  cover_image: string | null
  cover_image_credit: string | null
  author_name: string | null
  published_at: string | null
  updated_at: string | null
  tags_ro: string[] | null
  tags_en: string[] | null
  is_breaking: boolean | null
  source_url: string | null
  sources: string[] | null
  word_count: number | null
  authors: AuthorRecord | null
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const supabase  = await createSupabaseServerClient()

  const { data } = await supabase
    .from('blog_posts')
    .select(`
      title_ro, title_en, excerpt_ro, excerpt_en, cover_image, slug,
      published_at, updated_at, category, tags_ro, tags_en,
      authors ( slug )
    `)
    .eq('slug', slug)
    .single()

  if (!data) return { title: 'Article Not Found' }

  const post        = data as unknown as MetaPost
  const title       = post.title_ro || post.title_en || ''
  const description = post.excerpt_ro || post.excerpt_en || ''
  const image       = post.cover_image || ''
  const url         = `${SITE_URL}/blog/${post.slug}`
  const urlEn       = `${url}?lang=en`

  const allTags = [
    ...(post.tags_ro ?? []),
    ...(post.tags_en ?? []),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i).slice(0, 10)

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ro:          url,
        en:          urlEn,
        'x-default': url,
      },
    },
    openGraph: {
      title,
      description,
      url,
      type: 'article',
      images: image ? [{ url: image, width: 1200, height: 630 }] : [],
      publishedTime: post.published_at  ?? undefined,
      modifiedTime:  post.updated_at    ?? undefined,
      authors:       post.authors?.slug
        ? [`${SITE_URL}/autor/${post.authors.slug}`]
        : undefined,
      section:       post.category
        ? (CAT_LABELS[post.category] ?? post.category)
        : undefined,
      tags:          allTags.length > 0 ? allTags : undefined,
    },
    twitter: {
      card:   'summary_large_image',
      title,
      description,
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
  const { slug }          = await params
  const { lang: langParam } = await searchParams
  const defaultLang: 'ro' | 'en' = langParam === 'en' ? 'en' : 'ro'

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('blog_posts')
    .select(`
      id, slug, title_ro, title_en, content_ro, content_en,
      excerpt_ro, excerpt_en, summary_ro, summary_en,
      category, subcategory, county, cover_image, cover_image_credit,
      author_name, published_at, updated_at,
      tags_ro, tags_en, is_breaking, source_url,
      sources, word_count,
      authors (
        slug, name_ro, name_en, title_ro, title_en,
        bio_ro, bio_en, avatar_url, avatar_style
      )
    `)
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

  const post       = data as unknown as Post
  const articleUrl = `${SITE_URL}/blog/${post.slug}`
  const catLabel   = post.category ? (CAT_LABELS[post.category] || post.category).toUpperCase() : ''
  const tags       = (post.tags_ro || post.tags_en || []) as string[]

  const author = post.authors ?? null

  let timeAgoStr = ''
  if (post.published_at) {
    try {
      timeAgoStr = formatDistanceToNow(parseISO(post.published_at), { addSuffix: true, locale: ro })
    } catch { /* noop */ }
  }

  const typedSupabase = supabase as unknown as SupabaseClient

  // Tier 2: fetch related (county+tag scored) and most-read (recent published)
  // in parallel to keep page TTFB low.
  const [related, mostRead] = await Promise.all([
    getRelatedArticles(typedSupabase, post.id, post.county, post.tags_ro, 4),
    getMostRead(typedSupabase, post.id, 6),
  ])

  // Inline cards = first 2 related, rendered mid-stream by ArticleContent.
  // End-of-article block = remaining related.
  const inlineRelatedRaw = related.slice(0, 2)
  const endBlockRelated: RelatedArticle[] = related.slice(2)

  const inlineRelated: InlineRelatedItem[] = inlineRelatedRaw.map((a) => ({
    id: a.id,
    slug: a.slug,
    title_ro: a.title_ro,
    title_en: a.title_en,
    county: a.county,
    category: a.category,
  }))

  const authorName = author
    ? (defaultLang === 'en' ? author.name_en : author.name_ro)
    : (post.author_name || 'Transilvania Times')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title_ro || post.title_en || '',
    description: post.excerpt_ro || post.excerpt_en || '',
    image: post.cover_image || '',
    datePublished: post.published_at || '',
    dateModified: post.updated_at || post.published_at || '',
    articleSection: post.category || 'news',
    wordCount: post.word_count || undefined,
    keywords: tags.join(', ') || undefined,
    author: {
      '@type': 'Person',
      name: authorName,
      ...(author?.slug ? { url: `${SITE_URL}/autor/${author.slug}` } : {}),
      ...(author ? { description: defaultLang === 'en' ? author.bio_en : author.bio_ro } : {}),
    },
    publisher: {
      '@type': 'Organization',
      name: 'Transilvania Times',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    url: articleUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Acasă', item: SITE_URL },
      ...(post.category
        ? [{ '@type': 'ListItem', position: 2, name: CAT_LABELS[post.category] || post.category, item: `${SITE_URL}/categorie/${post.category}` }]
        : []),
      {
        '@type': 'ListItem',
        position: post.category ? 3 : 2,
        name: post.title_ro || post.title_en || '',
        item: articleUrl,
      },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <article className="max-w-7xl mx-auto border-x border-foreground/10">

        {/* Two-column layout: 8/12 article + 4/12 sidebar on desktop, single-column on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-6 pt-10 pb-4">

          {/* LEFT: article body */}
          <div className="lg:col-span-8 max-w-3xl">

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
              {(() => {
                const countyData = post.county ? getCounty(post.county) : null
                if (countyData) {
                  return (
                    <Link
                      href={'/judet/' + post.county}
                      className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted-foreground hover:text-brand-red transition-colors"
                    >
                      · {countyData.label}
                    </Link>
                  )
                }
                if (post.subcategory) {
                  return (
                    <span className="text-[10px] font-sans text-muted-foreground">· {post.subcategory}</span>
                  )
                }
                return null
              })()}
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
              author={author}
              publishedAt={post.published_at}
              timeAgoStr={timeAgoStr}
              defaultLang={defaultLang}
              inlineRelated={inlineRelated}
            />

            <GoogleNewsBadge locale={defaultLang} variant="top" />

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

            {post.sources && post.sources.length > 0 && (
              <div className="mt-6 pt-4 border-t border-foreground/[0.06]">
                <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-2">
                  Surse
                </p>
                <div className="space-y-1">
                  {post.sources.map((src: string, i: number) => (
                    <p key={i} className="font-sans text-[11px] text-muted-foreground">
                      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-brand-red underline">
                        {(() => { try { return new URL(src).hostname } catch { return src } })()}
                      </a>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {post.source_url && (!post.sources || post.sources.length === 0) && (
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

          {/* RIGHT: sidebar with most-read */}
          <div className="lg:col-span-4">
            <MostRead articles={mostRead} locale={defaultLang} />
          </div>
        </div>

        {/* End-of-article related (the 4-up grid below the body, full width) */}
        {endBlockRelated && endBlockRelated.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-foreground/10 pb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-2 h-2 bg-brand-red" />
              <h3 className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">Articole similare</h3>
              <div className="flex-1 h-px bg-foreground/10" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {endBlockRelated.map((rel) => {
                const countyData = rel.county ? getCounty(rel.county) : null
                return (
                  <Link
                    key={rel.id}
                    href={'/blog/' + rel.slug + (defaultLang === 'en' ? '?lang=en' : '')}
                    className="group"
                  >
                    {rel.cover_image && (
                      <div className="overflow-hidden mb-3 aspect-[4/3]">
                        <img
                          src={rel.cover_image}
                          alt={rel.title_ro || rel.title_en || ''}
                          className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                        />
                      </div>
                    )}
                    {countyData && (
                      <div className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-brand-red mb-1">
                        {countyData.label}
                      </div>
                    )}
                    <h4 className="font-serif text-sm font-semibold text-foreground group-hover:text-brand-red transition-colors leading-snug line-clamp-3">
                      {defaultLang === 'en' ? (rel.title_en || rel.title_ro) : (rel.title_ro || rel.title_en)}
                    </h4>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </article>
    </>
  )
}
