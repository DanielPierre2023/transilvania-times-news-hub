'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, X, Menu } from 'lucide-react'
import { useRouter } from 'next/navigation'

const NAV_LINKS = [
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

interface SiteHeaderProps {
  breakingNews?: string[]
}

export default function SiteHeader({ breakingNews = [] }: SiteHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const router = useRouter()

  const dateStr = new Intl.DateTimeFormat('ro-RO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date())

  function handleSearchSubmit(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && searchQuery.trim()) {
      router.push(`/cautare?q=${encodeURIComponent(searchQuery.trim())}`)
      setSearchOpen(false)
      setSearchQuery('')
    }
  }

  return (
    <header>
      {/* Breaking news ticker */}
      {breakingNews.length > 0 && (
        <div className="bg-brand-red text-white py-1.5 overflow-hidden">
          <div className="flex items-center gap-3 px-4">
            <span className="shrink-0 text-[11px] font-sans font-bold uppercase tracking-widest flex items-center gap-1.5">
              <span className="text-yellow-300">⚡</span> ULTIMA ORĂ
            </span>
            <div className="overflow-hidden flex-1">
              <p className="whitespace-nowrap animate-marquee text-[12px] font-sans">
                {breakingNews.join(' · ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Top bar: date + lang + search + support */}
      <div className="border-b border-foreground/10">
        <div className="container mx-auto max-w-7xl px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[11px] font-sans text-muted-foreground">
            <Link href="/" className="font-bold text-foreground hover:text-brand-red transition-colors">RO</Link>
            <span className="text-foreground/20">|</span>
            <Link href="/en" className="hover:text-brand-red transition-colors">EN</Link>
            <span className="hidden sm:inline text-foreground/20">|</span>
            <span className="hidden sm:inline capitalize">{dateStr}</span>
          </div>
          <div className="flex items-center gap-3">
            {searchOpen ? (
              <div className="flex items-center gap-2 border-b border-foreground/30 pb-0.5">
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchSubmit}
                  placeholder="Caută articole..."
                  className="bg-transparent text-xs font-sans outline-none w-48 placeholder:text-muted-foreground"
                />
                <button onClick={() => { setSearchOpen(false); setSearchQuery('') }}>
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <button onClick={() => setSearchOpen(true)} aria-label="Caută">
                <Search className="w-4 h-4 text-foreground/70 hover:text-foreground transition-colors" />
              </button>
            )}
            <Link
              href="/sustine"
              className="bg-brand-red text-white text-[11px] font-sans font-bold uppercase tracking-wider px-3 py-1.5 hover:bg-espresso transition-colors"
            >
              Susține-ne
            </Link>
          </div>
        </div>
      </div>

      {/* Masthead */}
      <div className="container mx-auto max-w-7xl px-4 py-3 text-center">
        <Link href="/" className="inline-block">
          <span className="font-serif text-4xl md:text-5xl font-bold text-foreground tracking-tight block">
  Transilvania Times
</span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="border-t border-b border-foreground/10">
        <div className="container mx-auto max-w-7xl px-4">
          {/* Desktop */}
          <ul className="hidden md:flex items-center justify-center gap-6 py-2">
            {NAV_LINKS.map(link => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-[13px] font-sans text-foreground/80 hover:text-brand-red transition-colors whitespace-nowrap"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {/* Mobile */}
          <div className="md:hidden flex items-center justify-between py-2">
            <span className="font-serif text-sm font-semibold text-foreground">Categorii</span>
            <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Meniu">
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
          {menuOpen && (
            <ul className="md:hidden flex flex-col pb-3 gap-1">
              {NAV_LINKS.map(link => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className="block text-[13px] font-sans text-foreground/80 hover:text-brand-red py-1.5 transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </nav>
    </header>
  )
}
