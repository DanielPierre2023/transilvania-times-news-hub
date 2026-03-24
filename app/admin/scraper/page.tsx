'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  RefreshCw, CheckCircle2, XCircle, Clock,
  ExternalLink, AlertCircle, Loader2, Rss, Sparkles, Trash2,
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
}

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
  const [processing,       setProcessing]       = useState<string | null>(null)
  const [bulkRunning,      setBulkRunning]      = useState(false)
  const [toast,            setToast]            = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)

  // ── Selection state ───────────────────────────────────────────────────────
  const [selectedArticles, setSelectedArticles] = useState<Set<string>>(new Set())
  const [selectedSources,  setSelectedSources]  = useState<Set<string>>(new Set())
  const [deletingArticles, setDeletingArticles] = useState(false)
  const [deletingSources,  setDeletingSources]  = useState(false)

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

  // ── process single article ────────────────────────────────────────────────
  const processArticle = async (article: ScrapedArticle) => {
    setProcessing(article.id)
    try {
      const { data, error } = await supabase.functions.invoke('tt-process-scraped-article', {
        body: { article_id: article.id, mode: 'manual' },
      })
      if (error) throw error
      const result = data?.results?.[0]
      if (!result?.post_id) {
        throw new Error(result?.error ?? `Răspuns neașteptat: ${JSON.stringify(data)}`)
      }
      showToast('Articol procesat — ciornă creată ✓', 'ok')
      await fetchArticles()
    } catch (err: unknown) {
      showToast(`Eroare procesare: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setProcessing(null)
    }
  }

  // ── bulk process all scraped ──────────────────────────────────────────────
  const bulkProcess = async () => {
    const count = articles.filter(a => a.status === 'scraped').length
    if (count === 0) { showToast('Niciun articol neprocesat în coadă', 'err'); return }
    setBulkRunning(true)
    try {
      const { data, error } = await supabase.functions.invoke('tt-process-scraped-article', {
        body: { process_all: true, mode: 'manual' },
      })
      if (error) throw error
      showToast(
        `Procesate: ${data?.processed ?? 0} ✓   Eșuate: ${data?.failed ?? 0}`,
        data?.failed > 0 ? 'err' : 'ok'
      )
      await fetchArticles()
    } catch (err: unknown) {
      showToast(`Eroare bulk: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setBulkRunning(false)
    }
  }

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
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleSource2 = (id: string) => {
    setSelectedSources(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ─── COUNTS ───────────────────────────────────────────────────────────────
  const countScraped   = articles.filter(a => a.status === 'scraped').length
  const countProcessed = articles.filter(a => a.status === 'processed').length
  const countFailed    = articles.filter(a => a.status === 'failed').length
  const activeSources  = sources.filter(s => s.is_active).length

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
                onClick={bulkProcess}
                disabled={bulkRunning}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium
                  hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bulkRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {bulkRunning ? 'Se procesează…' : `AI Procesează Tot (${countScraped})`}
              </button>
            )}
            <button onClick={fetchArticles} disabled={loading}
              className="p-2 text-[#666] hover:text-[#1a1a1a] transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

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
                onProcess={() => processArticle(article)}
                isProcessing={processing === article.id}
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

                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selectedSources.has(source.id)}
                  onChange={() => toggleSource2(source.id)}
                  className="accent-[#c41e3a] w-4 h-4 shrink-0"
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#1a1a1a]">{source.name}</p>
                  <p className="text-xs text-[#999] mt-0.5 truncate">{source.url}</p>
                  {source.last_scraped_at && (
                    <p className="text-xs text-[#bbb] mt-0.5">
                      Ultima scraping: {new Date(source.last_scraped_at).toLocaleString('ro-RO')}
                    </p>
                  )}
                </div>

                {/* Controls */}
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
function ArticleRow({
  article,
  onProcess,
  isProcessing,
  checked,
  onCheck,
}: {
  article: ScrapedArticle
  onProcess: () => void
  isProcessing: boolean
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

  return (
    <div className={`bg-white border rounded p-4 flex items-start gap-3 transition-opacity
      ${isProcessing ? 'opacity-60' : ''}
      ${checked ? 'border-[#c41e3a] bg-red-50/30' : article.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-[#e5e2d9]'}`}>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onCheck}
        className="accent-[#c41e3a] w-4 h-4 mt-1 shrink-0"
      />

      {/* Article info */}
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

      {/* Action */}
      <div className="shrink-0 flex flex-col items-end gap-2">
        {article.status === 'scraped' && (
          <button
            onClick={onProcess}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 text-white text-xs font-medium
              hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed rounded"
          >
            {isProcessing
              ? <Loader2  className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
            {isProcessing ? 'Se procesează…' : 'AI Rescrie'}
          </button>
        )}

        {article.status === 'processed' && article.draft_post_id && (
          <a
            href={`/admin/articles/${article.draft_post_id}/edit`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium
              hover:bg-emerald-700 transition-colors rounded"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ver ciornă →
          </a>
        )}

        {article.status === 'failed' && (
          <button
            onClick={onProcess}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium
              hover:bg-red-700 transition-colors disabled:opacity-50 rounded"
          >
            {isProcessing
              ? <Loader2   className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Reîncearcă
          </button>
        )}
      </div>
    </div>
  )
}
