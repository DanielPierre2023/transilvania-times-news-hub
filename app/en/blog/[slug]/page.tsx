// app/en/blog/[slug]/page.tsx
//
// English article route. Distinct canonical URL: /en/blog/{slug}/
// Paired with the Romanian route via hreflang.
//
// Created June 8, 2026 to fix bilingual SEO. Previously the EN view was
// served at /blog/{slug}/?lang=en with the canonical pointing to the RO
// URL — Google treated them as the same page and never indexed EN content.
//
// Fix (June 19, 2026):
//   - Category link was pointing to /categorie/{cat}/ (RO page). No EN
//     category pages exist yet, so the link now goes to /en/ to keep the
//     reader in the English context.
//   - County link was pointing to /judet/{county}/ (RO page). Same fix:
//     removed the hyperlink, county label rendered as plain text since
//     there are no EN county pages.
//   - inLanguage: 'en' added to JSON-LD (was missing).

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { enUS } from 'date-fns/locale'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import ShareButtons from '@/app/components/ShareButtons'
import CommentSection from '@/app/components/CommentSection'
import ArticleContent from '@/app/components/ArticleContent'
import type { InlineRelatedItem } from '@/app/components/InlineRelatedBlock'
import MostRead from '@/app/components/MostRead'
import FollowUs from '@/app/components/FollowUs'
import SectionHeader from '@/app/components/SectionHeader'
import ViewTracker from '@/app/components/ViewTracker'
import { getCounty } from '@/lib/counties'
import { getRelatedArticles, type RelatedArticle } from '@/lib/related-articles'
import { getMostRead } from '@/lib/most-read'

export const revalidate = 60

const SITE_URL = 'https://transilvaniatimes.com'

