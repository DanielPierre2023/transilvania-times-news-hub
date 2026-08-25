'use client'

import { useMemo, useState } from 'react'
import { Search, Phone, Mail, ExternalLink, Luggage, PlaneTakeoff, X, ChevronDown } from 'lucide-react'
import AirlineLogo from './AirlineLogo'
import { AIRPORTS, AIRPORT_ORDER, airlineColor, type AirportCode, type Lang } from '@/lib/flights'
import {
  AIRLINE_DIRECTORY, resolveHandler, type DirectoryAirline, type Handler,
} from '@/lib/airline-directory'

type Dest = Record<AirportCode, Record<string, string[]>>

interface Props {
  destinations: Dest       // airport -> iata -> cities
  lang: Lang
}

const T = {
  ro: {
    all: 'Toate', search: 'Caută companie sau destinație…',
    destinations: 'Destinații', website: 'Site oficial', flights: 'Vezi zborurile',
    lostFound: 'Bagaje & obiecte pierdute',
    seasonal: 'sezonier', none: 'Nicio companie pentru filtrul selectat.',
    noRoutes: 'Fără rute în programul curent', more: 'rute', less: 'mai puține',
  },
  en: {
    all: 'All', search: 'Search airline or destination…',
    destinations: 'Destinations', website: 'Official site', flights: 'See flights',
    lostFound: 'Baggage & lost property',
    seasonal: 'seasonal', none: 'No airline matches the current filter.',
    noRoutes: 'No routes in the current schedule', more: 'routes', less: 'fewer',
  },
} as const

const SLUG: Record<AirportCode, string> = { CLJ: 'cluj', TGM: 'targu-mures', SBZ: 'sibiu' }
// Distinct, memorable colour per airport so a handler line is never mistaken.
const AIRPORT_COLOR: Record<AirportCode, string> = { CLJ: '#ca2222', TGM: '#0a7d6b', SBZ: '#1d4ed8' }
const ROUTE_CAP = 12

function ApBadge({ ap }: { ap: AirportCode }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-mono text-[10px] font-bold text-white px-2 py-[3px] leading-none tracking-wide"
      style={{ backgroundColor: AIRPORT_COLOR[ap] }}
    >
      {AIRPORTS[ap].iata}
    </span>
  )
}

