'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Eye, Users, TrendingUp } from 'lucide-react'

interface Stats {
  views_24h: number
  visitors_24h: number
  views_7d: number
  visitors_7d: number
  views_30d: number
  visitors_30d: number
  views_total: number
  visitors_total: number
}

export default function TrafficStats() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    supabase.from('public_site_stats').select('*').single().then(({ data }) => {
      if (data) setStats(data as Stats)
    })
  }, [])

  if (!stats) return null

  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

  return (
    <div className="border border-foreground/10 p-4">
      <h3 className="font-sans text-[11px] font-bold uppercase tracking-widest text-foreground mb-3">
        Statistici Trafic
      </h3>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="flex items-center justify-center gap-1 text-brand-red mb-1">
            <Eye className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold font-serif text-foreground">{fmt(stats.views_7d)}</p>
          <p className="text-[11px] font-sans text-muted-foreground">vizualizări / 7 zile</p>
        </div>
        <div>
          <div className="flex items-center justify-center gap-1 text-brand-red mb-1">
            <Users className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold font-serif text-foreground">{fmt(stats.visitors_7d)}</p>
          <p className="text-[11px] font-sans text-muted-foreground">cititori unici / 7 zile</p>
        </div>
        <div>
          <div className="flex items-center justify-center gap-1 text-brand-red mb-1">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold font-serif text-foreground">{fmt(stats.views_total)}</p>
          <p className="text-[11px] font-sans text-muted-foreground">vizualizări total</p>
        </div>
      </div>
    </div>
  )
}
