'use client'

// app/admin/studio/page.tsx
//
// Marketing Studio — compose a marketing video (up to 180s) from scenes:
//   • AI-generated images (reuses generate-cover-image raw mode)
//   • your own uploaded images and video clips
//   • Ken Burns motion on images
//   • OpenAI TTS voiceover (generate-voiceover)
//   • auto-timed subtitles from the voiceover (align-subtitles, Whisper)
//   • optional background music (ducked under the voice)
//
// Rendering is PLUGGABLE:
//   • Browser (default, free): Canvas + MediaRecorder → MP4 where the browser
//     supports it, else WebM. No cross-origin-isolation headers needed, so the
//     public site / AdSense are untouched. Real-time capture (a 60s video takes
//     ~60s to record).
//   • Cloud (optional): render-video edge function forwards a spec to a provider
//     when RENDER_API_URL/RENDER_API_KEY are set.
//
// Uploaded assets + renders live in the public `studio-assets` bucket.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Clapperboard, ImagePlus, Upload, Mic, Captions, Music, Film,
  Sparkles, Loader2, Play, Square, Trash2, ArrowUp, ArrowDown, Download, AlertCircle, Wand2,
  UserPlus, Zap, ShieldCheck, Save, FolderOpen,
} from 'lucide-react'

type Aspect = '9:16' | '1:1' | '4:5' | '16:9'
type KB = 'none' | 'in' | 'out' | 'left' | 'right'
type SubPos = 'jos' | 'treime' | 'sus'
interface Scene { id: string; kind: 'image' | 'video'; url: string; name: string; duration: number; kb: KB; motion?: 'idle' | 'working' | 'done' }
interface Cue { start: number; end: number; text: string }
interface ElVoice { voice_id: string; name: string; category: string; provider?: 'elevenlabs' | 'minimax' }

const ASPECTS: Record<Aspect, [number, number]> = {
  '9:16': [720, 1280], '1:1': [1000, 1000], '4:5': [864, 1080], '16:9': [1280, 720],
}
const GEMINI_VOICES: { v: string; label: string }[] = [
  { v: 'Charon', label: 'Charon · bărbat, grav' },
  { v: 'Orus', label: 'Orus · bărbat, ferm' },
  { v: 'Puck', label: 'Puck · bărbat, optimist' },
  { v: 'Kore', label: 'Kore · femeie, fermă' },
  { v: 'Zephyr', label: 'Zephyr · femeie, luminoasă' },
  { v: 'Leda', label: 'Leda · femeie, tânără' },
  { v: 'Aoede', label: 'Aoede · femeie, lejeră' },
  { v: 'Fenrir', label: 'Fenrir · bărbat, energic' },
]
const TONES: { v: string; label: string }[] = [
  { v: 'stiri', label: 'Știri · autoritar' },
  { v: 'emotional', label: 'Emoțional · poveste' },
  { v: 'energic', label: 'Energic · promo' },
  { v: 'calm', label: 'Calm · documentar' },
]
const SUB_POS: Record<SubPos, number> = { jos: 0.88, treime: 0.76, sus: 0.14 }
const IMG_PRESETS: { label: string; aspect: string; prompt: string }[] = [
  { label: 'Ardeal cinematic', aspect: '4:5', prompt: 'Cinematic golden-hour photograph of the Transylvanian landscape — rolling Apuseni hills, a lone medieval Saxon church tower, morning mist, autumn tones. Warm parchment-and-crimson color grade, film grain, editorial newspaper aesthetic. No text.' },
  { label: 'Diaspora — dor de casă', aspect: '4:5', prompt: 'Emotional documentary photo: a young Romanian looking out a train window at dusk, warm reflection on glass, distant Transylvanian mountains. Melancholic, hopeful, cinematic, parchment-crimson grade, film grain. No text.' },
  { label: 'Oraș ardelean', aspect: '1:1', prompt: 'Street-level photograph of a Transylvanian city — historic square, pastel facades, everyday people, late afternoon light. Photojournalistic, warm cream-crimson editorial grade, film grain. No text.' },
  { label: 'Newsroom brand', aspect: '16:9', prompt: 'Warm editorial still life: a folded classic broadsheet newspaper on an oak desk, brass lamp glow, coffee, cream paper and crimson masthead accent. Cozy, trustworthy, cinematic, film grain. No readable text.' },
]

