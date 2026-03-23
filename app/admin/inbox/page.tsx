'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Reply, Trash2, Mail, MailOpen } from 'lucide-react'

interface Message {
  id: string
  name: string | null
  email: string | null
  subject: string | null
  message: string | null
  read: boolean
  created_at: string
}

export default function InboxPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [selected, setSelected] = useState<Message | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function load() {
    const { data } = await supabase
      .from('contact_messages')
      .select('id, name, email, subject, message, read, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    setMessages((data ?? []) as Message[])
  }

  useEffect(() => { load() }, [])

  async function open(m: Message) {
    setSelected(m)
    setReply('')
    if (!m.read) {
      await supabase.from('contact_messages').update({ read: true }).eq('id', m.id)
      load()
    }
  }

  async function sendReply() {
    if (!selected?.email || !reply.trim()) return
    setSending(true)
    try {
      const { error } = await supabase.functions.invoke('send-inbox-reply', {
        body: { to: selected.email, subject: `Re: ${selected.subject || 'Contact'}`, body: reply }
      })
      if (error) throw error
      setMsg('✓ Răspuns trimis')
      setReply('')
    } catch { setMsg('Eroare la trimitere.') }
    setSending(false)
    setTimeout(() => setMsg(''), 3000)
  }

  async function deleteMessage(id: string) {
    await supabase.from('contact_messages').delete().eq('id', id)
    if (selected?.id === id) setSelected(null)
    load()
  }

  const inputCls = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors"

  return (
    <div className="max-w-5xl">
      <h1 className="font-serif text-2xl font-bold text-white mb-6">Inbox</h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Message list */}
        <div className="bg-[#1a1a1a] border border-white/[0.07] divide-y divide-white/[0.05] max-h-[600px] overflow-y-auto">
          {messages.length === 0 ? (
            <div className="p-10 text-center font-sans text-white/20">Niciun mesaj.</div>
          ) : messages.map(m => (
            <div
              key={m.id}
              onClick={() => open(m)}
              className={
                'flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors ' +
                (selected?.id === m.id ? 'bg-white/[0.05] border-l-2 border-brand-red' : '')
              }
            >
              {m.read
                ? <MailOpen className="w-4 h-4 text-white/20 shrink-0 mt-0.5" />
                : <Mail className="w-4 h-4 text-brand-red shrink-0 mt-0.5" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className={`font-sans text-[13px] truncate ${m.read ? 'text-white/50' : 'text-white font-medium'}`}>
                    {m.name || m.email || 'Anonim'}
                  </p>
                  <span className="font-sans text-[10px] text-white/20 shrink-0">
                    {new Date(m.created_at).toLocaleDateString('ro-RO')}
                  </span>
                </div>
                <p className="font-sans text-[11px] text-white/30 truncate">{m.subject || '(fără subiect)'}</p>
                <p className="font-sans text-[11px] text-white/20 truncate mt-0.5">{m.message}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Message detail */}
        {selected ? (
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-sans font-bold text-white">{selected.name || 'Anonim'}</p>
                <p className="font-sans text-[12px] text-white/40">{selected.email}</p>
                <p className="font-sans text-[11px] text-white/20">{new Date(selected.created_at).toLocaleString('ro-RO')}</p>
              </div>
              <button onClick={() => deleteMessage(selected.id)} className="p-2 text-white/20 hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {selected.subject && (
              <p className="font-sans font-bold text-white/70 border-b border-white/[0.07] pb-3">
                {selected.subject}
              </p>
            )}
            <p className="font-sans text-[13px] text-white/80 leading-relaxed whitespace-pre-wrap">
              {selected.message}
            </p>
            {selected.email && (
              <div className="space-y-2 pt-3 border-t border-white/[0.07]">
                <label className="block font-sans text-[11px] uppercase tracking-widest text-white/30">Răspunde</label>
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={4}
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder="Scrie răspunsul..."
                />
                {msg && <p className="font-sans text-[12px] text-green-400">{msg}</p>}
                <button
                  onClick={sendReply}
                  disabled={sending || !reply.trim()}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  <Reply className="w-3.5 h-3.5" />
                  {sending ? 'Trimite...' : 'Trimite răspuns'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-[#1a1a1a] border border-white/[0.07] flex items-center justify-center p-12">
            <p className="font-sans text-white/20">Selectează un mesaj</p>
          </div>
        )}
      </div>
    </div>
  )
}
