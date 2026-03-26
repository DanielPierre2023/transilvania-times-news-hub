'use client'

import { useState, useEffect, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import {
  Plus, Edit2, Trash2, Eye, EyeOff, Send,
  BarChart2, CheckCircle, XCircle, Loader2, X, Save,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────
interface Banner {
  id: string
  advertiser_name: string
  contact_email: string | null
  headline_ro: string; headline_en: string
  body_ro: string; body_en: string
  cta_ro: string; cta_en: string
  url: string
  image_url: string | null
  bg_color: string; accent_color: string
  slot: string; weight: number
  is_active: boolean
  start_date: string | null; end_date: string | null
  impressions: number; clicks: number
  created_at: string
}

interface Pricing {
  id: string; slot: string
  label_ro: string; label_en: string; format: string
  weekly_eur: number; monthly_eur: number; yearly_eur: number
}

const SLOTS = [
  { value: 'sidebar-homepage',     label: 'Sidebar Homepage (300×250)' },
  { value: 'sidebar-article',      label: 'Sidebar Article (300×600)' },
  { value: 'leaderboard-category', label: 'Leaderboard Category (728×90)' },
  { value: 'infeed-homepage',      label: 'In-feed Homepage (600×300)' },
  { value: 'advertorial',          label: 'Advertorial (articol complet)' },
]

const EMPTY_BANNER: Omit<Banner, 'id' | 'impressions' | 'clicks' | 'created_at'> = {
  advertiser_name: '', contact_email: '',
  headline_ro: '', headline_en: '', body_ro: '', body_en: '',
  cta_ro: 'Descoperă →', cta_en: 'Discover →',
  url: '', image_url: null,
  bg_color: '#0D1B4B', accent_color: '#F0A500',
  slot: 'sidebar-homepage', weight: 1,
  is_active: true, start_date: null, end_date: null,
}

const inp  = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
const lbl  = "block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5"

type Tab = 'banners' | 'pricing' | 'mediakit' | 'inquiries'

// ── Main component ─────────────────────────────────────────────────────────
export default function SponsorsPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [tab,         setTab]         = useState<Tab>('banners')
  const [banners,     setBanners]     = useState<Banner[]>([])
  const [pricing,     setPricing]     = useState<Pricing[]>([])
  const [inquiries,   setInquiries]   = useState<{id:string;recipient_name:string;recipient_email:string;language:string;slots_offered:string|null;sent_at:string}[]>([])
  const [loading,     setLoading]     = useState(false)
  const [toast,       setToast]       = useState<{msg:string;type:'ok'|'err'}|null>(null)
  const [editBanner,  setEditBanner]  = useState<Partial<Banner> | null>(null)
  const [isNew,       setIsNew]       = useState(false)
  const [saving,      setSaving]      = useState(false)
  // Media kit form
  const [mkName,      setMkName]      = useState('')
  const [mkEmail,     setMkEmail]     = useState('')
  const [mkLang,      setMkLang]      = useState<'ro'|'en'>('ro')
  const [mkSlots,     setMkSlots]     = useState('all')
  const [mkSending,   setMkSending]   = useState(false)

  const flash = (msg: string, type: 'ok'|'err' = 'ok') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4500)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: b }, { data: p }, { data: i }] = await Promise.all([
      supabase.from('sponsor_banners').select('*').order('created_at', { ascending: false }),
      supabase.from('ad_pricing').select('*').order('yearly_eur', { ascending: false }),
      supabase.from('ad_inquiries').select('*').order('sent_at', { ascending: false }).limit(50),
    ])
    setBanners((b ?? []) as Banner[])
    setPricing((p ?? []) as Pricing[])
    setInquiries(i ?? [])
    setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Banner CRUD ───────────────────────────────────────────────────────────
  const openNew = () => { setEditBanner({ ...EMPTY_BANNER }); setIsNew(true) }
  const openEdit = (b: Banner) => { setEditBanner({ ...b }); setIsNew(false) }
  const closeEdit = () => { setEditBanner(null) }

  const saveBanner = async () => {
    if (!editBanner) return
    setSaving(true)
    const payload = { ...editBanner }
    delete (payload as {id?: string}).id
    delete (payload as {impressions?: number}).impressions
    delete (payload as {clicks?: number}).clicks
    delete (payload as {created_at?: string}).created_at

    if (isNew) {
      const { error } = await supabase.from('sponsor_banners').insert(payload)
      if (error) { flash(`Eroare: ${error.message}`, 'err'); setSaving(false); return }
    } else {
      const { error } = await supabase.from('sponsor_banners').update(payload).eq('id', editBanner.id!)
      if (error) { flash(`Eroare: ${error.message}`, 'err'); setSaving(false); return }
    }
    flash(isNew ? '✓ Banner creat' : '✓ Banner actualizat')
    closeEdit()
    await fetchAll()
    setSaving(false)
  }

  const toggleActive = async (b: Banner) => {
    await supabase.from('sponsor_banners').update({ is_active: !b.is_active }).eq('id', b.id)
    await fetchAll()
  }

  const deleteBanner = async (id: string) => {
    if (!confirm('Ștergi acest banner? Acțiunea este ireversibilă.')) return
    await supabase.from('sponsor_banners').delete().eq('id', id)
    flash('✓ Banner șters')
    await fetchAll()
  }

  // ── Pricing update ────────────────────────────────────────────────────────
  const updatePrice = async (p: Pricing) => {
    const { error } = await supabase.from('ad_pricing').update({
      weekly_eur: p.weekly_eur, monthly_eur: p.monthly_eur, yearly_eur: p.yearly_eur,
    }).eq('id', p.id)
    if (error) { flash(`Eroare: ${error.message}`, 'err'); return }
    flash('✓ Tarife actualizate')
  }

  // ── Send media kit ────────────────────────────────────────────────────────
  const sendMediaKit = async () => {
    if (!mkName.trim() || !mkEmail.trim()) { flash('Completați numele și emailul', 'err'); return }
    setMkSending(true)
    try {
      const res = await fetch('/api/advertising/send-mediakit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientName: mkName, recipientEmail: mkEmail, language: mkLang, slotsOffered: mkSlots }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Eroare')
      flash(`✓ Media Kit trimis către ${mkEmail}`)
      setMkName(''); setMkEmail(''); setMkSlots('all')
      await fetchAll()
    } catch (err) {
      flash(`Eroare: ${err instanceof Error ? err.message : String(err)}`, 'err')
    } finally {
      setMkSending(false)
    }
  }

  const ctr = (b: Banner) => b.impressions > 0 ? ((b.clicks / b.impressions) * 100).toFixed(2) + '%' : '—'
  const slotLabel = (s: string) => SLOTS.find(x => x.value === s)?.label || s

  return (
    <div className="max-w-6xl">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'ok' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Publicitate & Sponsori</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">
            {banners.filter(b => b.is_active).length} bannere active · {banners.length} total
          </p>
        </div>
        {tab === 'banners' && (
          <button onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors">
            <Plus className="w-4 h-4" /> Banner Nou
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/[0.07] mb-6">
        {([['banners','Bannere'], ['pricing','Tarife'], ['mediakit','Media Kit'], ['inquiries','Solicitări']] as [Tab,string][]).map(([t, l]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 font-sans text-[12px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
              tab === t ? 'border-brand-red text-brand-red' : 'border-transparent text-white/40 hover:text-white'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* ── BANNERS TAB ── */}
      {tab === 'banners' && (
        <div className="space-y-3">
          {loading && <div className="text-white/30 text-sm py-8 text-center">Se încarcă...</div>}
          {!loading && banners.length === 0 && (
            <div className="text-center py-16 text-white/20">
              <p className="text-sm">Niciun banner configurat. Adaugă primul sponsor.</p>
            </div>
          )}
          {banners.map(b => (
            <div key={b.id} className={`bg-[#1a1a1a] border p-4 flex items-start gap-4 ${b.is_active ? 'border-white/[0.07]' : 'border-white/[0.03] opacity-50'}`}>
              {/* Colour swatch */}
              <div className="w-10 h-10 shrink-0 flex items-center justify-center text-sm font-bold rounded"
                style={{ background: b.bg_color, color: b.accent_color }}>
                {b.advertiser_name.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-sans font-bold text-sm text-white">{b.advertiser_name}</span>
                  <span className="text-[10px] font-sans px-2 py-0.5 bg-white/10 text-white/60">{slotLabel(b.slot)}</span>
                  {b.is_active
                    ? <span className="text-[10px] font-sans text-emerald-400">● Activ</span>
                    : <span className="text-[10px] font-sans text-white/30">● Inactiv</span>}
                </div>
                <p className="font-sans text-xs text-white/50 truncate">{b.headline_ro}</p>
                {b.contact_email && (
                  <p className="font-sans text-[11px] text-white/30 mt-0.5">{b.contact_email}</p>
                )}
                <div className="flex items-center gap-4 mt-2">
                  <span className="font-sans text-[11px] text-white/40 flex items-center gap-1">
                    <BarChart2 className="w-3 h-3" /> {b.impressions.toLocaleString()} imp · {b.clicks.toLocaleString()} clicks · CTR {ctr(b)}
                  </span>
                  {(b.start_date || b.end_date) && (
                    <span className="font-sans text-[11px] text-white/30">
                      {b.start_date || '∞'} → {b.end_date || '∞'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => toggleActive(b)} title={b.is_active ? 'Dezactivează' : 'Activează'}
                  className="p-2 text-white/30 hover:text-white transition-colors">
                  {b.is_active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={() => openEdit(b)} className="p-2 text-white/30 hover:text-white transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => deleteBanner(b.id)} className="p-2 text-white/30 hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── PRICING TAB ── */}
      {tab === 'pricing' && (
        <div className="space-y-3">
          <p className="font-sans text-[13px] text-white/50 mb-4">
            Modificați tarifele de mai jos. Acestea vor fi preluate automat în emailurile Media Kit trimise.
          </p>
          {pricing.map(p => (
            <div key={p.id} className="bg-[#1a1a1a] border border-white/[0.07] p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-sans font-bold text-sm text-white">{p.label_ro}</p>
                  <p className="font-sans text-[11px] text-white/40">{p.format}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Săptămânal (EUR)</label>
                  <input type="number" min="0" step="1" className={inp}
                    value={p.weekly_eur}
                    onChange={e => setPricing(prev => prev.map(x => x.id === p.id ? { ...x, weekly_eur: parseFloat(e.target.value) || 0 } : x))}
                  />
                </div>
                <div>
                  <label className={lbl}>Lunar (EUR)</label>
                  <input type="number" min="0" step="1" className={inp}
                    value={p.monthly_eur}
                    onChange={e => setPricing(prev => prev.map(x => x.id === p.id ? { ...x, monthly_eur: parseFloat(e.target.value) || 0 } : x))}
                  />
                </div>
                <div>
                  <label className={lbl}>Anual (EUR)</label>
                  <input type="number" min="0" step="1" className={inp}
                    value={p.yearly_eur}
                    onChange={e => setPricing(prev => prev.map(x => x.id === p.id ? { ...x, yearly_eur: parseFloat(e.target.value) || 0 } : x))}
                  />
                </div>
              </div>
              <button onClick={() => updatePrice(p)}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-brand-red text-white font-sans text-[11px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors">
                <Save className="w-3.5 h-3.5" /> Salvează tarifele
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── MEDIA KIT TAB ── */}
      {tab === 'mediakit' && (
        <div className="max-w-xl">
          <p className="font-sans text-[13px] text-white/50 mb-6">
            Trimiteți un email Media Kit profesional unui potențial advertiser. Emailul va conține tarifele curente, specificațiile tehnice și toate informațiile necesare.
          </p>
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-6 space-y-4">
            <div>
              <label className={lbl}>Nume destinatar *</label>
              <input className={inp} value={mkName} onChange={e => setMkName(e.target.value)} placeholder="Ion Popescu / SC Firma SRL" />
            </div>
            <div>
              <label className={lbl}>Email destinatar *</label>
              <input className={inp} type="email" value={mkEmail} onChange={e => setMkEmail(e.target.value)} placeholder="contact@firma.ro" />
            </div>
            <div>
              <label className={lbl}>Limba emailului</label>
              <div className="flex gap-2">
                {(['ro','en'] as const).map(l => (
                  <button key={l} onClick={() => setMkLang(l)}
                    className={`flex-1 py-2.5 font-sans text-[11px] font-bold uppercase tracking-wider transition-colors ${
                      mkLang === l ? 'bg-brand-red text-white' : 'bg-[#111] border border-white/10 text-white/40 hover:text-white'
                    }`}>
                    {l === 'ro' ? '🇷🇴 Română' : '🇬🇧 English'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={lbl}>Slot-uri oferite (informativ)</label>
              <input className={inp} value={mkSlots} onChange={e => setMkSlots(e.target.value)} placeholder="Toate / sidebar-homepage / sidebar-article" />
              <p className="font-sans text-[10px] text-white/20 mt-1">Doar pentru referința internă — nu apare în email.</p>
            </div>
            <button onClick={sendMediaKit} disabled={mkSending || !mkName.trim() || !mkEmail.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-50">
              {mkSending ? <><Loader2 className="w-4 h-4 animate-spin" /> Se trimite...</> : <><Send className="w-4 h-4" /> Trimite Media Kit</>}
            </button>
          </div>
        </div>
      )}

      {/* ── INQUIRIES TAB ── */}
      {tab === 'inquiries' && (
        <div className="space-y-2">
          {inquiries.length === 0 && (
            <div className="text-center py-16 text-white/20 text-sm">Nicio solicitare trimisă încă.</div>
          )}
          {inquiries.map(i => (
            <div key={i.id} className="bg-[#1a1a1a] border border-white/[0.07] p-4 flex items-center justify-between">
              <div>
                <p className="font-sans text-sm font-bold text-white">{i.recipient_name}</p>
                <p className="font-sans text-xs text-white/50">{i.recipient_email} · {i.language.toUpperCase()} · {i.slots_offered || 'all'}</p>
              </div>
              <span className="font-sans text-[11px] text-white/30">
                {new Date(i.sent_at).toLocaleString('ro-RO')}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── EDIT/NEW BANNER MODAL ── */}
      {editBanner && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center p-6 overflow-y-auto">
          <div className="bg-[#0d0d0d] border border-white/10 w-full max-w-2xl mt-8 mb-8">
            <div className="flex items-center justify-between p-5 border-b border-white/[0.07]">
              <h2 className="font-serif text-xl font-bold text-white">
                {isNew ? 'Banner nou' : 'Editează banner'}
              </h2>
              <button onClick={closeEdit} className="text-white/30 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Advertiser info */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Advertiser *</label>
                  <input className={inp} value={editBanner.advertiser_name || ''} onChange={e => setEditBanner(p => ({ ...p!, advertiser_name: e.target.value }))} placeholder="Numele companiei" />
                </div>
                <div>
                  <label className={lbl}>Email contact</label>
                  <input className={inp} value={editBanner.contact_email || ''} onChange={e => setEditBanner(p => ({ ...p!, contact_email: e.target.value }))} placeholder="contact@advertiser.ro" />
                </div>
              </div>

              {/* Slot + weight */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Slot *</label>
                  <select className={inp} value={editBanner.slot || 'sidebar-homepage'} onChange={e => setEditBanner(p => ({ ...p!, slot: e.target.value }))}>
                    {SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Greutate rotație (1-10)</label>
                  <input type="number" min="1" max="10" className={inp} value={editBanner.weight || 1} onChange={e => setEditBanner(p => ({ ...p!, weight: parseInt(e.target.value) || 1 }))} />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Data start</label>
                  <input type="date" className={inp} value={editBanner.start_date || ''} onChange={e => setEditBanner(p => ({ ...p!, start_date: e.target.value || null }))} />
                </div>
                <div>
                  <label className={lbl}>Data end</label>
                  <input type="date" className={inp} value={editBanner.end_date || ''} onChange={e => setEditBanner(p => ({ ...p!, end_date: e.target.value || null }))} />
                </div>
              </div>

              {/* URL */}
              <div>
                <label className={lbl}>URL destinație *</label>
                <input className={inp} value={editBanner.url || ''} onChange={e => setEditBanner(p => ({ ...p!, url: e.target.value }))} placeholder="https://advertiser.ro/campanie" />
              </div>

              {/* Image or CSS */}
              <div>
                <label className={lbl}>URL imagine (opțional — altfel se folosesc culorile CSS)</label>
                <input className={inp} value={editBanner.image_url || ''} onChange={e => setEditBanner(p => ({ ...p!, image_url: e.target.value || null }))} placeholder="https://... sau lasă gol pentru banner CSS" />
              </div>

              {/* CSS colours */}
              {!editBanner.image_url && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Culoare fundal</label>
                    <div className="flex gap-2">
                      <input type="color" value={editBanner.bg_color || '#0D1B4B'} onChange={e => setEditBanner(p => ({ ...p!, bg_color: e.target.value }))} className="w-10 h-10 border border-white/10 bg-transparent cursor-pointer" />
                      <input className={inp + ' flex-1'} value={editBanner.bg_color || '#0D1B4B'} onChange={e => setEditBanner(p => ({ ...p!, bg_color: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className={lbl}>Culoare accent</label>
                    <div className="flex gap-2">
                      <input type="color" value={editBanner.accent_color || '#F0A500'} onChange={e => setEditBanner(p => ({ ...p!, accent_color: e.target.value }))} className="w-10 h-10 border border-white/10 bg-transparent cursor-pointer" />
                      <input className={inp + ' flex-1'} value={editBanner.accent_color || '#F0A500'} onChange={e => setEditBanner(p => ({ ...p!, accent_color: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}

              {/* Content RO */}
              <div className="border border-white/[0.07] p-4 space-y-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-white/40">Conținut Română</p>
                <div>
                  <label className={lbl}>Titlu RO *</label>
                  <input className={inp} value={editBanner.headline_ro || ''} onChange={e => setEditBanner(p => ({ ...p!, headline_ro: e.target.value }))} placeholder="Titlul reclamei în română" />
                </div>
                <div>
                  <label className={lbl}>Descriere RO *</label>
                  <textarea rows={2} className={inp + ' resize-none'} value={editBanner.body_ro || ''} onChange={e => setEditBanner(p => ({ ...p!, body_ro: e.target.value }))} placeholder="Descriere scurtă..." />
                </div>
                <div>
                  <label className={lbl}>CTA RO</label>
                  <input className={inp} value={editBanner.cta_ro || 'Descoperă →'} onChange={e => setEditBanner(p => ({ ...p!, cta_ro: e.target.value }))} />
                </div>
              </div>

              {/* Content EN */}
              <div className="border border-white/[0.07] p-4 space-y-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-white/40">Conținut English</p>
                <div>
                  <label className={lbl}>Headline EN *</label>
                  <input className={inp} value={editBanner.headline_en || ''} onChange={e => setEditBanner(p => ({ ...p!, headline_en: e.target.value }))} placeholder="Ad headline in English" />
                </div>
                <div>
                  <label className={lbl}>Body EN *</label>
                  <textarea rows={2} className={inp + ' resize-none'} value={editBanner.body_en || ''} onChange={e => setEditBanner(p => ({ ...p!, body_en: e.target.value }))} placeholder="Short description..." />
                </div>
                <div>
                  <label className={lbl}>CTA EN</label>
                  <input className={inp} value={editBanner.cta_en || 'Discover →'} onChange={e => setEditBanner(p => ({ ...p!, cta_en: e.target.value }))} />
                </div>
              </div>

              {/* Active toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editBanner.is_active ?? true} onChange={e => setEditBanner(p => ({ ...p!, is_active: e.target.checked }))} className="accent-brand-red w-4 h-4" />
                <span className="font-sans text-sm text-white/60">Banner activ</span>
              </label>
            </div>

            <div className="p-5 border-t border-white/[0.07] flex justify-end gap-3">
              <button onClick={closeEdit} className="px-4 py-2 font-sans text-[12px] text-white/40 hover:text-white transition-colors">Anulează</button>
              <button onClick={saveBanner} disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-brand-red text-white font-sans text-[12px] font-bold uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-50">
                {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Se salvează...</> : <><Save className="w-3.5 h-3.5" /> Salvează</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
