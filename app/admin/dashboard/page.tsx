'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import Link from 'next/link'
import { FileText, Clock, MessageSquare, Users, Rss, TrendingUp, CheckCircle, AlertCircle } from 'lucide-react'

interface Stats {
  publishedToday: number
  pending: number
  pendingComments: number
  subscribers: number
  scrapedQueue: number
  totalPublished: number
}

interface RecentArticle {
  id: string
  slug: string
  title_ro: string | null
  status: string
  published_at: string | null
  category: string | null
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    publishedToday: 0, pending: 0, pendingComments: 0,
    subscribers: 0, scrapedQueue: 0, totalPublished: 0
  })
  const [recent, setRecent] = useState<RecentArticle[]>([])
  const [loading, setLoading] = useState(true)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    async function load() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      const [
        { count: publishedToday },
        { count: pending },
        { count: pendingComments },
        { count: subscribers },
        { count: scrapedQueue },
        { count: totalPublished },
        { data: recentData },
      ] = await Promise.all([
        supabase.from('blog_posts').select('*', { count: 'exact', head: true })
          .eq('status', 'published').gte('published_at', today.toISOString()),
        supabase.from('blog_posts').select('*', { count: 'exact', head: true })
          .in('status', ['draft', 'pending_review']),
        supabase.from('comments').select('*', { count: 'exact', head: true })
          .eq('is_approved', false),
        supabase.from('newsletter_subscribers').select('*', { count: 'exact', head: true })
          .eq('confirmed', true),
        supabase.from('scraped_articles').select('*', { count: 'exact', head: true })
          .eq('status', 'scraped'),
        supabase.from('blog_posts').select('*', { count: 'exact', head: true })
          .eq('status', 'published'),
        supabase.from('blog_posts')
          .select('id, slug, title_ro, status, published_at, category')
          .order('created_at', { ascending: false })
          .limit(8),
      ])

      setStats({
        publishedToday: publishedToday ?? 0,
        pending: pending ?? 0,
        pendingComments: pendingComments ?? 0,
        subscribers: subscribers ?? 0,
        scrapedQueue: scrapedQueue ?? 0,
        totalPublished: totalPublished ?? 0,
      })
      setRecent((recentData ?? []) as RecentArticle[])
      setLoading(false)
    }
    load()
  }, [])

  const STAT_CARDS = [
    { label: 'Publicate azi', value: stats.publishedToday, icon: CheckCircle, color: 'text-green-400', href: '/admin/articles' },
    { label: 'În așteptare', value: stats.pending, icon: Clock, color: 'text-yellow-400', href: '/admin/articles?status=pending' },
    { label: 'Comentarii noi', value: stats.pendingComments, icon: MessageSquare, color: 'text-blue-400', href: '/admin/comments' },
    { label: 'Abonați confirmați', value: stats.subscribers, icon: Users, color: 'text-purple-400', href: '/admin/subscribers' },
    { label: 'Articole în coadă RSS', value: stats.scrapedQueue, icon: Rss, color: 'text-orange-400', href: '/admin/scraper' },
    { label: 'Total publicate', value: stats.totalPublished, icon: TrendingUp, color: 'text-brand-red', href: '/admin/articles' },
  ]

  const statusColor = (s: string) => {
    if (s === 'published') return 'text-green-400 bg-green-400/10'
    if (s === 'pending_review') return 'text-yellow-400 bg-yellow-400/10'
    if (s === 'draft') return 'text-white/40 bg-white/5'
    return 'text-red-400 bg-red-400/10'
  }

  const statusLabel = (s: string) => {
    if (s === 'published') return 'Publicat'
    if (s === 'pending_review') return 'În revizuire'
    if (s === 'draft') return 'Ciornă'
    return s
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-2xl font-bold text-white">Dashboard</h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          {new Date().toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {STAT_CARDS.map(card => {
          const Icon = card.icon
          return (
            <Link key={card.label} href={card.href}
              className="bg-[#1a1a1a] border border-white/[0.07] p-5 hover:border-white/20 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <Icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div className={`font-serif text-3xl font-bold ${loading ? 'text-white/20' : 'text-white'} mb-1`}>
                {loading ? '—' : card.value}
              </div>
              <p className="font-sans text-[12px] text-white/40">{card.label}</p>
            </Link>
          )
        })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link href="/admin/scraper"
          className="flex items-center gap-3 bg-brand-red p-4 hover:bg-red-700 transition-colors"
        >
          <Rss className="w-5 h-5 text-white shrink-0" />
          <div>
            <p className="font-sans text-sm font-bold text-white">Rulează Scraper</p>
            <p className="font-sans text-[11px] text-white/70">Colectează articole noi din RSS</p>
          </div>
        </Link>
        <Link href="/admin/articles/new"
          className="flex items-center gap-3 bg-[#1a1a1a] border border-white/[0.07] p-4 hover:border-white/20 transition-colors"
        >
          <FileText className="w-5 h-5 text-white/60 shrink-0" />
          <div>
            <p className="font-sans text-sm font-bold text-white">Articol nou</p>
            <p className="font-sans text-[11px] text-white/40">Scrie un articol manual</p>
          </div>
        </Link>
        <Link href="/admin/comments"
          className="flex items-center gap-3 bg-[#1a1a1a] border border-white/[0.07] p-4 hover:border-white/20 transition-colors"
        >
          <MessageSquare className="w-5 h-5 text-white/60 shrink-0" />
          <div>
            <p className="font-sans text-sm font-bold text-white">Aprobă comentarii</p>
            <p className="font-sans text-[11px] text-white/40">{stats.pendingComments} în așteptare</p>
          </div>
        </Link>
      </div>

      {/* Recent articles */}
      <div className="bg-[#1a1a1a] border border-white/[0.07]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">
            Articole recente
          </h2>
          <Link href="/admin/articles" className="font-sans text-[11px] text-brand-red hover:underline">
            Vezi toate →
          </Link>
        </div>
        <div className="divide-y divide-white/[0.05]">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="px-5 py-4 animate-pulse">
                <div className="h-3 bg-white/10 rounded w-3/4 mb-2" />
                <div className="h-2 bg-white/5 rounded w-1/4" />
              </div>
            ))
          ) : recent.map(article => (
            <div key={article.id} className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-sans text-[13px] text-white truncate">{article.title_ro || '(fără titlu)'}</p>
                <p className="font-sans text-[11px] text-white/30 mt-0.5">
                  {article.category?.toUpperCase()} ·{' '}
                  {article.published_at
                    ? new Date(article.published_at).toLocaleDateString('ro-RO')
                    : 'Nedatat'}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`font-sans text-[10px] uppercase tracking-wider px-2 py-0.5 ${statusColor(article.status)}`}>
                  {statusLabel(article.status)}
                </span>
                <Link
                  href={`/admin/articles/${article.id}/edit`}
                  className="font-sans text-[11px] text-white/30 hover:text-white transition-colors"
                >
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
