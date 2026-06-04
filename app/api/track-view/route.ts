// app/api/track-view/route.ts
//
// v3 — View tracking endpoint with geo enrichment.
//
// 1. Increments blog_posts.view_count via increment_view_count() RPC
//    (for the "Most Read" sidebar)
// 2. Extracts country + city from Netlify's x-nf-geo header
// 3. Updates the matching site_analytics row (created client-side)
//    with geo data via update_view_geo() RPC
//
// The client-side code creates site_analytics rows with referrer, device,
// browser, visitor_id. This route adds what only the server can know:
// geographic location from Netlify's edge headers.

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const SLUG_PATTERN = /^[a-z0-9-]+$/i

const BOT_PATTERNS = [
  /bot\b/i, /crawler/i, /spider/i, /scrape/i, /headless/i, /preview/i,
  /facebookexternalhit/i, /linkedinbot/i, /twitterbot/i, /whatsapp/i,
  /telegrambot/i, /slackbot/i, /googlebot/i, /bingbot/i, /yandexbot/i,
  /semrush/i, /ahrefs/i, /mj12bot/i, /dotbot/i, /petalbot/i, /bytespider/i,
]

function isBot(ua: string | null): boolean {
  if (!ua) return true
  return BOT_PATTERNS.some((re) => re.test(ua))
}

function extractGeo(headers: Headers): { country: string | null; city: string | null } {
  // Netlify provides x-nf-geo as JSON on all plans (free tier included)
  // Format: {"city":"Cluj-Napoca","country":{"code":"RO","name":"Romania"},
  //          "subdivision":{"code":"CJ","name":"Cluj"}}
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
  // Fallback: x-country header
  const cc = headers.get('x-country')
  return { country: cc || null, city: null }
}

export async function POST(request: Request) {
  let body: { slug?: string }
  try {
    body = await request.json()
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const slug = body?.slug?.trim()
  if (!slug || !SLUG_PATTERN.test(slug) || slug.length > 200) {
    return new NextResponse('Invalid slug', { status: 400 })
  }

  const userAgent = request.headers.get('user-agent')
  if (isBot(userAgent)) {
    return new NextResponse(null, { status: 204 })
  }

  try {
    const supabase = await createSupabaseServerClient()

    // 1. Increment blog_posts.view_count for Most Read sidebar
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('increment_view_count', { post_slug: slug })

    // 2. Extract geo from Netlify edge headers and update site_analytics row
    const geo = extractGeo(request.headers)
    if (geo.country || geo.city) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('update_view_geo', {
        p_slug: slug,
        p_country: geo.country,
        p_city: geo.city,
      })
    }
  } catch {
    // Best-effort tracking: never fail the page if this fails.
  }

  return new NextResponse(null, { status: 204 })
}

export async function GET()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function PUT()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function DELETE() { return new NextResponse('Method Not Allowed', { status: 405 }) }
