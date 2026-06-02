'use client'

import { useState } from 'react'
import { Camera, Bot } from 'lucide-react'
import Link from 'next/link'
import AuthorByline, { type AuthorData } from './AuthorByline'
import GoogleNewsBadge from './GoogleNewsBadge'

export interface InlineRelatedItem {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  county: string | null
}

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

const COUNTY_LABELS: Record<string, string> = {
  alba: 'Alba', bihor: 'Bihor', 'bistrita-nasaud': 'Bistrița-Năsăud',
  brasov: 'Brașov', cluj: 'Cluj', covasna: 'Covasna',
  harghita: 'Harghita', hunedoara: 'Hunedoara', maramures: 'Maramureș',
  mures: 'Mureș', salaj: 'Sălaj', 'satu-mare': 'Satu Mare',
  sibiu: 'Sibiu', national: 'România',
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

  const sentences = guarded.match(/[^.!?]+[.!?]+(?:["”»)\]]+)?\s*|[^.!?]+$/g) || [guarded]

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

// Returns an array of paragraph STRINGS (still as plain text or HTML fragment).
// Caller wraps each in <p> and interleaves the related-article cards.
function extractParagraphs(raw: string): { paragraphs: string[]; preFormattedHtml: boolean } {
  if (!raw) return { paragraphs: [], preFormattedHtml: false }

  const hasBlockHtml = /<(p|h[1-6]|ul|ol|li|blockquote|figure|div)\b/i.test(raw)
  if (hasBlockHtml) {
    // Pre-formatted HTML: split by closing </p> tag so we can still inject
    // cards between paragraphs. Fall back to whole-blob if no <p> tags.
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

// Inline "Citește și" card — server-safe component rendered inline.
function InlineRelatedCard({ article, lang }: { article: InlineRelatedItem; lang: 'ro' | 'en' }) {
  const title = lang === 'ro'
    ? (article.title_ro || article.title_en)
    : (article.title_en || article.title_ro)
  if (!title) return null

  const label = lang === 'ro' ? 'Citește și' : 'Read also'
  const countyLabel = article.county ? COUNTY_LABELS[article.county] ?? article.county : null

  return (
    <aside className="my-8 border-l-4 border-brand-red bg-foreground/[0.02] px-5 py-4 not-prose">
      <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-brand-red font-bold mb-1.5">
        {label}
        {countyLabel ? ` · ${countyLabel}` : ''}
      </div>
      <Link
        href={`/blog/${article.slug}`}
        className="font-serif text-lg font-semibold text-foreground hover:text-brand-red leading-snug block no-underline"
      >
        {title}
      </Link>
    </aside>
  )
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
  const [lang, setLang] = useState<'ro' | 'en'>(defaultLang)

  const title   = lang === 'ro' ? (titleRo   || titleEn)   : (titleEn   || titleRo)
  const summary = lang === 'ro' ? (summaryRo || summaryEn) : (summaryEn || summaryRo)
  const content = lang === 'ro' ? (contentRo || contentEn) : (contentEn || contentRo)

  const hasBoth = (titleRo && titleEn) || (contentRo && contentEn)

  const isAiGenerated = coverImageCredit
    ? coverImageCredit.toLowerCase().includes('generat') ||
      coverImageCredit.toLowerCase().includes('artificial') ||
      coverImageCredit.toLowerCase().includes('ai')
    : false

  const summaryLines = summary
    ? summary.split('\n').map(l => l.trim()).filter(Boolean)
    : []

  const { paragraphs, preFormattedHtml } = content
    ? extractParagraphs(content)
    : { paragraphs: [], preFormattedHtml: false }

  // Inline injection positions: 1/3 and 2/3 through, only if article is long
  // enough AND we have related articles to inject.
  const inlinePositions: number[] = []
  if (inlineRelated.length >= 1 && paragraphs.length >= 6) {
    inlinePositions.push(Math.floor(paragraphs.length / 3))
  }
  if (inlineRelated.length >= 2 && paragraphs.length >= 10) {
    inlinePositions.push(Math.floor((paragraphs.length * 2) / 3))
  }

  // Mid-content Google News badge: right after the first inline card if any,
  // otherwise at the halfway point. Only on long articles.
  const midBadgePosition =
    paragraphs.length >= 8
      ? (inlinePositions[0] != null ? inlinePositions[0] + 1 : Math.floor(paragraphs.length / 2))
      : -1

  return (
    <div>
      {/* Language switcher */}
      {hasBoth && (
        <div className="flex gap-1 mb-6">
          <button
            onClick={() => setLang('ro')}
            className={`font-sans text-[10px] uppercase tracking-[0.15em] px-3 py-1.5 border transition-colors ${
              lang === 'ro'
                ? 'bg-brand-red border-brand-red text-white'
                : 'border-foreground/20 text-muted-foreground hover:text-foreground'
            }`}
          >
            🇷🇴 Română
          </button>
          <button
            onClick={() => setLang('en')}
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

      {/* Summary bullets */}
      {summaryLines.length > 0 && (
        <div className="border-l-2 border-brand-red pl-4 mb-6 space-y-2">
          {summaryLines.map((line, i) => (
            <p key={i} className="font-sans text-sm text-muted-foreground leading-relaxed text-justify">
              {line.startsWith('•') || line.startsWith('-') || line.startsWith('·')
                ? line.substring(1).trim()
                : line}
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

      {/* Article body — paragraphs interleaved with inline cards + mid-badge */}
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
          {paragraphs.map((para, idx) => {
            const inlineIdx = inlinePositions.indexOf(idx)
            const article = inlineIdx >= 0 ? inlineRelated[inlineIdx] : null
            return (
              <div key={idx}>
                {article && <InlineRelatedCard article={article} lang={lang} />}
                {idx === midBadgePosition && (
                  <GoogleNewsBadge locale={lang} variant="inline" />
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
            )
          })}
        </div>
      )}
    </div>
  )
}
