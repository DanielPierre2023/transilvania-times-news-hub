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

import { useCallback, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  Clapperboard, ImagePlus, Upload, Mic, Captions, Music, Film,
  Sparkles, Loader2, Play, Square, Trash2, ArrowUp, ArrowDown, Download, AlertCircle, Wand2,
} from 'lucide-react'

type Aspect = '9:16' | '1:1' | '4:5' | '16:9'
type KB = 'none' | 'in' | 'out' | 'left' | 'right'
interface Scene { id: string; kind: 'image' | 'video'; url: string; name: string; duration: number; kb: KB }
interface Cue { start: number; end: number; text: string }

const ASPECTS: Record<Aspect, [number, number]> = {
  '9:16': [720, 1280], '1:1': [1000, 1000], '4:5': [864, 1080], '16:9': [1280, 720],
}
const VOICES = ['onyx', 'nova', 'shimmer', 'alloy', 'echo', 'fable', 'ash', 'ballad', 'coral', 'sage']
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

  const [script, setScript] = useState('')
  const [voice, setVoice] = useState('onyx')
  const [voUrl, setVoUrl] = useState('')
  const [voDur, setVoDur] = useState(0)

  const [cues, setCues] = useState<Cue[]>([])
  const [subsOn, setSubsOn] = useState(true)

  const [musicUrl, setMusicUrl] = useState('')
  const [musicVol, setMusicVol] = useState(0.18)

  const [busy, setBusy] = useState<string>('')       // label of in-flight op
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(false)
  const [renderPct, setRenderPct] = useState(0)
  const [outUrl, setOutUrl] = useState('')
  const [outMime, setOutMime] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<{ raf: number; stop: () => void } | null>(null)
  const mediaCache = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map())

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
      const r = await invoke<{ publicUrl: string }>('generate-cover-image', { raw_prompt: imgPrompt.trim(), aspect: imgAspect })
      setScenes(s => [...s, { id: uid(), kind: 'image', url: r.publicUrl, name: 'AI · ' + imgAspect, duration: 4, kb: 'in' }])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }, [imgPrompt, imgAspect]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const r = await invoke<{ publicUrl: string }>('generate-voiceover', { text: script.trim(), voice })
      const d = await audioDuration(r.publicUrl)
      setVoUrl(r.publicUrl); setVoDur(d || Math.ceil(script.length / 14))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  async function genSubs() {
    if (!voUrl) { setError('Generează întâi vocea.'); return }
    setError(''); setBusy('subs')
    try {
      const r = await invoke<{ segments: Cue[] }>('align-subtitles', { audio_url: voUrl, language: 'ro' })
      setCues(r.segments || [])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
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
    // subtitles
    if (subsOn) {
      const cue = cues.find(c => t >= c.start && t <= c.end)
      if (cue) {
        ctx.font = `700 ${Math.round(H * 0.036)}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const lines = wrap(ctx, cue.text.toUpperCase(), W * 0.84)
        const lh = H * 0.052
        let y = H * 0.80 - (lines.length - 1) * lh
        for (const ln of lines) {
          const tw = ctx.measureText(ln).width
          ctx.fillStyle = 'rgba(21,11,6,0.72)'
          roundRect(ctx, W / 2 - tw / 2 - 16, y - lh / 2, tw + 32, lh * 0.92, 6); ctx.fill()
          ctx.fillStyle = '#fff'; ctx.fillText(ln, W / 2, y)
          y += lh
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
      let voSrc: AudioBufferSourceNode | null = null
      let muSrc: AudioBufferSourceNode | null = null
      if (voUrl) { const b = await decode(ac, voUrl); voSrc = ac.createBufferSource(); voSrc.buffer = b; const g = ac.createGain(); g.gain.value = 1; voSrc.connect(g).connect(dest) }
      if (musicUrl) { const b = await decode(ac, musicUrl); muSrc = ac.createBufferSource(); muSrc.buffer = b; muSrc.loop = true; const g = ac.createGain(); g.gain.value = musicVol; muSrc.connect(g).connect(dest) }

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

  // ─── UI ─────────────────────────────────────────────────────────────────
  const previewW = aspect === '16:9' ? 360 : aspect === '1:1' ? 300 : 236
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
            </div>
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
              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 mb-3 flex items-center gap-2"><Mic className="w-3.5 h-3.5" /> Voce (voiceover)</p>
              <textarea value={script} onChange={e => setScript(e.target.value)} rows={4} placeholder="Textul citit de voce (RO sau EN)…"
                className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[13px] p-3 resize-y focus:outline-none focus:border-brand-red/60" />
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <select value={voice} onChange={e => setVoice(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                  {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
                <button onClick={genVoice} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-50">
                  {busy === 'voice' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează voce
                </button>
              </div>
              {voUrl && <audio src={voUrl} controls className="w-full mt-3 h-9" />}
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
            <p className="text-[11px] text-white/30 mt-3 leading-relaxed">
              Randare gratuită în browser (MP4 unde e suportat, altfel WebM). Pentru MP4 garantat prin cloud, configurează RENDER_API_URL/KEY.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
