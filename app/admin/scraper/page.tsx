'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  RefreshCw, CheckCircle2, XCircle, Clock,
  ExternalLink, AlertCircle, Loader2, Rss, Sparkles, Trash2, Plus, ListOrdered,
} from 'lucide-react'

// ─── TYPES ───────────────────────────────────────────────────────────────────
interface ScrapedArticle {
  id: string
  original_title: string
  original_url: string
  category: string | null
  county: string | null
  status: 'scraped' | 'processed' | 'failed' | 'used'
  ai_score: number | null
  created_at: string
  rewrite_error: string | null
  draft_post_id?: string | null
  draft_slug?: string | null
}

interface RssSource {
  id: string
  name: string
  url: string
  is_active: boolean
  output_limit: number
  last_scraped_at: string | null
  category: string | null
  source_language: string | null
}

// Categories matching the editorial pipeline taxonomy. 'auto-detect' lets the
// processor classify the article from its content rather than locking it in.
const SOURCE_CATEGORIES = [
  'auto-detect', 'news', 'politics', 'technology', 'business',
  'culture', 'travel', 'education', 'sports', 'health', 'opinion',
] as const

const SOURCE_LANGUAGES = [
  { code: 'ro', label: 'Română' },
  { code: 'en', label: 'English' },
] as const

type Tab = 'queue' | 'sources'

