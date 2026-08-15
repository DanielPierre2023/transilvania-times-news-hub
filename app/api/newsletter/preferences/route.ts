import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/service'
import { isValidCounty } from '@/lib/counties'

// G2: newsletter preferences endpoint. The /preferinte page POSTs here to set a
// subscriber's county and weather-alert opt-in. Keyed by email (same model as
// unsubscribe). Uses the service-role client (RLS blocks anon UPDATEs).

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()
    const county = body.county === null || body.county === ''
      ? null
      : String(body.county || '').trim().toLowerCase()
    const weatherAlerts = body.weather_alerts === true

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (county !== null && !isValidCounty(county)) {
      return NextResponse.json({ error: 'Invalid county' }, { status: 400 })
    }
    // A subscriber can only receive weather alerts if they have a county set.
    if (weatherAlerts && county === null) {
      return NextResponse.json({ error: 'Select a county to receive weather alerts' }, { status: 400 })
    }

    const supabase = createSupabaseServiceClient()

    // Only touch rows that exist and are active — never disclose whether an
    // address is on the list, so always return success.
    const { error } = await supabase
      .from('newsletter_subscribers')
      .update({ county, weather_alerts: weatherAlerts })
      .eq('email', email)

    if (error) {
      console.error('[preferences] update error:', error.message)
      return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[preferences] Fatal:', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
