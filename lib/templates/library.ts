// lib/templates/library.ts
//
// Films you start FROM, rather than films you start blank.
//
// Every project began as an empty scene list. That is fine for the person who
// built the tool and hopeless for everyone else: a blank timeline asks you to
// know how long a bumper runs, where a call to action goes, how many shots a
// thirty-second launch film needs and what each one is for. Those are the
// decisions that separate a film that works from one that merely renders, and
// nothing in the Studio held any of them.
//
// A TEMPLATE IS DATA, NOT CODE.
//
// The obvious shape is a function per template that assembles a timeline. It is
// also the wrong one: a function cannot be edited in the app, cannot be saved
// against a project, cannot be listed with its slots, and freezes every film
// made from it against the version of the code that made it. So a template is a
// list of BEATS — a beat being one shot with its own job in the argument — and
// one builder turns beats into the project draft the Studio already knows how
// to open. Adding a template is adding an entry to an array; a client can be
// given their own without a deploy.
//
// The `note` on each one says WHEN TO USE IT, not what it contains. A list of
// contents is visible from the beats; the judgement is the part nobody has.

import type { MergeField } from './merge'

export type TemplateCategory = 'sales' | 'ads' | 'marketing' | 'general' | 'podcast'
export type TemplateAspect = '9:16' | '1:1' | '4:5' | '16:9'

export interface SlotDef {
  readonly key: string
  readonly kind: 'text' | 'picture' | 'colour'
  readonly label: string
  /** What good input looks like. Shown under the field, not as placeholder text. */
  readonly hint: string
  /** Text slots only. The layout budget, enforced before a campaign runs. */
  readonly maxChars?: number
  readonly required?: boolean
  readonly example?: string
}

export interface Beat {
  /** What this shot is FOR. The most useful line in the whole template. */
  readonly job: string
  readonly seconds: number
  /** Slot supplying the picture. A beat with none uses its own prompt. */
  readonly pictureSlot?: string
  /** Fallback image direction when no picture is supplied. */
  readonly prompt?: string
  /** Per-shot motion direction. */
  readonly motion?: string
  /** Which text lands over this beat, and in what role. */
  readonly title?: { readonly slot: string; readonly kind: 'title' | 'lower' | 'end' }
  readonly transition?: string
  /** Speed preset applied to this beat, when the shot wants one. */
  readonly speed?: string
}

export interface FilmTemplate {
  readonly id: string
  readonly category: TemplateCategory
  readonly name: string
  /** When to reach for this one — the judgement, not the contents. */
  readonly note: string
  readonly aspect: TemplateAspect
  readonly slots: readonly SlotDef[]
  readonly beats: readonly Beat[]
  /** The voice-over, with merge fields. Empty means no voice. */
  readonly script?: string
  /** Fields this template expects from a spreadsheet, for bulk runs. */
  readonly merge?: readonly MergeField[]
  /** True when the template is designed to be run over a list. */
  readonly bulk?: boolean
}

export const seconds = (t: FilmTemplate): number =>
  t.beats.reduce((n, b) => n + b.seconds, 0)

const HOOK = 'Primele trei secunde. Dacă nu opresc degetul, restul filmului nu există.'

