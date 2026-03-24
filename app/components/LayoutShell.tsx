'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Menu, X, LogOut, Settings, MapPin, Mail, Phone } from 'lucide-react'

// ── Inline newsletter form for footer (no external dependency) ────────────────
function FooterNewsletter() {
  const [email,    setEmail]    = useState('')
  const [subbed,   setSubbed]   = useState(false)
  const [loading,  setLoading]  = useState(false)

  async function subscribe(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    try {
      await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), language: 'ro' }),
      })
      setSubbed(true)
    } catch { /* silent */ }
    setLoading(false)
  }

  return (
    <div className="bg-brand-red p-5">
      <h3 className="font-serif text-xl font-bold text-white mb-1">Buletin Informativ</h3>
      <p className="text-[12px] font-sans text-white/80 mb-4">
        Nu rata știrile noastre exclusive. Nu trimitem spam.
      </p>
      {subbed ? (
        <p className="font-sans text-[13px] text-white font-bold">✓ Abonare confirmată!</p>
      ) : (
        <form onSubmit={subscribe} className="space-y-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Adresa ta de email"
            required
            className="w-full px-3 py-2.5 font-sans text-sm text-foreground bg-white placeholder:text-muted-foreground outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#1a1a1a] text-white font-sans font-bold text-[11px] uppercase tracking-widest hover:bg-black transition-colors disabled:opacity-50"
          >
            {loading ? '...' : 'Abonează-te acum'}
          </button>
        </form>
      )}
    </div>
  )
}
import WeatherWidget from './WeatherWidget'
import CookieBanner from './CookieBanner'

const NAV_LINKS = [
  { href: '/',            label: 'Acasă',       labelEn: 'Home' },
  { href: '/categorie/news',     label: 'Știri',       labelEn: 'News' },
  { href: '/categorie/politics', label: 'Politică',    labelEn: 'Politics' },
  { href: '/categorie/business', label: 'Afaceri',     labelEn: 'Business' },
  { href: '/categorie/culture',  label: 'Cultură',     labelEn: 'Culture' },
  { href: '/categorie/sports',   label: 'Sport',       labelEn: 'Sport' },
  { href: '/en',                 label: 'EN',          labelEn: 'EN' },
]

interface LayoutShellProps {
  children: React.ReactNode
  breakingNews: string[]
}

