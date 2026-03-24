'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Save, Globe, ArrowLeft, Wand2, Upload, X, Loader2 } from 'lucide-react'
import Link from 'next/link'

const CATEGORIES = [
  'news', 'politics', 'technology', 'business',
  'culture', 'travel', 'education', 'sports', 'health', 'opinion',
]
const SUBCATEGORIES = ['regional', 'national', 'international']

interface ArticleEditorProps {
  articleId?: string
}

interface ArticleData {
  slug: string
  title_ro: string; title_en: string
  content_ro: string; content_en: string
  excerpt_ro: string; excerpt_en: string
  summary_ro: string; summary_en: string
  category: string; subcategory: string
  cover_image: string; cover_image_credit: string; author_name: string
  status: string; is_breaking: boolean; source_url: string
}

const EMPTY: ArticleData = {
  slug: '', title_ro: '', title_en: '', content_ro: '', content_en: '',
  excerpt_ro: '', excerpt_en: '', summary_ro: '', summary_en: '',
  category: 'news', subcategory: '', cover_image: '', cover_image_credit: '',
  author_name: '', status: 'draft', is_breaking: false, source_url: '',
}

// ─── FIELD WRAPPER — module level (critical: must NOT be inside component) ────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

const inp = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
const ta  = inp + " resize-none leading-relaxed"

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function ArticleEditor({ articleId }: ArticleEditorProps) {
  const router = useRouter()
  const [data, setData]           = useState<ArticleData>(EMPTY)
  const [loading, setLoading]     = useState(!!articleId)
  const [saving, setSaving]       = useState(false)
  const [tab, setTab]             = useState<'ro' | 'en'>('ro')
  const [generating, setGen]      = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg]             = useState('')
  const uploadRef                 = useRef<HTMLInputElement>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (!articleId) return
    supabase.from('blog_posts').select('*').eq('id', articleId).single()
      .then(({ data: d }) => {
        if (d) setData({
          slug:               d.slug              ?? '',
          title_ro:           d.title_ro          ?? '',
          title_en:           d.title_en          ?? '',
          content_ro:         d.content_ro        ?? '',
          content_en:         d.content_en        ?? '',
          excerpt_ro:         d.excerpt_ro        ?? '',
          excerpt_en:         d.excerpt_en        ?? '',
          summary_ro:         d.summary_ro        ?? '',
          summary_en:         d.summary_en        ?? '',
          category:           d.category          ?? 'news',
          subcategory:        d.subcategory       ?? '',
          cover_image:        d.cover_image       ?? '',
          cover_image_credit: d.cover_image_credit ?? '',
          author_name:        d.author_name       ?? '',
          status:             d.status            ?? 'draft',
          is_breaking:        d.is_breaking       ?? false,
          source_url:         d.source_url        ?? '',
        })
        setLoading(false)
      })
  }, [articleId]) // eslint-disable-line react-hooks/exhaustive-deps

  function set(field: keyof ArticleData, value: string | boolean) {
    setData(prev => ({ ...prev, [field]: value }))
  }

  function slug(title: string) {
    return title.toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-')
  }

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 4000) }

  async function save(newStatus?: string) {
    setSaving(true)
    const finalSlug = data.slug || slug(data.title_ro || data.title_en)
    const payload = {
      ...data,
      slug: finalSlug,
      status: newStatus ?? data.status,
      published_at: (newStatus === 'published' || data.status === 'published')
        ? new Date().toISOString() : null,
    }
    if (articleId) {
      const { error } = await supabase.from('blog_posts').update(payload).eq('id', articleId)
      if (error) { flash(`Eroare: ${error.message}`); setSaving(false); return }
    } else {
      const { data: created, error } = await supabase.from('blog_posts').insert(payload).select('id').single()
      if (error) { flash(`Eroare: ${error.message}`); setSaving(false); return }
      if (created) router.replace(`/admin/articles/${created.id}/edit`)
    }
    if (newStatus === 'published' || data.status === 'published') {
      await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${finalSlug}`, { method: 'POST' })
    }
    setSaving(false)
    flash(newStatus === 'published' ? '✓ Publicat și live' : '✓ Salvat')
  }

  // ── IMAGE UPLOAD ───────────────────────────────────────────────────────────
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { flash('Selectați un fișier imagine'); return }
    if (file.size > 10 * 1024 * 1024) { flash('Imaginea trebuie să fie sub 10MB'); return }

    setUploading(true)
    flash('Se încarcă imaginea...')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('blog-images').upload(fileName, file, {
        contentType: file.type, upsert: false,
      })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('blog-images').getPublicUrl(fileName)
      set('cover_image', urlData.publicUrl)
      flash('✓ Imagine încărcată')
    } catch (err) {
      flash(`Eroare upload: ${(err as Error).message}`)
    }
    setUploading(false)
    if (uploadRef.current) uploadRef.current.value = ''
  }

  // ── AI COVER IMAGE ────────────────────────────────────────────────────────
  async function generateCover() {
    const imgTitle   = data.title_ro || data.title_en
    const imgSummary = data.summary_ro || data.excerpt_ro
    if (!imgTitle) { flash('Completați titlul mai întâi.'); return }
    setGen(true)
    flash('Generez imaginea...')
    try {
      const { data: res, error } = await supabase.functions.invoke('tt-generate-cover', {
        body: { title: imgTitle, summary: imgSummary, category: data.category }
      })
      if (error) throw new Error(error.message)
      if (res?.publicUrl) {
        set('cover_image', res.publicUrl)
        if (res.isAiGenerated !== false) {
          set('cover_image_credit', 'Imagine generată cu inteligență artificială')
        }
        flash('✓ Imagine generată')
      } else {
        throw new Error(res?.error || 'Eroare generare')
      }
    } catch (err) {
      flash(`Eroare: ${(err as Error).message}`)
    }
    setGen(false)
  }

  // ── AI REWRITE ────────────────────────────────────────────────────────────
  async function aiRewrite() {
    if (!articleId) { flash('Salvați mai întâi articolul.'); return }
    setGen(true)
    flash('AI rescrie articolul...')
    await supabase.functions.invoke('ai-rewrite-article', { body: { post_id: articleId } })
    const { data: d } = await supabase.from('blog_posts').select('*').eq('id', articleId).single()
    if (d) setData(prev => ({
      ...prev,
      content_ro: d.content_ro ?? prev.content_ro,
      content_en: d.content_en ?? prev.content_en,
      excerpt_ro: d.excerpt_ro ?? prev.excerpt_ro,
      excerpt_en: d.excerpt_en ?? prev.excerpt_en,
      summary_ro: d.summary_ro ?? prev.summary_ro,
      summary_en: d.summary_en ?? prev.summary_en,
      title_ro: d.title_ro ?? prev.title_ro,
      title_en: d.title_en ?? prev.title_en,
    }))
    setGen(false)
    flash('✓ Rescris de AI')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="font-sans text-white/30">Se încarcă...</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/articles" className="text-white/40 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-serif text-2xl font-bold text-white">
            {articleId ? 'Editează articol' : 'Articol nou'}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`font-sans text-[12px] px-3 py-1.5 border ${
              msg.startsWith('Eroare') ? 'text-red-400 bg-red-400/10 border-red-400/20' : 'text-green-400 bg-green-400/10 border-green-400/20'
            }`}>{msg}</span>
          )}
          {articleId && (
            <button onClick={aiRewrite} disabled={generating}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50">
              <Wand2 className="w-3.5 h-3.5" />
              AI Rescrie
            </button>
          )}
          <button onClick={() => save()} disabled={saving}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Salvează
          </button>
          <button onClick={() => save('published')} disabled={saving}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50">
            <Globe className="w-3.5 h-3.5" /> Publică
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Main content ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">

          <div className="flex gap-1">
            {(['ro', 'en'] as const).map(l => (
              <button key={l} onClick={() => setTab(l)}
                className={
                  'font-sans text-[11px] uppercase tracking-widest px-4 py-2 transition-colors ' +
                  (tab === l ? 'bg-brand-red text-white' : 'bg-[#1a1a1a] text-white/40 hover:text-white border border-white/[0.07]')
                }
              >{l.toUpperCase()}</button>
            ))}
          </div>

          {tab === 'ro' ? (
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
              <Field label="Titlu (RO)">
                <input className={inp} value={data.title_ro}
                  onChange={e => { set('title_ro', e.target.value); if (!data.slug) set('slug', slug(e.target.value)) }}
                  placeholder="Titlul articolului în română" />
              </Field>
              <Field label="Rezumat (RO)">
                <textarea rows={3} className={ta} value={data.summary_ro}
                  onChange={e => set('summary_ro', e.target.value)}
                  placeholder="Rezumat scurt (2-4 puncte, separate prin linie nouă)" />
              </Field>
              <Field label="Extras (RO)">
                <textarea rows={3} className={ta} value={data.excerpt_ro}
                  onChange={e => set('excerpt_ro', e.target.value)}
                  placeholder="Introducere / lead (1-2 propoziții)" />
              </Field>
              <Field label="Conținut (RO)">
                <textarea rows={18} className={ta} value={data.content_ro}
                  onChange={e => set('content_ro', e.target.value)}
                  placeholder="Conținut complet articol în română..." />
              </Field>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
              <Field label="Titlu (EN)">
                <input className={inp} value={data.title_en}
                  onChange={e => set('title_en', e.target.value)}
                  placeholder="Article title in English" />
              </Field>
              <Field label="Summary (EN)">
                <textarea rows={3} className={ta} value={data.summary_en}
                  onChange={e => set('summary_en', e.target.value)}
                  placeholder="Short summary (2-4 bullet points, newline separated)" />
              </Field>
              <Field label="Excerpt (EN)">
                <textarea rows={3} className={ta} value={data.excerpt_en}
                  onChange={e => set('excerpt_en', e.target.value)}
                  placeholder="Introduction / lead (1-2 sentences)" />
              </Field>
              <Field label="Content (EN)">
                <textarea rows={18} className={ta} value={data.content_en}
                  onChange={e => set('content_en', e.target.value)}
                  placeholder="Full article content in English..." />
              </Field>
            </div>
          )}
        </div>

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Publish */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">
              Publicare
            </p>
            <Field label="Status">
              <select className={inp} value={data.status} onChange={e => set('status', e.target.value)}>
                <option value="draft">Ciornă</option>
                <option value="pending_review">În revizuire</option>
                <option value="published">Publicat</option>
                <option value="rejected">Respins</option>
              </select>
            </Field>
            <Field label="Slug URL">
              <input className={inp} value={data.slug}
                onChange={e => set('slug', e.target.value)}
                placeholder="url-articol" />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={data.is_breaking}
                onChange={e => set('is_breaking', e.target.checked)}
                className="accent-brand-red w-4 h-4" />
              <span className="font-sans text-[12px] text-white/60">⚡ Ultima oră</span>
            </label>
          </div>

          {/* Classification */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">
              Clasificare
            </p>
            <Field label="Categorie">
              <select className={inp} value={data.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Subcategorie">
              <select className={inp} value={data.subcategory} onChange={e => set('subcategory', e.target.value)}>
                <option value="">—</option>
                {SUBCATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">
                Autor
              </label>
              <input
                className={inp}
                value={data.author_name}
                onChange={e => set('author_name', e.target.value)}
                placeholder="Numele autorului"
                autoComplete="off"
              />
            </div>
          </div>

          {/* Cover image */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">
              Imagine copertă
            </p>

            {data.cover_image && (
              <div className="relative">
                <img src={data.cover_image} alt="Cover" className="w-full aspect-video object-cover" />
                <button onClick={() => set('cover_image', '')}
                  className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <input className={inp} value={data.cover_image}
              onChange={e => set('cover_image', e.target.value)}
              placeholder="https://... sau încarcă mai jos" />

            <input ref={uploadRef} type="file" accept="image/*"
              onChange={handleImageUpload} className="hidden" id="edit-img-upload" />
            <label htmlFor="edit-img-upload"
              className={`flex items-center justify-center gap-2 w-full py-2.5 border font-sans text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${
                uploading
                  ? 'border-white/10 text-white/30 cursor-not-allowed'
                  : 'border-white/20 text-white/60 hover:text-white hover:border-white/40'
              }`}>
              {uploading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Upload...</>
                : <><Upload className="w-3.5 h-3.5" /> De pe calculator</>
              }
            </label>

            <button onClick={generateCover} disabled={generating || (!data.title_ro && !data.title_en)}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 border border-blue-500/30 text-blue-300 font-sans text-[11px] font-bold uppercase tracking-wider hover:bg-blue-600/30 transition-colors disabled:opacity-50">
              {generating
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generează...</>
                : <><Wand2 className="w-3.5 h-3.5" /> Generează AI</>
              }
            </button>

            {/* Credit / sursa fotografie */}
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">
                Sursă / creditare fotografie
              </label>
              <input
                className={inp}
                value={data.cover_image_credit}
                onChange={e => set('cover_image_credit', e.target.value)}
                placeholder="Imagine generată cu AI / © Reuters / Arhivă"
              />
            </div>
            {data.cover_image_credit ? (
              <p className="font-sans text-[10px] text-blue-400/60">
                {data.cover_image_credit.toLowerCase().includes('generat') ? '🤖' : '📷'} Afișat sub fotografie: „{data.cover_image_credit}"
              </p>
            ) : null}

            <p className="font-sans text-[10px] text-white/20">
              Upload: JPG/PNG/WebP max 10MB. AI: HuggingFace FLUX / Pollinations / Unsplash.
            </p>
          </div>

          {/* Source */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">
              Sursă / referință articol
            </p>
            <input className={inp} value={data.source_url}
              onChange={e => set('source_url', e.target.value)}
              placeholder="https://sursa.com/articol" />
          </div>
        </div>
      </div>
    </div>
  )
}
