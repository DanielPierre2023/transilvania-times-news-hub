'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PlaneTakeoff, PlaneLanding, Search, RefreshCw, Plane, Share2, Check,
  SlidersHorizontal, ChevronDown, X, Building2,
} from 'lucide-react'
import AirportsLogo from './AirportsLogo'
import AirlineLogo from './AirlineLogo'
import {
  AIRPORTS, AIRPORT_ORDER, LABELS, STATUS_META,
  dateForDay, statusLabel, dateHeading, airlineName, airlineColor,
  bucharestNowMinutes, flightMinuteIndex,
  type AirportCode, type Direction, type DayKey, type FlightRow, type Lang,
  type StatusColor,
} from '@/lib/flights'

interface Props {
  initialFlights: FlightRow[]
  initialToday: string
  initialLang: Lang
  initialAirport?: AirportCode
}

type Mode = 'live' | 'today' | 'tomorrow' | 'yesterday'
// Widened label shape (LABELS.ro / LABELS.en are distinct literal types under `as const`).
type L = { [K in keyof (typeof LABELS)['ro']]: string }
const SITE = 'https://transilvaniatimes.com/zboruri/'
const AIRPORT_SLUG_MAP: Record<AirportCode, string> = { CLJ: 'cluj', TGM: 'targu-mures', SBZ: 'sibiu' }

/** Per-flight permalink used for Facebook/Messenger shares. Those platforms
 *  ignore any text passed to their share dialog — they render only what they
 *  scrape from the target URL's OpenGraph tags. See app/zboruri/f/[slug]. */
function flightPermalink(f: FlightRow, lang: Lang): string {
  const airportSlug = AIRPORT_SLUG_MAP[f.airport]
  const dir = f.direction === 'departure' ? 'd' : 'a'
  const date = f.flight_date.replaceAll('-', '')
  const no = f.flight_no.replace(/\s+/g, '').toLowerCase()
  const time = String(f.scheduled_time ?? '00:00').slice(0, 5).replace(':', '')
  const base = lang === 'en' ? 'https://transilvaniatimes.com/en/zboruri/f' : 'https://transilvaniatimes.com/zboruri/f'
  return `${base}/${airportSlug}-${dir}-${date}-${no}-${time}/`
}

/* Editorial status pills: tinted ground + coloured dot; the dot pulses while
   the status is "in motion" (check-in, boarding, en-route). */
const PILL: Record<StatusColor, string> = {
  green: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  blue:  'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  red:   'bg-brand-red/10 text-brand-red',
  gray:  'bg-foreground/[0.06] text-muted-foreground',
}
const DOT: Record<StatusColor, string> = {
  green: 'bg-emerald-600',
  blue:  'bg-sky-600',
  amber: 'bg-amber-500',
  red:   'bg-brand-red',
  gray:  'bg-foreground/40',
}
const LIVE_STATUSES = new Set(['CHECKIN', 'BOARDING', 'GATE_OPEN', 'EN_ROUTE'])

