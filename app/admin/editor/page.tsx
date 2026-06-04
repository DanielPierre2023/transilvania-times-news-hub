'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Wand2, Save, Globe, RefreshCw, Upload, X, Loader2 } from 'lucide-react'

// ─── EDITORS ─────────────────────────────────────────────────────────────────
const EDITORS = [
  { key: 'daniel_dobos',     label: 'Daniel Dobos',     desk: 'Tehnologie & Business · NYT-grade' },
  { key: 'andrei_popescu',   label: 'Andrei Popescu',   desk: 'Politică & Investigații'           },
  { key: 'elena_vasilescu',  label: 'Elena Vasilescu',  desk: 'Știință & Cultură'                 },
  { key: 'lucian_bratu',     label: 'Lucian Bratu',     desk: 'Cronicar Regional & Patrimoniu'    },
  { key: 'mihai_ionescu',    label: 'Mihai Ionescu',    desk: 'Tehnologie & Inovație'             },
  { key: 'sofia_marinescu',  label: 'Sofia Marinescu',  desk: 'Sănătate & Date'                   },
  { key: 'victor_simon',     label: 'Victor Simon',     desk: 'Știri Generale · Registru Wire'    },
  { key: 'marcus_webb',      label: 'Marcus Webb',      desk: 'Corespondent Internațional'        },
  { key: 'mihai_isac',       label: 'Mihai Isac',       desk: 'Știri & Investigații Daily'        },
] as const

// ─── EDITOR → AUTHOR SLUG MAP ──────────────────────────────────────────────
const EDITOR_SLUG_MAP: Record<string, string> = {
  daniel_dobos: 'daniel-dobos',
  andrei_popescu: 'andrei-popescu',
  elena_vasilescu: 'elena-vasilescu',
  lucian_bratu: 'lucian-bratu',
  sofia_marinescu: 'sofia-marinescu',
  mihai_ionescu: 'mihai-ionescu',
  victor_simon: 'victor-simon',
  marcus_webb: 'marcus-webb',
  mihai_isac: 'mihai-isac',
}

// ─── ARTICLE TYPES ───────────────────────────────────────────────────────────
const ARTICLE_TYPES = [
  { value: 'news',       label: 'Știre',      emoji: '📰', hint: 'Lead 5W în 25 cuvinte · atribuit · paragrafe scurte · fără persoana întâi'        },
  { value: 'analiza',    label: 'Analiză',    emoji: '🔬', hint: 'Întrebare analitică · perspective multiple · date · concluzie deschisă'           },
  { value: 'editorial',  label: 'Editorial',  emoji: '✒️', hint: 'Teză fermă · argumentare · verdict · persoana întâi permisă pentru judecată'      },
  { value: 'opinie',     label: 'Opinie',     emoji: '💭', hint: 'Columnă semnată · persoana întâi disciplinată · teză clară în primele 100 cuv.' },
  { value: 'pamflet',    label: 'Pamflet',    emoji: '⚡', hint: 'Caragiale / Cațavencu · ținta numită · citate exacte · sentință elegantă'         },
  { value: 'reportaj',   label: 'Reportaj',   emoji: '🎥', hint: 'Scenă cu detaliu senzorial · personaje cu nume · tensiune · fără persoana întâi'  },
  { value: 'cultura',    label: 'Cultură',    emoji: '🎭', hint: 'Critică · context istoric · operă pe propriii termeni · fără persoana întâi'      },
  { value: 'tehnologie', label: 'Tehnologie', emoji: '💻', hint: 'Fapt tehnic specific · jargonul definit · decizia urmărită · fără persoana întâi' },
  { value: 'blog',       label: 'Blog',       emoji: '📝', hint: 'ESEU PERSONAL · persoana întâi obligatorie · folosește doar dacă EXPERIENȚA TA este subiectul' },
] as const

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

