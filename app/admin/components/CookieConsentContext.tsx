'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

type ConsentLevel = 'all' | 'essential' | null

interface CookieConsentContextValue {
  consent: ConsentLevel
  setConsent: (level: 'all' | 'essential') => void
  hasAnalyticsConsent: boolean
}

const CookieConsentContext = createContext<CookieConsentContextValue>({
  consent: null,
  setConsent: () => {},
  hasAnalyticsConsent: false,
})

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [consent, setConsentState] = useState<ConsentLevel>(null)

  useEffect(() => {
    const stored = localStorage.getItem('transilvania-consent') as ConsentLevel
    if (stored) setConsentState(stored)
  }, [])

  function setConsent(level: 'all' | 'essential') {
    localStorage.setItem('transilvania-consent', level)
    setConsentState(level)
  }

  return (
    <CookieConsentContext.Provider value={{
      consent,
      setConsent,
      hasAnalyticsConsent: consent === 'all',
    }}>
      {children}
    </CookieConsentContext.Provider>
  )
}

export function useCookieConsent() {
  return useContext(CookieConsentContext)
}
