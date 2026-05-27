'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

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
  const supabase = useRef(
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  )

  useEffect(() => {
    // Skip admin pages, API routes, and static assets
    if (pathname.startsWith('/admin') || pathname.startsWith('/api') || pathname.startsWith('/_next')) return
    // Deduplicate: don't track same path twice in a row (React double-render)
    if (pathname === lastPath.current) return
    lastPath.current = pathname

    const ua = navigator.userAgent || ''
    if (BOT_PATTERNS.test(ua)) return // Skip bots

    const isBot = false
    const referrer = cleanReferrer(document.referrer)

    const payload = {
      page_path:    pathname,
      referrer:     referrer === 'internal' ? null : referrer,
      browser:      getBrowser(ua),
      device_type:  getDeviceType(window.innerWidth),
      screen_width: window.innerWidth,
      user_agent:   ua.substring(0, 300),
      session_id:   getSessionId(),
      visitor_id:   getVisitorId(),
      is_bot:       isBot,
      utm_source:   searchParams.get('utm_source') || searchParams.get('fbclid') ? 'facebook' : null,
      utm_medium:   searchParams.get('utm_medium') || null,
      utm_campaign: searchParams.get('utm_campaign') || null,
      event_type:   'pageview',
    }

    // Fire and forget — don't block rendering
    supabase.current.from('site_analytics').insert(payload).then(({ error }) => {
      if (error) console.warn('[tracker]', error.message)
    })
  }, [pathname, searchParams])

  return null // invisible component
}
