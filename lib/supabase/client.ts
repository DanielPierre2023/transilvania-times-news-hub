import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/src/integrations/supabase/types'

/**
 * Browser-side Supabase client for 'use client' components.
 * Replaces the existing src/integrations/supabase/client.ts in Next.js context.
 * Creates a new instance per call — safe for client components.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
