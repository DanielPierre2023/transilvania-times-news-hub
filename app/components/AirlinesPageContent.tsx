import Link from 'next/link'
import { Phone, Mail, Info } from 'lucide-react'
import AirportsLogo from './AirportsLogo'
import AirlinesDirectory from './AirlinesDirectory'
import { AIRPORTS, AIRPORT_ORDER, type AirportCode, type Lang } from '@/lib/flights'
import { HANDLERS, LOST_AND_FOUND } from '@/lib/airline-directory'

type Dest = Record<AirportCode, Record<string, string[]>>

// Distinct colour per airport — mirrors AirlinesDirectory so badges match.
const AIRPORT_COLOR: Record<AirportCode, string> = { CLJ: '#ca2222', TGM: '#0a7d6b', SBZ: '#1d4ed8' }

const COPY = {
  ro: {
    crumbZboruri: 'Zboruri', crumbHere: 'Companii aeriene & bagaje',
    h1: 'Companii aeriene & bagaje',
    intro: 'Companiile care operează pe aeroporturile din Transilvania — Cluj-Napoca, Târgu Mureș și Sibiu — împreună cu agentul de handling și biroul de bagaje/obiecte pierdute pentru fiecare. Datele de zbor sunt live; contactele de handling se pot schimba, verificați înainte de călătorie.',
    howTitle: 'Cum funcționează handlingul de bagaje',
    how: 'La aeroport, compania aeriană nu se ocupă de obicei direct de bagaje — o face un „agent de handling”. Dacă un bagaj lipsește sau e deteriorat, mergeți la ghișeul agentului CORECT pentru zborul dvs. și depuneți o reclamație (PIR — Property Irregularity Report) ÎNAINTE de a părăsi zona de bagaje.',
    claimTitle: 'Birou bagaje / obiecte pierdute, pe aeroport',
    stepsTitle: 'Pași pentru un bagaj lipsă',
    steps: [
      'Nu părăsiți zona de recuperare bagaje — reclamația se depune acolo.',
      'Identificați aeroportul de sosire și compania: în tabelul de mai jos găsiți agentul de handling.',
      'La ghișeul agentului, cereți un PIR și păstrați numărul de referință.',
      'Sunați sau scrieți agentului cu numărul PIR pentru a urmări bagajul.',
    ],
    exceptions: 'Excepții la Cluj: pasagerii TAROM și Turkish Airlines se adresează biroului propriu al companiei, nu agentului general.',
    verify: 'Contractele de handling se schimbă la câțiva ani. Pentru situații operaționale, confirmați direct la numerele de mai sus.',
    hours: 'Program', location: 'Unde',
    dirTitle: 'Toate companiile',
  },
  en: {
    crumbZboruri: 'Flights', crumbHere: 'Airlines & baggage',
    h1: 'Airlines & baggage',
    intro: 'The carriers operating at the Transylvania airports — Cluj-Napoca, Târgu Mureș and Sibiu — together with the ground handler and the baggage / lost-property desk for each. Flight data is live; handling contacts can change, so confirm before you travel.',
    howTitle: 'How baggage handling works',
    how: 'At the airport the airline usually does not handle your bags itself — a “ground handling agent” does. If a bag is missing or damaged, go to the CORRECT agent’s desk for your flight and file a report (PIR — Property Irregularity Report) BEFORE leaving the baggage area.',
    claimTitle: 'Baggage / lost-property desk, per airport',
    stepsTitle: 'Steps for a missing bag',
    steps: [
      'Do not leave the baggage reclaim area — the report is filed there.',
      'Identify the arrival airport and airline: the table below gives the handling agent.',
      'At the agent’s desk, ask for a PIR and keep the reference number.',
      'Call or e-mail the agent with the PIR number to trace the bag.',
    ],
    exceptions: 'Exceptions at Cluj: TAROM and Turkish Airlines passengers use the airline’s own desk, not the general agent.',
    verify: 'Handling contracts change every few years. For operational matters, confirm directly at the numbers above.',
    hours: 'Hours', location: 'Where',
    dirTitle: 'All airlines',
  },
} as const

