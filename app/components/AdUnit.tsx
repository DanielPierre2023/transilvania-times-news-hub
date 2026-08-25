'use client'

// app/components/AdUnit.tsx
//
// AdSense ad unit with a CLS-safe reserved box and an in-house fallback.
//
// Consent architecture (Aug 2026 rework):
//   Ad consent is handled by Google's OWN certified CMP — the GDPR message
//   enabled in AdSense → Privacy & messaging. That message is delivered
//   through the adsbygoogle.js script already loaded in app/layout.tsx and
//   writes the IAB TCF consent string that Google requires before serving
//   any ad in the EEA. Gating the <ins> behind our in-house cookie banner
//   (the previous design) double-gated consent and guaranteed ZERO ad
//   serving: the banner is not a certified CMP, so Google ignored it, and
//   "essential only" visitors never even got the markup. The in-house
//   banner keeps governing OUR analytics; Google governs ads.
//
// While a placement has no slot ID configured in lib/ads.ts it renders the
// in-house SponsorBanner instead, so pages look finished either way.

import { useEffect, useRef } from 'react'
import SponsorBanner from './SponsorBanner'
import { ADSENSE_CLIENT } from '@/lib/ads'

type AdType = 'leaderboard' | 'sidebar' | 'infeed'

interface AdUnitProps {
  type: AdType
  slot?: string
  className?: string
  /** Ad label above the unit — "Publicitate" (default) or "Advertisement". */
  label?: string
}

const dimensions: Record<AdType, string> = {
  leaderboard: 'min-h-[90px] w-full max-w-[728px]',
  sidebar:     'min-h-[250px] w-full max-w-[300px]',
  infeed:      'min-h-[250px] w-full',
}

export default function AdUnit({ type, slot, className = '', label = 'Publicitate' }: AdUnitProps) {
  const insRef = useRef<HTMLModElement>(null)

  useEffect(() => {
    if (!slot) return
    const ins = insRef.current
    // Guard against double-push (React strict mode / remounts): AdSense
    // stamps the element once it has processed it.
    if (!ins || ins.getAttribute('data-adsbygoogle-status')) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).adsbygoogle = (window as any).adsbygoogle || []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).adsbygoogle.push({})
    } catch { /* ad blocker — the reserved box simply stays empty */ }
  }, [slot])

  // No slot configured yet — show the in-house sponsor banner instead.
  if (!slot) {
    return (
      <div className={`flex justify-center my-6 ${className}`}>
        <SponsorBanner />
      </div>
    )
  }

  return (
    <div className={`ad-wrapper flex flex-col items-center my-8 ${className}`}>
      <span className="text-[9px] font-sans font-bold text-muted-foreground uppercase tracking-[0.2em] mb-2">
        {label}
      </span>
      <div className={`bg-foreground/[0.03] border border-foreground/5 overflow-hidden flex items-center justify-center ${dimensions[type]}`}>
        <ins
          ref={insRef}
          className="adsbygoogle"
          style={{ display: 'block', width: '100%' }}
          data-ad-client={ADSENSE_CLIENT}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </div>
  )
}
