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
import { Save, AlertCircle, CheckCircle2, Loader2, Key, Copy, CheckCircle, XCircle, Plus, Trash2, ExternalLink } from 'lucide-react'

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

interface TokenRow {
  id: string; token: string; editor_key: string; label: string
  active: boolean; created_at: string; expires_at: string | null; last_used_at: string | null
  author_name?: string
}

interface Author {
  id: string; editor_key: string; name_ro: string
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

  // ── Editor tokens ─────────────────────────────────────────────────────
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [tokenAuthors, setTokenAuthors] = useState<Author[]>([])
  const [newEditorKey, setNewEditorKey] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [creatingToken, setCreatingToken] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

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

        // Load editor tokens + authors
        const [{ data: tData }, { data: aData }] = await Promise.all([
          supabase.from('editor_tokens').select('*').order('created_at', { ascending: false }),
          supabase.from('authors').select('id, editor_key, name_ro').eq('active', true).order('name_ro'),
        ])
        if (cancelled) return
        const authorMap = new Map((aData || []).map((a: Author) => [a.editor_key, a]))
        setTokens((tData || []).map((t: TokenRow) => ({ ...t, author_name: authorMap.get(t.editor_key)?.name_ro || t.editor_key })))
        setTokenAuthors(aData as Author[] || [])
        if (aData?.length && !newEditorKey) setNewEditorKey((aData as Author[])[0].editor_key)
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

  // ── Token management ───────────────────────────────────────────────────
  const editorSiteUrl = typeof window !== 'undefined' ? window.location.origin : 'https://transilvaniatimes.com'

  async function loadTokens() {
    const [{ data: tData }, { data: aData }] = await Promise.all([
      supabase.from('editor_tokens').select('*').order('created_at', { ascending: false }),
      supabase.from('authors').select('id, editor_key, name_ro').eq('active', true).order('name_ro'),
    ])
    const authorMap = new Map((aData || []).map((a: Author) => [a.editor_key, a]))
    setTokens((tData || []).map((t: TokenRow) => ({ ...t, author_name: authorMap.get(t.editor_key)?.name_ro || t.editor_key })))
    setTokenAuthors(aData as Author[] || [])
  }

  async function createToken() {
    if (!newEditorKey) return
    setCreatingToken(true); setError(null)
    const author = tokenAuthors.find(a => a.editor_key === newEditorKey)
    if (!author) { setError('Autor invalid.'); setCreatingToken(false); return }
    const { error: insertErr } = await supabase.from('editor_tokens').insert({
      author_id: author.id, editor_key: newEditorKey,
      label: newLabel || `Link editor ${author.name_ro}`,
    })
    if (insertErr) { setError(insertErr.message); setCreatingToken(false); return }
    setMsg('✓ Token creat.'); setNewLabel('')
    setTimeout(() => setMsg(null), 3000)
    setCreatingToken(false); loadTokens()
  }

  async function toggleToken(id: string, active: boolean) {
    await supabase.from('editor_tokens').update({ active }).eq('id', id); loadTokens()
  }

  async function deleteToken(id: string) {
    if (!confirm('Ștergi permanent acest token?')) return
    await supabase.from('editor_tokens').delete().eq('id', id); loadTokens()
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${editorSiteUrl}/editor/${token}`)
    setCopied(token); setTimeout(() => setCopied(null), 2000)
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

      <Section title="Tokenuri editor (linkuri partajabile)">
        {/* Create new token */}
        <div className="space-y-3 pb-4 border-b border-white/[0.07]">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block font-sans text-[12px] text-white/50 mb-1.5">Editor</label>
              <select value={newEditorKey} onChange={e => setNewEditorKey(e.target.value)}
                className={inputCls}>
                {tokenAuthors.map(a => <option key={a.editor_key} value={a.editor_key}>{a.name_ro}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block font-sans text-[12px] text-white/50 mb-1.5">Etichetă (opțional)</label>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                placeholder="ex: Link personal Anamaria" className={inputCls} />
            </div>
            <button onClick={createToken} disabled={creatingToken || !newEditorKey}
              className="flex items-center gap-2 font-sans text-[11px] px-4 py-2.5 bg-brand-red text-white hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap">
              {creatingToken ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Generează token
            </button>
          </div>
        </div>

        {/* Token list */}
        <div className="space-y-2 pt-2">
          <p className="font-sans text-[11px] text-white/30">
            {tokens.filter(t => t.active).length} active / {tokens.length} total
          </p>
          {tokens.length === 0 && (
            <p className="font-sans text-[12px] text-white/30 py-4 text-center">Niciun token creat.</p>
          )}
          {tokens.map(t => (
            <div key={t.id} className={`border p-3 space-y-1 ${t.active ? 'border-white/10' : 'border-white/5 opacity-40'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-sans text-[13px] text-white font-bold">{t.author_name}</span>
                  <span className={`font-sans text-[9px] uppercase tracking-wider px-1.5 py-0.5 ${t.active ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                    {t.active ? 'Activ' : 'Revocat'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => copyLink(t.token)} title="Copiază link"
                    className="p-1.5 text-white/40 hover:text-white transition-colors">
                    {copied === t.token ? <CheckCircle className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <a href={`${editorSiteUrl}/editor/${t.token}`} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 text-white/40 hover:text-white transition-colors" title="Deschide link">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button onClick={() => toggleToken(t.id, !t.active)} title={t.active ? 'Revocă' : 'Reactivează'}
                    className={`p-1.5 transition-colors ${t.active ? 'text-amber-400 hover:text-amber-300' : 'text-green-400 hover:text-green-300'}`}>
                    {t.active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => deleteToken(t.id)} title="Șterge"
                    className="p-1.5 text-red-400/60 hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="font-sans text-[11px] text-white/30">{t.label}</p>
              <div className="flex gap-4 font-sans text-[10px] text-white/20">
                <span>Creat: {fmtTime(t.created_at)}</span>
                {t.last_used_at && <span>Ultima utilizare: {fmtTime(t.last_used_at)}</span>}
                {t.expires_at && <span>Expiră: {fmtTime(t.expires_at)}</span>}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
