'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Wand2, Save, Globe, RefreshCw, Image as ImageIcon, ChevronDown, ChevronUp } from 'lucide-react'

// ─── ARTICLE TYPES ───────────────────────────────────────────────────────────

const ARTICLE_TYPES = [
  { value: 'editorial',  label: 'Editorial',  emoji: '✒️' },
  { value: 'analiza',    label: 'Analiză',    emoji: '🔬' },
  { value: 'pamflet',    label: 'Pamflet',    emoji: '⚡' },
  { value: 'blog',       label: 'Blog',       emoji: '📝' },
  { value: 'reportaj',   label: 'Reportaj',   emoji: '📰' },
  { value: 'cultura',    label: 'Cultură',    emoji: '🎭' },
  { value: 'tehnologie', label: 'Tehnologie', emoji: '💻' },
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

// ─── PROMPTS ─────────────────────────────────────────────────────────────────

function buildPrompt(type: string, topic: string, wordCount: number, language: string): string {
  const langInstruction = language === 'ro'
    ? `Scrie EXCLUSIV în limba română. Generează și o versiune completă în engleză.`
    : `Write EXCLUSIVELY in English. Also generate a complete Romanian version.`

  const base = `${langInstruction}

SUBIECT: ${topic}
LUNGIME ȚINTĂ: aproximativ ${wordCount} cuvinte pentru conținut.

CERINȚE TITLU:
- Psihologic puternic: curiozitate, urgență sau emoție autentică
- Tehnici avansate: cifre concrete, paradoxuri, întrebări retorice, declarații surprinzătoare
- Irezistibil de citit, fără clickbait ieftin
- Generează și un TITLU ALTERNATIV

CERINȚE REZUMAT (summary_ro / summary_en):
- 3-4 puncte bullet, fiecare max 15 cuvinte
- Fiecare bullet adaugă informație nouă, nu repetă titlul

CERINȚE SEO (tags_ro / tags_en):
- 6-8 tag-uri relevante și specifice, în limba articolului
- Include variații long-tail

`

  const prompts: Record<string, string> = {
    editorial: `${base}
TIP: EDITORIAL JURNALISTIC DE ÎNALTĂ CLASĂ

1. DESCHIDERE PUTERNICĂ: declarație provocatoare, scenă vie sau statistică șocantă
2. TEZĂ CLARĂ: poziția publicației, fermă și fără echivoc
3. ARGUMENTARE STRATIFICATĂ: 3-4 argumente cu fapte concrete, precedente, citate
4. CONTRAARGUMENT ȘI RESPINGERE: recunoaște perspectiva opusă, apoi demontează-o elegant
5. CONCLUZIE CU CHEMARE LA ACȚIUNE: o propoziție care rămâne în minte

TON: Autoritar, lucid, angajat. Editorialul are o poziție. Vocabular precis, ritm jurnalistic.`,

    analiza: `${base}
TIP: ANALIZĂ APROFUNDATĂ MULTI-DIMENSIONALĂ

1. CONTEXT ȘI MIZĂ: de ce contează ACUM, tabloul mai larg
2. ANATOMIA PROBLEMEI: cauze structurale, nu simptome superficiale
3. PERSPECTIVE MULTIPLE: minimum 3 unghiuri — economic, politic, social, istoric sau geopolitic
4. DATE ȘI EVIDENȚE: fiecare afirmație ancorată în cifre, tendințe sau comparații
5. SCENARII: 2-3 scenarii probabile cu argumente
6. CONCLUZIE ANALITICĂ: sintetică, precisă, cu valoare predictivă

TON: Expert, nuanțat, fără simplificări.`,

    pamflet: `${base}
TIP: PAMFLET — SATIRĂ POLITICĂ/SOCIALĂ (tradiția Swift, Voltaire, Caragiale)

REGULI ABSOLUTE:
1. INTELIGENȚA PRIMEAZĂ: umor fin, stratificat. Sarcasmul taie ca bisturiul, nu ca toporul.
2. ȚINTA PRECISĂ: identifică exact ce/cine e satirizat și de ce. Nu generaliza.
3. STRUCTURA:
   - DESCHIDERE: compliment fals și exagerat față de țintă (laudatio ironică)
   - DESFĂȘURARE: demontarea progresivă cu exemple concrete și comparații devastatoare
   - PUNCT CULMINANT: revelația absurdă — masca cade complet
   - FINAL: concluzie aparent serioasă, dar implacabil de tăioasă
4. TEHNICI: hiperbolă controlată, ironie socratică, analogii incomode, întrebări retorice ucigătoare
5. TITLUL: capodoperă de ironie comprimată — pare serios, e ucigător de satiric
6. Fără vulgaritate, fără atacuri la persoană neverificabilă. Satira pe fapte și declarații publice.`,

    blog: `${base}
TIP: BLOG — VOCE PERSONALĂ, IMPACT REAL

1. DESCHIDERE PERSONALĂ: experiență sau observație care conectează imediat cu cititorul
2. PUNCT DE VEDERE PROPRIU: nu "unii spun că". Ia o poziție. Spune ce crezi TU și de ce.
3. POVESTIRE + INFORMAȚIE: alternează narațiunea cu insight-uri valoroase
4. UMOR SAU AUTOIRONIE: blogul bun nu se ia prea în serios
5. CONCLUZIE PRACTICĂ: ce poate face cititorul cu această informație?

TON: Cald, direct, inteligent fără a fi pedant. Ca și cum explici unui prieten deștept la o cafea.`,

    reportaj: `${base}
TIP: REPORTAJ JURNALISTIC NARATIV

1. SCENĂ DE DESCHIDERE: plasează cititorul în mijlocul acțiunii — detalii senzoriale
2. CONTEXTUL POVEȘTII: cine, ce, unde, când, de ce — ca în narațiune, nu ca în știre
3. VOCI: minimum 2-3 perspective diferite, citate directe
4. TENSIUNEA NARATIVĂ: conflict, problemă nerezolvată, întrebare centrală
5. REZOLUȚIE SAU SUSPENDARE: răspuns sau o întrebare mai mare

TON: Narativ, uman, long-form journalism.`,

    cultura: `${base}
TIP: CRITICĂ CULTURALĂ

1. OPERA/FENOMENUL: descrie cu acuratețe și detaliu relevant
2. CONTEXTUL CULTURAL: situează în curentul artistic, istoric sau social
3. ANALIZA CRITICĂ: nu rezumat — interpretare. Ce spune opera despre epoca ei?
4. COMPARAȚII: pune în dialog cu alte opere, autori sau momente culturale
5. VALOAREA ACTUALĂ: de ce contează azi?

TON: Cultivat, pasionat, accesibil fără vulgarizare.`,

    tehnologie: `${base}
TIP: JURNALISM TECH DE CALITATE

1. NOUTATEA: ce s-a schimbat? de ce acum?
2. FUNCȚIONAREA: explică accesibil, fără jargon inutil, cu analogii clare
3. IMPLICAȚIILE REALE: impact concret asupra oamenilor, business, societății
4. VOCEA CRITICĂ: riscuri, limitări, întrebări nerezolvate
5. PERSPECTIVE GLOBALE: tendințe mai largi

TON: Informat, scepticism sănătos, accesibil.`,
  }

  return prompts[type] || prompts['editorial']
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface GeneratedResult {
  title_ro: string
  title_en: string
  title_alt_ro?: string
  title_alt_en?: string
  summary_ro: string
  summary_en: string
  excerpt_ro: string
  excerpt_en: string
  content_ro: string
  content_en: string
  tags_ro: string[]
  tags_en: string[]
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function toSlug(text: string): string {
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-').substring(0, 80)
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter()

  // Generation params
  const [articleType, setArticleType] = useState('editorial')
  const [wordCount, setWordCount]     = useState(1200)
  const [language, setLanguage]       = useState<'ro' | 'en'>('ro')
  const [category, setCategory]       = useState('opinion')
  const [topic, setTopic]             = useState('')

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [result, setResult]         = useState<GeneratedResult | null>(null)
  const [genError, setGenError]     = useState('')

  // Editable fields (post-generation)
  const [titleRo, setTitleRo]       = useState('')
  const [titleEn, setTitleEn]       = useState('')
  const [titleAltRo, setTitleAltRo] = useState('')
  const [titleAltEn, setTitleAltEn] = useState('')
  const [summaryRo, setSummaryRo]   = useState('')
  const [summaryEn, setSummaryEn]   = useState('')
  const [excerptRo, setExcerptRo]   = useState('')
  const [excerptEn, setExcerptEn]   = useState('')
  const [contentRo, setContentRo]   = useState('')
  const [contentEn, setContentEn]   = useState('')
  const [tagsRo, setTagsRo]         = useState('')
  const [tagsEn, setTagsEn]         = useState('')

  // Metadata
  const [slug, setSlug]               = useState('')
  const [authorName, setAuthorName]   = useState('Transilvania Times Editorial')
  const [subcategory, setSubcategory] = useState('')
  const [sourceUrl, setSourceUrl]     = useState('')
  const [isBreaking, setIsBreaking]   = useState(false)
  const [status, setStatus]           = useState('draft')

  // Cover image
  const [coverImage, setCoverImage]         = useState('')
  const [generatingImg, setGeneratingImg]   = useState(false)
  const [savedPostId, setSavedPostId]       = useState<string | null>(null)

  // UI state
  const [contentTab, setContentTab] = useState<'ro' | 'en'>('ro')
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 4000)
  }

  // ─── GENERATE ARTICLE ──────────────────────────────────────────────────────

  async function generate() {
    if (!topic.trim()) { setGenError('Introduceți subiectul articolului.'); return }
    setGenerating(true)
    setGenError('')
    setResult(null)
    setSavedPostId(null)
    setCoverImage('')

    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-article', {
        body: {
          topic:             topic.trim(),
          article_type:      articleType,
          word_count:        wordCount,
          language,
          category,
          prompt:            buildPrompt(articleType, topic, wordCount, language),
          generate_bilingual: true,
        }
      })
      if (error) throw new Error(error.message)
      if (!data)  throw new Error('Niciun răspuns de la AI.')

      const d = data as GeneratedResult
      setResult(d)

      // Populate all editable fields
      setTitleRo(d.title_ro    || '')
      setTitleEn(d.title_en    || '')
      setTitleAltRo(d.title_alt_ro || '')
      setTitleAltEn(d.title_alt_en || '')
      setSummaryRo(d.summary_ro || '')
      setSummaryEn(d.summary_en || '')
      setExcerptRo(d.excerpt_ro || '')
      setExcerptEn(d.excerpt_en || '')
      setContentRo(d.content_ro || '')
      setContentEn(d.content_en || '')
      setTagsRo(Array.isArray(d.tags_ro) ? d.tags_ro.join(', ') : '')
      setTagsEn(Array.isArray(d.tags_en) ? d.tags_en.join(', ') : '')
      setSlug(toSlug(d.title_ro || d.title_en || ''))
      setContentTab(language)
      flash('✓ Articol generat')
    } catch (e) {
      setGenError(`Eroare: ${(e as Error).message}`)
    }
    setGenerating(false)
  }

  // ─── SAVE (draft or publish) ───────────────────────────────────────────────

  async function saveArticle(newStatus: 'draft' | 'published') {
    setSaving(true)
    const finalSlug = (slug || toSlug(titleRo || titleEn)) + '-' + Date.now().toString(36)

    const payload = {
      title_ro:    titleRo,
      title_en:    titleEn,
      summary_ro:  summaryRo,
      summary_en:  summaryEn,
      excerpt_ro:  excerptRo,
      excerpt_en:  excerptEn,
      content_ro:  contentRo,
      content_en:  contentEn,
      tags_ro:     tagsRo.split(',').map(t => t.trim()).filter(Boolean),
      tags_en:     tagsEn.split(',').map(t => t.trim()).filter(Boolean),
      cover_image: coverImage || null,
      category,
      subcategory: subcategory || null,
      author_name: authorName,
      source_url:  sourceUrl || null,
      is_breaking: isBreaking,
      slug:        finalSlug,
      status:      newStatus,
      published_at: newStatus === 'published' ? new Date().toISOString() : null,
    }

    if (savedPostId) {
      // Update existing draft
      const { error } = await supabase
        .from('blog_posts')
        .update(payload as never)
        .eq('id', savedPostId)
      if (error) { flash(`Eroare: ${error.message}`); setSaving(false); return }
    } else {
      // Insert new
      const { data: saved, error } = await supabase
        .from('blog_posts')
        .insert(payload as never)
        .select('id, slug')
        .single()
      if (error || !saved) { flash(`Eroare: ${error?.message}`); setSaving(false); return }
      setSavedPostId(saved.id)
      if (newStatus === 'published') {
        await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${saved.slug}`, { method: 'POST' })
        flash('✓ Publicat și live pe site')
        setTimeout(() => router.push(`/admin/articles/${saved.id}/edit`), 1500)
      } else {
        flash('✓ Salvat ca ciornă')
      }
    }

    if (savedPostId && newStatus === 'published') {
      await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${finalSlug}`, { method: 'POST' })
      flash('✓ Publicat și live pe site')
      setTimeout(() => router.push(`/admin/articles/${savedPostId}/edit`), 1500)
    }

    setSaving(false)
  }

  // ─── GENERATE COVER IMAGE ──────────────────────────────────────────────────

  async function generateCoverImage() {
    setGeneratingImg(true)
    flash('Generez imaginea copertă...')

    // Need post_id — save draft first if not already saved
    let postId = savedPostId
    if (!postId) {
      const finalSlug = (slug || toSlug(titleRo || titleEn)) + '-' + Date.now().toString(36)
      const { data: saved, error } = await supabase
        .from('blog_posts')
        .insert({
          title_ro:   titleRo,
          title_en:   titleEn,
          summary_ro: summaryRo,
          summary_en: summaryEn,
          content_ro: contentRo,
          content_en: contentEn,
          excerpt_ro: excerptRo,
          excerpt_en: excerptEn,
          category,
          author_name: authorName,
          slug:        finalSlug,
          status:      'draft',
        } as never)
        .select('id')
        .single()

      if (error || !saved) {
        flash(`Nu am putut salva ciorna: ${error?.message}`)
        setGeneratingImg(false)
        return
      }
      postId = saved.id
      setSavedPostId(saved.id)
    }

    // Call generate-cover-image with post_id
    const { error: imgError } = await supabase.functions.invoke('generate-cover-image', {
      body: { post_id: postId }
    })

    if (imgError) {
      flash(`Eroare imagine: ${imgError.message}`)
      setGeneratingImg(false)
      return
    }

    // Fetch the updated cover_image from DB
    const { data: updated } = await supabase
      .from('blog_posts')
      .select('cover_image')
      .eq('id', postId)
      .single()

    if (updated?.cover_image) {
      setCoverImage(updated.cover_image)
      flash('✓ Imagine generată')
    } else {
      flash('Imaginea a fost generată — verifică în DB.')
    }

    setGeneratingImg(false)
  }

  // ─── STYLES ──────────────────────────────────────────────────────────────

  const inputCls     = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
  const textareaCls  = inputCls + " resize-none leading-relaxed"
  const labelCls     = "block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5"
  const sectionCls   = "bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4"
  const sectionTitle = "font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3 mb-4"

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div>
        <label className={labelCls}>{label}</label>
        {children}
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
            Generează articole de înaltă calitate cu AI editorial
          </p>
        </div>
        {msg && (
          <span className={`font-sans text-[12px] px-3 py-1.5 ${
            msg.startsWith('Eroare') ? 'text-red-400 bg-red-400/10' : 'text-green-400 bg-green-400/10'
          }`}>
            {msg}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">

        {/* ══ LEFT: Generation Controls ══════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Article type */}
          <div className={sectionCls}>
            <p className={sectionTitle}>Tip articol</p>
            <div className="grid grid-cols-2 gap-2">
              {ARTICLE_TYPES.map(t => (
                <button key={t.value} onClick={() => setArticleType(t.value)}
                  className={
                    'flex items-center gap-2 px-3 py-2.5 border font-sans text-[12px] transition-colors ' +
                    (articleType === t.value
                      ? 'bg-brand-red border-brand-red text-white'
                      : 'border-white/[0.07] text-white/50 hover:text-white hover:border-white/20')
                  }
                >
                  <span>{t.emoji}</span>{t.label}
                </button>
              ))}
            </div>
            <p className="font-sans text-[10px] text-white/20 italic">
              {articleType === 'pamflet' && 'Swift · Voltaire · Caragiale — satiră tăioasă, umor fin'}
              {articleType === 'editorial' && 'Poziție clară · argumentare solidă · concluzie memorabilă'}
              {articleType === 'analiza' && 'Multi-perspectival · bazat pe fapte · predictiv'}
              {articleType === 'blog' && 'Voce personală · perspectivă unică · ton cald'}
              {articleType === 'reportaj' && 'Narațiune vie · personaje concrete · tensiune'}
              {articleType === 'cultura' && 'Critică nuanțată · context bogat · valoare actuală'}
              {articleType === 'tehnologie' && 'Demistificare clară · impact real · scepticism sănătos'}
            </p>
          </div>

          {/* Word count */}
          <div className={sectionCls}>
            <p className={sectionTitle}>Lungime</p>
            <div className="space-y-2">
              {WORD_COUNTS.map(wc => (
                <button key={wc.value} onClick={() => setWordCount(wc.value)}
                  className={
                    'w-full flex items-center justify-between px-4 py-2.5 border transition-colors ' +
                    (wordCount === wc.value
                      ? 'bg-brand-red/10 border-brand-red text-white'
                      : 'border-white/[0.07] text-white/50 hover:text-white hover:border-white/20')
                  }
                >
                  <span className="font-sans text-[13px] font-medium">{wc.label} cuvinte</span>
                  <span className="font-sans text-[11px] text-white/30">{wc.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Language + Category */}
          <div className={sectionCls}>
            <p className={sectionTitle}>Limbă și categorie</p>
            <Field label="Limbă sursă">
              <div className="flex gap-2">
                {(['ro', 'en'] as const).map(l => (
                  <button key={l} onClick={() => setLanguage(l)}
                    className={
                      'flex-1 py-2.5 font-sans text-[12px] font-bold uppercase tracking-wider border transition-colors ' +
                      (language === l
                        ? 'bg-brand-red border-brand-red text-white'
                        : 'border-white/[0.07] text-white/40 hover:text-white')
                    }
                  >
                    {l === 'ro' ? '🇷🇴 Română' : '🇬🇧 English'}
                  </button>
                ))}
              </div>
              <p className="font-sans text-[10px] text-white/20 mt-1.5">
                Traducerea completă în cealaltă limbă e generată automat
              </p>
            </Field>
            <Field label="Categorie">
              <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          {/* Topic */}
          <div className={sectionCls}>
            <p className={sectionTitle}>Brief editorial</p>
            <textarea
              className={textareaCls}
              rows={6}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder={
                articleType === 'pamflet'
                  ? 'Ex: Un politician promite transparență totală, la exact o lună după ce dosarul său penal a fost clasat. Ironizează cu precizie chirurgicală...'
                  : articleType === 'editorial'
                  ? 'Ex: România trebuie să adopte o strategie națională de educație digitală înainte de 2026, iar clasa politică amână deliberat...'
                  : 'Descrie subiectul, unghiul dorit, orice context relevant...'
              }
            />
            {genError && (
              <p className="font-sans text-[12px] text-red-400 bg-red-400/10 px-3 py-2">{genError}</p>
            )}
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={generating || !topic.trim()}
            className="w-full flex items-center justify-center gap-3 py-4 bg-brand-red text-white font-sans text-[13px] font-bold uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează articol...</>
              : <><Wand2 className="w-4 h-4" /> Generează cu AI</>
            }
          </button>

          {generating && (
            <div className="bg-purple-900/20 border border-purple-500/20 p-4 text-center space-y-1">
              <p className="font-sans text-[12px] text-purple-300">AI editorial procesează brieful...</p>
              <p className="font-sans text-[11px] text-purple-300/50">
                Titlu psihologic · {wordCount} cuvinte · bilingv complet · SEO tags
              </p>
            </div>
          )}
        </div>

        {/* ══ RIGHT: Result ═════════════════════════════════════════════════ */}
        {!result ? (
          <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center min-h-[600px] p-8 text-center">
            <Wand2 className="w-16 h-16 text-white/[0.06] mb-4" />
            <p className="font-serif text-xl text-white/20 mb-2">
              Articolul generat va apărea aici
            </p>
            <p className="font-sans text-[12px] text-white/15">
              Selectează tipul · lungimea · introdu brieful · apasă Generează
            </p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Action bar */}
            <div className="flex items-center justify-between">
              <p className="font-sans text-[12px] text-white/30">
                {savedPostId ? 'Ciornă salvată · poți publica oricând' : 'Articol generat · editează și publică'}
              </p>
              <div className="flex gap-2">
                <button onClick={() => saveArticle('draft')} disabled={saving}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50">
                  <Save className="w-3.5 h-3.5" />
                  Salvează ciornă
                </button>
                <button onClick={() => saveArticle('published')} disabled={saving}
                  className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50">
                  <Globe className="w-3.5 h-3.5" />
                  Publică acum
                </button>
              </div>
            </div>

            {/* ① TITLURI */}
            <div className={sectionCls}>
              <p className={sectionTitle}>① Titluri</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Titlu principal (RO)">
                  <input className={inputCls} value={titleRo} onChange={e => { setTitleRo(e.target.value); if (!slug) setSlug(toSlug(e.target.value)) }} />
                </Field>
                <Field label="Title principal (EN)">
                  <input className={inputCls} value={titleEn} onChange={e => setTitleEn(e.target.value)} />
                </Field>
                <Field label="Titlu alternativ (RO)">
                  <input className={inputCls} value={titleAltRo} onChange={e => setTitleAltRo(e.target.value)} placeholder="Variantă alternativă..." />
                </Field>
                <Field label="Alternative title (EN)">
                  <input className={inputCls} value={titleAltEn} onChange={e => setTitleAltEn(e.target.value)} placeholder="Alternative variant..." />
                </Field>
              </div>
            </div>

            {/* ② REZUMAT + EXCERPT */}
            <div className={sectionCls}>
              <p className={sectionTitle}>② Rezumat & Introducere</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Rezumat bullets (RO) — apare înainte de imagine pe articol">
                  <textarea rows={5} className={textareaCls} value={summaryRo}
                    onChange={e => setSummaryRo(e.target.value)}
                    placeholder="• Punct 1&#10;• Punct 2&#10;• Punct 3" />
                </Field>
                <Field label="Summary bullets (EN)">
                  <textarea rows={5} className={textareaCls} value={summaryEn}
                    onChange={e => setSummaryEn(e.target.value)}
                    placeholder="• Point 1&#10;• Point 2&#10;• Point 3" />
                </Field>
                <Field label="Introducere / Excerpt (RO)">
                  <textarea rows={3} className={textareaCls} value={excerptRo}
                    onChange={e => setExcerptRo(e.target.value)} />
                </Field>
                <Field label="Introduction / Excerpt (EN)">
                  <textarea rows={3} className={textareaCls} value={excerptEn}
                    onChange={e => setExcerptEn(e.target.value)} />
                </Field>
              </div>
            </div>

            {/* ③ IMAGINE COPERTĂ */}
            <div className={sectionCls}>
              <p className={sectionTitle}>③ Imagine copertă</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-3">
                  <Field label="URL imagine">
                    <input className={inputCls} value={coverImage}
                      onChange={e => setCoverImage(e.target.value)}
                      placeholder="https://... sau lasă gol și generează AI" />
                  </Field>
                  <button
                    onClick={generateCoverImage}
                    disabled={generatingImg}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600/20 border border-blue-500/30 text-blue-300 font-sans text-[12px] font-bold uppercase tracking-wider hover:bg-blue-600/30 transition-colors disabled:opacity-50"
                  >
                    {generatingImg
                      ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează imaginea...</>
                      : <><ImageIcon className="w-4 h-4" /> Generează imagine AI din articol</>
                    }
                  </button>
                  <p className="font-sans text-[10px] text-white/20">
                    AI generează imaginea bazată pe titlu și conținut. Articolul se salvează automat ca ciornă înainte.
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
                      <div className="text-center">
                        <ImageIcon className="w-8 h-8 text-white/10 mx-auto mb-2" />
                        <p className="font-sans text-[11px] text-white/20">Nicio imagine selectată</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ④ SEO TAGS */}
            <div className={sectionCls}>
              <p className={sectionTitle}>④ SEO Tags</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Tags (RO) — separate prin virgulă">
                  <input className={inputCls} value={tagsRo}
                    onChange={e => setTagsRo(e.target.value)}
                    placeholder="tag1, tag2, tag3..." />
                  {tagsRo && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {tagsRo.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                        <span key={tag} className="font-sans text-[10px] bg-brand-red/10 text-brand-red border border-brand-red/20 px-2 py-0.5">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
                <Field label="Tags (EN) — comma separated">
                  <input className={inputCls} value={tagsEn}
                    onChange={e => setTagsEn(e.target.value)}
                    placeholder="tag1, tag2, tag3..." />
                  {tagsEn && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {tagsEn.split(',').map(t => t.trim()).filter(Boolean).map(tag => (
                        <span key={tag} className="font-sans text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2 py-0.5">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Field>
              </div>
            </div>

            {/* ⑤ CONȚINUT */}
            <div className={sectionCls}>
              <div className="flex items-center justify-between mb-4">
                <p className={sectionTitle.replace('mb-4', 'mb-0')}>⑤ Conținut complet</p>
                <div className="flex gap-1">
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
              {contentTab === 'ro' ? (
                <textarea rows={24} className={textareaCls} value={contentRo}
                  onChange={e => setContentRo(e.target.value)}
                  placeholder="Conținut articol în română..." />
              ) : (
                <textarea rows={24} className={textareaCls} value={contentEn}
                  onChange={e => setContentEn(e.target.value)}
                  placeholder="Article content in English..." />
              )}
            </div>

            {/* ⑥ METADATE */}
            <div className={sectionCls}>
              <p className={sectionTitle}>⑥ Metadate</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Slug URL">
                  <input className={inputCls} value={slug} onChange={e => setSlug(e.target.value)} />
                </Field>
                <Field label="Autor">
                  <input className={inputCls} value={authorName} onChange={e => setAuthorName(e.target.value)} />
                </Field>
                <Field label="Subcategorie">
                  <select className={inputCls} value={subcategory} onChange={e => setSubcategory(e.target.value)}>
                    {SUBCATEGORIES.map(s => <option key={s} value={s}>{s || '—'}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
                    <option value="draft">Ciornă</option>
                    <option value="pending_review">În revizuire</option>
                    <option value="published">Publicat</option>
                  </select>
                </Field>
                <Field label="URL sursă / referință">
                  <input className={inputCls} value={sourceUrl}
                    onChange={e => setSourceUrl(e.target.value)}
                    placeholder="https://sursa.com/articol" />
                </Field>
                <div className="flex items-center gap-3 pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={isBreaking}
                      onChange={e => setIsBreaking(e.target.checked)}
                      className="accent-brand-red w-4 h-4" />
                    <div>
                      <p className="font-sans text-[13px] text-white">⚡ Ultima Oră</p>
                      <p className="font-sans text-[11px] text-white/30">Apare în ticker-ul roșu</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            {/* Bottom action bar */}
            <div className="flex gap-3 pb-8">
              <button onClick={() => saveArticle('draft')} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#1a1a1a] border border-white/10 text-white font-sans text-[13px] font-bold hover:border-white/30 transition-colors disabled:opacity-50">
                <Save className="w-4 h-4" />
                Salvează ciornă
              </button>
              <button onClick={() => saveArticle('published')} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-red text-white font-sans text-[13px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50">
                <Globe className="w-4 h-4" />
                Publică pe site
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
