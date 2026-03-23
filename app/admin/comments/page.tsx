'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Check, X, Trash2, ExternalLink } from 'lucide-react'

interface Comment {
  id: string
  post_id: string
  author_name: string
  content: string
  is_approved: boolean
  created_at: string
  blog_posts?: { title_ro: string | null; slug: string }
}

export default function CommentsPage() {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'approved' | 'all'>('pending')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('comments')
      .select('id, post_id, author_name, content, is_approved, created_at, blog_posts(title_ro, slug)')
      .order('created_at', { ascending: false })
      .limit(50)

    if (filter === 'pending') query = query.eq('is_approved', false)
    else if (filter === 'approved') query = query.eq('is_approved', true)

    const { data } = await query
    setComments((data ?? []) as unknown as Comment[])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  async function approve(id: string) {
    await supabase.from('comments').update({ is_approved: true }).eq('id', id)
    load()
  }

  async function reject(id: string) {
    await supabase.from('comments').delete().eq('id', id)
    load()
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-serif text-2xl font-bold text-white">Comentarii</h1>
        <div className="flex gap-1">
          {(['pending', 'approved', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={
                'font-sans text-[11px] uppercase tracking-wider px-3 py-1.5 transition-colors ' +
                (filter === f ? 'bg-brand-red text-white' : 'bg-[#1a1a1a] text-white/40 border border-white/[0.07] hover:text-white')
              }
            >
              {f === 'pending' ? 'În așteptare' : f === 'approved' ? 'Aprobate' : 'Toate'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[#1a1a1a] border border-white/[0.07] divide-y divide-white/[0.05]">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="p-5 animate-pulse space-y-2">
              <div className="h-3 bg-white/10 rounded w-1/4" />
              <div className="h-3 bg-white/[0.05] rounded w-3/4" />
            </div>
          ))
        ) : comments.length === 0 ? (
          <div className="p-12 text-center font-sans text-white/20">Niciun comentariu în această stare.</div>
        ) : comments.map(comment => (
          <div key={comment.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-7 h-7 rounded-full bg-brand-red/20 flex items-center justify-center text-[11px] font-bold text-brand-red">
                    {comment.author_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <span className="font-sans text-sm font-bold text-white">{comment.author_name}</span>
                  <span className="font-sans text-[11px] text-white/30">
                    {new Date(comment.created_at).toLocaleDateString('ro-RO')}
                  </span>
                  {comment.is_approved && (
                    <span className="font-sans text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5">Aprobat</span>
                  )}
                </div>
                <p className="font-sans text-[13px] text-white/80 leading-relaxed mb-2">{comment.content}</p>
                {comment.blog_posts && (
                  <a
                    href={`/blog/${comment.blog_posts.slug}`}
                    target="_blank"
                    className="flex items-center gap-1 font-sans text-[11px] text-white/30 hover:text-brand-red transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {comment.blog_posts.title_ro || comment.blog_posts.slug}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!comment.is_approved && (
                  <button onClick={() => approve(comment.id)}
                    className="p-2 text-white/30 hover:text-green-400 transition-colors"
                    title="Aprobă"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => reject(comment.id)}
                  className="p-2 text-white/30 hover:text-red-400 transition-colors"
                  title="Șterge"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