export default function AirlinesDirectory({ destinations, lang }: Props) {
  const t = T[lang]
  const [airport, setAirport] = useState<AirportCode | ''>('')
  const [q, setQ] = useState('')
  const boardBase = lang === 'en' ? '/en/zboruri' : '/zboruri'

  const airportsOf = (a: DirectoryAirline): AirportCode[] =>
    AIRPORT_ORDER.filter(ap => a.airports.includes(ap) || (destinations[ap]?.[a.iata]?.length ?? 0) > 0)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return AIRLINE_DIRECTORY
      .map(a => ({ a, aps: airportsOf(a) }))
      .filter(({ aps }) => (airport ? aps.includes(airport) : true))
      .filter(({ a, aps }) => {
        if (!needle) return true
        if (a.name.toLowerCase().includes(needle) || a.iata.toLowerCase().includes(needle)) return true
        return aps.some(ap => (destinations[ap]?.[a.iata] ?? []).some(c => c.toLowerCase().includes(needle)))
      })
      .sort((x, y) => x.a.name.localeCompare(y.a.name, 'ro'))
  }, [airport, q, destinations])

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5 px-4 sm:px-6">
        <div className="flex rounded-full border border-foreground/15 bg-background p-0.5 self-start shadow-sm" role="tablist">
          {(['', ...AIRPORT_ORDER] as const).map(ap => (
            <button key={ap || 'all'} role="tab" aria-selected={airport === ap} onClick={() => setAirport(ap)}
              className={`rounded-full font-sans text-[11px] font-bold uppercase tracking-wider px-3.5 py-1.5 transition-colors ${
                airport === ap ? 'bg-brand-red text-white' : 'text-foreground/60'}`}>
              {ap ? AIRPORTS[ap].iata : t.all}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.search}
            className="w-full rounded-full bg-background border border-foreground/15 text-foreground text-[16px] sm:text-[13px] font-sans pl-10 pr-4 py-2 outline-none focus:border-brand-red/50 placeholder:text-muted-foreground shadow-sm" />
          {q && (
            <button onClick={() => setQ('')} aria-label="clear" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-brand-red">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Warm band so the white cards read as distinct panels */}
      <div className="px-4 sm:px-6 py-6 bg-gradient-to-b from-[#f4ebd6] to-[#efe3ca] dark:from-white/[0.04] dark:to-white/[0.02] border-y border-foreground/10">
        {list.length === 0 ? (
          <p className="py-10 text-center font-sans text-[13px] text-muted-foreground">{t.none}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {list.map(({ a, aps }) => (
              <AirlineCard key={a.iata} a={a} aps={aps} destinations={destinations} lang={lang} t={t} boardBase={boardBase} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Contacts({ h }: { h: Handler }) {
  const phones = [h.phone, h.phone2].filter(Boolean) as string[]
  const emails = [h.email, h.email2].filter(Boolean) as string[]
  if (!phones.length && !emails.length) return null
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {phones.map(p => (
        <a key={p} href={`tel:${p.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-brand-red">
          <Phone className="w-3 h-3 shrink-0" />{p}
        </a>
      ))}
      {emails.map(e => (
        <a key={e} href={`mailto:${e}`} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-brand-red break-all">
          <Mail className="w-3 h-3 shrink-0" />{e}
        </a>
      ))}
    </div>
  )
}

function AirlineCard({ a, aps, destinations, lang, t, boardBase }: {
  a: DirectoryAirline; aps: AirportCode[]; destinations: Dest; lang: Lang
  t: { [K in keyof typeof T['ro']]: string }; boardBase: string
}) {
  const [open, setOpen] = useState(false)
  const sampleNo = `${a.iata} 1`
  const allDest = Array.from(new Set(aps.flatMap(ap => destinations[ap]?.[a.iata] ?? [])))
    .sort((x, y) => x.localeCompare(y, 'ro'))
  const shown = open ? allDest : allDest.slice(0, ROUTE_CAP)
  const hidden = allDest.length - shown.length

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 shadow-[0_16px_40px_-24px_rgba(40,24,18,0.5)] ring-1 ring-black/[0.04]">
      {/* brand strip: the airline's own colour, for instant identity */}
      <div className="h-[5px]" style={{ backgroundColor: airlineColor(sampleNo) }} />

      {/* Header — real logo tile + name + airport badges */}
      <div className="flex items-center gap-3.5 px-5 pt-4 pb-3">
        <span className="flex h-11 w-[68px] shrink-0 items-center justify-center rounded-lg border border-foreground/10 bg-white p-1.5">
          <AirlineLogo flightNo={sampleNo} wide large />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[18px] font-bold text-foreground leading-tight">
            {a.name}
            {a.seasonal && (
              <span className="ml-2 align-middle font-sans text-[9px] font-bold uppercase tracking-wider text-amber-600 border border-amber-500/40 rounded px-1 py-0.5">{t.seasonal}</span>
            )}
          </h3>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground mr-0.5">{a.iata}</span>
            {aps.map(ap => <ApBadge key={ap} ap={ap} />)}
          </div>
        </div>
      </div>

      {/* Destinations — capped with expander */}
      <div className="px-5">
        {allDest.length > 0 ? (
          <>
            <div className="font-sans text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              {t.destinations} <span className="text-foreground/40">· {allDest.length}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {shown.map(c => (
                <span key={c} className="font-sans text-[11px] text-foreground/80 bg-foreground/[0.05] border border-foreground/10 rounded-full px-2.5 py-0.5">{c}</span>
              ))}
            </div>
            {(hidden > 0 || open) && allDest.length > ROUTE_CAP && (
              <button onClick={() => setOpen(o => !o)}
                className="mt-2 inline-flex items-center gap-1 font-sans text-[11px] font-bold text-brand-red hover:underline">
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                {open ? t.less : `+ ${hidden} ${t.more}`}
              </button>
            )}
          </>
        ) : (
          <div className="font-sans text-[11px] text-muted-foreground/70 italic">{t.noRoutes}</div>
        )}
      </div>

      {/* Baggage & handling — tinted panel inside the white card */}
      <div className="px-5 pt-4 mt-auto">
        <div className="rounded-xl bg-[#faf6ec] dark:bg-white/[0.03] border border-foreground/10 px-4 py-3">
          <div className="flex items-center gap-1.5 font-sans text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
            <Luggage className="w-3.5 h-3.5" /> {t.lostFound}
          </div>
          <div className="divide-y divide-dashed divide-foreground/10">
            {aps.map(ap => {
              const { handler, passengerNote } = resolveHandler(ap, a.iata)
              return (
                <div key={ap} className="flex gap-2.5 py-2 first:pt-1">
                  <ApBadge ap={ap} />
                  <div className="min-w-0">
                    <div className="font-sans text-[12px] font-semibold text-foreground/85 leading-snug">{handler.name}</div>
                    <Contacts h={handler} />
                    {passengerNote && (
                      <div className="mt-1 font-sans text-[11px] italic text-muted-foreground leading-snug">{passengerNote[lang]}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-5 py-3.5 mt-4 border-t border-foreground/10">
        {a.website ? (
          <a href={a.website} target="_blank" rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 font-sans text-[12px] font-semibold text-muted-foreground hover:text-brand-red transition-colors">
            <ExternalLink className="w-3.5 h-3.5" /> {t.website}
          </a>
        ) : <span />}
        <a href={`${boardBase}/${SLUG[aps[0]]}/`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-red px-3 py-1.5 font-sans text-[12px] font-bold text-white hover:opacity-90 transition-opacity">
          <PlaneTakeoff className="w-3.5 h-3.5" /> {t.flights}
        </a>
      </div>
    </article>
  )
}
