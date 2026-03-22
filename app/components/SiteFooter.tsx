'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, Mail, Phone, Facebook, Twitter, Instagram, Github } from 'lucide-react'

const CATEGORIES = [
  { label: 'Știri', href: '/categorie/news' },
  { label: 'Politică', href: '/categorie/politics' },
  { label: 'Tehnologie', href: '/categorie/technology' },
  { label: 'Afaceri', href: '/categorie/business' },
  { label: 'Cultură', href: '/categorie/culture' },
  { label: 'Călătorii', href: '/categorie/travel' },
  { label: 'Educație', href: '/categorie/education' },
  { label: 'Sport', href: '/categorie/sports' },
  { label: 'Sănătate', href: '/categorie/health' },
  { label: 'Opinie', href: '/categorie/opinion' },
]

export default function SiteFooter() {
  const [email, setEmail] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubscribe() {
    if (!email || !email.includes('@')) return
    setLoading(true)
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (res.ok) {
        setSubscribed(true)
        setEmail('')
      }
    } catch {
      // silent fail for now
    } finally {
      setLoading(false)
    }
  }

  return (
    <footer className="bg-background border-t border-foreground/10 pt-12 pb-6 px-4">
      <div className="container mx-auto max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">

          {/* Brand */}
          <div className="col-span-1">
            <Link href="/" className="font-serif text-2xl font-bold text-brand-red italic">
              Transilvania Times
            </Link>
            <p className="mt-2 text-[11px] font-sans uppercase tracking-widest text-muted-foreground">
              Un proiect media al ADD Individual Solutions Ltd.
            </p>
          </div>

          {/* Categories */}
          <div className="col-span-1">
            <h3 className="font-sans text-[11px] font-bold uppercase tracking-widest text-foreground mb-4">
              Categorii Populare
            </h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {CATEGORIES.map(cat => (
                <Link
                  key={cat.href}
                  href={cat.href}
                  className="text-[13px] font-sans text-muted-foreground hover:text-brand-red transition-colors"
                >
                  {cat.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="col-span-1">
            <h3 className="font-sans text-[11px] font-bold uppercase tracking-widest text-foreground mb-4">
              Contactează-ne
            </h3>
            <div className="space-y-3 text-[13px] font-sans text-muted-foreground">
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-red" />
                <div>
                  <p className="font-semibold text-foreground">Redacția Editorială</p>
                  <p>str. Frunzișului nr. 89</p>
                  <p>Cluj-Napoca, Transilvania</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand-red" />
                <div>
                  <p className="font-semibold text-foreground">Sediul Social</p>
                  <p>Sunset Valley, 7081 Pyla</p>
                  <p>Cyprus</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 shrink-0 text-brand-red" />
                <a href="mailto:contact@add-individual-solutions.com" className="hover:text-brand-red transition-colors">
                  contact@add-individual-solutions.com
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 shrink-0 text-brand-red" />
                <a href="tel:+35796919606" className="hover:text-brand-red transition-colors">
                  +357 96 919 606
                </a>
              </div>
            </div>
          </div>

          {/* Newsletter */}
          <div className="col-span-1">
            <div className="bg-brand-red p-5">
              <h3 className="font-serif text-xl font-bold text-white mb-1">
                Buletin Informativ
              </h3>
              <p className="text-[12px] font-sans text-white/80 mb-4">
                Nu rata știrile noastre exclusive. Nu trimitem spam.
              </p>
              {subscribed ? (
                <p className="text-white text-sm font-sans font-semibold">✓ Abonare reușită!</p>
              ) : (
                <div className="space-y-2">
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="Adresa ta de email"
                    className="w-full bg-white text-foreground text-[13px] font-sans px-3 py-2 outline-none placeholder:text-muted-foreground"
                    onKeyDown={e => e.key === 'Enter' && handleSubscribe()}
                  />
                  <button
                    onClick={handleSubscribe}
                    disabled={loading}
                    className="w-full bg-espresso text-white text-[12px] font-sans font-bold uppercase tracking-wider py-2 hover:bg-foreground transition-colors disabled:opacity-60"
                  >
                    {loading ? 'Se procesează...' : 'Abonează-te Acum'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-foreground/10 pt-5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[12px] font-sans text-muted-foreground">
            © {new Date().getFullYear()} Transilvania Times. Toate drepturile rezervate.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/politica-de-confidentialitate" className="text-[12px] font-sans text-muted-foreground hover:text-brand-red transition-colors">
              Confidențialitate
            </Link>
            <Link href="/termeni-si-conditii" className="text-[12px] font-sans text-muted-foreground hover:text-brand-red transition-colors">
              Termeni
            </Link>
            <div className="flex items-center gap-3">
              {[
                { Icon: Facebook, href: '#' },
                { Icon: Twitter, href: '#' },
                { Icon: Instagram, href: '#' },
                { Icon: Github, href: '#' },
              ].map(({ Icon, href }, i) => (
                <a key={i} href={href} className="text-muted-foreground hover:text-brand-red transition-colors">
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
