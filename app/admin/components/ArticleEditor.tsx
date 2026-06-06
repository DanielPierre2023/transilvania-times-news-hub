'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Save, Globe, ArrowLeft, Wand2, Upload, X, Loader2, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

const CATEGORIES = [
  'news', 'politics', 'technology', 'business',
  'culture', 'travel', 'education', 'sports', 'health', 'opinion',
]
const SUBCATEGORIES = ['regional', 'national', 'international']

type ArticleType = 'news' | 'editorial' | 'opinie' | 'analiza' | 'pamflet' | 'blog' | 'reportaj' | 'cultura' | 'tehnologie'

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
  ai_editor: string
}

interface AdsenseQualityReport {
  ok: boolean
  total_score: number
  status: 'PASS' | 'NEEDS_EDIT' | 'HIGH_RISK' | string
  risk_level: 'low' | 'medium' | 'high' | string
  scores?: Record<string, number>
  verdict_ro?: string
  verdict_en?: string
  must_fix_before_publish?: string[]
  recommendations?: string[]
  policy_risks?: string[]
  strengths?: string[]
  adsense_notes?: Record<string, string>
  ai_artifact_review?: {
    score?: number
    risk?: string
    issues?: string[]
    typography_issues?: string[]
    rhythm_issues?: string[]
    cliche_issues?: string[]
    quote_and_punctuation_issues?: string[]
    recommendations?: string[]
  }
  voice_and_type_review?: {
    expected_editor_key?: string | null
    expected_article_type?: string
    detected_editor_voice?: string | null
    detected_article_type?: string
    voice_preservation_score?: number
    type_preservation_score?: number
    risk?: string
    issues?: string[]
    recommendations?: string[]
  }
  source_comparison_review?: {
    available?: boolean
    source_type?: string
    source_url?: string | null
    similarity_risk?: string
    quote_integrity_risk?: string
    attribution_risk?: string
    value_added_score?: number
    copied_or_near_copied_fragments?: string[]
    altered_or_unverified_quotes?: string[]
    missing_source_facts?: string[]
    added_value_detected?: string[]
    recommendations?: string[]
  }
}

const EMPTY: ArticleData = {
  slug: '', title_ro: '', title_en: '', content_ro: '', content_en: '',
  excerpt_ro: '', excerpt_en: '', summary_ro: '', summary_en: '',
  category: 'news', subcategory: '', cover_image: '', cover_image_credit: '',
  author_name: '', status: 'draft', is_breaking: false, source_url: '', ai_editor: '',
}

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
const ta = inp + " resize-none leading-relaxed"

