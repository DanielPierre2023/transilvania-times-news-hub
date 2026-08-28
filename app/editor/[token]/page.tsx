'use client'

// app/editor/[token]/page.tsx
//
// v1 — External Editor Writing Desk (token-gated)
//
// Same core UI as /admin/corector but:
// - No Supabase auth required — validated via editor_tokens table
// - Author identity auto-set from token
// - No author selector, no admin navigation
// - Standalone layout with TT branding
// - Can save drafts, run proof, submit articles
//
// URL: /editor/{uuid-token}
// The token maps to an author via the editor_tokens table.

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import {
  PenLine, CheckCircle, XCircle, Wand2, Send, Save, Eye,
  AlertTriangle, ChevronDown, ChevronUp, Image as ImageIcon,
  Upload, Globe, FileText, Loader2, X, RotateCcw, ShieldAlert,
  FileType, AlignLeft, LayoutList
} from 'lucide-react'
import { tokenizeRichBlocks, renderInline, looksLikeHtml } from '@/lib/article-blocks'
import type { IOptions } from 'sanitize-html'

type LayoutMode = 'auto' | 'rich'

// ─── Types ────────────────────────────────────────────────────────────────────

interface EditorAuth {
  valid: boolean
  author_id?: string; editor_key?: string
  author_name?: string; author_slug?: string; avatar_url?: string
}

interface Correction {
  before: string; after: string; reason: string; kind: 'text' | 'format'
  accepted?: boolean
}

interface ProofResult {
  ok: boolean; error?: string; language?: string; slug?: string
  corrections?: Correction[]; corrections_count?: number
  format_warnings?: string[]; change_ratio?: number; voice_warning?: boolean
  word_count?: number; original_title?: string; suggested_title?: string
  title_ro?: string; content_ro?: string; excerpt_ro?: string; summary_ro?: string
  tags_ro?: string[]; seo_title_ro?: string; seo_description_ro?: string
  title_en?: string; content_en?: string; excerpt_en?: string; summary_en?: string
  tags_en?: string[]; seo_title_en?: string; seo_description_en?: string
  corrected_content?: string
  // Rich (imported) articles only: the translated body, as sanitized HTML with
  // the SAME structure as the source (bold/italic/headings/tables preserved).
  translated_body_html?: string
  _meta?: { elapsed_s: number; summary_words: number; summary_in_range: boolean; translated: boolean }
}

interface DraftRow {
  id: string; title: string; content: string; category: string; county: string | null
  status: string; updated_at: string; language: string; word_count: number
  proof_result: ProofResult | null; image_url: string | null; image_credit: string | null
  translate: boolean; blog_post_id: string | null; layout_mode?: LayoutMode | null
}

type Tab = 'write' | 'review' | 'preview'

const CATEGORIES = [
  { value: 'politics', label: 'Politică' }, { value: 'news', label: 'Știri generale' },
  { value: 'technology', label: 'Tehnologie' }, { value: 'business', label: 'Business' },
  { value: 'culture', label: 'Cultură' }, { value: 'health', label: 'Sănătate' },
  { value: 'education', label: 'Educație' }, { value: 'sports', label: 'Sport' },
  { value: 'opinion', label: 'Opinie' }, { value: 'travel', label: 'Travel' },
  { value: 'community', label: 'Comunitate' },
]

const COUNTIES = [
  { value: '', label: '— Fără județ —' },
  { value: 'cluj', label: 'Cluj' }, { value: 'bihor', label: 'Bihor' },
  { value: 'alba', label: 'Alba' }, { value: 'bistrita-nasaud', label: 'Bistrița-Năsăud' },
  { value: 'salaj', label: 'Sălaj' }, { value: 'mures', label: 'Mureș' },
  { value: 'sibiu', label: 'Sibiu' }, { value: 'maramures', label: 'Maramureș' },
  { value: 'satu-mare', label: 'Satu Mare' }, { value: 'hunedoara', label: 'Hunedoara' },
  { value: 'brasov', label: 'Brașov' }, { value: 'covasna', label: 'Covasna' },
  { value: 'harghita', label: 'Harghita' }, { value: 'national', label: 'Național' },
]

function wordCount(t: string): number {
  return t ? t.trim().split(/\s+/).filter(w => w.length > 0).length : 0
}

// ── Word (.docx) → 1:1 sanitized HTML ────────────────────────────────────────
// Browser-only helpers (DOMParser/document); called solely from the import
// handler, never during SSR. The .docx is converted to HTML and rendered
// verbatim on the published page — bold, italic, headings, lists and tables
// preserved exactly as authored. See handleDocxImport.

// Strict allowlist for editor-imported HTML. Anything outside this set (scripts,
// styles, event handlers, unknown attributes) is dropped at import time, so the
// stored body is safe to render directly on the published page.
const SANITIZE_OPTS: IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'h2', 'h3', 'h4', 'blockquote',
    'ul', 'ol', 'li', 'a', 'sub', 'sup', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    // Keep a single <h1> on the page (the article title); demote doc headings.
    h1: 'h2',
    a: (tagName, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'noopener noreferrer' } }),
  },
}

function stripHtmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
}

