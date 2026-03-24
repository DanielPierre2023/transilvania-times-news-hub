import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Termeni și Condiții | Transilvania Times',
  description: 'Termenii și condițiile de utilizare a platformei Transilvania Times.',
}

const LAST_UPDATED = '24 martie 2026'

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">

      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 bg-brand-red" />
          <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
            Legal
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-foreground mb-3">
          Termeni și Condiții
        </h1>
        <h2 className="font-serif text-2xl text-muted-foreground mb-4">
          Terms and Conditions
        </h2>
        <p className="font-sans text-sm text-muted-foreground">
          Ultima actualizare / Last updated: {LAST_UPDATED}
        </p>
      </div>

      <div className="space-y-8 font-sans">

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            1. Acceptarea termenilor / Acceptance of Terms
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Prin accesarea și utilizarea platformei Transilvania Times (transilvaniatimes.com), acceptați în întregime acești termeni și condiții. Dacă nu sunteți de acord cu aceștia, vă rugăm să nu utilizați platforma.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            By accessing and using the Transilvania Times platform, you fully accept these terms and conditions. If you do not agree, please do not use the platform.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            2. Proprietarul platformei / Platform Owner
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Transilvania Times este deținut și operat de <strong className="text-foreground">ADD Individual Solutions Ltd.</strong> Platforma este o publicație de știri regionale cu sediul în România.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Transilvania Times is owned and operated by <strong className="text-foreground">ADD Individual Solutions Ltd.</strong>, a regional news publication based in Romania.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            3. Proprietatea intelectuală / Intellectual Property
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Toate conținuturile publicate pe Transilvania Times — articole, fotografii, grafice, logo-uri și design — sunt protejate prin drepturile de autor și aparțin ADD Individual Solutions Ltd. sau sunt utilizate cu permisiunea deținătorilor de drepturi. Reproducerea, distribuirea sau modificarea oricărui conținut fără acordul scris prealabil este interzisă.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            All content published on Transilvania Times is protected by copyright and belongs to ADD Individual Solutions Ltd. or is used with the permission of rights holders. Reproduction, distribution or modification of any content without prior written consent is prohibited.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            4. Conținut generat cu inteligență artificială / AI-Generated Content
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Unele articole publicate pe această platformă sunt generate sau prelucrate parțial cu ajutorul inteligenței artificiale. Aceste articole sunt marcate cu numele personei jurnalistice AI. Redacția Transilvania Times verifică și aprobă conținutul înainte de publicare. Cu toate acestea, nu garantăm acuratețea absolută a conținutului AI și recomandăm consultarea surselor oficiale pentru decizii importante.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Some articles are partially generated using artificial intelligence. These are labelled with the AI journalist persona. The Transilvania Times editorial team reviews content before publication. We do not guarantee absolute accuracy of AI content and recommend consulting official sources for important decisions.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            5. Responsabilitate editorială / Editorial Responsibility
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Transilvania Times depune eforturi rezonabile pentru a asigura acuratețea informațiilor publicate. Cu toate acestea, nu ne asumăm răspunderea pentru erori sau omisiuni. Opiniile exprimate în editoriale și analize reprezintă punctele de vedere ale autorilor și nu constituie sfaturi profesionale (juridice, medicale, financiare).
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Transilvania Times makes reasonable efforts to ensure accuracy. However, we accept no liability for errors or omissions. Opinions in editorials represent the authors&apos; views and do not constitute professional advice.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            6. Comentarii și conținut utilizator / Comments and User Content
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Prin publicarea unui comentariu pe platforma noastră, acordați Transilvania Times o licență neexclusivă de a afișa acel conținut. Ne rezervăm dreptul de a modera, edita sau șterge orice comentariu care: conține limbaj ofensator, promovează ura sau discriminarea, conține informații false sau defăimătoare, sau încalcă drepturile terților.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            By posting a comment you grant Transilvania Times a non-exclusive licence to display that content. We reserve the right to moderate, edit or delete any comment containing offensive language, hate speech, false information, or content that violates third-party rights.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            7. Linkuri externe / External Links
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Platforma poate conține linkuri către site-uri externe. Nu ne asumăm responsabilitatea pentru conținutul, politicile de confidențialitate sau practicile acestor site-uri. Linkurile sunt furnizate exclusiv pentru informarea utilizatorilor.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            The platform may contain links to external sites. We accept no responsibility for the content, privacy policies or practices of these sites.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            8. Publicitate / Advertising
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Transilvania Times poate afișa publicitate prin Google AdSense. Conținutul publicitar este marcat ca atare și este afișat numai cu consimțământul dumneavoastră GDPR. Nu ne asumăm responsabilitatea pentru produsele sau serviciile promovate prin publicitate terță.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Transilvania Times may display advertising through Google AdSense. Advertising content is clearly labelled and is displayed only with your GDPR consent. We accept no responsibility for third-party products or services advertised.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            9. Modificarea termenilor / Changes to Terms
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Ne rezervăm dreptul de a modifica acești termeni oricând. Modificările vor fi publicate pe această pagină cu data actualizării. Utilizarea continuă a platformei după publicarea modificărilor constituie acceptarea noilor termeni.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            We reserve the right to modify these terms at any time. Changes will be published on this page with the update date. Continued use of the platform after changes are published constitutes acceptance of the new terms.
          </p>
        </section>

        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            10. Legea aplicabilă / Governing Law
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Acești termeni sunt guvernați de legea română. Orice litigiu se va soluționa în fața instanțelor competente din România.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            These terms are governed by Romanian law. Any dispute shall be resolved before the competent courts of Romania.
          </p>
        </section>

        <section className="border-t border-foreground/10 pt-6">
          <p className="text-muted-foreground text-sm">
            Pentru întrebări privind acești termeni:{' '}
            <Link href="/contact" className="text-brand-red hover:underline">
              Contactați-ne / Contact us
            </Link>
          </p>
        </section>

      </div>
    </div>
  )
}
