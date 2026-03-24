'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Wand2, Save, Globe, RefreshCw, Image as ImageIcon } from 'lucide-react'

// ─── JOURNALIST PERSONAS ────────────────────────────────────────────────────

const EDITORS = [
  { value: 'daniel_dobos',    label: 'Daniel Dobos',    desc: 'Tech · sisteme · dry wit' },
  { value: 'andrei_popescu',  label: 'Andrei Popescu',  desc: 'Investigativ · date · agresiv' },
  { value: 'elena_vasilescu', label: 'Elena Vasilescu',  desc: 'Filozofic · metafore · elegant' },
  { value: 'lucian_bratu',    label: 'Lucian Bratu',    desc: 'Local · Cluj · comunitate' },
  { value: 'sofia_marinescu', label: 'Sofia Marinescu', desc: 'Analitic · sceptic · metodic' },
  { value: 'mihai_ionescu',   label: 'Mihai Ionescu',   desc: 'Narativ · arhitectură · oameni' },
]

const WORD_COUNTS = [
  { value: 800,  label: '800',  desc: 'Scurt' },
  { value: 1200, label: '1200', desc: 'Standard' },
  { value: 1800, label: '1800', desc: 'Long-form' },
]

const CATEGORIES = [
  'news','politics','technology','business',
  'culture','travel','education','sports','health','opinion',
]

