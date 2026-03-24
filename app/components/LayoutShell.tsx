'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Menu, X, LogOut, Settings } from 'lucide-react'
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
            <div className="md:col-span-2">
              <Link href="/" className="font-serif font-bold text-2xl text-foreground block mb-4">
                Transilvania Times
              </Link>
              <p className="font-sans text-sm text-muted-foreground leading-relaxed max-w-sm">
                Jurnalism independent din inima Transilvaniei. Știri regionale, analiză și cultură pentru comunitatea transilvăneană.
              </p>
              <p className="font-sans text-xs text-muted-foreground/60 mt-2 leading-relaxed max-w-sm">
                Independent journalism from the heart of Transylvania. Regional news, analysis and culture for the Transylvanian community.
              </p>
            </div>

            {/* Navigation */}
            <div>
              <p className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red mb-4">
                Categorii / Categories
              </p>
              <ul className="space-y-2">
                {['news', 'politics', 'business', 'culture', 'sports', 'health'].map(cat => (
                  <li key={cat}>
                    <Link href={`/categorie/${cat}`}
                      className="font-sans text-sm text-muted-foreground hover:text-foreground transition-colors capitalize">
                      {cat}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal + Contact */}
            <div>
              <p className="font-sans font-bold text-[10px] uppercase tracking-[0.2em] text-brand-red mb-4">
                Legal & Contact
              </p>
              <ul className="space-y-2">
                <li>
                  <Link href="/contact"
                    className="font-sans text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Contact
                  </Link>
                </li>
                <li>
                  <Link href="/politica-confidentialitate"
                    className="font-sans text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Politică de confidențialitate
                  </Link>
                </li>
                <li>
                  <Link href="/termeni-si-conditii"
                    className="font-sans text-sm text-muted-foreground hover:text-foreground transition-colors">
                    Termeni și condiții
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Newsletter strip */}
          <div className="border-t border-foreground/10 pt-8 mb-8">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 max-w-2xl">
              <div className="flex-1">
                <p className="font-serif font-bold text-foreground">Newsletter</p>
                <p className="font-sans text-xs text-muted-foreground">
                  Primești cele mai importante știri săptămânal. / Get the most important news weekly.
                </p>
              </div>
              <a href="/contact"
                className="font-sans text-[11px] font-bold uppercase tracking-wider px-5 py-2.5 bg-brand-red text-white hover:bg-red-700 transition-colors shrink-0">
                Abonează-te / Subscribe
              </a>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-foreground/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-3">
            <p className="font-sans text-[11px] text-muted-foreground/60">
              © {new Date().getFullYear()} Transilvania Times. ADD Individual Solutions Ltd. Toate drepturile rezervate.
            </p>
            <p className="font-sans text-[11px] text-muted-foreground/40">
              Conținut generat parțial cu inteligență artificială / Content partially AI-generated
            </p>
          </div>
        </div>
      </footer>

      {/* ── Cookie banner ── */}
      <CookieBanner />
    </div>
  )
}