const COUNTIES: { value: string; label: string }[] = [
  { value: 'alba',            label: 'Alba' },
  { value: 'bihor',           label: 'Bihor' },
  { value: 'bistrita-nasaud', label: 'Bistrița-Năsăud' },
  { value: 'brasov',          label: 'Brașov' },
  { value: 'cluj',            label: 'Cluj' },
  { value: 'covasna',         label: 'Covasna' },
  { value: 'harghita',        label: 'Harghita' },
  { value: 'hunedoara',       label: 'Hunedoara' },
  { value: 'maramures',       label: 'Maramureș' },
  { value: 'mures',           label: 'Mureș' },
  { value: 'salaj',           label: 'Sălaj' },
  { value: 'satu-mare',       label: 'Satu Mare' },
  { value: 'sibiu',           label: 'Sibiu' },
  { value: 'national',        label: 'Național (în afara Transilvaniei)' },
]

function buildBrief(topic: string, wordCount: number, articleType: string): string {
  const note = articleType === 'news'
    ? '\n\nTIP: ȘTIRE — inverted pyramid, atribuit, fără persoana întâi.'
    : articleType === 'blog'
      ? '\n\nTIP: ESEU PERSONAL — persoana întâi obligatorie; subiectul este experiența autorului.'
      : ''

  return `SUBIECT EDITORIAL:
${topic}

PARAMETRI:
- Lungime țintă: ~${wordCount} cuvinte per limbă.
- Generează NATIV în română ȘI în engleză simultan.
- Tip articol: ${articleType.toUpperCase()}.${note}`
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

// ─── IMAGE SECTION ────────────────────────────────────────────────────────────

function ImageSection({
  coverImage, setCoverImage,
  titleRo, titleEn, summaryRo, summaryEn,
  onGenerate, generating,
}: {
  coverImage: string
  setCoverImage: (v: string) => void
  titleRo: string; titleEn: string
  summaryRo: string; summaryEn: string
  onGenerate: () => void
  generating: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setUploadError('Selectați un fișier imagine'); return }
    if (file.size > 10 * 1024 * 1024) { setUploadError('Imaginea trebuie să fie sub 10MB'); return }

    setUploading(true)
    setUploadError('')
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('blog-images').upload(fileName, file, {
        contentType: file.type, upsert: false
      })
      if (error) throw error
      const { data } = supabase.storage.from('blog-images').getPublicUrl(fileName)
      setCoverImage(data.publicUrl)
    } catch (err) {
      setUploadError(`Eroare upload: ${(err as Error).message}`)
    }
    setUploading(false)
    e.target.value = ''
  }

  const inp = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"

  return (
    <div className="space-y-3">
      {coverImage && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverImage} alt="Cover" className="w-full aspect-video object-cover" />
          <button onClick={() => setCoverImage('')}
            className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div>
        <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">
          URL imagine
        </label>
        <input className={inp} value={coverImage} onChange={e => setCoverImage(e.target.value)}
          placeholder="https://... sau folosește butoanele de mai jos" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className={
          'flex items-center justify-center gap-2 py-3 border font-sans text-[11px] font-bold uppercase tracking-wider cursor-pointer transition-colors ' +
          (uploading ? 'border-white/10 text-white/30 cursor-not-allowed' : 'border-white/20 text-white/60 hover:text-white hover:border-white/40')
        }>
          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Upload...</> : <><Upload className="w-3.5 h-3.5" /> De pe calculator</>}
        </label>

        <button onClick={onGenerate} disabled={generating || (!titleRo && !titleEn)}
          className="flex items-center justify-center gap-2 py-3 bg-blue-600/20 border border-blue-500/30 text-blue-300 font-sans text-[11px] font-bold uppercase tracking-wider hover:bg-blue-600/30 transition-colors disabled:opacity-50">
          {generating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generează...</> : <><Wand2 className="w-3.5 h-3.5" /> Generează AI</>}
        </button>
      </div>

      {uploadError && (
        <p className="font-sans text-[11px] text-red-400 bg-red-400/10 px-3 py-2">{uploadError}</p>
      )}
      <p className="font-sans text-[10px] text-white/20">
        Upload: JPG/PNG/WebP max 10MB. AI: HuggingFace FLUX / Pollinations FLUX / Unsplash.
      </p>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter()

  const [editorKey,    setEditorKey]    = useState<string>('daniel_dobos')
  const [articleType,  setArticleType]  = useState<string>('news')
  const [wordCount,    setWordCount]    = useState(1200)
  const [category,     setCategory]     = useState('news')
  const [county,       setCounty]       = useState('cluj')
  const [topic,        setTopic]        = useState('')

  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated]   = useState(false)
  const [genError, setGenError]     = useState('')

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
  const [seoTitleRo, setSeoTitleRo]   = useState('')
  const [seoTitleEn, setSeoTitleEn]   = useState('')
  const [seoDescRo, setSeoDescRo]     = useState('')
  const [seoDescEn, setSeoDescEn]     = useState('')

  const [slug, setSlug]               = useState('')
  const [authorName, setAuthorName]   = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [sourceUrl, setSourceUrl]     = useState('')
  const [isBreaking, setIsBreaking]   = useState(false)

  const [coverImage, setCoverImage]             = useState('')
  const [coverImageCredit, setCoverImageCredit] = useState('')
  const [generatingImg, setGeneratingImg]       = useState(false)

  const [contentTab, setContentTab] = useState<'ro' | 'en'>('ro')
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(''), 5000) }

  function toSlug(t: string) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').substring(0, 80)
  }

  // ── AUTHOR ID LOOKUP ──────────────────────────────────────────────────────
  // Queries the authors table by slug to get the UUID. This links the article
  // to the full author profile (avatar, bio, title) so AuthorByline shows the
  // photo instead of just the initial letter.

  async function getAuthorIdByKey(key: string): Promise<string | null> {
    const slug = EDITOR_SLUG_MAP[key]
    if (!slug) return null
    const { data } = await supabase
      .from('authors')
      .select('id')
      .eq('slug', slug)
      .single()
    return (data as { id: string } | null)?.id ?? null
  }

  // ── GENERATE ARTICLE ───────────────────────────────────────────────────────

  async function generate() {
    if (!topic.trim()) { setGenError('Introduceți brieful editorial.'); return }
    setGenerating(true)
    setGenError('')
    setGenerated(false)
    setCoverImage('')
    setCoverImageCredit('')

    try {
      const { data, error } = await supabase.functions.invoke('tt-generate-article', {
        body: {
          prompt:       buildBrief(topic, wordCount, articleType),
          word_count:   wordCount,
          category,
          article_type: articleType,
          editor_key:   editorKey,
          county,
        }
      })
      if (error) throw new Error(error.message)
      if (!data)  throw new Error('Niciun răspuns de la AI.')

      setTitleRo(data.title_ro   || '')
      setTitleEn(data.title_en   || '')
      setSummaryRo(data.summary_ro || '')
      setSummaryEn(data.summary_en || '')
      setExcerptRo(data.excerpt_ro || '')
      setExcerptEn(data.excerpt_en || '')
      setContentRo(data.content_ro || '')
      setContentEn(data.content_en || '')
      setTagsRo(Array.isArray(data.tags_ro) ? data.tags_ro.join(', ') : '')
      setTagsEn(Array.isArray(data.tags_en) ? data.tags_en.join(', ') : (Array.isArray(data.tags) ? data.tags.join(', ') : ''))
      setSeoTitleRo(data.seo_title_ro || '')
      setSeoTitleEn(data.seo_title_en || '')
      setSeoDescRo(data.seo_description_ro || '')
      setSeoDescEn(data.seo_description_en || '')
      setSlug(data.slug || toSlug(data.title_ro || data.title_en || ''))

      if (data.author_name && !authorName) {
        setAuthorName(data.author_name as string)
      }

      setGenerated(true)
      setContentTab('ro')
      flash('✓ Articol generat — generez imaginea...')

      generateCoverImage(
        data.title_ro || data.title_en,
        data.summary_ro || data.summary_en || data.excerpt_ro
      )
    } catch (e) {
      setGenError(`Eroare: ${(e as Error).message}`)
    }
    setGenerating(false)
  }

  async function generateCoverImage(overrideTitle?: string, overrideSummary?: string) {
    const imgTitle   = overrideTitle   || titleRo || titleEn
    const imgSummary = overrideSummary || summaryRo || summaryEn || excerptRo
    if (!imgTitle) { flash('Generați articolul mai întâi sau completați titlul.'); return }

    setGeneratingImg(true)
    try {
      const { data, error } = await supabase.functions.invoke('tt-generate-cover', {
        body: { title: imgTitle, summary: imgSummary, category }
      })
      if (error) throw new Error(error.message)
      if (data?.publicUrl) {
        setCoverImage(data.publicUrl)
        if (data.isAiGenerated !== false) {
          setCoverImageCredit('Imagine generată cu inteligență artificială')
        }
        flash('✓ Imagine generată')
      } else {
        throw new Error(data?.error || 'Eroare generare imagine.')
      }
    } catch (e) {
      flash(`Eroare imagine: ${(e as Error).message}`)
    }
    setGeneratingImg(false)
  }

  // ── SAVE ───────────────────────────────────────────────────────────────────

  async function saveArticle(newStatus: 'draft' | 'published') {
    setSaving(true)
    const finalSlug = (slug || toSlug(titleRo || titleEn)) + '-' + Date.now().toString(36)

    // Look up the author UUID from the authors table so the article gets
    // linked to the full profile (avatar, bio, title). Without this, the
    // AuthorByline component only shows the initial letter.
    const authorId = await getAuthorIdByKey(editorKey)

    const payload: Record<string, unknown> = {
      title_ro: titleRo || null, title_en: titleEn || null,
      summary_ro: summaryRo || null, summary_en: summaryEn || null,
      excerpt_ro: excerptRo || null, excerpt_en: excerptEn || null,
      content_ro: contentRo || null, content_en: contentEn || null,
      tags_ro: tagsRo.split(',').map(t => t.trim()).filter(Boolean),
      tags_en: tagsEn.split(',').map(t => t.trim()).filter(Boolean),
      cover_image: coverImage || null,
      cover_image_credit: coverImageCredit || null,
      category, subcategory: subcategory || null,
      county,
      author_name: authorName || null,
      author_id: authorId,
      source_url: sourceUrl || null,
      is_breaking: isBreaking,
      slug: finalSlug, status: newStatus,
      published_at: newStatus === 'published' ? new Date().toISOString() : null,
    }
    const { data: saved, error } = await supabase.from('blog_posts').insert(payload as never).select('id, slug').single()
    if (error || !saved) { flash(`Eroare: ${error?.message}`); setSaving(false); return }
    if (newStatus === 'published') {
      await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${saved.slug}`, { method: 'POST' })
      flash('✓ Publicat și live pe site')
    } else {
      flash('✓ Salvat ca ciornă')
    }
    setSaving(false)
    setTimeout(() => router.push(`/admin/articles/${saved.id}/edit`), 1500)
  }

  // ── STYLES ─────────────────────────────────────────────────────────────────

  const inp = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
  const ta  = inp + " resize-none leading-relaxed"
  const sec = "bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4"
  const sh  = "font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3 mb-1"

  function Pills({ value, cls }: { value: string; cls: string }) {
    const tags = value.split(',').map(t => t.trim()).filter(Boolean)
    if (!tags.length) return null
    return <div className="flex flex-wrap gap-1.5 mt-2">
      {tags.map(t => <span key={t} className={`font-sans text-[10px] px-2 py-0.5 border ${cls}`}>{t}</span>)}
    </div>
  }

  const currentEditor = EDITORS.find(e => e.key === editorKey) || EDITORS[0]
  const currentType   = ARTICLE_TYPES.find(t => t.value === articleType) || ARTICLE_TYPES[0]

  return (
    <div className="max-w-7xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Editor AI</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">
            v10 · 9 semnături · 9 tipuri · NYT-grade tech-business pentru Daniel Dobos
          </p>
        </div>
        {msg && (
          <span className={`font-sans text-[12px] px-3 py-1.5 border ${
            msg.startsWith('Eroare') ? 'text-red-400 bg-red-400/10 border-red-400/20'
            : 'text-green-400 bg-green-400/10 border-green-400/20'
          }`}>{msg}</span>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">

        {/* ── LEFT ─────────────────────────────────────────────────────── */}
        <div className="space-y-4">

          <div className={sec}>
            <p className={sh}>Semnătură (editor)</p>
            <select className={inp} value={editorKey} onChange={e => setEditorKey(e.target.value)}>
              {EDITORS.map(ed => (
                <option key={ed.key} value={ed.key}>{ed.label} — {ed.desk}</option>
              ))}
            </select>
            <p className="font-sans text-[10px] text-white/30 italic leading-relaxed">
              {currentEditor.desk}. Vocea editorului se aplică peste tipul articolului
              — Daniel Dobos scriind o știre = reportaj tech-business NYT-grade, nu o
              știre generică cu numele lui pe ea.
            </p>
          </div>

          <div className={sec}>
            <p className={sh}>Tip articol</p>
            <div className="grid grid-cols-3 gap-2">
              {ARTICLE_TYPES.map(t => (
                <button key={t.value} onClick={() => setArticleType(t.value)}
                  className={
                    'flex items-center justify-center gap-1.5 px-2 py-2 border font-sans text-[11px] transition-colors ' +
                    (articleType === t.value
                      ? 'bg-brand-red border-brand-red text-white'
                      : 'border-white/[0.07] text-white/50 hover:text-white hover:border-white/20')
                  }
                ><span>{t.emoji}</span>{t.label}</button>
              ))}
            </div>
            <p className="font-sans text-[10px] text-white/40 italic leading-relaxed">
              {currentType.hint}
            </p>
          </div>

          <div className={sec}>
            <p className={sh}>Lungime</p>
            <div className="flex gap-2">
              {WORD_COUNTS.map(wc => (
                <button key={wc.value} onClick={() => setWordCount(wc.value)}
                  className={
                    'flex-1 flex flex-col items-center py-2.5 border transition-colors ' +
                    (wordCount === wc.value ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/50 hover:text-white')
                  }
                >
                  <span className="font-sans text-[14px] font-bold">{wc.label}</span>
                  <span className="font-sans text-[10px] text-white/40">{wc.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={sec}>
            <p className={sh}>Categorie</p>
            <select className={inp} value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className={sec}>
            <p className={sh}>Județ</p>
            <select className={inp} value={county} onChange={e => setCounty(e.target.value)}>
              {COUNTIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="font-sans text-[11px] text-white/40 mt-1">
              Articolul va apărea pe pagina județului ales. Folosește {'„Național"'} pentru subiecte din afara Transilvaniei.
            </p>
          </div>

          <div className={sec}>
            <p className={sh}>Brief editorial</p>
            <textarea className={ta} rows={7} value={topic} onChange={e => setTopic(e.target.value)}
              placeholder={
                articleType === 'pamflet'
                  ? 'Ex: Un politician promite transparență totală la exact o lună după ce dosarul lui a fost clasat...'
                  : articleType === 'news'
                    ? 'Ex: Consiliul Județean Cluj a aprobat astăzi un buget de 12,4 milioane lei pentru renovarea Spitalului Județean...'
                    : 'Descrie subiectul, unghiul, contextul dorit...'
              }
            />
            {genError && (
              <p className="font-sans text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2">{genError}</p>
            )}
          </div>

          <button onClick={generate} disabled={generating || !topic.trim()}
            className="w-full flex items-center justify-center gap-3 py-4 bg-brand-red text-white font-sans text-[13px] font-bold uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează articol...</>
              : <><Wand2 className="w-4 h-4" /> Generează cu AI</>
            }
          </button>

          {generating && (
            <div className="bg-[#1a1a1a] border border-purple-500/20 p-4 text-center space-y-1">
              <p className="font-sans text-[12px] text-purple-300">
                {currentEditor.label} scrie {currentType.label.toLowerCase()}...
              </p>
              <p className="font-sans text-[11px] text-purple-300/40">
                {wordCount} cuvinte · RO + EN · 4 desk-uri · ~90s
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT ────────────────────────────────────────────────────── */}
        {!generated ? (
          <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center min-h-[600px] p-8 text-center">
            <Wand2 className="w-16 h-16 text-white/[0.05] mb-5" />
            <p className="font-serif text-xl text-white/20 mb-2">Articolul generat va apărea aici</p>
            <p className="font-sans text-[12px] text-white/10 max-w-xs">
              Selectează semnătura · tipul · lungimea · categoria · scrie brieful · apasă Generează
            </p>
          </div>
        ) : (
          <div className="space-y-4">

            <div className="flex items-center justify-between">
              <p className="font-sans text-[12px] text-white/30">
                Editează orice câmp înainte de publicare · Semnătură: <span className="text-white/60">{authorName || currentEditor.label}</span>
              </p>
              <div className="flex gap-2">
                <button onClick={() => saveArticle('draft')} disabled={saving}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" /> Ciornă
                </button>
                <button onClick={() => saveArticle('published')} disabled={saving}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                  <Globe className="w-3.5 h-3.5" /> Publică acum
                </button>
              </div>
            </div>

            {/* ① TITLURI */}
            <div className={sec}>
              <p className={sh}>① Titluri</p>
              <div className="grid md:grid-cols-2 gap-4">
                <F label="Titlu principal (RO)">
                  <input className={inp} value={titleRo}
                    onChange={e => { setTitleRo(e.target.value); if (!slug) setSlug(toSlug(e.target.value)) }} />
                </F>
                <F label="Title (EN)">
                  <input className={inp} value={titleEn} onChange={e => setTitleEn(e.target.value)} />
                </F>
              </div>
            </div>

            {/* ② REZUMAT */}
            <div className={sec}>
              <p className={sh}>② Rezumat & Introducere</p>
              <p className="font-sans text-[10px] text-white/20 -mt-2 mb-1">Rezumatul apare pe articol înainte de imagine. Este folosit și pentru generarea imaginii copertă.</p>
              <div className="grid md:grid-cols-2 gap-4">
                <F label="Rezumat bullets (RO)">
                  <textarea rows={5} className={ta} value={summaryRo} onChange={e => setSummaryRo(e.target.value)} placeholder="• Punct 1&#10;• Punct 2&#10;• Punct 3" />
                </F>
                <F label="Summary (EN)">
                  <textarea rows={5} className={ta} value={summaryEn} onChange={e => setSummaryEn(e.target.value)} />
                </F>
                <F label="Excerpt / Introducere (RO)">
                  <textarea rows={3} className={ta} value={excerptRo} onChange={e => setExcerptRo(e.target.value)} />
                </F>
                <F label="Excerpt / Introduction (EN)">
                  <textarea rows={3} className={ta} value={excerptEn} onChange={e => setExcerptEn(e.target.value)} />
                </F>
              </div>
            </div>

            {/* ③ IMAGINE */}
            <div className={sec}>
              <p className={sh}>③ Imagine copertă</p>
              <ImageSection
                coverImage={coverImage}
                setCoverImage={setCoverImage}
                titleRo={titleRo} titleEn={titleEn}
                summaryRo={summaryRo} summaryEn={summaryEn}
                onGenerate={() => generateCoverImage()}
                generating={generatingImg}
              />
              <F label="Sursă / creditare fotografie">
                <input
                  className={inp}
                  value={coverImageCredit}
                  onChange={e => setCoverImageCredit(e.target.value)}
                  placeholder="Imagine generată cu inteligență artificială / © Reuters / Arhivă"
                />
              </F>
              {coverImageCredit && (
                <p className="font-sans text-[10px] text-blue-400/60">
                  {coverImageCredit.toLowerCase().includes('generat') ? '🤖' : '📷'} Afișat sub fotografie: {'„'}{coverImageCredit}{'"'}
                </p>
              )}
            </div>

            {/* ④ SEO TAGS */}
            <div className={sec}>
              <p className={sh}>④ SEO Tags</p>
              <div className="grid md:grid-cols-2 gap-4">
                <F label="Tags (RO) — separate prin virgulă">
                  <input className={inp} value={tagsRo} onChange={e => setTagsRo(e.target.value)} placeholder="tag-ro-1, tag-ro-2..." />
                  <Pills value={tagsRo} cls="text-brand-red bg-brand-red/10 border-brand-red/20" />
                </F>
                <F label="Tags (EN) — comma separated">
                  <input className={inp} value={tagsEn} onChange={e => setTagsEn(e.target.value)} placeholder="tag-en-1, tag-en-2..." />
                  <Pills value={tagsEn} cls="text-blue-300 bg-blue-500/10 border-blue-500/20" />
                </F>
              </div>
            </div>

            {/* ⑤ SEO META */}
            <div className={sec}>
              <p className={sh}>⑤ SEO Meta</p>
              <div className="grid md:grid-cols-2 gap-4">
                <F label="SEO Title (RO) — max 60 caractere">
                  <input className={inp} value={seoTitleRo} onChange={e => setSeoTitleRo(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoTitleRo.length > 60 ? 'text-red-400' : 'text-white/20'}`}>{seoTitleRo.length}/60</span>
                </F>
                <F label="SEO Title (EN) — max 60 chars">
                  <input className={inp} value={seoTitleEn} onChange={e => setSeoTitleEn(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoTitleEn.length > 60 ? 'text-red-400' : 'text-white/20'}`}>{seoTitleEn.length}/60</span>
                </F>
                <F label="Meta Description (RO) — max 160">
                  <textarea rows={2} className={ta} value={seoDescRo} onChange={e => setSeoDescRo(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoDescRo.length > 160 ? 'text-red-400' : 'text-white/20'}`}>{seoDescRo.length}/160</span>
                </F>
                <F label="Meta Description (EN) — max 160">
                  <textarea rows={2} className={ta} value={seoDescEn} onChange={e => setSeoDescEn(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoDescEn.length > 160 ? 'text-red-400' : 'text-white/20'}`}>{seoDescEn.length}/160</span>
                </F>
              </div>
            </div>

            {/* ⑥ CONȚINUT */}
            <div className={sec}>
              <div className="flex items-center justify-between mb-3">
                <p className={sh} style={{marginBottom:0}}>⑥ Conținut complet</p>
                <div className="flex gap-1">
                  {(['ro','en'] as const).map(l => (
                    <button key={l} onClick={() => setContentTab(l)}
                      className={
                        'font-sans text-[11px] uppercase tracking-wider px-3 py-1.5 border transition-colors ' +
                        (contentTab === l ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/40 hover:text-white')
                      }
                    >{l === 'ro' ? '🇷🇴 RO' : '🇬🇧 EN'}</button>
                  ))}
                </div>
              </div>
              {contentTab === 'ro'
                ? <textarea rows={26} className={ta} value={contentRo} onChange={e => setContentRo(e.target.value)} placeholder="Conținut în română..." />
                : <textarea rows={26} className={ta} value={contentEn} onChange={e => setContentEn(e.target.value)} placeholder="Content in English..." />
              }
            </div>

            {/* ⑦ METADATE */}
            <div className={sec}>
              <p className={sh}>⑦ Metadate & Publicare</p>
              <div className="grid md:grid-cols-2 gap-4">
                <F label="Slug URL">
                  <input className={inp} value={slug} onChange={e => setSlug(e.target.value)} />
                </F>
                <F label="Autor (din semnătură, editabil)">
                  <input
                    className={inp}
                    value={authorName}
                    onChange={e => setAuthorName(e.target.value)}
                    placeholder={currentEditor.label}
                    autoComplete="off"
                  />
                </F>
                <F label="Subcategorie">
                  <select className={inp} value={subcategory} onChange={e => setSubcategory(e.target.value)}>
                    {SUBCATEGORIES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                  </select>
                </F>
                <F label="URL sursă / referință">
                  <input className={inp} value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." />
                </F>
              </div>
              <label className="flex items-center gap-3 cursor-pointer pt-2">
                <input type="checkbox" checked={isBreaking} onChange={e => setIsBreaking(e.target.checked)} className="accent-brand-red w-4 h-4" />
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
