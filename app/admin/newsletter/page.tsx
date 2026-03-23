'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Send, Users } from 'lucide-react'

interface Subscriber {
  id: string
  email: string
  confirmed: boolean
  created_at: string
}

export default function NewsletterPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [total, setTotal] = useState(0)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')
  const [generating, setGenerating] = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    supabase.from('newsletter_subscribers')
      .select('id, email, confirmed, created_at', { count: 'exact' })
      .eq('confirmed', true)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data, count }) => {
        setSubscribers((data ?? []) as Subscriber[])
        setTotal(count ?? 0)
      })
  }, [])

  async function generateNewsletter() {
    setGenerating(true)
    setMsg('AI compune newsletter-ul...')
    try {
      const { data, error } = await supabase.functions.invoke('ai-newsletter-composer', {
        body: { language: 'ro' }
      })
      if (error) throw error
      if (data?.subject) setSubject(data.subject)
      if (data?.body) setBody(data.body)
      setMsg('✓ Newsletter generat de AI')
    } catch {
      setMsg('Eroare la generare AI.')
    }
    setGenerating(false)
  }

  async function sendNewsletter() {
    if (!subject.trim() || !body.trim()) { setMsg('Completați subiectul și conținutul.'); return }
    if (!confirm(`Trimiteți newsletter-ul la ${total} abonați confirmați?`)) return
    setSending(true)
    setMsg('Trimitere în desfășurare...')
    try {
      const { error } = await supabase.functions.invoke('send-newsletter', {
        body: { subject, body }
      })
      if (error) throw error
      setMsg(`✓ Newsletter trimis la ${total} abonați.`)
      setSubject('')
      setBody('')
    } catch {
      setMsg('Eroare la trimitere.')
    }
    setSending(false)
  }

  const inputCls = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors"

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold text-white">Newsletter</h1>
        {msg && <span className="font-sans text-[12px] text-green-400">{msg}</span>}
      </div>

      {/* Stats */}
      <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 flex items-center gap-4">
        <Users className="w-8 h-8 text-brand-red" />
        <div>
          <p className="font-serif text-3xl font-bold text-white">{total}</p>
          <p className="font-sans text-[12px] text-white/40">abonați confirmați</p>
        </div>
      </div>

      {/* Compose */}
      <div className="bg-[#1a1a1a] border border-white/[0.07] p-6 space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">Compune newsletter</h2>
          <button
            onClick={generateNewsletter}
            disabled={generating}
            className="font-sans text-[12px] px-3 py-1.5 bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50"
          >
            {generating ? 'Generează...' : '✨ Generează AI'}
          </button>
        </div>
        <div>
          <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">Subiect email</label>
          <input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subiectul newsletter-ului" />
        </div>
        <div>
          <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">Conținut (HTML sau text)</label>
          <textarea className={inputCls + ' resize-none'} rows={12} value={body} onChange={e => setBody(e.target.value)} placeholder="Conținutul newsletter-ului..." />
        </div>
        <button
          onClick={sendNewsletter}
          disabled={sending || !subject.trim() || !body.trim()}
          className="flex items-center gap-2 font-sans text-[12px] px-5 py-2.5 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" />
          {sending ? 'Trimite...' : `Trimite la ${total} abonați`}
        </button>
      </div>

      {/* Recent subscribers */}
      <div className="bg-[#1a1a1a] border border-white/[0.07]">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">Abonați recenți</h2>
        </div>
        <div className="divide-y divide-white/[0.05]">
          {subscribers.map(sub => (
            <div key={sub.id} className="flex items-center justify-between px-5 py-3">
              <span className="font-sans text-[13px] text-white">{sub.email}</span>
              <span className="font-sans text-[11px] text-white/30">
                {new Date(sub.created_at).toLocaleDateString('ro-RO')}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
