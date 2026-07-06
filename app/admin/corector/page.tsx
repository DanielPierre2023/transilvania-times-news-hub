'use client'

// app/admin/corector/page.tsx
//
// v1 — Editor Writing Desk ("Corector")
//
// Allows human editors to write articles, get AI correction + metadata,
// review corrections, upload/search images, and publish to blog_posts.
// Works for admin users directly. Shared link version at /editor/[token]
// uses the same core UI with token-gated auth.
//
// Flow: Write → Corectează (calls tt-proof-article) → Review corrections
// → Accept/reject each → Preview metadata → Publish

import { useEffect, useState, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  PenLine, CheckCircle, XCircle, Wand2, Send, Save, Eye,
  AlertTriangle, ChevronDown, ChevronUp, Image as ImageIcon,
  Upload, Search, Globe, FileText, Loader2, X, RotateCcw
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Author {
  id: string; slug: string; editor_key: string
  name_ro: string; avatar_url: string | null
}

interface Correction {
  before: string; after: string; reason: string; kind: 'text' | 'format'
  accepted?: boolean
}

interface ProofResult {
  ok: boolean
  error?: string
  language?: string
  slug?: string
  corrections?: Correction[]
  corrections_count?: number
  format_warnings?: string[]
  change_ratio?: number
  voice_warning?: boolean
  word_count?: number
  original_title?: string
  suggested_title?: string
  title_ro?: string; content_ro?: string; excerpt_ro?: string; summary_ro?: string
  tags_ro?: string[]; seo_title_ro?: string; seo_description_ro?: string
  title_en?: string; content_en?: string; excerpt_en?: string; summary_en?: string
  tags_en?: string[]; seo_title_en?: string; seo_description_en?: string
  _meta?: { elapsed_s: number; summary_words: number; summary_in_range: boolean; translated: boolean }
}

interface DraftRow {
  id: string; title: string; content: string; category: string; county: string | null
  status: string; updated_at: string; editor_key: string; language: string
  proof_result: ProofResult | null; image_url: string | null; image_credit: string | null
  word_count: number; translate: boolean; blog_post_id: string | null
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function wordCount(t: string): number {
  return t ? t.trim().split(/\s+/).filter(w => w.length > 0).length : 0
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

export default function CorectorPage() {
  // Supabase
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // State — author
  const [authors, setAuthors] = useState<Author[]>([])
  const [selectedAuthor, setSelectedAuthor] = useState<Author | null>(null)

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

  // State — proof
  const [proofResult, setProofResult] = useState<ProofResult | null>(null)
  const [corrections, setCorrections] = useState<Correction[]>([])

  // State — UI
  const [tab, setTab] = useState<Tab>('write')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [proofing, setProofing] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [showDrafts, setShowDrafts] = useState(false)
  const [showUnsplash, setShowUnsplash] = useState(false)
  const [unsplashQuery, setUnsplashQuery] = useState('')
  const [unsplashResults, setUnsplashResults] = useState<Array<{ url: string; credit: string; thumb: string }>>([])
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load authors
  useEffect(() => {
    supabase.from('authors').select('id, slug, editor_key, name_ro, avatar_url').eq('active', true).order('name_ro')
      .then(({ data }) => {
        if (data) {
          setAuthors(data as Author[])
          const daniel = data.find((a: Author) => a.editor_key === 'daniel_dobos')
          if (daniel) setSelectedAuthor(daniel as Author)
        }
      })
  }, [])

  // ── Load drafts for selected author
  const loadDrafts = useCallback(async () => {
    if (!selectedAuthor) return
    const { data } = await supabase.from('editor_drafts')
      .select('*').eq('author_id', selectedAuthor.id)
      .order('updated_at', { ascending: false }).limit(20)
    if (data) setDrafts(data as DraftRow[])
  }, [selectedAuthor, supabase])

  useEffect(() => { if (selectedAuthor) loadDrafts() }, [selectedAuthor, loadDrafts])

  // ── Auto-save (debounced 3s)
  useEffect(() => {
    if (!selectedAuthor || !content || content.length < 50) return
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => saveDraft(true), 3000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  }, [title, content, category, county])

  // ── Save draft
  async function saveDraft(auto = false) {
    if (!selectedAuthor || !content) return
    if (!auto) setSaving(true)
    const row = {
      author_id: selectedAuthor.id, editor_key: selectedAuthor.editor_key,
      title, content, category, county: county || null, language, translate,
      image_url: imageUrl || null, image_credit: imageCredit || null,
      word_count: wordCount(content), status: proofResult?.ok ? 'proofed' : 'draft',
      proof_result: proofResult || null,
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

  // ── Load a draft
  function loadDraft(d: DraftRow) {
    setDraftId(d.id); setTitle(d.title); setContent(d.content)
    setCategory(d.category); setCounty(d.county || ''); setLanguage((d.language || 'ro') as 'ro' | 'en')
    setTranslate(d.translate); setImageUrl(d.image_url || ''); setImageCredit(d.image_credit || '')
    if (d.proof_result?.ok) {
      setProofResult(d.proof_result); setCorrections(d.proof_result.corrections || [])
    } else {
      setProofResult(null); setCorrections([])
    }
    setShowDrafts(false); setTab('write')
  }

  // ── New draft
  function newDraft() {
    setDraftId(null); setTitle(''); setContent(''); setCategory('opinion')
    setCounty(''); setLanguage('ro'); setTranslate(true); setImageUrl(''); setImageCredit('')
    setProofResult(null); setCorrections([]); setTab('write'); setError(''); setSuccess('')
  }

  // ── Run tt-proof-article
  async function runProof() {
    if (!content || content.length < 300) { setError('Textul trebuie să aibă minim 300 de caractere.'); return }
    setProofing(true); setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('tt-proof-article', {
        body: {
          text: content, title: title || undefined,
          author_name: selectedAuthor?.name_ro || 'Redacția',
          category, county: county || undefined,
          language, translate, format_mode: 'enforce',
        },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (!data?.ok) throw new Error(data?.error || 'Corectura a eșuat.')
      setProofResult(data as ProofResult)
      const corr = (data.corrections || []).map((c: Correction) => ({ ...c, accepted: true }))
      setCorrections(corr)
      setTab('review')
      await saveDraft(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProofing(false)
    }
  }

  // ── Apply accepted corrections to produce final content
  function buildFinalContent(): ProofResult | null {
    if (!proofResult?.ok) return null
    // The proofResult already contains the fully corrected content.
    // Rejected corrections need to be unapplied — for simplicity, we use
    // the proofed content as-is (all corrections already applied by the AI).
    // Individual reject would require diffing — phase 2.
    return proofResult
  }

  // ── Publish to blog_posts
  async function publish() {
    if (!selectedAuthor || !proofResult?.ok) return
    setPublishing(true); setError('')
    try {
      const pr = proofResult
      const slug = pr.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 60) + '-' + Math.random().toString(36).substring(2, 8)
      const readingTime = Math.max(1, Math.round((pr.word_count || wordCount(content)) / 200))

      const row: Record<string, unknown> = {
        slug,
        title_ro: pr.title_ro || title,
        content_ro: pr.content_ro || content,
        excerpt_ro: pr.excerpt_ro || '',
        summary_ro: pr.summary_ro || '',
        tags_ro: pr.tags_ro || [],
        seo_title_ro: pr.seo_title_ro || (pr.title_ro || title).substring(0, 60),
        seo_description_ro: pr.seo_description_ro || '',
        title_en: pr.title_en || '',
        content_en: pr.content_en || '',
        excerpt_en: pr.excerpt_en || '',
        summary_en: pr.summary_en || '',
        tags_en: pr.tags_en || [],
        seo_title_en: pr.seo_title_en || '',
        seo_description_en: pr.seo_description_en || '',
        category,
        county: county || null,
        author_name: selectedAuthor.name_ro,
        author_id: selectedAuthor.id,
        ai_editor: null,
        cover_image: imageUrl || null,
        cover_image_credit: imageCredit || null,
        reading_time_min: readingTime,
        word_count: pr.word_count || wordCount(content),
        status: 'draft',
      }

      const { data, error: insertErr } = await supabase.from('blog_posts').insert(row).select('id').single()
      if (insertErr) throw new Error(insertErr.message)
      if (!data) throw new Error('Insert returned no data')

      // Update draft status
      if (draftId) {
        await supabase.from('editor_drafts').update({ status: 'published', blog_post_id: data.id }).eq('id', draftId)
      }

      setSuccess(`Articolul a fost creat ca ciornă (ID: ${data.id.substring(0, 8)}...). Mergi la Articole pentru a-l publica.`)
      loadDrafts()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  // ── Image search (Unsplash via Supabase edge function or direct)
  async function searchUnsplash() {
    if (!unsplashQuery) return
    setUnsplashResults([])
    try {
      const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(unsplashQuery)}&per_page=9&orientation=landscape`, {
        headers: { Authorization: `Client-ID ${process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY || ''}` },
      })
      if (!res.ok) return
      const data = await res.json()
      setUnsplashResults((data.results || []).map((r: { urls: { regular: string; small: string }; user: { name: string } }) => ({
        url: r.urls.regular, thumb: r.urls.small, credit: `Foto: ${r.user.name} / Unsplash`,
      })))
    } catch { /* silent */ }
  }

  const wc = wordCount(content)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <PenLine className="w-6 h-6 text-red-600" /> Corector Editorial
          </h1>
          <p className="text-sm text-zinc-500">Scrie, corectează automat, publică</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={newDraft} className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors">
            + Articol nou
          </button>
          <button onClick={() => { setShowDrafts(!showDrafts); if (!showDrafts) loadDrafts() }}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" /> Ciorne {showDrafts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Drafts panel */}
      {showDrafts && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-2">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide mb-2">Ciorne recente</p>
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

      {/* Author selector + settings row */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Author */}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Autor</label>
            <select value={selectedAuthor?.editor_key || ''} onChange={e => {
              const a = authors.find(x => x.editor_key === e.target.value)
              if (a) setSelectedAuthor(a)
            }} className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
              {authors.map(a => <option key={a.editor_key} value={a.editor_key}>{a.name_ro}</option>)}
            </select>
          </div>
          {/* Category */}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Categorie</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {/* County */}
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Județ</label>
            <select value={county} onChange={e => setCounty(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white">
              {COUNTIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          {/* Language + translate */}
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
                <input type="checkbox" checked={translate} onChange={e => setTranslate(e.target.checked)}
                  className="rounded border-zinc-300" />
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  <Globe className="w-3 h-3 inline" /> Traducere
                </span>
              </label>
            </div>
          </div>
        </div>
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
          {/* Title */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu (opțional — AI va sugera unul)</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titlul articolului..."
              className="w-full px-3 py-2 text-lg font-bold border-0 border-b border-zinc-200 dark:border-zinc-700 bg-transparent text-zinc-900 dark:text-white focus:outline-none focus:border-red-500 font-serif" />
          </div>

          {/* Content */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-wide text-zinc-400">Textul articolului</label>
              <span className={`text-xs font-mono ${wc < 300 ? 'text-red-500' : 'text-zinc-400'}`}>{wc} cuvinte</span>
            </div>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              placeholder="Scrie aici textul articolului. Minimum 300 de caractere pentru a putea rula corectura AI..."
              rows={20}
              className="w-full px-1 py-2 text-sm leading-relaxed border-0 bg-transparent text-zinc-900 dark:text-white focus:outline-none resize-y font-serif" />
          </div>

          {/* Image */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <label className="block text-[10px] uppercase tracking-wide text-zinc-400 mb-2">
              <ImageIcon className="w-3 h-3 inline" /> Imagine de copertă
            </label>
            {imageUrl && (
              <div className="mb-3 relative">
                <img src={imageUrl} alt="Cover" className="w-full h-48 object-cover rounded-lg" />
                <button onClick={() => { setImageUrl(''); setImageCredit('') }}
                  className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1"><X className="w-4 h-4" /></button>
                {imageCredit && <p className="text-[10px] text-zinc-400 mt-1">{imageCredit}</p>}
              </div>
            )}
            <div className="flex gap-2">
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="URL imagine sau caută Unsplash..."
                className="flex-1 px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-transparent text-zinc-900 dark:text-white" />
              <button onClick={() => setShowUnsplash(!showUnsplash)}
                className="px-3 py-2 text-sm bg-zinc-100 dark:bg-zinc-800 rounded-lg hover:bg-zinc-200 transition-colors flex items-center gap-1">
                <Search className="w-3.5 h-3.5" /> Unsplash
              </button>
            </div>
            {showUnsplash && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                  <input value={unsplashQuery} onChange={e => setUnsplashQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchUnsplash()}
                    placeholder="Caută imagini..." className="flex-1 px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-transparent" />
                  <button onClick={searchUnsplash} className="px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">Caută</button>
                </div>
                {unsplashResults.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {unsplashResults.map((r, i) => (
                      <button key={i} onClick={() => { setImageUrl(r.url); setImageCredit(r.credit); setShowUnsplash(false) }}
                        className="rounded-lg overflow-hidden hover:ring-2 ring-red-500 transition-all">
                        <img src={r.thumb} alt="" className="w-full h-24 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
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
        </div>
      )}

      {/* ═══ TAB: REVIEW ═══ */}
      {tab === 'review' && proofResult?.ok && (
        <div className="space-y-4">
          {/* Stats bar */}
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

          {/* Voice warning */}
          {proofResult.voice_warning && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Atenție: AI-ul a modificat mai mult de 18% din text. Verifică atent fiecare corectură.</span>
            </div>
          )}

          {/* Corrections list */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
            <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-3">Corecturi propuse</h2>
            {corrections.length === 0 && <p className="text-sm text-zinc-400">Nicio corectură necesară. Textul este impecabil.</p>}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {corrections.map((c, i) => (
                <div key={i} className={`p-3 rounded-lg border ${c.accepted !== false ? 'border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/30' : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 text-sm space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${c.kind === 'format' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                          {c.kind === 'format' ? 'FORMAT' : 'TEXT'}
                        </span>
                        <span className="text-zinc-500 text-xs">{c.reason}</span>
                      </div>
                      {c.before && (
                        <p className="text-red-600 dark:text-red-400 line-through text-xs font-mono bg-red-50 dark:bg-red-950/50 px-2 py-1 rounded">
                          {c.before}
                        </p>
                      )}
                      {c.after && (
                        <p className="text-green-700 dark:text-green-400 text-xs font-mono bg-green-50 dark:bg-green-950/50 px-2 py-1 rounded">
                          {c.after}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { const u = [...corrections]; u[i] = { ...c, accepted: true }; setCorrections(u) }}
                        className={`p-1 rounded ${c.accepted !== false ? 'text-green-600 bg-green-100' : 'text-zinc-400 hover:text-green-600'}`}>
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => { const u = [...corrections]; u[i] = { ...c, accepted: false }; setCorrections(u) }}
                        className={`p-1 rounded ${c.accepted === false ? 'text-red-600 bg-red-100' : 'text-zinc-400 hover:text-red-600'}`}>
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Suggested title */}
          {proofResult.suggested_title && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu sugerat de AI</p>
              <p className="text-lg font-bold font-serif text-zinc-900 dark:text-white">{proofResult.suggested_title}</p>
              {proofResult.original_title && (
                <p className="text-xs text-zinc-400 mt-1">Titlul tău original: „{proofResult.original_title}"</p>
              )}
            </div>
          )}

          {/* Proceed to preview */}
          <button onClick={() => setTab('preview')}
            className="px-6 py-2.5 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2">
            <Eye className="w-4 h-4" /> Previzualizare & Publicare
          </button>
        </div>
      )}

      {/* ═══ TAB: PREVIEW ═══ */}
      {tab === 'preview' && proofResult?.ok && (
        <div className="space-y-4">
          {/* Metadata preview */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 space-y-4">
            <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300">Previzualizare articol</h2>

            {/* Title */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu RO</p>
              <p className="text-xl font-bold font-serif text-zinc-900 dark:text-white">{proofResult.title_ro || title}</p>
            </div>
            {proofResult.title_en && (
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Titlu EN</p>
                <p className="text-lg font-serif text-zinc-700 dark:text-zinc-300">{proofResult.title_en}</p>
              </div>
            )}

            {/* Excerpt */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Excerpt RO</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 italic">{proofResult.excerpt_ro || '—'}</p>
            </div>

            {/* Summary */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">
                Rezumat RO ({proofResult._meta?.summary_words || 0}w{proofResult._meta?.summary_in_range ? ' ✓' : ' ⚠'})
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{proofResult.summary_ro || '—'}</p>
            </div>

            {/* Tags */}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Tags RO</p>
              <div className="flex flex-wrap gap-1">
                {(proofResult.tags_ro || []).map((t, i) => (
                  <span key={i} className="px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 rounded-full text-zinc-600 dark:text-zinc-400">{t}</span>
                ))}
                {(!proofResult.tags_ro || proofResult.tags_ro.length === 0) && <span className="text-xs text-zinc-400">—</span>}
              </div>
            </div>

            {/* SEO */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">SEO Title</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{proofResult.seo_title_ro || '—'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">SEO Description</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{proofResult.seo_description_ro || '—'}</p>
              </div>
            </div>

            {/* Translation status */}
            {proofResult._meta?.translated && (
              <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" /> Traducerea {language === 'ro' ? 'EN' : 'RO'} a fost generată
                </p>
              </div>
            )}
          </div>

          {/* Image reminder */}
          {!imageUrl && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <ImageIcon className="w-4 h-4" /> Nicio imagine de copertă. Poți adăuga una din tab-ul „Scrie".
            </div>
          )}

          {/* Publish */}
          <div className="flex items-center gap-3">
            <button onClick={publish} disabled={publishing}
              className="px-6 py-2.5 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center gap-2">
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {publishing ? 'Se publică...' : 'Creează articol (ciornă)'}
            </button>
            <button onClick={() => setTab('review')}
              className="px-4 py-2.5 text-sm text-zinc-600 hover:text-zinc-900 transition-colors flex items-center gap-1">
              <RotateCcw className="w-4 h-4" /> Înapoi la corecturi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}