export default function FlightBoard({ initialFlights, initialToday, initialLang, initialAirport = 'CLJ' }: Props) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [airport, setAirport] = useState<AirportCode>(initialAirport)
  const [direction, setDirection] = useState<Direction>('departure')
  const [mode, setMode] = useState<Mode>('live')
  const [search, setSearch] = useState('')
  const [airline, setAirline] = useState('')
  const [city, setCity] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState<string | null>(null)

  const [flights, setFlights] = useState<FlightRow[]>(initialFlights)
  const [today, setToday] = useState(initialToday)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const t = LABELS[lang]

  const refresh = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/flights', { cache: 'no-store' })
      if (!res.ok) throw new Error('bad status')
      const data = await res.json()
      setFlights(data.flights ?? [])
      if (data.today) setToday(data.today)
      setFetchedAt(new Date())
    } catch { setError(true) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    setFetchedAt(new Date())
    const id = setInterval(refresh, 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh])

  useEffect(() => { setAirline(''); setCity(''); setShareOpen(null) }, [airport, direction, mode])

  // Base slice for the current airport + direction.
  const base = useMemo(
    () => flights.filter(f => f.airport === airport && f.direction === direction),
    [flights, airport, direction],
  )

  // Apply the time window (Live + last 12h, or a specific day).
  const scoped = useMemo(() => {
    const nowIdx = bucharestNowMinutes()
    let out: FlightRow[]
    if (mode === 'live') {
      out = base.filter(f =>
        f.scheduled_time && flightMinuteIndex(f.flight_date, f.scheduled_time, today) >= nowIdx - 720)
    } else {
      const target = dateForDay(mode as DayKey, today)
      out = base.filter(f => f.flight_date === target)
    }
    return out.slice().sort((a, b) =>
      flightMinuteIndex(a.flight_date, a.scheduled_time ?? '00:00', today) -
      flightMinuteIndex(b.flight_date, b.scheduled_time ?? '00:00', today))
  }, [base, mode, today])

  const airlines = useMemo(
    () => Array.from(new Set(scoped.map(f => airlineName(f)).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'ro')),
    [scoped],
  )
  const cities = useMemo(
    () => Array.from(new Set(scoped.map(f => f.city).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'ro')),
    [scoped],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped
      .filter(f => (airline ? airlineName(f) === airline : true))
      .filter(f => (city ? f.city === city : true))
      .filter(f => !q || [f.flight_no, airlineName(f), f.city].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [scoped, airline, city, search])

  const meta = AIRPORTS[airport]
  const cityHdr = direction === 'departure' ? t.colTo : t.colFrom
  const modes: Mode[] = ['live', 'today', 'tomorrow', 'yesterday']
  const modeLabel: Record<Mode, string> = { live: t.liveWindow, today: t.today, tomorrow: t.tomorrow, yesterday: t.yesterday }
  const modeLabelShort: Record<Mode, string> = { live: t.live, today: t.today, tomorrow: t.tomorrow, yesterday: t.yesterday }
  const activeFilterCount = (search.trim() ? 1 : 0) + (airline ? 1 : 0) + (city ? 1 : 0)
  const ctx = { lang, t, direction, airport }

  return (
    <div className="max-w-7xl mx-auto border-x border-foreground/10 [-webkit-tap-highlight-color:transparent]">
      <div className="px-0 sm:px-6 pt-6 sm:pt-8 pb-14">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5 px-4 sm:px-0">
          <div className="flex items-center gap-3.5">
            <AirportsLogo className="h-11 w-11 sm:h-12 sm:w-12 shrink-0" />
            <div>
              <h1 className="font-serif text-[22px] sm:text-2xl md:text-3xl font-bold text-foreground leading-tight">{t.title}</h1>
              <p className="hidden sm:block font-sans text-[13px] text-muted-foreground mt-1">{t.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a href={lang === 'en' ? '/en/zboruri/companii/' : '/zboruri/companii/'}
              className="hidden sm:inline-flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-wider text-foreground/60 hover:text-brand-red transition-colors"
              title={lang === 'ro' ? 'Companii aeriene & bagaje' : 'Airlines & baggage'}>
              <Building2 className="w-3.5 h-3.5" />{lang === 'ro' ? 'Companii' : 'Airlines'}
            </a>
            <span className="inline-flex items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.14em] text-brand-red" aria-live="polite">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-red/50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-red" />
              </span>
              {t.live}
            </span>
            <button
              onClick={() => setLang(l => (l === 'ro' ? 'en' : 'ro'))}
              className="font-sans text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-brand-red border border-foreground/15 px-2.5 py-1.5 transition-colors"
              aria-label="Language"
            >{lang === 'ro' ? 'EN' : 'RO'}</button>
          </div>
        </div>

        {/* Airport tabs — scrollable strip on narrow screens */}
        <div className="flex gap-0 sm:gap-1 mb-0 sm:mb-4 border-b border-foreground/10 sm:border-0 overflow-x-auto px-2 sm:px-0" role="tablist" aria-label="Airport">
          {AIRPORT_ORDER.map(code => {
            const a = AIRPORTS[code]; const active = code === airport
            return (
              <button key={code} role="tab" aria-selected={active} onClick={() => setAirport(code)}
                className={`shrink-0 flex items-center gap-1.5 font-sans text-[12px] font-bold uppercase tracking-wider px-3.5 sm:px-4 py-3 sm:py-2.5 transition-colors border-b-2 ${
                  active ? 'border-brand-red text-brand-red' : 'border-transparent text-foreground/60 hover:text-foreground'}`}>
                <span>{a.short}</span><span className="font-mono text-[10px] opacity-70">{a.iata}</span>
              </button>
            )
          })}
        </div>

        {/* ── Mobile controls: segmented rows + filter drawer ─────────────── */}
        <div className="md:hidden border-b border-foreground/10">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <div className="flex flex-1 rounded-full border border-foreground/15 bg-foreground/[0.03] p-0.5" role="tablist" aria-label="Direction">
              <button role="tab" aria-selected={direction === 'departure'} onClick={() => setDirection('departure')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full font-sans text-[11px] font-bold uppercase tracking-wider py-2 transition-colors ${
                  direction === 'departure' ? 'bg-brand-red text-white' : 'text-foreground/60'}`}>
                <PlaneTakeoff className="w-3.5 h-3.5" /> {t.departures}
              </button>
              <button role="tab" aria-selected={direction === 'arrival'} onClick={() => setDirection('arrival')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-full font-sans text-[11px] font-bold uppercase tracking-wider py-2 transition-colors ${
                  direction === 'arrival' ? 'bg-brand-red text-white' : 'text-foreground/60'}`}>
                <PlaneLanding className="w-3.5 h-3.5" /> {t.arrivals}
              </button>
            </div>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              aria-expanded={filtersOpen}
              aria-label={t.filters}
              className={`relative flex h-[38px] w-[42px] shrink-0 items-center justify-center rounded-full border transition-colors ${
                filtersOpen ? 'border-brand-red text-brand-red bg-brand-red/[0.06]' : 'border-foreground/15 text-foreground/70'}`}>
              <SlidersHorizontal className="w-4 h-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-[15px] w-[15px] items-center justify-center rounded-full bg-brand-red font-sans text-[9px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex gap-1.5 overflow-x-auto px-4 pb-2.5">
            {modes.map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`shrink-0 rounded-full font-sans text-[11px] font-bold uppercase tracking-wider px-3.5 py-1.5 border transition-colors ${
                  mode === m
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-foreground/15 text-foreground/60'}`}>
                {m === 'live' ? modeLabel.live : modeLabelShort[m]}
              </button>
            ))}
          </div>

          {filtersOpen && (
            <div className="border-t border-foreground/[0.08] px-4 py-3 space-y-2.5 bg-foreground/[0.02]">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                {/* 16px font: prevents iOS Safari from zooming into the field */}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t.search}
                  className="w-full rounded-full bg-background border border-foreground/15 text-foreground text-[16px] font-sans pl-10 pr-4 py-2.5 outline-none focus:border-brand-red/50 placeholder:text-muted-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <SelectBox value={airline} onChange={setAirline} allLabel={t.allAirlines} options={airlines} mobile />
                <SelectBox value={city} onChange={setCity} allLabel={t.allCities} options={cities} mobile />
              </div>
              {activeFilterCount > 0 && (
                <button onClick={() => { setSearch(''); setAirline(''); setCity('') }}
                  className="flex items-center gap-1.5 font-sans text-[11px] font-bold uppercase tracking-wider text-brand-red">
                  <X className="w-3.5 h-3.5" /> {t.clearFilters}
                </button>
              )}
            </div>
          )}

          {!filtersOpen && activeFilterCount > 0 && (
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-2.5 -mt-0.5">
              {search.trim() && <FilterChip label={`„${search.trim()}”`} onClear={() => setSearch('')} />}
              {airline && <FilterChip label={airline} onClear={() => setAirline('')} />}
              {city && <FilterChip label={city} onClear={() => setCity('')} />}
            </div>
          )}
        </div>

        {/* ── Desktop controls ────────────────────────────────────────────── */}
        <div className="hidden md:flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
          <div className="flex border border-foreground/15 shrink-0">
            <button onClick={() => setDirection('departure')}
              className={`flex items-center gap-1.5 font-sans text-[12px] font-bold uppercase tracking-wider px-4 py-2 transition-colors ${
                direction === 'departure' ? 'bg-brand-red text-white' : 'text-foreground/70 hover:text-foreground'}`}>
              <PlaneTakeoff className="w-3.5 h-3.5" /> {t.departures}
            </button>
            <button onClick={() => setDirection('arrival')}
              className={`flex items-center gap-1.5 font-sans text-[12px] font-bold uppercase tracking-wider px-4 py-2 transition-colors ${
                direction === 'arrival' ? 'bg-brand-red text-white' : 'text-foreground/70 hover:text-foreground'}`}>
              <PlaneLanding className="w-3.5 h-3.5" /> {t.arrivals}
            </button>
          </div>

          <div className="flex border border-foreground/15 shrink-0 overflow-hidden">
            {modes.map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`font-sans text-[11px] font-bold uppercase tracking-wider px-3 py-2 transition-colors ${
                  mode === m ? 'bg-foreground text-background' : 'text-foreground/60 hover:text-foreground'}`}>
                {modeLabel[m]}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t.search}
              className="w-full bg-background border border-foreground/15 text-foreground text-[13px] font-sans pl-9 pr-3 py-2 outline-none focus:border-brand-red/50 placeholder:text-muted-foreground" />
          </div>

          <SelectBox value={airline} onChange={setAirline} allLabel={t.allAirlines} options={airlines} />
          <SelectBox value={city} onChange={setCity} allLabel={t.allCities} options={cities} />
        </div>

        <div className="flex items-center justify-between gap-3 mb-0 md:mb-2 px-4 sm:px-0 py-2 md:py-0 text-[11px] font-sans text-muted-foreground">
          <span className="flex items-center gap-1.5"><Plane className="w-3 h-3" />{meta.hasLiveStatus ? t.liveNote : t.scheduleOnly}</span>
          <button onClick={refresh} className="flex items-center gap-1.5 hover:text-brand-red transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {fetchedAt ? `${t.updated} ${formatTime(fetchedAt, lang)}` : t.refresh}
          </button>
        </div>

        {/* ── Mobile board: card list ─────────────────────────────────────── */}
        <div className="md:hidden border-t border-foreground/10">
          {error && <p className="px-4 py-10 text-center font-sans text-[13px] text-brand-red">{t.loadError}</p>}
          {!error && rows.length === 0 && (
            <p className="px-4 py-12 text-center font-sans text-[13px] text-muted-foreground">{t.noFlights}</p>
          )}
          {!error && renderGroupedCards(rows, ctx, shareOpen, setShareOpen)}
        </div>

        {/* ── Desktop board: table ────────────────────────────────────────── */}
        <div className="hidden md:block border border-foreground/10 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-foreground/[0.03] border-b border-foreground/10">
                <Th>{t.colAirline}</Th>
                <Th>{t.colFlight}</Th>
                <Th>{cityHdr}</Th>
                <Th>{t.colScheduled}</Th>
                <Th>{t.colStatus}</Th>
                <Th className="text-right pr-4">{t.share}</Th>
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr><td colSpan={6} className="px-4 py-10 text-center font-sans text-[13px] text-brand-red">{t.loadError}</td></tr>
              )}
              {!error && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center font-sans text-[13px] text-muted-foreground">{t.noFlights}</td></tr>
              )}
              {!error && renderGrouped(rows, ctx)}
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-sans text-[11px] text-muted-foreground leading-relaxed px-4 sm:px-0">
          {t.disclaimer}{' '}
          <a href={meta.code === 'CLJ' ? 'https://www.airportcluj.ro/' : meta.code === 'TGM' ? 'https://aeroportultransilvania.ro/' : 'https://www.sibiuairport.ro/'}
            target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-brand-red">{meta.name}</a>
        </p>
      </div>
    </div>
  )
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

