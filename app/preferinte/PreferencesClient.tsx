'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { COUNTIES } from '@/lib/counties'

// Real counties only (exclude the 'national' pseudo-county).
const COUNTY_OPTIONS = COUNTIES.filter(c => c.isTransylvania)

export default function PreferencesClient() {
  const params = useSearchParams()
  const emailParam = (params.get('email') || '').trim()

  const [county, setCounty] = useState<string>('')
  const [weatherAlerts, setWeatherAlerts] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSave() {
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/newsletter/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailParam,
          county: county || null,
          weather_alerts: weatherAlerts,
        }),
      })
      if (res.ok) {
        setStatus('done')
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || 'A apărut o eroare. Încearcă din nou.')
        setStatus('error')
      }
    } catch {
      setErrorMsg('A apărut o eroare. Încearcă din nou.')
      setStatus('error')
    }
  }

  return (
    <div>
      <h1 className="font-serif text-3xl font-bold text-foreground mb-6">Preferințe newsletter</h1>

      {!emailParam ? (
        <p className="font-sans text-sm text-muted-foreground">
          Linkul nu conține nicio adresă de email. Deschide această pagină din linkul „Preferințe” din newsletter.
        </p>
      ) : status === 'done' ? (
        <p className="font-sans text-sm text-foreground/80">
          Preferințele tale au fost salvate. Vei primi digestul pentru județul selectat.
        </p>
      ) : (
        <div className="space-y-6">
          <p className="font-sans text-sm text-foreground/80 leading-relaxed">
            Setează județul tău pentru a primi știrile locale în newsletter, pentru <span className="font-bold break-all">{emailParam}</span>.
          </p>

          <div>
            <label className="block font-sans text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
              Județul tău
            </label>
            <select
              value={county}
              onChange={e => {
                setCounty(e.target.value)
                if (!e.target.value) setWeatherAlerts(false)
              }}
              className="w-full border border-foreground/20 bg-transparent px-4 py-2.5 font-sans text-sm text-foreground outline-none focus:border-brand-red transition-colors"
            >
              <option value="">— Fără preferință (digest național) —</option>
              {COUNTY_OPTIONS.map(c => (
                <option key={c.slug} value={c.slug}>{c.label}</option>
              ))}
            </select>
          </div>

          <label className={`flex items-start gap-3 ${county ? '' : 'opacity-50'}`}>
            <input
              type="checkbox"
              checked={weatherAlerts}
              disabled={!county}
              onChange={e => setWeatherAlerts(e.target.checked)}
              className="mt-1 accent-brand-red"
            />
            <span className="font-sans text-sm text-foreground/80 leading-relaxed">
              Vreau alerte meteo pentru cod portocaliu și roșu în județul meu (sursă: ANM / MeteoAlarm).
              {!county && <span className="block text-xs text-muted-foreground mt-1">Selectează mai întâi un județ.</span>}
            </span>
          </label>

          {status === 'error' && (
            <p className="font-sans text-sm text-red-600">{errorMsg}</p>
          )}

          <button
            onClick={handleSave}
            disabled={status === 'loading'}
            className="bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider px-6 py-2.5 hover:bg-espresso transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'loading' ? 'Se salvează…' : 'Salvează preferințele'}
          </button>
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-foreground/10">
        <Link href="/" className="font-sans text-sm text-brand-red hover:underline">Înapoi la Transilvania Times</Link>
      </div>
    </div>
  )
}
