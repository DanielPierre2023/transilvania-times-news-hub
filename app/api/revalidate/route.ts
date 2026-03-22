import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

/**
 * ISR On-Demand Revalidation Webhook
 *
 * Called by Supabase Database Webhooks on blog_posts INSERT or UPDATE.
 * Revalidates only the affected article page — no full rebuild needed.
 * CDN cache is updated within seconds of publish.
 *
 * Setup (Phase 3): Supabase Dashboard → Database → Webhooks
 *   → Table: blog_posts
 *   → Events: INSERT, UPDATE
 *   → URL: https://transilvaniatimes.com/api/revalidate?secret=SECRET&slug={{NEW_RECORD.slug}}
 *
 * Required env var: REVALIDATION_SECRET (set in Netlify dashboard)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')
  const slug = searchParams.get('slug')

  if (!process.env.REVALIDATION_SECRET) {
    return NextResponse.json(
      { error: 'REVALIDATION_SECRET env var is not configured' },
      { status: 500 }
    )
  }

  if (secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json(
      { error: 'Invalid revalidation secret' },
      { status: 401 }
    )
  }

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
