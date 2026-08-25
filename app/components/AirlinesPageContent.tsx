import Link from 'next/link'
import { Phone, Mail, Info, Luggage, Plane, Globe, ExternalLink } from 'lucide-react'
import AirportsLogo from './AirportsLogo'
import AirlinesDirectory from './AirlinesDirectory'
import AirlineLogo from './AirlineLogo'
import { AIRPORTS, AIRPORT_ORDER, type AirportCode, type Lang } from '@/lib/flights'
import { HANDLERS, LOST_AND_FOUND, MENZIES, TERMINAL_LOST_FOUND, ONBOARD_GUIDANCE, AIRLINE_DIRECTORY } from '@/lib/airline-directory'

type Dest = Record<AirportCode, Record<string, string[]>>

// Distinct colour per airport — mirrors AirlinesDirectory so badges match.
const AIRPORT_COLOR: Record<AirportCode, string> = { CLJ: '#ca2222', TGM: '#0a7d6b', SBZ: '#1d4ed8' }

const COPY = {
  ro: {
    crumbZboruri: 'Zboruri', crumbHere: 'Companii aeriene & bagaje',
    h1: 'Companii aeriene & bagaje',
    intro: 'Companiile care operează pe aeroporturile din Transilvania — Cluj-Napoca, Târgu Mureș și Sibiu — împreună cu agentul de handling și pașii pentru bagaje sau obiecte pierdute. Datele de zbor sunt live; contactele de handling se pot schimba, verificați înainte de călătorie.',
    whereTitle: 'Ați pierdut un bagaj sau un obiect?',
    whereSub: 'Contează UNDE s-a întâmplat — la aeroport sau la bordul avionului. Sunt două trasee diferite.',
    atAirportTitle: 'La aeroport',
    pirTitle: 'Ce este un PIR?',
    pirExplain: 'PIR (Property Irregularity Report) este formularul oficial de reclamație pentru un bagaj de cală lipsă sau deteriorat. Se completează pe loc, la ghișeul agentului de handling — nu online — și primiți un număr de referință cu care compania aeriană urmărește bagajul. Păstrați eticheta de bagaj și cartea de îmbarcare; urmărirea ulterioară se face pe pagina de „urmărire bagaje” a companiei aeriene.',
    atAirportText: 'Bagaj de cală care lipsește sau e deteriorat: mergeți la ghișeul agentului de handling din sala de bagaje și depuneți o reclamație (PIR) ÎNAINTE de a ieși. Obiect pierdut în terminal (la control, la poartă): adresați-vă biroului de obiecte pierdute al aeroportului.',
    onboardTitle: 'La bord — în timpul zborului',
    trackTitle: 'Urmărește-ți bagajul online',
    trackSub: 'După ce ai depus PIR-ul și ai numărul de referință, poți urmări bagajul pe pagina oficială a companiei aeriene. Linkuri directe pentru companiile principale:',
    trackNote: 'Pentru celelalte companii, folosește site-ul oficial din lista de mai jos.',
    trackBag: 'Urmărește bagajul',
    desksTitle: 'Ghișeul de bagaje, pe aeroport',
    terminalLabel: 'Obiecte pierdute în terminal',
    stepsTitle: 'Pași pentru un bagaj lipsă',
    steps: [
      'Nu părăsiți zona de recuperare bagaje — reclamația se depune acolo.',
      'Identificați aeroportul de sosire și compania: cardurile de mai jos dau agentul de handling.',
      'La ghișeul agentului, cereți un PIR și păstrați numărul de referință.',
      'Sunați sau scrieți agentului cu numărul PIR pentru a urmări bagajul.',
    ],
    exceptions: 'Excepții la Cluj: pasagerii TAROM și Turkish Airlines se adresează biroului propriu al companiei, nu agentului general.',
    verify: 'Contractele de handling se schimbă la câțiva ani. Pentru situații operaționale, confirmați direct la numerele de mai sus.',
    hours: 'Program', location: 'Unde', role: 'Rol', site: 'Site oficial',
    dirTitle: 'Toate companiile',
  },
  en: {
    crumbZboruri: 'Flights', crumbHere: 'Airlines & baggage',
    h1: 'Airlines & baggage',
    intro: 'The carriers operating at the Transylvania airports — Cluj-Napoca, Târgu Mureș and Sibiu — with the ground handler and the steps for lost baggage or belongings. Flight data is live; handling contacts can change, so confirm before you travel.',
    whereTitle: 'Lost a bag or a personal item?',
    whereSub: 'It matters WHERE it happened — at the airport or on board the aircraft. These are two different routes.',
    atAirportTitle: 'At the airport',
    pirTitle: 'What is a PIR?',
    pirExplain: 'A PIR (Property Irregularity Report) is the official claim form for a missing or damaged checked bag. It is filled in on the spot at the handler’s desk — not online — and you get a reference number your airline uses to trace the bag. Keep your bag tag and boarding pass; you then track the bag on your airline’s “baggage tracing” page.',
    atAirportText: 'A checked bag missing or damaged: go to the ground handler’s desk in the baggage hall and file a report (PIR) BEFORE you leave. An item lost or left in the terminal (at security, at the gate): contact the airport’s lost-property office.',
    onboardTitle: 'On board — during the flight',
    trackTitle: 'Track your bag online',
    trackSub: 'Once you have filed the PIR and have the reference number, you can track the bag on your airline’s official page. Direct links for the main carriers:',
    trackNote: 'For the other airlines, use their official site from the list below.',
    trackBag: 'Track your bag',
    desksTitle: 'Baggage desk, per airport',
    terminalLabel: 'Lost property in the terminal',
    stepsTitle: 'Steps for a missing bag',
    steps: [
      'Do not leave the baggage reclaim area — the report is filed there.',
      'Identify the arrival airport and airline: the cards below give the handling agent.',
      'At the agent’s desk, ask for a PIR and keep the reference number.',
      'Call or e-mail the agent with the PIR number to trace the bag.',
    ],
    exceptions: 'Exceptions at Cluj: TAROM and Turkish Airlines passengers use the airline’s own desk, not the general agent.',
    verify: 'Handling contracts change every few years. For operational matters, confirm directly at the numbers above.',
    hours: 'Hours', location: 'Where', role: 'Role', site: 'Official site',
    dirTitle: 'All airlines',
  },
} as const

