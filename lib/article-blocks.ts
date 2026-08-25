// lib/article-blocks.ts
//
// Canonical block model for Transilvania Times article bodies.
//
// This is the single source of truth for the "rich" editorial layout grammar.
// It is imported by the published renderer (app/components/ArticleContent.tsx)
// and by the Birou editorial preview (app/editor/[token]/page.tsx), so the
// editor preview and the live page agree byte-for-byte.
//
// SCOPE / SAFETY
// --------------
// This tokenizer runs ONLY for articles whose blog_posts.layout_mode = 'rich'
// (opt-in, set by an editor in Birou editorial). Pipeline articles
// (tt-generate-article, tt-process-scraped-article) and every one of the
// existing 572 rows default to layout_mode = 'auto' and NEVER pass through
// here, so their rendering (the "fixed pagination") is untouched.
//
// SSR-safe: pure string operations only. No DOM / browser APIs — safe to run
// during Next.js server rendering.
//
// GRAMMAR (line-based)
// --------------------
//   ## text          → H2 section subtitle
//   ### text         → H3 sub-subtitle
//   > text           → pull-quote  (consecutive `>` lines merge into one)
//   - text  |  * text → unordered list (consecutive lines merge)
//   1. text | 1) text → ordered list  (consecutive lines merge)
//   (blank-line separated remainder) → paragraph
//   **bold**         → inline bold, valid inside any block
//
// Paragraphs are separated by a blank line. As a safety net, a body that
// contains NO blank line at all (e.g. a raw single-\n paste that was then
// flipped to rich) is treated line-by-line — mirroring the auto renderer's
// own newline fallback — so it degrades gracefully instead of collapsing into
// one giant paragraph.

export type Block =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'p'; text: string }

/** HTML-escape a raw string (ampersand first). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Escape user text, then re-enable the single allowed inline mark:
//   **bold** → <strong>bold</strong>
// `breaks` controls whether interior newlines become <br /> (paragraphs,
// quotes) or a single space (headings, list items).
export function renderInline(text: string, breaks = true): string {
  let out = escapeHtml(text)
  // **bold** — non-greedy, no nested asterisks, no line spanning.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = breaks ? out.replace(/\n/g, '<br />') : out.replace(/\n+/g, ' ')
  return out
}

/**
 * Does this body contain any explicit structure marker? Useful as a cheap
 * guard (e.g. to warn an editor who switched to rich mode but typed none).
 */
export function hasStructureMarkers(raw: string): boolean {
  if (!raw) return false
  return /^(#{2,3}\s+|>\s?|[-*]\s+|\d+[.)]\s+)/m.test(raw)
}

/**
 * Tokenize a rich-mode body into an ordered list of semantic blocks.
 * Pure and deterministic. Never throws on empty / malformed input.
 */
export function tokenizeRichBlocks(raw: string): Block[] {
  if (!raw) return []

  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  // Safety net: no paragraph breaks anywhere → treat every non-empty line as
  // its own block (mirrors the auto renderer's single-newline fallback).
  if (!/\n[ \t]*\n/.test(text)) {
    text = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n\n')
  }

  const lines = text.split('\n')
  const blocks: Block[] = []

  let paraBuf: string[] = []
  let quoteBuf: string[] = []
  let listBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushPara = () => {
    const t = paraBuf.join('\n').trim()
    if (t) blocks.push({ type: 'p', text: t })
    paraBuf = []
  }
  const flushQuote = () => {
    const t = quoteBuf.join('\n').trim()
    if (t) blocks.push({ type: 'quote', text: t })
    quoteBuf = []
  }
  const flushList = () => {
    if (listType && listBuf.length) {
      blocks.push(
        listType === 'ul'
          ? { type: 'ul', items: listBuf.slice() }
          : { type: 'ol', items: listBuf.slice() },
      )
    }
    listBuf = []
    listType = null
  }
  const flushAll = () => {
    flushPara()
    flushQuote()
    flushList()
  }

  for (const rawLine of lines) {
    const t = rawLine.trim()

    if (t === '') {
      flushAll()
      continue
    }

    let m: RegExpMatchArray | null

    if ((m = t.match(/^###\s+(.+)$/))) {
      flushAll()
      blocks.push({ type: 'h3', text: m[1].trim() })
      continue
    }
    if ((m = t.match(/^##\s+(.+)$/))) {
      flushAll()
      blocks.push({ type: 'h2', text: m[1].trim() })
      continue
    }
    if ((m = t.match(/^>\s?(.*)$/))) {
      flushPara()
      flushList()
      quoteBuf.push(m[1])
      continue
    }
    if ((m = t.match(/^[-*]\s+(.+)$/))) {
      flushPara()
      flushQuote()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listBuf.push(m[1].trim())
      continue
    }
    if ((m = t.match(/^\d+[.)]\s+(.+)$/))) {
      flushPara()
      flushQuote()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listBuf.push(m[1].trim())
      continue
    }

    // Plain prose line → part of the current paragraph.
    flushQuote()
    flushList()
    paraBuf.push(t)
  }

  flushAll()
  return blocks
}
