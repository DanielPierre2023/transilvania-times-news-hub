'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Plus, Trash2, Play, RefreshCw, Wand2, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp } from 'lucide-react'

interface RssSource {
  id: string
  name: string
  url: string
  category: string
  is_active: boolean
  last_scraped_at: string | null
}

interface ScrapedArticle {
  id: string
  title: string | null
  source_url: string | null
  category: string | null
  status: string
  created_at: string
  scraped_at: string | null
}

export default function ScraperPage() {
  const [sources, setSources] = useState<RssSource[]>([])
  const [queue, setQueue] = useState<ScrapedArticle[]>([])
  const [loading, setLoading] = useState(true)
  const [scraping, setScraping] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [newSource, setNewSource] = useState({ name: '', url: '', category: 'news' })
  const [showAddForm, setShowAddForm] = useState(false)
  const [msg, setMsg] = useState('')
  const [queueFilter, setQueueFilter] = useState('scraped')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const load = useCallback(async () => {
    const [{ data: sourcesData }, { data: queueData }] = await Promise.all([
      supabase.from('rss_sources').select('*').order('name'),
      supabase.from('scraped_articles')
        .select('id, title, source_url, category, status, created_at, scraped_at')
        .eq('status', queueFilter)
        .order('created_at', { ascending: false })
        .limit(50),
    ])
    setSources((sourcesData ?? []) as RssSource[])
    setQueue((queueData ?? []) as ScrapedArticle[])
    setLoading(false)
  }, [queueFilter])

  useEffect(() => { load() }, [load])

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 4000)
  }

  async function runScraper(sourceId?: string) {
    setScraping(true)
    flash('Scraping în desfășurare...')
    try {
      const { error } = await supabase.functions.invoke('scrape-rss', {
        body: sourceId ? { source_id: sourceId } : {}
      })
      if (error) flash('Eroare: ' + error.message)
      else flash('✓ Scraping complet. Articolele noi sunt în coadă.')
    } catch (e) {
      flash('Eroare la scraping.')
    }
    await load()
    setScraping(false)
  }

  async function processArticle(articleId: string) {
    setProcessingId(articleId)
    flash('AI procesează articolul...')
    try {
      const { error } = await supabase.functions.invoke('process-rewrite-job', {
        body: { article_id: articleId }
      })
      if (error) flash('Eroare AI: ' + error.message)
      else flash('✓ Articol rescris și trimis spre publicare.')
    } catch {
      flash('Eroare la procesare.')
    }
    await load()
    setProcessingId(null)
  }

  async function processAll() {
    const pending = queue.filter(a => a.status === 'scraped')
    flash(`Procesez ${pending.length} articole...`)
    for (const article of pending) {
      await processArticle(article.id)
    }
    flash(`✓ ${pending.length} articole procesate.`)
  }

  async function addSource() {
    if (!newSource.url.trim()) return
    await supabase.from('rss_sources').insert({
      name: newSource.name || new URL(newSource.url).hostname,
      url: newSource.url.trim(),
      category: newSource.category,
      is_active: true,
    })
    setNewSource({ name: '', url: '', category: 'news' })
    setShowAddForm(false)
    load()
  }

  async function toggleSource(id: string, active: boolean) {
    await supabase.from('rss_sources').update({ is_active: !active }).eq('id', id)
    load()
  }

  async function deleteSource(id: string) {
    if (!confirm('Ștergi această sursă RSS?')) return
    await supabase.from('rss_sources').delete().eq('id', id)
    load()
  }

  const statusIcon = (s: string) => {
    if (s === 'used') return <CheckCircle className="w-3.5 h-3.5 text-green-400" />
    if (s === 'scraped') return <Clock className="w-3.5 h-3.5 text-yellow-400" />
    if (s === 'failed') return <XCircle className="w-3.5 h-3.5 text-red-400" />
    return null
  }

  const inputCls = "bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2 outline-none focus:border-white/30 transition-colors"

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Scraper RSS + AI Pipeline</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">
            Colectează articole, rescrie cu AI, publică pe frontend
          </p>
        </div>
        {msg && <span className="font-sans text-[12px] text-green-400 bg-green-400/10 px-3 py-1">{msg}</span>}
      </div>

      {/* Pipeline overview */}
      <div className="flex items-center gap-0 overflow-x-auto">
        {[
          { step: '1', label: 'RSS Sources', desc: 'Surse configurate' },
          { step: '2', label: 'scrape-rss', desc: 'Colectare articole' },
          { step: '3', label: 'scraped_articles', desc: 'Coadă de procesare' },
          { step: '4', label: 'process-rewrite-job', desc: 'AI rewriting + persona' },
          { step: '5', label: 'blog_posts', desc: 'Live pe website' },
        ].map((item, i) => (
          <div key={i} className="flex items-center shrink-0">
            <div className="bg-[#1a1a1a] border border-white/[0.07] px-4 py-3 text-center min-w-[120px]">
              <div className="font-serif text-lg font-bold text-brand-red">{item.step}</div>
              <div className="font-sans text-[11px] font-bold text-white">{item.label}</div>
              <div className="font-sans text-[10px] text-white/30">{item.desc}</div>
            </div>
            {i < 4 && <div className="font-sans text-white/20 px-2">→</div>}
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
              {scraping ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {scraping ? 'Scraping...' : 'Run All'}
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-[#111] border border-white/10 text-white hover:border-white/30 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Adaugă
            </button>
          </div>
        </div>

        {showAddForm && (
          <div className="px-5 py-4 border-b border-white/[0.07] bg-white/[0.02] flex flex-wrap gap-3 items-end">
            <div>
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">Nume</label>
              <input className={inputCls} value={newSource.name} onChange={e => setNewSource(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Digi24" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">URL RSS</label>
              <input className={inputCls + ' w-full'} value={newSource.url} onChange={e => setNewSource(p => ({ ...p, url: e.target.value }))} placeholder="https://site.ro/rss.xml" />
            </div>
            <div>
              <label className="block font-sans text-[10px] text-white/30 mb-1 uppercase tracking-widest">Categorie</label>
              <select className={inputCls} value={newSource.category} onChange={e => setNewSource(p => ({ ...p, category: e.target.value }))}>
                {['news','politics','technology','business','culture','travel','education','sports','health','opinion'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={addSource} className="font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors">Adaugă</button>
              <button onClick={() => setShowAddForm(false)} className="font-sans text-[12px] px-3 py-2 text-white/40 hover:text-white transition-colors">Anulează</button>
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
          ) : sources.map(source => (
            <div key={source.id} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-sans text-[13px] text-white font-medium">{source.name}</p>
                  <span className="font-sans text-[10px] text-brand-red bg-brand-red/10 px-1.5 py-0.5 uppercase">{source.category}</span>
                  {!source.is_active && <span className="font-sans text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5">Inactiv</span>}
                </div>
                <p className="font-sans text-[11px] text-white/30 truncate">{source.url}</p>
                {source.last_scraped_at && (
                  <p className="font-sans text-[10px] text-white/20">
                    Ultima scraping: {new Date(source.last_scraped_at).toLocaleString('ro-RO')}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => runScraper(source.id)}
                  disabled={scraping}
                  title="Scrape acum"
                  className="p-2 text-white/30 hover:text-green-400 transition-colors disabled:opacity-30"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => toggleSource(source.id, source.is_active)}
                  title={source.is_active ? 'Dezactivează' : 'Activează'}
                  className="p-2 text-white/30 hover:text-white transition-colors"
                >
                  {source.is_active ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => deleteSource(source.id)}
                  className="p-2 text-white/30 hover:text-red-400 transition-colors"
                >
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
          <div className="flex items-center gap-3">
            <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">
              Coadă procesare
            </h2>
            <div className="flex gap-1">
              {['scraped', 'processing', 'used', 'failed'].map(s => (
                <button
                  key={s}
                  onClick={() => setQueueFilter(s)}
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
            <button
              onClick={processAll}
              disabled={!!processingId}
              className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              <Wand2 className="w-3.5 h-3.5" />
              AI Procesează toate ({queue.length})
            </button>
          )}
        </div>

        <div className="divide-y divide-white/[0.05]">
          {queue.length === 0 ? (
            <div className="px-5 py-10 text-center font-sans text-[13px] text-white/20">
              Niciun articol în această stare.
            </div>
          ) : queue.map(article => (
            <div key={article.id} className="flex items-center gap-4 px-5 py-3">
              <div className="shrink-0">{statusIcon(article.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="font-sans text-[13px] text-white truncate">
                  {article.title || article.source_url || article.id}
                </p>
                <p className="font-sans text-[11px] text-white/30">
                  {article.category?.toUpperCase()} · {new Date(article.created_at).toLocaleString('ro-RO')}
                </p>
              </div>
              {article.status === 'scraped' && (
                <button
                  onClick={() => processArticle(article.id)}
                  disabled={processingId === article.id}
                  className="flex items-center gap-2 font-sans text-[11px] px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50 shrink-0"
                >
                  {processingId === article.id
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /> Procesează...</>
                    : <><Wand2 className="w-3 h-3" /> AI Rescrie</>
                  }
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
