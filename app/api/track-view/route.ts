// app/api/track-view/route.ts
//
// View tracking endpoint. POST { slug } → increments blog_posts.view_count
// atomically via the increment_view_count() Postgres RPC.
//
// v2 fix: the original code detached supabase.rpc from its `this` context
// by assigning it to a standalone variable (`const rpc = supabase.rpc as
// LooseRpc`). This caused every RPC call to silently fail because the
// method lost access to the Supabase client's internal REST reference.
// All blog_posts.view_count values were stuck at 0 as a result.
// Fix: call rpc as a method on the client object directly.

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const SLUG_PATTERN = /^[a-z0-9-]+$/i

const BOT_PATTERNS = [
  /bot\b/i, /crawler/i, /spider/i, /scrape/i, /headless/i, /preview/i,
  /facebookexternalhit/i, /linkedinbot/i, /twitterbot/i, /whatsapp/i,
  /telegrambot/i, /slackbot/i, /googlebot/i, /bingbot/i,
]

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return true
  return BOT_PATTERNS.some((re) => re.test(userAgent))
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
    // v2 FIX: call rpc as a method on the client so `this` stays bound.
    // The v1 code did `const rpc = supabase.rpc as LooseRpc; await rpc(...)`
    // which detached the method and silently failed every call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc('increment_view_count', { post_slug: slug })
  } catch {
    // Best-effort tracking: never fail the page if this fails.
  }

  return new NextResponse(null, { status: 204 })
}

export async function GET()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function PUT()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function DELETE() { return new NextResponse('Method Not Allowed', { status: 405 }) }
