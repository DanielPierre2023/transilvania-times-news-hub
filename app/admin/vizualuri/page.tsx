'use client'

// app/admin/vizualuri/page.tsx
//
// Campaign visual generator. Calls generate-cover-image in RAW mode
// (raw_prompt + aspect) so the campaign art-direction prompts go straight to
// FLUX / DALL-E without the Gemini cover-rewrite, at social aspect ratios.
// Read-only on the DB; the function stores results in blog-images/campaign/.

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { ImageIcon, Download, Loader2, Sparkles, AlertCircle } from 'lucide-react'

type Aspect = '1:1' | '4:5' | '9:16' | '16:9'

interface Preset {
  key: string
  label: string
  aspect: Aspect
  prompt: string
}

// The section-09 image prompts, verbatim.
const PRESETS: Preset[] = [
  {
    key: 'ardeal',
    label: 'Key visual — Ardeal cinematic',
    aspect: '4:5',
    prompt:
      'Cinematic golden-hour photograph of the Transylvanian landscape — rolling Apuseni hills, a lone medieval Saxon church tower, morning mist, autumn tones. Warm parchment-and-crimson color grade, film grain, editorial newspaper aesthetic, deep shadows, muted cream sky. Shot on 35mm, shallow depth of field. No text, no logo.',
  },
  {
    key: 'diaspora',
    label: 'Diaspora — dor de casă',
    aspect: '4:5',
    prompt:
      'Emotional documentary photo: a young Romanian looking out a train window at dusk, warm reflection on glass, distant Transylvanian mountains below. Melancholic, hopeful, cinematic. Parchment-cream and deep crimson grade, film grain. Editorial, authentic, not staged. No text.',
  },
  {
    key: 'oras',
    label: 'Local — stradă de oraș ardelean',
    aspect: '1:1',
    prompt:
      'Street-level photograph of a Transylvanian city (Cluj / Brașov / Sibiu) — historic square, pastel facades, everyday people, tram lines, late afternoon light. Photojournalistic, candid, warm cream-crimson editorial grade, subtle film grain. Space at bottom for a caption band. No text.',
  },
  {
    key: 'newsroom',
    label: 'Newsroom — brand & încredere',
    aspect: '16:9',
    prompt:
      'Warm, characterful editorial still life: a folded classic broadsheet newspaper on an oak desk, brass reading lamp glow, a cup of coffee, vintage typewriter keys out of focus, cream paper and crimson masthead accent. Cozy, trustworthy, timeless. Cinematic, film grain. No readable text.',
  },
]

const ASPECTS: { v: Aspect; label: string }[] = [
  { v: '1:1', label: '1:1 · pătrat' },
  { v: '4:5', label: '4:5 · portret' },
  { v: '9:16', label: '9:16 · story/reel' },
  { v: '16:9', label: '16:9 · peisaj' },
]

interface Result {
  url: string
  aspect: Aspect
}

export default function VizualuriPage() {
  const [prompt, setPrompt] = useState('')
  const [aspect, setAspect] = useState<Aspect>('4:5')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<Result[]>([])

  const supabase = createSupabaseBrowserClient()

  function applyPreset(p: Preset) {
    setPrompt(p.prompt)
    setAspect(p.aspect)
    setError('')
  }

  async function generate() {
    if (!prompt.trim()) {
      setError('Scrie sau alege un prompt mai întâi.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('generate-cover-image', {
        body: { raw_prompt: prompt.trim(), aspect },
      })
      if (fnErr) throw new Error(fnErr.message)
      const url = (data as { publicUrl?: string })?.publicUrl
      if (!url) throw new Error((data as { error?: string })?.error || 'Generarea a eșuat.')
      setResults(prev => [{ url, aspect }, ...prev])
    } catch (e) {
      setError((e as Error).message || 'Ceva n-a mers. Încearcă din nou.')
    } finally {
      setLoading(false)
    }
  }

  async function download(url: string) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `tt-vizual-${Date.now()}.${blob.type.includes('png') ? 'png' : 'jpg'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(a.href)
    } catch {
      window.open(url, '_blank')
    }
  }

  const ratioClass: Record<Aspect, string> = {
    '1:1': 'aspect-square',
    '4:5': 'aspect-[4/5]',
    '9:16': 'aspect-[9/16]',
    '16:9': 'aspect-video',
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-2xl font-bold text-white flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-brand-red" />
          Vizualuri campanie
        </h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          Generează fundaluri în stilul TT (FLUX/DALL·E) — pentru postări, story-uri și reels
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Controls */}
        <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
          <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3">
            Prompturi gata (secțiunea 09)
          </p>
          <div className="grid grid-cols-1 gap-2 mb-6">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p)}
                className="text-left px-4 py-3 bg-[#111] border border-white/[0.07] hover:border-brand-red/60 transition-colors"
              >
                <span className="font-sans text-[13px] font-bold text-white">{p.label}</span>
                <span className="font-sans text-[11px] text-white/40 ml-2">· {p.aspect}</span>
              </button>
            ))}
          </div>

          <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-2">
            Prompt (editabil, în engleză)
          </p>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={7}
            placeholder="Alege un preset sau scrie propriul prompt…"
            className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[13px] p-3 font-sans resize-y focus:outline-none focus:border-brand-red/60"
          />

          <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mt-5 mb-2">
            Format
          </p>
          <div className="flex flex-wrap gap-2 mb-6">
            {ASPECTS.map(a => (
              <button
                key={a.v}
                onClick={() => setAspect(a.v)}
                className={
                  'px-3 py-2 font-sans text-[12px] border transition-colors ' +
                  (aspect === a.v
                    ? 'bg-brand-red text-white border-brand-red'
                    : 'bg-[#111] text-white/60 border-white/[0.07] hover:text-white')
                }
              >
                {a.label}
              </button>
            ))}
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-brand-red text-white font-sans text-sm font-bold py-3 hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Generez… (poate dura ~15–30s)' : 'Generează vizualul'}
          </button>

          {error && (
            <div className="mt-4 flex items-start gap-2 text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 p-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <p className="font-sans text-[11px] text-white/30 mt-4 leading-relaxed">
            FLUX (gratuit) e încercat primul; DALL·E doar ca rezervă. Fundalul e fără text — pui textul
            deasupra cu șabloanele din kit. Cel mai bun rezultat la 1:1 și 4:5.
          </p>
        </div>

        {/* Results */}
        <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
          <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3">
            Rezultate (sesiunea curentă)
          </p>
          {results.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center text-center py-16 text-white/25">
              <ImageIcon className="w-10 h-10 mb-3" />
              <p className="font-sans text-[13px]">Vizualurile generate apar aici.</p>
            </div>
          )}
          {loading && (
            <div className={`w-full ${ratioClass[aspect]} bg-white/5 animate-pulse mb-4 flex items-center justify-center`}>
              <Loader2 className="w-6 h-6 text-white/30 animate-spin" />
            </div>
          )}
          <div className="grid grid-cols-1 gap-4">
            {results.map((r, i) => (
              <div key={i} className="border border-white/[0.07]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="Vizual generat" className="w-full block" />
                <div className="flex items-center justify-between px-3 py-2 bg-[#111]">
                  <span className="font-sans text-[11px] text-white/40">{r.aspect}</span>
                  <button
                    onClick={() => download(r.url)}
                    className="flex items-center gap-1.5 font-sans text-[12px] font-bold text-white/70 hover:text-white transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" /> Descarcă
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
