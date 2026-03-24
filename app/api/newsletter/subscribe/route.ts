import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const { email, language = 'ro' } = await req.json()

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email:    email.trim().toLowerCase(),
        language: ['ro', 'en'].includes(language) ? language : 'ro',
        confirmed: false,
      })

    if (error) {
      // Unique constraint = already subscribed
      if (error.code === '23505') {
        return NextResponse.json({ success: true, message: 'Already subscribed' })
      }
      console.error('[newsletter] Supabase insert error:', error.message)
      return NextResponse.json({ error: 'Could not subscribe. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[newsletter] Fatal:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
