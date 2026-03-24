'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Plus, Trash2, Play, RefreshCw, Wand2, CheckCircle, Clock, XCircle } from 'lucide-react'

// Real column names from scraped_articles table
interface ScrapedArticle {
  id: string
  original_title: string | null
  original_url: string | null
  category: string | null
  status: string
  created_at: string
}

interface RssSource {
  id: string
  name: string
  url: string
  is_active: boolean
  county: string | null
  output_limit: number | null
  last_scraped_at?: string | null
}

export default function ScraperPage() {
  const [sources, setSources]           = useState<RssSource[]>([])
  const [queue, setQueue]               = useState<ScrapedArticle[]>([])
  const [loading, setLoading]           = useState(true)
  const [scraping, setScraping]         = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [processAll, setProcessAll]     = useState(false)
  const [queueFilter, setQueueFilter]   = useState('scraped')
  const [showAdd, setShowAdd]           = useState(false)
  const [msg, setMsg]                   = useState('')
  const [newSource, setNewSource]       = useState({
    name: '', url: '', county: '', output_limit: 10
  })

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 5000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: sourcesData }, { data: queueData }] = await Promise.all([
      supabase
        .from('rss_sources')
        .select('id, name, url, is_active, county, output_limit')
        .order('name'),
      supabase
        .from('scraped_articles')
        .select('id, original_title, original_url, category, status, created_at')
        .eq('status', queueFilter)
        .order('created_at', { ascending: false })
        .limit(60),
    ])
    setSources((sourcesData ?? []) as RssSource[])
    setQueue((queueData ?? []) as ScrapedArticle[])
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueFilter])

  useEffect(() => { load() }, [load])

  async function runScraper(sourceId?: string) {
    setScraping(true)
    flash('Scraping în desfășurare...')
    try {
      const { error } = await supabase.functions.invoke('scrape-rss', {
        body: sourceId ? { source_id: sourceId } : {}
      })
      if (error) flash(`Eroare scraper: ${error.message}`)
      else flash('✓ Scraping complet. Articole noi în coadă.')
    } catch (e) {
      flash(`Eroare: ${(e as Error).message}`)
    }
    await load()
    setScraping(false)
  }

  async function processArticle(articleId: string) {
    setProcessingId(articleId)
    try {
      const { error } = await supabase.functions.invoke('process-rewrite-job', {
        body: { article_id: articleId }
      })
      if (error) flash(`Eroare AI: ${error.message}`)
      else flash('✓ Articol rescris și publicat.')
    } catch (e) {
      flash(`Eroare: ${(e as Error).message}`)
    }
    await load()
    setProcessingId(null)
  }

  async function processAllArticles() {
    const scraped = queue.filter(a => a.status === 'scraped')
    setProcessAll(true)
    flash(`Procesez ${scraped.length} articole cu AI...`)
    for (const article of scraped) {
      await processArticle(article.id)
    }
    flash(`✓ ${scraped.length} articole procesate.`)
    setProcessAll(false)
  }

  async function addSource() {
    if (!newSource.url.trim()) return
    await supabase.from('rss_sources').insert({
      name:         newSource.name || new URL(newSource.url).hostname,
      url:          newSource.url.trim(),
      county:       newSource.county || null,
      output_limit: newSource.output_limit,
      is_active:    true,
    })
    setNewSource({ name: '', url: '', county: '', output_limit: 10 })
    setShowAdd(false)
    load()
  }

  async function toggleSource(id: string, active: boolean) {
    await supabase.from('rss_sources').update({ is_active: !active }).eq('id', id)
    load()
  }

  async function deleteSource(id: string) {
    if (!confirm('Ștergi definitiv această sursă RSS?')) return
    await supabase.from('rss_sources').delete().eq('id', id)
    load()
  }

  async function deleteScrapedArticle(id: string) {
    await supabase.from('scraped_articles').delete().eq('id', id)
    load()
  }

  const inp = "bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2 outline-none focus:border-white/30 transition-colors"

  const statusIcon = (s: string) => {
    if (s === 'used')    return <CheckCircle className="w-3.5 h-3.5 text-green-400" />
    if (s === 'scraped') return <Clock className="w-3.5 h-3.5 text-yellow-400" />
    if (s === 'failed')  return <XCircle className="w-3.5 h-3.5 text-red-400" />
    return <Clock className="w-3.5 h-3.5 text-white/20" />
  }

  return (
    <div className="max-w-5xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Scraper RSS + AI Pipeline</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">
            Colectează articole · Rescrie cu Gemini AI · Publică automat
          </p>
        </div>
        {msg && (
          <span className={`font-sans text-[12px] px-3 py-1.5 border ${
            msg.startsWith('Eroare')
              ? 'text-red-400 bg-red-400/10 border-red-400/20'
              : 'text-green-400 bg-green-400/10 border-green-400/20'
          }`}>{msg}</span>
        )}
      </div>

      {/* Pipeline visualization */}
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {[
          { n:'1', label:'RSS Sources',          desc:'Surse configurate' },
          { n:'2', label:'scrape-rss',            desc:'Colectare articole' },
          { n:'3', label:'scraped_articles',       desc:'Coadă procesare' },
          { n:'4', label:'process-rewrite-job',    desc:'Gemini AI rewrite' },
          { n:'5', label:'blog_posts → frontend', desc:'Live pe website' },
        ].map((s, i) => (
          <div key={i} className="flex items-center shrink-0">
            <div className="bg-[#1a1a1a] border border-white/[0.07] px-4 py-3 text-center min-w-[130px]">
              <div className="font-serif text-lg font-bold text-brand-red">{s.n}</div>
              <div className="font-sans text-[11px] font-bold text-white leading-tight">{s.label}</div>
              <div className="font-sans text-[10px] text-white/30">{s.desc}</div>
            </div>
            {i < 4 && <div className="text-white/20 px-1.5 text-sm">→</div>}
          </div>
        ))}
      </div>

      {/* RSS Sources */}
      <div className="bg-[#1a1a1a] border border-white/[0.07]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">
            Surse RSS ({sources.length})
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => runScraper()}
              disabled={scraping}
              className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {scraping
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scraping...</>
                : <><Play className="w-3.5 h-3.5" /> Run All</>
              }
            </button>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-[#111] border border-white/10 text-white hover:border-white/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Adaugă sursă
            </button>
          </div>
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="px-5 py-4 border-b border-white/[0.07] bg-white/[0.02] flex flex-wrap gap-3 items-end">
            <div>
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">Nume</label>
              <input className={inp} value={newSource.name}
                onChange={e => setNewSource(p => ({ ...p, name: e.target.value }))}
                placeholder="Ex: Digi24 Cluj" />
            </div>
            <div className="flex-1 min-w-[220px]">
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">URL RSS *</label>
              <input className={inp + ' w-full'} value={newSource.url}
                onChange={e => setNewSource(p => ({ ...p, url: e.target.value }))}
                placeholder="https://site.ro/feed.xml" />
            </div>
            <div>
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">Județ</label>
              <input className={inp} value={newSource.county}
                onChange={e => setNewSource(p => ({ ...p, county: e.target.value }))}
                placeholder="Cluj" style={{ width: 90 }} />
            </div>
            <div>
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">Limită articole</label>
              <input className={inp} type="number" value={newSource.output_limit}
                onChange={e => setNewSource(p => ({ ...p, output_limit: Number(e.target.value) }))}
                style={{ width: 70 }} />
            </div>
            <div className="flex gap-2">
              <button onClick={addSource}
                className="font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors">
                Adaugă
              </button>
              <button onClick={() => setShowAdd(false)}
                className="font-sans text-[12px] px-3 py-2 text-white/40 hover:text-white transition-colors">
                Anulează
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-white/[0.05]">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="px-5 py-3 animate-pulse">
                <div className="h-3 bg-white/10 rounded w-1/2 mb-1" />
                <div className="h-2 bg-white/[0.05] rounded w-1/3" />
              </div>
            ))
          ) : sources.length === 0 ? (
            <div className="px-5 py-10 text-center font-sans text-white/20">
              Nicio sursă RSS. Adaugă prima sursă cu butonul de sus.
            </div>
          ) : sources.map(source => (
            <div key={source.id} className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-sans text-[13px] text-white font-medium">{source.name}</p>
                  {source.county && (
                    <span className="font-sans text-[10px] text-white/40 bg-white/[0.05] px-1.5 py-0.5">
                      {source.county}
                    </span>
                  )}
                  {source.output_limit && (
                    <span className="font-sans text-[10px] text-white/30">
                      max {source.output_limit} articole
                    </span>
                  )}
                  {!source.is_active && (
                    <span className="font-sans text-[10px] text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5">Inactiv</span>
                  )}
                </div>
                <p className="font-sans text-[11px] text-white/30 truncate mt-0.5">{source.url}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => runScraper(source.id)} disabled={scraping} title="Scrape acum"
                  className="p-2 text-white/30 hover:text-green-400 transition-colors disabled:opacity-30">
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => toggleSource(source.id, source.is_active)}
                  title={source.is_active ? 'Dezactivează' : 'Activează'}
                  className="font-sans text-[11px] px-2 py-1 text-white/30 hover:text-white border border-white/10 hover:border-white/30 transition-colors">
                  {source.is_active ? 'OFF' : 'ON'}
                </button>
                <button onClick={() => deleteSource(source.id)} title="Șterge sursă"
                  className="p-2 text-white/30 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Processing queue */}
      <div className="bg-[#1a1a1a] border border-white/[0.07]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">
              Coadă procesare
            </h2>
            <div className="flex gap-1">
              {['scraped', 'processing', 'used', 'failed'].map(s => (
                <button key={s} onClick={() => setQueueFilter(s)}
                  className={
                    'font-sans text-[10px] uppercase px-2 py-1 transition-colors ' +
                    (queueFilter === s ? 'bg-brand-red text-white' : 'bg-white/5 text-white/30 hover:text-white')
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {queueFilter === 'scraped' && queue.length > 0 && (
            <button onClick={processAllArticles} disabled={processAll || !!processingId}
              className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50">
              {processAll
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Procesează...</>
                : <><Wand2 className="w-3.5 h-3.5" /> AI Procesează toate ({queue.length})</>
              }
            </button>
          )}
        </div>

        <div className="divide-y divide-white/[0.05]">
          {queue.length === 0 ? (
            <div className="px-5 py-10 text-center font-sans text-[13px] text-white/20">
              Niciun articol cu statusul &quot;{queueFilter}&quot;.
            </div>
          ) : queue.map(article => (
            <div key={article.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02]">
              <div className="shrink-0">{statusIcon(article.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-sans text-[13px] text-white truncate">
                  {article.original_title || article.original_url || article.id}
                </p>
                <p className="font-sans text-[11px] text-white/30">
                  {article.category?.toUpperCase()} · {new Date(article.created_at).toLocaleString('ro-RO')}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {article.status === 'scraped' && (
                  <button onClick={() => processArticle(article.id)}
                    disabled={processingId === article.id || processAll}
                    className="flex items-center gap-1.5 font-sans text-[11px] px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50">
                    {processingId === article.id
                      ? <><RefreshCw className="w-3 h-3 animate-spin" /> Procesează...</>
                      : <><Wand2 className="w-3 h-3" /> AI Rescrie</>
                    }
                  </button>
                )}
                <button onClick={() => deleteScrapedArticle(article.id)} title="Șterge"
                  className="p-1.5 text-white/20 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