function isWholeBold(el: Element, text: string): boolean {
  if (!text) return false
  const bold = Array.from(el.querySelectorAll('strong,b')).map(n => n.textContent || '').join('')
  const norm = (x: string) => x.replace(/\s+/g, '')
  return norm(text).length > 0 && norm(bold).length >= norm(text).length
}

// Split a mammoth HTML document into { title, bodyHtml }:
//   • first heading OR first whole-bold short paragraph → title (removed from
//     the body so it is not duplicated under the page's <h1>);
//   • a leading "de X" / "by X" byline paragraph → dropped (author = token).
// The remaining markup is returned untouched, for the caller to sanitize.
function docxHtmlToArticle(html: string): { title: string; bodyHtml: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  let title = ''

  const first = Array.from(body.children).find(el => (el.textContent || '').trim().length > 0)
  if (first) {
    const tag = first.tagName.toLowerCase()
    const text = (first.textContent || '').replace(/\s+/g, ' ').trim()
    const boldTitle = (tag === 'p' || tag === 'div') && isWholeBold(first, text) && text.split(/\s+/).length <= 16
    if (/^h[1-6]$/.test(tag) || boldTitle) {
      title = text
      first.remove()
    }
  }

  // Drop a "de X" / "by X" byline among the first few blocks (author = token).
  for (const el of Array.from(body.children).filter(e => (e.textContent || '').trim()).slice(0, 3)) {
    if (el.tagName.toLowerCase() !== 'p') continue
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    if (isWholeBold(el, text) && text.split(/\s+/).length <= 5 && /^(de|by)\s+\S+/i.test(text)) {
      el.remove()
      break
    }
  }

  return { title, bodyHtml: body.innerHTML }
}

