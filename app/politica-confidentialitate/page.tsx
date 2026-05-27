import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Politică de Confidențialitate | Transilvania Times',
  description: 'Politica de confidențialitate și protecția datelor personale conform GDPR pentru Transilvania Times.',
}

const LAST_UPDATED = '24 martie 2026'

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">

      {/* Header */}
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 bg-brand-red" />
          <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red">
            Legal
          </span>
        </div>
        <h1 className="font-serif text-4xl font-bold text-foreground mb-3">
          Politică de Confidențialitate
        </h1>
        <h2 className="font-serif text-2xl text-muted-foreground mb-4">
          Privacy Policy
        </h2>
        <p className="font-sans text-sm text-muted-foreground">
          Ultima actualizare / Last updated: {LAST_UPDATED}
        </p>
      </div>

      <div className="prose prose-lg max-w-none font-sans space-y-8">

        {/* Operator */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            1. Operatorul de date / Data Controller
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Operatorul de date cu caracter personal este <strong className="text-foreground">Transilvania Times</strong> (transilvaniatimes.com). Pentru orice solicitare legată de datele dumneavoastră personale, ne puteți contacta la adresa de email indicată în secțiunea Contact.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            The data controller is <strong className="text-foreground">Transilvania Times</strong>. For any requests related to your personal data, please contact us at the email address indicated in the Contact section.
          </p>
        </section>

        {/* Data collected */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            2. Date colectate / Data Collected
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Colectăm următoarele categorii de date:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Date de navigare:</strong> adresa IP, tipul de browser, paginile vizitate, durata sesiunii — colectate automat prin cookie-uri tehnice.</li>
            <li><strong className="text-foreground">Date de newsletter:</strong> adresa de email pe care o furnizați voluntar la abonare.</li>
            <li><strong className="text-foreground">Date de contact:</strong> nume, email, subiect și mesaj atunci când utilizați formularul de contact.</li>
            <li><strong className="text-foreground">Date analitice:</strong> statistici anonimizate de utilizare a site-ului, colectate numai cu consimțământul dumneavoastră explicit.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            We collect: navigation data (IP address, browser type, pages visited), newsletter email addresses (voluntary), contact form data, and anonymised analytics (only with explicit consent).
          </p>
        </section>

        {/* Legal basis */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            3. Temeiul juridic / Legal Basis
          </h3>
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Consimțământ (Art. 6(1)(a) GDPR):</strong> pentru cookie-uri analitice și newsletter.</li>
            <li><strong className="text-foreground">Interes legitim (Art. 6(1)(f) GDPR):</strong> pentru securitatea platformei și prevenirea fraudei.</li>
            <li><strong className="text-foreground">Executarea unui contract (Art. 6(1)(b) GDPR):</strong> pentru gestionarea conturilor de utilizator.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Legal basis: Consent (Art. 6(1)(a) GDPR) for analytics and newsletter; Legitimate interest (Art. 6(1)(f) GDPR) for platform security; Contract performance (Art. 6(1)(b) GDPR) for user accounts.
          </p>
        </section>

        {/* Cookie usage */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            4. Cookie-uri / Cookies
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Utilizăm trei categorii de cookie-uri:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Cookie-uri esențiale:</strong> necesare pentru funcționarea site-ului (autentificare, sesiune). Nu pot fi dezactivate.</li>
            <li><strong className="text-foreground">Cookie-uri analitice:</strong> Google Analytics — colectate numai cu consimțământul dumneavoastră. Pot fi dezactivate prin bannerul de cookie-uri.</li>
            <li><strong className="text-foreground">Cookie-uri de publicitate:</strong> Google AdSense — colectate numai cu consimțământul dumneavoastră.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            We use essential cookies (required for site function), analytics cookies (Google Analytics, only with consent), and advertising cookies (Google AdSense, only with consent). You may withdraw consent at any time via the cookie banner.
          </p>
        </section>

        {/* Data retention */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            5. Durata stocării / Data Retention
          </h3>
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Date analitice:</strong> 26 luni (politica Google Analytics).</li>
            <li><strong className="text-foreground">Adrese email newsletter:</strong> până la dezabonare.</li>
            <li><strong className="text-foreground">Mesaje contact:</strong> maximum 12 luni.</li>
            <li><strong className="text-foreground">Conturi utilizator:</strong> pe durata existenței contului.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Analytics data: 26 months. Newsletter emails: until unsubscription. Contact messages: maximum 12 months. User accounts: for the duration of the account.
          </p>
        </section>

        {/* Third parties */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            6. Terți procesatori / Third-Party Processors
          </h3>
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Supabase Inc.</strong> (SUA) — baza de date și autentificare. DPA disponibil la supabase.com/privacy.</li>
            <li><strong className="text-foreground">Netlify Inc.</strong> (SUA) — hosting. DPA disponibil la netlify.com/gdpr-ccpa.</li>
            <li><strong className="text-foreground">Google LLC</strong> — Analytics și AdSense. DPA disponibil la policies.google.com.</li>
            <li><strong className="text-foreground">Resend Inc.</strong> — trimitere email newsletter. DPA disponibil la resend.com/legal/privacy-policy.</li>
            <li><strong className="text-foreground">OpenAI Inc.</strong> / <strong className="text-foreground">HuggingFace Inc.</strong> — generare conținut AI. Datele personale nu sunt transmise acestor servicii.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Third-party processors include Supabase (database), Netlify (hosting), Google (Analytics/AdSense), and Resend (email). All maintain GDPR-compliant Data Processing Agreements. Personal data is not transmitted to AI providers.
          </p>
        </section>

        {/* User rights */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            7. Drepturile dumneavoastră / Your Rights
          </h3>
          <p className="text-muted-foreground leading-relaxed mb-3">
            Conform GDPR, aveți dreptul la:
          </p>
          <ul className="space-y-2 text-muted-foreground">
            <li><strong className="text-foreground">Acces</strong> — să solicitați o copie a datelor pe care le deținem despre dumneavoastră.</li>
            <li><strong className="text-foreground">Rectificare</strong> — să corectați datele inexacte.</li>
            <li><strong className="text-foreground">Ștergere</strong> — să solicitați ștergerea datelor (&ldquo;dreptul de a fi uitat&rdquo;).</li>
            <li><strong className="text-foreground">Restricționare</strong> — să limitați prelucrarea datelor.</li>
            <li><strong className="text-foreground">Portabilitate</strong> — să primiți datele într-un format structurat, lizibil automat.</li>
            <li><strong className="text-foreground">Opoziție</strong> — să vă opuneți prelucrării bazate pe interes legitim.</li>
            <li><strong className="text-foreground">Retragerea consimțământului</strong> — oricând, fără a afecta legalitatea prelucrării anterioare.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Under GDPR you have the right to access, rectify, erase, restrict, port, and object to the processing of your personal data, and to withdraw consent at any time.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3">
            Pentru exercitarea drepturilor, contactați-ne prin{' '}
            <Link href="/contact" className="text-brand-red hover:underline">formularul de contact</Link>.
            Aveți de asemenea dreptul de a depune o plângere la <strong className="text-foreground">ANSPDCP</strong> (Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal) la adresa{' '}
            <a href="https://www.dataprotection.ro" target="_blank" rel="noopener noreferrer" className="text-brand-red hover:underline">
              www.dataprotection.ro
            </a>.
          </p>
        </section>

        {/* AI content */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            8. Conținut generat cu inteligență artificială / AI-Generated Content
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Unele articole publicate pe Transilvania Times sunt generate sau prelucrate parțial (fact checks) cu ajutorul inteligenței artificiale (OpenAI products). Articolele asistate cu AI sunt marcate cu mențiunea autorului jurnalistului AI. Datele personale ale utilizatorilor nu sunt transmise sistemelor AI.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-3 text-sm">
            Some articles are partially generated or processed (fact checks) using artificial intelligence. AI-assisted articles are labelled with the AI journalist persona name. No user personal data is transmitted to AI systems.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h3 className="font-serif text-xl font-bold text-foreground mb-3">
            9. Contact DPO
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Pentru orice întrebare legată de protecția datelor, folosiți{' '}
            <Link href="/contact" className="text-brand-red hover:underline">
              formularul nostru de contact
            </Link>{' '}
            cu subiectul &ldquo;GDPR&rdquo;.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-2 text-sm">
            For any data protection enquiries, use our{' '}
            <Link href="/contact" className="text-brand-red hover:underline">
              contact form
            </Link>{' '}
            with the subject &ldquo;GDPR&rdquo;.
          </p>
        </section>

      </div>
    </div>
  )
}