const CAT_LABELS_EN: Record<string, string> = {
  news: 'News', politics: 'Politics', technology: 'Technology',
  business: 'Business', culture: 'Culture', travel: 'Travel',
  education: 'Education', sports: 'Sports', health: 'Health', opinion: 'Opinion',
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
  authors: { slug: string } | null
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
  const supabase = await createSupabaseServerClient()

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
  const title       = post.title_en || post.title_ro || ''
  const description = post.excerpt_en || post.excerpt_ro || ''
  const image       = post.cover_image || ''
  const urlRo       = `${SITE_URL}/blog/${post.slug}/`
  const urlEn       = `${SITE_URL}/en/blog/${post.slug}/`

  const allTags = [
    ...(post.tags_en ?? []),
    ...(post.tags_ro ?? []),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i).slice(0, 10)

  return {
    title,
    description,
    alternates: {
      canonical: urlEn,
      languages: {
        ro:          urlRo,
        en:          urlEn,
        'x-default': urlRo,
      },
    },
    openGraph: {
      title,
      description,
      url:           urlEn,
      type:          'article',
      locale:        'en_GB',
      images: image ? [{ url: image, width: 1200, height: 630 }] : [],
      publishedTime: post.published_at  ?? undefined,
      modifiedTime:  post.updated_at    ?? undefined,
      authors:       post.authors?.slug
        ? [`${SITE_URL}/autor/${post.authors.slug}/`]
        : undefined,
      section:       post.category
        ? (CAT_LABELS_EN[post.category] ?? post.category)
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

export default async function ArticlePageEN(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const defaultLang: 'ro' | 'en' = 'en'

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
        <h1 className="font-serif text-3xl font-bold text-foreground mb-4">Article not found</h1>
        <p className="font-sans text-muted-foreground mb-8">The article does not exist or has been removed.</p>
        <Link href="/en/" className="text-brand-red hover:underline font-sans text-sm">
          ← Back to homepage
        </Link>
      </div>
    )
  }

  const post       = data as unknown as Post
  const articleUrl = `${SITE_URL}/en/blog/${post.slug}/`
  const shareUrl   = articleUrl
  const catLabel   = post.category ? (CAT_LABELS_EN[post.category] || post.category).toUpperCase() : ''
  const tags       = (post.tags_en || post.tags_ro || []) as string[]

  const author = post.authors ?? null

  let timeAgoStr = ''
  if (post.published_at) {
    try {
      timeAgoStr = formatDistanceToNow(parseISO(post.published_at), { addSuffix: true, locale: enUS })
    } catch { /* noop */ }
  }

  const typedSupabase = supabase as unknown as SupabaseClient

  const [related, mostRead] = await Promise.all([
    getRelatedArticles(typedSupabase, post.id, post.county, post.tags_ro, 6),
    getMostRead(typedSupabase, post.id, 6),
  ])

  const inlineRelatedRaw = related.slice(0, 2)
  const endBlockRelated: RelatedArticle[] = related.slice(2)

  const inlineRelated: InlineRelatedItem[] = inlineRelatedRaw.map((a) => ({
    id: a.id,
    slug: a.slug,
    title_ro: a.title_ro,
    title_en: a.title_en,
    county: a.county,
    cover_image: a.cover_image,
  }))

  // EN route — always use English fields, fall back to RO only if EN is missing.
  const authorName         = author ? author.name_en : (post.author_name || 'Transilvania Times')
  const articleTitle       = post.title_en || post.title_ro || ''
  const articleDescription = post.excerpt_en || post.excerpt_ro || ''

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: articleTitle,
    description: articleDescription,
    image: post.cover_image || '',
    datePublished: post.published_at || '',
    dateModified: post.updated_at || post.published_at || '',
    articleSection: post.category || 'news',
    wordCount: post.word_count || undefined,
    keywords: tags.join(', ') || undefined,
    inLanguage: 'en',
    author: {
      '@type': 'Person',
      name: authorName,
      ...(author?.slug ? { url: `${SITE_URL}/autor/${author.slug}/` } : {}),
      ...(author ? { description: author.bio_en } : {}),
    },
    publisher: {
      '@type': 'Organization',
      name: 'Transilvania Times',
      url: SITE_URL,
      logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo.png` },
    },
    url: shareUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': shareUrl },
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_URL}/en/` },
      ...(post.category
        ? [{ '@type': 'ListItem', position: 2, name: CAT_LABELS_EN[post.category] || post.category, item: `${SITE_URL}/en/` }]
        : []),
      {
        '@type': 'ListItem',
        position: post.category ? 3 : 2,
        name: articleTitle,
        item: shareUrl,
      },
    ],
  }

  return (
    <>
      <ViewTracker slug={post.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
      <article className="max-w-7xl mx-auto border-x border-foreground/10">

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 px-6 pt-10 pb-4">

          {/* LEFT: article body */}
          <div className="lg:col-span-8 max-w-3xl">

            <div className="flex items-center gap-2 mb-4">
              {post.is_breaking && (
                <span className="inline-flex items-center gap-1 bg-brand-red text-white text-[10px] font-sans font-bold uppercase tracking-widest px-3 py-1">
                  <span className="text-yellow-300">⚡</span> BREAKING
                </span>
              )}
              {post.category && (
                /* No EN category pages exist yet — link to EN homepage to keep
                   the reader in the English context instead of sending them to
                   the Romanian /categorie/ page. */
                <Link
                  href="/en/"
                  className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red hover:underline"
                >
                  {catLabel}
                </Link>
              )}
              {(() => {
                const countyData = post.county ? getCounty(post.county) : null
                if (countyData) {
                  /* No EN county pages exist yet — render as plain text label
                     instead of linking to the Romanian /judet/ page. */
                  return (
                    <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      · {countyData.label}
                    </span>
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

            <ShareButtons
              url={shareUrl}
              title={articleTitle}
              summary={articleDescription}
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
                  Sources
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
                  Source:{' '}
                  <a href={post.source_url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-brand-red underline">
                    {(() => { try { return new URL(post.source_url!).hostname } catch { return post.source_url } })()}
                  </a>
                </p>
              </div>
            )}

            <FollowUs locale={defaultLang} />

            <CommentSection articleId={post.id} />
          </div>

          {/* RIGHT: sidebar */}
          <div className="lg:col-span-4">
            <MostRead articles={mostRead} locale={defaultLang} />
          </div>
        </div>

        {/* End-of-article related grid (4-up) — links go to /en/blog/ to keep EN context */}
        {endBlockRelated && endBlockRelated.length > 0 && (
          <div className="max-w-7xl mx-auto px-6 mt-12 pt-8 border-t border-foreground/10 pb-12">
            <SectionHeader className="mb-6">Related articles</SectionHeader>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {endBlockRelated.map((rel) => {
                const countyData = rel.county ? getCounty(rel.county) : null
                return (
                  <Link
                    key={rel.id}
                    href={`/en/blog/${rel.slug}/`}
                    className="group"
                  >
                    {rel.cover_image && (
                      <div className="overflow-hidden mb-3 aspect-[4/3]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={rel.cover_image}
                          alt={rel.title_en || rel.title_ro || ''}
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
                      {rel.title_en || rel.title_ro}
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