'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Wand2, Save, Globe, RefreshCw, Image as ImageIcon } from 'lucide-react'

// ─── ARTICLE TYPES WITH STRONG EDITORIAL PROMPTS ─────────────────────────────

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

function buildPrompt(type: string, topic: string, wordCount: number): string {
  const base = `
SUBIECT: ${topic}
LUNGIME ȚINTĂ: aproximativ ${wordCount} cuvinte pentru conținut.
LIMBĂ: Scrie NATIV în română. Generează și o versiune completă, nativă în engleză.

CERINȚE TITLU:
- Titlu psihologic puternic: creează curiozitate, urgență sau emoție autentică
- Tehnici avansate: cifre concrete, paradoxuri, întrebări retorice, declarații surprinzătoare
- Irezistibil de citit, fără clickbait ieftin. Fără punct la final.
- Generează și un TITLU ALTERNATIV

REZUMAT (summary_ro / summary_en):
- 3-4 puncte bullet, max 15 cuvinte fiecare
- Fiecare bullet adaugă informație nouă, nu repetă titlul

SEO (tags_ro / tags_en):
- 6-8 tag-uri specifice lowercase cu cratimă
- Include variații long-tail

RĂSPUNDE EXCLUSIV CU JSON VALID:
{
  "title_ro": "...",
  "title_en": "...",
  "summary_ro": "bullet1\\nbullet2\\nbullet3",
  "summary_en": "bullet1\\nbullet2\\nbullet3",
  "excerpt_ro": "1-2 propoziții hook",
  "excerpt_en": "1-2 sentence hook",
  "content_ro": "articol complet în română",
  "content_en": "full article in English",
  "tags_ro": ["tag-ro-1", "tag-ro-2"],
  "tags_en": ["tag-en-1", "tag-en-2"],
  "seo_title_ro": "max 60 caractere",
  "seo_title_en": "max 60 chars",
  "seo_description_ro": "max 160 caractere",
  "seo_description_en": "max 160 chars"
}
`

  const prompts: Record<string, string> = {
    editorial: `${base}
TIP: EDITORIAL JURNALISTIC DE ÎNALTĂ CLASĂ

Structură obligatorie:
1. DESCHIDERE PUTERNICĂ: declarație provocatoare, scenă vie sau statistică șocantă care ancorează imediat
2. TEZĂ CLARĂ: poziția publicației, enunțată ferm și fără echivoc
3. ARGUMENTARE STRATIFICATĂ: 3-4 argumente solide cu fapte concrete, precedente istorice sau citate. Se construiesc progresiv.
4. CONTRAARGUMENT ȘI RESPINGERE: recunoaște perspectiva opusă, demontează-o elegant
5. CONCLUZIE MEMORABILĂ: o propoziție care rămâne în minte și provoacă reflecție sau acțiune — nu platitudini

TON: Autoritar, lucid, angajat. Editorialul are o poziție. Vocabular precis, ritm jurnalistic.
INTERZIS: delve, landscape, crucial, esențial, robust, vital, paradigmă, sinergie, ecosistem.`,

    analiza: `${base}
TIP: ANALIZĂ APROFUNDATĂ MULTI-DIMENSIONALĂ

Structură:
1. CONTEXT ȘI MIZĂ: de ce contează ACUM, situează problema în tabloul mai larg
2. ANATOMIA PROBLEMEI: cauze structurale, nu simptome superficiale
3. PERSPECTIVE MULTIPLE: minimum 3 unghiuri de analiză — economic, politic, social, istoric sau geopolitic
4. DATE ȘI EVIDENȚE: fiecare afirmație ancorată în cifre, tendințe sau comparații internaționale
5. SCENARII: 2-3 scenarii probabile cu argumente pro/contra
6. CONCLUZIE ANALITICĂ: sintetică, precisă, cu valoare predictivă — nu moralizatoare

TON: Expert, nuanțat, fără simplificări. Cititorul trebuie să înțeleagă complexitatea după ce termină.`,

    pamflet: `${base}
TIP: PAMFLET — SATIRĂ POLITICĂ/SOCIALĂ DE ÎNALTĂ CLASĂ
Tradiția marilor pampletari: Swift, Voltaire, Caragiale.

REGULI ABSOLUTE:
1. INTELIGENȚA PRIMEAZĂ: umor fin, stratificat. Sarcasmul taie ca bisturiul, nu ca toporul. Cititorul inteligent zâmbește cu satisfacție.
2. ȚINTA PRECISĂ: identifică exact ce/cine este satirizat. Nu generaliza — pamfletul lovește specific.
3. STRUCTURĂ OBLIGATORIE:
   - LAUDATIO IRONICĂ: deschide cu un compliment fals și exagerat față de țintă/subiect
   - DEZMEMBRARE PROGRESIVĂ: demontarea pretențiilor cu exemple concrete și comparații devastatoare
   - REVELAȚIA ABSURDĂ: momentul în care masca cade complet
   - CONCLUZIE TĂIOASĂ: aparent serioasă, implacabil de sarcastică
4. TEHNICI OBLIGATORII: hiperbolă controlată, ironie socratică, analogii incomode, întrebări retorice ucigătoare, inversiunea valorilor
5. TITLUL: capodoperă de ironie comprimată — pare serios, e ucigător satiric
6. FĂRĂ vulgaritate. FĂRĂ atacuri la persoană fizică neverificabilă. Satira pe fapte și declarații publice.

TON: Elegant, tăios, fin. Pamfletul prost înjură. Pamfletul bun face subiectul să se simtă ridicol în propriii ochi.`,

    blog: `${base}
TIP: BLOG — VOCE PERSONALĂ, IMPACT REAL

Nu o compilație de informații. Un blog adevărat cu perspectivă unică.
1. DESCHIDERE PERSONALĂ: o experiență, observație sau întrebare care conectează imediat
2. PUNCT DE VEDERE PROPRIU: nu "unii spun că". Ia o poziție. Spune ce crezi TU și de ce.
3. POVESTIRE + INFORMAȚIE: alternează narațiunea cu insight-uri valoroase
4. UMOR SAU AUTOIRONIE: blogul bun nu se ia prea în serios
5. CONCLUZIE PRACTICĂ: ce poate face cititorul cu această informație?

TON: Cald, direct, inteligent fără a fi pedant. Ca și cum explici unui prieten deștept la o cafea.`,

    reportaj: `${base}
TIP: REPORTAJ JURNALISTIC NARATIV

1. SCENĂ DE DESCHIDERE: plasează cititorul în mijlocul acțiunii — detalii senzoriale, personaje concrete
2. CONTEXTUL POVEȘTII: cine, ce, unde, când, de ce — ca în narațiune, nu ca în știre
3. VOCI: minimum 2-3 perspective diferite, citate directe
4. TENSIUNEA NARATIVĂ: conflict, problemă nerezolvată, întrebare centrală
5. REZOLUȚIE SAU SUSPENDARE: răspuns sau o întrebare mai mare

TON: Narativ, uman, long-form journalism.`,

    cultura: `${base}
TIP: CRITICĂ CULTURALĂ PROFUNDĂ

1. OPERA/FENOMENUL: descrie cu acuratețe și detaliu relevant
2. CONTEXTUL CULTURAL: situează în curentul artistic, istoric sau social din care face parte
3. ANALIZA CRITICĂ: nu rezumat — interpretare. Ce spune opera despre epoca ei? Ce revelează?
4. COMPARAȚII: pune în dialog cu alte opere, autori sau momente culturale relevante
5. VALOAREA ACTUALĂ: de ce contează azi? Ce îi oferă cititorului contemporan?

TON: Cultivat, pasionat, accesibil fără vulgarizare.`,

    tehnologie: `${base}
TIP: JURNALISM TECH DE CALITATE — NU COMUNICAT DE PRESĂ

1. NOUTATEA: ce s-a schimbat? de ce acum?
2. FUNCȚIONAREA: explică accesibil, fără jargon inutil, cu analogii clare
3. IMPLICAȚIILE REALE: dincolo de hype — impact concret asupra oamenilor, business, societății
4. VOCEA CRITICĂ: riscuri, limitări, întrebări nerezolvate — nu celebra orbește
5. PERSPECTIVE GLOBALE: cum se încadrează în tendințe mai largi?

TON: Informat, scepticism sănătos, accesibil.`,
  }

  return prompts[type] || prompts['editorial']
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter()

  // Generation params
  const [articleType, setArticleType] = useState('editorial')
  const [wordCount, setWordCount]     = useState(1200)
  const [category, setCategory]       = useState('opinion')
  const [topic, setTopic]             = useState('')

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated]   = useState(false)
  const [genError, setGenError]     = useState('')

  // All editable fields
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

  // Metadata
  const [slug, setSlug]             = useState('')
  const [authorName, setAuthorName] = useState('')  // FREE EMPTY FIELD
  const [subcategory, setSubcategory] = useState('')
  const [sourceUrl, setSourceUrl]   = useState('')
  const [isBreaking, setIsBreaking] = useState(false)

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

  // ─── GENERATE ──────────────────────────────────────────────────────────────

  async function generate() {
    if (!topic.trim()) { setGenError('Introduceți subiectul / brieful editorial.'); return }
    setGenerating(true)
    setGenError('')
    setGenerated(false)
    setCoverImage('')

    // Build our strong prompt and send it as the `prompt` parameter
    // The edge function reads: { prompt, word_count, editor, category }
    const fullPrompt = buildPrompt(articleType, topic, wordCount)

    try {
      const { data, error } = await supabase.functions.invoke('ai-generate-article', {
        body: {
          prompt:     fullPrompt,
          word_count: wordCount,
          editor:     'daniel_dobos', // default persona — not shown to user
          category,
        }
      })

      if (error) throw new Error(error.message)
      if (!data)  throw new Error('Niciun răspuns de la funcția AI.')

      // Populate fields
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
      setGenerated(true)
      setContentTab('ro')
      flash('✓ Articol generat')
    } catch (e) {
      setGenError(`Eroare: ${(e as Error).message}`)
    }
    setGenerating(false)
  }

  // ─── GENERATE COVER IMAGE ─────────────────────────────────────────────────
  // generate-cover-image accepts { title, excerpt }
  // We pass summaryRo as excerpt so the image uses the article's actual content

  async function generateCoverImage() {
    const imgTitle   = titleRo || titleEn
    const imgContext = summaryRo || summaryEn || excerptRo || excerptEn

    if (!imgTitle) { flash('Completați mai întâi titlul sau generați articolul.'); return }

    setGeneratingImg(true)
    flash('Generez imaginea din rezumatul articolului...')

    try {
      const { data, error } = await supabase.functions.invoke('generate-cover-image', {
        body: { title: imgTitle, excerpt: imgContext }
      })

      if (error) throw new Error(error.message)

      if (data?.publicUrl) {
        setCoverImage(data.publicUrl)
        flash('✓ Imagine generată')
      } else {
        throw new Error(data?.error || 'Nu am primit URL-ul imaginii.')
      }
    } catch (e) {
      flash(`Eroare imagine: ${(e as Error).message}`)
    }
    setGeneratingImg(false)
  }

  // ─── SAVE ─────────────────────────────────────────────────────────────────

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

  // ─── STYLES ───────────────────────────────────────────────────────────────

  const inp  = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
  const ta   = inp + " resize-none leading-relaxed"
  const lbl  = "block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5"
  const sec  = "bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4"
  const sh   = "font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3 mb-1"

  function F({ label, children }: { label: string; children: React.ReactNode }) {
    return <div><label className={lbl}>{label}</label>{children}</div>
  }

  function Pills({ value, cls }: { value: string; cls: string }) {
    const tags = value.split(',').map(t => t.trim()).filter(Boolean)
    if (!tags.length) return null
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {tags.map(t => (
          <span key={t} className={`font-sans text-[10px] px-2 py-0.5 border ${cls}`}>{t}</span>
        ))}
      </div>
    )
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Editor AI</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">Generează articole de înaltă calitate</p>
        </div>
        {msg && (
          <span className={`font-sans text-[12px] px-3 py-1.5 border ${
            msg.startsWith('Eroare')
              ? 'text-red-400 bg-red-400/10 border-red-400/20'
              : 'text-green-400 bg-green-400/10 border-green-400/20'
          }`}>{msg}</span>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">

        {/* ── LEFT ──────────────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Article type */}
          <div className={sec}>
            <p className={sh}>Tip articol</p>
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
              {articleType === 'pamflet'    && 'Swift · Voltaire · Caragiale — laudatio ironică → revelație absurdă'}
              {articleType === 'editorial'  && 'Teză fermă · argumentare stratificată · concluzie memorabilă'}
              {articleType === 'analiza'    && 'Multi-perspectival · date concrete · predictiv'}
              {articleType === 'blog'       && 'Voce proprie · poziție clară · ton cald'}
              {articleType === 'reportaj'   && 'Scenă de deschidere · voci · tensiune narativă'}
              {articleType === 'cultura'    && 'Interpretare · context · valoare actuală'}
              {articleType === 'tehnologie' && 'Demistificare · impact real · scepticism sănătos'}
            </p>
          </div>

          {/* Word count */}
          <div className={sec}>
            <p className={sh}>Lungime articol</p>
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
          <div className={sec}>
            <p className={sh}>Categorie</p>
            <select className={inp} value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Topic / brief */}
          <div className={sec}>
            <p className={sh}>Brief editorial</p>
            <textarea className={ta} rows={7} value={topic} onChange={e => setTopic(e.target.value)}
              placeholder={
                articleType === 'pamflet'
                  ? 'Ex: Un politician promite transparență totală exact la o lună după ce dosarul său a fost clasat. Ironizează cu precizie chirurgicală...'
                  : articleType === 'analiza'
                  ? 'Ex: Impactul măsurilor de austeritate ale guvernului român din perspectiva clasei de mijloc, cu referire la datele INS din Q1 2026...'
                  : 'Descrie subiectul, unghiul dorit, contextul, orice informație relevantă...'
              }
            />
            {genError && (
              <p className="font-sans text-[12px] text-red-400 bg-red-400/10 border border-red-400/20 px-3 py-2">{genError}</p>
            )}
          </div>

          {/* Generate */}
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
                AI scrie {ARTICLE_TYPES.find(t => t.value === articleType)?.label}...
              </p>
              <p className="font-sans text-[11px] text-purple-300/40">
                {wordCount} cuvinte · titlu psihologic · RO + EN · SEO complet
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT ─────────────────────────────────────────────────────────── */}
        {!generated ? (
          <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center min-h-[600px] p-8 text-center">
            <Wand2 className="w-16 h-16 text-white/[0.05] mb-5" />
            <p className="font-serif text-xl text-white/20 mb-2">Articolul generat va apărea aici</p>
            <p className="font-sans text-[12px] text-white/10 max-w-xs">
              Selectează tipul · lungimea · categoria<br/>Scrie brieful · apasă Generează
            </p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* Action bar */}
            <div className="flex items-center justify-between">
              <p className="font-sans text-[12px] text-white/30">Editează orice câmp înainte de publicare</p>
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
            <div className={sec}>
              <p className={sh}>① Titluri</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Titlu principal (RO)">
                  <input className={inp} value={titleRo}
                    onChange={e => { setTitleRo(e.target.value); if (!slug) setSlug(toSlug(e.target.value)) }} />
                </F>
                <F label="Title (EN)">
                  <input className={inp} value={titleEn} onChange={e => setTitleEn(e.target.value)} />
                </F>
              </div>
            </div>

            {/* ② REZUMAT + EXCERPT */}
            <div className={sec}>
              <p className={sh}>② Rezumat & Introducere</p>
              <p className="font-sans text-[10px] text-white/20 -mt-2 mb-2">
                Rezumatul apare pe articol înainte de imagine. Este folosit și ca sursă pentru generarea imaginii copertă.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Rezumat bullets (RO)">
                  <textarea rows={5} className={ta} value={summaryRo} onChange={e => setSummaryRo(e.target.value)} placeholder="• Punct 1&#10;• Punct 2&#10;• Punct 3" />
                </F>
                <F label="Summary bullets (EN)">
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

            {/* ③ IMAGINE COPERTĂ */}
            <div className={sec}>
              <p className={sh}>③ Imagine copertă</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <div className="space-y-3">
                  <F label="URL imagine (sau generează mai jos)">
                    <input className={inp} value={coverImage}
                      onChange={e => setCoverImage(e.target.value)}
                      placeholder="https://... sau lasă gol" />
                  </F>
                  <button onClick={generateCoverImage} disabled={generatingImg}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600/20 border border-blue-500/30 text-blue-300 font-sans text-[12px] font-bold uppercase tracking-wider hover:bg-blue-600/30 transition-colors disabled:opacity-50">
                    {generatingImg
                      ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generează imaginea...</>
                      : <><ImageIcon className="w-4 h-4" /> Generează imagine din rezumat</>
                    }
                  </button>
                  <p className="font-sans text-[10px] text-white/20">
                    AI folosește titlul și rezumatul articolului pentru a genera imaginea. FLUX.1 (HuggingFace) → DALL-E 3 (fallback).
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
            <div className={sec}>
              <p className={sh}>④ SEO Tags</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="SEO Title (RO) — max 60 caractere">
                  <input className={inp} value={seoTitleRo} onChange={e => setSeoTitleRo(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoTitleRo.length > 60 ? 'text-red-400' : 'text-white/20'}`}>{seoTitleRo.length}/60</span>
                </F>
                <F label="SEO Title (EN) — max 60 chars">
                  <input className={inp} value={seoTitleEn} onChange={e => setSeoTitleEn(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoTitleEn.length > 60 ? 'text-red-400' : 'text-white/20'}`}>{seoTitleEn.length}/60</span>
                </F>
                <F label="Meta Description (RO) — max 160 caractere">
                  <textarea rows={2} className={ta} value={seoDescRo} onChange={e => setSeoDescRo(e.target.value)} />
                  <span className={`font-sans text-[10px] mt-1 block ${seoDescRo.length > 160 ? 'text-red-400' : 'text-white/20'}`}>{seoDescRo.length}/160</span>
                </F>
                <F label="Meta Description (EN) — max 160 chars">
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
                  {(['ro', 'en'] as const).map(l => (
                    <button key={l} onClick={() => setContentTab(l)}
                      className={
                        'font-sans text-[11px] uppercase tracking-wider px-3 py-1.5 border transition-colors ' +
                        (contentTab === l ? 'bg-brand-red border-brand-red text-white' : 'border-white/[0.07] text-white/40 hover:text-white')
                      }>{l === 'ro' ? '🇷🇴 RO' : '🇬🇧 EN'}
                    </button>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <F label="Slug URL">
                  <input className={inp} value={slug} onChange={e => setSlug(e.target.value)} />
                </F>
                <F label="Autor">
                  <input className={inp} value={authorName}
                    onChange={e => setAuthorName(e.target.value)}
                    placeholder="Numele autorului" />
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
