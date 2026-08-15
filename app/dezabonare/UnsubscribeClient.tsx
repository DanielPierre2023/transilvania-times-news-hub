'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function UnsubscribeClient() {
  const params = useSearchParams()
  const emailParam = (params.get('email') || '').trim()
  const lang = params.get('lang') === 'en' ? 'en' : 'ro'

  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const t = lang === 'en'
    ? {
        title: 'Unsubscribe',
        prompt: 'Do you want to unsubscribe this address from the Transilvania Times newsletter?',
        noEmail: 'No email address was provided in the link.',
        button: 'Unsubscribe',
        working: 'Processing…',
        done: 'You have been unsubscribed. You will no longer receive the newsletter.',
        error: 'Something went wrong. Please try again.',
        back: 'Back to Transilvania Times',
      }
    : {
        title: 'Dezabonare',
        prompt: 'Vrei să dezabonezi această adresă de la newsletterul Transilvania Times?',
        noEmail: 'Linkul nu conține nicio adresă de email.',
        button: 'Dezabonează-mă',
        working: 'Se procesează…',
        done: 'Ai fost dezabonat. Nu vei mai primi newsletterul.',
        error: 'A apărut o eroare. Încearcă din nou.',
        back: 'Înapoi la Transilvania Times',
      }

  async function handleUnsubscribe() {
    setStatus('loading')
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailParam }),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">{t.title}</h1>

      {!emailParam ? (
        <p className="font-sans text-sm text-muted-foreground">{t.noEmail}</p>
      ) : status === 'done' ? (
        <p className="font-sans text-sm text-foreground/80">{t.done}</p>
      ) : (
        <div className="space-y-6">
          <p className="font-sans text-sm text-foreground/80 leading-relaxed">
            {t.prompt}
          </p>
          <p className="font-sans text-sm font-bold text-foreground break-all">{emailParam}</p>
          {status === 'error' && (
            <p className="font-sans text-sm text-red-600">{t.error}</p>
          )}
          <button
            onClick={handleUnsubscribe}
            disabled={status === 'loading'}
            className="bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider px-6 py-2.5 hover:bg-espresso transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'loading' ? t.working : t.button}
          </button>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-foreground/10">
        <a href="/" className="font-sans text-sm text-brand-red hover:underline">{t.back}</a>
      </div>
    </div>
  )
}
