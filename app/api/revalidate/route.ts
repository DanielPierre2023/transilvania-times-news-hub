import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/admin-auth'

/**
 * ISR On-Demand Revalidation
 *
 * Called by the admin panel after publishing or editing an article.
 * Revalidates only the affected article page — no full rebuild needed.
 * CDN cache is updated within seconds of publish.
 *
 * PREVIOUSLY this was gated by a shared secret passed as a query string
 * parameter, exposed to the browser via NEXT_PUBLIC_REVALIDATION_SECRET (with
 * a hardcoded fallback literal committed to the repo besides). Any visitor
 * could read it out of the admin JS bundle and loop this endpoint to force
 * unbounded ISR regeneration. It is now gated on the same admin-session check
 * as every other mutating admin route — no secret to leak, and revoking one
 * admin's access revokes their ability to hit this route too.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')

  if (slug) {
    // Revalidate the specific article in both locales
    revalidatePath(`/blog/${slug}`)
    revalidatePath(`/en/blog/${slug}`)
  }

  // Always revalidate homepage and blog list — feed order changes on new publish
  revalidatePath('/')
  revalidatePath('/en')
  revalidatePath('/blog')
  revalidatePath('/en/blog')

  return NextResponse.json({
    revalidated: true,
    slug: slug ?? 'all pages',
    timestamp: new Date().toISOString(),
  })
}
