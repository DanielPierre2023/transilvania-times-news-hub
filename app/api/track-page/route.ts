// app/api/track-page/route.ts
//
// Server-side page tracking endpoint. Receives tracking data from
// PageTracker (client-side component in layout.tsx) and inserts into
// site_analytics WITH geographic data from Netlify's x-nf-geo header.
//
// Previously, PageTracker inserted directly into Supabase from the
// browser, but the browser has no access to Netlify's geo headers.
// This endpoint bridges the gap: client sends the tracking payload,
// server enriches it with country + city, then inserts.

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

function extractGeo(headers: Headers): { country: string | null; city: string | null } {
  const raw = headers.get('x-nf-geo')
  if (raw) {
    try {
      const geo = JSON.parse(raw)
      return {
        country: geo?.country?.name || geo?.country?.code || null,
        city: geo?.city || null,
      }
    } catch { /* fall through */ }
  }
  const cc = headers.get('x-country')
  return { country: cc || null, city: null }
}

interface TrackPagePayload {
  page_path?: string
  referrer?: string | null
  browser?: string | null
  device_type?: string | null
  screen_width?: number | null
  session_id?: string | null
  visitor_id?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  event_type?: string | null
}

export async function POST(request: Request) {
  let body: TrackPagePayload
  try {
    body = await request.json()
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const pagePath = body?.page_path?.trim()
  if (!pagePath || pagePath.length > 500) {
    return new NextResponse('Invalid page_path', { status: 400 })
  }

  // Skip admin pages (safety — PageTracker also skips them client-side)
  if (pagePath.startsWith('/admin') || pagePath.startsWith('/api') || pagePath.startsWith('/_next')) {
    return new NextResponse(null, { status: 204 })
  }

  try {
    const supabase = await createSupabaseServerClient()
    const geo = extractGeo(request.headers)

    const payload = {
      page_path: pagePath,
      referrer: body.referrer || null,
      browser: body.browser || null,
      device_type: body.device_type || null,
      screen_width: body.screen_width || null,
      user_agent: (request.headers.get('user-agent') || '').substring(0, 300),
      session_id: body.session_id || null,
      visitor_id: body.visitor_id || null,
      is_bot: false,
      utm_source: body.utm_source || null,
      utm_medium: body.utm_medium || null,
      utm_campaign: body.utm_campaign || null,
      event_type: body.event_type || 'pageview',
      country: geo.country,
      city: geo.city,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('site_analytics').insert(payload)
  } catch {
    // Best-effort: never fail the page
  }

  return new NextResponse(null, { status: 204 })
}

export async function GET()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function PUT()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function DELETE() { return new NextResponse('Method Not Allowed', { status: 405 }) }
