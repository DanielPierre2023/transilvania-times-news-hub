'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Save, Globe, ArrowLeft, Image as ImageIcon, Wand2 } from 'lucide-react'
import Link from 'next/link'

const CATEGORIES = [
  'news', 'politics', 'technology', 'business',
  'culture', 'travel', 'education', 'sports', 'health', 'opinion'
]
const SUBCATEGORIES = ['regional', 'national', 'international']

interface ArticleEditorProps {
  articleId?: string // undefined = new article
}

interface ArticleData {
  slug: string
  title_ro: string
  title_en: string
  content_ro: string
  content_en: string
  excerpt_ro: string
  excerpt_en: string
  summary_ro: string
  summary_en: string
  category: string
  subcategory: string
  cover_image: string
  author_name: string
  status: string
  is_breaking: boolean
  source_url: string
}

const EMPTY: ArticleData = {
  slug: '', title_ro: '', title_en: '', content_ro: '', content_en: '',
  excerpt_ro: '', excerpt_en: '', summary_ro: '', summary_en: '',
  category: 'news', subcategory: '', cover_image: '', author_name: '',
  status: 'draft', is_breaking: false, source_url: '',
}

export default function ArticleEditor({ articleId }: ArticleEditorProps) {
  const router = useRouter()
  const [data, setData] = useState<ArticleData>(EMPTY)
  const [loading, setLoading] = useState(!!articleId)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'ro' | 'en'>('ro')
  const [generating, setGenerating] = useState(false)
  const [msg, setMsg] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (!articleId) return
    supabase.from('blog_posts').select('*').eq('id', articleId).single()
      .then(({ data: d }) => {
        if (d) {
          setData({
            slug: d.slug ?? '',
            title_ro: d.title_ro ?? '',
            title_en: d.title_en ?? '',
            content_ro: d.content_ro ?? '',
            content_en: d.content_en ?? '',
            excerpt_ro: d.excerpt_ro ?? '',
            excerpt_en: d.excerpt_en ?? '',
            summary_ro: d.summary_ro ?? '',
            summary_en: d.summary_en ?? '',
            category: d.category ?? 'news',
            subcategory: d.subcategory ?? '',
            cover_image: d.cover_image ?? '',
            author_name: d.author_name ?? '',
            status: d.status ?? 'draft',
            is_breaking: d.is_breaking ?? false,
            source_url: d.source_url ?? '',
          })
        }
        setLoading(false)
      })
  }, [articleId])

  function set(field: keyof ArticleData, value: string | boolean) {
    setData(prev => ({ ...prev, [field]: value }))
  }

  function generateSlug(title: string) {
    return title.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-')
  }

  async function save(newStatus?: string) {
    setSaving(true)
    setMsg('')

    const slug = data.slug || generateSlug(data.title_ro || data.title_en)
    const payload = {
      ...data,
      slug,
      status: newStatus ?? data.status,
      published_at: (newStatus === 'published' || data.status === 'published')
        ? new Date().toISOString()
        : null,
    }

    if (articleId) {
      await supabase.from('blog_posts').update(payload).eq('id', articleId)
    } else {
      const { data: created } = await supabase.from('blog_posts').insert(payload).select('id').single()
      if (created) router.replace(`/admin/articles/${created.id}/edit`)
    }

    if (newStatus === 'published' || data.status === 'published') {
      await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${slug}`, { method: 'POST' })
    }

    setSaving(false)
    setMsg(newStatus === 'published' ? '✓ Publicat și live' : '✓ Salvat')
    setTimeout(() => setMsg(''), 3000)
  }

  async function generateCover() {
    if (!articleId) { setMsg('Salvați mai întâi articolul.'); return }
    setGenerating(true)
    await supabase.functions.invoke('generate-cover-image', { body: { post_id: articleId } })
    const { data: d } = await supabase.from('blog_posts').select('cover_image').eq('id', articleId).single()
    if (d?.cover_image) set('cover_image', d.cover_image)
    setGenerating(false)
    setMsg('✓ Imagine generată')
  }

  async function aiRewrite() {
    if (!articleId) { setMsg('Salvați mai întâi articolul.'); return }
    setGenerating(true)
    setMsg('AI rescrie articolul...')
    await supabase.functions.invoke('ai-rewrite-article', { body: { post_id: articleId } })
    // Reload data
    const { data: d } = await supabase.from('blog_posts').select('*').eq('id', articleId).single()
    if (d) {
      setData(prev => ({
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
    }
    setGenerating(false)
    setMsg('✓ Rescris de AI')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="font-sans text-white/30">Se încarcă...</div>
      </div>
    )
  }

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )

  const inputCls = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors"
  const textareaCls = inputCls + " resize-none"

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
          {msg && <span className="font-sans text-[12px] text-green-400">{msg}</span>}
          {articleId && (
            <button
              onClick={aiRewrite}
              disabled={generating}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50"
            >
              <Wand2 className="w-3.5 h-3.5" />
              AI Rescrie
            </button>
          )}
          <button
            onClick={() => save()}
            disabled={saving}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            Salvează
          </button>
          <button
            onClick={() => save('published')}
            disabled={saving}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            <Globe className="w-3.5 h-3.5" />
            Publică
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">

          {/* Language tabs */}
          <div className="flex gap-1">
            {(['ro', 'en'] as const).map(l => (
              <button
                key={l}
                onClick={() => setTab(l)}
                className={
                  'font-sans text-[11px] uppercase tracking-widest px-4 py-2 transition-colors ' +
                  (tab === l ? 'bg-brand-red text-white' : 'bg-[#1a1a1a] text-white/40 hover:text-white border border-white/[0.07]')
                }
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {tab === 'ro' ? (
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
              <Field label="Titlu (RO)">
                <input
                  className={inputCls}
                  value={data.title_ro}
                  onChange={e => {
                    set('title_ro', e.target.value)
                    if (!data.slug) set('slug', generateSlug(e.target.value))
                  }}
                  placeholder="Titlul articolului în română"
                />
              </Field>
              <Field label="Rezumat (RO)">
                <textarea rows={3} className={textareaCls} value={data.summary_ro}
                  onChange={e => set('summary_ro', e.target.value)}
                  placeholder="Rezumat scurt (2-4 puncte bullet, separate prin linie nouă)" />
              </Field>
              <Field label="Extras (RO)">
                <textarea rows={3} className={textareaCls} value={data.excerpt_ro}
                  onChange={e => set('excerpt_ro', e.target.value)}
                  placeholder="Introducere / lead (1-2 propoziții)" />
              </Field>
              <Field label="Conținut (RO)">
                <textarea rows={16} className={textareaCls} value={data.content_ro}
                  onChange={e => set('content_ro', e.target.value)}
                  placeholder="Conținut complet articol în română..." />
              </Field>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
              <Field label="Titlu (EN)">
                <input className={inputCls} value={data.title_en}
                  onChange={e => set('title_en', e.target.value)}
                  placeholder="Article title in English" />
              </Field>
              <Field label="Summary (EN)">
                <textarea rows={3} className={textareaCls} value={data.summary_en}
                  onChange={e => set('summary_en', e.target.value)}
                  placeholder="Short summary (2-4 bullet points, newline separated)" />
              </Field>
              <Field label="Excerpt (EN)">
                <textarea rows={3} className={textareaCls} value={data.excerpt_en}
                  onChange={e => set('excerpt_en', e.target.value)}
                  placeholder="Introduction / lead (1-2 sentences)" />
              </Field>
              <Field label="Content (EN)">
                <textarea rows={16} className={textareaCls} value={data.content_en}
                  onChange={e => set('content_en', e.target.value)}
                  placeholder="Full article content in English..." />
              </Field>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Publish status */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <h3 className="font-sans text-[11px] uppercase tracking-widest text-white/40">Publicare</h3>
            <Field label="Status">
              <select className={inputCls} value={data.status} onChange={e => set('status', e.target.value)}>
                <option value="draft">Ciornă</option>
                <option value="pending_review">În revizuire</option>
                <option value="published">Publicat</option>
                <option value="rejected">Respins</option>
              </select>
            </Field>
            <Field label="Slug URL">
              <input className={inputCls} value={data.slug}
                onChange={e => set('slug', e.target.value)}
                placeholder="url-articol" />
            </Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={data.is_breaking}
                onChange={e => set('is_breaking', e.target.checked)}
                className="accent-brand-red" />
              <span className="font-sans text-[12px] text-white/60">⚡ Ultima oră</span>
            </label>
          </div>

          {/* Category */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <h3 className="font-sans text-[11px] uppercase tracking-widest text-white/40">Clasificare</h3>
            <Field label="Categorie">
              <select className={inputCls} value={data.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Subcategorie">
              <select className={inputCls} value={data.subcategory} onChange={e => set('subcategory', e.target.value)}>
                <option value="">—</option>
                {SUBCATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Autor">
              <input className={inputCls} value={data.author_name}
                onChange={e => set('author_name', e.target.value)}
                placeholder="Nume autor" />
            </Field>
          </div>

          {/* Cover image */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
            <h3 className="font-sans text-[11px] uppercase tracking-widest text-white/40">Imagine copertă</h3>
            {data.cover_image && (
              <img src={data.cover_image} alt="" className="w-full aspect-video object-cover grayscale" />
            )}
            <input className={inputCls} value={data.cover_image}
              onChange={e => set('cover_image', e.target.value)}
              placeholder="URL imagine" />
            <button
              onClick={generateCover}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 font-sans text-[12px] py-2 bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30 transition-colors disabled:opacity-50"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              {generating ? 'Generează...' : 'Generează AI'}
            </button>
          </div>

          {/* Source */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
            <h3 className="font-sans text-[11px] uppercase tracking-widest text-white/40">Sursă</h3>
            <input className={inputCls} value={data.source_url}
              onChange={e => set('source_url', e.target.value)}
              placeholder="https://sursa.com/articol" />
          </div>
        </div>
      </div>
    </div>
  )
}
