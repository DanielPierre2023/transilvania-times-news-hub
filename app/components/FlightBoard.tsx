'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PlaneTakeoff, PlaneLanding, Search, RefreshCw, Plane, Share2, Check,
} from 'lucide-react'
import AirportsLogo from './AirportsLogo'
import AirlineLogo from './AirlineLogo'
import {
  AIRPORTS, AIRPORT_ORDER, LABELS, STATUS_META, STATUS_CLASSES,
  dateForDay, statusLabel, dateHeading,
  bucharestNowMinutes, flightMinuteIndex,
  type AirportCode, type Direction, type DayKey, type FlightRow, type Lang,
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

export default function FlightBoard({ initialFlights, initialToday, initialLang, initialAirport = 'CLJ' }: Props) {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [airport, setAirport] = useState<AirportCode>(initialAirport)
  const [direction, setDirection] = useState<Direction>('departure')
  const [mode, setMode] = useState<Mode>('live')
  const [search, setSearch] = useState('')
  const [airline, setAirline] = useState('')
  const [city, setCity] = useState('')

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

  useEffect(() => { setAirline(''); setCity('') }, [airport, direction, mode])

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
    () => Array.from(new Set(scoped.map(f => f.airline).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'ro')),
    [scoped],
  )
  const cities = useMemo(
    () => Array.from(new Set(scoped.map(f => f.city).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'ro')),
    [scoped],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return scoped
      .filter(f => (airline ? f.airline === airline : true))
      .filter(f => (city ? f.city === city : true))
      .filter(f => !q || [f.flight_no, f.airline, f.city].some(v => (v ?? '').toLowerCase().includes(q)))
  }, [scoped, airline, city, search])

  const meta = AIRPORTS[airport]
  const cityHdr = direction === 'departure' ? t.colTo : t.colFrom
  const modes: Mode[] = ['live', 'today', 'tomorrow', 'yesterday']
  const modeLabel: Record<Mode, string> = { live: t.liveWindow, today: t.today, tomorrow: t.tomorrow, yesterday: t.yesterday }

  return (
    <div className="max-w-7xl mx-auto border-x border-foreground/10">
      <div className="px-4 sm:px-6 pt-8 pb-14">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <AirportsLogo className="h-12 w-12 shrink-0" />
            <div>
              <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground leading-tight">{t.title}</h1>
              <p className="font-sans text-[13px] text-muted-foreground mt-1">{t.subtitle}</p>
            </div>
          </div>
          <button
            onClick={() => setLang(l => (l === 'ro' ? 'en' : 'ro'))}
            className="shrink-0 font-sans text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-brand-red border border-foreground/15 px-2.5 py-1.5 transition-colors"
            aria-label="Language"
          >{lang === 'ro' ? 'EN' : 'RO'}</button>
        </div>

        {/* Airport tabs */}
        <div className="flex flex-wrap gap-1 mb-4" role="tablist" aria-label="Airport">
          {AIRPORT_ORDER.map(code => {
            const a = AIRPORTS[code]; const active = code === airport
            return (
              <button key={code} role="tab" aria-selected={active} onClick={() => setAirport(code)}
                className={`flex items-center gap-2 font-sans text-[12px] font-bold uppercase tracking-wider px-4 py-2.5 transition-colors border-b-2 ${
                  active ? 'border-brand-red text-brand-red' : 'border-transparent text-foreground/60 hover:text-foreground'}`}>
                <span>{a.short}</span><span className="font-mono text-[10px] opacity-70">{a.iata}</span>
              </button>
            )
          })}
        </div>

        {/* Controls */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
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

          {/* Mode: Live+12h / Azi / Mâine / Ieri */}
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

          <select value={airline} onChange={e => setAirline(e.target.value)}
            className="bg-background border border-foreground/15 text-foreground text-[13px] font-sans px-2.5 py-2 outline-none focus:border-brand-red/50 max-w-[160px]">
            <option value="">{t.allAirlines}</option>
            {airlines.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={city} onChange={e => setCity(e.target.value)}
            className="bg-background border border-foreground/15 text-foreground text-[13px] font-sans px-2.5 py-2 outline-none focus:border-brand-red/50 max-w-[160px]">
            <option value="">{t.allCities}</option>
            {cities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3 mb-2 text-[11px] font-sans text-muted-foreground">
          <span className="flex items-center gap-1.5"><Plane className="w-3 h-3" />{meta.hasLiveStatus ? t.liveNote : t.scheduleOnly}</span>
          <button onClick={refresh} className="flex items-center gap-1.5 hover:text-brand-red transition-colors">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            {fetchedAt ? `${t.updated} ${formatTime(fetchedAt, lang)}` : t.refresh}
          </button>
        </div>

        {/* Board */}
        <div className="border border-foreground/10 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-foreground/[0.03] border-b border-foreground/10">
                <Th>{t.colAirline}</Th>
                <Th>{t.colFlight}</Th>
                <Th>{cityHdr}</Th>
                <Th>{t.colScheduled}</Th>
                <Th>{t.colStatus}</Th>
                <Th className="text-right pr-4 hidden sm:table-cell">{t.share}</Th>
              </tr>
            </thead>
            <tbody>
              {error && (
                <tr><td colSpan={6} className="px-4 py-10 text-center font-sans text-[13px] text-brand-red">{t.loadError}</td></tr>
              )}
              {!error && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center font-sans text-[13px] text-muted-foreground">{t.noFlights}</td></tr>
              )}
              {!error && renderGrouped(rows, { lang, t, direction, airport })}
            </tbody>
          </table>
        </div>

        <p className="mt-4 font-sans text-[11px] text-muted-foreground leading-relaxed">
          {t.disclaimer}{' '}
          <a href={meta.code === 'CLJ' ? 'https://www.airportcluj.ro/' : meta.code === 'TGM' ? 'https://aeroportultransilvania.ro/' : 'https://www.sibiuairport.ro/'}
            target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-brand-red">{meta.name}</a>
        </p>
      </div>
    </div>
  )
}

/* ── Rendering helpers ────────────────────────────────────────────────────── */

function renderGrouped(
  rows: FlightRow[],
  ctx: { lang: Lang; t: L; direction: Direction; airport: AirportCode },
) {
  const out: React.ReactNode[] = []
  let lastDate = ''
  rows.forEach((f, i) => {
    if (f.flight_date !== lastDate) {
      lastDate = f.flight_date
      out.push(
        <tr key={`d-${f.flight_date}`} className="bg-brand-red/[0.06]">
          <td colSpan={6} className="px-4 py-1.5 font-sans text-[11px] font-bold uppercase tracking-widest text-brand-red">
            {dateHeading(f.flight_date, ctx.lang)}
          </td>
        </tr>,
      )
    }
    out.push(<FlightRowView key={`${f.flight_no}-${f.scheduled_time}-${i}`} f={f} {...ctx} />)
  })
  return out
}

function FlightRowView({ f, lang, t, direction, airport }: {
  f: FlightRow; lang: Lang; t: L; direction: Direction; airport: AirportCode
}) {
  const sm = STATUS_META[f.status] ?? STATUS_META.UNKNOWN
  const shareText = buildShareText(f, lang, direction, airport)

  return (
    <tr className="border-b border-foreground/[0.06] hover:bg-foreground/[0.02]">
      {/* Airline: monogram logo + name */}
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-2.5">
          <AirlineLogo flightNo={f.flight_no} />
          <span className="hidden md:inline font-sans text-[13px] text-foreground/80">{f.airline ?? '—'}</span>
        </div>
      </td>
      {/* Flight */}
      <td className="px-4 py-3 font-mono text-[13px] font-bold text-foreground whitespace-nowrap">
        {f.flight_no}
        {f.is_charter && (
          <span className="ml-2 font-sans text-[9px] font-bold uppercase tracking-wider text-amber-600 border border-amber-500/30 px-1 py-0.5 align-middle">{t.charter}</span>
        )}
      </td>
      {/* City */}
      <td className="px-4 py-3 font-sans text-[13px] font-medium text-foreground">{f.city ?? '—'}</td>
      {/* Time */}
      <td className="px-4 py-3 font-mono text-[14px] font-semibold text-foreground tabular-nums whitespace-nowrap">{f.scheduled_time ? String(f.scheduled_time).slice(0, 5) : '—'}</td>
      {/* Status (Hermes-style, with inline actual/estimated time) */}
      <td className="px-4 py-3 whitespace-nowrap">
        <span className={`inline-block font-sans text-[11px] font-bold uppercase tracking-wider px-2 py-1 ring-1 ${STATUS_CLASSES[sm.color]}`}>
          {statusLabel(f, lang)}
        </span>
      </td>
      {/* Share — WhatsApp / Messenger / Facebook / Telegram / native sheet */}
      <td className="px-4 py-3 text-right pr-4 hidden sm:table-cell whitespace-nowrap">
        <div className="inline-flex items-center gap-3">
          <a aria-label="WhatsApp" title="WhatsApp" target="_blank" rel="noopener noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            className="text-[#25D366] hover:opacity-75 hover:scale-110 transition-all"><IconWhatsApp /></a>
          <a aria-label="Messenger" title="Messenger" target="_blank" rel="noopener noreferrer"
            href={`fb-messenger://share?link=${encodeURIComponent(SITE)}`}
            className="text-[#0084FF] hover:opacity-75 hover:scale-110 transition-all"><IconMessenger /></a>
          <a aria-label="Facebook" title="Facebook" target="_blank" rel="noopener noreferrer"
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SITE)}&quote=${encodeURIComponent(shareText)}`}
            className="text-[#1877F2] hover:opacity-75 hover:scale-110 transition-all"><IconFacebook /></a>
          <a aria-label="Telegram" title="Telegram" target="_blank" rel="noopener noreferrer"
            href={`https://t.me/share/url?url=${encodeURIComponent(SITE)}&text=${encodeURIComponent(shareText)}`}
            className="text-[#26A5E4] hover:opacity-75 hover:scale-110 transition-all"><IconTelegram /></a>
          <ShareMore text={shareText} lang={lang} />
        </div>
      </td>
    </tr>
  )
}

