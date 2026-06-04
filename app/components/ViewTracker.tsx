'use client'

// app/components/ViewTracker.tsx
//
// v2 — Enhanced client-side view tracker. In addition to the slug,
// now sends referrer, UTM params, fbclid detection, and device type.
// The track-view API route still extracts geo from Netlify headers
// and browser from user-agent server-side — this adds what only the
// browser can know (document.referrer, URL params, screen width).
//
// Admin exclusion: skips /admin/* paths as safety check.
// Session dedup: one POST per slug per browser session (unchanged).

import { useEffect } from 'react'

function getDeviceType(): string {
  if (typeof window === 'undefined') return 'desktop'
  const w = window.innerWidth
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

function classifySource(ref: string, hasFbclid: boolean): string {
  if (hasFbclid) return 'facebook'
  if (!ref) return 'direct'
  const r = ref.toLowerCase()
  if (r.includes('facebook.com') || r.includes('fb.com') || r.includes('l.facebook.com') || r.includes('lm.facebook.com')) return 'facebook'
  if (r.includes('news.google.com')) return 'google-news'
  if (r.includes('google.')) return 'google'
  if (r.includes('t.co') || r.includes('twitter.com') || r.includes('x.com')) return 'twitter'
  if (r.includes('linkedin.com') || r.includes('lnkd.in')) return 'linkedin'
  if (r.includes('instagram.com')) return 'instagram'
  if (r.includes('wa.me') || r.includes('whatsapp.com')) return 'whatsapp'
  if (r.includes('reddit.com')) return 'reddit'
  if (r.includes('bing.com')) return 'bing'
  if (r.includes('yahoo.com')) return 'yahoo'
  if (r.includes('duckduckgo.com')) return 'duckduckgo'
  if (r.includes('transilvaniatimes.com')) return 'internal'
  return 'other'
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export default function ViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return
    if (typeof window === 'undefined') return
    if (window.location.pathname.startsWith('/admin')) return

    const key = `tt:viewed:${slug}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // sessionStorage might be unavailable (privacy mode) — fire anyway
    }

    const referrer = document.referrer || ''
    const params = new URLSearchParams(window.location.search)
    const hasFbclid = params.has('fbclid')

    fetch('/api/track-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug,
        referrer_domain: extractDomain(referrer) || null,
        traffic_source: classifySource(referrer, hasFbclid),
        utm_source: params.get('utm_source') || null,
        utm_medium: params.get('utm_medium') || null,
        utm_campaign: params.get('utm_campaign') || null,
        device_type: getDeviceType(),
        screen_width: window.innerWidth,
      }),
      keepalive: true,
    }).catch(() => { /* swallow */ })
  }, [slug])

  return null
}