/** Styled <select>: appearance-none + our own chevron, so the CLOSED control
 *  renders identically on iOS, Android and desktop; the OPENED picker stays
 *  native, which is the right UX on each platform. 16px font on mobile stops
 *  iOS Safari's focus zoom. */
function SelectBox({ value, onChange, allLabel, options, mobile = false }: {
  value: string; onChange: (v: string) => void; allLabel: string; options: string[]; mobile?: boolean
}) {
  return (
    <span className={`relative ${mobile ? 'block' : 'inline-block max-w-[160px]'}`}>
      <select value={value} onChange={e => onChange(e.target.value)}
        className={`w-full appearance-none bg-background border border-foreground/15 text-foreground font-sans outline-none focus:border-brand-red/50 ${
          mobile ? 'rounded-full text-[16px] pl-4 pr-8 py-2' : 'text-[13px] pl-2.5 pr-7 py-2'}`}>
        <option value="">{allLabel}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
    </span>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button onClick={onClear}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background font-sans text-[11px] font-semibold px-3 py-1.5 max-w-[180px]">
      <span className="truncate">{label}</span>
      <X className="w-3 h-3 shrink-0" />
    </button>
  )
}

function StatusPill({ f, lang, compact = false }: { f: FlightRow; lang: Lang; compact?: boolean }) {
  const sm = STATUS_META[f.status] ?? STATUS_META.UNKNOWN
  // Mobile pills stay short: the estimate already sits under the time, so
  // DELAYED shows just the word; DEPARTED/LANDED keep the actual time inline.
  const label = compact && f.status === 'DELAYED'
    ? (lang === 'ro' ? sm.ro : sm.en)
    : statusLabel(f, lang)
  const pulse = LIVE_STATUSES.has(f.status)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-sans font-bold uppercase tracking-wide ${
      compact ? 'text-[10px] px-2.5 py-1' : 'text-[10.5px] tracking-wider px-2.5 py-1'} ${PILL[sm.color]}`}>
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${DOT[sm.color]}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${DOT[sm.color]}`} />
      </span>
      {label}
    </span>
  )
}

