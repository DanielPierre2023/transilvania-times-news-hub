// app/api/track-view/route.ts
//
// v4 — Simplified. Only increments blog_posts.view_count for the
// "Most Read" sidebar. Geographic tracking is handled by /api/track-page
// (called by PageTracker in layout.tsx).
//
// Called by ViewTracker (mounted in blog/[slug]/page.tsx). One call
// per slug per browser session. Filters bots by user-agent.

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('increment_view_count', { post_slug: slug })
  } catch {
    // Best-effort: never fail the page
  }

  return new NextResponse(null, { status: 204 })
}

export async function GET()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function PUT()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function DELETE() { return new NextResponse('Method Not Allowed', { status: 405 }) }