export default function ArticleEditor({ articleId }: ArticleEditorProps) {
  const router = useRouter()
  const [data, setData] = useState<ArticleData>(EMPTY)
  const [loading, setLoading] = useState(!!articleId)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'ro' | 'en'>('ro')
  const [generating, setGen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [checkingAdsense, setCheckingAdsense] = useState(false)
  const [improvingAdsense, setImprovingAdsense] = useState(false)
  const [adsenseReport, setAdsenseReport] = useState<AdsenseQualityReport | null>(null)
  const [msg, setMsg] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    if (!articleId) return
    supabase.from('blog_posts').select('*').eq('id', articleId).single()
      .then(({ data: d }) => {
        if (d) setData({
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
          cover_image_credit: d.cover_image_credit ?? '',
          author_name: d.author_name ?? '',
          status: d.status ?? 'draft',
          is_breaking: d.is_breaking ?? false,
          source_url: d.source_url ?? '',
          ai_editor: d.ai_editor ?? '',
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

  function expectedArticleType(): ArticleType {
    const sub = data.subcategory.toLowerCase()
    const cat = data.category.toLowerCase()

    if (sub.includes('pamflet')) return 'pamflet'
    if (sub.includes('reportaj')) return 'reportaj'
    if (sub.includes('analiza') || sub.includes('analysis')) return 'analiza'
    if (sub.includes('blog')) return 'blog'
    if (cat === 'technology') return 'tehnologie'
    if (cat === 'culture') return 'cultura'
    if (cat === 'opinion') return 'opinie'
    return 'news'
  }

  function expectedEditorKey(articleType: ArticleType): string {
    if (data.ai_editor) return data.ai_editor
    if (articleType === 'tehnologie' || data.category === 'technology') return 'daniel_dobos'
    if (data.category === 'politics') return 'andrei_popescu'
    if (articleType === 'cultura' || data.category === 'culture' || data.category === 'travel') return 'lucian_bratu'
    if (data.category === 'health') return 'sofia_marinescu'
    return 'victor_simon'
  }

  function refreshArticleState(d: Partial<ArticleData> | null) {
    if (!d) return
    setData(prev => ({
      ...prev,
      title_ro: d.title_ro ?? prev.title_ro,
      title_en: d.title_en ?? prev.title_en,
      content_ro: d.content_ro ?? prev.content_ro,
      content_en: d.content_en ?? prev.content_en,
      excerpt_ro: d.excerpt_ro ?? prev.excerpt_ro,
      excerpt_en: d.excerpt_en ?? prev.excerpt_en,
      summary_ro: d.summary_ro ?? prev.summary_ro,
      summary_en: d.summary_en ?? prev.summary_en,
      author_name: d.author_name ?? prev.author_name,
      ai_editor: d.ai_editor ?? prev.ai_editor,
    }))
  }

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

  async function generateCover() {
    const imgTitle = data.title_ro || data.title_en
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

  async function aiRewrite() {
    if (!articleId) { flash('Salvați mai întâi articolul.'); return }
    setGen(true)
    flash('AI rescrie articolul (v6 pipeline)...')
    try {
      const { data: result, error } = await supabase.functions.invoke('tt-rewrite-blog-post', {
        body: { blog_post_id: articleId },
      })
      if (error) throw error
      if (!result?.ok) throw new Error(result?.error || 'Rescriere eșuată')
 
      const { data: d } = await supabase.from('blog_posts').select('*').eq('id', articleId).single()
      refreshArticleState(d)
      setAdsenseReport(null)
      flash(`✓ Rescris de ${result.editor || 'redactor'}`)
    } catch (err) {
      flash('Eroare rescriere: ' + (err as Error).message)
    } finally {
      setGen(false)
    }
  }

  async function checkAdsenseQuality() {
    if (!articleId) { flash('Salvați mai întâi articolul.'); return }

    const articleType = expectedArticleType()
    const editorKey = expectedEditorKey(articleType)

    setCheckingAdsense(true)
    setAdsenseReport(null)
    flash('Verific AdSense quality...')

    try {
      const { data: result, error } = await supabase.functions.invoke('tt-adsense-quality-check', {
        body: {
          blog_post_id: articleId,
          expected_article_type: articleType,
          expected_editor_key: editorKey,
        },
      })

      if (error) throw error
      if (!result?.ok) throw new Error(result?.error || 'Verificare eșuată')

      setAdsenseReport(result as AdsenseQualityReport)
      flash(`✓ AdSense: ${result.status} (${result.total_score}/100)`)
    } catch (err) {
      flash('Eroare AdSense: ' + (err as Error).message)
    } finally {
      setCheckingAdsense(false)
    }
  }

  async function improveAdsenseQuality() {
    if (!articleId) { flash('Salvați mai întâi articolul.'); return }

    const articleType = expectedArticleType()
    const editorKey = expectedEditorKey(articleType)

    setImprovingAdsense(true)
    flash('Îmbunătățesc articolul pentru AdSense...')

    try {
      const { data: result, error } = await supabase.functions.invoke('tt-improve-for-adsense', {
        body: {
          blog_post_id: articleId,
          expected_article_type: articleType,
          expected_editor_key: editorKey,
          quality_report: adsenseReport || undefined,
        },
      })

      if (error) throw error
      if (!result?.ok) throw new Error(result?.error || 'Îmbunătățire eșuată')

      if (result.updated_post) {
        refreshArticleState(result.updated_post)
      } else {
        const { data: d } = await supabase.from('blog_posts').select('*').eq('id', articleId).single()
        refreshArticleState(d)
      }

      setAdsenseReport(null)
      flash('✓ Articol îmbunătățit. Rulează din nou Verifică AdSense.')
    } catch (err) {
      flash('Eroare îmbunătățire AdSense: ' + (err as Error).message)
    } finally {
      setImprovingAdsense(false)
    }
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
            <button onClick={aiRewrite} disabled={generating || improvingAdsense}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-purple-600/20 border border-purple-500/30 text-purple-300 hover:bg-purple-600/30 transition-colors disabled:opacity-50">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              AI Rescrie
            </button>
          )}
          {articleId && (
            <button onClick={checkAdsenseQuality} disabled={checkingAdsense || improvingAdsense}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition-colors disabled:opacity-50">
              {checkingAdsense ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              Verifică AdSense
            </button>
          )}
          {articleId && (
            <button onClick={improveAdsenseQuality} disabled={improvingAdsense || checkingAdsense || generating}
              className="flex items-center gap-2 font-sans text-[12px] px-3 py-2 bg-orange-600/20 border border-orange-500/30 text-orange-300 hover:bg-orange-600/30 transition-colors disabled:opacity-50">
              {improvingAdsense ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              Îmbunătățește AdSense
            </button>
          )}
          <button onClick={() => save()} disabled={saving || improvingAdsense}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> Salvează
          </button>
          <button onClick={() => save('published')} disabled={saving || improvingAdsense}
            className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50">
            <Globe className="w-3.5 h-3.5" /> Publică
          </button>
        </div>
      </div>

      {adsenseReport && (
        <div className="mb-6 bg-[#1a1a1a] border border-emerald-500/20 p-5">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
            <div>
              <p className="font-sans text-[11px] uppercase tracking-widest text-emerald-300 mb-2">AdSense Editorial Quality Check</p>
              <h2 className="font-serif text-xl font-bold text-white">{adsenseReport.status} · {adsenseReport.total_score}/100</h2>
              <p className="font-sans text-sm text-white/50 mt-1">
                Risc: {adsenseReport.risk_level} · Tip: {adsenseReport.voice_and_type_review?.expected_article_type || 'news'} · Editor: {adsenseReport.voice_and_type_review?.expected_editor_key || 'auto'}
              </p>
            </div>
            <span className={`font-sans text-[11px] uppercase tracking-widest px-3 py-1.5 border ${
              adsenseReport.status === 'PASS'
                ? 'text-green-300 border-green-400/30 bg-green-400/10'
                : adsenseReport.status === 'HIGH_RISK'
                  ? 'text-red-300 border-red-400/30 bg-red-400/10'
                  : 'text-yellow-300 border-yellow-400/30 bg-yellow-400/10'
            }`}>
              {adsenseReport.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
            {adsenseReport.scores && Object.entries(adsenseReport.scores).map(([key, value]) => (
              <div key={key} className="bg-black/30 border border-white/[0.06] p-3">
                <p className="font-sans text-[10px] text-white/30 uppercase tracking-widest mb-1">{key.replace(/_/g, ' ')}</p>
                <p className="font-sans text-sm text-white font-bold">{value}</p>
              </div>
            ))}
          </div>

          {adsenseReport.verdict_ro && <p className="font-sans text-sm text-white/70 border-l-2 border-emerald-400/50 pl-3 mb-4">{adsenseReport.verdict_ro}</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="font-sans text-[11px] uppercase tracking-widest text-red-300 mb-2">De reparat înainte de publicare</p>
              {(adsenseReport.must_fix_before_publish || []).length > 0 ? (
                <ul className="space-y-1">{(adsenseReport.must_fix_before_publish || []).map((item, i) => <li key={i} className="font-sans text-[12px] text-white/60">• {item}</li>)}</ul>
              ) : <p className="font-sans text-[12px] text-white/30">Nicio problemă critică.</p>}
            </div>
            <div>
              <p className="font-sans text-[11px] uppercase tracking-widest text-yellow-300 mb-2">Recomandări</p>
              {(adsenseReport.recommendations || []).length > 0 ? (
                <ul className="space-y-1">{(adsenseReport.recommendations || []).slice(0, 5).map((item, i) => <li key={i} className="font-sans text-[12px] text-white/60">• {item}</li>)}</ul>
              ) : <p className="font-sans text-[12px] text-white/30">Nu există recomandări.</p>}
            </div>
            <div>
              <p className="font-sans text-[11px] uppercase tracking-widest text-blue-300 mb-2">AI / voce editorială</p>
              <p className="font-sans text-[12px] text-white/60">AI artifact risk: {adsenseReport.ai_artifact_review?.risk || 'n/a'}</p>
              <p className="font-sans text-[12px] text-white/60">Voice risk: {adsenseReport.voice_and_type_review?.risk || 'n/a'}</p>
              <p className="font-sans text-[12px] text-white/60">Voice score: {adsenseReport.voice_and_type_review?.voice_preservation_score ?? 'n/a'}</p>
              <p className="font-sans text-[12px] text-white/60">Type score: {adsenseReport.voice_and_type_review?.type_preservation_score ?? 'n/a'}</p>
            </div>
          </div>

          {adsenseReport.source_comparison_review && (
            <div className="mt-5 pt-5 border-t border-white/[0.07]">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-widest text-orange-300 mb-1">Source comparison</p>
                  <p className="font-sans text-[12px] text-white/40">{adsenseReport.source_comparison_review.available ? 'Original source text was compared.' : 'No original source text available for comparison.'}</p>
                </div>
                <span className="font-sans text-[11px] uppercase tracking-widest px-3 py-1.5 border border-orange-400/30 bg-orange-400/10 text-orange-300">
                  {adsenseReport.source_comparison_review.available ? 'AVAILABLE' : 'UNAVAILABLE'}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
                <div className="bg-black/30 border border-white/[0.06] p-3"><p className="font-sans text-[10px] text-white/30 uppercase tracking-widest mb-1">Source type</p><p className="font-sans text-[12px] text-white/70">{adsenseReport.source_comparison_review.source_type || 'none'}</p></div>
                <div className="bg-black/30 border border-white/[0.06] p-3"><p className="font-sans text-[10px] text-white/30 uppercase tracking-widest mb-1">Similarity</p><p className="font-sans text-[12px] text-white/70">{adsenseReport.source_comparison_review.similarity_risk || 'n/a'}</p></div>
                <div className="bg-black/30 border border-white/[0.06] p-3"><p className="font-sans text-[10px] text-white/30 uppercase tracking-widest mb-1">Quote integrity</p><p className="font-sans text-[12px] text-white/70">{adsenseReport.source_comparison_review.quote_integrity_risk || 'n/a'}</p></div>
                <div className="bg-black/30 border border-white/[0.06] p-3"><p className="font-sans text-[10px] text-white/30 uppercase tracking-widest mb-1">Attribution</p><p className="font-sans text-[12px] text-white/70">{adsenseReport.source_comparison_review.attribution_risk || 'n/a'}</p></div>
                <div className="bg-black/30 border border-white/[0.06] p-3"><p className="font-sans text-[10px] text-white/30 uppercase tracking-widest mb-1">Added value</p><p className="font-sans text-[12px] text-white/70">{adsenseReport.source_comparison_review.value_added_score ?? 'n/a'}</p></div>
              </div>

              {adsenseReport.source_comparison_review.source_url && <p className="font-sans text-[12px] text-white/40 mb-4 break-all">Source: {adsenseReport.source_comparison_review.source_url}</p>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-widest text-red-300 mb-2">Copied / near-copied</p>
                  {(adsenseReport.source_comparison_review.copied_or_near_copied_fragments || []).length > 0 ? (
                    <ul className="space-y-1">{(adsenseReport.source_comparison_review.copied_or_near_copied_fragments || []).slice(0, 5).map((item, i) => <li key={i} className="font-sans text-[12px] text-white/60">• {item}</li>)}</ul>
                  ) : <p className="font-sans text-[12px] text-white/30">No near-copied fragments flagged.</p>}
                </div>
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-widest text-yellow-300 mb-2">Missing / altered source facts</p>
                  {((adsenseReport.source_comparison_review.missing_source_facts || []).length > 0 || (adsenseReport.source_comparison_review.altered_or_unverified_quotes || []).length > 0) ? (
                    <ul className="space-y-1">
                      {(adsenseReport.source_comparison_review.missing_source_facts || []).slice(0, 4).map((item, i) => <li key={`fact-${i}`} className="font-sans text-[12px] text-white/60">• {item}</li>)}
                      {(adsenseReport.source_comparison_review.altered_or_unverified_quotes || []).slice(0, 4).map((item, i) => <li key={`quote-${i}`} className="font-sans text-[12px] text-white/60">• {item}</li>)}
                    </ul>
                  ) : <p className="font-sans text-[12px] text-white/30">No altered quotes or missing source facts flagged.</p>}
                </div>
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-widest text-green-300 mb-2">Added value / recommendations</p>
                  {((adsenseReport.source_comparison_review.added_value_detected || []).length > 0 || (adsenseReport.source_comparison_review.recommendations || []).length > 0) ? (
                    <ul className="space-y-1">
                      {(adsenseReport.source_comparison_review.added_value_detected || []).slice(0, 3).map((item, i) => <li key={`value-${i}`} className="font-sans text-[12px] text-white/60">• {item}</li>)}
                      {(adsenseReport.source_comparison_review.recommendations || []).slice(0, 4).map((item, i) => <li key={`rec-${i}`} className="font-sans text-[12px] text-white/60">• {item}</li>)}
                    </ul>
                  ) : <p className="font-sans text-[12px] text-white/30">No additional source recommendations.</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex gap-1">
            {(['ro', 'en'] as const).map(l => (
              <button key={l} onClick={() => setTab(l)}
                className={'font-sans text-[11px] uppercase tracking-widest px-4 py-2 transition-colors ' +
                  (tab === l ? 'bg-brand-red text-white' : 'bg-[#1a1a1a] text-white/40 hover:text-white border border-white/[0.07]')}
              >{l.toUpperCase()}</button>
            ))}
          </div>

          {tab === 'ro' ? (
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
              <Field label="Titlu (RO)"><input className={inp} value={data.title_ro} onChange={e => { set('title_ro', e.target.value); if (!data.slug) set('slug', slug(e.target.value)) }} placeholder="Titlul articolului în română" /></Field>
              <Field label="Rezumat (RO)"><textarea rows={3} className={ta} value={data.summary_ro} onChange={e => set('summary_ro', e.target.value)} placeholder="Rezumat scurt (2-4 puncte, separate prin linie nouă)" /></Field>
              <Field label="Extras (RO)"><textarea rows={3} className={ta} value={data.excerpt_ro} onChange={e => set('excerpt_ro', e.target.value)} placeholder="Introducere / lead (1-2 propoziții)" /></Field>
              <Field label="Conținut (RO)"><textarea rows={18} className={ta} value={data.content_ro} onChange={e => set('content_ro', e.target.value)} placeholder="Conținut complet articol în română..." /></Field>
            </div>
          ) : (
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
              <Field label="Titlu (EN)"><input className={inp} value={data.title_en} onChange={e => set('title_en', e.target.value)} placeholder="Article title in English" /></Field>
              <Field label="Summary (EN)"><textarea rows={3} className={ta} value={data.summary_en} onChange={e => set('summary_en', e.target.value)} placeholder="Short summary (2-4 bullet points, newline separated)" /></Field>
              <Field label="Excerpt (EN)"><textarea rows={3} className={ta} value={data.excerpt_en} onChange={e => set('excerpt_en', e.target.value)} placeholder="Introduction / lead (1-2 sentences)" /></Field>
              <Field label="Content (EN)"><textarea rows={18} className={ta} value={data.content_en} onChange={e => set('content_en', e.target.value)} placeholder="Full article content in English..." /></Field>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">Publicare</p>
            <Field label="Status">
              <select className={inp} value={data.status} onChange={e => set('status', e.target.value)}>
                <option value="draft">Ciornă</option>
                <option value="pending_review">În revizuire</option>
                <option value="published">Publicat</option>
                <option value="rejected">Respins</option>
              </select>
            </Field>
            <Field label="Slug URL"><input className={inp} value={data.slug} onChange={e => set('slug', e.target.value)} placeholder="url-articol" /></Field>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={data.is_breaking} onChange={e => set('is_breaking', e.target.checked)} className="accent-brand-red w-4 h-4" />
              <span className="font-sans text-[12px] text-white/60">⚡ Ultima oră</span>
            </label>
          </div>

          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">Clasificare</p>
            <Field label="Categorie"><select className={inp} value={data.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
            <Field label="Subcategorie"><select className={inp} value={data.subcategory} onChange={e => set('subcategory', e.target.value)}><option value="">—</option>{SUBCATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Field>
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">Autor</label>
              <input className={inp} value={data.author_name} onChange={e => set('author_name', e.target.value)} placeholder="Numele autorului" autoComplete="off" />
            </div>
          </div>

          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">Imagine copertă</p>
            {data.cover_image && (
              <div className="relative">
                <img src={data.cover_image} alt="Cover" className="w-full aspect-video object-cover" />
                <button onClick={() => set('cover_image', '')} className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <input className={inp} value={data.cover_image} onChange={e => set('cover_image', e.target.value)} placeholder="https://... sau încarcă mai jos" />
            <input ref={uploadRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="edit-img-upload" />
            <label htmlFor="edit-img-upload" className={`flex items-center justify-center gap-2 w-full py-2.5 border font-sans text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-colors ${uploading ? 'border-white/10 text-white/30 cursor-not-allowed' : 'border-white/20 text-white/60 hover:text-white hover:border-white/40'}`}>
              {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Upload...</> : <><Upload className="w-3.5 h-3.5" /> De pe calculator</>}
            </label>
            <button onClick={generateCover} disabled={generating || (!data.title_ro && !data.title_en)} className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600/20 border border-blue-500/30 text-blue-300 font-sans text-[11px] font-bold uppercase tracking-wider hover:bg-blue-600/30 transition-colors disabled:opacity-50">
              {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generează...</> : <><Wand2 className="w-3.5 h-3.5" /> Generează AI</>}
            </button>
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">Sursă / creditare fotografie</label>
              <input className={inp} value={data.cover_image_credit} onChange={e => set('cover_image_credit', e.target.value)} placeholder="Imagine generată cu AI / © Reuters / Arhivă" />
            </div>
            {data.cover_image_credit ? <p className="font-sans text-[10px] text-blue-400/60">{data.cover_image_credit.toLowerCase().includes('generat') ? '🤖' : '📷'} Afișat sub fotografie: &bdquo;{data.cover_image_credit}&rdquo;</p> : null}
            <p className="font-sans text-[10px] text-white/20">Upload: JPG/PNG/WebP max 10MB. AI: HuggingFace FLUX / Pollinations / Unsplash.</p>
          </div>

          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
            <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">Sursă / referință articol</p>
            <input className={inp} value={data.source_url} onChange={e => set('source_url', e.target.value)} placeholder="https://sursa.com/articol" />
          </div>
        </div>
      </div>
    </div>
  )
}