function ContactList({ phones, emails }: { phones: string[]; emails: string[] }) {
  return (
    <div className="mt-1.5 space-y-1 font-sans text-[12px] text-muted-foreground">
      {phones.map(p => (
        <a key={p} href={`tel:${p.replace(/\s/g, '')}`} className="flex items-center gap-1.5 hover:text-brand-red">
          <Phone className="w-3.5 h-3.5 shrink-0" />{p}
        </a>
      ))}
      {emails.map(e => (
        <a key={e} href={`mailto:${e}`} className="flex items-center gap-1.5 hover:text-brand-red break-all">
          <Mail className="w-3.5 h-3.5 shrink-0" />{e}
        </a>
      ))}
    </div>
  )
}

function ApPill({ ap }: { ap: AirportCode }) {
  return (
    <span className="inline-flex items-center justify-center rounded-full font-mono text-[10px] font-bold text-white px-2 py-[3px] leading-none" style={{ backgroundColor: AIRPORT_COLOR[ap] }}>
      {AIRPORTS[ap].iata}
    </span>
  )
}

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

      {/* ── Menzies spotlight — the main handler, at a significant place ── */}
      <div className="px-4 sm:px-6 pt-8">
        <div className="overflow-hidden rounded-2xl bg-white dark:bg-neutral-900 shadow-[0_18px_46px_-26px_rgba(40,24,18,0.55)] ring-1 ring-black/[0.05]">
          <div className="h-[6px]" style={{ backgroundColor: MENZIES.brand }} />
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-foreground/10 bg-white p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={MENZIES.logo} alt={MENZIES.name} width={56} height={56} className="h-14 w-14 object-contain" />
              </span>
              <div className="min-w-0">
                <h2 className="font-serif text-xl md:text-2xl font-bold text-foreground leading-tight">{MENZIES.name}</h2>
                <p className="mt-0.5 font-sans text-[13px] text-muted-foreground">{MENZIES.tagline[lang]}</p>
              </div>
            </div>
            <p className="mt-4 font-sans text-[14px] leading-relaxed text-foreground/80 max-w-3xl">{MENZIES.about[lang]}</p>
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {MENZIES.stations.map(st => (
                <div key={st.airport} className="rounded-xl bg-[#faf6ec] dark:bg-white/[0.03] border border-foreground/10 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <ApPill ap={st.airport} />
                    <span className="font-serif text-[15px] font-bold text-foreground">{AIRPORTS[st.airport].short}</span>
                  </div>
                  <div className="font-sans text-[12px] text-muted-foreground">{st.role[lang]}</div>
                  <ContactList phones={st.phones} emails={st.emails} />
                  <div className="mt-2 font-sans text-[11px] text-muted-foreground">
                    <span className="font-bold uppercase tracking-wider text-foreground/50">{c.hours}:</span> {st.hours[lang]}
                  </div>
                </div>
              ))}
            </div>
            <a href={MENZIES.website} target="_blank" rel="noopener noreferrer nofollow"
              className="mt-4 inline-flex items-center gap-1.5 font-sans text-[12px] font-semibold text-muted-foreground hover:text-brand-red">
              <Globe className="w-3.5 h-3.5" /> {c.site}
            </a>
          </div>
        </div>
      </div>

      {/* ── Where to go: at the airport vs on board ── */}
      <div className="px-4 sm:px-6 pt-10">
        <h2 className="font-serif text-xl font-bold text-foreground mb-1">{c.whereTitle}</h2>
        <p className="font-sans text-[14px] leading-relaxed text-muted-foreground max-w-3xl mb-4">{c.whereSub}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* At the airport */}
          <div className="rounded-2xl bg-white dark:bg-neutral-900 shadow-[0_16px_40px_-24px_rgba(40,24,18,0.5)] ring-1 ring-black/[0.04] p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-red/10 text-brand-red"><Luggage className="w-4 h-4" /></span>
              <h3 className="font-serif text-[17px] font-bold text-foreground">{c.atAirportTitle}</h3>
            </div>
            <p className="font-sans text-[13px] leading-relaxed text-foreground/80">{c.atAirportText}</p>
            <div className="mt-3 flex gap-2.5 rounded-lg bg-foreground/[0.04] border border-foreground/10 p-3">
              <Info className="w-4 h-4 shrink-0 text-brand-red mt-0.5" />
              <p className="font-sans text-[12px] leading-relaxed text-muted-foreground">
                <span className="font-bold text-foreground/80">{c.pirTitle} </span>{c.pirExplain}
              </p>
            </div>
            <div className="mt-3 pt-3 border-t border-foreground/10 space-y-2.5">
              {AIRPORT_ORDER.map(ap => {
                const lf = TERMINAL_LOST_FOUND[ap]
                return (
                  <div key={ap} className="flex gap-2.5">
                    <ApPill ap={ap} />
                    <div className="min-w-0">
                      <div className="font-sans text-[12px] font-semibold text-foreground/85">{lf.name[lang]}</div>
                      <ContactList phones={lf.phone ? [lf.phone] : []} emails={lf.email ? [lf.email] : []} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {/* On board */}
          <div className="rounded-2xl bg-white dark:bg-neutral-900 shadow-[0_16px_40px_-24px_rgba(40,24,18,0.5)] ring-1 ring-black/[0.04] p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600"><Plane className="w-4 h-4" /></span>
              <h3 className="font-serif text-[17px] font-bold text-foreground">{c.onboardTitle}</h3>
            </div>
            <p className="font-sans text-[13px] leading-relaxed text-foreground/80">{ONBOARD_GUIDANCE[lang]}</p>
          </div>
        </div>
      </div>

      {/* Baggage desks per airport (checked baggage handler) */}
      <div className="px-4 sm:px-6 pt-10">
        <h2 className="font-serif text-xl font-bold text-foreground mb-4">{c.desksTitle}</h2>
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
                    <ApPill ap={ap} />
                    <span className="font-serif text-[16px] font-bold text-foreground">{AIRPORTS[ap].short}</span>
                  </div>
                  <div className="font-sans text-[13px] font-semibold text-foreground/85">{h.name}</div>
                  <ContactList phones={phones} emails={emails} />
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

      {/* Track your bag — official per-airline baggage-tracing links */}
      <div className="px-4 sm:px-6 pt-10">
        <h2 className="font-serif text-xl font-bold text-foreground mb-1">{c.trackTitle}</h2>
        <p className="font-sans text-[14px] leading-relaxed text-muted-foreground max-w-3xl mb-4">{c.trackSub}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AIRLINE_DIRECTORY.filter(a => a.baggageTracking).sort((x, y) => x.name.localeCompare(y.name, 'ro')).map(a => (
            <a key={a.iata} href={a.baggageTracking} target="_blank" rel="noopener noreferrer nofollow"
              className="group flex items-center gap-3 rounded-xl bg-white dark:bg-neutral-900 ring-1 ring-black/[0.05] shadow-[0_10px_28px_-20px_rgba(40,24,18,0.5)] px-4 py-3 hover:ring-brand-red/30 transition">
              <span className="flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-white p-1">
                <AirlineLogo flightNo={`${a.iata} 1`} wide />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-sans text-[13px] font-bold text-foreground truncate">{a.name}</span>
                <span className="block font-sans text-[11px] text-muted-foreground">{c.trackBag}</span>
              </span>
              <ExternalLink className="w-4 h-4 text-brand-red shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </a>
          ))}
        </div>
        <p className="mt-3 font-sans text-[12px] text-muted-foreground max-w-3xl">{c.trackNote}</p>
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
