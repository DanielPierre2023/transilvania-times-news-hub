// app/components/ViewTracker.tsx
'use client'

import { useEffect } from 'react'

/**
 * Client-side view tracker. Fires a single POST to /api/track-view on mount.
 *
 * Uses sessionStorage to debounce: same article in same browser session
 * counts as one view. This is the standard pattern for site-side analytics
 * (matches GA Universal's session behavior).
 */
export default function ViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    if (!slug) return

    const key = `tt:viewed:${slug}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // sessionStorage might be unavailable (privacy mode, etc.) — fire anyway
    }

    // Fire and forget. No state, no error handling on the client.
    fetch('/api/track-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => { /* swallow */ })
  }, [slug])

  return null
}