const uid = () => Math.random().toString(36).slice(2, 10)
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function StudioPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [imgPrompt, setImgPrompt] = useState('')
  const [imgAspect, setImgAspect] = useState('4:5')
  const [refImageUrl, setRefImageUrl] = useState('')   // reference photo -> image-to-image

  const [script, setScript] = useState('')
  const [voice] = useState('onyx')
  const [geminiVoice, setGeminiVoice] = useState('Charon')
  const [voUrl, setVoUrl] = useState('')
  const [voDur, setVoDur] = useState(0)

  // ElevenLabs voice engine
  const [elConfigured, setElConfigured] = useState(false)
  const [elVoices, setElVoices] = useState<ElVoice[]>([])
  const [elVoiceId, setElVoiceId] = useState('')
  const [tone, setTone] = useState('stiri')
  const [lang, setLang] = useState<'ro' | 'en'>('ro')

  // Voice cloning lab
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneName, setCloneName] = useState('')
  const [clonePerson, setClonePerson] = useState('')
  const [cloneConsent, setCloneConsent] = useState(false)
  const [cloneSamples, setCloneSamples] = useState<string[]>([])
  const [cloneEngine, setCloneEngine] = useState<'minimax' | 'elevenlabs'>('minimax')
  const [providers, setProviders] = useState<{ elevenlabs: boolean; minimax: boolean }>({ elevenlabs: false, minimax: false })

  const [cues, setCues] = useState<Cue[]>([])
  const [words, setWords] = useState<{ word: string; start: number; end: number }[]>([])
  const [capMode, setCapMode] = useState<'clasic' | 'karaoke'>('clasic')
  const [subsOn, setSubsOn] = useState(true)
  const [subPos, setSubPos] = useState<SubPos>('jos')
  const [subScale, setSubScale] = useState(1)

  // Project persistence (studio_projects)
  const [projName, setProjName] = useState('')
  const [projId, setProjId] = useState('')
  const [projects, setProjects] = useState<{ id: string; name: string; updated_at: string }[]>([])

  const [musicUrl, setMusicUrl] = useState('')
  const [musicVol, setMusicVol] = useState(0.18)

  const [busy, setBusy] = useState<string>('')       // label of in-flight op
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(false)
  const [renderPct, setRenderPct] = useState(0)
  const [outUrl, setOutUrl] = useState('')
  const [outMime, setOutMime] = useState('')
  const [cloud, setCloud] = useState<{ status: string; url: string; msg: string }>({ status: '', url: '', msg: '' })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<{ raf: number; stop: () => void } | null>(null)
  const mediaCache = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map())
  const db = useMemo(() => supabase as unknown as SupabaseClient, [supabase])

  // Karaoke groups: ≤4 words / ≤26 chars, split at sentence ends.
  const karaoke = useMemo(() => {
    const out: { start: number; end: number; ws: { word: string; start: number; end: number }[] }[] = []
    let g: typeof words = []
    const flush = () => { if (g.length) { out.push({ start: g[0].start, end: g[g.length - 1].end, ws: g }); g = [] } }
    for (const w of words) {
      g.push(w)
      const chars = g.reduce((a, x) => a + x.word.length + 1, 0)
      if (g.length >= 4 || chars > 26 || /[.!?]$/.test(w.word)) flush()
    }
    flush()
    return out
  }, [words])

  const [W, H] = ASPECTS[aspect]
  const scenesDur = scenes.reduce((s, x) => s + x.duration, 0)
  const totalDur = Math.min(180, Math.max(scenesDur, voDur))

  // ─── helpers ────────────────────────────────────────────────────────────
  async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
    const { data, error: e } = await supabase.functions.invoke(fn, { body })
    if (e) throw new Error(e.message)
    const d = data as { error?: string }
    if (d?.error) throw new Error(d.error)
    return data as T
  }
  // Raw invoke (does not treat {error} as fatal) — used for the render-video passthrough.
  async function invokeRaw(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error: e } = await supabase.functions.invoke(fn, { body })
    if (e) throw new Error(e.message)
    return (data || {}) as Record<string, unknown>
  }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // Load the ElevenLabs voice list once (falls back to OpenAI voices if absent).
  useEffect(() => {
    let alive = true
    refreshProjects()
    ;(async () => {
      try {
        const r = await invokeRaw('voice-lab', { action: 'list' })
        if (!alive) return
        if (r.providers) setProviders(r.providers as { elevenlabs: boolean; minimax: boolean })
        if (r.configured === true && Array.isArray(r.voices)) {
          const vs = r.voices as ElVoice[]
          setElConfigured(true)
          setElVoices(vs)
          if (vs.length && !elVoiceId) setElVoiceId(vs[0].voice_id)
          // Default the cloning engine to whichever is available (both kept equal).
          if (r.providers && !(r.providers as { minimax: boolean }).minimax && (r.providers as { elevenlabs: boolean }).elevenlabs) setCloneEngine('elevenlabs')
        }
      } catch { /* not configured — OpenAI fallback stays active */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function uploadAsset(folder: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${folder}/${Date.now()}-${uid()}.${ext}`
    const { error: e } = await supabase.storage.from('studio-assets').upload(path, file, { contentType: file.type, upsert: false })
    if (e) throw new Error(`Upload eșuat: ${e.message}`)
    return supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    const cached = mediaCache.current.get(url)
    if (cached instanceof HTMLImageElement) return Promise.resolve(cached)
    return new Promise((res, rej) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { mediaCache.current.set(url, img); res(img) }
      img.onerror = () => rej(new Error('Nu am putut încărca imaginea (CORS?).'))
      img.src = url
    })
  }
  function loadVideo(url: string): Promise<HTMLVideoElement> {
    const cached = mediaCache.current.get(url)
    if (cached instanceof HTMLVideoElement) return Promise.resolve(cached)
    return new Promise((res, rej) => {
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto'
      v.onloadeddata = () => { mediaCache.current.set(url, v); res(v) }
      v.onerror = () => rej(new Error('Nu am putut încărca clipul.'))
      v.src = url
    })
  }
  function audioDuration(url: string): Promise<number> {
    return new Promise((res) => {
      const a = new Audio(); a.preload = 'metadata'
      a.onloadedmetadata = () => {
        if (isFinite(a.duration) && a.duration > 0) return res(a.duration)
        a.currentTime = 1e101
        a.ontimeupdate = () => { a.ontimeupdate = null; res(isFinite(a.duration) ? a.duration : 0) }
      }
      a.onerror = () => res(0)
      a.src = url
    })
  }
  async function decode(ctx: AudioContext, url: string): Promise<AudioBuffer> {
    const buf = await (await fetch(url)).arrayBuffer()
    return await ctx.decodeAudioData(buf)
  }

  // ─── asset actions ──────────────────────────────────────────────────────
  const genImage = useCallback(async () => {
    if (!imgPrompt.trim()) { setError('Scrie sau alege un prompt de imagine.'); return }
    setError(''); setBusy('image')
    try {
      // With a reference photo attached, condition on it (image-to-image via
      // gpt-image-1) so the result actually reflects the uploaded picture.
      // Without one, fall back to text-to-image (generate-cover-image).
      const r = refImageUrl
        ? await invoke<{ publicUrl: string }>('generate-image-edit', { image_urls: [refImageUrl], prompt: imgPrompt.trim(), aspect: imgAspect })
        : await invoke<{ publicUrl: string }>('generate-cover-image', { raw_prompt: imgPrompt.trim(), aspect: imgAspect })
      setScenes(s => [...s, { id: uid(), kind: 'image', url: r.publicUrl, name: (refImageUrl ? 'Editată · ' : 'AI · ') + imgAspect, duration: 4, kb: 'in' }])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }, [imgPrompt, imgAspect, refImageUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Upload a reference photo used to CONDITION image generation (image-to-image).
  async function onRefImage(file?: File) {
    if (!file) return
    setError(''); setBusy('refimg')
    try { setRefImageUrl(await uploadAsset('refs', file)) }
    catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  async function onUpload(kind: 'image' | 'video', file?: File) {
    if (!file) return
    setError(''); setBusy(kind === 'image' ? 'upimg' : 'upvid')
    try {
      const url = await uploadAsset(kind === 'image' ? 'images' : 'clips', file)
      let duration = 4
      if (kind === 'video') { const v = await loadVideo(url); duration = Math.min(60, Math.max(1, v.duration || 5)) }
      setScenes(s => [...s, { id: uid(), kind, url, name: (kind === 'image' ? 'Foto · ' : 'Clip · ') + file.name.slice(0, 18), duration, kb: kind === 'image' ? 'in' : 'none' }])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  async function genVoice() {
    if (!script.trim()) { setError('Scrie textul pentru voce.'); return }
    setError(''); setBusy('voice')
    try {
      const sel = elVoices.find(v => v.voice_id === elVoiceId)
      const body: Record<string, unknown> =
        sel?.provider === 'minimax'
          // Your own cloned voice via fal/MiniMax — subscription-free, RO native.
          ? { text: script.trim(), provider: 'minimax', minimax_voice: elVoiceId, tone, language: lang }
          : elConfigured && elVoiceId
            ? { text: script.trim(), voice_id: elVoiceId, tone, language: lang }
            : { text: script.trim(), provider: 'gemini', gemini_voice: geminiVoice, tone, language: lang, voice }
      const r = await invoke<{ publicUrl: string }>('generate-voiceover', body)
      const d = await audioDuration(r.publicUrl)
      setVoUrl(r.publicUrl); setVoDur(d || Math.ceil(script.length / 14))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // Split a Whisper segment into short display cues (max 2 lines ≈ 42 chars/line)
  // so subtitles never blanket the frame.
  function splitCues(segs: Cue[]): Cue[] {
    const MAX = 84 // ~2 lines
    const out: Cue[] = []
    for (const s of segs) {
      const text = s.text.trim()
      if (text.length <= MAX) { out.push(s); continue }
      const words = text.split(/\s+/)
      const chunks: string[] = []
      let cur = ''
      for (const w of words) {
        const t = cur ? cur + ' ' + w : w
        if (t.length > MAX && cur) { chunks.push(cur); cur = w } else cur = t
      }
      if (cur) chunks.push(cur)
      const total = text.length
      let t0 = s.start
      for (const c of chunks) {
        const dur = (s.end - s.start) * (c.length / total)
        out.push({ start: t0, end: Math.min(s.end, t0 + dur), text: c })
        t0 += dur
      }
    }
    return out
  }

  async function genSubs() {
    if (!voUrl) { setError('Generează întâi vocea.'); return }
    setError(''); setBusy('subs')
    try {
      const r = await invoke<{ segments: Cue[]; words?: { word: string; start: number; end: number }[] }>('align-subtitles', { audio_url: voUrl, language: lang })
      setCues(splitCues(r.segments || []))
      setWords(r.words || [])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // ─── project persistence ────────────────────────────────────────────────
  function projectData() {
    return { aspect, scenes, script, lang, tone, elVoiceId, geminiVoice, voice, voUrl, voDur, cues, words, capMode, subsOn, subPos, subScale, musicUrl, musicVol }
  }
  async function refreshProjects() {
    try {
      const { data } = await db.from('studio_projects').select('id, name, updated_at').order('updated_at', { ascending: false }).limit(12)
      if (data) setProjects(data as { id: string; name: string; updated_at: string }[])
    } catch { /* table not created yet */ }
  }
  async function saveProject() {
    const name = projName.trim() || `Proiect ${new Date().toLocaleDateString('ro-RO')}`
    setError(''); setBusy('save')
    try {
      if (projId) {
        const { error: e } = await db.from('studio_projects').update({ name, data: projectData(), updated_at: new Date().toISOString() }).eq('id', projId)
        if (e) throw new Error(e.message)
      } else {
        const { data, error: e } = await db.from('studio_projects').insert({ name, data: projectData() }).select('id').single()
        if (e) throw new Error(e.message)
        if (data?.id) setProjId(String(data.id))
      }
      setProjName(name); await refreshProjects()
    } catch (e) { setError('Salvarea a eșuat (rulează tt-studio-projects.sql?): ' + (e as Error).message) } finally { setBusy('') }
  }
  async function loadProject(id: string) {
    if (!id) return
    setError(''); setBusy('load')
    try {
      const { data, error: e } = await db.from('studio_projects').select('id, name, data').eq('id', id).single()
      if (e || !data) throw new Error(e?.message || 'negăsit')
      const d = (data.data || {}) as Record<string, unknown>
      setProjId(String(data.id)); setProjName(String(data.name || ''))
      if (d.aspect) setAspect(d.aspect as Aspect)
      if (Array.isArray(d.scenes)) setScenes(d.scenes as Scene[])
      if (typeof d.script === 'string') setScript(d.script)
      if (d.lang === 'ro' || d.lang === 'en') setLang(d.lang)
      if (typeof d.tone === 'string') setTone(d.tone)
      if (typeof d.elVoiceId === 'string') setElVoiceId(d.elVoiceId)
      if (typeof d.geminiVoice === 'string') setGeminiVoice(d.geminiVoice)
      if (typeof d.voUrl === 'string') setVoUrl(d.voUrl)
      if (typeof d.voDur === 'number') setVoDur(d.voDur)
      if (Array.isArray(d.cues)) setCues(d.cues as Cue[])
      if (Array.isArray(d.words)) setWords(d.words as { word: string; start: number; end: number }[])
      if (d.capMode === 'clasic' || d.capMode === 'karaoke') setCapMode(d.capMode)
      if (typeof d.subsOn === 'boolean') setSubsOn(d.subsOn)
      if (typeof d.subPos === 'string') setSubPos(d.subPos as SubPos)
      if (typeof d.subScale === 'number') setSubScale(d.subScale)
      if (typeof d.musicUrl === 'string') setMusicUrl(d.musicUrl)
      if (typeof d.musicVol === 'number') setMusicVol(d.musicVol)
      setOutUrl('')
    } catch (e) { setError('Încărcarea a eșuat: ' + (e as Error).message) } finally { setBusy('') }
  }

  // ─── voice cloning (ElevenLabs, consent required) ───────────────────────
  async function onCloneSample(file?: File) {
    if (!file) return
    setError(''); setBusy('clonesample')
    try {
      const url = await uploadAsset('voice-samples', file)
      setCloneSamples(s => [...s, url].slice(0, 3))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  async function doClone() {
    if (!cloneName.trim() || !clonePerson.trim()) { setError('Completează numele vocii și persoana.'); return }
    if (!cloneConsent) { setError('Bifează consimțământul — fără acordul explicit al persoanei nu clonez vocea.'); return }
    if (cloneSamples.length === 0) { setError('Încarcă cel puțin o mostră audio (min. 10s, curată).'); return }
    setError(''); setBusy('clone')
    try {
      // Two engines, kept equal: 'minimax' clones via fal (no subscription),
      // 'elevenlabs' via ElevenLabs IVC. Both persist to studio_voices so the
      // voice is remembered by the app itself and never "disappears".
      const cloneAction = cloneEngine === 'minimax' ? 'clone_fal' : 'clone'
      const r = await invoke<{ voice_id: string; provider?: string }>('voice-lab', {
        action: cloneAction, name: cloneName.trim(), audio_urls: cloneSamples, language: lang,
        consent: { granted: true, person_name: clonePerson.trim(), granted_by: 'admin' },
      })
      const nv: ElVoice = { voice_id: r.voice_id, name: cloneName.trim(), category: 'cloned', provider: (r.provider as 'minimax' | 'elevenlabs') || cloneEngine }
      setElVoices(v => [nv, ...v]); setElConfigured(true); setElVoiceId(r.voice_id)
      setCloneOpen(false); setCloneName(''); setClonePerson(''); setCloneConsent(false); setCloneSamples([])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // ─── image → video motion (fal.ai Kling) ────────────────────────────────
  async function animateScene(id: string) {
    const sc = scenes.find(s => s.id === id)
    if (!sc || sc.kind !== 'image') return
    setError('')
    setScenes(s => s.map(x => x.id === id ? { ...x, motion: 'working' } : x))
    try {
      const created = await invokeRaw('generate-motion', { action: 'create', image_url: sc.url, duration: String(Math.min(10, Math.max(5, sc.duration))) === '10' ? '10' : '5' })
      if (created.configured === false) throw new Error(String(created.message || 'FAL_KEY lipsește.'))
      if (created.error) throw new Error(String(created.error))
      const statusUrl = String(created.status_url || ''), responseUrl = String(created.response_url || '')
      if (!statusUrl) throw new Error('fal nu a returnat status_url')
      for (let i = 0; i < 75; i++) {
        await sleep(4000)
        const st = await invokeRaw('generate-motion', { action: 'poll', status_url: statusUrl, response_url: responseUrl })
        if (st.error) throw new Error(String(st.error))
        if (st.status === 'COMPLETED' && st.publicUrl) {
          const url = String(st.publicUrl)
          const v = await loadVideo(url)
          setScenes(s => s.map(x => x.id === id
            ? { ...x, kind: 'video', url, name: '🎞 ' + x.name.replace(/^🎞 /, ''), duration: Math.min(30, Math.max(1, v.duration || x.duration)), kb: 'none', motion: 'done' }
            : x))
          return
        }
      }
      throw new Error('Animarea durează neobișnuit de mult — reîncearcă.')
    } catch (e) {
      setError('Animare: ' + (e as Error).message)
      setScenes(s => s.map(x => x.id === id ? { ...x, motion: 'idle' } : x))
    }
  }

  async function onMusic(file?: File) {
    if (!file) return
    setError(''); setBusy('music')
    try { setMusicUrl(await uploadAsset('music', file)) } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // ─── scene ops ──────────────────────────────────────────────────────────
  const move = (i: number, d: number) => setScenes(s => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s;[n[i], n[j]] = [n[j], n[i]]; return n })
  const del = (id: string) => setScenes(s => s.filter(x => x.id !== id))
  const setDur = (id: string, v: number) => setScenes(s => s.map(x => x.id === id ? { ...x, duration: Math.min(30, Math.max(1, v)) } : x))
  const setKb = (id: string, kb: KB) => setScenes(s => s.map(x => x.id === id ? { ...x, kb } : x))

  // ─── drawing ────────────────────────────────────────────────────────────
  function drawCover(ctx: CanvasRenderingContext2D, m: HTMLImageElement | HTMLVideoElement, mW: number, mH: number, scale: number, ox: number, oy: number) {
    const mr = mW / mH, cr = W / H
    let dw: number, dh: number
    if (mr > cr) { dh = H * scale; dw = dh * mr } else { dw = W * scale; dh = dw / mr }
    ctx.drawImage(m, (W - dw) / 2 + ox, (H - dh) / 2 + oy, dw, dh)
  }
  function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(' '); const lines: string[] = []; let line = ''
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t }
    if (line) lines.push(line); return lines
  }
  function activeSceneAt(t: number): { scene: Scene; p: number } | null {
    if (scenes.length === 0) return null
    let acc = 0
    for (const sc of scenes) { if (t < acc + sc.duration) return { scene: sc, p: (t - acc) / sc.duration }; acc += sc.duration }
    const last = scenes[scenes.length - 1]; return { scene: last, p: 1 }
  }
  function drawFrame(ctx: CanvasRenderingContext2D, t: number) {
    ctx.fillStyle = '#150b06'; ctx.fillRect(0, 0, W, H)
    const a = activeSceneAt(t)
    if (a) {
      const m = mediaCache.current.get(a.scene.url)
      if (m) {
        const mW = m instanceof HTMLVideoElement ? m.videoWidth : m.naturalWidth
        const mH = m instanceof HTMLVideoElement ? m.videoHeight : m.naturalHeight
        if (mW && mH) {
          const p = a.p, k = a.scene.kb
          let scale = 1.02, ox = 0; const oy = 0
          if (k === 'in') scale = 1.02 + 0.10 * p
          else if (k === 'out') scale = 1.12 - 0.10 * p
          else if (k === 'left') { scale = 1.1; ox = (0.5 - p) * W * 0.12 }
          else if (k === 'right') { scale = 1.1; ox = (p - 0.5) * W * 0.12 }
          drawCover(ctx, m, mW, mH, scale, ox, oy)
        }
      }
    }
    // subtitles — max 2 lines, positionable, scalable, anchored so they never
    // blanket the frame (bottom-anchored for jos/treime, top-anchored for sus).
    if (subsOn) {
      const anchor = H * SUB_POS[subPos]
      if (capMode === 'karaoke' && karaoke.length) {
        const grp = karaoke.find(g => t >= g.start && t <= g.end + 0.12)
        if (grp) {
          const fs = Math.round(H * 0.036 * subScale)
          ctx.font = `800 ${fs}px Inter, system-ui, sans-serif`; ctx.textBaseline = 'middle'
          const gap = fs * 0.4
          const widths = grp.ws.map(w => ctx.measureText(w.word.toUpperCase()).width)
          const totalW = widths.reduce((a, b) => a + b, 0) + gap * (grp.ws.length - 1)
          const lh = fs * 1.55
          ctx.fillStyle = 'rgba(21,11,6,0.8)'
          roundRect(ctx, W / 2 - totalW / 2 - 16, anchor - lh / 2, totalW + 32, lh, 6); ctx.fill()
          let x = W / 2 - totalW / 2
          ctx.textAlign = 'left'
          grp.ws.forEach((w, i) => {
            const spoken = t >= w.start, active = t >= w.start && t <= w.end
            ctx.fillStyle = active ? '#FFD37A' : spoken ? '#FFFFFF' : 'rgba(255,255,255,0.42)'
            ctx.fillText(w.word.toUpperCase(), x, anchor)
            x += widths[i] + gap
          })
        }
      } else {
        const cue = cues.find(c => t >= c.start && t <= c.end)
        if (cue) {
          const fs = Math.round(H * 0.032 * subScale)
          ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          const lines = wrap(ctx, cue.text.toUpperCase(), W * 0.84).slice(0, 2)
          const lh = fs * 1.45
          let y = subPos === 'sus' ? anchor : anchor - (lines.length - 1) * lh
          for (const ln of lines) {
            const tw = ctx.measureText(ln).width
            ctx.fillStyle = 'rgba(21,11,6,0.72)'
            roundRect(ctx, W / 2 - tw / 2 - 14, y - lh / 2, tw + 28, lh * 0.92, 6); ctx.fill()
            ctx.fillStyle = '#fff'; ctx.fillText(ln, W / 2, y)
            y += lh
          }
        }
      }
    }
    // brand wordmark
    ctx.font = `italic 700 ${Math.round(H * 0.026)}px Georgia, serif`
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fillText('Transilvania Times', W * 0.05, H * 0.07)
    ctx.fillStyle = '#CA2222'; ctx.fillRect(W * 0.05, H * 0.085, W * 0.16, H * 0.006)
  }
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }

  async function preloadAll() {
    for (const sc of scenes) {
      if (sc.kind === 'image') await loadImage(sc.url)
      else await loadVideo(sc.url)
    }
  }

  // ─── preview ────────────────────────────────────────────────────────────
  async function preview() {
    if (previewRef.current) { previewRef.current.stop(); previewRef.current = null; return }
    if (scenes.length === 0) { setError('Adaugă cel puțin o scenă.'); return }
    setError(''); setBusy('prep')
    try { await preloadAll() } catch (e) { setError((e as Error).message); setBusy(''); return }
    setBusy('')
    const ctx = canvasRef.current!.getContext('2d')!
    const audio = voUrl ? new Audio(voUrl) : null
    if (audio) { audio.crossOrigin = 'anonymous'; audio.currentTime = 0; audio.play().catch(() => {}) }
    // play any video scenes
    scenes.filter(s => s.kind === 'video').forEach(s => { const v = mediaCache.current.get(s.url); if (v instanceof HTMLVideoElement) { v.currentTime = 0; v.play().catch(() => {}) } })
    const start = performance.now()
    let raf = 0
    const loop = () => {
      const t = (performance.now() - start) / 1000
      if (t >= totalDur) { stop(); return }
      // keep active video scene playing near its local time
      drawFrame(ctx, t)
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      if (audio) audio.pause()
      scenes.filter(s => s.kind === 'video').forEach(s => { const v = mediaCache.current.get(s.url); if (v instanceof HTMLVideoElement) v.pause() })
      previewRef.current = null
      setBusy('')
    }
    previewRef.current = { raf, stop }
    setBusy('preview')
    loop()
  }

  // ─── render (browser) ──────────────────────────────────────────────────
  async function render() {
    if (scenes.length === 0) { setError('Adaugă cel puțin o scenă.'); return }
    setError(''); setOutUrl(''); setRenderPct(0); setRendering(true)
    try {
      await preloadAll()
      const canvas = canvasRef.current!
      const ctx = canvas.getContext('2d')!
      const fps = 30
      const vstream = canvas.captureStream(fps)

      const ac = new AudioContext()
      const dest = ac.createMediaStreamDestination()
      // Loudness: normalize the voice toward social speech level (~-16 LUFS ≈
      // 0.12 RMS, clamped ×0.5–4) and run the mix through a compressor so the
      // boost can't clip. Music stays relative on its own slider.
      const comp = ac.createDynamicsCompressor()
      comp.threshold.value = -6; comp.knee.value = 10; comp.ratio.value = 6
      comp.attack.value = 0.003; comp.release.value = 0.25
      comp.connect(dest)
      const rmsGain = (b: AudioBuffer) => {
        const ch = b.getChannelData(0); let sum = 0, n = 0
        for (let i = 0; i < ch.length; i += 4) { sum += ch[i] * ch[i]; n++ }
        const rms = Math.sqrt(sum / Math.max(1, n))
        return rms && Number.isFinite(rms) ? Math.min(4, Math.max(0.5, 0.12 / rms)) : 1
      }
      let voSrc: AudioBufferSourceNode | null = null
      let muSrc: AudioBufferSourceNode | null = null
      if (voUrl) { const b = await decode(ac, voUrl); voSrc = ac.createBufferSource(); voSrc.buffer = b; const g = ac.createGain(); g.gain.value = rmsGain(b); voSrc.connect(g).connect(comp) }
      if (musicUrl) { const b = await decode(ac, musicUrl); muSrc = ac.createBufferSource(); muSrc.buffer = b; muSrc.loop = true; const g = ac.createGain(); g.gain.value = musicVol; muSrc.connect(g).connect(comp) }

      const combined = new MediaStream([...vstream.getVideoTracks(), ...dest.stream.getAudioTracks()])
      let mime = 'video/mp4'
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp9,opus'
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm'
      const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
      const chunks: BlobPart[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }

      const done = new Promise<Blob>(resolve => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })) })

      // start video scenes
      const vids = scenes.filter(s => s.kind === 'video').map(s => mediaCache.current.get(s.url)).filter((v): v is HTMLVideoElement => v instanceof HTMLVideoElement)
      vids.forEach(v => { v.currentTime = 0; v.play().catch(() => {}) })

      rec.start(200)
      const t0 = ac.currentTime + 0.08
      voSrc?.start(t0); muSrc?.start(t0)
      const start = performance.now()
      await new Promise<void>(resolve => {
        const loop = () => {
          const t = (performance.now() - start) / 1000
          setRenderPct(Math.min(99, Math.round((t / totalDur) * 100)))
          drawFrame(ctx, t)
          if (t >= totalDur) { resolve(); return }
          requestAnimationFrame(loop)
        }
        loop()
      })
      rec.stop(); voSrc?.stop(); muSrc?.stop(); vids.forEach(v => v.pause())
      const blob = await done
      ac.close()
      setOutMime(mime)
      setOutUrl(URL.createObjectURL(blob))
      setRenderPct(100)
      // best-effort upload to storage for sharing
      try {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm'
        const path = `renders/${Date.now()}-${uid()}.${ext}`
        await supabase.storage.from('studio-assets').upload(path, blob, { contentType: mime, upsert: false })
      } catch { /* local download still works */ }
    } catch (e) {
      setError('Randare eșuată: ' + (e as Error).message)
    } finally {
      setRendering(false)
    }
  }

  // ─── render (cloud · Creatomate-shaped, provider-agnostic) ───────────────
  function buildCloudSpec(): { source: Record<string, unknown> } {
    const elements: Record<string, unknown>[] = []
    let t = 0
    for (const sc of scenes) {
      const el: Record<string, unknown> = { type: sc.kind, source: sc.url, track: 1, time: t, duration: sc.duration, fit: 'cover' }
      if (sc.kind === 'video') el.volume = 0 // voiceover is the soundtrack
      elements.push(el)
      t += sc.duration
    }
    if (voUrl) elements.push({ type: 'audio', source: voUrl, track: 2, time: 0 })
    if (musicUrl) elements.push({ type: 'audio', source: musicUrl, track: 3, time: 0, loop: true, volume: Math.round(musicVol * 100) })
    if (subsOn) for (const c of cues) elements.push({
      type: 'text', track: 4, time: c.start, duration: Math.max(0.4, c.end - c.start),
      text: c.text, y: `${Math.round(SUB_POS[subPos] * 100)}%`, width: '86%',
      x_alignment: '50%', y_alignment: '50%',
      font_family: 'Inter', font_weight: '700', font_size: Math.round(H * 0.032 * subScale),
      fill_color: '#ffffff', background_color: 'rgba(21,11,6,0.72)',
    })
    return { source: { output_format: 'mp4', width: W, height: H, elements } }
  }

  async function renderCloud() {
    if (scenes.length === 0) { setError('Adaugă cel puțin o scenă.'); return }
    setError(''); setCloud({ status: 'creating', url: '', msg: '' })
    try {
      const created = await invokeRaw('render-video', { spec: buildCloudSpec() })
      if (created.configured === false) { setCloud({ status: 'unconfigured', url: '', msg: String(created.message || '') }); return }
      if (created.ok === false) { setCloud({ status: 'error', url: '', msg: 'Provider: ' + JSON.stringify(created.body).slice(0, 300) }); return }
      const bodyArr = created.body
      const first = Array.isArray(bodyArr) ? bodyArr[0] : bodyArr
      const id = (first as { id?: string })?.id
      if (!id) { setCloud({ status: 'error', url: '', msg: 'Fără id de la provider: ' + JSON.stringify(bodyArr).slice(0, 250) }); return }
      for (let i = 0; i < 120; i++) {
        await sleep(4000)
        const st = await invokeRaw('render-video', { poll_id: id })
        const sBody = st.body
        const s = (Array.isArray(sBody) ? sBody[0] : sBody) as { status?: string; url?: string; error_message?: string }
        setCloud({ status: s?.status || 'rendering', url: s?.url || '', msg: '' })
        if (s?.status === 'succeeded' && s?.url) { setCloud({ status: 'succeeded', url: s.url, msg: '' }); return }
        if (s?.status === 'failed') { setCloud({ status: 'failed', url: '', msg: s?.error_message || 'Randare eșuată la provider.' }); return }
      }
      setCloud({ status: 'timeout', url: '', msg: 'Durează neobișnuit de mult — verifică în contul Creatomate.' })
    } catch (e) {
      setCloud({ status: 'error', url: '', msg: (e as Error).message })
    }
  }

  // ─── UI ─────────────────────────────────────────────────────────────────
  const previewW = aspect === '16:9' ? 360 : aspect === '1:1' ? 300 : 236
  const cloudBusy = ['creating', 'planned', 'waiting', 'transcribing', 'rendering'].includes(cloud.status)
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-white flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-brand-red" /> Marketing Studio
        </h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          Compune un clip (până la 180s): imagini AI + fotografiile/clipurile tale · voce · subtitrări · muzică → MP4
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="font-sans text-[11px] uppercase tracking-widest text-white/40 mr-1">Format</span>
        {(Object.keys(ASPECTS) as Aspect[]).map(a => (
          <button key={a} onClick={() => setAspect(a)}
            className={'px-3 py-1.5 text-[12px] border ' + (aspect === a ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/60 border-white/[0.07]')}>{a}</button>
        ))}
        <span className="ml-auto font-sans text-[12px] text-white/50">Durată: <b className="text-white">{fmt(totalDur)}</b> / 3:00 · {scenes.length} scene</span>
      </div>

      {/* Project persistence */}
      <div className="flex flex-wrap items-center gap-2 mb-6 bg-[#1a1a1a] border border-white/[0.07] px-3 py-2.5">
        <FolderOpen className="w-4 h-4 text-white/40" />
        <input value={projName} onChange={e => setProjName(e.target.value)} placeholder="Numele proiectului…"
          className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-3 py-1.5 w-44" />
        <button onClick={saveProject} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-50">
          {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {projId ? 'Actualizează' : 'Salvează'}
        </button>
        <select value="" onChange={e => loadProject(e.target.value)} disabled={!!busy}
          className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 max-w-[220px]">
          <option value="">{projects.length ? 'Deschide un proiect…' : 'Niciun proiect salvat'}</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} · {new Date(p.updated_at).toLocaleDateString('ro-RO')}</option>)}
        </select>
        {projId && <button onClick={() => { setProjId(''); setProjName('') }} className="text-[11px] text-white/30 hover:text-white">proiect nou</button>}
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: controls */}
        <div className="lg:col-span-2 space-y-5">
          {/* Assets */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2"><ImagePlus className="w-3.5 h-3.5" /> Bibliotecă · scene</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {IMG_PRESETS.map(p => (
                <button key={p.label} onClick={() => { setImgPrompt(p.prompt); setImgAspect(p.aspect) }}
                  className="px-3 py-1.5 text-[11px] bg-[#111] border border-white/[0.07] text-white/70 hover:border-brand-red/60">{p.label}</button>
              ))}
            </div>
            <textarea value={imgPrompt} onChange={e => setImgPrompt(e.target.value)} rows={3} placeholder="Prompt imagine AI (engleză)…"
              className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[13px] p-3 resize-y focus:outline-none focus:border-brand-red/60" />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {['1:1', '4:5', '9:16', '16:9'].map(a => (
                <button key={a} onClick={() => setImgAspect(a)} className={'px-2.5 py-1.5 text-[11px] border ' + (imgAspect === a ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>{a}</button>
              ))}
              <button onClick={genImage} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-50">
                {busy === 'image' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generează imagine
              </button>
              <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-1.5 cursor-pointer hover:border-white/20">
                {busy === 'upimg' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Foto
                <input type="file" accept="image/*" hidden onChange={e => onUpload('image', e.target.files?.[0])} />
              </label>
              <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-1.5 cursor-pointer hover:border-white/20">
                {busy === 'upvid' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />} Clip
                <input type="file" accept="video/*" hidden onChange={e => onUpload('video', e.target.files?.[0])} />
              </label>
              <label className={'flex items-center gap-1.5 border text-[12px] font-bold px-3 py-1.5 cursor-pointer ' + (refImageUrl ? 'bg-brand-red/15 border-brand-red/60 text-white' : 'bg-[#111] border-white/[0.07] text-white/70 hover:border-white/20')}>
                {busy === 'refimg' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />} {refImageUrl ? 'Referință ✓' : 'Referință foto'}
                <input type="file" accept="image/*" hidden onChange={e => onRefImage(e.target.files?.[0])} />
              </label>
            </div>
            {refImageUrl && (
              <div className="flex items-center gap-2 mt-3">
                <img src={refImageUrl} alt="Referință" className="w-12 h-12 object-cover border border-brand-red/50" />
                <p className="text-[11px] text-white/50 leading-snug flex-1">
                  „Generează imagine” va <b>porni de la această poză</b> (image-to-image, identitatea păstrată). Scrie în prompt ce schimbi (fundal, ținută, încadrare).
                </p>
                <button onClick={() => setRefImageUrl('')} className="text-white/30 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3">Cronologie</p>
            {scenes.length === 0 && <p className="text-[13px] text-white/30 py-6 text-center">Nicio scenă încă. Generează sau încarcă mai sus.</p>}
            <div className="space-y-2">
              {scenes.map((sc, i) => (
                <div key={sc.id} className="flex items-center gap-3 bg-[#111] border border-white/[0.07] p-2">
                  <span className="font-sans text-[11px] text-white/30 w-5 text-center">{i + 1}</span>
                  {sc.kind === 'image'
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={sc.url} alt="" className="w-14 h-14 object-cover shrink-0" />
                    : <div className="w-14 h-14 bg-black flex items-center justify-center shrink-0"><Film className="w-5 h-5 text-white/40" /></div>}
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-white truncate">{sc.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {sc.kind === 'image' && <>
                        <input type="number" min={1} max={30} value={sc.duration} onChange={e => setDur(sc.id, Number(e.target.value))}
                          className="w-14 bg-black border border-white/10 text-white/80 text-[11px] px-1.5 py-1" /><span className="text-[10px] text-white/30">sec</span>
                        <select value={sc.kb} onChange={e => setKb(sc.id, e.target.value as KB)} className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                          <option value="none">static</option><option value="in">zoom in</option><option value="out">zoom out</option><option value="left">pan ←</option><option value="right">pan →</option>
                        </select>
                        <button onClick={() => animateScene(sc.id)} disabled={sc.motion === 'working'}
                          title="Transformă fotografia într-un clip cu mișcare reală (AI, fal.ai/Kling)"
                          className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 border border-amber-500/40 text-amber-300/90 hover:bg-amber-500/10 disabled:opacity-60">
                          {sc.motion === 'working' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          {sc.motion === 'working' ? 'Animez…' : 'Animează'}
                        </button>
                      </>}
                      {sc.kind === 'video' && <span className="text-[11px] text-white/40">clip · {sc.duration.toFixed(1)}s (fără sunet)</span>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => move(i, -1)} className="text-white/30 hover:text-white"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => move(i, 1)} className="text-white/30 hover:text-white"><ArrowDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <button onClick={() => del(sc.id)} className="text-white/30 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Voice + subtitles + music */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-1 flex items-center gap-2"><Mic className="w-3.5 h-3.5" /> Voce (voiceover)</p>
              <p className="text-[11px] mb-3" style={{ color: elConfigured ? '#7ec8a3' : '#8fb8d8' }}>
                {elConfigured
                  ? `Motoare voce: ${[providers.minimax ? 'fal/MiniMax (fără abonament)' : '', providers.elevenlabs ? 'ElevenLabs (premium)' : ''].filter(Boolean).join(' · ')} · voci naturale RO/EN + clonarea vocii tale`
                  : 'Motor: Gemini · voci naturale RO/EN · gratuit (cheia existentă). Clonarea vocii cere FAL_KEY (fără abonament) sau ELEVENLABS_API_KEY.'}
              </p>
              <textarea value={script} onChange={e => setScript(e.target.value)} rows={4} placeholder="Textul citit de voce (RO sau EN)…"
                className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[13px] p-3 resize-y focus:outline-none focus:border-brand-red/60" />
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {elConfigured ? (
                  <>
                    <select value={elVoiceId} onChange={e => setElVoiceId(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 max-w-[160px]">
                      {elVoices.map(v => <option key={v.provider + ':' + v.voice_id} value={v.voice_id}>{v.category === 'cloned' ? '👤 ' : ''}{v.name}{v.provider === 'minimax' ? ' · fal' : ''}</option>)}
                    </select>
                    <select value={tone} onChange={e => setTone(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                      {TONES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                    <select value={lang} onChange={e => setLang(e.target.value as 'ro' | 'en')} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                      <option value="ro">RO</option><option value="en">EN</option>
                    </select>
                  </>
                ) : (
                  <>
                    <select value={geminiVoice} onChange={e => setGeminiVoice(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 max-w-[180px]">
                      {GEMINI_VOICES.map(v => <option key={v.v} value={v.v}>{v.label}</option>)}
                    </select>
                    <select value={tone} onChange={e => setTone(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                      {TONES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                    <select value={lang} onChange={e => setLang(e.target.value as 'ro' | 'en')} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                      <option value="ro">RO</option><option value="en">EN</option>
                    </select>
                  </>
                )}
                <button onClick={genVoice} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-50">
                  {busy === 'voice' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează voce
                </button>
              </div>
              {voUrl && <audio src={voUrl} controls className="w-full mt-3 h-9" />}

              {/* Voice cloning lab — two engines, kept equal */}
              {(providers.minimax || providers.elevenlabs) && (
                <div className="mt-4 pt-4 border-t border-white/[0.07]">
                  <button onClick={() => setCloneOpen(o => !o)} className="flex items-center gap-1.5 text-[12px] font-bold text-white/70 hover:text-white">
                    <UserPlus className="w-3.5 h-3.5" /> Vocile mele · clonează vocea ta {cloneOpen ? '▴' : '▾'}
                  </button>
                  {cloneOpen && (
                    <div className="mt-3 space-y-2">
                      {providers.minimax && providers.elevenlabs && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-white/40">Motor:</span>
                          <button onClick={() => setCloneEngine('minimax')} className={'px-2.5 py-1 text-[11px] border ' + (cloneEngine === 'minimax' ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>fal · fără abonament</button>
                          <button onClick={() => setCloneEngine('elevenlabs')} className={'px-2.5 py-1 text-[11px] border ' + (cloneEngine === 'elevenlabs' ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>ElevenLabs · premium</button>
                        </div>
                      )}
                      <input value={cloneName} onChange={e => setCloneName(e.target.value)} placeholder="Numele vocii (ex. Daniel TT)"
                        className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-3 py-2" />
                      <input value={clonePerson} onChange={e => setClonePerson(e.target.value)} placeholder="A cui este vocea? (persoana reală)"
                        className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-3 py-2" />
                      <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-2 cursor-pointer hover:border-white/20 w-fit">
                        {busy === 'clonesample' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Mostre audio ({cloneSamples.length}/3)
                        <input type="file" accept="audio/*" hidden onChange={e => onCloneSample(e.target.files?.[0])} />
                      </label>
                      <label className="flex items-start gap-2 text-[11.5px] text-white/60 cursor-pointer leading-snug">
                        <input type="checkbox" checked={cloneConsent} onChange={e => setCloneConsent(e.target.checked)} className="mt-0.5" />
                        <span><ShieldCheck className="w-3 h-3 inline mr-1" />Confirm că persoana numită mai sus și-a dat <b>acordul explicit</b> pentru clonarea vocii sale. Fără acest acord, clonarea este refuzată.</span>
                      </label>
                      <button onClick={doClone} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
                        {busy === 'clone' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Clonează vocea{cloneEngine === 'minimax' ? ' (fal)' : ' (ElevenLabs)'}
                      </button>
                      <p className="text-[10.5px] text-white/30">
                        {cloneEngine === 'minimax'
                          ? 'O mostră curată de min. 10 secunde (fără muzică de fundal). Fără abonament — se plătește per folosire din creditele fal. Vocea se salvează în contul tău și apare în listă cu 👤 · fal.'
                          : '1–3 mostre curate, fără muzică de fundal, total 1–3 minute. Necesită plan ElevenLabs. Vocea apare în listă cu 👤.'}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2"><Captions className="w-3.5 h-3.5" /> Subtitrări</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={genSubs} disabled={!!busy || !voUrl} className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/80 text-[12px] font-bold px-3 py-1.5 hover:border-brand-red/60 disabled:opacity-40">
                  {busy === 'subs' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Captions className="w-3.5 h-3.5" />} Auto din voce
                </button>
                <label className="flex items-center gap-1.5 text-[12px] text-white/60 cursor-pointer">
                  <input type="checkbox" checked={subsOn} onChange={e => setSubsOn(e.target.checked)} /> arată în clip
                </label>
              </div>
              <p className="text-[11px] text-white/30 mt-2">{cues.length ? `${cues.length} replici sincronizate` : 'Generează vocea, apoi „Auto din voce”.'}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <span className="text-[11px] text-white/40">Poziție</span>
                {(['jos', 'treime', 'sus'] as SubPos[]).map(p => (
                  <button key={p} onClick={() => setSubPos(p)}
                    className={'px-2.5 py-1 text-[11px] border ' + (subPos === p ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>
                    {p === 'jos' ? 'Jos' : p === 'treime' ? 'Treime inf.' : 'Sus'}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-white/40">Mărime</span>
                <input type="range" min={0.7} max={1.5} step={0.05} value={subScale} onChange={e => setSubScale(Number(e.target.value))} className="flex-1" />
                <span className="text-[11px] text-white/50 w-8">{Math.round(subScale * 100)}%</span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-white/40">Stil</span>
                <select value={capMode} onChange={e => setCapMode(e.target.value as 'clasic' | 'karaoke')}
                  className="bg-[#111] border border-white/[0.07] text-white/70 text-[11px] px-2 py-1">
                  <option value="clasic">clasic · pe replici</option>
                  <option value="karaoke">karaoke · cuvânt cu cuvânt</option>
                </select>
                {capMode === 'karaoke' && !words.length && <span className="text-[10px] text-amber-300/70">rulează „Auto din voce” pentru timpi pe cuvânt</span>}
              </div>

              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mt-5 mb-2 flex items-center gap-2"><Music className="w-3.5 h-3.5" /> Muzică</p>
              <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-1.5 cursor-pointer hover:border-white/20 w-fit">
                {busy === 'music' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Încarcă track
                <input type="file" accept="audio/*" hidden onChange={e => onMusic(e.target.files?.[0])} />
              </label>
              {musicUrl && <div className="flex items-center gap-2 mt-2"><span className="text-[11px] text-white/40">volum</span>
                <input type="range" min={0} max={0.6} step={0.02} value={musicVol} onChange={e => setMusicVol(Number(e.target.value))} className="flex-1" /></div>}
            </div>
          </div>
        </div>

        {/* RIGHT: preview + render */}
        <div className="space-y-5">
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5 sticky top-4">
            <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3">Previzualizare</p>
            <div className="flex justify-center bg-black p-2">
              <canvas ref={canvasRef} width={W} height={H} style={{ width: previewW, height: previewW * H / W, maxWidth: '100%' }} className="bg-black" />
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={preview} disabled={rendering || busy === 'prep'} className="flex-1 flex items-center justify-center gap-1.5 bg-[#111] border border-white/[0.07] text-white text-[12px] font-bold py-2 hover:border-white/20 disabled:opacity-50">
                {busy === 'preview' ? <><Square className="w-3.5 h-3.5" /> Stop</> : busy === 'prep' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Play className="w-3.5 h-3.5" /> Preview</>}
              </button>
            </div>
            <button onClick={render} disabled={rendering || scenes.length === 0} className="w-full flex items-center justify-center gap-2 bg-brand-red text-white text-sm font-bold py-2.5 mt-2 hover:bg-red-700 disabled:opacity-50">
              {rendering ? <><Loader2 className="w-4 h-4 animate-spin" /> Randez… {renderPct}%</> : <><Film className="w-4 h-4" /> Randează clipul</>}
            </button>
            {rendering && <p className="text-[11px] text-white/40 mt-2 text-center">Randarea rulează în timp real (~{fmt(totalDur)}). Ține fila deschisă.</p>}
            {outUrl && (
              <div className="mt-4 border border-white/[0.07]">
                <video src={outUrl} controls className="w-full" />
                <a href={outUrl} download={`tt-clip.${outMime.includes('mp4') ? 'mp4' : 'webm'}`}
                  className="flex items-center justify-center gap-1.5 bg-[#111] text-white text-[12px] font-bold py-2.5 hover:bg-black">
                  <Download className="w-3.5 h-3.5" /> Descarcă {outMime.includes('mp4') ? 'MP4' : 'WebM'}
                </a>
              </div>
            )}
            {/* Cloud render (Creatomate) */}
            <div className="mt-4 pt-4 border-t border-white/[0.07]">
              <button onClick={renderCloud} disabled={cloudBusy || scenes.length === 0}
                className="w-full flex items-center justify-center gap-2 bg-[#111] border border-white/[0.07] text-white text-[12px] font-bold py-2.5 hover:border-brand-red/60 disabled:opacity-50">
                {cloudBusy ? <><Loader2 className="w-4 h-4 animate-spin" /> Cloud: {cloud.status}…</> : <><Film className="w-4 h-4" /> Randează în cloud (MP4 garantat)</>}
              </button>
              {cloud.status === 'unconfigured' && (
                <p className="text-[11px] text-amber-300/80 mt-2 leading-relaxed">{cloud.msg}</p>
              )}
              {(cloud.status === 'error' || cloud.status === 'failed' || cloud.status === 'timeout') && cloud.msg && (
                <p className="text-[11px] text-red-400 mt-2 leading-relaxed break-words">{cloud.msg}</p>
              )}
              {cloud.status === 'succeeded' && cloud.url && (
                <div className="mt-3 border border-white/[0.07]">
                  <video src={cloud.url} controls className="w-full" />
                  <a href={cloud.url} target="_blank" rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 bg-[#111] text-white text-[12px] font-bold py-2.5 hover:bg-black">
                    <Download className="w-3.5 h-3.5" /> Deschide / Descarcă MP4
                  </a>
                </div>
              )}
            </div>

            <p className="text-[11px] text-white/30 mt-3 leading-relaxed">
              Randare gratuită în browser (MP4 unde e suportat, altfel WebM). Cloud = MP4 garantat prin Creatomate (necesită cheie — vezi README).
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
