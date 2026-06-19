'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Camera, Bot } from 'lucide-react'
import AuthorByline, { type AuthorData } from './AuthorByline'
import InlineRelatedBlock, { type InlineRelatedItem } from './InlineRelatedBlock'

export type { InlineRelatedItem }

interface ArticleContentProps {
  titleRo: string | null
  titleEn: string | null
  summaryRo: string | null
  summaryEn: string | null
  contentRo: string | null
  contentEn: string | null
  coverImage: string | null
  coverImageCredit?: string | null
  authorName: string | null
  author?: AuthorData | null
  publishedAt: string | null
  timeAgoStr: string
  defaultLang: 'ro' | 'en'
  inlineRelated?: InlineRelatedItem[]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function paragraphsFromSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []

  const DOT = '\u0001'
  const guarded = clean
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    .replace(/\b([A-ZĂÂÎȘȚ])\.\s/g, `$1${DOT} `)

  const sentences = guarded.match(/[^.!?]+[.!?]+(?:[""»)\]]+)?\s*|[^.!?]+$/g) || [guarded]

  const paras: string[] = []
  let bucket: string[] = []
  const PER_PARA = 3
  for (const s of sentences) {
    bucket.push(s.trim())
    if (bucket.length >= PER_PARA) {
      paras.push(bucket.join(' ').trim())
      bucket = []
    }
  }
  if (bucket.length) paras.push(bucket.join(' ').trim())

  const restore = new RegExp(DOT, 'g')
  return paras.map(p => p.replace(restore, '.')).filter(Boolean)
}

function extractParagraphs(raw: string): { paragraphs: string[]; preFormattedHtml: boolean } {
  if (!raw) return { paragraphs: [], preFormattedHtml: false }

  const hasBlockHtml = /<(p|h[1-6]|ul|ol|li|blockquote|figure|div)\b/i.test(raw)
  if (hasBlockHtml) {
    const matches = raw.match(/<p[^>]*>[\s\S]*?<\/p>/gi)
    if (matches && matches.length > 1) {
      return { paragraphs: matches.map(m => m.trim()), preFormattedHtml: true }
    }
    return { paragraphs: [raw.trim()], preFormattedHtml: true }
  }

  const stripped = raw.replace(/<[^>]+>/g, '').trim()

  let chunks = stripped
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)

  if (chunks.length <= 1) {
    const lineChunks = stripped
      .split(/\n+/)
      .map(p => p.trim())
      .filter(Boolean)
    if (lineChunks.length > 1) chunks = lineChunks
  }

  if (chunks.length <= 1) {
    chunks = paragraphsFromSentences(stripped)
  }

  return { paragraphs: chunks, preFormattedHtml: false }
}