/** Estimate for THIS airport: the published revision, else the schedule
 *  (= expected on time). Null for cancelled / diverted / no-info rows. */
function estInfo(f: FlightRow): { shown: string | null; revised: boolean } {
  const est = f.estimated_time ? String(f.estimated_time).slice(0, 5) : null
  const sched = f.scheduled_time ? String(f.scheduled_time).slice(0, 5) : null
  if (f.status === 'CANCELLED' || f.status === 'NO_INFO' || f.status === 'DIVERTED') {
    return { shown: null, revised: false }
  }
  const shown = est ?? sched
  return { shown, revised: Boolean(est && sched && est !== sched) }
}

/** The other end of the leg, with the known delay propagated (~ = derived). */
function otherInfo(f: FlightRow): { text: string; derived: boolean; slip: number } | null {
  if (!f.other_time) return null
  const other = String(f.other_time).slice(0, 5)
  const est = f.estimated_time ? String(f.estimated_time).slice(0, 5) : null
  const sched = f.scheduled_time ? String(f.scheduled_time).slice(0, 5) : null
  const slip = est && sched ? toMin(est) - toMin(sched) : 0
  if (slip >= 10) return { text: `~${addMin(other, slip)}`, derived: true, slip }
  return { text: other, derived: false, slip: 0 }
}

