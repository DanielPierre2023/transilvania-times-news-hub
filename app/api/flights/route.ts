import { NextResponse } from 'next/server'
import { createSupabaseAnonClient } from '@/lib/supabase/service'
import { bucharestDate, addDays, type FlightRow } from '@/lib/flights'

// Public, read-only feed for the flight board's client-side auto-refresh.
// Returns yesterday → tomorrow (Europe/Bucharest) for all three airports.
export const dynamic = 'force-dynamic'

export async function GET() {
  const today = bucharestDate()
  const from = addDays(today, -1)
  const to = addDays(today, 1)

  const supabase = createSupabaseAnonClient()
  const { data, error } = await supabase
    .from('airport_flights')
    .select(
      'airport, direction, flight_date, flight_no, airline, city, aircraft, scheduled_time, estimated_time, other_time, gate, checkin_desk, status, status_raw, is_charter, source_url, updated_at',
    )
    .gte('flight_date', from)
    .lte('flight_date', to)
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { today, flights: (data ?? []) as FlightRow[], fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } },
  )
}
