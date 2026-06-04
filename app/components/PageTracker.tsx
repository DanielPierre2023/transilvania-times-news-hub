'use client'

// app/components/PageTracker.tsx
//
// v2 — Server-routed tracking. Posts to /api/track-page instead of
// inserting into site_analytics directly from the browser.
//
// Why: the browser can't access Netlify's x-nf-geo header, so country
// and city were always NULL. The server-side route extracts geo from
// Netlify headers and inserts the complete row.
//
// Client still detects: referrer, browser, device, screen, visitor_id,
// session_id, UTM params, bot check. Server adds: country, city, user_agent.

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

const BOT_PATTERNS = /bot|crawl|spider|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Googlebot|bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou|ia_archiver|AhrefsBot|SemrushBot|MJ12bot|DotBot|PetalBot|bytespider/i

function getDeviceType(w: number): string {
  if (w < 768) return 'mobile'
  if (w < 1024) return 'tablet'
  return 'desktop'
}

function getBrowser(ua: string): string {
  if (ua.includes('Firefox/')) return 'Firefox'
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera'
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome'
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari'
  return 'Other'
}

function getVisitorId(): string {
  const key = 'tt_vid'
  let vid = ''
  try { vid = localStorage.getItem(key) || '' } catch { /* private browsing */ }
  if (!vid) {
    vid = crypto.randomUUID()
    try { localStorage.setItem(key, vid) } catch { /* */ }
  }
  return vid
}

function getSessionId(): string {
  const key = 'tt_sid'
  let sid = ''
  try { sid = sessionStorage.getItem(key) || '' } catch { /* */ }
  if (!sid) {
    sid = crypto.randomUUID()
    try { sessionStorage.setItem(key, sid) } catch { /* */ }
  }
  return sid
}

function cleanReferrer(ref: string): string {
  if (!ref) return 'direct'
  try {
    const url = new URL(ref)
    const host = url.hostname.replace(/^www\./, '')
    if (host.includes('transilvaniatimes.com')) return 'internal'
    if (host.includes('facebook.com') || host.includes('fb.com')) return 'facebook'
    if (host.includes('google.')) return 'google'
    if (host.includes('bing.com')) return 'bing'
    if (host.includes('t.co') || host.includes('twitter.com') || host.includes('x.com')) return 'twitter'
    if (host.includes('linkedin.com')) return 'linkedin'
    if (host.includes('reddit.com')) return 'reddit'
    return host
  } catch { return ref.substring(0, 100) }
}

export default function PageTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lastPath = useRef('')

  useEffect(() => {
    // Skip admin pages, API routes, and static assets
    if (pathname.startsWith('/admin') || pathname.startsWith('/api') || pathname.startsWith('/_next')) return
    // Deduplicate: don't track same path twice in a row (React double-render)
    if (pathname === lastPath.current) return
    lastPath.current = pathname

    const ua = navigator.userAgent || ''
    if (BOT_PATTERNS.test(ua)) return

    const referrer = cleanReferrer(document.referrer)

    const payload = {
      page_path:    pathname,
      referrer:     referrer === 'internal' ? null : referrer,
      browser:      getBrowser(ua),
      device_type:  getDeviceType(window.innerWidth),
      screen_width: window.innerWidth,
      session_id:   getSessionId(),
      visitor_id:   getVisitorId(),
      utm_source:   searchParams.get('utm_source') || (searchParams.get('fbclid') ? 'facebook' : null),
      utm_medium:   searchParams.get('utm_medium') || null,
      utm_campaign: searchParams.get('utm_campaign') || null,
      event_type:   'pageview',
    }

    // POST to server-side route which enriches with geo data from Netlify
    // headers (country, city) and inserts into site_analytics
    fetch('/api/track-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => { /* fire and forget */ })
  }, [pathname, searchParams])

  return null
}
