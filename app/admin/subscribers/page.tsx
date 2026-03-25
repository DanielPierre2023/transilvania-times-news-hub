'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Trash2, CheckCircle, XCircle, Download } from 'lucide-react'

interface Subscriber {
  id: string
  email: string
  confirmed: boolean
  created_at: string
  unsubscribed_at: string | null
}

export default function SubscribersPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'confirmed' | 'unconfirmed'>('all')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function load() {
    setLoading(true)
    let query = supabase
      .from('newsletter_subscribers')
      .select('id, email, confirmed, created_at, unsubscribed_at', { count: 'exact' })
      .is('unsubscribed_at', null)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filter === 'confirmed') query = query.eq('confirmed', true)
    else if (filter === 'unconfirmed') query = query.eq('confirmed', false)

    const { data, count } = await query
    setSubscribers((data ?? []) as Subscriber[])
    setTotal(count ?? 0)
    setLoading(false)
  }

  useEffect(() => { load() }, [filter, page])

  async function remove(id: string) {
    await supabase.from('newsletter_subscribers').delete().eq('id', id)
    load()
  }

  function exportCSV() {
    const csv = ['Email,Confirmat,Data'].concat(
      subscribers.map(s => `${s.email},${s.confirmed},${s.created_at}`)
    ).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'subscribers.csv'; a.click()
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Abonați</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">{total} în total</p>
        </div>
        <div className="flex gap-2">
          {(['confirmed', 'unconfirmed', 'all'] as const).map(f => (
            <button key={f} onClick={() => { setFilter(f); setPage(0) }}
              className={
                'font-sans text-[11px] uppercase tracking-wider px-3 py-1.5 transition-colors ' +
                (filter === f ? 'bg-brand-red text-white' : 'bg-[#1a1a1a] border border-white/[0.07] text-white/40 hover:text-white')
              }
            >
              {f === 'confirmed' ? 'Confirmați' : f === 'unconfirmed' ? 'Neconfirmați' : 'Toți'}
            </button>
          ))}
          <button onClick={exportCSV} className="p-2 bg-[#1a1a1a] border border-white/[0.07] text-white/40 hover:text-white transition-colors" title="Export CSV">
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-[#1a1a1a] border border-white/[0.07] divide-y divide-white/[0.05]">
        {loading ? [...Array(5)].map((_, i) => (
          <div key={i} className="px-5 py-3 animate-pulse">
            <div className="h-3 bg-white/10 rounded w-1/2" />
          </div>
        )) : subscribers.length === 0 ? (
          <div className="px-5 py-10 text-center font-sans text-white/20">Niciun abonat.</div>
        ) : subscribers.map(sub => (
          <div key={sub.id} className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3">
              {sub.confirmed
                ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                : <XCircle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
              }
              <span className="font-sans text-[13px] text-white">{sub.email}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-sans text-[11px] text-white/30">
                {new Date(sub.created_at).toLocaleDateString('ro-RO')}
              </span>
              <button onClick={() => remove(sub.id)} className="p-1.5 text-white/20 hover:text-red-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
