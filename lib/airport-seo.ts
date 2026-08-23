import type { AirportCode } from './flights'

/** URL slug ↔ airport code (accepts a couple of spelling variants). */
export const SLUG_TO_AIRPORT: Record<string, AirportCode> = {
  'cluj': 'CLJ', 'cluj-napoca': 'CLJ',
  'targu-mures': 'TGM', 'tirgu-mures': 'TGM', 'targu-mures-transilvania': 'TGM',
  'sibiu': 'SBZ',
}

export const AIRPORT_SLUG: Record<AirportCode, string> = {
  CLJ: 'cluj', TGM: 'targu-mures', SBZ: 'sibiu',
}

interface Faq { q: string; a: string }
interface SeoCopy { intro: string; faq: Faq[] }

/** Per-airport, per-language landing copy + FAQ (FAQPage schema source). */
export const AIRPORT_SEO: Record<AirportCode, { ro: SeoCopy; en: SeoCopy }> = {
  CLJ: {
    ro: {
      intro:
        'Vezi plecările și sosirile de la Aeroportul Internațional „Avram Iancu” Cluj (CLJ), cel mai mare aeroport regional din Transilvania. Tabelul de mai jos afișează programul complet al zborurilor — ora, numărul zborului, compania aeriană și destinația — actualizat zilnic din sursa oficială a aeroportului.',
      faq: [
        { q: 'Cum verific programul zborurilor de la Cluj?', a: 'Tabelul de pe această pagină arată toate plecările și sosirile de la aeroportul din Cluj, pe zile, cu ora programată, numărul zborului, compania și destinația. Folosește comutatorul Plecări/Sosiri și căutarea pentru a găsi rapid un zbor.' },
        { q: 'Aeroportul din Cluj afișează statusul live al zborurilor?', a: 'Aeroportul din Cluj publică programul orar, dar nu și statusul în timp real (aterizat/decolat). Pentru statusul live al unui zbor anume, confirmă direct cu compania aeriană sau la ghișeul aeroportului.' },
        { q: 'Ce companii operează pe aeroportul din Cluj?', a: 'De la Cluj operează companii precum Wizz Air, Ryanair, Turkish Airlines, Lufthansa, HiSky și TAROM, către destinații din Europa și Orientul Mijlociu. Filtrează după companie pentru a vedea doar zborurile relevante.' },
      ],
    },
    en: {
      intro:
        'Departures and arrivals for Cluj-Napoca „Avram Iancu” International Airport (CLJ), the largest regional airport in Transylvania. The board below shows the full flight schedule — time, flight number, airline and destination — updated daily from the airport’s official source.',
      faq: [
        { q: 'How do I check the Cluj flight schedule?', a: 'The board on this page lists every departure and arrival at Cluj airport, grouped by day, with scheduled time, flight number, airline and destination. Use the Departures/Arrivals switch and the search box to find a flight quickly.' },
        { q: 'Does Cluj airport show live flight status?', a: 'Cluj airport publishes the timetable but not real-time status (landed/departed). For the live status of a specific flight, confirm directly with your airline or at the airport desk.' },
        { q: 'Which airlines fly from Cluj?', a: 'Carriers at Cluj include Wizz Air, Ryanair, Turkish Airlines, Lufthansa, HiSky and TAROM, serving destinations across Europe and the Middle East. Filter by airline to see only the flights you care about.' },
      ],
    },
  },
  TGM: {
    ro: {
      intro:
        'Plecări și sosiri în timp real de la Aeroportul Internațional „Transilvania” Târgu Mureș (TGM). Tabelul afișează statusul live al zborurilor — programat, decolat, aterizat — alături de ora și destinația fiecărei curse.',
      faq: [
        { q: 'Zborurile de la Târgu Mureș au status în timp real?', a: 'Da. Aeroportul „Transilvania” publică statusul live, iar tabelul de mai sus arată dacă un zbor este programat, în îmbarcare, decolat sau aterizat, împreună cu ora reală.' },
        { q: 'Ce destinații are aeroportul din Târgu Mureș?', a: 'De la Târgu Mureș se operează în principal curse Wizz Air către orașe din Europa de Vest, plus zboruri charter sezoniere. Verifică tabelul pentru programul zilei.' },
        { q: 'Cum aflu dacă zborul meu are întârziere?', a: 'Coloana Status arată întârzierile și ora estimată. Pagina se actualizează automat, dar pentru confirmare finală verifică și cu compania aeriană.' },
      ],
    },
    en: {
      intro:
        'Real-time departures and arrivals for Târgu Mureș „Transilvania” International Airport (TGM). The board shows live flight status — scheduled, departed, landed — alongside each flight’s time and destination.',
      faq: [
        { q: 'Do Târgu Mureș flights show live status?', a: 'Yes. „Transilvania” airport publishes live status, and the board above shows whether a flight is scheduled, boarding, departed or landed, together with the actual time.' },
        { q: 'What destinations does Târgu Mureș serve?', a: 'Târgu Mureș is served mainly by Wizz Air to Western European cities, plus seasonal charter flights. Check the board for today’s schedule.' },
        { q: 'How do I know if my flight is delayed?', a: 'The Status column shows delays and the estimated time. The page refreshes automatically, but confirm with your airline for the final word.' },
      ],
    },
  },
  SBZ: {
    ro: {
      intro:
        'Plecări și sosiri în timp real de la Aeroportul Internațional Sibiu (SBZ). Tabelul afișează ora programată, ora estimată și statusul live al fiecărui zbor — de la check-in și îmbarcare până la decolare și aterizare.',
      faq: [
        { q: 'Aeroportul din Sibiu are informații în timp real?', a: 'Da. Sibiu publică ora programată, ora estimată și statusul live (check-in, îmbarcare, decolat, aterizat), toate vizibile în tabelul de mai sus.' },
        { q: 'Ce companii și destinații are aeroportul din Sibiu?', a: 'De la Sibiu operează Wizz Air, Austrian Airlines, TAROM și companii charter, către destinații din Europa și zone de vacanță. Filtrează după companie sau oraș.' },
        { q: 'Cât de des se actualizează informațiile?', a: 'Datele sunt reîmprospătate periodic din sursa oficială a aeroportului, iar pagina se actualizează automat în timp ce o ai deschisă.' },
      ],
    },
    en: {
      intro:
        'Real-time departures and arrivals for Sibiu International Airport (SBZ). The board shows scheduled time, estimated time and live status for every flight — from check-in and boarding through departure and landing.',
      faq: [
        { q: 'Does Sibiu airport show real-time information?', a: 'Yes. Sibiu publishes scheduled time, estimated time and live status (check-in, boarding, departed, landed), all shown in the board above.' },
        { q: 'Which airlines and destinations does Sibiu serve?', a: 'Sibiu is served by Wizz Air, Austrian Airlines, TAROM and charter carriers, to destinations across Europe and holiday regions. Filter by airline or city.' },
        { q: 'How often is the information updated?', a: 'Data is refreshed regularly from the airport’s official source, and the page updates automatically while you have it open.' },
      ],
    },
  },
}
