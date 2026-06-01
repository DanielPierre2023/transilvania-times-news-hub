'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X, MapPin, ChevronRight } from 'lucide-react'
import { COUNTIES, getCountyLabel } from '@/lib/counties'

interface CountyArticle {
  slug: string
  title_ro: string | null
  title_en: string | null
  cover_image: string | null
  published_at: string | null
  county: string | null
  category: string | null
}

const COOKIE_NAME      = 'tt_county_pref'
const COOKIE_DISMISSED = 'tt_county_strip_dismissed'

function readCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : ''
}

function writeCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 86400000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

export default function CountyStrip() {
  const [mounted, setMounted]   = useState(false)
  const [county, setCounty]     = useState<string>('')
  const [dismissed, setDismissed] = useState(false)
  const [articles, setArticles] = useState<CountyArticle[]>([])
  const [loading, setLoading]   = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    setMounted(true)
    if (readCookie(COOKIE_DISMISSED) === '1') {
      setDismissed(true)
      return
    }
    const c = readCookie(COOKIE_NAME)
    if (c) setCounty(c)
  }, [])

  useEffect(() => {
    if (!county) return
    setLoading(true)
    fetch(`/api/county-feed?county=${encodeURIComponent(county)}&limit=3`)
      .then(r => r.ok ? r.json() : { articles: [] })
      .then((d: { articles: CountyArticle[] }) => setArticles(d.articles || []))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false))
  }, [county])

  function chooseCounty(slug: string) {
    setCounty(slug)
    writeCookie(COOKIE_NAME, slug)
    setShowPicker(false)
  }

  function dismiss() {
    setDismissed(true)
    writeCookie(COOKIE_DISMISSED, '1')
  }

  if (!mounted || dismissed) return null

  if (!county) {
    return (
      <section className="border-b border-foreground/10 bg-foreground/[0.02]">
        <div className="px-6 py-6">
          <div className="flex items-start justify-between gap-4 max-w-7xl mx-auto">
            <div className="flex items-start gap-3 flex-1">
              <MapPin className="w-5 h-5 text-brand-red shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-serif text-lg font-bold text-foreground mb-1">
                  Astăzi în județul tău
                </p>
                <p className="font-sans text-[13px] text-muted-foreground mb-3">
                  Selectează județul tău pentru articole apropiate de casă. Setarea se păstrează.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTIES.filter(c => c.isTransylvania).map(c => (
                    <button
                      key={c.slug}
                      onClick={() => chooseCounty(c.slug)}
                      className="text-[11px] font-sans px-2.5 py-1 border border-foreground/20 text-foreground/70 hover:border-brand-red hover:text-brand-red transition-colors"
                    >
                      {c.label}
                    </button>
                  ))}
                  <button
                    onClick={() => chooseCounty('national')}
                    className="text-[11px] font-sans px-2.5 py-1 border border-foreground/20 text-foreground/50 hover:border-brand-red hover:text-brand-red transition-colors"
                  >
                    Doar național
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label="Închide"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>
    )
  }

  const countyLabel = getCountyLabel(county)

  return (
    <section className="border-b border-foreground/10 bg-foreground/[0.02]">
      <div className="px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-brand-red" />
              <p className="font-sans font-bold text-[11px] uppercase tracking-[0.2em] text-brand-red">
                Astăzi în {countyLabel}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowPicker(p => !p)}
                className="font-sans text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Schimbă județul
              </button>
              <Link
                href={`/judet/${county}`}
                className="font-sans text-[11px] font-bold text-brand-red hover:underline inline-flex items-center gap-0.5"
              >
                Vezi toate <ChevronRight className="w-3 h-3" />
              </Link>
              <button
                onClick={dismiss}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Închide"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {showPicker && (
            <div className="mb-4 p-3 bg-background border border-foreground/10">
              <div className="flex flex-wrap gap-1.5">
                {COUNTIES.map(c => (
                  <button
                    key={c.slug}
                    onClick={() => chooseCounty(c.slug)}
                    className={`text-[11px] font-sans px-2.5 py-1 border transition-colors ${
                      c.slug === county
                        ? 'bg-brand-red text-white border-brand-red'
                        : 'border-foreground/20 text-foreground/70 hover:border-brand-red hover:text-brand-red'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[0,1,2].map(i => (
                <div key={i} className="bg-foreground/[0.04] h-24 animate-pulse" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <p className="font-sans text-[13px] text-muted-foreground italic py-4">
              Niciun articol publicat încă din {countyLabel}.{' '}
              <Link href={`/judet/${county}`} className="text-brand-red hover:underline">
                Vezi pagina județului
              </Link>
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {articles.map(a => (
                <Link
                  key={a.slug}
                  href={`/blog/${a.slug}`}
                  className="group flex gap-3 items-start"
                >
                  {a.cover_image && (
                    <div className="w-20 h-16 shrink-0 overflow-hidden">
                      <img
                        src={a.cover_image}
                        alt={a.title_ro || a.title_en || ''}
                        className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif text-sm font-semibold leading-snug text-foreground group-hover:text-brand-red transition-colors line-clamp-3">
                      {a.title_ro || a.title_en}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
