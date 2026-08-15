import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'

// Unsubscribe endpoint for the newsletter. The weekly digest footer links to
// /dezabonare?email=<address>, whose page POSTs here. Marks the subscriber
// inactive and stamps unsubscribed_at — the digest's recipient query excludes
// rows where is_active = false OR unsubscribed_at IS NOT NULL, so this takes
// effect on the very next send.
//
// Uses the service-role key (server-side only, never exposed to the browser)
// because row-level security blocks anonymous UPDATEs on newsletter_subscribers.

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) {
      console.error('[unsubscribe] SUPABASE_SERVICE_ROLE_KEY missing')
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    const supabase = createSupabaseServiceClient()

    // Always respond success even if the address isn't found — never disclose
    // whether a given email is on the list.
    const { error } = await supabase
      .from('newsletter_subscribers')
      .update({ is_active: false, unsubscribed_at: new Date().toISOString() })
      .eq('email', email.trim().toLowerCase())

    if (error) {
      console.error('[unsubscribe] Supabase update error:', error.message)
      return NextResponse.json({ error: 'Could not unsubscribe. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[unsubscribe] Fatal:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
