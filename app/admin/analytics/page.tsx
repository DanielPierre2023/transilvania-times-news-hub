'use client'

// app/admin/analytics/page.tsx
//
// v3 — Server-side aggregation fix.
//
// v2 fetched raw rows from site_analytics via the Supabase JS client and
// aggregated everything in JavaScript. Supabase's PostgREST enforces a
// server-side max_rows of 1,000 regardless of the client's .limit() value.
// The 7-day window (~660 rows) fit under the cap and was accurate; the
// 30-day window (~5,000+ rows) was silently truncated to 1,000, showing
// 1.0k views / 730 visitors instead of the real 5,064 / 3,522.
//
// v3 calls a single RPC `get_analytics_data(p_period)` that runs all
// aggregation in SQL on the server and returns one small JSON object.
// No row limit issue, no client-side counting, scales to any table size.
// The blog post title lookup stays client-side (small, bounded query).
//
// Everything else preserved: same cards, same charts, same layout, same
// source classification colors, same FB vs Organic widget, same title
// resolution, same admin path exclusion (now in SQL WHERE clause).

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  Eye, Users, Globe, Monitor, Smartphone, Tablet,
  Clock, TrendingUp, ExternalLink, RefreshCw, ArrowUpRight, MapPin
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewStats {
  views_24h: number; visitors_24h: number
  views_7d: number;  visitors_7d: number
  views_30d: number; visitors_30d: number
  live_5min: number
}

interface TableRow { label: string; value: number; extra?: number }
interface DailyRow { day: string; views: number; uniques: number }

type Period = '24h' | '7d' | '30d'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const periodLabel: Record<Period, string> = {
  '24h': 'Ultimele 24h',
  '7d': 'Ultima săptămână',
  '30d': 'Ultima lună',
}

// ─── UI Components ────────────────────────────────────────────────────────────