// ─── STATUS BADGE ─────────────────────────────────────────────────────────────
function StatusBadge({ status, score }: { status: ScrapedArticle['status']; score: number | null }) {
  const map: Record<ScrapedArticle['status'], { label: string; cls: string }> = {
    scraped:   { label: 'Neprocesat',  cls: 'bg-amber-100 text-amber-800 border border-amber-200' },
    processed: { label: 'Procesat',    cls: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
    used:      { label: 'Folosit',     cls: 'bg-blue-100 text-blue-800 border border-blue-200' },
    failed:    { label: 'Eșuat',       cls: 'bg-red-100 text-red-800 border border-red-200' },
  }
  const { label, cls } = map[status] ?? map.scraped
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${cls}`}>
      {status === 'processed' && <CheckCircle2 className="w-3 h-3" />}
      {status === 'failed'    && <XCircle      className="w-3 h-3" />}
      {status === 'scraped'   && <Clock        className="w-3 h-3" />}
      {label}
      {score !== null && status === 'processed' && (
        <span className="ml-1 opacity-70">· {score}/100</span>
      )}
    </span>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
//
// v2 (June 3, 2026) — SEQUENTIAL PROCESSING QUEUE
//
// THE BUG WE FIXED:
//   The previous implementation tracked `processing` as a single string (the
//   id of the article currently being processed). When the user clicked "AI
//   Rescrie" on multiple articles in quick succession:
//     1. setProcessing(A.id) — button A disabled, fetch A starts
//     2. setProcessing(B.id) — button A re-enables (state no longer === A),
//        fetch B starts CONCURRENTLY
//     3. etc.
//   Each tt-process-scraped-article call takes 70-90 seconds. Browsers cap
//   concurrent HTTP connections to the same origin at 6. The 7th click sat
//   queued in the browser stack; the Supabase JS fetch eventually timed out
//   and returned an error to the UI.
//
// THE FIX:
//   - A real FIFO queue (queueRef + queueState). Click "AI Rescrie" enqueues
//     the article. A worker loop drains the queue one article at a time.
//   - Only ONE fetch is ever in flight, so the 6-connection limit is never hit.
//   - The button state for each article reflects its position: queued (with
//     position number), currently processing (spinner), or available.
//   - The bulk button enqueues ALL scraped articles into the local queue, so
//     they get processed sequentially over time instead of relying on the
//     server's process_all mode (which only handles one article per call).
//
export default function ScraperFinal() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [tab,              setTab]              = useState<Tab>('queue')
  const [articles,         setArticles]         = useState<ScrapedArticle[]>([])
  const [sources,          setSources]          = useState<RssSource[]>([])
  const [loading,          setLoading]          = useState(false)
  const [scraping,         setScraping]         = useState(false)
  const [toast,            setToast]            = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // ── Sequential queue state ───────────────────────────────────────────────
  // queueRef is the source of truth (mutable, stable across renders);
  // queueState mirrors it for UI rendering. processingId is the article
  // currently being processed (if any).
  const queueRef                                = useRef<string[]>([])
  const workerRunningRef                        = useRef<boolean>(false)
  const [queueState,       setQueueState]       = useState<string[]>([])
  const [processingId,     setProcessingId]     = useState<string | null>(null)

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set())
  const [selectedSources,  setSelectedSources]  = useState<Set<string>>(new Set())
  const [deletingArticles, setDeletingArticles] = useState(false)
  const [deletingSources,  setDeletingSources]  = useState(false)

  // ── Add-source form state ─────────────────────────────────────────────────
  const [newUrl,      setNewUrl]      = useState('')
  const [newName,     setNewName]     = useState('')
  const [newCategory, setNewCategory] = useState<string>('auto-detect')
  const [newLang,     setNewLang]     = useState<string>('ro')
  const [adding,      setAdding]      = useState(false)

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4500)
  }

  // ── fetch queue ──────────────────────────────────────────────────────────
  const fetchArticles = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('scraped_articles')
        .select(`id, original_title, original_url, category, county, status, ai_score, created_at, rewrite_error`)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error

      const processed = (data ?? []).filter(a => a.status === 'processed')
      const postMap: Record<string, { id: string; slug: string }> = {}
      if (processed.length > 0) {
        const { data: posts } = await supabase
          .from('blog_posts')
          .select('id, slug, scraped_article_id')
          .in('scraped_article_id', processed.map(a => a.id))
        ;(posts ?? []).forEach(p => {
          postMap[p.scraped_article_id] = { id: p.id, slug: p.slug }
        })
      }

      setArticles(
        (data ?? []).map(a => ({
          ...a,
          draft_post_id: postMap[a.id]?.id  ?? null,
          draft_slug:    postMap[a.id]?.slug ?? null,
        }))
      )
      // Clear selection when list refreshes
      setSelectedArticles(new Set())
    } catch (err: unknown) {
      showToast(`Eroare la încărcare: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setLoading(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── fetch sources ─────────────────────────────────────────────────────────
  const fetchSources = useCallback(async () => {
    const { data } = await supabase
      .from('rss_sources')
      .select('*')
      .order('name')
    setSources(data ?? [])
    setSelectedSources(new Set())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchArticles()
    fetchSources()
  }, [fetchArticles, fetchSources])

  // ── run scraper ───────────────────────────────────────────────────────────
  const runScraper = async () => {
    setScraping(true)
    try {
      const { data, error } = await supabase.functions.invoke('tt-scrape-rss', { body: {} })
      if (error) throw error
      showToast(`Scraper finalizat: ${data?.total_scraped ?? 0} articole noi`, 'ok')
      await fetchArticles()
    } catch (err: unknown) {
      showToast(`Eroare scraper: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setScraping(false)
    }
  }

  // ── process a SINGLE article (called only by the worker, never directly) ─
  const processSingleArticle = useCallback(async (articleId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.functions.invoke('tt-process-scraped-article', {
        body: { article_id: articleId, mode: 'manual' },
      })
      if (error) throw error
      const result = data?.results?.[0]
      if (!result?.post_id) {
        throw new Error(result?.error ?? `Răspuns neașteptat: ${JSON.stringify(data)}`)
      }
      return true
    } catch (err: unknown) {
      showToast(`Eroare procesare: ${err instanceof Error ? err.message : String(err)}`, 'err')
      return false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Worker loop — drains the queue one article at a time ─────────────────
  // Started by enqueueArticle/enqueueAll if not already running. Runs until
  // queue is empty, then exits. Only ONE worker instance ever runs at a time
  // (guarded by workerRunningRef).
  const startWorker = useCallback(async () => {
    if (workerRunningRef.current) return
    workerRunningRef.current = true

    let processedCount = 0
    let failedCount = 0

    try {
      while (queueRef.current.length > 0) {
        const articleId = queueRef.current[0]
        setProcessingId(articleId)

        const ok = await processSingleArticle(articleId)
        if (ok) processedCount++
        else failedCount++

        // Remove from queue (head) regardless of success — failed articles
        // get their failure logged but don't block the queue
        queueRef.current = queueRef.current.slice(1)
        setQueueState([...queueRef.current])
      }

      if (processedCount > 0 || failedCount > 0) {
        const msg = failedCount > 0
          ? `Lot finalizat: ${processedCount} reușite, ${failedCount} eșuate`
          : `Lot finalizat: ${processedCount} articole procesate ✓`
        showToast(msg, failedCount > 0 ? 'err' : 'ok')
      }
    } finally {
      setProcessingId(null)
      workerRunningRef.current = false
      // Refresh the article list to reflect new statuses
      await fetchArticles()
    }
  }, [processSingleArticle, fetchArticles])

  // ── Enqueue ONE article (user clicked "AI Rescrie" on a single row) ──────
  const enqueueArticle = useCallback((article: ScrapedArticle) => {
    // Reject if already queued or being processed
    if (queueRef.current.includes(article.id) || processingId === article.id) return
    queueRef.current = [...queueRef.current, article.id]
    setQueueState([...queueRef.current])
    // Kick off worker if idle (safe — startWorker guards against double-start)
    startWorker()
  }, [processingId, startWorker])

  // ── Enqueue ALL scraped articles (the bulk button) ───────────────────────
  // Replaces the old bulkProcess that called the server's process_all mode.
  // The server only processes ONE article per call, so the old button was
  // misleading (clicked = 1 article processed). This enqueues every pending
  // article locally; the worker drains them sequentially.
  const enqueueAllScraped = useCallback(() => {
    const ids = articles
      .filter(a => a.status === 'scraped')
      .map(a => a.id)
      .filter(id => !queueRef.current.includes(id) && processingId !== id)

    if (ids.length === 0) {
      showToast('Nimic nou de adăugat în coadă', 'err')
      return
    }
    queueRef.current = [...queueRef.current, ...ids]
    setQueueState([...queueRef.current])
    showToast(`${ids.length} articole adăugate în coadă`, 'ok')
    startWorker()
  }, [articles, processingId, startWorker])

  // ── Cancel queued article (NOT one in progress) ──────────────────────────
  const dequeueArticle = useCallback((articleId: string) => {
    queueRef.current = queueRef.current.filter(id => id !== articleId)
    setQueueState([...queueRef.current])
  }, [])

  // ── toggle source active ──────────────────────────────────────────────────
  const toggleSource = async (id: string, current: boolean) => {
    await supabase.from('rss_sources').update({ is_active: !current }).eq('id', id)
    await fetchSources()
  }

  // ── delete selected articles ──────────────────────────────────────────────
  const deleteSelectedArticles = async () => {
    if (selectedArticles.size === 0) return
    if (!confirm(`Ștergi ${selectedArticles.size} articole și ciornele asociate? Articolele publicate nu vor fi afectate. Acțiunea este ireversibilă.`)) return
    setDeletingArticles(true)
    try {
      // Delete linked blog_posts drafts only — never touch published articles
      await supabase
        .from('blog_posts')
        .delete()
        .in('scraped_article_id', [...selectedArticles])
        .neq('status', 'published')

      // Delete the scraped_articles rows
      const { error } = await supabase
        .from('scraped_articles')
        .delete()
        .in('id', [...selectedArticles])
      if (error) throw error

      showToast(`${selectedArticles.size} articole și ciornele asociate șterse ✓`, 'ok')
      await fetchArticles()
    } catch (err: unknown) {
      showToast(`Eroare ștergere: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setDeletingArticles(false)
    }
  }

  // ── add new RSS source ────────────────────────────────────────────────────
  const addSource = async () => {
    const url = newUrl.trim()
    if (!url) {
      showToast('Adaugă mai întâi un URL de feed RSS.', 'err')
      return
    }
    let derivedName = newName.trim()
    try {
      const parsed = new URL(url)
      if (!derivedName) derivedName = parsed.hostname.replace(/^www\./, '')
    } catch {
      showToast('URL invalid. Exemplu: https://example.com/feed/', 'err')
      return
    }

    setAdding(true)
    try {
      const dup = sources.find(s => s.url.trim().toLowerCase() === url.toLowerCase())
      if (dup) {
        showToast(`Sursa există deja: ${dup.name}`, 'err')
        return
      }

      const { error } = await supabase.from('rss_sources').insert({
        name:             derivedName,
        url,
        category:         newCategory,
        source_language:  newLang,
        is_active:        true,
      })
      if (error) throw error

      showToast(`Sursă adăugată: ${derivedName} ✓`, 'ok')
      setNewUrl('')
      setNewName('')
      await fetchSources()
    } catch (err: unknown) {
      showToast(`Eroare adăugare: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setAdding(false)
    }
  }

  // ── delete selected sources ───────────────────────────────────────────────
  const deleteSelectedSources = async () => {
    if (selectedSources.size === 0) return
    if (!confirm(`Ștergi ${selectedSources.size} surse RSS? Acțiunea este ireversibilă.`)) return
    setDeletingSources(true)
    try {
      const { error } = await supabase
        .from('rss_sources')
        .delete()
        .in('id', [...selectedSources])
      if (error) throw error
      showToast(`${selectedSources.size} surse șterse ✓`, 'ok')
      await fetchSources()
    } catch (err: unknown) {
      showToast(`Eroare ștergere: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setDeletingSources(false)
    }
  }

  // ── select all helpers ────────────────────────────────────────────────────
  const allArticlesSelected = articles.length > 0 && selectedArticles.size === articles.length
  const allSourcesSelected  = sources.length  > 0 && selectedSources.size  === sources.length

  const toggleAllArticles = () => {
    if (allArticlesSelected) {
      setSelectedArticles(new Set())
    } else {
      setSelectedArticles(new Set(articles.map(a => a.id)))
    }
  }

  const toggleAllSources = () => {
    if (allSourcesSelected) {
      setSelectedSources(new Set())
    } else {
      setSelectedSources(new Set(sources.map(s => s.id)))
    }
  }

  const toggleArticle = (id: string) => {
    setSelectedArticles(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSource2 = (id: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ─── COUNTS ───────────────────────────────────────────────────────────────
  const countScraped   = articles.filter(a => a.status === 'scraped').length
  const countProcessed = articles.filter(a => a.status === 'processed').length
  const countFailed    = articles.filter(a => a.status === 'failed').length
  const activeSources  = sources.filter(s => s.is_active).length
  const queueLength    = queueState.length + (processingId ? 1 : 0)

  // Build a quick lookup of an article's position in queue (1-indexed)
  // so the row can show "Pe lista de așteptare (poziția 3)"
  const queuePosition = (id: string): number | null => {
    if (processingId === id) return 0  // currently processing
    const idx = queueState.indexOf(id)
    return idx === -1 ? null : idx + 1
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f5f4f0] font-sans">

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded shadow-lg text-sm font-medium
          ${toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'ok'
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle  className="w-4 h-4 shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* ── Header ── */}
      <header className="bg-white border-b border-[#e5e2d9] px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-serif text-2xl text-[#1a1a1a]">Scraper RSS</h1>
            <p className="text-xs text-[#666] mt-0.5">
              {activeSources} surse active · {countScraped} neprocesate · {countProcessed} procesate
              {queueLength > 0 && (
                <span className="ml-2 text-violet-700 font-medium">
                  · {queueLength} în coadă
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={runScraper}
              disabled={scraping}
              className="flex items-center gap-2 px-4 py-2 bg-[#1a1a1a] text-white text-sm font-medium
                hover:bg-[#333] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rss className="w-4 h-4" />}
              {scraping ? 'Se scrapează…' : 'Rulează Scraper'}
            </button>
            {countScraped > 0 && (
              <button
                onClick={enqueueAllScraped}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium
                  hover:bg-violet-700 transition-colors"
                title="Adaugă toate articolele neprocesate în coadă. Sunt procesate unul câte unul (~80s fiecare)."
              >
                <Sparkles className="w-4 h-4" />
                AI Procesează Tot ({countScraped})
              </button>
            )}
            <button onClick={fetchArticles} disabled={loading}
              className="p-2 text-[#666] hover:text-[#1a1a1a] transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Queue status banner ── */}
      {queueLength > 0 && (
        <div className="max-w-6xl mx-auto mt-4 px-6">
          <div className="bg-violet-50 border border-violet-200 rounded px-4 py-3 flex items-center gap-3">
            <ListOrdered className="w-5 h-5 text-violet-700 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-violet-900">
                Coadă activă: {queueLength} articole în procesare
                {processingId && (
                  <span className="ml-2 text-violet-700">
                    · {articles.find(a => a.id === processingId)?.original_title.slice(0, 60) || 'Articol curent'}…
                  </span>
                )}
              </p>
              <p className="text-xs text-violet-700/80 mt-0.5">
                Articolele sunt procesate unul câte unul ca să nu blocăm browserul. ~80 de secunde per articol.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="max-w-6xl mx-auto px-6 mt-6">
        <div className="flex gap-1 border-b border-[#e5e2d9] mb-6">
          {(['queue', 'sources'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
                ${tab === t
                  ? 'border-[#c41e3a] text-[#c41e3a]'
                  : 'border-transparent text-[#666] hover:text-[#1a1a1a]'}`}
            >
              {t === 'queue' ? `Coadă (${articles.length})` : `Surse RSS (${sources.length})`}
            </button>
          ))}
        </div>

        {/* ── Queue Tab ── */}
        {tab === 'queue' && (
          <div className="space-y-2">

            {/* Selection toolbar */}
            {articles.length > 0 && (
              <div className="flex items-center justify-between bg-white border border-[#e5e2d9] px-4 py-2.5 mb-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-[#666]">
                  <input
                    type="checkbox"
                    checked={allArticlesSelected}
                    onChange={toggleAllArticles}
                    className="accent-[#c41e3a] w-4 h-4"
                  />
                  {selectedArticles.size > 0
                    ? `${selectedArticles.size} selectate`
                    : 'Selectează tot'}
                </label>
                {selectedArticles.size > 0 && (
                  <button
                    onClick={deleteSelectedArticles}
                    disabled={deletingArticles}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium
                      hover:bg-red-700 transition-colors disabled:opacity-50 rounded"
                  >
                    {deletingArticles
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2  className="w-3.5 h-3.5" />}
                    Șterge selecția ({selectedArticles.size})
                  </button>
                )}
              </div>
            )}

            {loading && (
              <div className="flex items-center gap-2 text-[#666] text-sm py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Se încarcă…
              </div>
            )}
            {!loading && articles.length === 0 && (
              <div className="text-center py-16 text-[#999]">
                <Rss className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Niciun articol în coadă. Rulează scraperul.</p>
              </div>
            )}

            {articles.map(article => (
              <ArticleRow
                key={article.id}
                article={article}
                queuePosition={queuePosition(article.id)}
                isProcessing={processingId === article.id}
                onEnqueue={() => enqueueArticle(article)}
                onDequeue={() => dequeueArticle(article.id)}
                checked={selectedArticles.has(article.id)}
                onCheck={() => toggleArticle(article.id)}
              />
            ))}

            {/* Summary bar */}
            {articles.length > 0 && (
              <div className="flex items-center gap-6 py-4 text-xs text-[#999] border-t border-[#e5e2d9] mt-4">
                <span className="text-amber-600 font-medium">{countScraped} neprocesate</span>
                <span className="text-emerald-600 font-medium">{countProcessed} procesate</span>
                {countFailed > 0 && (
                  <span className="text-red-600 font-medium">{countFailed} eșuate</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Sources Tab ── */}
        {tab === 'sources' && (
          <div className="space-y-2">

            {/* Add-source form */}
            <div className="bg-white border border-[#e5e2d9] p-4 mb-3">
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-4 h-4 text-[#666]" />
                <h3 className="text-sm font-medium text-[#333]">Adaugă sursă RSS</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2">
                <input
                  type="url"
                  placeholder="URL feed RSS (ex. https://example.com/feed/)"
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newUrl.trim()) addSource() }}
                  disabled={adding}
                  className="px-3 py-2 text-sm border border-[#e5e2d9] bg-white text-[#222]
                    focus:outline-none focus:border-[#c41e3a] disabled:opacity-50"
                />
                <input
                  type="text"
                  placeholder="Nume (opțional)"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newUrl.trim()) addSource() }}
                  disabled={adding}
                  className="px-3 py-2 text-sm border border-[#e5e2d9] bg-white text-[#222]
                    focus:outline-none focus:border-[#c41e3a] disabled:opacity-50"
                />
                <select
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  disabled={adding}
                  className="px-3 py-2 text-sm border border-[#e5e2d9] bg-white text-[#222]
                    focus:outline-none focus:border-[#c41e3a] disabled:opacity-50"
                >
                  {SOURCE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={newLang}
                  onChange={e => setNewLang(e.target.value)}
                  disabled={adding}
                  className="px-3 py-2 text-sm border border-[#e5e2d9] bg-white text-[#222]
                    focus:outline-none focus:border-[#c41e3a] disabled:opacity-50"
                >
                  {SOURCE_LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <button
                  onClick={addSource}
                  disabled={adding || !newUrl.trim()}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 bg-[#c41e3a] text-white text-sm font-medium
                    hover:bg-[#a01830] transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded"
                >
                  {adding
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Plus className="w-4 h-4" />}
                  Adaugă
                </button>
              </div>
              <p className="text-[11px] text-[#888] mt-2">
                Categoria <code>auto-detect</code> lasă procesorul să clasifice articolul după conținut.
              </p>
            </div>

            {/* Selection toolbar */}
            {sources.length > 0 && (
              <div className="flex items-center justify-between bg-white border border-[#e5e2d9] px-4 py-2.5 mb-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-[#666]">
                  <input
                    type="checkbox"
                    checked={allSourcesSelected}
                    onChange={toggleAllSources}
                    className="accent-[#c41e3a] w-4 h-4"
                  />
                  {selectedSources.size > 0
                    ? `${selectedSources.size} selectate`
                    : 'Selectează tot'}
                </label>
                {selectedSources.size > 0 && (
                  <button
                    onClick={deleteSelectedSources}
                    disabled={deletingSources}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium
                      hover:bg-red-700 transition-colors disabled:opacity-50 rounded"
                  >
                    {deletingSources
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2  className="w-3.5 h-3.5" />}
                    Șterge selecția ({selectedSources.size})
                  </button>
                )}
              </div>
            )}

            {sources.length === 0 && (
              <div className="text-center py-16 text-[#999]">
                <p className="text-sm">Nicio sursă RSS configurată.</p>
              </div>
            )}

            {sources.map(source => (
              <div key={source.id}
                className={`bg-white border border-[#e5e2d9] p-4 flex items-center gap-3
                  ${selectedSources.has(source.id) ? 'border-[#c41e3a] bg-red-50/30' : ''}`}>

                <input
                  type="checkbox"
                  checked={selectedSources.has(source.id)}
                  onChange={() => toggleSource2(source.id)}
                  className="accent-[#c41e3a] w-4 h-4 shrink-0"
                />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a1a1a]">{source.name}</p>
                  <p className="text-xs text-[#999] mt-0.5 truncate">{source.url}</p>
                  {source.last_scraped_at && (
                    <p className="text-xs text-[#bbb] mt-0.5">
                      Ultima scraping: {new Date(source.last_scraped_at).toLocaleString('ro-RO')}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-[#999]">Limită: {source.output_limit}</span>
                  <button
                    onClick={() => toggleSource(source.id, source.is_active)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors
                      ${source.is_active ? 'bg-emerald-500' : 'bg-[#ccc]'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
                      ${source.is_active ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ARTICLE ROW ──────────────────────────────────────────────────────────────
//
// The action area shows one of:
//   - "AI Rescrie" button (article is scraped, not in queue, not processing)
//   - "Se procesează…" badge (article currently being processed by the worker)
//   - "În coadă (poziția N)" + "Anulează" button (article queued, not yet processing)
//   - "Ver ciornă →" link (article processed)
//   - "Reîncearcă" button (article failed)
//
function ArticleRow({
  article,
  queuePosition,
  isProcessing,
  onEnqueue,
  onDequeue,
  checked,
  onCheck,
}: {
  article: ScrapedArticle
  queuePosition: number | null  // null = not in queue; 0 = currently processing; >=1 = position
  isProcessing: boolean
  onEnqueue: () => void
  onDequeue: () => void
  checked: boolean
  onCheck: () => void
}) {
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const h = Math.floor(diff / 3600000)
    const m = Math.floor(diff / 60000)
    if (h > 0) return `${h}h în urmă`
    if (m > 0) return `${m}min în urmă`
    return 'Acum'
  }

  const inQueue = queuePosition !== null && queuePosition > 0

  return (
    <div className={`bg-white border rounded p-4 flex items-start gap-3 transition-opacity
      ${isProcessing ? 'opacity-60 border-violet-400' : ''}
      ${checked ? 'border-[#c41e3a] bg-red-50/30' : article.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-[#e5e2d9]'}`}>

      <input
        type="checkbox"
        checked={checked}
        onChange={onCheck}
        className="accent-[#c41e3a] w-4 h-4 mt-1 shrink-0"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <StatusBadge status={article.status} score={article.ai_score} />
          {article.category && (
            <span className="text-[11px] px-2 py-0.5 bg-[#f0ede6] text-[#666] rounded">
              {article.category}
            </span>
          )}
          {article.county && (
            <span className="text-[11px] text-[#999]">{article.county}</span>
          )}
          <span className="text-[11px] text-[#bbb]">{timeAgo(article.created_at)}</span>
        </div>
        <p className="text-sm text-[#1a1a1a] font-medium line-clamp-2 leading-snug">
          {article.original_title}
        </p>
        {article.status === 'failed' && article.rewrite_error && (
          <p className="text-xs text-red-600 mt-1 line-clamp-1">{article.rewrite_error}</p>
        )}
        {article.original_url && (
          <a
            href={article.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-[#999] hover:text-[#c41e3a] flex items-center gap-1 mt-1 w-fit"
          >
            <ExternalLink className="w-3 h-3" /> Sursă originală
          </a>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-2">

        {/* Currently being processed (always wins) */}
        {isProcessing && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium rounded">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Se procesează…
          </span>
        )}

        {/* Queued, not yet running */}
        {!isProcessing && inQueue && (
          <div className="flex flex-col items-end gap-1">
            <span className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-100 text-violet-800 text-xs font-medium rounded">
              <ListOrdered className="w-3.5 h-3.5" />
              În coadă · poziția {queuePosition}
            </span>
            <button
              onClick={onDequeue}
              className="text-[11px] text-violet-700 hover:text-violet-900 underline"
            >
              Anulează
            </button>
          </div>
        )}

        {/* Available for enqueue */}
        {!isProcessing && !inQueue && article.status === 'scraped' && (
          <button
            onClick={onEnqueue}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium
              hover:bg-violet-700 transition-colors rounded"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Rescrie
          </button>
        )}

        {/* Already processed */}
        {!isProcessing && !inQueue && article.status === 'processed' && article.draft_post_id && (
          <a
            href={`/admin/articles/${article.draft_post_id}/edit`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium
              hover:bg-emerald-700 transition-colors rounded"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ver ciornă →
          </a>
        )}

        {/* Failed — can re-enqueue */}
        {!isProcessing && !inQueue && article.status === 'failed' && (
          <button
            onClick={onEnqueue}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium
              hover:bg-red-700 transition-colors rounded"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reîncearcă
          </button>
        )}
      </div>
    </div>
  )
}
