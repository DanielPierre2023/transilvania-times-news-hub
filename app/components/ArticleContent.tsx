'use client'

import { useState } from 'react'
import { Camera, Bot } from 'lucide-react'
import AuthorByline, { type AuthorData } from './AuthorByline'

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
  author?: AuthorData | null       // ← NEW: full author record (nullable for backwards compat)
  publishedAt: string | null
  timeAgoStr: string
  defaultLang: 'ro' | 'en'
}

// Converts article body text into clean, separated <p> paragraphs.
//
// Robust to every shape the generator has produced:
//   • Blank-line-separated paragraphs (the normal, well-formed case)
//   • Single-newline-separated paragraphs (some outputs use one \n)
//   • ONE unbroken block with no newlines at all (the failure mode that made
//     articles render as a single wall of text) — grouped into paragraphs by
//     sentence so the article still reads as structured prose
//   • Real HTML (already containing <p>/<h*> block tags) — passed through after
//     a light cleanup
//   • Text with stray inline tags but no block structure — tags are stripped
//     and the text is paragraphed, instead of being dumped raw
//
// The goal: the reader ALWAYS gets separated paragraphs, regardless of how the
// upstream writer formatted (or failed to format) the content.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Group a run of sentences into paragraphs of ~2-4 sentences each, so a
// newline-less block becomes readable separated paragraphs rather than one wall.
function paragraphsFromSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []

  // Protect periods that are NOT sentence ends so we don't split mid-number
  // (Romanian thousands separator: "5.000") or after an initial. Replace those
  // dots with a placeholder, split on real sentence boundaries, then restore.
  const DOT = '\u0001'
  const guarded = clean
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)        // 5.000 → keep together
    .replace(/\b([A-ZĂÂÎȘȚ])\.\s/g, `$1${DOT} `)  // initials "A. " → keep

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

  // Restore the protected periods.
  const restore = new RegExp(DOT, 'g')
  return paras.map(p => p.replace(restore, '.')).filter(Boolean)
}

function formatContent(raw: string): string {
  if (!raw) return ''

  // CASE 1 — real HTML with block-level structure already present.
  // Only treat as pre-formatted HTML if it actually contains block tags;
  // a stray inline <b>/<i>/<span> should NOT trigger raw passthrough.
  const hasBlockHtml = /<(p|h[1-6]|ul|ol|li|blockquote|figure|div)\b/i.test(raw)
  if (hasBlockHtml) {
    // Light cleanup: drop markdown headings that slipped in, normalize breaks.
    return raw.trim()
  }

  // From here down we treat the input as text (possibly with stray inline tags,
  // which we strip so they never render or break the layout).
  const stripped = raw.replace(/<[^>]+>/g, '').trim()

  // CASE 2 — blank-line-separated paragraphs (well-formed text).
  let chunks = stripped
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)

  // CASE 3 — no blank lines, but single newlines exist → each line a paragraph.
  if (chunks.length <= 1) {
    const lineChunks = stripped
      .split(/\n+/)
      .map(p => p.trim())
      .filter(Boolean)
    if (lineChunks.length > 1) chunks = lineChunks
  }

  // CASE 4 — still one block (no newlines at all) → group by sentences so the
  // article renders as separated paragraphs instead of one wall of text.
  if (chunks.length <= 1) {
    chunks = paragraphsFromSentences(stripped)
  }

  if (chunks.length === 0) return ''

  // Within a paragraph, any remaining single newline becomes a soft break.
  return chunks
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('\n')
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
  publishedAt,
  timeAgoStr,
  defaultLang,
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

  // Parse summary bullets — each line is a separate point
  const summaryLines = summary
    ? summary.split('\n').map(l => l.trim()).filter(Boolean)
    : []

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

      {/* Summary bullets — each line justified and separated */}
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

      {/* Author + date — uses AuthorByline component */}
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

          {/* Image credit — shown below image if present */}
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

      {/* Article body — justified paragraphs */}
      {content && (
        <div
          className="prose prose-lg max-w-none font-serif text-foreground
            prose-p:leading-relaxed prose-p:mb-5
            prose-headings:font-serif prose-headings:font-bold prose-headings:text-foreground
            prose-a:text-brand-red prose-a:no-underline hover:prose-a:underline
            prose-strong:font-bold prose-strong:text-foreground
            prose-blockquote:border-l-brand-red prose-blockquote:text-muted-foreground
            [&_p]:font-serif [&_p]:text-[17px] [&_p]:leading-[1.8] [&_p]:mb-5 [&_p]:text-justify"
          dangerouslySetInnerHTML={{ __html: formatContent(content) }}
        />
      )}
    </div>
  )
}