const SUBCATEGORIES = ['', 'regional', 'national', 'international']

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter()

  // Generation params
  const [editor, setEditor]       = useState('daniel_dobos')
  const [wordCount, setWordCount] = useState(1200)
  const [category, setCategory]   = useState('opinion')
  const [prompt, setPrompt]       = useState('')

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated]   = useState(false)
  const [genError, setGenError]     = useState('')

  // Article content fields — all editable after generation
  const [titleRo, setTitleRo]     = useState('')
  const [titleEn, setTitleEn]     = useState('')
  const [summaryRo, setSummaryRo] = useState('')
  const [summaryEn, setSummaryEn] = useState('')
  const [excerptRo, setExcerptRo] = useState('')
  const [excerptEn, setExcerptEn] = useState('')
  const [contentRo, setContentRo] = useState('')
  const [contentEn, setContentEn] = useState('')
  const [tagsRo, setTagsRo]       = useState('')
  const [tagsEn, setTagsEn]       = useState('')
  const [seoTitleRo, setSeoTitleRo]         = useState('')
  const [seoTitleEn, setSeoTitleEn]         = useState('')
  const [seoDescRo, setSeoDescRo]           = useState('')
  const [seoDescEn, setSeoDescEn]           = useState('')

  // Metadata
  const [slug, setSlug]               = useState('')
  const [authorName, setAuthorName]   = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [sourceUrl, setSourceUrl]     = useState('')
  const [isBreaking, setIsBreaking]   = useState(false)

  // Cover image
  const [coverImage, setCoverImage]       = useState('')
  const [generatingImg, setGeneratingImg] = useState(false)

  // UI
  const [contentTab, setContentTab] = useState<'ro' | 'en'>('ro')
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 5000)
  }

  function toSlug(text: string): string {
    return text.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '').trim()
      .replace(/\s+/g, '-').substring(0, 80)
  }

  // ─── GENERATE ARTICLE ────────────────────────────────────────────────────

  async function generate() {
    if (!prompt.trim()) { setGenError('Introduceți subiectul / brieful editorial.'); return }
    setGenerating(true)
    setGenError('')
    setGenerated(false)
    setCoverImage('')

    try {
      // CORRECT parameters matching the edge function signature exactly
      const { data, error } = await supabase.functions.invoke('ai-generate-article', {
        body: {
          prompt:     prompt.trim(),
          word_count: wordCount,
          editor,
          category,
        }
      })

      if (error) throw new Error(error.message)
      if (!data)  throw new Error('Niciun răspuns de la funcția AI.')

      // Populate all fields from response
      setTitleRo(data.title_ro    || '')
      setTitleEn(data.title_en    || '')
      setSummaryRo(data.summary_ro || '')
      setSummaryEn(data.summary_en || '')
      setExcerptRo(data.excerpt_ro || '')
      setExcerptEn(data.excerpt_en || '')
      setContentRo(data.content_ro || '')
      setContentEn(data.content_en || '')
      setTagsRo(Array.isArray(data.tags_ro) ? data.tags_ro.join(', ') : (data.tags_ro || ''))
      setTagsEn(Array.isArray(data.tags_en) ? data.tags_en.join(', ') : (data.tags_en || (Array.isArray(data.tags) ? data.tags.join(', ') : '')))
      setSeoTitleRo(data.seo_title_ro || '')
      setSeoTitleEn(data.seo_title_en || '')
      setSeoDescRo(data.seo_description_ro || '')
      setSeoDescEn(data.seo_description_en || '')
      setSlug(data.slug || toSlug(data.title_ro || data.title_en || ''))
      // Author from persona — user can override in the field
      if (!authorName && data.author_name) setAuthorName(data.author_name)
      setGenerated(true)
      setContentTab('ro')
      flash('✓ Articol generat')
    } catch (e) {
      setGenError(`Eroare: ${(e as Error).message}`)
    }
    setGenerating(false)
  }

  // ─── GENERATE COVER IMAGE ────────────────────────────────────────────────
  // generate-cover-image takes { title, excerpt }
  // We pass summary as excerpt to use article content for the image prompt

  async function generateCoverImage() {
    const imageTitle   = titleRo || titleEn
    const imageContext = summaryRo || summaryEn || excerptRo || excerptEn

    if (!imageTitle) {
      flash('Generați mai întâi articolul sau completați titlul.')
      return
    }

    setGeneratingImg(true)
    flash('Generez imaginea copertă din conținutul articolului...')

    try {
      const { data, error } = await supabase.functions.invoke('generate-cover-image', {
        body: {
          title:   imageTitle,
          excerpt: imageContext, // summary used as image context
        }
      })

      if (error) throw new Error(error.message)
      if (data?.publicUrl) {
        setCoverImage(data.publicUrl)
        flash('✓ Imagine generată')
      } else if (data?.error) {
        throw new Error(data.error)
      } else {
        throw new Error('Nu am primit URL-ul imaginii.')
      }
    } catch (e) {
      flash(`Eroare imagine: ${(e as Error).message}`)
    }
    setGeneratingImg(false)
  }

  // ─── SAVE ────────────────────────────────────────────────────────────────

  async function saveArticle(newStatus: 'draft' | 'published') {
    setSaving(true)
    const finalSlug = (slug || toSlug(titleRo || titleEn)) + '-' + Date.now().toString(36)

    const payload = {
      title_ro:     titleRo   || null,
      title_en:     titleEn   || null,
      summary_ro:   summaryRo || null,
      summary_en:   summaryEn || null,
      excerpt_ro:   excerptRo || null,
      excerpt_en:   excerptEn || null,
      content_ro:   contentRo || null,
      content_en:   contentEn || null,
      tags_ro:      tagsRo.split(',').map(t => t.trim()).filter(Boolean),
      tags_en:      tagsEn.split(',').map(t => t.trim()).filter(Boolean),
      cover_image:  coverImage || null,
      category,
      subcategory:  subcategory || null,
      author_name:  authorName || null,
      source_url:   sourceUrl  || null,
      is_breaking:  isBreaking,
      slug:         finalSlug,
      status:       newStatus,
      published_at: newStatus === 'published' ? new Date().toISOString() : null,
    }

    const { data: saved, error } = await supabase
      .from('blog_posts')
      .insert(payload as never)
      .select('id, slug')
      .single()

    if (error || !saved) {
      flash(`Eroare salvare: ${error?.message}`)
      setSaving(false)
      return
    }

    if (newStatus === 'published') {
      await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${saved.slug}`, { method: 'POST' })
      flash('✓ Publicat și live pe site')
    } else {
      flash('✓ Salvat ca ciornă')
    }

    setSaving(false)
    setTimeout(() => router.push(`/admin/articles/${saved.id}/edit`), 1500)
  }

  // ─── STYLES ──────────────────────────────────────────────────────────────

  const inputCls    = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
  const textaCls    = inputCls + " resize-none leading-relaxed"
  const labelCls    = "block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5"
  const secCls      = "bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4"
  const secTitle    = "font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3 mb-1"

  function F({ label, children }: { label: string; children: React.ReactNode }) {
    return <div><label className={labelCls}>{label}</label>{children}</div>
  }

  function TagPills({ value, color }: { value: string; color: string }) {
    const tags = value.split(',').map(t => t.trim()).filter(Boolean)
    if (!tags.length) return null
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {tags.map(tag => (
          <span key={tag} className={`font-sans text-[10px] px-2 py-0.5 border ${color}`}>
            {tag}
          </span>
        ))}
      </div>
    )
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Editor AI</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">
            Generează articole profesionale cu personaje editoriale AI
          </p>
        </div>
        {msg && (
          <span className={`font-sans text-[12px] px-3 py-1.5 ${
            msg.startsWith('Eroare') ? 'text-red-400 bg-red-400/10 border border-red-400/20' : 'text-green-400 bg-green-400/10 border border-green-400/20'
          }`}>
            {msg}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">

        {/* ══ LEFT: Controls ═══════════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Journalist persona */}
          <div className={secCls}>
            <p className={secTitle}>Jurnalist / Persona AI</p>
            <div className="space-y-1.5">
              {EDITORS.map(e => (
                <button key={e.value} onClick={() => setEditor(e.value)}
                  className={
                    'w-full flex items-center justify-between px-3 py-2.5 border transition-colors ' +
                    (editor === e.value
                      ? 'bg-brand-red/10 border-brand-red text-white'
                      : 'border-white/[0.07] text-white/50 hover:text-white hover:border-white/20')
                  }
                >
                  <span className="font-sans text-[13px] font-medium">{e.label}</span>
                  <span className="font-sans text-[11px] text-white/30">{e.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Word count */}
          <div className={secCls}>
            <p className={secTitle}>Lungime articol</p>
            <div className="flex gap-2">
              {WORD_COUNTS.map(wc => (
                <button key={wc.value} onClick={() => setWordCount(wc.value)}
                  className={
                    'flex-1 flex flex-col items-center py-2.5 border transition-colors ' +
                    (wordCount === wc.value
                      ? 'bg-brand-red border-brand-red text-white'
                      : 'border-white/[0.07] text-white/50 hover:text-white')
                  }
                >
                  <span className="font-sans text-[14px] font-bold">{wc.label}</span>
                  <span className="font-sans text-[10px] text-white/40">{wc.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className={secCls}>
            <p className={secTitle}>Categorie</p>
            <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Brief / prompt */}
          <div className={secCls}>
            <p className={secTitle}>Brief editorial</p>
            <textarea
              className={textaCls}
              rows={7}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Descrie subiectul, unghiul, contextul, tonul dorit...

Ex: Analiza măsurilor de austeritate ale guvernului român din perspectiva impactului asupra clasei de mijloc, cu referire la ultimele date INS.

Cu cât brieful e mai specific, cu atât articolul e mai precis."
            />
            {genError && (
              <p className="font-sans text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2">
                {genError}
              </p>
            )}
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={generating || !prompt.trim()}
            className="w-full flex items-center justify-center gap-3 py-4 bg-brand-red text-white font-sans text-[13px] font-bold uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează articol...</>
              : <><Wand2 className="w-4 h-4" /> Generează cu AI</>
            }
          </button>

          {generating && (
            <div className="bg-[#1a1a1a] border border-purple-500/20 p-4 text-center space-y-1.5">
              <p className="font-sans text-[12px] text-purple-300">
                {EDITORS.find(e => e.value === editor)?.label} scrie articolul...
              </p>
              <p className="font-sans text-[11px] text-purple-300/40">
                {wordCount} cuvinte · RO + EN · titlu psihologic · SEO
              </p>
            </div>
          )}
        </div>

        {/* ══ RIGHT: Result ════════════════════════════════════════════════ */}
        {!generated ? (
          <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center min-h-[600px] p-8 text-center">
            <Wand2 className="w-16 h-16 text-white/[0.05] mb-5" />
            <p className="font-serif text-xl text-white/20 mb-2">Articolul generat va apărea aici</p>
            <p className="font-sans text-[12px] text-white/10 max-w-sm">
              Alege jurnalistul AI · lungimea · categoria<br/>
              Scrie brieful · apasă Generează
            </p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Action bar */}
            <div className="flex items-center justify-between">
              <p className="font-sans text-[12px] text-white/30">
                Editează orice câmp înainte de publicare
              </p>
              <div className="flex gap-2">
                <button onClick={() => saveArticle('draft')} disabled={saving}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> Salvează ciornă
                </button>
                <button onClick={() => saveArticle('published')} disabled={saving}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                  <Globe className="w-3.5 h-3.5" /> Publică acum
                </button>
              </div>
            </div>

            {/* ① TITLURI */}
            <div className={secCls}>
              <p className={secTitle}>① Titluri</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Titlu principal (RO)">
                  <input className={inputCls} value={titleRo}
                    onChange={e => { setTitleRo(e.target.value); if (!slug) setSlug(toSlug(e.target.value)) }} />
                </F>
                <F label="Title (EN)">
                  <input className={inputCls} value={titleEn} onChange={e => setTitleEn(e.target.value)} />
                </F>
              </div>
            </div>

            {/* ② REZUMAT + EXCERPT */}
            <div className={secCls}>
              <p className={secTitle}>② Rezumat & Introducere</p>
              <p className="font-sans text-[10px] text-white/20 -mt-2">
                Rezumatul apare înainte de imagine pe pagina articolului. Este folosit și ca sursă pentru generarea imaginii copertă.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Rezumat (RO) — apare pe articol înainte de imagine">
                  <textarea rows={5} className={textaCls} value={summaryRo}
                    onChange={e => setSummaryRo(e.target.value)}
                    placeholder="Punctele cheie ale articolului..." />
                </F>
                <F label="Summary (EN)">
                  <textarea rows={5} className={textaCls} value={summaryEn}
                    onChange={e => setSummaryEn(e.target.value)} />
                </F>
                <F label="Excerpt / Introducere (RO)">
                  <textarea rows={3} className={textaCls} value={excerptRo}
                    onChange={e => setExcerptRo(e.target.value)} />
                </F>
                <F label="Excerpt / Introduction (EN)">
                  <textarea rows={3} className={textaCls} value={excerptEn}
                    onChange={e => setExcerptEn(e.target.value)} />
                </F>
              </div>
            </div>

            {/* ③ IMAGINE COPERTĂ */}
            <div className={secCls}>
              <p className={secTitle}>③ Imagine copertă</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-3">
                  <F label="URL imagine (sau generează automat)">
                    <input className={inputCls} value={coverImage}
                      onChange={e => setCoverImage(e.target.value)}
                      placeholder="https://... sau lasă gol" />
                  </F>
                  <button
                    onClick={generateCoverImage}
                    disabled={generatingImg}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600/20 border border-blue-500/30 text-blue-300 font-sans text-[12px] font-bold uppercase tracking-wider hover:bg-blue-600/30 transition-colors disabled:opacity-50"
                  >
                    {generatingImg
                      ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează imaginea...</>
                      : <><ImageIcon className="w-4 h-4" /> Generează imagine din rezumat</>
                    }
                  </button>
                  <p className="font-sans text-[10px] text-white/20">
                    AI generează imaginea editorial folosind titlul și rezumatul articolului ca sursă. HuggingFace FLUX.1 → fallback OpenAI DALL-E 3.
                  </p>
                </div>
                <div>
                  {coverImage ? (
                    <div className="space-y-2">
                      <img src={coverImage} alt="Cover" className="w-full aspect-video object-cover" />
                      <button onClick={() => setCoverImage('')}
                        className="font-sans text-[11px] text-white/30 hover:text-red-400 transition-colors">
                        ✕ Șterge imaginea
                      </button>
                    </div>
                  ) : (
                    <div className="border border-white/[0.07] border-dashed aspect-video flex items-center justify-center">
                      <div className="text-center space-y-1">
                        <ImageIcon className="w-8 h-8 text-white/10 mx-auto" />
                        <p className="font-sans text-[11px] text-white/20">Nicio imagine</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ④ SEO TAGS */}
            <div className={secCls}>
              <p className={secTitle}>④ SEO Tags</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Tags (RO) — separate prin virgulă">
                  <input className={inputCls} value={tagsRo}
                    onChange={e => setTagsRo(e.target.value)} placeholder="tag-ro-1, tag-ro-2..." />
                  <TagPills value={tagsRo} color="text-brand-red bg-brand-red/10 border-brand-red/20" />
                </F>
                <F label="Tags (EN) — comma separated">
                  <input className={inputCls} value={tagsEn}
                    onChange={e => setTagsEn(e.target.value)} placeholder="tag-en-1, tag-en-2..." />
                  <TagPills value={tagsEn} color="text-blue-300 bg-blue-500/10 border-blue-500/20" />
                </F>
              </div>
            </div>

            {/* ⑤ SEO META */}
            <div className={secCls}>
              <p className={secTitle}>⑤ SEO Meta</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="SEO Title (RO) — max 60 caractere">
                  <input className={inputCls} value={seoTitleRo} onChange={e => setSeoTitleRo(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoTitleRo.length > 60 ? 'text-red-400' : 'text-white/20'}`}>
                    {seoTitleRo.length}/60
                  </span>
                </F>
                <F label="SEO Title (EN) — max 60 chars">
                  <input className={inputCls} value={seoTitleEn} onChange={e => setSeoTitleEn(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoTitleEn.length > 60 ? 'text-red-400' : 'text-white/20'}`}>
                    {seoTitleEn.length}/60
                  </span>
                </F>
                <F label="Meta Description (RO) — max 160 caractere">
                  <textarea rows={2} className={textaCls} value={seoDescRo} onChange={e => setSeoDescRo(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoDescRo.length > 160 ? 'text-red-400' : 'text-white/20'}`}>
                    {seoDescRo.length}/160
                  </span>
                </F>
                <F label="Meta Description (EN) — max 160 chars">
                  <textarea rows={2} className={textaCls} value={seoDescEn} onChange={e => setSeoDescEn(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoDescEn.length > 160 ? 'text-red-400' : 'text-white/20'}`}>
                    {seoDescEn.length}/160
                  </span>
                </F>
              </div>
            </div>

            {/* ⑥ CONȚINUT COMPLET */}
            <div className={secCls}>
              <div className="flex items-center justify-between">
                <p className={secTitle} style={{marginBottom:0}}>⑥ Conținut complet</p>
                <div className="flex gap-1 mb-3">
                  {(['ro', 'en'] as const).map(l => (
                    <button key={l} onClick={() => setContentTab(l)}
                      className={
                        'font-sans text-[11px] uppercase tracking-wider px-3 py-1.5 border transition-colors ' +
                        (contentTab === l
                          ? 'bg-brand-red border-brand-red text-white'
                          : 'border-white/[0.07] text-white/40 hover:text-white')
                      }
                    >
                      {l === 'ro' ? '🇷🇴 RO' : '🇬🇧 EN'}
                    </button>
                  ))}
                </div>
              </div>
              {contentTab === 'ro'
                ? <textarea rows={26} className={textaCls} value={contentRo} onChange={e => setContentRo(e.target.value)} placeholder="Conținut în română..." />
                : <textarea rows={26} className={textaCls} value={contentEn} onChange={e => setContentEn(e.target.value)} placeholder="Content in English..." />
              }
            </div>

            {/* ⑦ METADATE */}
            <div className={secCls}>
              <p className={secTitle}>⑦ Metadate & Publicare</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Slug URL">
                  <input className={inputCls} value={slug} onChange={e => setSlug(e.target.value)} />
                </F>
                <F label="Autor — liber editabil">
                  <input className={inputCls} value={authorName}
                    onChange={e => setAuthorName(e.target.value)}
                    placeholder="Numele autorului (liber)" />
                </F>
                <F label="Subcategorie">
                  <select className={inputCls} value={subcategory} onChange={e => setSubcategory(e.target.value)}>
                    {SUBCATEGORIES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                  </select>
                </F>
                <F label="URL sursă / referință">
                  <input className={inputCls} value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                    placeholder="https://sursa.com/articol" />
                </F>
              </div>
              <label className="flex items-center gap-3 cursor-pointer pt-2">
                <input type="checkbox" checked={isBreaking}
                  onChange={e => setIsBreaking(e.target.checked)}
                  className="accent-brand-red w-4 h-4" />
                <div>
                  <p className="font-sans text-[13px] text-white">⚡ Ultima Oră</p>
                  <p className="font-sans text-[11px] text-white/30">Apare în ticker-ul roșu din header</p>
                </div>
              </label>
            </div>

            {/* Bottom actions */}
            <div className="flex gap-3 pb-8">
              <button onClick={() => saveArticle('draft')} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-[#1a1a1a] border border-white/10 text-white font-sans text-[13px] font-bold hover:border-white/30 transition-colors disabled:opacity-50">
                <Save className="w-4 h-4" /> Salvează ciornă
              </button>
              <button onClick={() => saveArticle('published')} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-brand-red text-white font-sans text-[13px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                <Globe className="w-4 h-4" /> Publică pe site
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
