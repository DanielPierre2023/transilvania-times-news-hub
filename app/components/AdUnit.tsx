'use client'

import { useEffect } from 'react'
import Script from 'next/script'
import { useCookieConsent } from './CookieConsentContext'

// TODO: Replace with your Google AdSense publisher ID from Google Ad Manager
const ADSENSE_CLIENT = 'ca-pub-YOUR_PUBLISHER_ID_HERE'

type AdType = 'leaderboard' | 'sidebar' | 'infeed'

interface AdUnitProps {
  type: AdType
  slot?: string
  className?: string
}

const dimensions: Record<AdType, string> = {
  leaderboard: 'min-h-[90px] w-full max-w-[728px]',
  sidebar:     'min-h-[600px] w-full max-w-[300px]',
  infeed:      'min-h-[250px] w-full',
}

export default function AdUnit({ type, slot, className = '' }: AdUnitProps) {
  const { hasAnalyticsConsent } = useCookieConsent()

  useEffect(() => {
    if (!hasAnalyticsConsent || !slot) return
    try {
      // Push ad after render
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).adsbygoogle = (window as any).adsbygoogle || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).adsbygoogle.push({})
    } catch { /* ads blocked */ }
  }, [hasAnalyticsConsent, slot])

  // Guard: no slot configured — render nothing
  if (!slot) return null

  // Guard: no GDPR consent — render nothing
  if (!hasAnalyticsConsent) return null

  return (
    <>
      <Script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
        strategy="lazyOnload"
      />
      <div className={`ad-wrapper flex flex-col items-center my-8 ${className}`}>
        <span className="text-[9px] font-sans font-bold text-muted-foreground uppercase tracking-[0.2em] mb-2">
          Advertisement
        </span>
        <div className={`bg-foreground/[0.03] border border-foreground/5 overflow-hidden flex items-center justify-center ${dimensions[type]}`}>
          <ins
            className="adsbygoogle"
            style={{ display: 'block' }}
            data-ad-client={ADSENSE_CLIENT}
            data-ad-slot={slot}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </div>
      </div>
    </>
  )
}
