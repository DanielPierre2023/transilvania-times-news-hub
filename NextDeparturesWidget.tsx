import Link from 'next/link'
import { PlaneTakeoff, ArrowRight } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import AirlineLogo from './AirlineLogo'
import {
  AIRPORTS, bucharestDate, addDays, bucharestNowMinutes, flightMinuteIndex,
  type FlightRow,
} from '@/lib/flights'

/**
 * Compact homepage teaser: the next upcoming departures across all three
 * airports, linking into the full /zboruri board. Renders nothing until the
 * airport_flights table has data, so it's safe to mount before first sync.
 */
export default async function NextDeparturesWidget({ lang = 'ro' as 'ro' | 'en' }: { lang?: 'ro' | 'en' }) {
  const today = bucharestDate()
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('airport_flights')
    .select('airport, direction, flight_date, flight_no, airline, city, scheduled_time, estimated_time, status, status_raw, is_charter, source_url, updated_at')
    .eq('direction', 'departure')
    .gte('flight_date', today)
    .lte('flight_date', addDays(today, 1))
    .order('flight_date', { ascending: true })
    .order('scheduled_time', { ascending: true })

  const rows = (data ?? []) as FlightRow[]
  if (rows.length === 0) return null

  const nowIdx = bucharestNowMinutes()
  const upcoming = rows.filter(f => f.scheduled_time && flightMinuteIndex(f.flight_date, f.scheduled_time, today) >= nowIdx)
  const list = (upcoming.length ? upcoming : rows).slice(0, 6)
  if (list.length === 0) return null

  const zboruriHref = lang === 'en' ? '/en/zboruri/' : '/zboruri/'
  const T = lang === 'en'
    ? { title: 'Next departures', all: 'All flights', to: '→' }
    : { title: 'Următoarele plecări', all: 'Toate zborurile', to: '→' }

  return (
    <section className="border-b border-foreground/10">
      <div className="flex items-center justify-between px-6 py-3 border-b border-foreground/[0.06] bg-brand-red/[0.04]">
        <div className="flex items-center gap-2.5">
          <PlaneTakeoff className="w-4 h-4 text-brand-red" />
          <h2 className="font-sans text-[11px] font-bold uppercase tracking-[0.2em] text-brand-red">
            {T.title} · Cluj-Napoca · Târgu Mureș · Sibiu
          </h2>
        </div>
        <Link href={zboruriHref} className="group flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-wider text-foreground/70 hover:text-brand-red transition-colors">
          {T.all} <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((f, i) => (
          <Link
            key={`${f.airport}-${f.flight_no}-${f.scheduled_time}-${i}`}
            href={zboruriHref}
            className="flex items-center gap-3 px-6 py-3 border-b border-r border-foreground/[0.06] hover:bg-foreground/[0.02] transition-colors"
          >
            <AirlineLogo flightNo={f.flight_no} />
            <span className="font-mono text-[15px] font-semibold text-foreground tabular-nums shrink-0">{f.scheduled_time ? String(f.scheduled_time).slice(0, 5) : '—'}</span>
            <span className="flex-1 min-w-0">
              <span className="block font-sans text-[13px] font-medium text-foreground truncate">{f.city ?? '—'}</span>
              <span className="block font-mono text-[11px] text-muted-foreground">{f.flight_no}</span>
            </span>
            <span className="font-mono text-[10px] font-bold text-brand-red/80 border border-brand-red/20 px-1.5 py-0.5 shrink-0">
              {AIRPORTS[f.airport].iata}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