export const TEMPLATES: readonly FilmTemplate[] = [
  // ── SALES ──────────────────────────────────────────────────────────────
  {
    id: 'sales-outreach',
    category: 'sales',
    name: 'Outreach personalizat',
    note: 'Pentru o listă de prospecți. Un film pe rând, cu numele și firma lui. ' +
      'Funcționează pentru că se vede că nu e un film generic — nu pentru că e lung.',
    aspect: '9:16',
    bulk: true,
    merge: [
      { key: 'prenume', label: 'Prenume', maxChars: 18, transform: 'firstName' },
      { key: 'firma', label: 'Firma', fallback: 'echipa ta', maxChars: 26, transform: 'name' },
      { key: 'motiv', label: 'De ce el', fallback: 'ce construiți acum', maxChars: 60 },
    ],
    slots: [
      { key: 'vorbitor', kind: 'picture', label: 'Cine vorbește', hint: 'Un avatar salvat, ca să fie aceeași persoană în toate filmele.', required: true },
      { key: 'oferta', kind: 'text', label: 'Ce oferi', hint: 'O propoziție. Nu features — rezultatul.', maxChars: 70, required: true, example: 'Reducem timpul de montaj de la trei zile la patru ore.' },
      { key: 'cta', kind: 'text', label: 'Ce să facă', hint: 'Un singur verb.', maxChars: 28, example: 'Vorbim 15 minute?' },
    ],
    script: 'Bună, {{prenume}}. Am văzut {{motiv}} la {{firma}} și de asta îți scriu.',
    beats: [
      { job: HOOK, seconds: 4, pictureSlot: 'vorbitor', motion: 'Mișcare foarte mică: respirație, o clipire. Nimic altceva — atenția e pe ce spune.' },
      { job: 'Oferta, o dată, clar. Textul pe ecran repetă ce se aude — se privește fără sunet.', seconds: 6, prompt: 'Fotografie documentară a muncii despre care e vorba, latura dreaptă goală pentru text.', title: { slot: 'oferta', kind: 'title' }, transition: 'dissolve' },
      { job: 'Cererea. Un singur lucru de făcut, altfel nu se face niciunul.', seconds: 3, pictureSlot: 'vorbitor', title: { slot: 'cta', kind: 'end' } },
    ],
  },
  {
    id: 'sales-case-study',
    category: 'sales',
    name: 'Studiu de caz / testimonial',
    note: 'Când ai un client mulțumit și un număr. Fără număr, nu folosi acest șablon — ' +
      'un testimonial fără cifră e o părere.',
    aspect: '16:9',
    slots: [
      { key: 'client', kind: 'text', label: 'Cine', hint: 'Numele și rolul. Rolul contează mai mult decât numele.', maxChars: 42, required: true, example: 'Mihai Roman · director de producție' },
      { key: 'problema', kind: 'text', label: 'Problema', hint: 'Cum era înainte. Concret, nu „ineficient”.', maxChars: 80, required: true },
      { key: 'cifra', kind: 'text', label: 'Rezultatul, în cifre', hint: 'Un singur număr mare. Două numere nu se rețin.', maxChars: 24, required: true, example: '−62% timp de montaj' },
      { key: 'fata', kind: 'picture', label: 'Fața clientului', hint: 'Cadru mediu, privire în obiectiv.' },
    ],
    beats: [
      { job: 'Cine vorbește, ca să știm de ce să-l credem.', seconds: 4, pictureSlot: 'fata', title: { slot: 'client', kind: 'lower' } },
      { job: 'Problema, în cuvintele lui. Aici se recunoaște publicul.', seconds: 6, prompt: 'Fotografie documentară a problemei descrise, lumină disponibilă, fără regie.', title: { slot: 'problema', kind: 'title' }, transition: 'dissolve' },
      { job: 'Cifra. Singurul lucru care se reține din tot filmul.', seconds: 4, prompt: 'Fundal simplu, foarte curat, aproape gol — cifra trebuie să fie singurul lucru din cadru.', title: { slot: 'cifra', kind: 'title' }, transition: 'dipToBrand' },
      { job: 'Închidere de marcă. Scurt.', seconds: 3, prompt: 'Cadru de marcă, calm, latura dreaptă goală.', transition: 'dissolve' },
    ],
  },
  {
    id: 'sales-demo',
    category: 'sales',
    name: 'Demo de produs (ecran)',
    note: 'Pentru software. Înregistrarea de ecran e filmul; fața e doar ca să existe cineva. ' +
      'Nu invers — un demo care e 80% cap vorbitor nu arată produsul.',
    aspect: '16:9',
    slots: [
      { key: 'ecran', kind: 'picture', label: 'Înregistrarea de ecran', hint: 'Din fila „Ecran”. Taie părțile moarte înainte.', required: true },
      { key: 'vorbitor', kind: 'picture', label: 'Cine explică', hint: 'Apare mic, în colț.' },
      { key: 'titlu', kind: 'text', label: 'Ce arăți', hint: 'Sarcina, nu funcția. „Trimiți o ofertă”, nu „Modulul Oferte”.', maxChars: 46, required: true },
      { key: 'cta', kind: 'text', label: 'Pasul următor', hint: 'Un singur verb.', maxChars: 28 },
    ],
    beats: [
      { job: 'Spune în ce problemă intrăm, înainte de a arăta ceva.', seconds: 3, pictureSlot: 'vorbitor', title: { slot: 'titlu', kind: 'title' } },
      { job: 'Ecranul. Aici e filmul. Lasă-l să respire.', seconds: 14, pictureSlot: 'ecran', transition: 'dissolve' },
      { job: 'Rezultatul pe ecran, ținut o secundă în plus ca să se vadă.', seconds: 4, pictureSlot: 'ecran', speed: 'slowMo' },
      { job: 'Cererea. Un singur pas, spus de persoana care a vorbit — nu de un card.', seconds: 3, pictureSlot: 'vorbitor', title: { slot: 'cta', kind: 'end' }, transition: 'dipToBrand' },
    ],
  },

  // ── ADS ────────────────────────────────────────────────────────────────
  {
    id: 'ad-bumper',
    category: 'ads',
    name: 'Bumper 6 secunde',
    note: 'Formatul YouTube nesăribil. Un singur gând, o singură imagine, marca la final. ' +
      'Dacă ai două lucruri de spus, ai nevoie de două bumpere.',
    aspect: '16:9',
    slots: [
      { key: 'gand', kind: 'text', label: 'Singurul gând', hint: 'Cinci cuvinte. Serios.', maxChars: 34, required: true },
      { key: 'imagine', kind: 'picture', label: 'Imaginea', hint: 'Una singură. Trebuie să funcționeze fără text.' },
    ],
    beats: [
      { job: 'Imaginea și gândul, simultan. Nu e timp pentru construcție.', seconds: 4.5, pictureSlot: 'imagine', title: { slot: 'gand', kind: 'title' }, motion: 'O mișcare lentă și continuă de cameră. Nimic care să distragă de la text.' },
      { job: 'Marca. Un cadru și jumătate.', seconds: 1.5, prompt: 'Fundal de marcă foarte simplu, gol în centru.', transition: 'dipToBrand' },
    ],
  },
  {
    id: 'ad-15-cta',
    category: 'ads',
    name: 'Reclamă 15 secunde cu ofertă',
    note: 'Formatul standard de performance. Cârlig, problemă, ofertă, cerere. ' +
      'Ordinea nu e negociabilă — oferta înainte de problemă nu se vinde.',
    aspect: '9:16',
    slots: [
      { key: 'carlig', kind: 'text', label: 'Cârligul', hint: 'O întrebare sau o afirmație care doare puțin.', maxChars: 40, required: true },
      { key: 'oferta', kind: 'text', label: 'Oferta', hint: 'Ce primește, nu ce faci tu.', maxChars: 48, required: true },
      { key: 'cta', kind: 'text', label: 'Cererea', hint: 'Un verb și un loc.', maxChars: 26, required: true },
      { key: 'produs', kind: 'picture', label: 'Produsul', hint: 'Trebuie să fie recognoscibil într-o jumătate de secundă.' },
    ],
    beats: [
      { job: HOOK, seconds: 3, prompt: 'Cadru care pune întrebarea vizual. Treimea de sus liberă pentru text.', title: { slot: 'carlig', kind: 'title' }, motion: 'Mișcare rapidă, ușor instabilă — energie, nu eleganță.' },
      { job: 'Problema, arătată nu explicată.', seconds: 4, prompt: 'Fotografie documentară a problemei, lumină disponibilă.', transition: 'wipeLeft' },
      { job: 'Produsul ca răspuns. Prima dată când se vede clar.', seconds: 5, pictureSlot: 'produs', title: { slot: 'oferta', kind: 'title' }, transition: 'dissolve' },
      { job: 'Cererea, pe marcă, ținută destul cât să fie citită de două ori.', seconds: 3, prompt: 'Fundal de marcă, gol.', title: { slot: 'cta', kind: 'end' }, transition: 'dipToBrand' },
    ],
  },

  // ── MARKETING ──────────────────────────────────────────────────────────
  {
    id: 'mk-launch',
    category: 'marketing',
    name: 'Lansare de produs · 30s',
    note: 'Când produsul e nou și nimeni nu îl caută încă. Construiește contextul ' +
      'înainte de a arăta obiectul — un produs arătat prea devreme nu are ce însemna.',
    aspect: '16:9',
    slots: [
      { key: 'nume', kind: 'text', label: 'Numele produsului', hint: 'Doar numele.', maxChars: 28, required: true },
      { key: 'promisiune', kind: 'text', label: 'Promisiunea', hint: 'O propoziție care ar putea fi pe cutie.', maxChars: 64, required: true },
      { key: 'produs', kind: 'picture', label: 'Produsul', hint: 'Fotografie curată, fundal simplu.' },
      { key: 'context', kind: 'picture', label: 'Unde se folosește', hint: 'Oameni, nu obiecte.' },
    ],
    beats: [
      { job: 'Lumea de dinainte. Fără produs în cadru.', seconds: 5, pictureSlot: 'context', motion: 'Derivă lentă de cameră. Calm.' },
      { job: 'Tensiunea: ce lipsește.', seconds: 5, prompt: 'Același loc, un detaliu care arată lipsa. Cadru mai strâns.', transition: 'dissolve' },
      { job: 'Produsul. Prima apariție, ținută.', seconds: 7, pictureSlot: 'produs', title: { slot: 'nume', kind: 'title' }, transition: 'dipToWhite', speed: 'rampOut' },
      { job: 'Produsul în mâinile cuiva. Aici devine real.', seconds: 7, pictureSlot: 'context', title: { slot: 'promisiune', kind: 'lower' }, transition: 'dissolve' },
      { job: 'Marca, la final. Aici se pune, nu la început — nimeni nu rămâne pentru siglă.', seconds: 6, prompt: 'Cadru de marcă, foarte simplu.', transition: 'dissolve' },
    ],
  },
  {
    id: 'mk-recruit',
    category: 'marketing',
    name: 'Recrutare · employer branding',
    note: 'Angajații se uită la oameni, nu la birouri. Dacă nu ai fețe reale, ' +
      'acest șablon nu funcționează și e mai bine să nu îl folosești.',
    aspect: '4:5',
    slots: [
      { key: 'rol', kind: 'text', label: 'Rolul', hint: 'Titlul postului, exact cum apare în anunț.', maxChars: 36, required: true },
      { key: 'motiv', kind: 'text', label: 'De ce aici', hint: 'Un lucru adevărat pe care alții nu îl pot spune.', maxChars: 70, required: true },
      { key: 'echipa', kind: 'picture', label: 'Echipa', hint: 'Oameni la lucru, nu poze de grup.' },
      { key: 'cta', kind: 'text', label: 'Unde se aplică', hint: 'Un link scurt.', maxChars: 30 },
    ],
    beats: [
      { job: 'Un chip, imediat. Recrutarea e despre cine, nu despre ce.', seconds: 4, pictureSlot: 'echipa' },
      { job: 'Munca în sine, arătată onest.', seconds: 6, prompt: 'Fotografie documentară a muncii, lumină disponibilă, nimeni nu pozează.', title: { slot: 'rol', kind: 'title' }, transition: 'dissolve' },
      { job: 'Motivul. Aici se câștigă sau se pierde candidatul.', seconds: 6, pictureSlot: 'echipa', title: { slot: 'motiv', kind: 'lower' }, transition: 'dissolve' },
      { job: 'Unde se aplică.', seconds: 4, prompt: 'Fundal de marcă simplu.', title: { slot: 'cta', kind: 'end' }, transition: 'dipToBrand' },
    ],
  },

  // ── GENERAL ────────────────────────────────────────────────────────────
  {
    id: 'gen-explainer',
    category: 'general',
    name: 'Explicativ · 60s',
    note: 'Pentru un lucru complicat care trebuie înțeles o dată. Trei pași, ' +
      'nu cinci: al patrulea pas e locul unde publicul pleacă.',
    aspect: '16:9',
    slots: [
      { key: 'subiect', kind: 'text', label: 'Ce explici', hint: 'Formulat ca întrebarea pe care o are publicul.', maxChars: 50, required: true },
      { key: 'pas1', kind: 'text', label: 'Pasul 1', hint: 'Un verb la început.', maxChars: 44, required: true },
      { key: 'pas2', kind: 'text', label: 'Pasul 2', hint: 'Un verb la început.', maxChars: 44, required: true },
      { key: 'pas3', kind: 'text', label: 'Pasul 3', hint: 'Un verb la început.', maxChars: 44, required: true },
    ],
    beats: [
      { job: 'Întrebarea, pusă exact cum și-o pune publicul.', seconds: 6, prompt: 'Cadru simplu care ilustrează întrebarea, treimea de sus liberă.', title: { slot: 'subiect', kind: 'title' } },
      { job: 'Pasul unu. Un singur lucru de făcut, ilustrat în timp ce se spune.', seconds: 12, prompt: 'Ilustrarea primului pas, documentar.', title: { slot: 'pas1', kind: 'lower' }, transition: 'wipeLeft' },
      { job: 'Pasul doi. Continuă din primul — nu reia contextul.', seconds: 12, prompt: 'Ilustrarea celui de-al doilea pas.', title: { slot: 'pas2', kind: 'lower' }, transition: 'wipeLeft' },
      { job: 'Pasul trei. Ultimul, și se anunță ca ultimul.', seconds: 12, prompt: 'Ilustrarea celui de-al treilea pas.', title: { slot: 'pas3', kind: 'lower' }, transition: 'wipeLeft' },
      { job: 'Rezumat vizual, fără text nou.', seconds: 10, prompt: 'Cadru larg care leagă cei trei pași.', transition: 'dissolve' },
      { job: 'Marca, după ce lucrul a fost explicat complet.', seconds: 8, prompt: 'Cadru de marcă.', transition: 'dissolve' },
    ],
  },
  {
    id: 'gen-announce',
    category: 'general',
    name: 'Anunț scurt',
    note: 'Un fapt, o dată, o acțiune. Folosește-l când conținutul e informație, ' +
      'nu persuasiune — un anunț care încearcă să convingă sună fals.',
    aspect: '1:1',
    slots: [
      { key: 'ce', kind: 'text', label: 'Ce se întâmplă', hint: 'Fapt, nu superlativ.', maxChars: 46, required: true },
      { key: 'cand', kind: 'text', label: 'Când / unde', hint: 'Data și locul.', maxChars: 34, required: true },
      { key: 'imagine', kind: 'picture', label: 'Imaginea', hint: 'Trebuie să spună despre ce e, fără text.' },
    ],
    beats: [
      { job: 'Faptul, spus o singură dată și fără superlative.', seconds: 5, pictureSlot: 'imagine', title: { slot: 'ce', kind: 'title' } },
      { job: 'Detaliile practice, ținute destul cât să fie notate.', seconds: 5, pictureSlot: 'imagine', title: { slot: 'cand', kind: 'lower' }, transition: 'dissolve' },
      { job: 'Marca, scurt, după ce informația a fost dată.', seconds: 3, prompt: 'Cadru de marcă simplu.', transition: 'dipToBrand' },
    ],
  },

  // ── PODCAST ────────────────────────────────────────────────────────────
  {
    id: 'pod-episode',
    category: 'podcast',
    name: 'Podcast · episod complet',
    note: 'Structura de publicare a unui episod: generic scurt, corpul montat, ' +
      'final. Corpul vine din fila Podcast, deja tăiat.',
    aspect: '16:9',
    slots: [
      { key: 'titlu', kind: 'text', label: 'Titlul episodului', hint: 'Cum apare în feed.', maxChars: 56, required: true },
      { key: 'invitat', kind: 'text', label: 'Invitatul', hint: 'Nume și de ce contează.', maxChars: 44 },
      { key: 'corp', kind: 'picture', label: 'Episodul montat', hint: 'Din fila „Podcast”, după tăiere.', required: true },
    ],
    beats: [
      { job: 'Generic. Scurt — nimeni nu s-a abonat pentru generic.', seconds: 4, prompt: 'Cadru de marcă pentru podcast, foarte simplu.', title: { slot: 'titlu', kind: 'title' } },
      { job: 'Cine e invitatul, peste primele secunde de conversație.', seconds: 6, pictureSlot: 'corp', title: { slot: 'invitat', kind: 'lower' }, transition: 'dissolve' },
      { job: 'Episodul montat. Restul șablonului există doar ca să îl încadreze.', seconds: 60, pictureSlot: 'corp' },
      { job: 'Final de marcă, cu spațiu pentru abonare sau episodul următor.', seconds: 5, prompt: 'Cadru de marcă.', transition: 'dissolve' },
    ],
  },
  {
    id: 'pod-clip',
    category: 'podcast',
    name: 'Podcast · clip vertical',
    note: 'Un moment din episod, tăiat pentru social. Regula care contează: ' +
      'clipul începe DIN mijlocul ideii, nu de la începutul ei.',
    aspect: '9:16',
    slots: [
      { key: 'moment', kind: 'picture', label: 'Momentul', hint: 'Selectat în fila „Podcast”.', required: true },
      { key: 'carlig', kind: 'text', label: 'Cârligul pe ecran', hint: 'Ce se aude în prima secundă, scris.', maxChars: 40, required: true },
      { key: 'nume', kind: 'text', label: 'Cine vorbește', hint: 'Nume și rol.', maxChars: 34 },
    ],
    beats: [
      { job: 'Cârligul, cu subtitrări mari. Se privește fără sunet.', seconds: 3, pictureSlot: 'moment', title: { slot: 'carlig', kind: 'title' } },
      { job: 'Momentul, întreg și netăiat — o tăietură în mijloc rupe ideea.', seconds: 30, pictureSlot: 'moment', title: { slot: 'nume', kind: 'lower' } },
      { job: 'Marca, foarte scurt — două secunde, nu mai mult, pe vertical.', seconds: 2, prompt: 'Cadru de marcă simplu.', transition: 'dipToBrand' },
    ],
  },
  {
    id: 'pod-audiogram',
    category: 'podcast',
    name: 'Podcast · audiogram',
    note: 'Când ai sunet bun și imagine slabă. Un cadru fix, subtitrări animate, ' +
      'formă de undă. Se publică pe platforme unde oricum nu se dă drumul la sunet.',
    aspect: '1:1',
    slots: [
      { key: 'fundal', kind: 'picture', label: 'Fundalul', hint: 'Un cadru liniștit. Nu va avea mișcare.' },
      { key: 'citat', kind: 'text', label: 'Citatul', hint: 'Fraza care merită clipul.', maxChars: 90, required: true },
      { key: 'nume', kind: 'text', label: 'Cine o spune', hint: 'Nume și rol.', maxChars: 34 },
    ],
    beats: [
      { job: 'Cadru fix cu citatul și subtitrările. Toată treaba e în text.', seconds: 30, pictureSlot: 'fundal', title: { slot: 'citat', kind: 'title' } },
      { job: 'Atribuirea: cine a spus-o, ca citatul să poată fi verificat.', seconds: 4, pictureSlot: 'fundal', title: { slot: 'nume', kind: 'lower' }, transition: 'dissolve' },
    ],
  },
]

export const CATEGORY_LABEL: Record<TemplateCategory, string> = {
  sales: 'Vânzări',
  ads: 'Reclame',
  marketing: 'Marketing',
  general: 'General',
  podcast: 'Podcast',
}

export const byId = (id: string): FilmTemplate | undefined => TEMPLATES.find(t => t.id === id)
export const byCategory = (c: TemplateCategory): FilmTemplate[] => TEMPLATES.filter(t => t.category === c)
export const bulkTemplates = (): FilmTemplate[] => TEMPLATES.filter(t => t.bulk)

/** Every text a template will render, for merge-field validation before a run. */
export function textsOf(t: FilmTemplate, values: Readonly<Record<string, string>> = {}): string[] {
  const out: string[] = []
  if (t.script) out.push(t.script)
  for (const b of t.beats) {
    if (b.title) out.push(values[b.title.slot] ?? '')
  }
  return out.filter(s => s.length > 0)
}