type Ctx = { lang: Lang; t: L; direction: Direction; airport: AirportCode }

function rowKey(f: FlightRow): string {
  return `${f.flight_date}|${f.flight_no}|${f.scheduled_time}`
}

/* ── Desktop table rendering ─────────────────────────────────────────────── */

function renderGrouped(rows: FlightRow[], ctx: Ctx) {
  const out: React.ReactNode[] = []
  let lastDate = ''
  rows.forEach((f, i) => {
    if (f.flight_date !== lastDate) {
      lastDate = f.flight_date
      out.push(
        <tr key={`d-${f.flight_date}`} className="bg-brand-red/[0.05] border-b border-foreground/10">
          <td colSpan={6} className="px-4 py-1.5 font-serif italic text-[14px] text-foreground/90">
            {dateHeading(f.flight_date, ctx.lang)}
          </td>
        </tr>,
      )
    }
    out.push(<FlightRowView key={`${rowKey(f)}-${i}`} f={f} {...ctx} />)
  })
  return out
}

function FlightRowView({ f, lang, t, direction, airport }: { f: FlightRow } & Ctx) {
  const shareText = buildShareText(f, lang, direction, airport)
  const est = estInfo(f)
  const other = otherInfo(f)
  const word = direction === 'departure'
    ? (lang === 'ro' ? 'sosire' : 'arrives')
    : (lang === 'ro' ? 'plecare' : 'departs')

  return (
    <tr className="group border-b border-foreground/[0.06] hover:bg-brand-red/[0.025] transition-colors">
      {/* Airline: wordmark logo + name (derived when the airport publishes none) */}
      <td className="px-4 py-3 whitespace-nowrap border-l-2 border-l-transparent group-hover:border-l-brand-red transition-colors">
        <div className="flex items-center gap-2.5">
          <AirlineLogo flightNo={f.flight_no} wide />
          <span className="hidden lg:inline font-sans text-[13px] text-foreground/80">{airlineName(f) ?? '—'}</span>
        </div>
      </td>
      {/* Flight */}
      <td className="px-4 py-3 font-mono text-[13px] font-bold text-foreground whitespace-nowrap">
        {f.flight_no}
        {f.is_charter && (
          <span className="ml-2 font-sans text-[9px] font-bold uppercase tracking-wider text-amber-600 border border-amber-500/30 px-1 py-0.5 align-middle">{t.charter}</span>
        )}
      </td>
      {/* City + time at the other end of the leg (when published) */}
      <td className="px-4 py-3 font-sans text-[13px] font-medium text-foreground">
        {f.city ?? '—'}
        {other && (
          <span
            className="block font-sans text-[11px] font-normal text-muted-foreground"
            title={other.derived
              ? (lang === 'ro' ? `Estimat pe baza întârzierii de ${other.slip} min` : `Estimated from the ${other.slip}-min delay`)
              : undefined}
          >
            {word}{' '}
            <span className={`font-mono tabular-nums ${other.derived ? 'text-brand-red' : ''}`}>{other.text}</span>
          </span>
        )}
      </td>
      {/* Scheduled — with the revision folded in, airport-board style:
          a revised time strikes the schedule and shows in red beside it. */}
      <td className="px-4 py-3 font-mono text-[14px] tabular-nums whitespace-nowrap">
        {(() => {
          const sched = f.scheduled_time ? String(f.scheduled_time).slice(0, 5) : null
          if (!sched) return <span className="font-semibold text-foreground">—</span>
          if (est.revised && est.shown) {
            return (
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-[12px] text-muted-foreground/80 line-through decoration-brand-red/50">{sched}</span>
                <span className="font-semibold text-brand-red">{est.shown}</span>
              </span>
            )
          }
          return <span className="font-semibold text-foreground">{sched}</span>
        })()}
      </td>
      {/* Status + gate / check-in desk from the airport's own board */}
      <td className="px-4 py-3 whitespace-nowrap">
        <StatusPill f={f} lang={lang} />
        {(f.gate || f.checkin_desk) && (
          <span className="block mt-1 font-sans text-[10.5px] text-muted-foreground">
            {f.gate ? `${t.gateLbl} ${f.gate}` : ''}
            {f.gate && f.checkin_desk ? ' · ' : ''}
            {f.checkin_desk ? `${t.checkinLbl} ${f.checkin_desk}` : ''}
          </span>
        )}
      </td>
      {/* Share */}
      <td className="px-4 py-3 text-right pr-4 whitespace-nowrap">
        <div className="inline-flex items-center gap-3">
          <ShareLinks shareText={shareText} permalink={flightPermalink(f, lang)} />
          <ShareMore text={shareText} url={flightPermalink(f, lang)} lang={lang} />
        </div>
      </td>
    </tr>
  )
}

