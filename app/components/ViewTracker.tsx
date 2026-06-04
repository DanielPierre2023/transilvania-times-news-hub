'use client'

// app/components/ViewTracker.tsx
//
// Fires a single POST to /api/track-view per slug per browser session.
// This increments blog_posts.view_count for the "Most Read" sidebar.
//
// All analytics tracking (referrer, device, geo, etc.) is handled by
// PageTracker → /api/track-page. This component only handles the
// per-article view counter.

import { useEffect } from 'react'

export default function ViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return

    const key = `tt:viewed:${slug}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // sessionStorage might be unavailable (privacy mode) — fire anyway
    }

    fetch('/api/track-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => { /* swallow */ })
  }, [slug])

  return null
}