/* Brand share icons — larger and colour-coded for recognition. */
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
function ShareMore({ text, lang }: { text: string; lang: Lang }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      aria-label={lang === 'ro' ? 'Alte aplicații' : 'More apps'}
      title={copied ? (lang === 'ro' ? 'Copiat!' : 'Copied!') : (lang === 'ro' ? 'Alte aplicații / copiază' : 'More apps / copy')}
      onClick={() => {
        const nav = navigator as Navigator & { share?: (d: { text: string; url: string }) => Promise<void> }
        if (nav.share) {
          nav.share({ text, url: SITE }).catch(() => {})
        } else {
          navigator.clipboard?.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }).catch(() => {})
        }
      }}
      className={`${copied ? 'text-emerald-600' : 'text-muted-foreground'} hover:text-brand-red hover:scale-110 transition-all`}
    >
      {copied ? <Check className="h-[18px] w-[18px]" /> : <Share2 className="h-[18px] w-[18px]" />}
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
    `✈️ ${f.flight_no}${f.airline ? ' — ' + f.airline : ''}${f.is_charter ? (ro ? ' (charter)' : ' (charter)') : ''}`,
    `${routeLabel}: ${route}`,
    `${ro ? 'Data' : 'Date'}: ${dateHeading(f.flight_date, lang)}`,
    `${ro ? 'Ora programată' : 'Scheduled time'}: ${sched ?? '—'}`,
  ]
  if (est && est !== sched) lines.push(`${ro ? 'Ora estimată/reală' : 'Estimated/actual time'}: ${est}`)
  lines.push(`Status: ${statusLabel(f, lang)}`)
  lines.push('')
  lines.push(`${ro ? 'Urmărește live' : 'Track live'}: ${SITE}`)
  lines.push(ro ? 'via Transilvania Times' : 'via Transilvania Times')
  return lines.join('\n')
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-sans text-[10px] font-bold uppercase tracking-widest text-muted-foreground ${className}`}>{children}</th>
}

function formatTime(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest',
  }).format(d)
}
