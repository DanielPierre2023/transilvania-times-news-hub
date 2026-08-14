import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from './server'

// Derived from the actual factory rather than the generic `SupabaseClient`
// type: @supabase/supabase-js's SupabaseClient takes a Database-shaped third
// generic (not a bare "public" string), so an untyped `SupabaseClient`
// parameter doesn't structurally match what createSupabaseServerClient()
// returns and fails to typecheck. Awaited<ReturnType<...>> always matches by
// construction.
type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * Admin-role check shared by middleware.ts and every mutating app/api/**
 * route handler.
 *
 * WHY THIS EXISTS
 *   Before this file, /admin/* pages were gated on "is there a valid Supabase
 *   session" (any signed-in user), and every app/api/** route was gated on
 *   nothing at all — RLS on the underlying tables was the only thing standing
 *   between an anonymous request and a write. That worked by accident, not by
 *   design: any permissive RLS policy (see the P1 "shadowing policies" finding
 *   in the audit) silently became a live admin bypass. This file makes "is
 *   this caller an admin" a single, explicit, reusable check instead of an
 *   emergent property of the RLS graph.
 *
 * HOW IT WORKS
 *   Reads the caller's role from public.user_roles via the "Users can read
 *   own role" RLS policy (auth.uid() = user_id), so it works with a plain
 *   session-bound client — no service-role key needed, and it fails closed
 *   if the query errors for any reason.
 */
export async function isAdmin(supabase: SupabaseServerClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle()

  if (error) {
    console.error('[admin-auth] role check failed, denying by default:', error.message)
    return false
  }
  return !!data
}

type RequireAdminResult =
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }

/**
 * Use at the top of any app/api/** route handler that mutates data, sends
 * email, or spends LLM budget:
 *
 *   export async function POST(req: Request) {
 *     const auth = await requireAdmin()
 *     if (!auth.ok) return auth.response
 *     ...
 *   }
 *
 * Returns a ready-to-return 401/403 NextResponse on failure so callers don't
 * need to construct their own error shape.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const admin = await isAdmin(supabase, data.user.id)
  if (!admin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return { ok: true, userId: data.user.id }
}
