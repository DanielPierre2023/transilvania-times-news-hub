'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { Wand2, Save, Globe, RefreshCw, ChevronDown } from 'lucide-react'

// ─── Article type definitions with embedded editorial prompts ───────────────

const ARTICLE_TYPES = [
  { value: 'editorial', label: 'Editorial', emoji: '✒️' },
  { value: 'analiza', label: 'Analiză', emoji: '🔬' },
  { value: 'pamflet', label: 'Pamflet', emoji: '⚡' },
  { value: 'blog', label: 'Blog', emoji: '📝' },
  { value: 'reportaj', label: 'Reportaj', emoji: '📰' },
  { value: 'cultura', label: 'Cultură', emoji: '🎭' },
  { value: 'tehnologie', label: 'Tehnologie', emoji: '💻' },
]

const WORD_COUNTS = [
  { value: 800, label: '800 cuvinte', desc: 'Scurt · impact rapid' },
  { value: 1200, label: '1200 cuvinte', desc: 'Standard · echilibrat' },
  { value: 1800, label: '1800 cuvinte', desc: 'Long-form · aprofundat' },
]

const CATEGORIES = [
  'news', 'politics', 'technology', 'business',
  'culture', 'travel', 'education', 'sports', 'health', 'opinion'
]

// ─── Strong editorial prompts per article type ──────────────────────────────

