import { NextResponse } from 'next/server'
import { createSupabaseAnonClient } from '@/lib/supabase/service'

// F5: lightweight health/uptime endpoint. Returns 200 when the app is up and
// can reach the database, 503 otherwise. Point an external uptime monitor
// (UptimeRobot, Better Stack, Pingdom, etc.) at /api/health so you learn about
// an outage before a reader reports it. No auth required — it exposes only
// up/down status and a timestamp, never data.

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  let dbOk = false
  let dbError: string | null = null

  try {
    const supabase = createSupabaseAnonClient()
    // Cheapest possible read: a HEAD count with limit 1 on published posts.
    const { error } = await supabase
      .from('blog_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .limit(1)
    if (error) throw error
    dbOk = true
  } catch (e) {
    dbError = (e as Error).message
  }

  const body = {
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'up' : 'down',
    ...(dbError ? { error: dbError } : {}),
    latency_ms: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    status: dbOk ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