export default function LayoutShell({ children, breakingNews }: LayoutShellProps) {
  const pathname  = usePathname()
  const [mobileOpen, setMobileOpen]   = useState(false)
  const [isAdmin,    setIsAdmin]       = useState(false)
  const [scrolled,   setScrolled]      = useState(false)
  const [tickerIdx,  setTickerIdx]     = useState(0)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Check if user is admin
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAdmin(!!data.session?.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setIsAdmin(!!session?.user)
    })
    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll shadow
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Breaking news ticker rotation
  useEffect(() => {
    if (breakingNews.length <= 1) return
    const interval = setInterval(() => {
      setTickerIdx(i => (i + 1) % breakingNews.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [breakingNews.length])

  const isAdminRoute = pathname?.startsWith('/admin')

  // Admin pages get a minimal shell
  if (isAdminRoute) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">

      {/* ── Breaking news ticker ── */}
      {breakingNews.length > 0 && (
        <div className="bg-brand-red text-white py-1.5 px-4 flex items-center gap-3 overflow-hidden">
          <span className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] shrink-0 flex items-center gap-1">
            <span className="text-yellow-300">⚡</span> ULTIMA ORĂ
          </span>
          <div className="flex-1 overflow-hidden">
            <p className="font-sans text-[12px] truncate">
              {breakingNews[tickerIdx]}
            </p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className={`sticky top-0 z-40 bg-background border-b border-foreground/10 transition-shadow ${
        scrolled ? 'shadow-md' : ''
      }`}>

        {/* ── Top utility bar ── */}
        <div className="border-b border-foreground/[0.08] px-6 py-1.5">
          <div className="max-w-7xl mx-auto flex items-center justify-between">

            {/* Left: language switcher + date + weather */}
            <div className="flex items-center gap-3 font-sans text-[11px] text-muted-foreground">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {}}
                  className="font-bold text-brand-red uppercase tracking-wider"
                >
                  RO
                </button>
                <span className="text-foreground/20">|</span>
                <Link href="/en" className="uppercase tracking-wider hover:text-brand-red transition-colors">
                  EN
                </Link>
              </div>
              <span className="text-foreground/20">|</span>
              <span className="hidden sm:inline capitalize">
                {new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <WeatherWidget />
            </div>

            {/* Right: search + support button */}
            <div className="flex items-center gap-3">
              <button aria-label="Căutare" className="text-muted-foreground hover:text-foreground transition-colors p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </button>
              {isAdmin ? (
                <div className="flex items-center gap-2">
                  <Link href="/admin/dashboard"
                    className="font-sans text-[11px] text-muted-foreground hover:text-brand-red flex items-center gap-1 transition-colors">
                    <Settings size={12} /> Admin
                  </Link>
                  <button
                    onClick={async () => { await supabase.auth.signOut() }}
                    className="font-sans text-[11px] text-muted-foreground hover:text-brand-red flex items-center gap-1 transition-colors"
                  >
                    <LogOut size={12} />
                  </button>
                </div>
              ) : (
                <Link
                  href="/contact"
                  className="font-sans text-[10px] font-bold uppercase tracking-[0.15em] px-4 py-1.5 bg-brand-red text-white hover:bg-red-700 transition-colors"
                >
                  Susține-ne
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* ── Masthead — big centered title ── */}
        <div className="py-5 text-center border-b border-foreground/[0.08]">
          <Link href="/" className="inline-block">
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold text-foreground tracking-tight">
              Transilvania Times
            </h1>
          </Link>
        </div>

        {/* ── Navigation row ── */}
        <div className="px-6">
          <div className="max-w-7xl mx-auto flex items-center justify-between">

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center mx-auto">
              {NAV_LINKS.filter(l => l.href !== '/en').map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`font-sans text-[12px] font-medium px-4 py-3 transition-colors ${
                    pathname === link.href || (link.href !== '/' && pathname?.startsWith(link.href))
                      ? 'text-brand-red font-bold'
                      : 'text-foreground/70 hover:text-foreground'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            {/* Mobile menu button */}
            <button
              className="md:hidden ml-auto text-foreground p-2"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Menu"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-foreground/10 bg-background px-6 py-4 space-y-1">
            {NAV_LINKS.map(link => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block font-sans text-[12px] font-bold uppercase tracking-wider py-2.5 border-b border-foreground/[0.06] transition-colors ${
                  pathname === link.href ? 'text-brand-red' : 'text-muted-foreground'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-2">
              <WeatherWidget />
            </div>
          </div>
        )}
      </header>

      {/* ── Main content ── */}
      <main className="flex-1">
        {children}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-foreground/10 bg-background mt-16">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">

            {/* Brand */}
            <div className="col-span-1">
              <Link href="/" className="font-serif text-xl font-bold italic text-brand-red block mb-3">
                Transilvania Times
              </Link>
              <p className="font-sans text-[11px] uppercase tracking-widest text-muted-foreground leading-relaxed">
                Un proiect media al ADD Individual Solutions Ltd.
              </p>
            </div>

            {/* Categories */}
            <div className="col-span-1">
              <h3 className="font-sans text-[11px] font-bold uppercase tracking-widest text-foreground mb-4">
                Categorii Populare
              </h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { href: '/categorie/news',       label: 'Știri' },
                  { href: '/categorie/politics',   label: 'Politică' },
                  { href: '/categorie/technology', label: 'Tehnologie' },
                  { href: '/categorie/business',   label: 'Afaceri' },
                  { href: '/categorie/culture',    label: 'Cultură' },
                  { href: '/categorie/travel',     label: 'Călătorii' },
                  { href: '/categorie/education',  label: 'Educație' },
                  { href: '/categorie/sports',     label: 'Sport' },
                  { href: '/categorie/health',     label: 'Sănătate' },
                  { href: '/categorie/opinion',    label: 'Opinie' },
                ].map(cat => (
                  <Link key={cat.href} href={cat.href}
                    className="text-[13px] font-sans text-muted-foreground hover:text-brand-red transition-colors">
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
                  <a href="mailto:contact@add-individual-solutions.com"
                    className="hover:text-brand-red transition-colors break-all">
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
              <FooterNewsletter />
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-foreground/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="font-sans text-[11px] text-muted-foreground">
              © {new Date().getFullYear()} Transilvania Times. Toate drepturile rezervate.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/politica-confidentialitate"
                className="font-sans text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                Confidențialitate
              </Link>
              <Link href="/termeni-si-conditii"
                className="font-sans text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                Termeni
              </Link>
              <div className="flex items-center gap-3 ml-2">
                <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                  className="text-muted-foreground hover:text-brand-red transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                </a>
                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter"
                  className="text-muted-foreground hover:text-brand-red transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
                <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram"
                  className="text-muted-foreground hover:text-brand-red transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>
                </a>
                <a href="https://github.com/DanielPierre2023" target="_blank" rel="noopener noreferrer" aria-label="GitHub"
                  className="text-muted-foreground hover:text-brand-red transition-colors">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>

      {/* ── Cookie banner ── */}
      <CookieBanner />
    </div>
  )
}
