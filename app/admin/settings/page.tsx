'use client'

// app/admin/settings/page.tsx
//
// Real settings page bound to the database. Replaces the previous version
// which wrote to localStorage and did nothing to the actual pipeline.
//
// What this page controls (table: public.automation_settings, id = 1):
//   scraper_enabled   — gates the twice-daily RSS scraper cron
//   processor_enabled — gates the twice-daily article processing cron
//   auto_publish     — when true, processed articles insert as 'published';
//                      when false, they insert as 'draft' for manual review
//
// The cron job (tt-process-scraped-twice-daily) reads these three flags on
// every invocation. Flipping them here takes effect on the very next tick.
// No deploy required — they are runtime configuration.

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Save, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

interface AutomationSettings {
  scraper_enabled: boolean
  processor_enabled: boolean
  auto_publish: boolean
  updated_at: string | null
}

interface PipelineSnapshot {
  scraped_pending: number
  scraped_rewriting: number
  scraped_processed: number
  posts_published: number
  posts_draft: number
  last_publish: string | null
}

export default function SettingsPage() {
  // ── General (static, informational) ───────────────────────────────────
  const [siteName] = useState('Transilvania Times')
  const [siteUrl]  = useState('https://transilvaniatimes.com')

  // ── Automation toggles bound to DB ────────────────────────────────────
  const [scraperEnabled,   setScraperEnabled]   = useState(false)
  const [processorEnabled, setProcessorEnabled] = useState(false)
  const [autoPublish,      setAutoPublish]      = useState(false)
  const [lastUpdated,      setLastUpdated]      = useState<string | null>(null)

  // ── UI state ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [msg,     setMsg]     = useState<string | null>(null)

  // ── Pipeline snapshot (read-only context) ─────────────────────────────
  const [snap, setSnap] = useState<PipelineSnapshot | null>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ── Load settings + snapshot on mount ─────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: settings, error: sErr } = await supabase
          .from('automation_settings')
          .select('scraper_enabled, processor_enabled, auto_publish, updated_at')
          .eq('id', 1)
          .maybeSingle<AutomationSettings>()

        if (sErr) throw sErr
        if (cancelled) return

        if (settings) {
          setScraperEnabled(settings.scraper_enabled)
          setProcessorEnabled(settings.processor_enabled)
          setAutoPublish(settings.auto_publish)
          setLastUpdated(settings.updated_at)
        }

        // Pipeline snapshot — informational only
        const [scrapedCounts, postCounts] = await Promise.all([
          supabase
            .from('scraped_articles')
            .select('status', { count: 'exact', head: false }),
          supabase
            .from('blog_posts')
            .select('status, published_at', { count: 'exact', head: false }),
        ])

        if (cancelled) return

        const scrapedRows = (scrapedCounts.data || []) as { status: string }[]
        const postRows    = (postCounts.data    || []) as { status: string; published_at: string | null }[]

        const lastPublish = postRows
          .filter(p => p.status === 'published' && p.published_at)
          .map(p => p.published_at!)
          .sort()
          .reverse()[0] || null

        setSnap({
          scraped_pending:    scrapedRows.filter(r => r.status === 'scraped').length,
          scraped_rewriting:  scrapedRows.filter(r => r.status === 'rewriting').length,
          scraped_processed:  scrapedRows.filter(r => r.status === 'processed').length,
          posts_published:    postRows.filter(p => p.status === 'published').length,
          posts_draft:        postRows.filter(p => p.status === 'draft').length,
          last_publish:       lastPublish,
        })
      } catch (e) {
        if (!cancelled) setError(`Eroare la încărcare: ${(e as Error).message}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
    // supabase is stable across renders for this provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Save: write the three flags to automation_settings.id = 1 ─────────
  async function save() {
    setSaving(true)
    setError(null)
    setMsg(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const { data, error: uErr } = await supabase
        .from('automation_settings')
        .update({
          scraper_enabled:   scraperEnabled,
          processor_enabled: processorEnabled,
          auto_publish:      autoPublish,
          updated_at:        new Date().toISOString(),
          updated_by:        user?.id ?? null,
        })
        .eq('id', 1)
        .select('updated_at')
        .maybeSingle<{ updated_at: string }>()

      if (uErr) throw uErr
      if (data?.updated_at) setLastUpdated(data.updated_at)
      setMsg('✓ Setări salvate. Următoarea rulare cron va folosi noile valori.')
      setTimeout(() => setMsg(null), 5000)
    } catch (e) {
      setError(`Eroare la salvare: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Format helpers ────────────────────────────────────────────────────
  function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString('ro-RO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // ── Styled primitives ─────────────────────────────────────────────────
  const inputCls = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors"
  const readonly = "opacity-60 cursor-not-allowed"

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-[#1a1a1a] border border-white/[0.07] p-6 space-y-4">
      <h2 className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">{title}</h2>
      {children}
    </div>
  )

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block font-sans text-[12px] text-white/50 mb-1.5">{label}</label>
      {children}
    </div>
  )

  // ── Toggle component used three times ─────────────────────────────────
  const Toggle = ({
    id, checked, onChange, title, description, dangerWhenOn,
  }: {
    id: string
    checked: boolean
    onChange: (v: boolean) => void
    title: string
    description: string
    dangerWhenOn?: boolean
  }) => (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer py-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={loading || saving}
        onChange={e => onChange(e.target.checked)}
        className="accent-brand-red w-4 h-4 mt-0.5 shrink-0"
      />
      <div className="flex-1">
        <p className="font-sans text-[13px] text-white flex items-center gap-2">
          {title}
          {checked && (
            <span className={`font-sans text-[10px] uppercase tracking-wider px-1.5 py-0.5 ${dangerWhenOn ? 'bg-amber-500/20 text-amber-300' : 'bg-green-500/20 text-green-300'}`}>
              {dangerWhenOn ? 'Activ — atenție' : 'Activ'}
            </span>
          )}
        </p>
        <p className="font-sans text-[11px] text-white/40 mt-1 leading-relaxed">{description}</p>
      </div>
    </label>
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl font-bold text-white">Setări</h1>
        <div className="flex items-center gap-3">
          {msg   && <span className="font-sans text-[12px] text-green-400">{msg}</span>}
          {error && <span className="font-sans text-[12px] text-red-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />{error}</span>}
          <button
            onClick={save}
            disabled={loading || saving}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Salvez...' : 'Salvează'}
          </button>
        </div>
      </div>

      <Section title="General">
        <Field label="Numele site-ului">
          <input className={`${inputCls} ${readonly}`} value={siteName} readOnly />
        </Field>
        <Field label="URL site">
          <input className={`${inputCls} ${readonly}`} value={siteUrl} readOnly />
        </Field>
      </Section>

      <Section title="Automatizare pipeline">
        {loading ? (
          <div className="flex items-center gap-2 font-sans text-[12px] text-white/40 py-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Se încarcă valorile actuale din baza de date...
          </div>
        ) : (
          <>
            <Toggle
              id="scraper"
              checked={scraperEnabled}
              onChange={setScraperEnabled}
              title="Scraper RSS activ"
              description="Cron-ul de la 06:00 și 18:00 UTC scanează feed-urile RSS și adaugă articole noi în coadă. Dezactivat = coada nu primește articole noi automate (poți încă scrapa manual)."
            />
            <Toggle
              id="processor"
              checked={processorEnabled}
              onChange={setProcessorEnabled}
              title="Procesor articole activ"
              description="Cron-ul de la 06:30 și 18:30 UTC procesează articolele din coadă prin pipeline-ul AI (Desk 1 → 2A → 2B → 3) și le scrie în blog_posts. Dezactivat = articolele rămân în coadă până le procesezi manual din admin."
            />
            <Toggle
              id="publish"
              checked={autoPublish}
              onChange={setAutoPublish}
              dangerWhenOn
              title="Auto-publicare articole procesate"
              description="Când activ: articolele procesate automat de cron se salvează cu status='published' și apar imediat pe site. Când inactiv: se salvează ca 'draft' pentru verificare manuală. Procesarea manuală din admin produce întotdeauna draft, indiferent de acest comutator."
            />

            <div className="mt-4 pt-4 border-t border-white/[0.07] flex items-center gap-2 font-sans text-[11px] text-white/30">
              <CheckCircle2 className="w-3 h-3" />
              <span>Ultima modificare: <span className="text-white/50">{fmtTime(lastUpdated)}</span></span>
            </div>
          </>
        )}
      </Section>

      <Section title="Stare pipeline (live)">
        {snap === null ? (
          <div className="font-sans text-[12px] text-white/40">Se calculează...</div>
        ) : (
          <div className="space-y-2 font-sans text-[12px]">
            <div className="flex justify-between">
              <span className="text-white/40">Articole în coadă</span>
              <span className="text-white/80 font-mono">{snap.scraped_pending}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">În curs de procesare</span>
              <span className="text-white/80 font-mono">{snap.scraped_rewriting}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Procesate (consumate)</span>
              <span className="text-white/80 font-mono">{snap.scraped_processed}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-white/[0.07]">
              <span className="text-white/40">Articole publicate pe site</span>
              <span className="text-white/80 font-mono">{snap.posts_published}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Articole draft (neverificate)</span>
              <span className="text-white/80 font-mono">{snap.posts_draft}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-white/40">Ultima publicare</span>
              <span className="text-white/60">{fmtTime(snap.last_publish)}</span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Informații sistem">
        <div className="space-y-2 font-sans text-[12px]">
          <div className="flex justify-between">
            <span className="text-white/40">Supabase Project</span>
            <span className="text-white/60 font-mono">zimpimoierpsocnmnizm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Netlify Site</span>
            <span className="text-white/60 font-mono">bespoke-unicorn-cefa67</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Next.js</span>
            <span className="text-white/60">15.5.14</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/40">Funcții Supabase</span>
            <span className="text-white/60">26 active</span>
          </div>
        </div>
      </Section>
    </div>
  )
}
