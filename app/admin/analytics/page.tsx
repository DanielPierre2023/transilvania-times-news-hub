'use client'

import { useEffect, useState, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  Eye, Users, Globe, Monitor, Smartphone, Tablet,
  Clock, TrendingUp, ExternalLink, RefreshCw, ArrowUpRight
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewStats {
  views_24h: number; visitors_24h: number
  views_7d: number;  visitors_7d: number
  views_30d: number; visitors_30d: number
  live_5min: number
}

interface PageRow     { page_path: string; views: number; uniques: number }
interface RefRow      { referrer: string; views: number; uniques: number }
interface CountryRow  { country: string; views: number; uniques: number }
interface DeviceRow   { device_type: string; views: number }
interface BrowserRow  { browser: string; views: number }
interface DailyRow    { day: string; views: number; uniques: number }

type Period = '24h' | '7d' | '30d'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

const periodLabel: Record<Period, string> = { '24h': 'Ultimele 24h', '7d': 'Ultima săptămână', '30d': 'Ultima lună' }
const periodInterval: Record<Period, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }

function Card({ icon: Icon, label, value, sub }: { icon: typeof Eye; label: string; value: string; sub?: string }) {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarChart({ data, labelKey, valueKey, maxItems = 10 }: { data: any[]; labelKey: string; valueKey: string; maxItems?: number }) {
  const items = data.slice(0, maxItems)
  const max = Math.max(...items.map((d: any) => Number(d[valueKey]) || 0), 1)
  return (
    <div className="space-y-2">
      {items.map((row: any, i: number) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-xs text-zinc-600 dark:text-zinc-400 w-32 truncate text-right font-mono">
            {String(row[labelKey])}
          </span>
          <div className="flex-1 h-5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full bg-red-600 rounded transition-all"
              style={{ width: `${(Number(row[valueKey]) / max) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 w-12 text-right">
            {fmt(Number(row[valueKey]))}
          </span>
        </div>
      ))}
      {data.length === 0 && (
        <p className="text-xs text-zinc-400 text-center py-4">Nu există date pentru perioada selectată.</p>
      )}
    </div>
  )
}

function SimpleTimeSeries({ data }: { data: DailyRow[] }) {
  if (!data.length) return <p className="text-xs text-zinc-400 text-center py-8">Nu există date.</p>
  const max = Math.max(...data.map(d => d.views), 1)
  const barW = Math.max(4, Math.floor(600 / data.length) - 2)
  return (
    <div className="flex items-end gap-[2px] h-40 px-2">
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-0 group relative">
          <div
            className="w-full bg-red-600 rounded-t transition-all hover:bg-red-500 cursor-default"
            style={{ height: `${(d.views / max) * 100}%`, minHeight: d.views > 0 ? '2px' : '0' }}
            title={`${d.day}: ${d.views} views, ${d.uniques} unique`}
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
  const [pages, setPages] = useState<PageRow[]>([])
  const [refs, setRefs] = useState<RefRow[]>([])
  const [countries, setCountries] = useState<CountryRow[]>([])
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [browsers, setBrowsers] = useState<BrowserRow[]>([])
  const [daily, setDaily] = useState<DailyRow[]>([])

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - (
      period === '24h' ? 86400000 : period === '7d' ? 604800000 : 2592000000
    )).toISOString()

    // Overview counts
    const { data: allRows } = await supabase
      .from('site_analytics')
      .select('visitor_id, created_at')
      .eq('is_bot', false)
      .gte('created_at', new Date(Date.now() - 2592000000).toISOString())

    if (allRows) {
      const now = Date.now()
      const h24 = allRows.filter(r => new Date(r.created_at).getTime() > now - 86400000)
      const d7  = allRows.filter(r => new Date(r.created_at).getTime() > now - 604800000)
      const d30 = allRows
      const m5  = allRows.filter(r => new Date(r.created_at).getTime() > now - 300000)
      setOverview({
        views_24h:    h24.length,
        visitors_24h: new Set(h24.map(r => r.visitor_id)).size,
        views_7d:     d7.length,
        visitors_7d:  new Set(d7.map(r => r.visitor_id)).size,
        views_30d:    d30.length,
        visitors_30d: new Set(d30.map(r => r.visitor_id)).size,
        live_5min:    new Set(m5.map(r => r.visitor_id)).size,
      })
    }

    // Top pages
    const { data: pageData } = await supabase
      .from('site_analytics')
      .select('page_path, visitor_id')
      .eq('is_bot', false)
      .gte('created_at', since)

    if (pageData) {
      const map = new Map<string, { views: number; uniques: Set<string> }>()
      for (const r of pageData) {
        const e = map.get(r.page_path) || { views: 0, uniques: new Set<string>() }
        e.views++
        if (r.visitor_id) e.uniques.add(r.visitor_id)
        map.set(r.page_path, e)
      }
      setPages(
        Array.from(map.entries())
          .map(([page_path, v]) => ({ page_path, views: v.views, uniques: v.uniques.size }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 15)
      )
    }

    // Referrers
    const { data: refData } = await supabase
      .from('site_analytics')
      .select('referrer, visitor_id')
      .eq('is_bot', false)
      .not('referrer', 'is', null)
      .gte('created_at', since)

    if (refData) {
      const map = new Map<string, { views: number; uniques: Set<string> }>()
      for (const r of refData) {
        const key = r.referrer || 'direct'
        const e = map.get(key) || { views: 0, uniques: new Set<string>() }
        e.views++
        if (r.visitor_id) e.uniques.add(r.visitor_id)
        map.set(key, e)
      }
      setRefs(
        Array.from(map.entries())
          .map(([referrer, v]) => ({ referrer, views: v.views, uniques: v.uniques.size }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 10)
      )
    }

    // Countries
    const { data: geoData } = await supabase
      .from('site_analytics')
      .select('country, visitor_id')
      .eq('is_bot', false)
      .not('country', 'is', null)
      .gte('created_at', since)

    if (geoData) {
      const map = new Map<string, { views: number; uniques: Set<string> }>()
      for (const r of geoData) {
        const key = r.country || 'Unknown'
        const e = map.get(key) || { views: 0, uniques: new Set<string>() }
        e.views++
        if (r.visitor_id) e.uniques.add(r.visitor_id)
        map.set(key, e)
      }
      setCountries(
        Array.from(map.entries())
          .map(([country, v]) => ({ country, views: v.views, uniques: v.uniques.size }))
          .sort((a, b) => b.views - a.views)
      )
    }

    // Devices
    const { data: devData } = await supabase
      .from('site_analytics')
      .select('device_type')
      .eq('is_bot', false)
      .gte('created_at', since)

    if (devData) {
      const map = new Map<string, number>()
      for (const r of devData) { map.set(r.device_type || 'unknown', (map.get(r.device_type || 'unknown') || 0) + 1) }
      setDevices(Array.from(map.entries()).map(([device_type, views]) => ({ device_type, views })).sort((a, b) => b.views - a.views))
    }

    // Browsers
    const { data: brData } = await supabase
      .from('site_analytics')
      .select('browser')
      .eq('is_bot', false)
      .gte('created_at', since)

    if (brData) {
      const map = new Map<string, number>()
      for (const r of brData) { map.set(r.browser || 'Other', (map.get(r.browser || 'Other') || 0) + 1) }
      setBrowsers(Array.from(map.entries()).map(([browser, views]) => ({ browser, views })).sort((a, b) => b.views - a.views))
    }

    // Daily time series
    const daysBack = period === '24h' ? 1 : period === '7d' ? 7 : 30
    const { data: tsData } = await supabase
      .from('site_analytics')
      .select('created_at, visitor_id')
      .eq('is_bot', false)
      .gte('created_at', since)

    if (tsData) {
      const map = new Map<string, { views: number; uniques: Set<string> }>()
      // Pre-fill all days
      for (let i = daysBack - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000)
        const key = d.toISOString().substring(0, 10)
        map.set(key, { views: 0, uniques: new Set() })
      }
      for (const r of tsData) {
        const key = r.created_at.substring(0, 10)
        const e = map.get(key) || { views: 0, uniques: new Set<string>() }
        e.views++
        if (r.visitor_id) e.uniques.add(r.visitor_id)
        map.set(key, e)
      }
      setDaily(
        Array.from(map.entries())
          .map(([day, v]) => ({ day, views: v.views, uniques: v.uniques.size }))
          .sort((a, b) => a.day.localeCompare(b.day))
      )
    }

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
      <div className="flex items-center justify-between">
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
                  {p.page_path}
                </span>
                <div className="flex gap-3 text-right">
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(p.views)}</span>
                  <span className="text-zinc-400">{fmt(p.uniques)} unici</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Traffic sources */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <ExternalLink className="w-4 h-4" /> Surse de trafic
          </h2>
          <BarChart data={refs} labelKey="referrer" valueKey="views" />
        </div>

        {/* Geographic */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Geografie
          </h2>
          <BarChart data={countries} labelKey="country" valueKey="views" />
        </div>

        {/* Devices & Browsers */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h2 className="text-sm font-bold text-zinc-700 dark:text-zinc-300 mb-4 flex items-center gap-2">
            <Monitor className="w-4 h-4" /> Dispozitive & Browsere
          </h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">Dispozitive</p>
              {devices.map((d, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                    <DevIcon type={d.device_type} /> {d.device_type}
                  </span>
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(d.views)}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">Browsere</p>
              {browsers.map((b, i) => (
                <div key={i} className="flex items-center justify-between py-1 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">{b.browser}</span>
                  <span className="font-bold text-zinc-900 dark:text-white">{fmt(b.views)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
