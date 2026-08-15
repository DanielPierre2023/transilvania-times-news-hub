import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

// Typed service-role client (server-only; bypasses RLS). Never import into a
// 'use client' component.
export function createSupabaseServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Typed anon client for server routes that intentionally use the public anon
// key (RLS-enforced), with no cookie/session.
export function createSupabaseAnonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
