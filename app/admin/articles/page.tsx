'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { Plus, Search, Eye, Edit, Trash2, Globe, EyeOff, Image as ImageIcon } from 'lucide-react'

interface Article {
  id: string
  slug: string
  title_ro: string | null
  title_en: string | null
  category: string | null
  status: string
  published_at: string | null
  cover_image: string | null
  author_name: string | null
  ai_quality_score: number | null
}

const STATUSES = ['all', 'published', 'pending_review', 'draft', 'rejected']
const STATUS_LABELS: Record<string, string> = {
  all: 'Toate', published: 'Publicate', pending_review: 'În revizuire',
  draft: 'Ciorne', rejected: 'Respinse'
}

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 20

  // useMemo so the client is stable across renders — fixes the
  // react-hooks/exhaustive-deps warning on the load() useCallback below.
  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('blog_posts')
      .select('id, slug, title_ro, title_en, category, status, published_at, cover_image, author_name, ai_quality_score', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (status !== 'all') query = query.eq('status', status)
    if (search.trim()) query = query.ilike('title_ro', `%${search.trim()}%`)

    const { data, count } = await query
    setArticles((data ?? []) as Article[])
    setTotal(count ?? 0)
    setLoading(false)
  }, [status, search, page, supabase])

  useEffect(() => { load() }, [load])

  async function togglePublish(article: Article) {
    const newStatus = article.status === 'published' ? 'draft' : 'published'
    const update: Record<string, unknown> = { status: newStatus }
    if (newStatus === 'published') update.published_at = new Date().toISOString()

    await supabase.from('blog_posts').update(update).eq('id', article.id)

    // Trigger ISR revalidation
    if (newStatus === 'published') {
      fetch(`/api/revalidate?secret=${process.env.NEXT_PUBLIC_REVALIDATION_SECRET ?? 'tt-revalidate-2026'}&slug=${article.slug}`, { method: 'POST' })
    }
    load()
  }

  async function deleteArticle(id: string) {
    if (!confirm('Ștergi definitiv acest articol?')) return
    await supabase.from('blog_posts').delete().eq('id', id)
    load()
  }

  async function generateCoverImage(postId: string) {
    await supabase.functions.invoke('generate-cover-image', { body: { post_id: postId } })
    load()
  }

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      published: 'text-green-400 bg-green-400/10',
      pending_review: 'text-yellow-400 bg-yellow-400/10',
      draft: 'text-white/40 bg-white/[0.05]',
      rejected: 'text-red-400 bg-red-400/10',
    }
    return map[s] || 'text-white/40 bg-white/[0.05]'
  }

  const statusLabel = (s: string) => STATUS_LABELS[s] || s

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Articole</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">{total} articole total</p>
        </div>
        <Link
          href="/admin/articles/new"
          className="flex items-center gap-2 bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider px-4 py-2.5 hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Articol nou
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Caută articole..."
            className="w-full bg-[#1a1a1a] border border-white/[0.07] text-white font-sans text-sm pl-10 pr-4 py-2.5 outline-none focus:border-white/20 placeholder:text-white/20"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(0) }}
              className={
                'font-sans text-[11px] uppercase tracking-wider px-3 py-2 transition-colors ' +
                (status === s ? 'bg-brand-red text-white' : 'bg-[#1a1a1a] text-white/40 hover:text-white border border-white/[0.07]')
              }
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1a1a1a] border border-white/[0.07]">
        <div className="divide-y divide-white/[0.05]">
          {loading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse flex gap-4">
                <div className="h-12 w-20 bg-white/[0.05] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                  <div className="h-2 bg-white/[0.05] rounded w-1/4" />
                </div>
              </div>
            ))
          ) : articles.length === 0 ? (
            <div className="px-5 py-12 text-center font-sans text-white/30">
              Niciun articol găsit.
            </div>
          ) : articles.map(article => (
            <div key={article.id} className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.02] transition-colors">
              {/* Thumbnail */}
              <div className="w-16 h-12 shrink-0 bg-white/[0.05] overflow-hidden">
                {article.cover_image
                  ? <img src={article.cover_image} alt="" className="w-full h-full object-cover grayscale" />
                  : <div className="w-full h-full flex items-center justify-center text-white/10">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                }
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="font-sans text-[13px] text-white font-medium truncate">
                  {article.title_ro || article.title_en || '(fără titlu)'}
                </p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="font-sans text-[11px] text-white/30">
                    {article.category?.toUpperCase()}
                  </span>
                  {article.author_name && (
                    <span className="font-sans text-[11px] text-white/30">· {article.author_name}</span>
                  )}
                  {article.published_at && (
                    <span className="font-sans text-[11px] text-white/30">
                      · {new Date(article.published_at).toLocaleDateString('ro-RO')}
                    </span>
                  )}
                  {article.ai_quality_score != null && (
                    <span className={`font-sans text-[10px] ${article.ai_quality_score >= 7 ? 'text-green-400' : 'text-yellow-400'}`}>
                      AI {article.ai_quality_score}/10
                    </span>
                  )}
                </div>
              </div>

              {/* Status */}
              <span className={`font-sans text-[10px] uppercase tracking-wider px-2 py-1 shrink-0 ${statusBadge(article.status)}`}>
                {statusLabel(article.status)}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <Link
                  href={`/blog/${article.slug}`}
                  target="_blank"
                  title="Vizualizează"
                  className="p-2 text-white/30 hover:text-white transition-colors"
                >
                  <Eye className="w-4 h-4" />
                </Link>
                <Link
                  href={`/admin/articles/${article.id}/edit`}
                  title="Editează"
                  className="p-2 text-white/30 hover:text-white transition-colors"
                >
                  <Edit className="w-4 h-4" />
                </Link>
                <button
                  onClick={() => togglePublish(article)}
                  title={article.status === 'published' ? 'Retrage' : 'Publică'}
                  className="p-2 text-white/30 hover:text-green-400 transition-colors"
                >
                  {article.status === 'published'
                    ? <EyeOff className="w-4 h-4" />
                    : <Globe className="w-4 h-4" />
                  }
                </button>
                {!article.cover_image && (
                  <button
                    onClick={() => generateCoverImage(article.id)}
                    title="Generează imagine"
                    className="p-2 text-white/30 hover:text-blue-400 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => deleteArticle(article.id)}
                  title="Șterge"
                  className="p-2 text-white/30 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <p className="font-sans text-[12px] text-white/30">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} din {total}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="font-sans text-[12px] px-3 py-1.5 bg-[#1a1a1a] border border-white/[0.07] text-white/40 hover:text-white disabled:opacity-30 transition-colors"
            >
              ← Anterior
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= total}
              className="font-sans text-[12px] px-3 py-1.5 bg-[#1a1a1a] border border-white/[0.07] text-white/40 hover:text-white disabled:opacity-30 transition-colors"
            >
              Următor →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
