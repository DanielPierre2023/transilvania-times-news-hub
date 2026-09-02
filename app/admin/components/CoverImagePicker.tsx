'use client'

// app/admin/components/CoverImagePicker.tsx
//
// The article cover-image refine panel — one shared component used by every
// editor. Three grounded sources plus manual, all in one place:
//   • Caută foto (Unsplash): a location-grounded query you can edit, returning
//     RELEVANCE-RANKED candidates you pick from a grid (via search-cover-photos).
//     The picked photo is copied into blog-images and credited.
//   • Generează AI: a grounded, editable prompt (via generate-cover-image).
//   • Încarcă / URL: manual, unchanged.
//
// The grounding (real country + Transylvanian county) lives server-side in the
// shared visual-brief, so "parliament" resolves to the Romanian one and the
// query/prompt are prefilled correctly on the first search.

import { useState, useRef, useCallback } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Loader2, Wand2, Upload, X, Search, Check, RefreshCw } from 'lucide-react'

type SupaClient = ReturnType<typeof createBrowserClient>

interface Candidate {
  id: string; thumb: string; preview: string; url: string; full: string
  author: string; author_link: string; unsplash_link: string
  download_location: string; alt: string
}

interface Props {
  supabase: SupaClient
  title: string
  summary?: string
  category?: string
  county?: string | null
  value: string                       // current cover_image URL
  credit: string                      // current cover_image_credit
  onChange: (url: string) => void
  onCreditChange: (credit: string) => void
}

const inp = 'w-full bg-black/40 border border-white/10 px-3 py-2 font-sans text-[13px] text-white/90 placeholder:text-white/25 focus:outline-none focus:border-white/30'
const btn = 'flex items-center justify-center gap-2 py-2.5 font-sans text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50'