function buildPrompt(type: string, topic: string, wordCount: number, language: string): string {
  const lang = language === 'ro' ? 'română' : 'English'
  const langInstruction = language === 'ro'
    ? `Scrie EXCLUSIV în limba română. Generează și o versiune completă în engleză.`
    : `Write EXCLUSIVELY in English. Also generate a complete Romanian version.`

  const base = `${langInstruction}

SUBIECT: ${topic}

LUNGIME ȚINTĂ: aproximativ ${wordCount} cuvinte pentru conținutul principal.

CERINȚE OBLIGATORII PENTRU TITLU:
- Titlul trebuie să fie psihologic puternic: să creeze curiozitate, urgență sau emoție
- Folosește tehnici jurnalistice avansate: cifre concrete, paradoxuri, întrebări retorice, sau declarații surprinzătoare
- Titlul trebuie să fie irezistibil de dat click, dar fără clickbait ieftin
- Generează și un titlu alternativ

CERINȚE PENTRU REZUMAT (summary):
- 3-4 puncte bullet, fiecare de maxim 15 cuvinte
- Captează esența, nu repeta titlul
- Fiecare bullet trebuie să adauge informație nouă

CERINȚE SEO:
- 5-8 tag-uri relevante, specifice, în limba articolului
- Include variații long-tail

`

  const typePrompts: Record<string, string> = {
    editorial: `${base}
TIP ARTICOL: EDITORIAL JURNALISTIC DE ÎNALTĂ CLASĂ

Scrie un editorial cu autoritate și viziune. Structura obligatorie:
1. DESCHIDERE PUTERNICĂ (2-3 fraze): O declarație provocatoare, o scenă vie sau o statistică șocantă care ancorează cititorul imediat.
2. TEZĂ CLARĂ: Poziția publicației față de subiect, enunțată ferm și fără echivoc.
3. ARGUMENTARE STRATIFICATĂ: 3-4 argumente solide, fiecare susținut cu fapte concrete, precedente istorice sau citate relevante. Argumentele se construiesc progresiv.
4. CONTRAARGUMENT ȘI RESPINGERE: Recunoaște perspectiva opusă, apoi demontează-o elegant.
5. CONCLUZIE CU CHEMARE LA ACȚIUNE: Nu încheia cu platitudini — termină cu o propoziție care rămâne în minte și provoacă reflecție sau acțiune.

TON: Autoritar, lucid, angajat. Nu neutru — editorialul are o poziție. Vocabular precis, fraze cu ritm jurnalistic. Evita clișeele.`,

    analiza: `${base}
TIP ARTICOL: ANALIZĂ APROFUNDATĂ

Scrie o analiză multi-dimensională, de referință. Structura:
1. CONTEXT ȘI MIZĂ: De ce contează acest subiect ACUM. Situează problema în tabloul mai larg.
2. ANATOMIA PROBLEMEI: Descompune subiectul în componente. Identifică cauzele structurale, nu simptomele superficiale.
3. PERSPECTIVE MULTIPLE: Prezintă minimum 3 unghiuri de analiză — economic, politic, social, istoric sau geopolitic, după relevanță.
4. DATE ȘI EVIDENȚE: Ancorează fiecare afirmație importantă în cifre, tendințe sau comparații internaționale.
5. IMPLICAȚII ȘI SCENARII: Ce urmează? Prezintă 2-3 scenarii probabile cu argumente pro/contra.
6. CONCLUZIE ANALITICĂ: Nu moralizatoare — sintetica, precisă, cu valoare predictivă.

TON: Expert, nuanțat, fără simplificări. Cititorului trebuie să îi fie clară complexitatea subiectului după ce termină articolul.`,

    pamflet: `${base}
TIP ARTICOL: PAMFLET — SATIRĂ POLITICĂ / SOCIALĂ DE ÎNALTĂ CLASĂ

ATENȚIE: Acesta este un pamflet în tradiția marilor pampletari europeni — Swift, Voltaire, Caragiale. NU este o simplă ironizare ieftină.

Reguli absolute:
1. INTELIGENȚA PRIMEAZĂ: Umorul trebuie să fie fin, stratificat. Cititorul inteligent zâmbește cu satisfacție, nu râde zgomotos. Sarcasmul trebuie să taie ca un bisturiu, nu ca un topor.
2. ȚINTA PRECISĂ: Identifică exact ce/cine este satirizat și de ce. Nu generaliza — pamfletul lovește specific.
3. STRUCTURA SATIRICĂ:
   - Deschidere: Un compliment fals și exagerat față de subiect/țintă (laudatio ironică)
   - Desfășurare: Demontarea progresivă a pretențiilor, cu exemple concrete și comparații devastatoare
   - Punctul culminant: Revelaţia absurdă — momentul în care masca cade complet
   - Final: O concluzie aparent serioasă, dar implacabil de tăioasă
4. TEHNICI OBLIGATORII: hiperbola controlată, ironia socratică, analogii incomode, întrebări retorice ucigătoare, inversiunea valorilor
5. STIL: Frazare elegantă. Pamfletul prost înjură. Pamfletul bun face subiectul să se simtă ridicol în propriii ochi.
6. TITLU: Trebuie să fie o capodoperă de ironie comprimată — să pară serios dar să fie ucigător de satiric.

IMPORTANT: Fără vulgaritate, fără atacuri la persoană fizică neverificabilă. Satira se face pe fapte și declarații publice.`,

    blog: `${base}
TIP ARTICOL: BLOG — VOCE PERSONALĂ, IMPACT REAL

Nu o compilație de informații. Un blog adevărat — cu perspectivă unică și voce distinctă.
Structura:
1. DESCHIDERE PERSONALĂ: O experiență, o observație sau o întrebare personală care conectează imediat cu cititorul.
2. PUNCTUL DE VEDERE PROPRIU: Nu "unii spun că... alții spun că". Ia o poziție. Spune ce crezi TU și de ce.
3. POVESTIRE + INFORMAȚIE: Alternează narațiunea cu insight-uri valoroase. Cititorul trebuie să simtă că a primit ceva ce nu găsea altundeva.
4. MOMENTE DE UMOR SAU AUTOIRONIE: Blogul bun nu se ia prea în serios.
5. CONCLUZIE PRACTICĂ: Ce poate face cititorul cu această informație? Ce schimbă în perspectiva lui?

TON: Cald, direct, inteligent fără a fi pedant. Scrie ca și cum ai explica unui prieten deștept la o cafea.`,

    reportaj: `${base}
TIP ARTICOL: REPORTAJ JURNALISTIC

Scrie un reportaj viu, cu narațiune de teren. Structura:
1. SCENĂ DE DESCHIDERE: Plasează cititorul direct în mijlocul acțiunii — detalii senzoriale, personaje concrete.
2. CONTEXTUL POVEȘTII: Cine, ce, unde, când, de ce — dar nu ca în știre. Ca în narațiune.
3. VOCILE: Minim 2-3 perspective diferite (chiar imaginate în mod plauzibil, dacă e un subiect general). Citatul direct face reportajul viu.
4. TENSIUNEA NARATIVĂ: Există un conflict, o problemă nerezolvată, o întrebare la care reportajul trebuie să răspundă.
5. REZOLUȚIE SAU SUSPENDARE: Fie oferă răspuns, fie lasă o întrebare mai mare.

TON: Narativ, uman, jurnalism de tip long-form.`,

    cultura: `${base}
TIP ARTICOL: CULTURĂ — CRITICĂ ȘI REFLECȚIE

Scrie o piesă culturală cu profunzime și eleganță.
1. OPERA / FENOMENUL: Descrie subiectul cu acuratețe și detaliu relevant.
2. CONTEXTUL CULTURAL: Situează în curentul artistic, istoric sau social din care face parte.
3. ANALIZA CRITICĂ: Nu rezumat — interpretare. Ce spune opera despre epoca ei? Ce revelează?
4. COMPARAȚII RELEVANTE: Pune în dialog cu alte opere, autori sau momente culturale.
5. VALOAREA ACTUALĂ: De ce contează azi? Ce îi oferă cititorului contemporan?

TON: Cultivat, pasionat, accesibil fără vulgarizare.`,

    tehnologie: `${base}
TIP ARTICOL: TEHNOLOGIE — JURNALISM TECH DE CALITATE

Nu un comunicat de presă. Jurnalism tech real.
1. NOUTATEA: Ce s-a schimbat? De ce acum?
2. FUNCȚIONAREA: Explică tehnologia accesibil, fără jargon inutil. Analogii clare.
3. IMPLICAȚIILE REALE: Dincolo de hype — ce impact concret are asupra oamenilor, business-urilor, societății?
4. VOCEA CRITICĂ: Cele mai bune articole tech nu celebrează orbește. Identifică riscuri, limitări, întrebări nerezolvate.
5. PERSPECTIVE GLOBALE: Cum se încadrează în tendințe mai largi?

TON: Informat, sceptic sănătos, accesibil.`,
  }

  return typePrompts[type] || typePrompts['editorial']
}

