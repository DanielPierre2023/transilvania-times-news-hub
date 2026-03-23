'use client'

import { useState, useEffect } from 'react'
import { createBrowserClient } from '@supabase/ssr'

interface Comment {
  id: string
  author_name: string
  content: string
  created_at: string
  is_approved: boolean
}

interface CommentSectionProps {
  articleId: string
  lang?: 'ro' | 'en'
}

export default function CommentSection({ articleId, lang = 'ro' }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const t = {
    title:        lang === 'ro' ? 'Comentarii' : 'Comments',
    namePlaceholder: lang === 'ro' ? 'Numele tău' : 'Your name',
    contentPlaceholder: lang === 'ro' ? 'Scrie un comentariu...' : 'Write a comment...',
    submit:       lang === 'ro' ? 'Trimite comentariul' : 'Post comment',
    submitting:   lang === 'ro' ? 'Se trimite...' : 'Posting...',
    successMsg:   lang === 'ro'
      ? 'Comentariul tău a fost trimis și va fi vizibil după aprobare.'
      : 'Your comment has been submitted and will appear after approval.',
    noComments:   lang === 'ro' ? 'Fii primul care comentează.' : 'Be the first to comment.',
    errorMsg:     lang === 'ro' ? 'Eroare la trimitere. Încearcă din nou.' : 'Error posting. Please try again.',
  }

  useEffect(() => {
    async function fetchComments() {
      const { data } = await supabase
        .from('comments')
        .select('id, author_name, content, created_at, is_approved')
        .eq('post_id', articleId)
        .eq('is_approved', true)
        .order('created_at', { ascending: true })
      setComments((data ?? []) as Comment[])
    }
    fetchComments()
  }, [articleId])

  async function handleSubmit() {
    if (!name.trim() || !content.trim()) return
    setLoading(true)
    setError('')
    try {
      const { error: err } = await supabase.from('comments').insert({
        post_id: articleId,
        author_name: name.trim(),
        content: content.trim(),
        is_approved: false,
      })
      if (err) throw err
      setSubmitted(true)
      setName('')
      setContent('')
    } catch {
      setError(t.errorMsg)
    } finally {
      setLoading(false)
    }
  }

  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    } catch { return '' }
  }

  return (
    <div className="mt-12 pt-8 border-t border-foreground/10">
      <h3 className="font-serif text-2xl font-bold text-foreground mb-8">{t.title}</h3>

      {/* Existing comments */}
      {comments.length > 0 ? (
        <div className="space-y-6 mb-10">
          {comments.map(comment => (
            <div key={comment.id} className="flex gap-4">
              <div className="w-9 h-9 rounded-full bg-brand-red/10 shrink-0 flex items-center justify-center text-[11px] font-bold text-brand-red">
                {comment.author_name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-sans font-bold text-sm text-foreground">
                    {comment.author_name}
                  </span>
                  <span className="text-[11px] font-sans text-muted-foreground">
                    {formatDate(comment.created_at)}
                  </span>
                </div>
                <p className="font-sans text-sm text-foreground/80 leading-relaxed">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="font-sans text-sm text-muted-foreground italic mb-10">{t.noComments}</p>
      )}

      {/* Comment form */}
      {submitted ? (
        <div className="bg-foreground/5 border border-foreground/10 p-4 font-sans text-sm text-foreground/70">
          {t.successMsg}
        </div>
      ) : (
        <div className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t.namePlaceholder}
            className="w-full border border-foreground/20 bg-transparent px-4 py-2.5 font-sans text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-brand-red transition-colors"
          />
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder={t.contentPlaceholder}
            rows={4}
            className="w-full border border-foreground/20 bg-transparent px-4 py-2.5 font-sans text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-brand-red transition-colors resize-none"
          />
          {error && (
            <p className="font-sans text-sm text-red-600">{error}</p>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading || !name.trim() || !content.trim()}
            className="bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider px-6 py-2.5 hover:bg-espresso transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t.submitting : t.submit}
          </button>
        </div>
      )}
    </div>
  )
}