export default function CoverImagePicker({
  supabase, title, summary, category, county, value, credit, onChange, onCreditChange,
}: Props) {
  const [panel, setPanel] = useState<'none' | 'unsplash' | 'ai'>('none')
  const [query, setQuery] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const [genning, setGenning] = useState(false)
  const [picking, setPicking] = useState('')
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  const note = (t: string) => { setMsg(t); if (t) setTimeout(() => setMsg(''), 4000) }

  // Unsplash: grounded search → ranked candidates. First run prefills the
  // query (and the AI prompt) from the server-side brief.
  const runSearch = useCallback(async (q?: string) => {
    if (!title && !q && !query) { note('Completați titlul mai întâi.'); return }
    setSearching(true); setPanel('unsplash')
    try {
      const { data, error } = await supabase.functions.invoke('search-cover-photos', {
        body: { action: 'search', title, summary, category, county, query: q ?? query },
      })
      if (error) throw new Error(error.message)
      const d = (data || {}) as { error?: string; query?: string; results?: Candidate[]; brief?: { photo_prompt?: string } }
      if (d.error) throw new Error(d.error)
      setCandidates(Array.isArray(d.results) ? d.results : [])
      if (!query && d.query) setQuery(d.query)
      if (!aiPrompt && d.brief?.photo_prompt) setAiPrompt(d.brief.photo_prompt)
      if (!d.results?.length) note('Niciun rezultat — ajustați căutarea.')
    } catch (e) {
      note(`Căutare eșuată: ${(e as Error).message}`)
    }
    setSearching(false)
  }, [supabase, title, summary, category, county, query, aiPrompt])

  const pick = useCallback(async (c: Candidate) => {
    setPicking(c.id)
    try {
      const { data, error } = await supabase.functions.invoke('search-cover-photos', {
        body: { action: 'download', image_url: c.url, download_location: c.download_location, credit: `Foto: ${c.author} / Unsplash` },
      })
      if (error) throw new Error(error.message)
      const d = (data || {}) as { error?: string; publicUrl?: string }
      if (d.error || !d.publicUrl) throw new Error(d.error || 'descărcare eșuată')
      onChange(d.publicUrl)
      onCreditChange(`Foto: ${c.author} / Unsplash`)
      note('✓ Foto setată')
    } catch (e) {
      note(`Nu s-a putut prelua: ${(e as Error).message}`)
    }
    setPicking('')
  }, [supabase, onChange, onCreditChange])

  // AI: grounded, editable prompt. `prompt` is honoured by the upgraded
  // generate-cover-image; the classic function ignores it and uses title/category.
  const runAI = useCallback(async () => {
    if (!title) { note('Completați titlul mai întâi.'); return }
    setGenning(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-cover-image', {
        body: { title, summary, category, county, prompt: aiPrompt || undefined },
      })
      if (error) throw new Error(error.message)
      const d = (data || {}) as { error?: string; publicUrl?: string }
      if (d.error || !d.publicUrl) throw new Error(d.error || 'generare eșuată')
      onChange(d.publicUrl)
      onCreditChange('Imagine generată cu inteligență artificială')
      note('✓ Imagine generată')
    } catch (e) {
      note(`Eroare: ${(e as Error).message}`)
    }
    setGenning(false)
  }, [supabase, title, summary, category, county, aiPrompt, onChange, onCreditChange])

  const onUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { note('Selectați un fișier imagine'); return }
    if (file.size > 10 * 1024 * 1024) { note('Imaginea trebuie să fie sub 10MB'); return }
    setUploading(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `covers/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('blog-images').upload(fileName, file, { contentType: file.type, upsert: false })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('blog-images').getPublicUrl(fileName)
      onChange(urlData.publicUrl)
      onCreditChange('Arhivă')
      note('✓ Imagine încărcată')
    } catch (err) {
      note(`Eroare upload: ${(err as Error).message}`)
    }
    setUploading(false)
    if (uploadRef.current) uploadRef.current.value = ''
  }, [supabase, onChange, onCreditChange])

  return (
    <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 space-y-3">
      <p className="font-sans text-[11px] uppercase tracking-widest text-white/40 border-b border-white/[0.07] pb-3">Imagine copertă</p>

      {value && (
        <div className="relative">
          <img src={value} alt="Cover" className="w-full aspect-video object-cover" />
          <button onClick={() => onChange('')} className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 transition-colors"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Primary sources */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => (panel === 'unsplash' ? setPanel('none') : runSearch())} disabled={searching}
          className={`${btn} border ${panel === 'unsplash' ? 'bg-emerald-600/25 border-emerald-500/40 text-emerald-200' : 'bg-emerald-600/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-600/20'}`}>
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Caută foto
        </button>
        <button onClick={() => setPanel(panel === 'ai' ? 'none' : 'ai')}
          className={`${btn} border ${panel === 'ai' ? 'bg-blue-600/25 border-blue-500/40 text-blue-200' : 'bg-blue-600/10 border-blue-500/25 text-blue-300 hover:bg-blue-600/20'}`}>
          <Wand2 className="w-3.5 h-3.5" /> Generează AI
        </button>
      </div>

      {/* Unsplash panel */}
      {panel === 'unsplash' && (
        <div className="space-y-2 border border-emerald-500/20 bg-emerald-950/10 p-3">
          <div className="flex gap-2">
            <input className={inp} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch() }} placeholder="ex: Romanian Parliament Bucharest" />
            <button onClick={() => runSearch()} disabled={searching} className={`${btn} px-3 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/20`}>
              {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
          {candidates.length > 0 && (
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {candidates.map(c => (
                <button key={c.id} onClick={() => pick(c)} disabled={!!picking}
                  className="relative group aspect-video overflow-hidden border border-white/10 hover:border-emerald-400/60 transition-colors">
                  <img src={c.thumb} alt={c.alt} className="w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 flex items-center justify-center transition-colors">
                    {picking === c.id ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Check className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />}
                  </span>
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white/80 text-[8px] px-1 py-0.5 truncate">{c.author}</span>
                </button>
              ))}
            </div>
          )}
          <p className="font-sans text-[10px] text-white/25">Fotografii reale Unsplash · alese după relevanță · creditate automat.</p>
        </div>
      )}

      {/* AI panel */}
      {panel === 'ai' && (
        <div className="space-y-2 border border-blue-500/20 bg-blue-950/10 p-3">
          <textarea className={`${inp} h-24 resize-y`} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
            placeholder="Prompt vizual (se completează automat, editabil)…" />
          <button onClick={runAI} disabled={genning || !title} className={`${btn} w-full bg-blue-600/20 border border-blue-500/30 text-blue-300 hover:bg-blue-600/30`}>
            {genning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generează…</> : <><Wand2 className="w-3.5 h-3.5" /> Generează imaginea</>}
          </button>
          <p className="font-sans text-[10px] text-white/25">Imagine AI (gpt-image-1) · pentru subiecte concrete, o fotografie reală e de obicei mai potrivită.</p>
        </div>
      )}

      {/* Manual */}
      <input className={inp} value={value} onChange={e => onChange(e.target.value)} placeholder="https://... sau încarcă mai jos" />
      <input ref={uploadRef} type="file" accept="image/*" onChange={onUpload} className="hidden" id="cover-img-upload" />
      <label htmlFor="cover-img-upload" className={`${btn} w-full border ${uploading ? 'border-white/10 text-white/30 cursor-not-allowed' : 'border-white/20 text-white/60 hover:text-white hover:border-white/40 cursor-pointer'}`}>
        {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Upload…</> : <><Upload className="w-3.5 h-3.5" /> De pe calculator</>}
      </label>

      {/* Credit */}
      <div>
        <label className="block font-sans text-[11px] uppercase tracking-widest text-white/40 mb-1.5">Sursă / creditare fotografie</label>
        <input className={inp} value={credit} onChange={e => onCreditChange(e.target.value)} placeholder="Foto: … / Unsplash · Imagine generată cu AI · © Reuters" />
      </div>
      {credit ? <p className="font-sans text-[10px] text-blue-400/60">{credit.toLowerCase().includes('generat') ? '🤖' : '📷'} Afișat sub fotografie: &bdquo;{credit}&rdquo;</p> : null}
      {msg ? <p className="font-sans text-[10px] text-white/50">{msg}</p> : null}
      <p className="font-sans text-[10px] text-white/20">Upload: JPG/PNG/WebP max 10MB · Foto reale: Unsplash · AI: gpt-image-1</p>
    </div>
  )
}
