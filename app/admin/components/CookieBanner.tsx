'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useCookieConsent } from './CookieConsentContext'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)
  const { consent, setConsent } = useCookieConsent()

  useEffect(() => {
    if (!consent) {
      const timer = setTimeout(() => setVisible(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [consent])

  function handle(level: 'all' | 'essential') {
    setConsent(level)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 w-full z-[9999] p-4 md:p-8">
      <div className="max-w-4xl mx-auto bg-background border-2 border-foreground shadow-[20px_20px_0px_0px_hsl(var(--foreground)/0.1)] p-6 md:p-10 flex flex-col gap-6">

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-brand-red" />
            <span className="text-brand-red font-sans font-bold text-[10px] uppercase tracking-[0.2em]">
              Confidențialitate / Privacy
            </span>
          </div>
          <h2 className="text-xl font-serif font-bold text-foreground leading-tight">
            Respectăm confidențialitatea dvs.
          </h2>
          <p className="text-muted-foreground font-sans text-sm leading-relaxed">
            Folosim cookie-uri pentru a îmbunătăți experiența de navigare, a analiza traficul și a personaliza conținutul. Puteți accepta toate cookie-urile sau doar cele esențiale.
          </p>
          <p className="text-muted-foreground/70 font-sans text-xs leading-relaxed">
            We use cookies to improve your browsing experience, analyse traffic and personalise content. You may accept all cookies or essential ones only.
          </p>
        </div>

        <div className="flex flex-col md:flex-row gap-3">
          <button
            onClick={() => handle('all')}
            className="flex-1 bg-brand-red text-white py-3.5 font-sans font-bold uppercase text-xs tracking-widest hover:bg-red-700 transition-colors"
          >
            Accept toate / Accept All
          </button>
          <button
            onClick={() => handle('essential')}
            className="flex-1 border border-foreground/20 text-foreground py-3.5 font-sans font-bold uppercase text-xs tracking-widest hover:bg-foreground hover:text-background transition-all"
          >
            Doar esențiale / Essential Only
          </button>
        </div>

        <p className="text-[10px] text-muted-foreground/60 font-sans text-center md:text-left">
          Prin continuarea navigării acceptați{' '}
          <Link href="/politica-confidentialitate" className="underline hover:text-foreground transition-colors">
            Politica de confidențialitate
          </Link>
          {' '}și{' '}
          <Link href="/termeni-si-conditii" className="underline hover:text-foreground transition-colors">
            Termenii și condițiile
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