// Apply user-accepted corrections to the original text.
// Corrections with accepted=false (rejected) are skipped.
// Corrections with accepted=true or undefined (default accepted) are applied.
// Each correction replaces the FIRST occurrence of `before` with `after`,
// iterating in the order the corrector emitted them.
//
// Idempotency guard: if the `after` string is already present at the location
// where `before` would be found (i.e. an earlier correction has already applied
// the same fix, or overlapping corrections would double-insert), skip silently.
// This prevents cases like „...porunca" → „...poruncă" being applied on top of
// an earlier correction that already added the closing quote, producing „...""
function applyCorrections(originalText: string, corrections: Correction[]): string {
  if (!originalText || !corrections?.length) return originalText
  let result = originalText
  for (const c of corrections) {
    if (c.accepted === false) continue
    if (!c.before || c.before === c.after) continue
    const idx = result.indexOf(c.before)
    if (idx === -1) continue // correction reference lost — skip silently
    // Idempotency: if `after` already appears at this position, the correction
    // has already been applied (by an earlier overlapping correction). Skip.
    if (result.substring(idx, idx + c.after.length) === c.after) continue
    result = result.substring(0, idx) + c.after + result.substring(idx + c.before.length)
  }
  return result
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-zinc-100 text-zinc-600', proofed: 'bg-amber-100 text-amber-700',
    submitted: 'bg-blue-100 text-blue-700', published: 'bg-green-100 text-green-700',
  }
  const labels: Record<string, string> = {
    draft: 'Ciornă', proofed: 'Corectat', submitted: 'Trimis', published: 'Publicat',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${colors[status] || colors.draft}`}>
      {labels[status] || status}
    </span>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EditorTokenPage() {
  const params = useParams()
  const token = params?.token as string

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // State — auth
  const [auth, setAuth] = useState<EditorAuth | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  // State — draft
  const [draftId, setDraftId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('opinion')
  const [county, setCounty] = useState('')
  const [language, setLanguage] = useState<'ro' | 'en'>('ro')
  const [translate, setTranslate] = useState(true)
  const [imageUrl, setImageUrl] = useState('')
  const [imageCredit, setImageCredit] = useState('')

  // Per-article layout. 'auto' = automatic pagination (default, unchanged
  // behaviour). 'rich' = respect authored structure (## / ### subtitles,
  // > pull-quotes, - / 1. lists, **bold**). Only Birou editorial articles set
  // this; the AI pipelines never do, so their rendering stays untouched.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('auto')
  const [importing, setImporting] = useState(false)
  const docxRef = useRef<HTMLInputElement | null>(null)

  // State — proof
  const [proofResult, setProofResult] = useState<ProofResult | null>(null)
  const [corrections, setCorrections] = useState<Correction[]>([])

  // Recompute the final Romanian content whenever the user toggles corrections.
  // The AI's `content_ro` had ALL corrections applied unconditionally; we
  // instead start from the ORIGINAL user text and apply only the corrections
  // the user has accepted. This is what actually goes to blog_posts.
  const finalContent = useMemo(() => {
    // Rich (imported) bodies are stored verbatim — the corrector never rewrites
    // them, so the published article stays 1:1 with the Word document.
    if (layoutMode === 'rich') return content
    if (!proofResult?.ok || !corrections.length) return content
    return applyCorrections(content, corrections)
  }, [content, corrections, proofResult, layoutMode])

  // State — UI
  const [tab, setTab] = useState<Tab>('write')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [metaLoading, setMetaLoading] = useState(false)
  const [proofing, setProofing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [showDrafts, setShowDrafts] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  // ── Validate token on mount
  useEffect(() => {
    if (!token) { setAuthLoading(false); return }
    supabase.rpc('validate_editor_token', { p_token: token }).then(({ data, error: err }) => {
      if (err || !data || !data.valid) {
        setAuth({ valid: false })
      } else {
        setAuth(data as EditorAuth)
      }
      setAuthLoading(false)
    })
  }, [token])

  // ── Load drafts
  const loadDrafts = useCallback(async () => {
    if (!auth?.author_id) return
    const { data } = await supabase.from('editor_drafts')
      .select('*').eq('author_id', auth.author_id)
      .order('updated_at', { ascending: false }).limit(20)
    if (data) setDrafts(data as DraftRow[])
  }, [auth, supabase])

  useEffect(() => { if (auth?.valid) loadDrafts() }, [auth, loadDrafts])

  // ── Auto-save
  useEffect(() => {
    if (!auth?.valid || !content || content.length < 50) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => saveDraft(true), 3000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [title, content, category, county, layoutMode])

  // ── Save draft
  async function saveDraft(auto = false) {
    if (!auth?.author_id || !content) return
    if (!auto) setSaving(true)
    const row = {
      author_id: auth.author_id, editor_key: auth.editor_key || '',
      title, content, category, county: county || null, language, translate,
      image_url: imageUrl || null, image_credit: imageCredit || null,
      word_count: wordCount(content), status: proofResult?.ok ? 'proofed' : 'draft',
      proof_result: proofResult || null, layout_mode: layoutMode,
    }
    if (draftId) {
      await supabase.from('editor_drafts').update({ ...row, updated_at: new Date().toISOString() }).eq('id', draftId)
    } else {
      const { data } = await supabase.from('editor_drafts').insert(row).select('id').single()
      if (data) setDraftId(data.id)
    }
    if (!auto) { setSaving(false); setSuccess('Ciornă salvată.'); setTimeout(() => setSuccess(''), 2000) }
    loadDrafts()
  }

  function loadDraft(d: DraftRow) {
    setDraftId(d.id); setTitle(d.title); setContent(d.content)
    setCategory(d.category); setCounty(d.county || ''); setLanguage((d.language || 'ro') as 'ro' | 'en')
    setTranslate(d.translate); setImageUrl(d.image_url || ''); setImageCredit(d.image_credit || '')
    setLayoutMode((d.layout_mode as LayoutMode) || 'auto')
    if (d.proof_result?.ok) {
      setProofResult(d.proof_result); setCorrections(d.proof_result.corrections || [])
    } else {
      setProofResult(null); setCorrections([])
    }
    setShowDrafts(false); setTab('write')
  }

  function newDraft() {
    setDraftId(null); setTitle(''); setContent(''); setCategory('opinion')
    setCounty(''); setLanguage('ro'); setTranslate(true); setImageUrl(''); setImageCredit('')
    setLayoutMode('auto')
    setProofResult(null); setCorrections([]); setTab('write'); setError(''); setSuccess('')
  }

  // ── Run proof (two-phase)
  //
  // Phase 1 ('correct') returns corrections fast; the Corectură tab opens as
  // soon as they land. Phase 2 ('metadata') runs in the background on the
  // corrected content — translation + metadata (English-first). The Preview
  // tab unlocks when phase 2 completes. Each phase gets its own gateway
  // budget, so one slow AI call no longer kills the whole pipeline.
  async function runProof() {
    // Rich (imported HTML) articles keep the body 1:1 with Word, so we skip the
    // text corrector entirely and only generate metadata + translation from the
    // plain-text extraction. No corrections to review → straight to preview.
    if (layoutMode === 'rich') {
      const plain = stripHtmlToText(content)
      if (plain.length < 300) { setError('Textul articolului trebuie să aibă minim 300 de caractere.'); return }
      setProofing(true); setError(''); setMetaLoading(true)
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('tt-proof-article', {
          body: {
            // Sent so the edge function can authorise this guest editor.
            // tt-proof-article and generate-cover-image are now gated; without
            // this line every guest editor gets a 401. `token` is the route
            // param validated on mount by validate_editor_token().
            editor_token: token,
            phase: 'metadata',
            text: plain, title: title || undefined,
            author_name: auth?.author_name || 'Redacția',
            category, county: county || undefined,
            language, translate,
          },
        })
        if (fnErr) throw new Error(fnErr.message)
        if (!data?.ok) throw new Error(data?.error || 'Generarea metadatelor a eșuat.')

        // Translate the body 1:1 (structure-preserving HTML) so the other
        // language matches exactly — bold, italic, headings and tables intact.
        let translatedBodyHtml = ''
        if (translate) {
          try {
            const { data: tr, error: trErr } = await supabase.functions.invoke('tt-translate-html', {
              body: { html: content, source_lang: language, target_lang: language === 'ro' ? 'en' : 'ro' },
            })
            if (!trErr && tr?.ok && tr?.html) {
              const sanitizeHtml = (await import('sanitize-html')).default
              translatedBodyHtml = sanitizeHtml(tr.html as string, SANITIZE_OPTS).trim()
            } else {
              setError(`Traducerea 1:1 a corpului nu a putut fi generată${trErr ? `: ${trErr.message}` : ''}. Metadatele și versiunea ${language === 'ro' ? 'RO' : 'EN'} sunt gata; poți publica și adăuga traducerea ulterior.`)
            }
          } catch (te) {
            setError(`Traducerea 1:1 a corpului a eșuat: ${(te as Error).message}. Poți publica versiunea ${language === 'ro' ? 'RO' : 'EN'} și reîncerca.`)
          }
        }

        setProofResult({ ...(data as ProofResult), ok: true, corrections: [], translated_body_html: translatedBodyHtml })
        setCorrections([])
        setTab('preview')
        await saveDraft(true)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setProofing(false); setMetaLoading(false)
      }
      return
    }

    if (!content || content.length < 300) { setError('Textul trebuie să aibă minim 300 de caractere.'); return }
    setProofing(true); setError('')
    try {
      // Phase 1 — correction
      const { data, error: fnErr } = await supabase.functions.invoke('tt-proof-article', {
        body: {
          editor_token: token,   // authorises this guest editor — see note above
          phase: 'correct',
          text: content, title: title || undefined,
          author_name: auth?.author_name || 'Redacția',
          category, county: county || undefined,
          language, translate,
          // Reached only for 'auto' articles (rich returns early above), which
          // get the standard flat-prose house style.
          format_mode: 'enforce',
        },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (!data?.ok) throw new Error(data?.error || 'Corectura a eșuat.')

      setProofResult(data as ProofResult)
      setCorrections((data.corrections || []).map((c: Correction) => ({ ...c, accepted: true })))
      setTab('review')
      setProofing(false)

      // Phase 2 — metadata, in the background on the corrected content
      setMetaLoading(true)
      try {
        const { data: metaData, error: metaErr } = await supabase.functions.invoke('tt-proof-article', {
          body: {
            editor_token: token,   // authorises this guest editor
            phase: 'metadata',
            text: data.corrected_content || content,
            title: title || undefined,
            author_name: auth?.author_name || 'Redacția',
            category, county: county || undefined,
            language, translate,
          },
        })
        if (metaErr) throw new Error(metaErr.message)
        if (!metaData?.ok) throw new Error(metaData?.error || 'Generarea metadatelor a eșuat.')
        // Merge: metadata payload on top of the phase-1 result, keeping corrections
        setProofResult(prev => ({ ...(prev || {}), ...(metaData as ProofResult), corrections: prev?.corrections || [] }))
      } catch (me) {
        setError(`Metadatele nu au putut fi generate: ${(me as Error).message}. Corecturile rămân valabile — apasă din nou pe Corectează pentru a reîncerca.`)
      } finally {
        setMetaLoading(false)
      }

      await saveDraft(true)
    } catch (e) {
      setError((e as Error).message)
      setProofing(false)
      setMetaLoading(false)
    }
  }

  // ── Publish
  async function publish() {
    if (!auth?.author_id || !proofResult?.ok) return
    setPublishing(true); setError('')
    try {
      const pr = proofResult
      const slug = pr.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60) + '-' + Math.random().toString(36).substring(2, 8)
      // For rich bodies, count words from the text, not the HTML markup.
      const plainForCount = layoutMode === 'rich' ? stripHtmlToText(finalContent) : finalContent
      const readingTime = Math.max(1, Math.round(wordCount(plainForCount) / 200))

      const row: Record<string, unknown> = {
        slug,
        title_ro: pr.title_ro || title, content_ro: finalContent,
        excerpt_ro: pr.excerpt_ro || '', summary_ro: pr.summary_ro || '',
        tags_ro: pr.tags_ro || [], seo_title_ro: pr.seo_title_ro || '',
        seo_description_ro: pr.seo_description_ro || '',
        title_en: pr.title_en || '', content_en: pr.content_en || '',
        excerpt_en: pr.excerpt_en || '', summary_en: pr.summary_en || '',
        tags_en: pr.tags_en || [], seo_title_en: pr.seo_title_en || '',
        seo_description_en: pr.seo_description_en || '',
        category, county: county || null,
        author_name: auth.author_name || '', author_id: auth.author_id,
        ai_editor: null,
        cover_image: imageUrl || null, cover_image_credit: imageCredit || null,
        reading_time_min: readingTime,
        word_count: pr.word_count || wordCount(plainForCount),
        layout_mode: layoutMode,
        status: 'draft',
      }

      // Rich (imported) articles: both language bodies are structure-preserving
      // HTML — the authored body in `language`, the 1:1 translation in the other.
      if (layoutMode === 'rich') {
        const authored = finalContent
        const translated = pr.translated_body_html || ''
        row.content_ro = language === 'ro' ? authored : (translated || (row.content_ro as string) || '')
        row.content_en = language === 'en' ? authored : (translated || (row.content_en as string) || '')
      }

      const { data, error: insertErr } = await supabase.from('blog_posts').insert(row).select('id').single()
      if (insertErr) throw new Error(insertErr.message)
      if (draftId) {
        await supabase.from('editor_drafts').update({ status: 'submitted', blog_post_id: data.id }).eq('id', draftId)
      }
      setSuccess('Articolul a fost trimis cu succes! Redacția îl va publica în curând.')
      loadDrafts()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  // ── Import from Word (.docx) — 1:1 fidelity
  //
  // mammoth converts the .docx to HTML with bold, italic, headings, lists and
  // tables intact. We strip only the title/byline, sanitize against a strict
  // allowlist, and store the HTML verbatim — the published page mirrors the
  // Word document exactly. Import sets 'rich'; the editor can switch back to
  // 'auto' (automatic pagination) anytime.
  async function handleDocxImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/\.docx$/i.test(file.name)) { setError('Selectați un fișier Word (.docx).'); return }
    setImporting(true); setError('')
    try {
      // Browser build — avoids mammoth's Node/fs entry point.
      const mammoth = await import('mammoth/mammoth.browser')
      const convertToHtml = mammoth.convertToHtml ?? mammoth.default.convertToHtml
      const arrayBuffer = await file.arrayBuffer()
      const { value: rawHtml } = await convertToHtml({ arrayBuffer })
      const { title: importedTitle, bodyHtml } = docxHtmlToArticle(rawHtml)
      const sanitizeHtml = (await import('sanitize-html')).default
      const clean = sanitizeHtml(bodyHtml, SANITIZE_OPTS).trim()
      if (!stripHtmlToText(clean)) { setError('Documentul pare gol sau nu a putut fi citit.'); return }
      if (importedTitle && !title.trim()) setTitle(importedTitle)
      setContent(clean)
      setLayoutMode('rich')
      setTab('write')
      setSuccess('Articol importat din Word — aspect 1:1 (bold, italic, tabele păstrate). Verifică în previzualizare.')
      setTimeout(() => setSuccess(''), 6000)
    } catch (err) {
      setError(`Import Word eșuat: ${(err as Error).message}`)
    } finally {
      setImporting(false)
      if (docxRef.current) docxRef.current.value = ''
    }
  }

  // ── Image upload (same as ArticleEditor — blog-images bucket)
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selectați un fișier imagine.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Imaginea trebuie să fie sub 10MB.'); return }
    setUploading(true); setError('')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('blog-images').upload(fileName, file, { contentType: file.type, upsert: false })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('blog-images').getPublicUrl(fileName)
      setImageUrl(urlData.publicUrl)
      setSuccess('Imagine încărcată.')
      setTimeout(() => setSuccess(''), 2000)
    } catch (err) { setError(`Eroare upload: ${(err as Error).message}`) }
    setUploading(false)
    if (uploadRef.current) uploadRef.current.value = ''
  }

  // ── AI cover generation (same as ArticleEditor — generate-cover-image)
  async function generateCover() {
    const imgTitle = title || proofResult?.title_ro || proofResult?.suggested_title
    if (!imgTitle) { setError('Completează titlul sau rulează corectura mai întâi.'); return }
    setGenerating(true); setError('')
    try {
      // Cover images come from `generate-cover-image` (classic mode:
      // { title, summary, category } -> { publicUrl }). The old slug
      // `tt-generate-cover` no longer holds cover code — the scraped-article
      // processor was deployed over it, so calling it ran a rewrite batch
      // instead of making an image, and returned no publicUrl.
      const { data: res, error: genErr } = await supabase.functions.invoke('generate-cover-image', {
        body: { editor_token: token, title: imgTitle, summary: proofResult?.excerpt_ro || '', category }
      })
      if (genErr) throw new Error(genErr.message)
      if (res?.publicUrl) {
        setImageUrl(res.publicUrl)
        if (res.isAiGenerated !== false) setImageCredit('Imagine generată cu inteligență artificială')
        setSuccess('Imagine generată.')
        setTimeout(() => setSuccess(''), 2000)
      } else {
        throw new Error(res?.error || 'Eroare generare')
      }
    } catch (err) { setError(`Eroare: ${(err as Error).message}`) }
    setGenerating(false)
  }

  const wc = wordCount(content)

  // ── AUTH GATES ──────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-red-600 mx-auto" />
          <p className="text-sm text-zinc-500">Se verifică accesul...</p>
        </div>
      </div>
    )
  }

  if (!auth?.valid) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 max-w-sm text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Link invalid sau expirat</h1>
          <p className="text-sm text-zinc-500">
            Acest link de editor nu este valid sau a expirat. Contactează redacția pentru un link nou.
          </p>
        </div>
      </div>
    )
  }

  // ── MAIN EDITOR UI ─────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Top bar */}
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-white" style={{ fontFamily: 'Lora, serif' }}>
              Transilvania Times
            </span>
            <span className="text-xs text-zinc-400">|</span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Editor</span>
          </div>
          <div className="flex items-center gap-2">
            {auth.avatar_url && (
              <img src={auth.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
            )}
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{auth.author_name}</span>
          </div>
        </div>
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <PenLine className="w-5 h-5 text-red-600" /> Birou editorial
            </h1>
            <p className="text-sm text-zinc-500">Scrie, corectează automat, trimite la publicare</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={newDraft} className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors">
              + Articol nou
            </button>
            <button onClick={() => { setShowDrafts(!showDrafts); if (!showDrafts) loadDrafts() }}
              className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Ciornele mele {showDrafts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Drafts */}
        {showDrafts && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-2">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Ciornele mele</p>
            {drafts.length === 0 && <p className="text-xs text-zinc-400">Nicio ciornă.</p>}
            {drafts.map(d => (
              <button key={d.id} onClick={() => loadDraft(d)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-white">{d.title || '(fără titlu)'}</span>
                  <span className="text-xs text-zinc-400 ml-2">{d.word_count}w • {new Date(d.updated_at).toLocaleDateString('ro-RO')}</span>
                </div>
                <StatusBadge status={d.status} />
              </button>
            ))}
          </div>
        )}

        {/* Settings row */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Categorie</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Județ</label>
              <select value={county} onChange={e => setCounty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
                {COUNTIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Limbă</label>
                <select value={language} onChange={e => setLanguage(e.target.value as 'ro' | 'en')}
                  className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
                  <option value="ro">Română</option>
                  <option value="en">English</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={translate} onChange={e => setTranslate(e.target.checked)} className="rounded border-zinc-300" />
                  <span className="text-xs text-zinc-600 dark:text-zinc-400"><Globe className="w-3 h-3 inline" /> Traducere</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Layout mode — automatic pagination vs. structured (opt-in) */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">Aspect articol</p>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5 w-fit">
                <button onClick={() => setLayoutMode('auto')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${layoutMode === 'auto' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  <AlignLeft className="w-3.5 h-3.5" /> Paginare automată
                </button>
                <button onClick={() => setLayoutMode('rich')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${layoutMode === 'rich' ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
                  <LayoutList className="w-3.5 h-3.5" /> Structurat
                </button>
              </div>
            </div>
            <div>
              <input ref={docxRef} type="file" accept=".docx" onChange={handleDocxImport} className="hidden" id="editor-docx-import" />
              <label htmlFor="editor-docx-import"
                className={`flex items-center justify-center gap-2 px-3 py-2 border rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors ${importing ? 'border-zinc-200 text-zinc-300 cursor-not-allowed' : 'border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:text-zinc-700 hover:border-zinc-400'}`}>
                {importing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Se importă...</> : <><FileType className="w-3.5 h-3.5" /> Import din Word (.docx)</>}
              </label>
            </div>
          </div>
          <p className="text-[11px] text-zinc-400 mt-2 leading-relaxed">
            {layoutMode === 'rich'
              ? 'Structurat: subtitlurile (## / ###), citatele (>), listele (- / 1.) și textul îngroșat (**text**) sunt păstrate în pagina publicată.'
              : 'Paginare automată: textul este împărțit uniform în paragrafe (comportamentul standard). Subtitlurile și îngroșările nu apar în pagina publicată.'}
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5 w-fit">
          {([['write', 'Scrie'], ['review', 'Corectură'], ['preview', 'Previzualizare']] as [Tab, string][]).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)}
              disabled={t === 'review' && !proofResult}
              className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed'}`}>
              {l}
            </button>
          ))}
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 text-sm text-green-700 dark:text-green-400">
            <CheckCircle className="w-4 h-4 inline mr-1" /> {success}
          </div>
        )}

        {/* ═══ TAB: WRITE ═══ */}
        {tab === 'write' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu (opțional — AI va sugera unul)</label>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titlul articolului..."
                className="w-full px-3 py-2 text-lg font-bold border-0 border-b border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:border-red-500 font-serif" />
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] uppercase tracking-wide text-zinc-400">
                  {layoutMode === 'rich' && looksLikeHtml(content) ? 'Articol importat din Word (aspect 1:1)' : 'Textul articolului'}
                </label>
                {layoutMode === 'rich' && looksLikeHtml(content) ? (
                  <button onClick={() => { setContent(''); setLayoutMode('auto') }}
                    className="text-xs text-zinc-400 hover:text-red-600 transition-colors flex items-center gap-1">
                    <X className="w-3 h-3" /> Șterge & scrie manual
                  </button>
                ) : (
                  <span className={`text-xs font-mono ${wc < 300 ? 'text-red-500' : 'text-zinc-400'}`}>{wc} cuvinte</span>
                )}
              </div>
              {layoutMode === 'rich' && looksLikeHtml(content) ? (
                <div
                  className="prose prose-sm max-w-none font-serif text-zinc-800 dark:text-zinc-200 max-h-[520px] overflow-y-auto rounded-lg bg-zinc-50 dark:bg-zinc-950 p-4 border border-zinc-100 dark:border-zinc-800 prose-headings:font-serif prose-headings:font-bold prose-strong:font-bold prose-table:text-sm [&_td]:border [&_th]:border [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              ) : (
                <textarea value={content} onChange={e => setContent(e.target.value)}
                  placeholder="Scrie aici textul articolului. Minimum 300 de caractere pentru corectura AI..."
                  rows={20}
                  className="w-full px-1 py-2 text-sm leading-relaxed border-0 bg-transparent text-zinc-900 dark:text-white focus:outline-none resize-y font-serif" />
              )}
            </div>

            {/* Image — same pattern as ArticleEditor */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-3">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-2">Imagine copertă</p>
              {imageUrl && (
                <div className="relative">
                  <img src={imageUrl} alt="Cover" className="w-full aspect-video object-cover rounded-lg" />
                  <button onClick={() => { setImageUrl(''); setImageCredit('') }}
                    className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 rounded-full transition-colors"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://... sau încarcă / generează mai jos"
                className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-transparent text-zinc-900 dark:text-white" />
              <input ref={uploadRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="editor-img-upload" />
              <label htmlFor="editor-img-upload"
                className={`flex items-center justify-center gap-2 w-full py-2.5 border rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors ${uploading ? 'border-zinc-200 text-zinc-300 cursor-not-allowed' : 'border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:text-zinc-700 hover:border-zinc-400'}`}>
                {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Upload...</> : <><Upload className="w-3.5 h-3.5" /> De pe calculator</>}
              </label>
              <button onClick={generateCover} disabled={generating || (!title && !proofResult?.title_ro)}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors disabled:opacity-50">
                {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generează...</> : <><Wand2 className="w-3.5 h-3.5" /> Generează AI</>}
              </button>
              <div>
                <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Sursă / creditare fotografie</label>
                <input value={imageCredit} onChange={e => setImageCredit(e.target.value)} placeholder="Imagine generată cu AI / © Reuters / Arhivă"
                  className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-transparent text-zinc-900 dark:text-white" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button onClick={runProof} disabled={proofing || wc < 50}
                  className="px-6 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
                  {proofing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {proofing ? 'Se corectează...' : 'Corectează & Pregătește'}
                </button>
                <button onClick={() => saveDraft(false)} disabled={saving || !content}
                  className="px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 font-medium rounded-lg hover:bg-zinc-200 disabled:opacity-50 transition-colors flex items-center gap-2 text-sm">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvează ciornă
                </button>
              </div>
              <p className="text-xs text-zinc-400">
                AI-ul va corecta textul, va genera titlu sugerat, excerpt, rezumat (60-80 cuvinte), slug, 6-9 tag-uri SEO, meta title, meta description {translate ? 'și traducerea automată în ' + (language === 'ro' ? 'engleză' : 'română') : ''}.
              </p>
            </div>
          </div>
        )}

        {/* ═══ TAB: REVIEW ═══ */}
        {tab === 'review' && proofResult?.ok && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">Corecturi</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-white">{corrections.filter(c => c.kind === 'text').length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">Format</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-white">{corrections.filter(c => c.kind === 'format').length}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">Modificare</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-white">{((proofResult.change_ratio || 0) * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">Cuvinte</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-white">{proofResult.word_count || 0}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400">Timp AI</p>
                <p className="text-2xl font-bold text-zinc-900 dark:text-white">{proofResult._meta?.elapsed_s || '?'}s</p>
              </div>
            </div>

            {proofResult.voice_warning && (
              <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>Atenție: AI-ul a modificat mai mult de 18% din text. Verifică atent fiecare corectură.</span>
              </div>
            )}

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-3">Corecturi propuse</h2>
              {corrections.length === 0 && <p className="text-sm text-zinc-400">Nicio corectură necesară. Textul este impecabil.</p>}
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {corrections.map((c, i) => {
                  const isAccepted = c.accepted !== false // default true
                  return (
                    <div key={i}
                      className={`p-3 rounded-lg border-2 transition-all ${
                        isAccepted
                          ? 'border-green-500 bg-green-50 dark:bg-green-950/40 shadow-sm'
                          : 'border-red-400 bg-red-50 dark:bg-red-950/40 opacity-60'
                      }`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 text-sm space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${c.kind === 'format' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                              {c.kind === 'format' ? 'FORMAT' : 'TEXT'}
                            </span>
                            <span className="text-zinc-500 text-xs">{c.reason}</span>
                            <span className={`ml-auto px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                              isAccepted ? 'bg-green-600 text-white' : 'bg-red-500 text-white'
                            }`}>
                              {isAccepted ? '✓ Acceptată' : '✕ Respinsă'}
                            </span>
                          </div>
                          {c.before && <p className="text-red-600 line-through text-xs font-mono bg-red-50 dark:bg-red-950/50 px-2 py-1 rounded">{c.before}</p>}
                          {c.after && <p className="text-green-700 text-xs font-mono bg-green-50 dark:bg-green-950/50 px-2 py-1 rounded">{c.after}</p>}
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button
                            onClick={() => {
                              const u = [...corrections]
                              u[i] = { ...c, accepted: true }
                              setCorrections(u)
                            }}
                            title="Acceptă această corectură"
                            className={`p-1.5 rounded transition-colors ${
                              isAccepted
                                ? 'bg-green-600 text-white'
                                : 'bg-zinc-100 text-zinc-500 hover:bg-green-100 hover:text-green-700'
                            }`}>
                            <CheckCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              const u = [...corrections]
                              u[i] = { ...c, accepted: false }
                              setCorrections(u)
                            }}
                            title="Respinge această corectură"
                            className={`p-1.5 rounded transition-colors ${
                              !isAccepted
                                ? 'bg-red-600 text-white'
                                : 'bg-zinc-100 text-zinc-500 hover:bg-red-100 hover:text-red-700'
                            }`}>
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {proofResult.suggested_title && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu sugerat de AI</p>
                <p className="text-lg font-bold font-serif text-zinc-900 dark:text-white">{proofResult.suggested_title}</p>
              </div>
            )}

            <button onClick={() => setTab('preview')} disabled={metaLoading}
              className="px-6 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2">
              {metaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
              {metaLoading ? 'Se generează metadatele...' : 'Previzualizare & Trimitere'}
            </button>
          </div>
        )}

        {/* ═══ TAB: PREVIEW ═══ */}
        {tab === 'preview' && proofResult?.ok && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Previzualizare articol</h2>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu</p>
                <p className="text-xl font-bold font-serif text-zinc-900 dark:text-white">{proofResult.title_ro || title}</p>
              </div>
              {proofResult.title_en && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Title (EN)</p>
                  <p className="text-lg font-serif text-zinc-700 dark:text-zinc-300">{proofResult.title_en}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Excerpt</p>
                <p className="text-sm text-zinc-600 italic">{proofResult.excerpt_ro || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
                  Rezumat ({proofResult._meta?.summary_words || 0}w{proofResult._meta?.summary_in_range ? ' ✓' : ' ⚠'})
                </p>
                <p className="text-sm text-zinc-600">{proofResult.summary_ro || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {(proofResult.tags_ro || []).map((t, i) => (
                    <span key={i} className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-full text-zinc-600">{t}</span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">SEO Title</p>
                  <p className="text-sm text-zinc-600">{proofResult.seo_title_ro || '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">SEO Description</p>
                  <p className="text-sm text-zinc-600">{proofResult.seo_description_ro || '—'}</p>
                </div>
              </div>
              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">
                  Conținut final ({wordCount(layoutMode === 'rich' ? stripHtmlToText(finalContent) : finalContent)} cuvinte
                  {corrections.length > 0 && ` — ${corrections.filter(c => c.accepted !== false).length}/${corrections.length} corecturi aplicate`})
                </p>
                {layoutMode === 'rich' && looksLikeHtml(finalContent) ? (
                  <div
                    className="max-h-96 overflow-y-auto bg-zinc-50 dark:bg-zinc-950 rounded-lg p-4 border border-zinc-100 dark:border-zinc-800 prose prose-sm max-w-none font-serif text-zinc-800 dark:text-zinc-200 prose-headings:font-serif prose-headings:font-bold prose-strong:font-bold prose-table:text-sm [&_td]:border [&_th]:border [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1"
                    dangerouslySetInnerHTML={{ __html: finalContent }}
                  />
                ) : layoutMode === 'rich' ? (
                  <div className="max-h-96 overflow-y-auto bg-zinc-50 dark:bg-zinc-950 rounded-lg p-4 border border-zinc-100 dark:border-zinc-800 space-y-3 font-serif text-zinc-800 dark:text-zinc-200">
                    {tokenizeRichBlocks(finalContent).map((b, i) => {
                      if (b.type === 'h2') return <h3 key={i} className="text-lg font-bold" dangerouslySetInnerHTML={{ __html: renderInline(b.text, false) }} />
                      if (b.type === 'h3') return <h4 key={i} className="text-base font-bold" dangerouslySetInnerHTML={{ __html: renderInline(b.text, false) }} />
                      if (b.type === 'quote') return <blockquote key={i} className="border-l-2 border-red-500 pl-3 italic text-zinc-600 dark:text-zinc-400" dangerouslySetInnerHTML={{ __html: renderInline(b.text, true) }} />
                      if (b.type === 'ul') return <ul key={i} className="list-disc pl-5 space-y-1">{b.items.map((it, j) => <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(it, false) }} />)}</ul>
                      if (b.type === 'ol') return <ol key={i} className="list-decimal pl-5 space-y-1">{b.items.map((it, j) => <li key={j} dangerouslySetInnerHTML={{ __html: renderInline(it, false) }} />)}</ol>
                      return <p key={i} className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: renderInline(b.text, true) }} />
                    })}
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto bg-zinc-50 dark:bg-zinc-950 rounded-lg p-3 border border-zinc-100 dark:border-zinc-800">
                    <pre className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">{finalContent}</pre>
                  </div>
                )}
              </div>
              {layoutMode === 'rich' && proofResult.translated_body_html && looksLikeHtml(proofResult.translated_body_html) && (
                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Versiunea {language === 'ro' ? 'EN' : 'RO'} (aspect 1:1)
                  </p>
                  <div
                    className="max-h-96 overflow-y-auto bg-zinc-50 dark:bg-zinc-950 rounded-lg p-4 border border-zinc-100 dark:border-zinc-800 prose prose-sm max-w-none font-serif text-zinc-800 dark:text-zinc-200 prose-headings:font-serif prose-headings:font-bold prose-strong:font-bold prose-table:text-sm [&_td]:border [&_th]:border [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1"
                    dangerouslySetInnerHTML={{ __html: proofResult.translated_body_html }}
                  />
                </div>
              )}
              {proofResult._meta?.translated && !(layoutMode === 'rich' && proofResult.translated_body_html) && (
                <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Traducerea {language === 'ro' ? 'EN' : 'RO'} a fost generată
                  </p>
                </div>
              )}
            </div>

            {!imageUrl && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                <ImageIcon className="w-4 h-4" /> Nicio imagine de copertă. Poți adăuga una din tab-ul &bdquo;Scrie&rdquo;.
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={publish} disabled={publishing}
                className="px-6 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {publishing ? 'Se trimite...' : 'Trimite articolul'}
              </button>
              <button onClick={() => setTab('review')}
                className="px-4 py-2.5 text-sm text-zinc-600 hover:text-zinc-900 transition-colors flex items-center gap-1">
                <RotateCcw className="w-4 h-4" /> Înapoi la corecturi
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 mt-12">
        <p className="text-center text-xs text-zinc-400">Transilvania Times © {new Date().getFullYear()} • Birou editorial</p>
      </div>
    </div>
  )
}