function Card({ icon: Icon, label, value, sub }: {
  icon: typeof Eye; label: string; value: string; sub?: string
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
      <div className="flex items-center gap-2 text-zinc-500 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-zinc-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

const SOURCE_COLORS: Record<string, string> = {
  'Facebook': '#1877f2', 'Direct': '#dc2626', 'Google Search': '#4285f4',
  'Google News': '#174ea6', 'Twitter / X': '#1da1f2', 'LinkedIn': '#0a66c2',
  'Instagram': '#e4405f', 'WhatsApp': '#25d366', 'Bing': '#008373',
  'Navigare internă': '#888', 'Altele': '#aaa',
}

function HorizBar({ items, maxItems = 10, colorFn }: {
  items: TableRow[]; maxItems?: number; colorFn?: (label: string) => string
}) {
  const visible = items.slice(0, maxItems)
  const peak = Math.max(...visible.map(d => d.value), 1)
  return (
    <div className="space-y-2">
      {visible.map((row, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-zinc-600 dark:text-zinc-400 w-32 truncate text-right font-mono">
            {row.label}
          </span>
          <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${(row.value / peak) * 100}%`,
                backgroundColor: colorFn ? colorFn(row.label) : '#dc2626',
              }}
            />
          </div>
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 w-12 text-right">
            {fmt(row.value)}
          </span>
          {row.extra !== undefined && (
            <span className="text-[10px] text-zinc-400 w-14 text-right">{fmt(row.extra)} unici</span>
          )}
        </div>
      ))}
      {items.length === 0 && (
        <p className="text-xs text-zinc-400 text-center py-4">Nu există date pentru perioada selectată.</p>
      )}
    </div>
  )
}

function SimpleTimeSeries({ data }: { data: DailyRow[] }) {
  if (!data.length) return <p className="text-xs text-zinc-400 text-center py-8">Nu există date.</p>
  const max = Math.max(...data.map(d => d.views), 1)
  return (
    <div className="flex items-end gap-[2px] h-40 px-2">
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-0">
          <div
            className="w-full bg-red-600 rounded-t transition-all hover:bg-red-500 cursor-default"
            style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views > 0 ? '2px' : '0' }}
            title={`${d.day}: ${d.views} vizualizări, ${d.uniques} unici`}
          />
          {(i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2)) && (
            <span className="text-[9px] text-zinc-400 mt-1 whitespace-nowrap">
              {d.day.substring(5)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('7d')
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [pages, setPages] = useState<TableRow[]>([])
  const [sources, setSources] = useState<TableRow[]>([])
  const [countries, setCountries] = useState<TableRow[]>([])
  const [cities, setCities] = useState<TableRow[]>([])
  const [devices, setDevices] = useState<TableRow[]>([])
  const [browsers, setBrowsers] = useState<TableRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [fbVsOrganic, setFbVsOrganic] = useState({ facebook: 0, google: 0, direct: 0, other: 0 })
  const [titles, setTitles] = useState<Record<string, string>>({})

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const load = useCallback(async () => {
    setLoading(true)

    // v3: ONE server-side RPC call replaces all the raw row fetching.
    // The RPC runs SQL aggregation on the server and returns a single
    // JSON object with all computed breakdowns. No row limit issue.
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('get_analytics_data', { p_period: period })

    if (rpcError || !rpcResult) {
      console.error('Analytics RPC failed:', rpcError?.message)
      setLoading(false)
      return
    }

    const d = rpcResult as Record<string, unknown>

    // Overview cards
    const ov = d.overview as OverviewStats
    if (ov) setOverview(ov)

    // Breakdowns — all pre-aggregated by the RPC
    setPages((d.pages as TableRow[]) || [])
    setSources((d.sources as TableRow[]) || [])
    setCountries((d.countries as TableRow[]) || [])
    setCities((d.cities as TableRow[]) || [])
    setDevices((d.devices as TableRow[]) || [])
    setBrowsers((d.browsers as TableRow[]) || [])
    setDaily((d.daily as DailyRow[]) || [])

    // FB vs Organic
    const fb = d.fb_organic as { facebook: number; google: number; direct: number; other: number }
    if (fb) setFbVsOrganic(fb)

    // Blog post titles — small bounded query, stays client-side
    const pageItems = (d.pages as TableRow[]) || []
    const blogSlugs = pageItems
      .filter(p => p.label.startsWith('/blog/'))
      .map(p => {
        const parts = p.label.replace(/\/$/, '').split('/')
        return parts[parts.length - 1] || ''
      })
      .filter(Boolean)
    const uniqueSlugs = [...new Set(blogSlugs)].slice(0, 30)

    if (uniqueSlugs.length > 0) {
      const { data: posts } = await supabase
        .from('blog_posts')
        .select('slug, title_ro')
        .in('slug', uniqueSlugs)
      const map: Record<string, string> = {}
      for (const p of (posts || []) as { slug: string; title_ro: string | null }[]) {
        if (p.title_ro) map[p.slug] = p.title_ro
      }
      setTitles(map)
    }

    setLoading(false)
  }, [period, supabase])

  useEffect(() => { load() }, [load])

  // Resolve page path to title or clean label
  function pageLabel(path: string): string {
    if (path === '/') return 'Pagina principală'
    if (path.startsWith('/blog/')) {
      const slug = path.replace(/\/$/, '').split('/').pop() || ''
      if (titles[slug]) return titles[slug]
    }
    if (path.startsWith('/categorie/')) return 'Categorie: ' + path.split('/').pop()
    if (path.startsWith('/judet/')) return 'Județ: ' + path.split('/').pop()
    if (path.startsWith('/autor/')) return 'Autor: ' + path.split('/').pop()
    if (path.startsWith('/en/')) return '🇬🇧 ' + path
    return path
  }

  const DevIcon = ({ type }: { type: string }) => {
    if (type === 'mobile') return <Smartphone className="w-3.5 h-3.5" />
    if (type === 'tablet') return <Tablet className="w-3.5 h-3.5" />
    return <Monitor className="w-3.5 h-3.5" />
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">Observabilitate</h1>
          <p className="text-sm text-zinc-500">Trafic în timp real — Transilvania Times</p>
        </div>
        <div className="flex items-center gap-3">
          {overview && overview.live_5min > 0 && (
            <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-400 px-3 py-1.5 rounded-full text-xs font-bold">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {overview.live_5min} acum online
            </div>
          )}
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
            {(['24h', '7d', '30d'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  p === period ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}>{p}</button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="p-2 text-zinc-500 hover:text-zinc-700 transition-colors disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card icon={Eye} label="Vizualizări"
            value={fmt(period === '24h' ? overview.views_24h : period === '7d' ? overview.views_7d : overview.views_30d)}
            sub={periodLabel[period]} />
          <Card icon={Users} label="Vizitatori unici"
            value={fmt(period === '24h' ? overview.visitors_24h : period === '7d' ? overview.visitors_7d : overview.visitors_30d)}
            sub={periodLabel[period]} />
          <Card icon={TrendingUp} label="Vizualizări / zi"
            value={fmt(Math.round((period === '24h' ? overview.views_24h : period === '7d' ? overview.views_7d / 7 : overview.views_30d / 30)))}
            sub="medie" />
          <Card icon={Clock} label="Acum online"
            value={String(overview.live_5min)} sub="ultimele 5 minute" />
        </div>
      )}

      {/* Time series */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
        <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4">Vizualizări pe zi</h2>
        <SimpleTimeSeries data={daily} />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Top pages — with TITLES instead of raw paths */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" /> Pagini populare
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {pages.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[70%]">
                  {pageLabel(p.label)}
                </span>
                <div className="flex gap-3 text-right">
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(p.value)}</span>
                  {p.extra !== undefined && (
                    <span className="text-zinc-400">{fmt(p.extra)} unici</span>
                  )}
                </div>
              </div>
            ))}
            {pages.length === 0 && <p className="text-xs text-zinc-400 text-center py-4">Nu există date.</p>}
          </div>
        </div>

        {/* Traffic sources — classified with colors */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <ExternalLink className="w-4 h-4" /> Surse de trafic
          </h2>
          <HorizBar items={sources} colorFn={(label) => SOURCE_COLORS[label] || '#dc2626'} />

          {/* Facebook vs Organic breakdown */}
          {(fbVsOrganic.facebook > 0 || fbVsOrganic.google > 0) && (
            <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-3">Facebook vs Organic</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold" style={{ color: '#1877f2' }}>{fmt(fbVsOrganic.facebook)}</div>
                  <div className="text-[10px] text-zinc-400">Facebook</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: '#4285f4' }}>{fmt(fbVsOrganic.google)}</div>
                  <div className="text-[10px] text-zinc-400">Google</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: '#dc2626' }}>{fmt(fbVsOrganic.direct)}</div>
                  <div className="text-[10px] text-zinc-400">Direct</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-zinc-500">{fmt(fbVsOrganic.other)}</div>
                  <div className="text-[10px] text-zinc-400">Altele</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Geography — countries */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Geografie — Țări
          </h2>
          <HorizBar items={countries} colorFn={() => '#0d1b4b'} />
        </div>

        {/* Geography — cities */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Geografie — Orașe
          </h2>
          <HorizBar items={cities} maxItems={15} colorFn={() => '#c41e3a'} />
        </div>

        {/* Devices & Browsers */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <Monitor className="w-4 h-4" /> Dispozitive și Browsere
          </h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">Dispozitive</p>
              {devices.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                    <DevIcon type={d.label} /> {d.label}
                  </span>
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(d.value)}</span>
                </div>
              ))}
              {devices.length === 0 && <p className="text-xs text-zinc-400">{'\u2014'}</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">Browsere</p>
              {browsers.map((b, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">{b.label}</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(b.value)}</span>
                </div>
              ))}
              {browsers.length === 0 && <p className="text-xs text-zinc-400">{'\u2014'}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
