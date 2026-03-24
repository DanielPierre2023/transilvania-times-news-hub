'use client'

import { useState } from 'react'

interface NewsletterSignupProps {
  className?: string
  compact?: boolean
}

export default function NewsletterSignup({ className = '', compact = false }: NewsletterSignupProps) {
  const [email,     setEmail]     = useState('')
  const [lang,      setLang]      = useState<'ro' | 'en'>('ro')
  const [status,    setStatus]    = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg,  setErrorMsg]  = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('loading')
    setErrorMsg('')

    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), language: lang }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Subscription failed')
      setStatus('success')
      setEmail('')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Eroare necunoscută')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className={`font-sans text-sm text-green-600 bg-green-50 border border-green-200 px-4 py-3 ${className}`}>
        ✓ Abonare confirmată! / Subscription confirmed! Vei primi newsletter-ul nostru săptămânal.
      </div>
    )
  }

  if (compact) {
    return (
      <form onSubmit={handleSubmit} className={`flex gap-2 ${className}`}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Email"
          required
          className="flex-1 border border-foreground/20 bg-background text-foreground font-sans text-sm px-3 py-2 outline-none focus:border-brand-red transition-colors"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="px-4 py-2 bg-brand-red text-white font-sans text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {status === 'loading' ? '...' : 'Abonare'}
        </button>
      </form>
    )
  }

  return (
    <div className={className}>
      <h3 className="font-serif font-bold text-xl mb-1">Newsletter Transilvania Times</h3>
      <p className="font-sans text-sm text-muted-foreground mb-4">
        Cele mai importante știri din Transilvania, livrate săptămânal în inbox-ul tău.
        <br />
        <span className="text-xs opacity-70">The most important news from Transylvania, delivered weekly to your inbox.</span>
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setLang('ro')}
            className={`flex-1 py-2 font-sans text-[11px] font-bold uppercase tracking-wider border transition-colors ${
              lang === 'ro' ? 'bg-brand-red border-brand-red text-white' : 'border-foreground/20 text-muted-foreground'
            }`}
          >
            🇷🇴 Română
          </button>
          <button
            type="button"
            onClick={() => setLang('en')}
            className={`flex-1 py-2 font-sans text-[11px] font-bold uppercase tracking-wider border transition-colors ${
              lang === 'en' ? 'bg-brand-red border-brand-red text-white' : 'border-foreground/20 text-muted-foreground'
            }`}
          >
            🇬🇧 English
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder={lang === 'ro' ? 'Adresa ta de email' : 'Your email address'}
            required
            className="flex-1 border border-foreground/20 bg-background text-foreground font-sans text-sm px-3 py-3 outline-none focus:border-brand-red transition-colors"
          />
          <button
            type="submit"
            disabled={status === 'loading'}
            className="px-5 py-3 bg-brand-red text-white font-sans text-xs font-bold uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {status === 'loading' ? '...' : (lang === 'ro' ? 'Abonare' : 'Subscribe')}
          </button>
        </div>

        {status === 'error' && (
          <p className="font-sans text-xs text-red-600">{errorMsg}</p>
        )}

        <p className="font-sans text-[10px] text-muted-foreground/60">
          {lang === 'ro'
            ? 'Nu trimitem spam. Te poți dezabona oricând.'
            : 'No spam. Unsubscribe at any time.'}
        </p>
      </form>
    </div>
  )
}
