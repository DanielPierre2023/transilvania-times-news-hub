// app/api/track-view/route.ts
//
// View tracking endpoint. POST { slug } → increments view_count atomically
// via the increment_view_count() Postgres RPC.

import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const SLUG_PATTERN = /^[a-z0-9-]+$/i

const BOT_PATTERNS = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /scrape/i,
  /headless/i,
  /preview/i,
  /facebookexternalhit/i,
  /linkedinbot/i,
  /twitterbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /slackbot/i,
  /googlebot/i,
  /bingbot/i,
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
    // SECURITY DEFINER RPC — anon role has EXECUTE grant from the migration.
    // The generated Database types don't know about this RPC yet (added in a
    // later migration), so cast to a loose-typed rpc to bypass the param check.
    // Runtime is unaffected; Supabase forwards { post_slug } to the function.
    await (supabase.rpc as (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>)('increment_view_count', { post_slug: slug })
  } catch {
    // Best-effort tracking: never fail the page if this fails.
  }

  return new NextResponse(null, { status: 204 })
}

export async function GET()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function PUT()    { return new NextResponse('Method Not Allowed', { status: 405 }) }
export async function DELETE() { return new NextResponse('Method Not Allowed', { status: 405 }) }