// ─── Component ──────────────────────────────────────────────────────────────

interface GeneratedResult {
  title_ro: string
  title_en: string
  title_alt_ro?: string
  title_alt_en?: string
  summary_ro: string
  summary_en: string
  content_ro: string
  content_en: string
  excerpt_ro: string
  excerpt_en: string
  tags_ro: string[]
  tags_en: string[]
  seo_description_ro?: string
  seo_description_en?: string
}

export default function EditorPage() {
  const router = useRouter()

  // Form state
  const [articleType, setArticleType] = useState('editorial')
  const [topic, setTopic] = useState('')
  const [wordCount, setWordCount] = useState(1200)
  const [language, setLanguage] = useState<'ro' | 'en'>('ro')
  const [category, setCategory] = useState('opinion')
  const [isBreaking, setIsBreaking] = useState(false)

  // Generation state
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GeneratedResult | null>(null)
  const [previewTab, setPreviewTab] = useState<'ro' | 'en'>('ro')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  // Editable result fields
  const [edited, setEdited] = useState<Partial<GeneratedResult>>({})

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  function flash(text: string, isError = false) {
    if (isError) setError(text)
    else setMsg(text)
    setTimeout(() => { setMsg(''); setError('') }, 4000)
  }

  function getField<K extends keyof GeneratedResult>(key: K): GeneratedResult[K] {
    if (edited[key] !== undefined) return edited[key] as GeneratedResult[K]
    if (result) return result[key]
    return '' as GeneratedResult[K]
  }

  function setField(key: keyof GeneratedResult, value: string | string[]) {
    setEdited(prev => ({ ...prev, [key]: value }))
  }

  async function generate() {
    if (!topic.trim()) { flash('Introduceți subiectul articolului.', true); return }
    setGenerating(true)
    setError('')
    setResult(null)
    setEdited({})

    const prompt = buildPrompt(articleType, topic, wordCount, language)

    try {
      const { data, error: fnError } = await supabase.functions.invoke('ai-generate-article', {
        body: {
          topic: topic.trim(),
          article_type: articleType,
          word_count: wordCount,
          language,
          category,
          prompt,
          generate_bilingual: true,
        }
      })

      if (fnError) throw new Error(fnError.message)
      if (!data) throw new Error('Niciun răspuns de la AI.')

      setResult(data as GeneratedResult)
      setPreviewTab(language)
      flash('✓ Articol generat cu succes')
    } catch (e) {
      flash(`Eroare: ${(e as Error).message}`, true)
    }

    setGenerating(false)
  }

  async function saveArticle(status: 'draft' | 'published') {
    if (!result && Object.keys(edited).length === 0) return
    setSaving(true)

    const slug = (getField('title_ro') as string)
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-')
      .substring(0, 80)

    const payload = {
      title_ro: getField('title_ro') as string,
      title_en: getField('title_en') as string,
      content_ro: getField('content_ro') as string,
      content_en: getField('content_en') as string,
      excerpt_ro: getField('excerpt_ro') as string,
      excerpt_en: getField('excerpt_en') as string,
      summary_ro: getField('summary_ro') as string,
      summary_en: getField('summary_en') as string,
      tags_ro: getField('tags_ro') as string[],
      tags_en: getField('tags_en') as string[],
      category,
      slug: slug + '-' + Date.now().toString(36),
      status,
      is_breaking: isBreaking,
      author_name: 'Transilvania Times Editorial',
      published_at: status === 'published' ? new Date().toISOString() : null,
    }

    const { data: saved, error: saveError } = await supabase
      .from('blog_posts')
      .insert(payload as never)
      .select('id, slug')
      .single()

    if (saveError) {
      flash(`Eroare salvare: ${saveError.message}`, true)
      setSaving(false)
      return
    }

    if (status === 'published' && saved) {
      await fetch(`/api/revalidate?secret=tt-revalidate-2026&slug=${saved.slug}`, { method: 'POST' })
      flash('✓ Articol publicat și live pe site')
    } else {
      flash('✓ Salvat ca ciornă')
    }

    setSaving(false)
    setTimeout(() => router.push(`/admin/articles/${saved.id}/edit`), 1500)
  }

  const inputCls = "w-full bg-[#111] border border-white/10 text-white font-sans text-sm px-3 py-2.5 outline-none focus:border-white/30 transition-colors placeholder:text-white/20"
  const textareaCls = inputCls + " resize-none"

  const selectedType = ARTICLE_TYPES.find(t => t.value === articleType)

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Editor AI</h1>
          <p className="font-sans text-[13px] text-white/40 mt-1">
            Generează articole de înaltă calitate cu AI editorial
          </p>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="font-sans text-[12px] text-green-400 bg-green-400/10 px-3 py-1">{msg}</span>}
          {error && <span className="font-sans text-[12px] text-red-400 bg-red-400/10 px-3 py-1">{error}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── LEFT: Generation controls ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Article type */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-3">
              Tip articol
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ARTICLE_TYPES.map(type => (
                <button
                  key={type.value}
                  onClick={() => setArticleType(type.value)}
                  className={
                    'flex items-center gap-2 px-3 py-2.5 font-sans text-[12px] transition-colors border ' +
                    (articleType === type.value
                      ? 'bg-brand-red border-brand-red text-white'
                      : 'bg-transparent border-white/[0.07] text-white/50 hover:text-white hover:border-white/20')
                  }
                >
                  <span>{type.emoji}</span>
                  {type.label}
                </button>
              ))}
            </div>
            {selectedType && (
              <p className="font-sans text-[11px] text-white/25 mt-3 italic">
                {articleType === 'pamflet' && 'Satiră tăioasă în tradiția marilor pampletari europeni'}
                {articleType === 'editorial' && 'Poziție clară, argumentare solidă, concluzie memorabilă'}
                {articleType === 'analiza' && 'Aprofundat, multi-perspectival, bazat pe fapte'}
                {articleType === 'blog' && 'Voce personală, perspectivă unică, ton cald'}
                {articleType === 'reportaj' && 'Narațiune vie, personaje concrete, tensiune jurnalistică'}
                {articleType === 'cultura' && 'Critică nuanțată, context bogat, valoare actuală'}
                {articleType === 'tehnologie' && 'Demistificare clară, impact real, scepticism sănătos'}
              </p>
            )}
          </div>

          {/* Word count */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-3">
              Lungime
            </label>
            <div className="space-y-2">
              {WORD_COUNTS.map(wc => (
                <button
                  key={wc.value}
                  onClick={() => setWordCount(wc.value)}
                  className={
                    'w-full flex items-center justify-between px-4 py-2.5 border transition-colors ' +
                    (wordCount === wc.value
                      ? 'bg-brand-red/10 border-brand-red text-white'
                      : 'bg-transparent border-white/[0.07] text-white/50 hover:text-white hover:border-white/20')
                  }
                >
                  <span className="font-sans text-[13px] font-medium">{wc.label}</span>
                  <span className="font-sans text-[11px] text-white/30">{wc.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Language + Category */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-2">
                Limbă sursă
              </label>
              <div className="flex gap-2">
                {(['ro', 'en'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => setLanguage(l)}
                    className={
                      'flex-1 py-2 font-sans text-[12px] font-bold uppercase tracking-wider border transition-colors ' +
                      (language === l
                        ? 'bg-brand-red border-brand-red text-white'
                        : 'bg-transparent border-white/[0.07] text-white/40 hover:text-white')
                    }
                  >
                    {l === 'ro' ? '🇷🇴 Română' : '🇬🇧 English'}
                  </button>
                ))}
              </div>
              <p className="font-sans text-[10px] text-white/20 mt-1.5">
                Se generează automat și traducerea completă
              </p>
            </div>
            <div>
              <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-2">
                Categorie
              </label>
              <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={isBreaking}
                onChange={e => setIsBreaking(e.target.checked)}
                className="accent-brand-red" />
              <span className="font-sans text-[12px] text-white/60">⚡ Marchează ca Ultima Oră</span>
            </label>
          </div>

          {/* Topic input */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-2">
              Subiect / Brief editorial
            </label>
            <textarea
              className={textareaCls}
              rows={5}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder={
                articleType === 'pamflet'
                  ? 'Ex: Discursul unui politician despre integritate după scandalul de corupție. Ironizează promisiunile fără acoperire...'
                  : articleType === 'analiza'
                  ? 'Ex: Impactul inteligenței artificiale asupra pieței muncii în România în următorii 5 ani...'
                  : articleType === 'editorial'
                  ? 'Ex: România trebuie să adopte o strategie națională de educație digitală înainte de 2026...'
                  : 'Descrie subiectul articolului, unghiul dorit, orice context relevant...'
              }
            />
            <p className="font-sans text-[10px] text-white/20 mt-1.5">
              Cu cât brieful e mai specific, cu atât articolul e mai precis și mai valoros.
            </p>
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={generating || !topic.trim()}
            className="w-full flex items-center justify-center gap-3 py-4 bg-brand-red text-white font-sans text-[13px] font-bold uppercase tracking-widest hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Generează articol...</>
            ) : (
              <><Wand2 className="w-4 h-4" /> Generează cu AI</>
            )}
          </button>

          {generating && (
            <div className="bg-purple-900/20 border border-purple-500/20 p-4 text-center">
              <p className="font-sans text-[12px] text-purple-300">
                AI editorial procesează brieful...
              </p>
              <p className="font-sans text-[11px] text-purple-300/50 mt-1">
                Titlu psihologic · {wordCount} cuvinte · bilingv · SEO
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT: Result preview + editing ── */}
        <div className="lg:col-span-3 space-y-4">
          {!result ? (
            <div className="bg-[#1a1a1a] border border-white/[0.07] border-dashed flex flex-col items-center justify-center min-h-[500px] p-8 text-center">
              <Wand2 className="w-12 h-12 text-white/10 mb-4" />
              <p className="font-serif text-lg text-white/20 mb-2">Articolul generat va apărea aici</p>
              <p className="font-sans text-[12px] text-white/15">
                Alege tipul, lungimea și introdu subiectul, apoi apasă Generează
              </p>
            </div>
          ) : (
            <>
              {/* Language tabs */}
              <div className="flex items-center justify-between">
                <div className="flex gap-1">
                  {(['ro', 'en'] as const).map(l => (
                    <button
                      key={l}
                      onClick={() => setPreviewTab(l)}
                      className={
                        'font-sans text-[11px] uppercase tracking-widest px-4 py-2 transition-colors ' +
                        (previewTab === l
                          ? 'bg-brand-red text-white'
                          : 'bg-[#1a1a1a] text-white/40 border border-white/[0.07] hover:text-white')
                      }
                    >
                      {l === 'ro' ? '🇷🇴 Română' : '🇬🇧 English'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => saveArticle('draft')}
                    disabled={saving}
                    className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-[#1a1a1a] border border-white/10 text-white hover:border-white/30 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Salvează ciornă
                  </button>
                  <button
                    onClick={() => saveArticle('published')}
                    disabled={saving}
                    className="flex items-center gap-2 font-sans text-[12px] px-4 py-2 bg-brand-red text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    Publică acum
                  </button>
                </div>
              </div>

              {previewTab === 'ro' ? (
                <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
                  <Field label="Titlu principal (RO)">
                    <input className={inputCls} value={getField('title_ro') as string}
                      onChange={e => setField('title_ro', e.target.value)} />
                  </Field>
                  {(result.title_alt_ro || edited.title_alt_ro) && (
                    <Field label="Titlu alternativ (RO)">
                      <input className={inputCls} value={getField('title_alt_ro') as string}
                        onChange={e => setField('title_alt_ro', e.target.value)} />
                    </Field>
                  )}
                  <Field label="Rezumat (bullets)">
                    <textarea rows={4} className={textareaCls} value={getField('summary_ro') as string}
                      onChange={e => setField('summary_ro', e.target.value)} />
                  </Field>
                  <Field label="Introducere / Excerpt">
                    <textarea rows={3} className={textareaCls} value={getField('excerpt_ro') as string}
                      onChange={e => setField('excerpt_ro', e.target.value)} />
                  </Field>
                  <Field label="Conținut complet">
                    <textarea rows={20} className={textareaCls} value={getField('content_ro') as string}
                      onChange={e => setField('content_ro', e.target.value)} />
                  </Field>
                  <Field label="SEO Tags">
                    <input className={inputCls}
                      value={((getField('tags_ro') as string[]) || []).join(', ')}
                      onChange={e => setField('tags_ro', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                      placeholder="tag1, tag2, tag3" />
                  </Field>
                </div>
              ) : (
                <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-4">
                  <Field label="Title (EN)">
                    <input className={inputCls} value={getField('title_en') as string}
                      onChange={e => setField('title_en', e.target.value)} />
                  </Field>
                  {(result.title_alt_en || edited.title_alt_en) && (
                    <Field label="Alternative title (EN)">
                      <input className={inputCls} value={getField('title_alt_en') as string}
                        onChange={e => setField('title_alt_en', e.target.value)} />
                    </Field>
                  )}
                  <Field label="Summary (bullets)">
                    <textarea rows={4} className={textareaCls} value={getField('summary_en') as string}
                      onChange={e => setField('summary_en', e.target.value)} />
                  </Field>
                  <Field label="Introduction / Excerpt">
                    <textarea rows={3} className={textareaCls} value={getField('excerpt_en') as string}
                      onChange={e => setField('excerpt_en', e.target.value)} />
                  </Field>
                  <Field label="Full content">
                    <textarea rows={20} className={textareaCls} value={getField('content_en') as string}
                      onChange={e => setField('content_en', e.target.value)} />
                  </Field>
                  <Field label="SEO Tags">
                    <input className={inputCls}
                      value={((getField('tags_en') as string[]) || []).join(', ')}
                      onChange={e => setField('tags_en', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                      placeholder="tag1, tag2, tag3" />
                  </Field>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
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
