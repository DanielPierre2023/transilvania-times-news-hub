'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  Eye, Users, Globe, Monitor, Smartphone, Tablet,
  Clock, TrendingUp, ExternalLink, RefreshCw, ArrowUpRight
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsRow {
  page_path: string
  referrer: string | null
  browser: string | null
  device_type: string | null
  country: string | null
  visitor_id: string | null
  created_at: string
}

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

function HorizBar({ items, maxItems = 10 }: { items: TableRow[]; maxItems?: number }) {
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
              className="h-full bg-red-600 rounded transition-all"
              style={{ width: `${(row.value / peak) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 w-12 text-right">
            {fmt(row.value)}
          </span>
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

// ─── Aggregation helpers ──────────────────────────────────────────────────────

function groupBy(rows: AnalyticsRow[], key: keyof AnalyticsRow): TableRow[] {
  const map = new Map<string, { count: number; uniques: Set<string> }>()
  for (const r of rows) {
    const k = String(r[key] || 'necunoscut')
    const entry = map.get(k) || { count: 0, uniques: new Set<string>() }
    entry.count++
    if (r.visitor_id) entry.uniques.add(r.visitor_id)
    map.set(k, entry)
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, value: v.count, extra: v.uniques.size }))
    .sort((a, b) => b.value - a.value)
}

function buildTimeSeries(rows: AnalyticsRow[], daysBack: number): DailyRow[] {
  const map = new Map<string, { views: number; uniques: Set<string> }>()
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    map.set(d.toISOString().substring(0, 10), { views: 0, uniques: new Set() })
  }
  for (const r of rows) {
    const key = r.created_at.substring(0, 10)
    const entry = map.get(key)
    if (entry) {
      entry.views++
      if (r.visitor_id) entry.uniques.add(r.visitor_id)
    }
  }
  return Array.from(map.entries())
    .map(([day, v]) => ({ day, views: v.views, uniques: v.uniques.size }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('7d')
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState<OverviewStats | null>(null)
  const [pages, setPages] = useState<TableRow[]>([])
  const [refs, setRefs] = useState<TableRow[]>([])
  const [countries, setCountries] = useState<TableRow[]>([])
  const [devices, setDevices] = useState<TableRow[]>([])
  const [browsers, setBrowsers] = useState<TableRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const load = useCallback(async () => {
    setLoading(true)
    const periodMs = period === '24h' ? 86400000 : period === '7d' ? 604800000 : 2592000000
    const since = new Date(Date.now() - periodMs).toISOString()

    // Fetch all rows for the period in one query
    const { data: rows } = await supabase
      .from('site_analytics')
      .select('page_path, referrer, browser, device_type, country, visitor_id, created_at')
      .eq('is_bot', false)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000)

    const data: AnalyticsRow[] = (rows || []) as AnalyticsRow[]

    // Also fetch 30-day window for overview cards
    const thirtyDaysAgo = new Date(Date.now() - 2592000000).toISOString()
    const { data: allRows } = await supabase
      .from('site_analytics')
      .select('visitor_id, created_at')
      .eq('is_bot', false)
      .gte('created_at', thirtyDaysAgo)
      .limit(10000)

    const all = (allRows || []) as { visitor_id: string | null; created_at: string }[]

    if (all.length > 0) {
      const now = Date.now()
      const h24 = all.filter(r => new Date(r.created_at).getTime() > now - 86400000)
      const d7 = all.filter(r => new Date(r.created_at).getTime() > now - 604800000)
      const m5 = all.filter(r => new Date(r.created_at).getTime() > now - 300000)
      setOverview({
        views_24h: h24.length,
        visitors_24h: new Set(h24.map(r => r.visitor_id).filter(Boolean)).size,
        views_7d: d7.length,
        visitors_7d: new Set(d7.map(r => r.visitor_id).filter(Boolean)).size,
        views_30d: all.length,
        visitors_30d: new Set(all.map(r => r.visitor_id).filter(Boolean)).size,
        live_5min: new Set(m5.map(r => r.visitor_id).filter(Boolean)).size,
      })
    } else {
      setOverview({
        views_24h: 0, visitors_24h: 0,
        views_7d: 0, visitors_7d: 0,
        views_30d: 0, visitors_30d: 0,
        live_5min: 0,
      })
    }

    // Aggregate for charts
    setPages(groupBy(data, 'page_path').slice(0, 15))
    setRefs(groupBy(data.filter(r => r.referrer), 'referrer').slice(0, 10))
    setCountries(groupBy(data.filter(r => r.country), 'country'))
    setDevices(groupBy(data.filter(r => r.device_type), 'device_type'))
    setBrowsers(groupBy(data.filter(r => r.browser), 'browser'))

    const daysBack = period === '24h' ? 1 : period === '7d' ? 7 : 30
    setDaily(buildTimeSeries(data, daysBack))

    setLoading(false)
  }, [period, supabase])

  useEffect(() => { load() }, [load])

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
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  p === period
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-white shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 text-zinc-500 hover:text-zinc-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card
            icon={Eye} label="Vizualizări"
            value={fmt(period === '24h' ? overview.views_24h : period === '7d' ? overview.views_7d : overview.views_30d)}
            sub={periodLabel[period]}
          />
          <Card
            icon={Users} label="Vizitatori unici"
            value={fmt(period === '24h' ? overview.visitors_24h : period === '7d' ? overview.visitors_7d : overview.visitors_30d)}
            sub={periodLabel[period]}
          />
          <Card
            icon={TrendingUp} label="Vizualizări / zi"
            value={fmt(Math.round((period === '24h' ? overview.views_24h : period === '7d' ? overview.views_7d / 7 : overview.views_30d / 30)))}
            sub="medie"
          />
          <Card
            icon={Clock} label="Acum online"
            value={String(overview.live_5min)}
            sub="ultimele 5 minute"
          />
        </div>
      )}

      {/* Time series */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
        <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4">Vizualizări pe zi</h2>
        <SimpleTimeSeries data={daily} />
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top pages */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4" /> Pagini populare
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {pages.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
                <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[70%] font-mono">
                  {p.label}
                </span>
                <div className="flex gap-3 text-right">
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(p.value)}</span>
                  {p.extra !== undefined && (
                    <span className="text-zinc-400">{fmt(p.extra)} unici</span>
                  )}
                </div>
              </div>
            ))}
            {pages.length === 0 && (
              <p className="text-xs text-zinc-400 text-center py-4">Nu există date.</p>
            )}
          </div>
        </div>

        {/* Traffic sources */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <ExternalLink className="w-4 h-4" /> Surse de trafic
          </h2>
          <HorizBar items={refs} />
        </div>

        {/* Geographic */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Geografie
          </h2>
          <HorizBar items={countries} />
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
              {devices.length === 0 && <p className="text-xs text-zinc-400">—</p>}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">Browsere</p>
              {browsers.map((b, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">{b.label}</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(b.value)}</span>
                </div>
              ))}
              {browsers.length === 0 && <p className="text-xs text-zinc-400">—</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