/* ── Mobile card rendering ───────────────────────────────────────────────── */

function renderGroupedCards(
  rows: FlightRow[],
  ctx: Ctx,
  shareOpen: string | null,
  setShareOpen: (k: string | null) => void,
) {
  const out: React.ReactNode[] = []
  let lastDate = ''
  rows.forEach((f, i) => {
    if (f.flight_date !== lastDate) {
      lastDate = f.flight_date
      out.push(
        <div key={`d-${f.flight_date}`} className="flex items-baseline gap-3 px-4 pt-4 pb-1.5">
          <span className="font-serif italic text-[15px] text-foreground/90">{dateHeading(f.flight_date, ctx.lang)}</span>
          <span className="flex-1 h-px bg-foreground/10" />
        </div>,
      )
    }
    const k = rowKey(f)
    out.push(
      <FlightCard key={`${k}-${i}`} f={f} {...ctx}
        open={shareOpen === k}
        onToggleShare={() => setShareOpen(shareOpen === k ? null : k)} />,
    )
  })
  return out
}

function FlightCard({ f, lang, t, direction, airport, open, onToggleShare }: {
  f: FlightRow; open: boolean; onToggleShare: () => void
} & Ctx) {
  const est = estInfo(f)
  const other = otherInfo(f)
  const name = airlineName(f)
  const shareText = buildShareText(f, lang, direction, airport)
  const word = direction === 'departure'
    ? (lang === 'ro' ? 'sosire' : 'arr.')
    : (lang === 'ro' ? 'plecare' : 'dep.')

  return (
    <div className={`border-b border-foreground/[0.06] px-4 py-3 transition-colors ${open ? 'bg-brand-red/[0.025]' : ''}`}>
      <div className="grid grid-cols-[62px_minmax(0,1fr)_auto] items-center gap-x-3">
        {/* Time block: schedule big; a known revision appears beneath in red
            (on-time flights need no second line — the schedule stands). */}
        <div className="self-start pt-0.5">
          <div className={`font-mono text-[20px] font-semibold leading-none tracking-tight tabular-nums ${
            est.revised ? 'text-muted-foreground/80 line-through decoration-brand-red/50 text-[16px]' : 'text-foreground'}`}>
            {f.scheduled_time ? String(f.scheduled_time).slice(0, 5) : '—'}
          </div>
          {est.revised && est.shown && (
            <div className="mt-1 font-mono text-[17px] font-bold leading-none tabular-nums text-brand-red">
              {est.shown}
            </div>
          )}
        </div>

        {/* City + airline (logo + name) + other-end time */}
        <div className="min-w-0">
          <div className="font-sans text-[15px] font-semibold text-foreground leading-tight truncate">
            {f.city ?? '—'}
            {f.is_charter && (
              <span className="ml-2 font-sans text-[9px] font-bold uppercase tracking-wider text-amber-600 border border-amber-500/30 px-1 py-0.5 align-middle">{t.charter}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-sans text-[11.5px] text-muted-foreground min-w-0">
            <AirlineLogo flightNo={f.flight_no} />
            {name && (
              <span className="font-bold truncate max-w-[92px]" style={{ color: airlineColor(f.flight_no) }}>{name}</span>
            )}
            <span className="font-mono shrink-0">{f.flight_no}</span>
            {other && (
              <span className="shrink-0">
                · {word}{' '}
                <span className={`font-mono tabular-nums ${other.derived ? 'text-brand-red' : ''}`}>{other.text}</span>
              </span>
            )}
          </div>
        </div>

        {/* Status + gate + share (always visible, 40px touch target) */}
        <div className="flex flex-col items-end gap-1.5">
          <StatusPill f={f} lang={lang} compact />
          {(f.gate || f.checkin_desk) && (
            <span className="font-sans text-[10px] font-semibold text-muted-foreground">
              {f.gate ? `${t.gateLbl} ${f.gate}` : ''}
              {f.gate && f.checkin_desk ? ' · ' : ''}
              {f.checkin_desk ? `${t.checkinLbl} ${f.checkin_desk}` : ''}
            </span>
          )}
          <button
            onClick={onToggleShare}
            aria-expanded={open}
            aria-label={t.share}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
              open ? 'border-brand-red/40 text-brand-red bg-brand-red/[0.06]' : 'border-foreground/15 text-foreground/60'}`}>
            <Share2 className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 flex items-center gap-2.5 border-t border-dashed border-foreground/15 pt-3">
          <span className="mr-auto font-sans text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{t.share}</span>
          <ShareLinks shareText={shareText} permalink={flightPermalink(f, lang)} big />
          <ShareMore text={shareText} url={flightPermalink(f, lang)} lang={lang} big />
        </div>
      )}
    </div>
  )
}

/* ── Share widgets ───────────────────────────────────────────────────────── */

/** WhatsApp / Messenger / Facebook / Telegram, colour-coded. `big` renders
 *  40px round chips (mobile touch targets); default is inline desktop icons. */
function ShareLinks({ shareText, permalink, big = false }: { shareText: string; permalink: string; big?: boolean }) {
  const links: { label: string; href: string; color: string; icon: React.ReactNode }[] = [
    // WhatsApp + Telegram accept text — send the full flight card.
    { label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(shareText + '\n' + permalink)}`, color: '#25D366', icon: <IconWhatsApp /> },
    { label: 'Telegram', href: `https://t.me/share/url?url=${encodeURIComponent(permalink)}&text=${encodeURIComponent(shareText)}`, color: '#26A5E4', icon: <IconTelegram /> },
    // Facebook + Messenger discard text; they scrape OpenGraph tags from the
    // target URL. Point them at the per-flight permalink so the shared post
    // shows the flight, not the site's generic homepage summary.
    { label: 'Messenger', href: `https://www.facebook.com/dialog/send?app_id=140586622674265&link=${encodeURIComponent(permalink)}&redirect_uri=${encodeURIComponent(permalink)}`, color: '#0084FF', icon: <IconMessenger /> },
    { label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(permalink)}`, color: '#1877F2', icon: <IconFacebook /> },
  ]
  return (
    <>
      {links.map(l => (
        <a key={l.label} aria-label={l.label} title={l.label} target="_blank" rel="noopener noreferrer" href={l.href}
          className={big
            ? 'flex h-10 w-10 items-center justify-center rounded-full text-white active:scale-95 transition-transform'
            : 'hover:opacity-75 hover:scale-110 transition-all'}
          style={big ? { backgroundColor: l.color } : { color: l.color }}>
          {l.icon}
        </a>
      ))}
    </>
  )
}

/* Brand share icons. */
function IconWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884M20.463 3.488A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/>
    </svg>
  )
}
function IconFacebook() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073"/>
    </svg>
  )
}
function IconMessenger() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M12 0C5.24 0 0 4.95 0 11.64c0 3.5 1.43 6.52 3.77 8.61.2.17.31.43.32.7l.07 2.14c.02.68.72 1.12 1.34.85l2.39-1.05c.2-.09.43-.11.64-.05 1.1.3 2.26.46 3.47.46 6.76 0 12-4.95 12-11.64S18.76 0 12 0zm7.2 8.96l-3.52 5.59c-.56.89-1.76 1.11-2.6.48l-2.8-2.1a.72.72 0 0 0-.87 0l-3.78 2.87c-.51.38-1.17-.22-.83-.76l3.52-5.59c.56-.89 1.76-1.11 2.6-.48l2.8 2.1c.26.2.61.2.87 0l3.78-2.87c.51-.38 1.17.22.83.76z"/>
    </svg>
  )
}
function IconTelegram() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12s5.37 12 12 12 12-5.37 12-12S18.63 0 12 0zm5.9 8.15l-1.98 9.36c-.15.66-.54.82-1.09.51l-3.02-2.23-1.46 1.4c-.16.16-.3.3-.61.3l.22-3.05 5.56-5.02c.24-.22-.05-.34-.37-.13l-6.87 4.33-2.96-.93c-.64-.2-.66-.64.14-.95l11.57-4.46c.54-.2 1.01.13.87.87z"/>
    </svg>
  )
}

/** Native share sheet (Viber, Signal, SMS, email — whatever is installed);
 *  desktop fallback copies the full text to the clipboard. */
function ShareMore({ text, url, lang, big = false }: { text: string; url: string; lang: Lang; big?: boolean }) {
  const [copied, setCopied] = useState(false)
  const icon = copied ? <Check className="h-[18px] w-[18px]" /> : <Share2 className="h-[18px] w-[18px]" />
  return (
    <button
      aria-label={lang === 'ro' ? 'Alte aplicații' : 'More apps'}
      title={copied ? (lang === 'ro' ? 'Copiat!' : 'Copied!') : (lang === 'ro' ? 'Alte aplicații / copiază' : 'More apps / copy')}
      onClick={() => {
        const nav = navigator as Navigator & { share?: (d: { text: string; url: string }) => Promise<void> }
        if (nav.share) {
          nav.share({ text, url }).catch(() => {})
        } else {
          navigator.clipboard?.writeText(text + '\n' + url).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }).catch(() => {})
        }
      }}
      className={big
        ? `flex h-10 w-10 items-center justify-center rounded-full text-white active:scale-95 transition-transform ${copied ? 'bg-emerald-600' : 'bg-espresso'}`
        : `${copied ? 'text-emerald-600' : 'text-muted-foreground'} hover:text-brand-red hover:scale-110 transition-all`}
    >
      {icon}
    </button>
  )
}

/** Professional multi-line share text with full flight details. */
function buildShareText(f: FlightRow, lang: Lang, direction: Direction, airport: AirportCode): string {
  const a = AIRPORTS[airport]
  const hm = (t: string | null) => (t ? String(t).slice(0, 5) : null)
  const sched = hm(f.scheduled_time)
  const est = hm(f.estimated_time)
  const ro = lang === 'ro'
  const routeLabel = direction === 'departure'
    ? (ro ? 'Plecare' : 'Departure')
    : (ro ? 'Sosire' : 'Arrival')
  const route = direction === 'departure'
    ? `${a.short} (${a.iata}) → ${f.city ?? '—'}`
    : `${f.city ?? '—'} → ${a.short} (${a.iata})`
  const lines = [
    `✈️ ${f.flight_no}${airlineName(f) ? ' — ' + airlineName(f) : ''}${f.is_charter ? (ro ? ' (charter)' : ' (charter)') : ''}`,
    `${routeLabel}: ${route}`,
    `${ro ? 'Data' : 'Date'}: ${dateHeading(f.flight_date, lang)}`,
    `${ro ? 'Ora programată' : 'Scheduled time'}: ${sched ?? '—'}`,
  ]
  if (est && est !== sched) lines.push(`${ro ? 'Ora estimată/reală' : 'Estimated/actual time'}: ${est}`)
  const other = hm(f.other_time)
  if (other) {
    const slip = est && sched ? toMin(est) - toMin(sched) : 0
    const shown = slip >= 10 ? `~${addMin(other, slip)} (${ro ? 'estimat; programat' : 'est.; scheduled'} ${other})` : other
    lines.push(direction === 'departure'
      ? `${ro ? 'Sosire la destinație' : 'Arrival at destination'}: ${shown}`
      : `${ro ? 'Plecare din origine' : 'Departure from origin'}: ${shown}`)
  }
  if (f.gate) lines.push(`${ro ? 'Poarta' : 'Gate'}: ${f.gate}`)
  if (f.checkin_desk) lines.push(`Check-in: ${ro ? 'ghișeu' : 'desk'} ${f.checkin_desk}`)
  lines.push(`Status: ${statusLabel(f, lang)}`)
  lines.push('')
  lines.push(`${ro ? 'Urmărește live' : 'Track live'}: ${SITE}`)
  lines.push(ro ? 'via Transilvania Times' : 'via Transilvania Times')
  return lines.join('\n')
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-sans text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${className}`}>{children}</th>
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function addMin(hhmm: string, mins: number): string {
  const t = ((toMin(hhmm) + mins) % 1440 + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function formatTime(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest',
  }).format(d)
}