export default function ArticleContent({
  titleRo,
  titleEn,
  summaryRo,
  summaryEn,
  contentRo,
  contentEn,
  coverImage,
  coverImageCredit,
  authorName,
  author,
  publishedAt: _publishedAt,
  timeAgoStr,
  defaultLang,
  inlineRelated = [],
}: ArticleContentProps) {
  const router   = useRouter()
  const pathname = usePathname()
  const [lang, setLang] = useState<'ro' | 'en'>(defaultLang)

  useEffect(() => {
    setLang(defaultLang)
  }, [defaultLang])

  function switchLanguage(nextLang: 'ro' | 'en') {
    if (nextLang === lang) return

    // Navigate to the correct canonical URL for the target language.
    // This component is rendered on two distinct routes:
    //   RO: /blog/{slug}/      → switching to EN goes to /en/blog/{slug}/
    //   EN: /en/blog/{slug}/   → switching to RO goes to /blog/{slug}/
    //
    // We extract the slug from the current pathname rather than appending
    // ?lang=en (the old approach), which caused a client redirect via the
    // server-side redirect in /blog/[slug]/page.tsx — two hops instead of one.
    const withSlash = pathname.endsWith('/') ? pathname : `${pathname}/`

    let targetUrl: string
    if (nextLang === 'en') {
      // /blog/some-slug/ → /en/blog/some-slug/
      const slug = withSlash.replace(/^\/blog\//, '').replace(/\/$/, '')
      targetUrl = `/en/blog/${slug}/`
    } else {
      // /en/blog/some-slug/ → /blog/some-slug/
      const slug = withSlash.replace(/^\/en\/blog\//, '').replace(/\/$/, '')
      targetUrl = `/blog/${slug}/`
    }

    router.push(targetUrl)
  }

  const title   = lang === 'ro' ? (titleRo   || titleEn)   : (titleEn   || titleRo)
  const summary = lang === 'ro' ? (summaryRo || summaryEn) : (summaryEn || summaryRo)
  const content = lang === 'ro' ? (contentRo || contentEn) : (contentEn || contentRo)

  const hasBoth = Boolean((titleRo && titleEn) || (contentRo && contentEn))

  const isAiGenerated = coverImageCredit
    ? coverImageCredit.toLowerCase().includes('generat') ||
      coverImageCredit.toLowerCase().includes('artificial') ||
      coverImageCredit.toLowerCase().includes('ai')
    : false

  // -- Summary normalization ------------------------------------------------
  // Processed articles produce 2-3 full sentences per line (each ~100 chars).
  // Editor AI articles produce 4+ short bullet fragments (each ~50 chars).
  // We detect the bullet pattern and join fragments in pairs to produce
  // 2-3 flowing lines that match the processed article format.
  const rawSummaryLines = summary
    ? summary.split('\n').map(l => l.replace(/^[•\-·]\s*/, '').trim()).filter(Boolean)
    : []
  const avgLen = rawSummaryLines.length > 0
    ? rawSummaryLines.reduce((a, l) => a + l.length, 0) / rawSummaryLines.length
    : 0
  const isBulletStyle = rawSummaryLines.length >= 4 && avgLen < 80
  const summaryLines = isBulletStyle
    ? (() => {
        const withDots = rawSummaryLines.map(l => l.endsWith('.') ? l : l + '.')
        const result: string[] = []
        for (let i = 0; i < withDots.length; i += 2) {
          result.push(withDots.slice(i, i + 2).join(' '))
        }
        return result
      })()
    : rawSummaryLines

  const { paragraphs, preFormattedHtml } = content
    ? extractParagraphs(content)
    : { paragraphs: [], preFormattedHtml: false }

  // One inline-related BLOCK (containing both items side-by-side) at the
  // halfway point. Only on articles with >=6 paragraphs and >=2 related items.
  const inlineBlockPosition =
    inlineRelated.length >= 2 && paragraphs.length >= 6
      ? Math.floor(paragraphs.length / 2)
      : -1

  return (
    <div>
      {/* Language switcher — navigates between /blog/slug/ and /en/blog/slug/ */}
      {hasBoth && (
        <div className="flex gap-1 mb-6">
          <button
            onClick={() => switchLanguage('ro')}
            className={`font-sans text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 border transition-colors ${
              lang === 'ro'
                ? 'bg-brand-red border-brand-red text-white'
                : 'border-foreground/20 text-muted-foreground hover:text-foreground'
            }`}
          >
            🇷🇴 Română
          </button>
          <button
            onClick={() => switchLanguage('en')}
            className={`font-sans text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 border transition-colors ${
              lang === 'en'
                ? 'bg-brand-red border-brand-red text-white'
                : 'border-foreground/20 text-muted-foreground hover:text-foreground'
            }`}
          >
            🇬🇧 English
          </button>
        </div>
      )}

      {/* Title */}
      <h1 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
        {title}
      </h1>

      {/* Summary - 2-3 flowing lines (normalized from bullets if needed) */}
      {summaryLines.length > 0 && (
        <div className="border-l-2 border-brand-red pl-4 mb-6 space-y-2">
          {summaryLines.map((line, i) => (
            <p key={i} className="font-sans text-sm text-muted-foreground leading-relaxed text-justify">
              {line}
            </p>
          ))}
        </div>
      )}

      {/* Author + date */}
      <div className="mb-8 pb-6 border-b border-foreground/10">
        <AuthorByline
          author={author ?? null}
          authorName={authorName}
          timeAgoStr={timeAgoStr}
          lang={lang}
        />
      </div>

      {/* Cover image */}
      {coverImage && (
        <div className="mb-8">
          <div className="overflow-hidden">
            <img
              src={coverImage}
              alt={title || ''}
              className="w-full aspect-video object-cover"
            />
          </div>

          {coverImageCredit && (
            <p className="font-sans text-[11px] text-muted-foreground/70 mt-2 flex items-center gap-1.5 italic">
              {isAiGenerated
                ? <Bot className="w-3 h-3 shrink-0 text-blue-400" />
                : <Camera className="w-3 h-3 shrink-0" />
              }
              {coverImageCredit}
            </p>
          )}
        </div>
      )}

      {/* Article body — paragraphs with one inline-related block at midpoint */}
      {paragraphs.length > 0 && (
        <div
          className="prose prose-lg max-w-none font-serif text-foreground
            prose-p:leading-relaxed prose-p:mb-5
            prose-headings:font-serif prose-headings:font-bold prose-headings:text-foreground
            prose-a:text-brand-red prose-a:no-underline hover:prose-a:underline
            prose-strong:font-bold prose-strong:text-foreground
            prose-blockquote:border-l-brand-red prose-blockquote:text-muted-foreground
            [&_p]:font-serif [&_p]:text-[17px] [&_p]:leading-[1.8] [&_p]:mb-5 [&_p]:text-justify"
        >
          {paragraphs.map((para, idx) => (
            <div key={idx}>
              {idx === inlineBlockPosition && (
                <InlineRelatedBlock articles={inlineRelated.slice(0, 2)} lang={lang} />
              )}
              {preFormattedHtml ? (
                <div dangerouslySetInnerHTML={{ __html: para }} />
              ) : (
                <p
                  dangerouslySetInnerHTML={{
                    __html: escapeHtml(para).replace(/\n/g, '<br />'),
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}