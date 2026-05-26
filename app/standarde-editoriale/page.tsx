import Link from 'next/link'
import type { Metadata } from 'next'

const SITE_URL = 'https://transilvaniatimes.com'

export const metadata: Metadata = {
  title: 'Standarde Editoriale — Transilvania Times',
  description: 'Procesul editorial, politica de verificare a faptelor, corecții și transparență AI la Transilvania Times.',
  alternates: { canonical: `${SITE_URL}/standarde-editoriale` },
  openGraph: {
    title: 'Standarde Editoriale — Transilvania Times',
    description: 'Procesul editorial, verificarea faptelor și politica de corecții.',
    url: `${SITE_URL}/standarde-editoriale`,
    type: 'website',
  },
}

export default function EditorialStandardsPage() {
  return (
    <div className="max-w-7xl mx-auto border-x border-foreground/10">
      <div className="max-w-3xl mx-auto px-6 pt-10 pb-16">

        {/* Page header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-2 h-2 bg-brand-red" />
            <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
              Standarde editoriale
            </span>
            <div className="flex-1 h-px bg-foreground/10" />
          </div>
          <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-tight mb-6">
            Cum lucrăm
          </h1>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            Transilvania Times se angajează să publice informații exacte, echilibrate și relevante pentru cititorii din România și din străinătate. Acest document descrie procesele și principiile care ghidează activitatea noastră editorială.
          </p>
        </div>

        {/* Section 1 — Editorial Process */}
        <div className="mb-10 border-t border-foreground/10 pt-8">
          <h2 className="font-serif text-xl font-bold text-foreground mb-4">Procesul editorial</h2>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
            Fiecare articol publicat în Transilvania Times parcurge un proces structurat în patru etape: identificarea și selectarea surselor, cercetare și redactare, editare stilistică și verificare factuală, apoi aprobare finală. Articolele care nu respectă standardele noastre de calitate sunt reținute pentru revizuire suplimentară sau respinse.
          </p>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            Selectăm sursele pe baza credibilității, relevanței pentru cititorii noștri și actualității informațiilor. Prioritizăm sursele primare (documente oficiale, declarații directe, date statistice publice) față de sursele secundare. Atunci când o informație nu poate fi verificată independent, menționăm acest lucru explicit.
          </p>
        </div>

        {/* Section 2 — Fact Checking */}
        <div className="mb-10 border-t border-foreground/10 pt-8">
          <h2 className="font-serif text-xl font-bold text-foreground mb-4">Verificarea faptelor</h2>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
            Fiecare afirmație factuală publicată trebuie să fie susținută de cel puțin o sursă verificabilă. Cifrele, datele, numele persoanelor și titulatura instituțională sunt verificate înainte de publicare. Atunci când cifrele provin din surse statistice oficiale, menționăm sursa și data raportului.
          </p>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            Nu publicăm zvonuri, speculații sau informații neconfirmate ca fapte. Atunci când relatăm despre acuzații sau declarații controversate, prezentăm și punctul de vedere al părții acuzate, dacă acesta este disponibil.
          </p>
        </div>

        {/* Section 3 — Corrections */}
        <div className="mb-10 border-t border-foreground/10 pt-8">
          <h2 className="font-serif text-xl font-bold text-foreground mb-4">Corecții și retractări</h2>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
            Când identificăm o eroare într-un articol publicat, o corectăm prompt și transparent. Corecturile minore (greșeli tipografice, erori de formatare) sunt aplicate fără notificare separată. Corecturile de substanță (cifre greșite, nume incorect, context lipsă) sunt marcate vizibil la sfârșitul articolului cu data corecției și natura modificării.
          </p>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            În cazuri excepționale — când un articol conține erori care îi invalidează substanța — articolul este retractat, iar retractarea este publicată în locul articolului original cu o explicație completă. Cititorii pot semnala erori la adresa de contact a redacției.
          </p>
        </div>

        {/* Section 4 — Attribution */}
        <div className="mb-10 border-t border-foreground/10 pt-8">
          <h2 className="font-serif text-xl font-bold text-foreground mb-4">Atribuire și surse</h2>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
            Toate articolele Transilvania Times menționează sursele utilizate. Sursele sunt citate sau parafrazate cu atribuire clară. Nu preluăm conținut din alte publicații fără atribuire corespunzătoare și fără transformare editorială substanțială.
          </p>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            Fiecare articol poartă semnătura unui membru al echipei editoriale, care este responsabil pentru forma finală a materialului. Sursele originale sunt listate la finalul articolului, cu link-uri către publicațiile sursă unde este posibil.
          </p>
        </div>

        {/* Section 5 — AI Usage */}
        <div className="mb-10 border-t border-foreground/10 pt-8">
          <h2 className="font-serif text-xl font-bold text-foreground mb-4">Utilizarea inteligenței artificiale</h2>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
            Transilvania Times utilizează instrumente de inteligență artificială în mai multe etape ale procesului editorial: agregarea și prioritizarea surselor de știri, cercetare de fundal, asistență la redactare și verificarea calității conținutului. Aceste instrumente funcționează ca asistenți editoriali, nu ca înlocuitori ai judecății jurnalistice umane.
          </p>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify mb-5">
            Conținutul generat cu asistență AI parcurge aceleași standarde de verificare și editare ca orice alt material. Sistemul nostru de control al calității include verificarea automată a originalității, evaluarea stilistică și revizuire editorială. Articolele care nu trec aceste filtre nu sunt publicate.
          </p>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            Nu folosim inteligența artificială pentru a fabrica informații, citate sau evenimente. AI-ul nu înlocuiește cercetarea jurnalistică. Considerăm că transparența despre instrumentele pe care le utilizăm este o obligație față de cititorii noștri și un standard al jurnalismului responsabil în era digitală.
          </p>
        </div>

        {/* Section 6 — Separation of news and opinion */}
        <div className="mb-10 border-t border-foreground/10 pt-8">
          <h2 className="font-serif text-xl font-bold text-foreground mb-4">Separarea știrilor de opinii</h2>
          <p className="font-serif text-[17px] leading-[1.8] text-foreground text-justify">
            Articolele de știri sunt separate clar de materialele de opinie. Știrile relatează fapte verificate și prezintă multiple perspective. Articolele de opinie sunt marcate explicit cu categoria „Opinie" și reflectă punctul de vedere al autorului, nu poziția oficială a publicației. Materialele sponsorizate sunt identificate vizibil și nu influențează conținutul editorial.
          </p>
        </div>

        {/* Contact for complaints */}
        <div className="border-t border-foreground/10 pt-8 text-center">
          <p className="font-sans text-[13px] text-muted-foreground mb-3">
            Reclamații editoriale, corecții sau întrebări despre standardele noastre:
          </p>
          <Link
            href="/contact"
            className="inline-block font-sans text-[11px] font-bold uppercase tracking-widest text-white bg-brand-red px-6 py-2.5 hover:bg-brand-red/90 transition-colors"
          >
            Scrie redacției
          </Link>
          <p className="font-sans text-[11px] text-muted-foreground mt-3">
            contact@add-individual-solutions.com
          </p>
        </div>

      </div>
    </div>
  )
}