export default function AirlinesPageContent({ lang, destinations }: { lang: Lang; destinations: Dest }) {
  const c = COPY[lang]
  const boardHref = lang === 'en' ? '/en/zboruri' : '/zboruri'

  return (
    <div className="max-w-7xl mx-auto border-x border-foreground/10">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-8">
        <nav className="font-sans text-[11px] text-muted-foreground mb-4">
          <Link href={`${boardHref}/`} className="hover:text-brand-red">{c.crumbZboruri}</Link>
          <span className="mx-1">/</span> {c.crumbHere}
        </nav>
        <div className="flex items-center gap-3.5 mb-3">
          <AirportsLogo className="h-11 w-11 shrink-0" />
          <h1 className="font-serif text-2xl md:text-3xl font-bold text-foreground leading-tight">{c.h1}</h1>
        </div>
        <p className="font-sans text-[15px] leading-relaxed text-foreground/80 max-w-3xl">{c.intro}</p>
      </div>

      {/* How it works */}
      <div className="px-4 sm:px-6 pt-8">
        <h2 className="font-serif text-xl font-bold text-foreground mb-2">{c.howTitle}</h2>
        <p className="font-sans text-[14px] leading-relaxed text-muted-foreground max-w-3xl">{c.how}</p>
      </div>

      {/* Baggage claim desks per airport — white cards on a warm band */}
      <div className="px-4 sm:px-6 pt-8">
        <h2 className="font-serif text-xl font-bold text-foreground mb-4">{c.claimTitle}</h2>
      </div>
      <div className="px-4 sm:px-6 py-6 bg-gradient-to-b from-[#f4ebd6] to-[#efe3ca] dark:from-white/[0.04] dark:to-white/[0.02] border-y border-foreground/10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {AIRPORT_ORDER.map(ap => {
            const lf = LOST_AND_FOUND[ap]
            const h = HANDLERS[lf.handlerId]
            const phones = [h.phone, h.phone2].filter(Boolean) as string[]
            const emails = [h.email, h.email2].filter(Boolean) as string[]
            return (
              <div key={ap} className="overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 shadow-[0_16px_40px_-24px_rgba(40,24,18,0.5)] ring-1 ring-black/[0.04]">
                <div className="h-[5px]" style={{ backgroundColor: AIRPORT_COLOR[ap] }} />
                <div className="p-5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="inline-flex items-center justify-center rounded-full font-mono text-[10px] font-bold text-white px-2 py-[3px] leading-none" style={{ backgroundColor: AIRPORT_COLOR[ap] }}>{AIRPORTS[ap].iata}</span>
                    <span className="font-serif text-[16px] font-bold text-foreground">{AIRPORTS[ap].short}</span>
                  </div>
                  <div className="font-sans text-[13px] font-semibold text-foreground/85">{h.name}</div>
                  <div className="mt-1.5 space-y-1 font-sans text-[12px] text-muted-foreground">
                    {phones.map(p => (
                      <a key={p} href={`tel:${p.replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-brand-red">
                        <Phone className="w-3.5 h-3.5" />{p}
                      </a>
                    ))}
                    {emails.map(e => (
                      <a key={e} href={`mailto:${e}`} className="flex items-center gap-1.5 hover:text-brand-red break-all">
                        <Mail className="w-3.5 h-3.5" />{e}
                      </a>
                    ))}
                  </div>
                  <div className="mt-3 font-sans text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-bold uppercase tracking-wider text-foreground/50">{c.hours}:</span> {lf.hours[lang]}<br />
                    <span className="font-bold uppercase tracking-wider text-foreground/50">{c.location}:</span> {lf.location[lang]}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Steps */}
      <div className="px-4 sm:px-6 pt-8 max-w-3xl">
        <h2 className="font-serif text-xl font-bold text-foreground mb-3">{c.stepsTitle}</h2>
        <ol className="space-y-2">
          {c.steps.map((s, i) => (
            <li key={i} className="flex gap-3 font-sans text-[14px] leading-relaxed text-foreground/80">
              <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand-red/10 text-brand-red font-bold text-[12px]">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex gap-2.5 rounded-sm bg-amber-500/[0.08] border border-amber-500/20 p-3">
          <Info className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <p className="font-sans text-[13px] leading-relaxed text-foreground/80">{c.exceptions}</p>
        </div>
      </div>

      {/* Directory */}
      <div className="px-4 sm:px-6 pt-10 pb-6">
        <h2 className="font-serif text-xl font-bold text-foreground mb-5">{c.dirTitle}</h2>
      </div>
      <AirlinesDirectory destinations={destinations} lang={lang} />

      <div className="px-4 sm:px-6 py-8">
        <p className="font-sans text-[11px] leading-relaxed text-muted-foreground max-w-3xl">{c.verify}</p>
      </div>
    </div>
  )
}
