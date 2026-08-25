import { createSupabaseAnonClient } from '@/lib/supabase/service'
import { airlineCode, bucharestDate, addDays, AIRPORT_ORDER, type AirportCode } from '@/lib/flights'

export type DestinationMap = Record<AirportCode, Record<string, string[]>>

/** Distinct destination cities per airport per airline (IATA), from the live
 *  board over a ±14-day window. Server-only. */
export async function loadDestinations(): Promise<DestinationMap> {
  const empty = () => AIRPORT_ORDER.reduce((o, ap) => ((o[ap] = {}), o), {} as DestinationMap)
  const out = empty()
  try {
    const today = bucharestDate()
    const supabase = createSupabaseAnonClient()
    const { data } = await supabase
      .from('airport_flights')
      .select('airport, flight_no, city')
      .gte('flight_date', addDays(today, -2))
      .lte('flight_date', addDays(today, 200))
      .not('city', 'is', null)
    for (const r of (data ?? []) as { airport: AirportCode; flight_no: string; city: string | null }[]) {
      if (!r.city || !out[r.airport]) continue
      const code = airlineCode(r.flight_no)
      const bag = (out[r.airport][code] ??= [])
      if (!bag.includes(r.city)) bag.push(r.city)
    }
  } catch { /* best-effort — directory still renders its static airline list */ }
  return out
}
