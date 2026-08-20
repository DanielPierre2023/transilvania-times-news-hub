'use client'

// app/admin/newsroom/page.tsx
//
// NEWSROOM — daily AI anchor bulletin.
// Flow: pick today's stories → AI writes the anchor script (editable) →
// natural voice (ElevenLabs, incl. cloned voices) → presenter (HeyGen stock
// avatar or your photo, with mandatory consent) → lip-synced MP4.
//
// Uses: newsroom-anchor (script/avatars/upload_photo/generate/status),
//       voice-lab (voice list), generate-voiceover (TTS).

import { useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Tv, Newspaper, FileText, Mic, User, Film, Loader2, Wand2, Upload,
  ShieldCheck, Download, AlertCircle, CheckCircle2, RefreshCw,
  Clapperboard, Share2, Copy, Image as ImageIcon, Archive,
} from 'lucide-react'

interface Post { id: string; title_ro: string | null; title_en: string | null; summary_ro: string | null; summary_en: string | null; published_at: string | null; category: string | null }
interface ElVoice { voice_id: string; name: string; category: string }
interface LibAsset { id: string; kind: 'presenter' | 'studio'; name: string; url: string; is_real_person?: boolean; person_name?: string | null }
interface Avatar { avatar_id: string; avatar_name: string; preview_image_url: string }
interface Story { lower_third: string; text: string }
interface Sections { greeting: string; stories: Story[]; signoff: string }
interface Cue { start: number; end: number; text: string }
interface Word { word: string; start: number; end: number }
interface CaptionPack { facebook?: string; instagram?: string; tiktok?: string; youtube_title?: string; youtube_description?: string; hashtags?: string[] }
interface PastBulletin { id: string; created_at: string; story_titles: string[] | null; bulletin_video_url: string | null; anchor_video_url: string | null }

// Strip diacritics/punctuation for fuzzy cue↔story matching.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

const TONES = [
  { v: 'stiri', label: 'Știri · autoritar' },
  { v: 'calm', label: 'Calm · documentar' },
  { v: 'energic', label: 'Energic' },
]

export default function NewsroomPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  // Untyped handle for tables newer than the generated Database types (newsroom_bulletins).
  const db = useMemo(() => supabase as unknown as SupabaseClient, [supabase])

  const [posts, setPosts] = useState<Post[]>([])
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [lang, setLang] = useState<'ro' | 'en'>('ro')
  const [target, setTarget] = useState(75)

  const [script, setScript] = useState('')
  const [scriptModel, setScriptModel] = useState('')

  const [elVoices, setElVoices] = useState<ElVoice[]>([])
  const [elConfigured, setElConfigured] = useState(false)
  const [voiceId, setVoiceId] = useState('')
  const [geminiVoice, setGeminiVoice] = useState('Charon')
  const [tone, setTone] = useState('stiri')
  const [voUrl, setVoUrl] = useState('')

  const [falConfigured, setFalConfigured] = useState(false)
  const [anchorImg, setAnchorImg] = useState('')
  const [anchorIsReal, setAnchorIsReal] = useState(false)

  const [hgConfigured, setHgConfigured] = useState<boolean | null>(null)
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [mode, setMode] = useState<'avatar' | 'photo'>('avatar')
  const [avatarId, setAvatarId] = useState('')
  const [photoId, setPhotoId] = useState('')
  const [photoConsent, setPhotoConsent] = useState(false)
  const [photoPerson, setPhotoPerson] = useState('')

  const [orient, setOrient] = useState<'16:9' | '9:16'>('16:9')
  const [videoStatus, setVideoStatus] = useState('')
  const [videoUrl, setVideoUrl] = useState('')

  // Newsroom media library — reusable presenters + studio backdrops.
  const [libPresenters, setLibPresenters] = useState<LibAsset[]>([])
  const [libStudios, setLibStudios] = useState<LibAsset[]>([])
  const [studioBg, setStudioBg] = useState('')        // chosen studio backdrop url ('' = none)
  const [greenscreen, setGreenscreen] = useState(false) // key the anchor over the studio
  const [libPresName, setLibPresName] = useState('')
  const [libPresReal, setLibPresReal] = useState(false)
  const [libPresPerson, setLibPresPerson] = useState('')
  const [libStudioName, setLibStudioName] = useState('')
  const [studioPrompt, setStudioPrompt] = useState('')
  const [presenterPrompt, setPresenterPrompt] = useState('')
  const [presenterGender, setPresenterGender] = useState<'f' | 'm'>('f')

  // Broadcast compositor + publishing pack + archive.
  const [sections, setSections] = useState<Sections | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [words, setWords] = useState<Word[]>([])
  const [capMode, setCapMode] = useState<'clasic' | 'karaoke'>('karaoke')
  const [subsOn, setSubsOn] = useState(true)
  const [tickerOn, setTickerOn] = useState(true)
  const [bulletinPublicUrl, setBulletinPublicUrl] = useState('')
  const [pub, setPub] = useState<{ facebook: boolean; instagram: boolean; youtube: boolean }>({ facebook: false, instagram: false, youtube: false })
  const [pubBusy, setPubBusy] = useState('')
  const [pubMsg, setPubMsg] = useState<Record<string, string>>({})
  const [compositing, setCompositing] = useState(false)
  const [compPct, setCompPct] = useState(0)
  const [bulletinUrl, setBulletinUrl] = useState('')      // local object URL (download/preview)
  const [bulletinMime, setBulletinMime] = useState('')
  const [savedId, setSavedId] = useState('')
  const [pack, setPack] = useState<CaptionPack | null>(null)
  const [packLinks, setPackLinks] = useState<Record<string, string>>({})
  const [past, setPast] = useState<PastBulletin[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function invokeRaw(fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error: e } = await supabase.functions.invoke(fn, { body })
    if (e) {
      // supabase-js sets a generic "non-2xx status code" message and hides the
      // function's real JSON body ({error:"..."}) inside error.context (the raw
      // Response). Dig it out so failures name the actual step + cause.
      let detail = ''
      const ctx = (e as { context?: unknown }).context
      if (ctx && typeof (ctx as Response).json === 'function') {
        try {
          const b = await (ctx as Response).clone().json() as Record<string, unknown>
          if (b && typeof b.error === 'string') detail = b.error
        } catch { /* not JSON — try text below */ }
        if (!detail) { try { const t = await (ctx as Response).text(); if (t) detail = t.slice(0, 300) } catch { /* ignore */ } }
      }
      throw new Error(`${fn}: ${detail || e.message}`)
    }
    return (data || {}) as Record<string, unknown>
  }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // Load today's stories + voices + avatars.
  useEffect(() => {
    ;(async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const { data } = await supabase
        .from('blog_posts')
        .select('id, title_ro, title_en, summary_ro, summary_en, published_at, category')
        .eq('status', 'published')
        .gte('published_at', since)
        .order('published_at', { ascending: false })
        .limit(20)
      setPosts((data ?? []) as Post[])
      setSel(new Set(((data ?? []) as Post[]).slice(0, 5).map(p => p.id)))
      try {
        const v = await invokeRaw('voice-lab', { action: 'list' })
        if (v.configured === true && Array.isArray(v.voices)) {
          setElConfigured(true); setElVoices(v.voices as ElVoice[])
          if ((v.voices as ElVoice[]).length) setVoiceId((v.voices as ElVoice[])[0].voice_id)
        }
      } catch { /* fallback voice note shown in UI */ }
      try {
        const eng = await invokeRaw('newsroom-anchor', { action: 'engines' })
        setFalConfigured(eng.fal === true)
        if (eng.heygen === true) {
          const a = await invokeRaw('newsroom-anchor', { action: 'avatars' })
          if (Array.isArray(a.avatars)) {
            setHgConfigured(true); setAvatars((a.avatars as Avatar[]).filter(x => x.preview_image_url).slice(0, 24))
            if ((a.avatars as Avatar[]).length) setAvatarId((a.avatars as Avatar[])[0].avatar_id)
          } else setHgConfigured(true)
        } else {
          setHgConfigured(false)
          if (eng.fal === true) setMode('photo')
        }
      } catch { setHgConfigured(false) }
      try {
        const st = await invokeRaw('publish-social', { action: 'status' })
        setPub({ facebook: st.facebook === true, instagram: st.instagram === true, youtube: st.youtube === true })
      } catch { /* publish function not deployed yet */ }
      try {
        const { data: pb } = await db
          .from('newsroom_bulletins')
          .select('id, created_at, story_titles, bulletin_video_url, anchor_video_url')
          .order('created_at', { ascending: false })
          .limit(7)
        if (pb) setPast(pb as PastBulletin[])
      } catch { /* table not created yet — archive stays hidden */ }
      try { await refreshLibrary() } catch { /* library table not created yet */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  // ── Newsroom media library ───────────────────────────────────────────────
  async function refreshLibrary() {
    const { data } = await db.from('newsroom_assets').select('id, kind, name, url, is_real_person, person_name').order('created_at', { ascending: false })
    const rows = (data || []) as LibAsset[]
    setLibPresenters(rows.filter(r => r.kind === 'presenter'))
    setLibStudios(rows.filter(r => r.kind === 'studio'))
  }
  async function uploadLibraryAsset(file: File | undefined, kind: 'presenter' | 'studio', name: string, isReal = false, personName = '') {
    if (!file) return
    if (!name.trim()) { setError('Dă un nume asset-ului din bibliotecă.'); return }
    if (kind === 'presenter' && isReal && !personName.trim()) { setError('Pentru o persoană reală, completează numele și bifează consimțământul.'); return }
    setError(''); setBusy('lib')
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `library/${kind}s/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw new Error(upErr.message)
      const url = supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
      const { error: insErr } = await db.from('newsroom_assets').insert({ kind, name: name.trim(), url, is_real_person: isReal, person_name: isReal ? personName.trim() : null })
      if (insErr) throw new Error(insErr.message)
      if (kind === 'presenter') { setLibPresName(''); setLibPresReal(false); setLibPresPerson('') } else setLibStudioName('')
      await refreshLibrary()
    } catch (e) { setError('Bibliotecă: ' + (e as Error).message) } finally { setBusy('') }
  }
  async function deleteLibraryAsset(id: string) {
    try { await db.from('newsroom_assets').delete().eq('id', id); await refreshLibrary() } catch { /* ignore */ }
  }
  function pickPresenter(a: LibAsset) { setAnchorImg(a.url); setAnchorIsReal(!!a.is_real_person) }

  // Save a generated image URL into the library (best-effort DB insert).
  async function saveGeneratedToLibrary(url: string, kind: 'presenter' | 'studio', name: string) {
    try { await db.from('newsroom_assets').insert({ kind, name, url, is_real_person: false, person_name: null }); await refreshLibrary() } catch { /* table missing — still usable this session */ }
  }
  // Prompt-based STUDIO backdrop (16:9) via the existing image generator.
  async function genStudioFromPrompt() {
    const p = studioPrompt.trim()
    if (!p) { setError('Scrie un prompt pentru platou (ex: „știri de seară, oraș noaptea, ecrane albastre”).'); return }
    setError(''); setBusy('genstudio')
    try {
      const prompt = `Professional television news studio set: ${p}. Wide establishing shot, empty anchor desk in the centre foreground, large broadcast video walls, modern studio lighting, cinematic depth of field, ultra photorealistic, 16:9. No people, no text, no logos, no watermark.`
      const r = await invokeRaw('generate-cover-image', { raw_prompt: prompt, aspect: '16:9' })
      if (r.error) throw new Error(String(r.error))
      const url = String(r.publicUrl || ''); if (!url) throw new Error('Generarea platoului a eșuat.')
      await saveGeneratedToLibrary(url, 'studio', p.slice(0, 40))
      setStudioBg(url); setStudioPrompt('')
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  // Prompt-based PRESENTER portrait (4:5) — fictional AI anchor, no consent needed.
  async function genPresenterFromPrompt() {
    const p = presenterPrompt.trim()
    const who = presenterGender === 'f' ? 'a professional female news anchor' : 'a professional male news anchor'
    setError(''); setBusy('genpres')
    try {
      const prompt = `Studio portrait photograph of ${who}${p ? ', ' + p : ' in their 30s'}, fictional person, facing the camera directly, head and shoulders, neutral warm studio background, soft professional lighting, smart attire with a subtle crimson accent, natural friendly expression, mouth closed, photorealistic, sharp focus. No text, no logo, no watermark.`
      const r = await invokeRaw('generate-cover-image', { raw_prompt: prompt, aspect: '4:5' })
      if (r.error) throw new Error(String(r.error))
      const url = String(r.publicUrl || ''); if (!url) throw new Error('Generarea prezentatorului a eșuat.')
      await saveGeneratedToLibrary(url, 'presenter', (p || (presenterGender === 'f' ? 'Prezentatoare' : 'Prezentator')).slice(0, 40))
      setAnchorImg(url); setAnchorIsReal(false); setPresenterPrompt('')
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }
  // Download any library image to disk (CORS-safe fetch → blob).
  async function downloadAsset(url: string, name: string) {
    try {
      const res = await fetch(url); const blob = await res.blob()
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `${name.replace(/[^\w-]+/g, '_') || 'asset'}.${ext}`
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    } catch { window.open(url, '_blank') }
  }

  async function genScript() {
    const chosen = posts.filter(p => sel.has(p.id))
    if (chosen.length === 0) { setError('Selectează cel puțin o știre.'); return }
    setError(''); setBusy('script')
    try {
      const articles = chosen.map(p => ({
        title: (lang === 'ro' ? p.title_ro : p.title_en) || p.title_ro || p.title_en || '',
        summary: (lang === 'ro' ? p.summary_ro : p.summary_en) || '',
      }))
      const r = await invokeRaw('newsroom-anchor', { action: 'script', language: lang, target_seconds: target, articles })
      if (r.error) throw new Error(String(r.error))
      setScript(String(r.script || '')); setScriptModel(String(r.model || ''))
      setSections((r.sections as Sections | null) || null)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  async function genVoice() {
    if (!script.trim()) { setError('Generează sau scrie scriptul mai întâi.'); return }
    setError(''); setBusy('voice')
    try {
      const body: Record<string, unknown> = elConfigured
        ? { text: script.trim(), voice_id: voiceId, tone, language: lang }
        : { text: script.trim(), provider: 'gemini', gemini_voice: geminiVoice, tone, language: lang }
      const r = await invokeRaw('generate-voiceover', body)
      if (r.error) throw new Error(String(r.error))
      setVoUrl(String(r.publicUrl || ''))
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  async function uploadPhoto(file?: File) {
    if (!file) return
    // Real-person faces always need the consent confirmation.
    if ((hgConfigured || anchorIsReal) && (!photoConsent || !photoPerson.trim())) {
      setError('Completează persoana și bifează consimțământul înainte de a încărca fotografia unei persoane reale.'); return
    }
    setError(''); setBusy('photo')
    try {
      const path = `anchor-photos/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw new Error(upErr.message)
      const url = supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
      if (hgConfigured) {
        const r = await invokeRaw('newsroom-anchor', { action: 'upload_photo', image_url: url, consent: { granted: true, person_name: photoPerson.trim() } })
        if (r.error) throw new Error(String(r.error))
        setPhotoId(String(r.talking_photo_id || ''))
      }
      setAnchorImg(url)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // Free-stack: generate a fictional AI anchor portrait (no consent needed —
  // it's not a real person) via the existing image generator.
  async function genAnchorPortrait(gender: 'f' | 'm') {
    setError(''); setBusy('portrait')
    try {
      const who = gender === 'f' ? 'a professional female news anchor in her 30s' : 'a professional male news anchor in his 40s'
      const r = await invokeRaw('generate-cover-image', {
        raw_prompt: `Studio portrait photograph of ${who}, fictional person, facing the camera directly, head and shoulders, neutral warm studio background in cream tones, soft professional lighting, wearing smart attire with a subtle crimson accent, natural friendly expression, mouth closed, photorealistic, sharp focus. No text, no logo.`,
        aspect: '1:1',
      })
      if (r.error) throw new Error(String(r.error))
      const url = String(r.publicUrl || '')
      if (!url) throw new Error('Generarea portretului a eșuat.')
      setAnchorIsReal(false); setAnchorImg(url)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  async function genVideo() {
    if (!voUrl) { setError('Generează vocea mai întâi (pasul 3).'); return }

    // ── Free-stack engine (fal / SadTalker) when HeyGen is absent ─────────
    if (!hgConfigured) {
      if (!falConfigured) { setError('Configurează FAL_KEY (credite preplătite, fără abonament) sau HEYGEN_API_KEY.'); return }
      if (!anchorImg) { setError('Alege sau generează portretul prezentatorului (pasul 4).'); return }
      setError(''); setVideoUrl(''); setVideoStatus('se trimite')
      try {
        const r = await invokeRaw('newsroom-anchor', { action: 'generate_fal', image_url: anchorImg, audio_url: voUrl })
        if (r.error) throw new Error(String(r.error))
        const statusUrl = String(r.status_url || ''), responseUrl = String(r.response_url || '')
        for (let i = 0; i < 150; i++) {
          await sleep(5000)
          const st = await invokeRaw('newsroom-anchor', { action: 'poll_fal', status_url: statusUrl, response_url: responseUrl })
          if (st.error) throw new Error(String(st.error))
          const s = String(st.status || '')
          setVideoStatus(s === 'IN_QUEUE' ? 'în coadă' : s === 'IN_PROGRESS' ? 'processing' : s)
          if (s === 'completed' && st.publicUrl) { setVideoUrl(String(st.publicUrl)); return }
        }
        throw new Error('Durează neobișnuit de mult — reîncearcă.')
      } catch (e) { setError((e as Error).message); setVideoStatus('') }
      return
    }

    // ── HeyGen engine (premium) ───────────────────────────────────────────
    const character = mode === 'avatar'
      ? { type: 'avatar', avatar_id: avatarId }
      : { type: 'talking_photo', talking_photo_id: photoId }
    if (mode === 'avatar' && !avatarId) { setError('Alege un prezentator.'); return }
    if (mode === 'photo' && !photoId) { setError('Încarcă fotografia prezentatorului.'); return }
    const [width, height] = orient === '16:9' ? [1280, 720] : [720, 1280]
    setError(''); setVideoUrl(''); setVideoStatus('se trimite')
    try {
      const r = await invokeRaw('newsroom-anchor', { action: 'generate', character, audio_url: voUrl, width, height })
      if (r.error) throw new Error(String(r.error))
      const videoId = String(r.video_id || '')
      for (let i = 0; i < 150; i++) {
        await sleep(5000)
        const st = await invokeRaw('newsroom-anchor', { action: 'status', video_id: videoId })
        if (st.error) throw new Error(String(st.error))
        const s = String(st.status || '')
        setVideoStatus(s)
        if (s === 'completed' && st.publicUrl) { setVideoUrl(String(st.publicUrl)); return }
        if (s === 'failed') throw new Error('HeyGen a eșuat: ' + String(st.error_detail || 'necunoscut'))
      }
      throw new Error('Durează neobișnuit de mult — verifică în contul HeyGen.')
    } catch (e) { setError((e as Error).message); setVideoStatus('') }
  }

  // ════════════════════════════════════════════════════════════════════════
  // BROADCAST COMPOSITOR — wraps the raw lipsync clip in the TT news frame:
  // branded intro → anchor window + lower-thirds + burned captions + ticker →
  // CTA endcard. Free, in-browser (canvas + MediaRecorder).
  // ════════════════════════════════════════════════════════════════════════
  const INTRO = 4.2, OUTRO = 3.2
  const C = { parchment: '#FBF4E4', ink: '#2B1710', sepia: '#512A1A', crimson: '#CA2222', gold: '#C9A45E', paper: '#F6ECD6' }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const words = text.split(' '); const lines: string[] = []; let line = ''
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w } else line = t }
    if (line) lines.push(line); return lines
  }
  function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }
  function drawCoverInto(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, x: number, y: number, w: number, h: number) {
    const vw = v.videoWidth || 1, vh = v.videoHeight || 1
    const vr = vw / vh, cr = w / h
    let dw: number, dh: number
    if (vr > cr) { dh = h; dw = h * vr } else { dw = w; dh = w / vr }
    ctx.save(); rr(ctx, x, y, w, h, 14); ctx.clip()
    ctx.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    ctx.restore()
  }

  // ── cinematic-intro helpers (shared look with the standalone intro clip) ──
  const clampN = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const segN = (t: number, a: number, b: number) => clampN((t - a) / (b - a), 0, 1)
  const easeOutN = (x: number) => 1 - Math.pow(1 - x, 3)
  const TILT_G = -0.42
  function projGlobe(lat: number, lon: number, rot: number) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180 + rot
    const x = Math.cos(la) * Math.sin(lo)
    const y0 = Math.sin(la), z0 = Math.cos(la) * Math.cos(lo)
    const y = y0 * Math.cos(TILT_G) - z0 * Math.sin(TILT_G)
    const z = y0 * Math.sin(TILT_G) + z0 * Math.cos(TILT_G)
    return { x, y, z }
  }
  type IntroParticle = { x: number; y: number; r: number; sp: number; a: number; tw: number }
  function seedIntroParticles(w: number, h: number): IntroParticle[] {
    const arr: IntroParticle[] = []
    const n = Math.round((w * h) / 16000)
    for (let i = 0; i < n; i++) arr.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.3, sp: Math.random() * 0.02 + 0.004, a: Math.random() * 0.5 + 0.15, tw: Math.random() * Math.PI * 2 })
    return arr
  }
  function letterSpacedC(ctx: CanvasRenderingContext2D, str: string, sp: number, x: number, y: number) {
    const chars = [...str]
    let total = 0; for (const c of chars) total += ctx.measureText(c).width + sp; total -= sp
    let cxp = x - total / 2
    const prev = ctx.textAlign; ctx.textAlign = 'left'
    for (const c of chars) { const w = ctx.measureText(c).width; ctx.fillText(c, cxp, y); cxp += w + sp }
    ctx.textAlign = prev
  }
  function measureSpacedC(ctx: CanvasRenderingContext2D, str: string, sp: number) {
    const chars = [...str]; let t = 0; for (const c of chars) t += ctx.measureText(c).width + sp; return t - sp
  }

  // Lower-third timing: proportional by word count, refined by Whisper cues.
  function storyTimes(dur: number, cueList: Cue[]): { start: number; title: string; category?: string | null }[] {
    const selectedPosts = posts.filter(p => sel.has(p.id))
    if (!sections || !sections.stories.length) {
      return selectedPosts.map((p, i) => ({
        start: (dur / Math.max(1, selectedPosts.length)) * i,
        title: ((lang === 'ro' ? p.title_ro : p.title_en) || '').slice(0, 60),
        category: p.category,
      }))
    }
    const parts = [sections.greeting, ...sections.stories.map(s => s.text), sections.signoff].filter(Boolean)
    const wc = parts.map(p => p.split(/\s+/).length); const total = wc.reduce((a, b) => a + b, 0) || 1
    const out: { start: number; title: string; category?: string | null }[] = []
    let acc = sections.greeting ? wc[0] : 0
    sections.stories.forEach((st, i) => {
      let start = (acc / total) * dur
      const probe = norm(st.text).split(' ').slice(0, 4).join(' ')
      if (probe.length > 8) {
        const hit = cueList.find(c => norm(c.text).includes(probe))
        if (hit) start = hit.start
      }
      out.push({ start, title: st.lower_third || `Știrea ${i + 1}`, category: selectedPosts[i]?.category })
      acc += wc[(sections.greeting ? 1 : 0) + i]
    })
    return out
  }

  // Loudness: measure the voiceover's RMS and compute the gain that brings it
  // to a social-standard speech level (~-16 LUFS ≈ 0.12 RMS), clamped, with a
  // compressor downstream to stop clipping. Honest approximation, not a full
  // ITU-R BS.1770 meter — but it ends the "too quiet on mobile" problem.
  async function measureVoiceGain(ac: AudioContext, url: string): Promise<number> {
    try {
      const buf = await ac.decodeAudioData(await (await fetch(url)).arrayBuffer())
      const ch = buf.getChannelData(0)
      let sum = 0, n = 0
      for (let i = 0; i < ch.length; i += 4) { sum += ch[i] * ch[i]; n++ }
      const rms = Math.sqrt(sum / Math.max(1, n))
      if (!rms || !Number.isFinite(rms)) return 1
      return Math.min(4, Math.max(0.5, 0.12 / rms))
    } catch { return 1 }
  }

  async function composeBulletin() {
    if (!videoUrl) { setError('Generează întâi clipul cu prezentatorul (pasul 5).'); return }
    setError(''); setCompositing(true); setCompPct(0); setBulletinUrl('')
    try {
      // Anchor clip.
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'; v.playsInline = true; v.preload = 'auto'; v.src = videoUrl
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('Nu am putut încărca clipul (CORS?).')) })
      const dur = Math.min(300, Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 60)

      // Captions from the voiceover (once) — segments + word timings.
      let cueList = cues
      let wordList = words
      if (subsOn && (cueList.length === 0 || (capMode === 'karaoke' && wordList.length === 0)) && voUrl) {
        try {
          const r = await invokeRaw('align-subtitles', { audio_url: voUrl, language: lang })
          if (Array.isArray(r.segments)) { cueList = r.segments as Cue[]; setCues(cueList) }
          if (Array.isArray(r.words)) { wordList = r.words as Word[]; setWords(wordList) }
        } catch { /* captions optional */ }
      }
      // Karaoke groups: chunks of ≤4 words / ≤26 chars, timed word-by-word.
      const karaoke: { start: number; end: number; ws: Word[] }[] = []
      if (capMode === 'karaoke' && wordList.length) {
        let g: Word[] = []
        const flush = () => { if (g.length) { karaoke.push({ start: g[0].start, end: g[g.length - 1].end, ws: g }); g = [] } }
        for (const w of wordList) {
          g.push(w)
          const chars = g.reduce((a, x) => a + x.word.length + 1, 0)
          if (g.length >= 4 || chars > 26 || /[.!?]$/.test(w.word)) flush()
        }
        flush()
      }
      const thirds = storyTimes(dur, cueList)
      const tickerText = posts.filter(p => sel.has(p.id)).map(p => (lang === 'ro' ? p.title_ro : p.title_en) || '').filter(Boolean).join('   •   ')

      const [W, H] = orient === '16:9' ? [1280, 720] : [720, 1280]
      const canvas = canvasRef.current!
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')!
      const total = INTRO + dur + OUTRO
      const dateStr = new Date().toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      const clockBaseMs = Date.now()   // live-advancing clock baked into the ticker
      let studioImg: HTMLImageElement | null = null
      if (studioBg) { try { studioImg = await loadImage(studioBg) } catch { studioImg = null } }

      // Audio: anchor clip audio → loudness gain → compressor → recorder.
      const ac = new AudioContext()
      const src = ac.createMediaElementSource(v)
      const dest = ac.createMediaStreamDestination()
      const gain = ac.createGain()
      gain.gain.value = voUrl ? await measureVoiceGain(ac, voUrl) : 1
      const comp = ac.createDynamicsCompressor()
      comp.threshold.value = -6; comp.knee.value = 10; comp.ratio.value = 6
      comp.attack.value = 0.003; comp.release.value = 0.25
      src.connect(gain).connect(comp).connect(dest)

      // Intro sting — a short cinematic sound bed under the branded open so the
      // first ~4s isn't silent (drone → whoosh → riser → impact at the logo
      // slam → shimmer). Routed into BOTH the recorder and the speakers.
      const stingBus = ac.createGain(); stingBus.gain.value = 0.9
      stingBus.connect(dest); stingBus.connect(ac.destination)
      const noiseBuf = (d: number) => { const n = Math.floor(ac.sampleRate * d); const b = ac.createBuffer(1, n, ac.sampleRate); const ch = b.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1; return b }
      const scheduleIntroSting = (t0: number) => {
        const slam = t0 + 2.55   // aligns with the logo slam in drawIntro
        ;[55, 110].forEach((f, i) => {
          const o = ac.createOscillator(); o.type = i ? 'sine' : 'triangle'; o.frequency.value = f
          const g = ac.createGain(); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320
          g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.11, t0 + 2.2)
          g.gain.setValueAtTime(0.11, t0 + 3.4); g.gain.linearRampToValueAtTime(0, t0 + 4.2)
          o.connect(lp); lp.connect(g); g.connect(stingBus); o.start(t0); o.stop(t0 + 4.3)
        })
        ;[[0.5, 0.8], [1.5, 0.8]].forEach(([st, du]) => {
          const s = ac.createBufferSource(); s.buffer = noiseBuf(du)
          const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
          bp.frequency.setValueAtTime(300, t0 + st); bp.frequency.exponentialRampToValueAtTime(3500, t0 + st + du)
          const g = ac.createGain(); g.gain.setValueAtTime(0, t0 + st)
          g.gain.linearRampToValueAtTime(0.14, t0 + st + du * 0.4); g.gain.linearRampToValueAtTime(0, t0 + st + du)
          s.connect(bp); bp.connect(g); g.connect(stingBus); s.start(t0 + st); s.stop(t0 + st + du)
        })
        { const o = ac.createOscillator(); o.type = 'sawtooth'
          o.frequency.setValueAtTime(90, t0 + 1.1); o.frequency.exponentialRampToValueAtTime(900, slam)
          const g = ac.createGain(); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'
          lp.frequency.setValueAtTime(400, t0 + 1.1); lp.frequency.exponentialRampToValueAtTime(6000, slam)
          g.gain.setValueAtTime(0.0001, t0 + 1.1); g.gain.exponentialRampToValueAtTime(0.13, slam - 0.02); g.gain.linearRampToValueAtTime(0, slam + 0.12)
          o.connect(lp); lp.connect(g); g.connect(stingBus); o.start(t0 + 1.1); o.stop(slam + 0.2) }
        { const o = ac.createOscillator(); o.type = 'sine'
          o.frequency.setValueAtTime(120, slam); o.frequency.exponentialRampToValueAtTime(45, slam + 0.5)
          const g = ac.createGain(); g.gain.setValueAtTime(0.9, slam); g.gain.exponentialRampToValueAtTime(0.001, slam + 0.7)
          o.connect(g); g.connect(stingBus); o.start(slam); o.stop(slam + 0.75) }
        { const s = ac.createBufferSource(); s.buffer = noiseBuf(0.12)
          const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200
          const g = ac.createGain(); g.gain.setValueAtTime(0.32, slam); g.gain.exponentialRampToValueAtTime(0.001, slam + 0.12)
          s.connect(hp); hp.connect(g); g.connect(stingBus); s.start(slam); s.stop(slam + 0.13) }
        ;[320, 470, 705].forEach((f, i) => {
          const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f
          const g = ac.createGain(); g.gain.setValueAtTime(0.13 / (i + 1), slam + 0.005); g.gain.exponentialRampToValueAtTime(0.001, slam + 1.2)
          o.connect(g); g.connect(stingBus); o.start(slam); o.stop(slam + 1.25)
        })
      }
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()])
      let mime = 'video/mp4'
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp9,opus'
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 })
      const chunks: BlobPart[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const done = new Promise<Blob>(res => { rec.onstop = () => res(new Blob(chunks, { type: mime })) })

      const isWide = orient === '16:9'
      const band = isWide ? 64 : 72
      const tick = isWide ? 54 : 62
      // ══ Refined broadcast graphics package ══════════════════════════════
      // Full-bleed anchor; glass overlays with hairline bevels layered on top.
      const marginX = isWide ? 46 : 28
      const P = {
        crimson: '#C8102E', crimsonDk: '#8f0a1f', cream: '#FBF4E4', gold: '#E7C982',
        glass: 'rgba(11,14,22,0.82)', glassSolid: 'rgba(11,14,22,0.94)',
        hair: 'rgba(255,255,255,0.14)', hairDim: 'rgba(255,255,255,0.06)',
      }
      const sc = isWide ? 1 : (W / 1080) * 1.0            // caption/label scale
      const drawCoverFull = (vv: HTMLVideoElement) => {
        const vw = vv.videoWidth || 16, vh = vv.videoHeight || 9
        const vr = vw / vh, cr = W / H
        let dw: number, dh: number
        if (vr > cr) { dh = H; dw = H * vr } else { dw = W; dh = W / vr }
        ctx.drawImage(vv, (W - dw) / 2, (H - dh) / 2, dw, dh)
      }
      // studio backdrop compositing + optional greenscreen key on the anchor
      const okv = document.createElement('canvas'); okv.width = W; okv.height = H
      const okx = okv.getContext('2d')!
      const coverDraw = (c: CanvasRenderingContext2D, img: CanvasImageSource, iw: number, ih: number) => {
        const vr = iw / ih, cr = W / H; let dw: number, dh: number
        if (vr > cr) { dh = H; dw = H * vr } else { dw = W; dh = W / vr }
        c.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
      }
      const drawAnchorKeyed = () => {
        okx.clearRect(0, 0, W, H)
        coverDraw(okx, v, v.videoWidth || 16, v.videoHeight || 9)
        try {
          const id = okx.getImageData(0, 0, W, H); const d = id.data
          for (let i = 0; i < d.length; i += 4) {
            const r = d[i], g = d[i + 1], b = d[i + 2]
            if (g > 90 && g > r * 1.35 && g > b * 1.35) d[i + 3] = 0   // key out green
          }
          okx.putImageData(id, 0, 0)
        } catch { /* tainted canvas — skip keying, fall back to full frame */ }
        ctx.drawImage(okv, 0, 0)
      }
      // A glass panel with a subtle top inner-highlight and bottom shadow line.
      const glass = (x: number, y: number, w: number, h: number, r: number, fill = P.glass) => {
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6
        ctx.fillStyle = fill; rr(ctx, x, y, w, h, r); ctx.fill()
        ctx.restore()
        ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip()
        ctx.strokeStyle = P.hair; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(x + r, y + 0.5); ctx.lineTo(x + w - r, y + 0.5); ctx.stroke()
        ctx.restore()
      }
      const spaced = (str: string, px: string, x: number, y: number, ls = 2) => {
        ctx.save(); (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`
        ctx.font = px; ctx.fillText(str, x, y)
        ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'; ctx.restore()
      }

      const drawContent = (t: number) => {
        const vt = t - INTRO
        // 1) anchor fills the whole frame (over a studio backdrop if chosen)
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H)
        if (studioImg) coverDraw(ctx, studioImg, studioImg.naturalWidth || 16, studioImg.naturalHeight || 9)
        if (studioImg && greenscreen) drawAnchorKeyed()
        else drawCoverFull(v)
        // 2) cinematic scrims + corner vignette so overlays read over any studio
        const scrimH = H * 0.42
        const scB = ctx.createLinearGradient(0, H - scrimH, 0, H)
        scB.addColorStop(0, 'rgba(6,8,14,0)'); scB.addColorStop(1, 'rgba(6,8,14,0.85)')
        ctx.fillStyle = scB; ctx.fillRect(0, H - scrimH, W, H)
        const scT = ctx.createLinearGradient(0, 0, 0, band * 1.8)
        scT.addColorStop(0, 'rgba(6,8,14,0.6)'); scT.addColorStop(1, 'rgba(6,8,14,0)')
        ctx.fillStyle = scT; ctx.fillRect(0, 0, W, band * 1.8)
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75)
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)')
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)

        // 3) top brand bar — glass, logo mark, letter-spaced wordmark, date + AI tag
        const bg = ctx.createLinearGradient(0, 0, 0, band)
        bg.addColorStop(0, 'rgba(9,11,18,0.94)'); bg.addColorStop(1, 'rgba(9,11,18,0.80)')
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, band)
        ctx.fillStyle = P.hairDim; ctx.fillRect(0, band - 4, W, 1)
        ctx.fillStyle = P.crimson; ctx.fillRect(0, band - 3, W, 3)
        // logo mark
        const mk = isWide ? 32 : 34, mkY = (band - mk) / 2
        ctx.fillStyle = P.crimson; rr(ctx, marginX, mkY, mk, mk, 5); ctx.fill()
        ctx.fillStyle = P.cream; ctx.font = `700 ${mk * 0.66}px Lora, Georgia, serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText('T', marginX + mk / 2, mkY + mk / 2 + 1)
        // wordmark
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = P.cream
        spaced('TRANSILVANIA', `700 ${isWide ? 19 : 17}px Inter, sans-serif`, marginX + mk + 14, band / 2, 3)
        const twm = (() => { ctx.save(); (ctx as unknown as { letterSpacing: string }).letterSpacing = '3px'; ctx.font = `700 ${isWide ? 19 : 17}px Inter, sans-serif`; const w = ctx.measureText('TRANSILVANIA').width; (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'; ctx.restore(); return w })()
        ctx.fillStyle = P.crimson
        spaced('TIMES', `700 ${isWide ? 19 : 17}px Inter, sans-serif`, marginX + mk + 14 + twm + 12, band / 2, 3)
        // right cluster: date + AI edition tag with a divider
        ctx.textAlign = 'right'; ctx.fillStyle = P.gold
        ctx.font = `600 ${isWide ? 13 : 12}px Inter, sans-serif`
        ctx.fillText(dateStr, W - marginX, band / 2)
        const dW = ctx.measureText(dateStr).width
        ctx.strokeStyle = P.hair; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(W - marginX - dW - 16, band / 2 - 10); ctx.lineTo(W - marginX - dW - 16, band / 2 + 10); ctx.stroke()
        ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(251,244,228,0.65)'
        spaced('EDIȚIE AI', `700 ${isWide ? 11 : 10}px Inter, sans-serif`, W - marginX - dW - 28, band / 2, 2)

        // 4) AI badge (glass pill, pulsing dot) — top-right under the bar
        {
          ctx.font = `600 ${11 * sc}px Inter, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
          const label = lang === 'ro' ? 'GENERAT CU AI' : 'AI-GENERATED'
          const pad = 12 * sc, dot = 7 * sc
          const lw = ctx.measureText(label).width
          const pw = pad + dot + 7 * sc + lw + pad, ph = 24 * sc
          const px = W - marginX - pw, py = band + 14
          glass(px, py, pw, ph, ph / 2)
          const pulse = 0.5 + 0.5 * Math.sin(t * 4)
          ctx.fillStyle = P.crimson; ctx.globalAlpha = 0.5 + 0.5 * pulse
          ctx.beginPath(); ctx.arc(px + pad + dot / 2, py + ph / 2, dot / 2, 0, 7); ctx.fill(); ctx.globalAlpha = 1
          ctx.fillStyle = 'rgba(251,244,228,0.9)'
          spaced(label, `600 ${11 * sc}px Inter, sans-serif`, px + pad + dot + 7 * sc, py + ph / 2 + 0.5, 1.5)
        }

        // 5) ticker — glass track, gradient tab, edge fades
        if (tickerOn && tickerText) {
          const trackBg = ctx.createLinearGradient(0, H - tick, 0, H)
          trackBg.addColorStop(0, 'rgba(9,11,18,0.96)'); trackBg.addColorStop(1, 'rgba(7,9,14,0.98)')
          ctx.fillStyle = trackBg; ctx.fillRect(0, H - tick, W, tick)
          ctx.fillStyle = P.crimson; ctx.fillRect(0, H - tick, W, 2)
          const tabW = isWide ? 128 : 108
          const tabBg = ctx.createLinearGradient(0, H - tick, tabW, H)
          tabBg.addColorStop(0, P.crimson); tabBg.addColorStop(1, P.crimsonDk)
          ctx.fillStyle = tabBg; ctx.fillRect(0, H - tick, tabW, tick)
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
          spaced(lang === 'ro' ? 'ȘTIRI' : 'NEWS', `800 ${15 * sc}px Inter, sans-serif`, 22, H - tick / 2, 2)
          ctx.font = `800 ${15 * sc}px Inter, sans-serif`; ctx.fillText('›', tabW - 22, H - tick / 2)
          // scrolling content (seamless), separated by gold diamonds
          const content = tickerText.replace(/\s*·\s*/g, '   ◆   ')
          // live clock box on the right
          const clockW = isWide ? 104 : 92
          const clockX = W - clockW
          ctx.font = `600 ${15 * sc}px Inter, sans-serif`; ctx.fillStyle = 'rgba(243,231,206,.95)'
          const loopW = ctx.measureText(content).width + 120
          const off = ((t * 115) % loopW)
          ctx.save(); ctx.beginPath(); ctx.rect(tabW + 10, H - tick, clockX - tabW - 20, tick); ctx.clip()
          ctx.fillText(content, W - clockW - off, H - tick / 2)
          ctx.fillText(content, W - clockW - off + loopW, H - tick / 2)
          ctx.restore()
          // edge fades
          const fadeL = ctx.createLinearGradient(tabW, 0, tabW + 40, 0)
          fadeL.addColorStop(0, 'rgba(8,10,16,1)'); fadeL.addColorStop(1, 'rgba(8,10,16,0)')
          ctx.fillStyle = fadeL; ctx.fillRect(tabW, H - tick, 40, tick)
          const fadeR = ctx.createLinearGradient(clockX - 40, 0, clockX, 0)
          fadeR.addColorStop(0, 'rgba(8,10,16,0)'); fadeR.addColorStop(1, 'rgba(8,10,16,1)')
          ctx.fillStyle = fadeR; ctx.fillRect(clockX - 40, H - tick, 40, tick)
          // clock
          const now = new Date(clockBaseMs + t * 1000)
          const clockStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(clockX, H - tick, clockW, tick)
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.moveTo(clockX + 0.5, H - tick + 10); ctx.lineTo(clockX + 0.5, H - 10); ctx.stroke()
          const dotPulse = 0.5 + 0.5 * Math.sin(t * 3)
          ctx.fillStyle = P.crimson; ctx.globalAlpha = 0.5 + 0.5 * dotPulse
          ctx.beginPath(); ctx.arc(clockX + 22, H - tick / 2, 4, 0, 7); ctx.fill(); ctx.globalAlpha = 1
          ctx.fillStyle = P.cream; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
          ctx.font = `700 ${16 * sc}px Inter, sans-serif`
          ctx.fillText(clockStr, clockX + 34, H - tick / 2)
        }

        // 6) lower-third — crimson kicker tab over a glass headline bar, wipe-in
        const cur = [...thirds].reverse().find(s => vt >= s.start) || thirds[0]
        const idx = cur ? thirds.indexOf(cur) + 1 : 1
        const ltH = isWide ? 100 : 116
        const gapT = isWide ? 22 : 26
        const ltY = H - tick - gapT - ltH
        const barX = marginX, barW = W - marginX * 2
        const tabH = isWide ? 32 : 36, tabY = ltY - tabH + 3
        const ap = Math.max(0, Math.min(1, (vt - (cur?.start || 0)) / 0.5))
        const apE = 1 - Math.pow(1 - ap, 3)
        const tabIn = Math.max(0, Math.min(1, (vt - (cur?.start || 0) - 0.12) / 0.4))
        const txtIn = Math.max(0, Math.min(1, (vt - (cur?.start || 0) - 0.22) / 0.4))

        // main bar (wipes open from the left)
        ctx.save(); ctx.beginPath(); ctx.rect(barX, ltY - 4, barW * apE, ltH + 8); ctx.clip()
        glass(barX, ltY, barW, ltH, 9, P.glassSolid)
        // crimson left spine (gradient)
        const spine = ctx.createLinearGradient(barX, ltY, barX, ltY + ltH)
        spine.addColorStop(0, P.crimson); spine.addColorStop(1, P.crimsonDk)
        ctx.fillStyle = spine; rr(ctx, barX, ltY, 7, ltH, 3); ctx.fill()
        ctx.restore()

        // headline (vertically centered, fades/rises in)
        if (txtIn > 0) {
          ctx.save(); ctx.globalAlpha = txtIn
          ctx.translate(0, (1 - txtIn) * 10)
          ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
          ctx.font = `700 ${isWide ? 34 : 30}px Lora, Georgia, serif`
          const lines = wrapText(ctx, cur?.title || '', barW - 60).slice(0, 2)
          const lh = isWide ? 40 : 36
          const cyc = ltY + ltH / 2 + (isWide ? 6 : 5)
          let yy = cyc - (lines.length - 1) * lh / 2
          for (const ln of lines) { ctx.fillText(ln, barX + 26, yy); yy += lh }
          ctx.restore()
        }
        // sweep of light across the bar as it reveals
        if (ap > 0.1 && ap < 0.85) {
          ctx.save(); ctx.beginPath(); rr(ctx, barX, ltY, barW, ltH, 9); ctx.clip()
          ctx.globalCompositeOperation = 'lighter'
          const sx = barX + (ap - 0.1) / 0.75 * (barW + 240) - 120
          const gsw = ctx.createLinearGradient(sx - 120, 0, sx + 120, 0)
          gsw.addColorStop(0, 'rgba(255,255,255,0)'); gsw.addColorStop(0.5, 'rgba(255,255,255,0.10)'); gsw.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = gsw; ctx.fillRect(sx - 120, ltY, 240, ltH); ctx.restore()
        }
        // kicker tab (drops in)
        if (tabIn > 0) {
          ctx.save(); ctx.globalAlpha = tabIn
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
          const kick = lang === 'ro' ? 'BULETINUL ZILEI' : 'DAILY BULLETIN'
          ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '2px'
          ctx.font = `800 ${isWide ? 13 : 12}px Inter, sans-serif`
          const kw = ctx.measureText(kick).width
          ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
          const countTxt = `${idx}/${thirds.length}`
          ctx.font = `700 ${isWide ? 12 : 11}px Inter, sans-serif`
          const cwd = ctx.measureText(countTxt).width
          const tabW = kw + 24 + cwd + 22
          const tabgrad = ctx.createLinearGradient(barX, tabY, barX + tabW, tabY)
          tabgrad.addColorStop(0, P.crimson); tabgrad.addColorStop(1, P.crimsonDk)
          ctx.fillStyle = tabgrad
          rr(ctx, barX, tabY - (1 - tabIn) * 6, tabW, tabH, 5); ctx.fill()
          ctx.fillStyle = '#fff'
          spaced(kick, `800 ${isWide ? 13 : 12}px Inter, sans-serif`, barX + 14, tabY + tabH / 2 - (1 - tabIn) * 6, 2)
          // count pill
          ctx.fillStyle = 'rgba(255,255,255,0.22)'
          rr(ctx, barX + 14 + kw + 8, tabY + tabH / 2 - 9 - (1 - tabIn) * 6, cwd + 16, 18, 9); ctx.fill()
          ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
          ctx.font = `700 ${isWide ? 12 : 11}px Inter, sans-serif`
          ctx.fillText(countTxt, barX + 14 + kw + 8 + (cwd + 16) / 2, tabY + tabH / 2 + 0.5 - (1 - tabIn) * 6)
          ctx.restore()
        }

        // 6b) segment timer along the bar bottom + category chip top-right
        {
          const nextStart = thirds[idx]?.start ?? dur
          const segP = Math.max(0, Math.min(1, (vt - (cur?.start || 0)) / Math.max(0.6, nextStart - (cur?.start || 0))))
          ctx.save(); ctx.globalAlpha = apE
          ctx.fillStyle = 'rgba(255,255,255,0.10)'; rr(ctx, barX + 14, ltY + ltH - 5, barW - 28, 3, 1.5); ctx.fill()
          const pw = (barW - 28) * segP
          if (pw > 2) {
            const pg = ctx.createLinearGradient(barX, 0, barX + barW, 0)
            pg.addColorStop(0, P.crimson); pg.addColorStop(1, P.gold)
            ctx.fillStyle = pg; rr(ctx, barX + 14, ltY + ltH - 5, pw, 3, 1.5); ctx.fill()
          }
          ctx.restore()
          const cat = (cur?.category || '').toString().trim()
          if (cat && tabIn > 0) {
            ctx.save(); ctx.globalAlpha = tabIn
            const label = cat.toUpperCase()
            ctx.font = `800 ${isWide ? 12 : 11}px Inter, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
            ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '1.5px'
            const cw = ctx.measureText(label).width
            ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
            const chipW = cw + 26, chipH = isWide ? 26 : 28
            const chipX = barX + barW - chipW, chipY = tabY + (tabH - chipH) / 2 - (1 - tabIn) * 6
            ctx.fillStyle = 'rgba(200,16,46,0.18)'; rr(ctx, chipX, chipY, chipW, chipH, chipH / 2); ctx.fill()
            ctx.strokeStyle = 'rgba(231,201,130,0.85)'; ctx.lineWidth = 1; rr(ctx, chipX, chipY, chipW, chipH, chipH / 2); ctx.stroke()
            ctx.fillStyle = P.gold
            spaced(label, `800 ${isWide ? 12 : 11}px Inter, sans-serif`, chipX + 13, chipY + chipH / 2 + 0.5, 1.5)
            ctx.restore()
          }
        }

        // 7) captions above the lower-third — glass pill, active-word glow
        if (subsOn) {
          const cy0 = tabY - (isWide ? 26 : 30)
          if (capMode === 'karaoke' && karaoke.length) {
            const grp = karaoke.find(g => vt >= g.start && vt <= g.end + 0.12)
            if (grp) {
              ctx.font = `800 ${(isWide ? 26 : 27) * (isWide ? 1 : 1)}px Inter, sans-serif`; ctx.textBaseline = 'middle'
              const gap = 11
              const widths = grp.ws.map(w => ctx.measureText(w.word.toUpperCase()).width)
              const totalW = widths.reduce((a, b) => a + b, 0) + gap * (grp.ws.length - 1)
              const lh = isWide ? 42 : 46
              glass(W / 2 - totalW / 2 - 20, cy0 - lh / 2, totalW + 40, lh, 8)
              let x = W / 2 - totalW / 2
              ctx.textAlign = 'left'
              grp.ws.forEach((w, i) => {
                const spoken = vt >= w.start
                const active = vt >= w.start && vt <= w.end
                if (active) { ctx.save(); ctx.shadowColor = 'rgba(231,201,130,0.9)'; ctx.shadowBlur = 16 }
                ctx.fillStyle = active ? P.gold : spoken ? '#FFFFFF' : 'rgba(255,255,255,.40)'
                ctx.fillText(w.word.toUpperCase(), x, cy0)
                if (active) ctx.restore()
                x += widths[i] + gap
              })
              ctx.textBaseline = 'alphabetic'
            }
          } else {
            const cue = cueList.find(c => vt >= c.start && vt <= c.end)
            if (cue) {
              ctx.font = `600 ${isWide ? 23 : 24}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
              const lines = wrapText(ctx, cue.text.trim(), W * 0.74).slice(0, 2)
              const lh = isWide ? 34 : 38
              let cy = cy0 - (lines.length - 1) * lh
              for (const ln of lines) {
                const tw = ctx.measureText(ln).width
                glass(W / 2 - tw / 2 - 16, cy - lh / 2, tw + 32, lh - 4, 6)
                ctx.fillStyle = '#fff'; ctx.fillText(ln, W / 2, cy); cy += lh
              }
              ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
            }
          }
        }
      }
      // Cinematic broadcast open: dark stage → light streaks → forming wireframe
      // globe with a Transylvania beacon → logo slam + shimmer → tagline bar.
      const introParticles = seedIntroParticles(W, H)
      const portrait = !isWide
      const drawIntro = (t: number) => {
        const cx = W / 2, cy = H / 2
        const bgFade = segN(t, 0, 0.5)
        // background
        ctx.fillStyle = '#04060b'; ctx.fillRect(0, 0, W, H)
        const g = ctx.createRadialGradient(cx, cy * 0.92, 0, cx, cy, Math.max(W, H) * 0.75)
        g.addColorStop(0, '#111a2b'); g.addColorStop(0.45, '#0a1019'); g.addColorStop(1, '#04060b')
        ctx.globalAlpha = bgFade; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
        for (let i = 0; i < 3; i++) {
          const px = cx + Math.sin(t * 0.3 + i * 2) * W * 0.22, py = cy + Math.cos(t * 0.25 + i * 1.3) * H * 0.18
          const rg = ctx.createRadialGradient(px, py, 0, px, py, W * 0.28)
          rg.addColorStop(0, `rgba(202,34,34,${0.10 * bgFade})`); rg.addColorStop(1, 'rgba(202,34,34,0)')
          ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
        }
        ctx.globalAlpha = 1
        // particles
        for (const p of introParticles) {
          const py = (p.y - t * p.sp) % 1; const yy = (py < 0 ? py + 1 : py) * H
          const tw = 0.55 + 0.45 * Math.sin(p.tw + t * 3)
          ctx.globalAlpha = p.a * bgFade * tw; ctx.fillStyle = '#dfe8f5'
          ctx.beginPath(); ctx.arc(p.x * W, yy, p.r, 0, 7); ctx.fill()
        }
        ctx.globalAlpha = 1
        // light streaks
        if (t > 0.3 && t < 1.8) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'
          for (let i = 0; i < 4; i++) {
            const prog = segN(t, 0.3 + i * 0.14, 1.5 + i * 0.1)
            if (prog <= 0 || prog >= 1) continue
            const yy = cy + (i - 1.5) * H * 0.14, x = (-0.3 + prog * 1.6) * W, lw = W * 0.9
            const lg = ctx.createLinearGradient(x - lw / 2, yy, x + lw / 2, yy)
            lg.addColorStop(0, 'rgba(202,34,34,0)')
            lg.addColorStop(0.5, `rgba(255,70,100,${0.5 * (1 - Math.abs(prog - 0.5) * 2)})`)
            lg.addColorStop(1, 'rgba(202,34,34,0)')
            ctx.fillStyle = lg; ctx.fillRect(x - lw / 2, yy - 1.4, lw, 2.8)
          }
          ctx.restore()
        }
        // globe
        const globeIn = easeOutN(segN(t, 0.6, 2.2)), globeOut = segN(t, 2.15, 2.7)
        const globeA = globeIn * (1 - globeOut)
        if (globeA > 0.01) {
          const R = (portrait ? Math.min(W, H) * 0.30 : H * 0.34) * (0.2 + 0.8 * globeIn) * (1 + globeOut * 0.5)
          const rot = t * 0.6
          ctx.save(); ctx.translate(cx, cy - (portrait ? H * 0.06 : 0))
          const gg = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.5)
          gg.addColorStop(0, `rgba(202,34,34,${0.16 * globeA})`); gg.addColorStop(1, 'rgba(202,34,34,0)')
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, R * 1.5, 0, 7); ctx.fill()
          const drawLine = (pts: { x: number; y: number; z: number }[]) => {
            let started = false
            for (const p of pts) {
              if (p.z > 0) {
                if (!started) { ctx.beginPath(); ctx.moveTo(p.x * R, p.y * R); started = true } else ctx.lineTo(p.x * R, p.y * R)
                ctx.globalAlpha = globeA * (p.z * 0.5 + 0.5) * 0.9
              } else if (started) { ctx.stroke(); started = false }
            }
            if (started) ctx.stroke()
          }
          ctx.lineWidth = 1.1
          for (let lat = -60; lat <= 60; lat += 15) {
            const pts = []; for (let lon = -180; lon <= 180; lon += 6) pts.push(projGlobe(lat, lon, rot))
            ctx.strokeStyle = 'rgba(120,150,190,0.85)'; drawLine(pts)
          }
          for (let lon = 0; lon < 180; lon += 15) {
            const pts = []; for (let lat = -90; lat <= 90; lat += 6) pts.push(projGlobe(lat, lon, rot))
            ctx.strokeStyle = 'rgba(220,80,110,0.85)'; drawLine(pts)
          }
          const m = projGlobe(46.7, 23.6, rot)
          if (m.z > 0.1) {
            const pulse = 0.5 + 0.5 * Math.sin(t * 5)
            ctx.globalAlpha = globeA; ctx.fillStyle = '#fff'
            ctx.beginPath(); ctx.arc(m.x * R, m.y * R, 3.2, 0, 7); ctx.fill()
            ctx.globalAlpha = globeA * 0.6 * pulse; ctx.strokeStyle = C.crimson; ctx.lineWidth = 2
            ctx.beginPath(); ctx.arc(m.x * R, m.y * R, 8 + pulse * 10, 0, 7); ctx.stroke()
          }
          ctx.restore(); ctx.globalAlpha = 1
        }
        // logo lock-up
        const introA = segN(t, 2.15, 2.55)
        const logoY = cy - (portrait ? H * 0.02 : 0)
        if (introA > 0.01) {
          ctx.save(); ctx.translate(cx, logoY)
          const pop = 1 + (1 - easeOutN(clampN(segN(t, 2.55, 2.95), 0, 1))) * 0.05
          ctx.scale(pop, pop); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          const big = portrait ? W * 0.115 : H * 0.135
          ctx.globalAlpha = introA
          ctx.font = `800 ${big}px Inter, 'Arial Narrow', sans-serif`
          const rise = (1 - introA) * 40
          ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4
          ctx.fillStyle = C.parchment
          ctx.save(); ctx.translate(0, -big * 0.32 - rise); letterSpacedC(ctx, 'TRANSILVANIA', big * 0.06, 0, 0); ctx.restore()
          ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
          const small = big * 0.42, rise2 = (1 - segN(t, 2.25, 2.6)) * 40
          ctx.globalAlpha = segN(t, 2.25, 2.6)
          ctx.save(); ctx.translate(0, big * 0.42 - rise2)
          ctx.font = `600 ${small}px Inter, 'Arial Narrow', sans-serif`
          const timesW = measureSpacedC(ctx, 'T I M E S', small * 0.06)
          const gap = timesW / 2 + small * 0.9, ruleW = portrait ? W * 0.16 : H * 0.14
          ctx.fillStyle = C.crimson
          ctx.fillRect(-gap - ruleW, -small * 0.06, ruleW, small * 0.12)
          ctx.fillRect(gap, -small * 0.06, ruleW, small * 0.12)
          ctx.fillStyle = C.parchment; letterSpacedC(ctx, 'T I M E S', small * 0.06, 0, 0)
          ctx.restore(); ctx.globalAlpha = 1; ctx.restore()
          // shimmer
          const sh = segN(t, 2.65, 3.5)
          if (sh > 0 && sh < 1) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter'
            const bandX = cx + (-0.6 + sh * 1.7) * (big * 4), bw = big * 1.1
            const lg = ctx.createLinearGradient(bandX - bw, 0, bandX + bw, 0)
            lg.addColorStop(0, 'rgba(255,255,255,0)')
            lg.addColorStop(0.5, `rgba(255,255,255,${0.22 * (1 - Math.abs(sh - 0.5) * 2)})`)
            lg.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = lg; ctx.fillRect(bandX - bw, logoY - big * 0.9, bw * 2, big * 1.7); ctx.restore()
          }
        }
        // tagline bar
        const barIn = easeOutN(segN(t, 3.05, 3.5))
        if (barIn > 0.01) {
          const bw = (portrait ? W * 0.72 : W * 0.42) * barIn, bh = portrait ? H * 0.05 : H * 0.058
          const by = logoY + (portrait ? H * 0.14 : H * 0.20)
          ctx.save(); ctx.fillStyle = C.crimson; ctx.fillRect(cx - bw / 2, by - bh / 2, bw, bh)
          const txtA = segN(t, 3.4, 3.75)
          if (txtA > 0) {
            ctx.globalAlpha = txtA; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            const fs = bh * 0.5; ctx.font = `700 ${fs}px Inter, sans-serif`
            letterSpacedC(ctx, lang === 'ro' ? 'ȘTIRILE ARDEALULUI' : 'NEWS FROM TRANSYLVANIA', fs * 0.12, cx, by)
          }
          ctx.restore()
          const domA = segN(t, 3.6, 3.95)
          if (domA > 0) {
            ctx.save(); ctx.globalAlpha = domA; ctx.fillStyle = 'rgba(251,244,228,0.75)'
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
            const fs = (portrait ? W : H) * 0.019; ctx.font = `600 ${fs}px Inter, sans-serif`
            letterSpacedC(ctx, dateStr.toUpperCase(), fs * 0.14, cx, by + bh * 0.9 + fs)
            ctx.restore()
          }
        }
        // slam flash
        if (t >= 2.53 && t < 2.85) {
          const fl = Math.max(0, 1 - segN(t, 2.55, 2.83))
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fl * 0.5
          ctx.fillStyle = '#ffdfe6'; ctx.fillRect(0, 0, W, H); ctx.restore()
        }
        // vignette + open-from-black
        const vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, Math.max(W, H) * 0.72)
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)')
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
        const openBlack = 1 - segN(t, 0, 0.4)
        if (openBlack > 0) { ctx.globalAlpha = openBlack; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1 }
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      }
      const drawOutro = (t: number) => {
        const a = Math.min(1, (t - INTRO - dur) / 0.5)
        const e = 1 - Math.pow(1 - a, 3)
        // cinematic navy stage (echoes the intro) with a crimson core glow
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H)
        const g = ctx.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H / 2, Math.max(W, H) * 0.72)
        g.addColorStop(0, '#111a2b'); g.addColorStop(0.5, '#0a1019'); g.addColorStop(1, '#05070c')
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
        const rgl = ctx.createRadialGradient(W / 2, H * 0.40, 0, W / 2, H * 0.40, W * 0.42)
        rgl.addColorStop(0, 'rgba(200,16,46,0.13)'); rgl.addColorStop(1, 'rgba(200,16,46,0)')
        ctx.fillStyle = rgl; ctx.fillRect(0, 0, W, H)
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75)
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)')
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)

        ctx.save(); ctx.globalAlpha = e; ctx.translate(0, (1 - e) * 14)
        const cx = W / 2, cyc = H * 0.40
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const big = isWide ? 62 : 52
        ctx.fillStyle = P.cream; ctx.font = `800 ${big}px Inter, sans-serif`
        letterSpacedC(ctx, 'TRANSILVANIA', big * 0.06, cx, cyc)
        const small = big * 0.42
        ctx.font = `600 ${small}px Inter, sans-serif`
        const tw = measureSpacedC(ctx, 'T I M E S', small * 0.06)
        const gap = tw / 2 + small * 0.9, ruleW = isWide ? W * 0.10 : W * 0.14
        const rowY = cyc + big * 0.56
        ctx.fillStyle = P.crimson
        ctx.fillRect(cx - gap - ruleW, rowY - small * 0.06, ruleW, small * 0.12)
        ctx.fillRect(cx + gap, rowY - small * 0.06, ruleW, small * 0.12)
        ctx.fillStyle = P.cream; letterSpacedC(ctx, 'T I M E S', small * 0.06, cx, rowY)
        ctx.fillStyle = P.gold; ctx.font = `600 ${isWide ? 17 : 16}px Inter, sans-serif`
        ctx.fillText(lang === 'ro' ? 'Știri din inima Transilvaniei' : 'News from the heart of Transylvania', cx, cyc + big * 1.02)
        // domain glass pill
        ctx.font = `700 ${isWide ? 15 : 14}px Inter, sans-serif`
        const dom = 'TRANSILVANIATIMES.COM'
        const domW = ctx.measureText(dom).width + 48, pillY = cyc + big * 1.35
        glass(cx - domW / 2, pillY, domW, 36, 18)
        ctx.fillStyle = P.cream; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        spaced(dom, `700 ${isWide ? 15 : 14}px Inter, sans-serif`, cx, pillY + 18, 1.5)
        ctx.restore()

        ctx.globalAlpha = e; ctx.fillStyle = 'rgba(251,244,228,0.5)'
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `600 ${isWide ? 12 : 11}px Inter, sans-serif`
        ctx.fillText(lang === 'ro' ? 'Buletin realizat cu asistență AI' : 'Bulletin produced with AI assistance', cx, H - 40)
        ctx.globalAlpha = 1; ctx.textAlign = 'left'
      }

      rec.start(200)
      await ac.resume().catch(() => {})   // ensure the clock runs during the (silent-video) intro
      scheduleIntroSting(ac.currentTime + 0.1)
      const t0 = performance.now()
      let started = false
      await new Promise<void>(resolve => {
        const loop = () => {
          const t = (performance.now() - t0) / 1000
          setCompPct(Math.min(99, Math.round((t / total) * 100)))
          if (t < INTRO) drawIntro(t)
          else if (t < INTRO + dur) {
            if (!started) { started = true; ac.resume(); v.play().catch(() => {}) }
            drawContent(t)
          } else { v.pause(); drawOutro(t) }
          if (t >= total) { resolve(); return }
          requestAnimationFrame(loop)
        }
        loop()
      })
      rec.stop()
      const blob = await done
      ac.close()
      setBulletinMime(mime); setBulletinUrl(URL.createObjectURL(blob)); setCompPct(100)

      // Persist: upload + archive row (best-effort).
      try {
        const ext = mime.includes('mp4') ? 'mp4' : 'webm'
        const path = `newsroom/bulletin-${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, blob, { contentType: mime, upsert: false })
        const publicUrl = upErr ? '' : supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
        if (publicUrl) setBulletinPublicUrl(publicUrl)
        const { data: row } = await db.from('newsroom_bulletins').insert({
          language: lang, script, sections,
          story_titles: posts.filter(p => sel.has(p.id)).map(p => (lang === 'ro' ? p.title_ro : p.title_en) || ''),
          anchor_video_url: videoUrl, bulletin_video_url: publicUrl || null, voice_url: voUrl, status: 'rendered',
        }).select('id').single()
        if (row?.id) setSavedId(String(row.id))
      } catch { /* archive optional */ }
    } catch (e) {
      setError('Compunerea a eșuat: ' + (e as Error).message)
    } finally { setCompositing(false) }
  }

  // ── Publishing pack ──────────────────────────────────────────────────────
  async function genCaptions() {
    const titles = posts.filter(p => sel.has(p.id)).map(p => (lang === 'ro' ? p.title_ro : p.title_en) || '').filter(Boolean)
    if (!titles.length) { setError('Selectează știrile mai întâi.'); return }
    setError(''); setBusy('captions')
    try {
      const r = await invokeRaw('newsroom-anchor', { action: 'captions', language: lang, titles })
      if (r.error) throw new Error(String(r.error))
      setPack((r.captions as CaptionPack) || null)
      setPackLinks((r.links as Record<string, string>) || {})
      if (savedId) { try { await db.from('newsroom_bulletins').update({ captions: r.captions }).eq('id', savedId) } catch { /* ok */ } }
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  function downloadSrt() {
    if (!cues.length) { setError('Nu există subtitrări încă — compune buletinul cu subtitrări active.'); return }
    const pad = (n: number, l = 2) => String(n).padStart(l, '0')
    const st = (t: number) => `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(Math.floor(t % 60))},${pad(Math.floor((t % 1) * 1000), 3)}`
    const srt = cues.map((c, i) => `${i + 1}\n${st(c.start + INTRO)} --> ${st(c.end + INTRO)}\n${c.text.trim()}`).join('\n\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([srt], { type: 'text/plain' }))
    a.download = 'buletin.srt'; a.click(); URL.revokeObjectURL(a.href)
  }

  // Grab a poster frame from a video URL (CORS-safe). Returns null on any failure.
  async function grabVideoFrame(srcUrl: string): Promise<HTMLVideoElement | null> {
    try {
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = srcUrl
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('load')); setTimeout(() => rej(new Error('timeout')), 8000) })
      v.currentTime = Math.min(1.4, (v.duration || 3) / 2)
      await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 2000) })
      return v
    } catch { return null }
  }
  function loadImage(srcUrl: string): Promise<HTMLImageElement | null> {
    return new Promise((res) => {
      const img = new Image(); img.crossOrigin = 'anonymous'
      img.onload = () => res(img); img.onerror = () => res(null); img.src = srcUrl
    })
  }
  function coverImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
    const vr = (img.naturalWidth || 1) / (img.naturalHeight || 1), cr = w / h
    let dw: number, dh: number
    if (vr > cr) { dh = h; dw = h * vr } else { dw = w; dh = w / vr }
    ctx.save(); rr(ctx, x, y, w, h, 14); ctx.clip()
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore()
  }

  // Thumbnail: always produces a PNG. Uses the best media available (composed
  // bulletin → raw anchor clip → portrait) and falls back to a clean branded
  // card if no media (or if the canvas would be tainted).
  async function makeThumbnail() {
    setError(''); setBusy('thumb')
    try {
      const W = 1280, H = 720
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H
      const ctx = cv.getContext('2d')!
      const headline = sections?.stories?.[0]?.lower_third
        || posts.filter(p => sel.has(p.id)).map(p => (lang === 'ro' ? p.title_ro : p.title_en) || p.title_ro)[0]
        || (lang === 'ro' ? 'Buletinul zilei' : 'Daily bulletin')

      // Try to obtain a media element (video frame or image), CORS-safe.
      let media: HTMLVideoElement | HTMLImageElement | null = null
      const vidSrc = bulletinUrl || bulletinPublicUrl || videoUrl
      if (vidSrc) media = await grabVideoFrame(vidSrc)
      if (!media && anchorImg) media = await loadImage(anchorImg)

      const paint = (withMedia: boolean) => {
        ctx.fillStyle = C.parchment; ctx.fillRect(0, 0, W, H)
        let drew = false
        if (withMedia && media) {
          try {
            if (media instanceof HTMLVideoElement) drawCoverInto(ctx, media, W * 0.52, 64, W * 0.44, H - 128)
            else coverImage(ctx, media, W * 0.52, 64, W * 0.44, H - 128)
            drew = true
          } catch { drew = false }
        }
        const colW = drew ? W * 0.44 : W * 0.82
        ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, 58)
        ctx.fillStyle = C.crimson; ctx.font = 'italic 700 28px Lora, Georgia, serif'; ctx.textBaseline = 'middle'
        ctx.fillText('Transilvania Times', 44, 29)
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = C.crimson; ctx.font = '800 15px Inter, sans-serif'
        ctx.fillText(lang === 'ro' ? 'BULETINUL ZILEI' : 'DAILY BULLETIN', 44, 130)
        ctx.fillStyle = C.ink; ctx.font = `600 ${drew ? 52 : 64}px Lora, Georgia, serif`
        let y = 196
        for (const ln of wrapText(ctx, headline, colW).slice(0, 4)) { ctx.fillText(ln, 44, y); y += drew ? 62 : 76 }
        ctx.fillStyle = C.crimson; ctx.fillRect(44, y - 34, 96, 5)
        ctx.fillStyle = C.sepia; ctx.font = '600 17px Inter, sans-serif'
        ctx.fillText('transilvaniatimes.com', 44, H - 52)
        return drew
      }

      const exportPng = async (): Promise<Blob> => {
        const b: Blob | null = await new Promise(res => cv.toBlob(res, 'image/png'))
        if (b) return b
        // toBlob can return null; try data URL, which also throws if tainted.
        const dataUrl = cv.toDataURL('image/png')
        const bin = atob(dataUrl.split(',')[1]); const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        return new Blob([arr], { type: 'image/png' })
      }

      paint(true)
      let blob: Blob
      try { blob = await exportPng() }
      catch { paint(false); blob = await exportPng() } // media tainted → clean branded card

      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = 'buletin-thumbnail.png'; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    } catch (e) { setError('Thumbnail: ' + (e as Error).message) } finally { setBusy('') }
  }

  const copy = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}) }

  // ── Direct publishing (publish-social) ──────────────────────────────────
  function publishVideoUrl(): string { return bulletinPublicUrl || videoUrl }
  async function publishTo(platform: 'facebook' | 'instagram' | 'youtube') {
    const video = publishVideoUrl()
    if (!video) { setError('Compune sau generează întâi un video.'); return }
    if (bulletinPublicUrl && bulletinMime && !bulletinMime.includes('mp4')) {
      setPubMsg(m => ({ ...m, [platform]: 'Buletinul e WebM — platformele cer MP4. Folosește Chrome pentru compunere.' })); return
    }
    const titles = posts.filter(p => sel.has(p.id)).map(p => (lang === 'ro' ? p.title_ro : p.title_en) || '').filter(Boolean)
    const tags = (pack?.hashtags || []).map(h => h.replace(/^#/, ''))
    setError(''); setPubBusy(platform); setPubMsg(m => ({ ...m, [platform]: '' }))
    try {
      if (platform === 'facebook') {
        const description = (pack?.facebook || titles.join(' · ')) + (packLinks.facebook ? `\n\n${packLinks.facebook}` : '')
        const r = await invokeRaw('publish-social', { action: 'facebook', video_url: video, description })
        if (r.error) throw new Error(String(r.error))
        setPubMsg(m => ({ ...m, facebook: '✓ Postat pe pagina de Facebook.' }))
      } else if (platform === 'instagram') {
        const caption = (pack?.instagram || titles.join(' · ')) + (pack?.hashtags?.length ? `\n\n${pack.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ')}` : '')
        const r = await invokeRaw('publish-social', { action: 'instagram', video_url: video, caption })
        if (r.error) throw new Error(String(r.error))
        const creationId = String(r.creation_id || '')
        setPubMsg(m => ({ ...m, instagram: 'Instagram procesează clipul…' }))
        for (let i = 0; i < 40; i++) {
          await sleep(4000)
          const st = await invokeRaw('publish-social', { action: 'instagram_status', creation_id: creationId })
          const code = String(st.status_code || '')
          if (code === 'FINISHED') break
          if (code === 'ERROR') throw new Error('Instagram a respins clipul: ' + String(st.status || ''))
          if (i === 39) throw new Error('Instagram procesează prea mult — reîncearcă publicarea.')
        }
        const pr = await invokeRaw('publish-social', { action: 'instagram_publish', creation_id: creationId })
        if (pr.error) throw new Error(String(pr.error))
        setPubMsg(m => ({ ...m, instagram: '✓ Publicat ca Reel pe Instagram.' }))
      } else {
        const r = await invokeRaw('publish-social', {
          action: 'youtube', video_url: video,
          title: pack?.youtube_title || `Buletinul zilei — Transilvania Times`,
          description: (pack?.youtube_description || titles.join('\n')) + (packLinks.youtube ? `\n\n${packLinks.youtube}` : ''),
          tags, privacy: 'public', language: lang,
        })
        if (r.error) throw new Error(String(r.error))
        setPubMsg(m => ({ ...m, youtube: `✓ Urcat pe YouTube${r.url ? `: ${r.url}` : ''}` }))
      }
    } catch (e) {
      setPubMsg(m => ({ ...m, [platform]: '✗ ' + (e as Error).message }))
    } finally { setPubBusy('') }
  }

  const stepDone = {
    1: sel.size > 0, 2: !!script.trim(), 3: !!voUrl,
    4: hgConfigured ? (mode === 'avatar' ? !!avatarId : !!photoId) : !!anchorImg,
  }
  const working = ['se trimite', 'pending', 'waiting', 'processing'].includes(videoStatus)

  const Step = ({ n, icon: Icon, title, done, children }: { n: number; icon: typeof Tv; title: string; done: boolean; children: React.ReactNode }) => (
    <div className="bg-[#1a1a1a] border border-white/[0.07]">
      <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center gap-3">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${done ? 'bg-green-500/20 text-green-400' : 'bg-brand-red text-white'}`}>
          {done ? <CheckCircle2 className="w-4 h-4" /> : n}
        </span>
        <Icon className="w-4 h-4 text-white/50" />
        <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-white flex items-center gap-2">
          <Tv className="w-5 h-5 text-brand-red" /> Newsroom
        </h1>
        <p className="font-sans text-[13px] text-white/40 mt-1">
          Buletinul zilei cu prezentator AI — știri → script → voce naturală → lipsync → MP4
        </p>
      </div>

      {hgConfigured === false && !falConfigured && (
        <div className="mb-5 flex items-start gap-2 text-[12.5px] text-amber-300/90 bg-amber-400/10 border border-amber-400/20 p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Pașii 1–3 funcționează (script + voce). Pentru videoul cu prezentator, adaugă <b>FAL_KEY</b> (credite preplătite, fără abonament — motorul liber SadTalker) sau <b>HEYGEN_API_KEY</b> (premium) în secretele funcției newsroom-anchor.</span>
        </div>
      )}
      {hgConfigured === false && falConfigured && (
        <div className="mb-5 flex items-start gap-2 text-[12.5px] text-sky-300/90 bg-sky-400/10 border border-sky-400/20 p-3">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Motor activ: <b>stack liber</b> — voce Gemini (gratuit) + lipsync SadTalker prin fal (bani doar per video, câțiva cenți; fără abonament).</span>
        </div>
      )}
      {error && (
        <div className="mb-5 flex items-start gap-2 text-[12.5px] text-red-400 bg-red-400/10 border border-red-400/20 p-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
        </div>
      )}

      <div className="space-y-5 max-w-3xl">
        <Step n={1} icon={Newspaper} title="Știrile zilei" done={stepDone[1]}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <select value={lang} onChange={e => setLang(e.target.value as 'ro' | 'en')} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
              <option value="ro">Română</option><option value="en">English</option>
            </select>
            <select value={target} onChange={e => setTarget(Number(e.target.value))} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
              <option value={45}>~45s</option><option value={75}>~75s</option><option value={110}>~110s</option>
            </select>
            <span className="text-[11px] text-white/40">{sel.size} selectate · ultimele 24h</span>
          </div>
          {posts.length === 0 && <p className="text-[13px] text-white/30">Nicio știre publicată în ultimele 24h.</p>}
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {posts.map(p => (
              <label key={p.id} className="flex items-start gap-2.5 text-[13px] text-white/80 cursor-pointer bg-[#111] border border-white/[0.05] px-3 py-2 hover:border-white/20">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} className="mt-1" />
                <span className="leading-snug">{(lang === 'ro' ? p.title_ro : p.title_en) || p.title_ro || p.title_en}
                  <span className="block text-[10.5px] text-white/30 uppercase mt-0.5">{p.category}</span></span>
              </label>
            ))}
          </div>
        </Step>

        <Step n={2} icon={FileText} title="Scriptul prezentatorului" done={stepDone[2]}>
          <button onClick={genScript} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50 mb-3">
            {busy === 'script' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Scrie scriptul din știrile selectate
          </button>
          <textarea value={script} onChange={e => setScript(e.target.value)} rows={8} placeholder="Scriptul apare aici — editează-l liber înainte de voce…"
            className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[13px] p-3 resize-y focus:outline-none focus:border-brand-red/60" />
          {scriptModel && <p className="text-[10.5px] text-white/30 mt-1.5">scris de {scriptModel} · editabil integral</p>}
        </Step>

        <Step n={3} icon={Mic} title="Vocea" done={stepDone[3]}>
          <div className="flex items-center gap-2 flex-wrap">
            {elConfigured ? (
              <>
                <select value={voiceId} onChange={e => setVoiceId(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 max-w-[180px]">
                  {elVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.category === 'cloned' ? '👤 ' : ''}{v.name}</option>)}
                </select>
                <select value={tone} onChange={e => setTone(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                  {TONES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </>
            ) : (
              <>
                <select value={geminiVoice} onChange={e => setGeminiVoice(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                  {[
                    { v: 'Charon', l: '♂ Charon · grav, autoritar' },
                    { v: 'Orus',   l: '♂ Orus · cald, echilibrat' },
                    { v: 'Fenrir', l: '♂ Fenrir · puternic' },
                    { v: 'Puck',   l: '♂ Puck · tânăr, energic' },
                    { v: 'Kore',   l: '♀ Kore · clară, profesională' },
                    { v: 'Leda',   l: '♀ Leda · caldă' },
                    { v: 'Zephyr', l: '♀ Zephyr · luminoasă' },
                    { v: 'Aoede',  l: '♀ Aoede · expresivă' },
                  ].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <select value={tone} onChange={e => setTone(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                  {TONES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
                <span className="text-[10.5px] text-sky-300/70">Gemini · natural · gratuit</span>
              </>
            )}
            <button onClick={genVoice} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {busy === 'voice' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />} Generează vocea
            </button>
          </div>
          {voUrl && <audio src={voUrl} controls className="w-full mt-3 h-9" />}
        </Step>

        <Step n={4} icon={User} title="Prezentatorul" done={stepDone[4]}>
          {!hgConfigured && falConfigured && (
            <div className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => genAnchorPortrait('f')} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
                  {busy === 'portrait' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează prezentatoare AI
                </button>
                <button onClick={() => genAnchorPortrait('m')} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
                  {busy === 'portrait' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează prezentator AI
                </button>
              </div>
              <div className="space-y-2 max-w-md border-t border-white/[0.07] pt-3">
                <label className="flex items-center gap-2 text-[11.5px] text-white/60 cursor-pointer">
                  <input type="checkbox" checked={anchorIsReal} onChange={e => setAnchorIsReal(e.target.checked)} />
                  Fotografia este a unei persoane reale (eu sau un editor)
                </label>
                {anchorIsReal && (
                  <>
                    <input value={photoPerson} onChange={e => setPhotoPerson(e.target.value)} placeholder="A cui este fața? (persoana reală)"
                      className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-3 py-2" />
                    <label className="flex items-start gap-2 text-[11.5px] text-white/60 cursor-pointer leading-snug">
                      <input type="checkbox" checked={photoConsent} onChange={e => setPhotoConsent(e.target.checked)} className="mt-0.5" />
                      <span><ShieldCheck className="w-3 h-3 inline mr-1" />Confirm <b>acordul explicit</b> al persoanei.</span>
                    </label>
                  </>
                )}
                <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-2 cursor-pointer hover:border-white/20 w-fit">
                  {busy === 'photo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Sau încarcă portret (frontal, gura închisă)
                  <input type="file" accept="image/*" hidden onChange={e => uploadPhoto(e.target.files?.[0])} />
                </label>
              </div>
              {anchorImg && (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={anchorImg} alt="Prezentator" className="w-24 h-24 object-cover border border-white/[0.07]" />
                  <p className="text-[11px] text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Portret pregătit — SadTalker îl va anima cu lipsync.</p>
                </div>
              )}
            </div>
          )}
          {hgConfigured && <>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setMode('avatar')} className={'px-3 py-1.5 text-[12px] border ' + (mode === 'avatar' ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>Prezentator AI (stoc)</button>
            <button onClick={() => setMode('photo')} className={'px-3 py-1.5 text-[12px] border ' + (mode === 'photo' ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>Fotografia mea / a unui editor</button>
          </div>
          {mode === 'avatar' && (
            avatars.length > 0 ? (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-56 overflow-y-auto pr-1">
                {avatars.map(a => (
                  <button key={a.avatar_id} onClick={() => setAvatarId(a.avatar_id)}
                    className={'border overflow-hidden ' + (avatarId === a.avatar_id ? 'border-brand-red' : 'border-white/[0.07] hover:border-white/30')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.preview_image_url} alt={a.avatar_name} className="w-full aspect-square object-cover" />
                    <span className="block text-[9.5px] text-white/50 px-1 py-0.5 truncate">{a.avatar_name}</span>
                  </button>
                ))}
              </div>
            ) : <p className="text-[12.5px] text-white/30">{hgConfigured ? 'Se încarcă prezentatorii…' : 'Configurează HeyGen ca să vezi prezentatorii.'}</p>
          )}
          {mode === 'photo' && (
            <div className="space-y-2 max-w-md">
              <input value={photoPerson} onChange={e => setPhotoPerson(e.target.value)} placeholder="A cui este fața? (persoana reală)"
                className="w-full bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-3 py-2" />
              <label className="flex items-start gap-2 text-[11.5px] text-white/60 cursor-pointer leading-snug">
                <input type="checkbox" checked={photoConsent} onChange={e => setPhotoConsent(e.target.checked)} className="mt-0.5" />
                <span><ShieldCheck className="w-3 h-3 inline mr-1" />Confirm că persoana și-a dat <b>acordul explicit</b> ca fața ei să prezinte buletinul. Fără acord, încărcarea este refuzată.</span>
              </label>
              <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-2 cursor-pointer hover:border-white/20 w-fit">
                {busy === 'photo' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Încarcă portret (frontal, lumină bună)
                <input type="file" accept="image/*" hidden onChange={e => uploadPhoto(e.target.files?.[0])} />
              </label>
              {photoId && <p className="text-[11px] text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Fotografie acceptată de HeyGen.</p>}
            </div>
          )}
          </>}

          {/* ── Newsroom media library ─────────────────────────────────── */}
          <div className="mt-5 border-t border-white/[0.07] pt-4 space-y-4">
            <p className="text-[11px] uppercase tracking-wider text-white/40 font-bold">Bibliotecă platou &amp; prezentatori</p>

            {!hgConfigured && (
              <div className="space-y-2">
                <p className="text-[12px] text-white/70 font-semibold">Prezentatori salvați</p>
                {libPresenters.length > 0 ? (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto pr-1">
                    {libPresenters.map(a => (
                      <div key={a.id} className="relative group">
                        <button onClick={() => pickPresenter(a)}
                          className={'border overflow-hidden w-full ' + (anchorImg === a.url ? 'border-brand-red' : 'border-white/[0.07] hover:border-white/30')}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.url} alt={a.name} className="w-full aspect-square object-cover" />
                          <span className="block text-[9.5px] text-white/50 px-1 py-0.5 truncate">{a.name}</span>
                        </button>
                        <button onClick={() => downloadAsset(a.url, a.name)} title="Descarcă"
                          className="absolute top-1 right-7 bg-black/70 text-white/80 hover:text-white text-[10px] w-5 h-5 rounded-full opacity-0 group-hover:opacity-100">⤓</button>
                        <button onClick={() => deleteLibraryAsset(a.id)} title="Șterge"
                          className="absolute top-1 right-1 bg-black/70 text-white/80 hover:text-white text-[10px] w-5 h-5 rounded-full opacity-0 group-hover:opacity-100">✕</button>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-[11.5px] text-white/30">Niciun prezentator salvat încă.</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <input value={libPresName} onChange={e => setLibPresName(e.target.value)} placeholder="Nume prezentator"
                    className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 w-44" />
                  <label className="flex items-center gap-1.5 text-[11px] text-white/55 cursor-pointer">
                    <input type="checkbox" checked={libPresReal} onChange={e => setLibPresReal(e.target.checked)} /> persoană reală
                  </label>
                  {libPresReal && (
                    <input value={libPresPerson} onChange={e => setLibPresPerson(e.target.value)} placeholder="Nume persoană (consimțământ)"
                      className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 w-52" />
                  )}
                  <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-1.5 cursor-pointer hover:border-white/20 w-fit">
                    {busy === 'lib' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Adaugă prezentator
                    <input type="file" accept="image/*" hidden onChange={e => { uploadLibraryAsset(e.target.files?.[0], 'presenter', libPresName, libPresReal, libPresPerson); e.currentTarget.value = '' }} />
                  </label>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={presenterGender} onChange={e => setPresenterGender(e.target.value as 'f' | 'm')} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                    <option value="f">♀ Prezentatoare</option>
                    <option value="m">♂ Prezentator</option>
                  </select>
                  <input value={presenterPrompt} onChange={e => setPresenterPrompt(e.target.value)} placeholder="Prompt opțional (ex: 40 ani, ochelari, costum bleumarin)"
                    className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 flex-1 min-w-[200px]" />
                  <button onClick={genPresenterFromPrompt} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-50">
                    {busy === 'genpres' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează prezentator (AI)
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-[12px] text-white/70 font-semibold">Platouri (fundal studio)</p>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto pr-1">
                <button onClick={() => setStudioBg('')}
                  className={'border flex items-center justify-center aspect-square text-[10px] text-white/50 px-1 text-center ' + (studioBg === '' ? 'border-brand-red' : 'border-white/[0.07] hover:border-white/30')}>
                  Fără platou
                </button>
                {libStudios.map(a => (
                  <div key={a.id} className="relative group">
                    <button onClick={() => setStudioBg(a.url)}
                      className={'border overflow-hidden w-full ' + (studioBg === a.url ? 'border-brand-red' : 'border-white/[0.07] hover:border-white/30')}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt={a.name} className="w-full aspect-square object-cover" />
                      <span className="block text-[9.5px] text-white/50 px-1 py-0.5 truncate">{a.name}</span>
                    </button>
                    <button onClick={() => downloadAsset(a.url, a.name)} title="Descarcă"
                      className="absolute top-1 right-7 bg-black/70 text-white/80 hover:text-white text-[10px] w-5 h-5 rounded-full opacity-0 group-hover:opacity-100">⤓</button>
                    <button onClick={() => deleteLibraryAsset(a.id)} title="Șterge"
                      className="absolute top-1 right-1 bg-black/70 text-white/80 hover:text-white text-[10px] w-5 h-5 rounded-full opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={libStudioName} onChange={e => setLibStudioName(e.target.value)} placeholder="Nume platou"
                  className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 w-44" />
                <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-1.5 cursor-pointer hover:border-white/20 w-fit">
                  {busy === 'lib' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Adaugă platou
                  <input type="file" accept="image/*" hidden onChange={e => { uploadLibraryAsset(e.target.files?.[0], 'studio', libStudioName); e.currentTarget.value = '' }} />
                </label>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={studioPrompt} onChange={e => setStudioPrompt(e.target.value)} placeholder="Prompt platou (ex: știri de seară, oraș noaptea, ecrane albastre, breaking news)"
                  className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 flex-1 min-w-[220px]" />
                <button onClick={genStudioFromPrompt} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-50">
                  {busy === 'genstudio' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează platou (AI)
                </button>
              </div>
              {studioBg && (
                <label className="flex items-start gap-2 text-[11.5px] text-white/60 cursor-pointer leading-snug max-w-md">
                  <input type="checkbox" checked={greenscreen} onChange={e => setGreenscreen(e.target.checked)} className="mt-0.5" />
                  <span>Prezentatorul este pe <b>fundal verde</b> — decupează verdele și îl pune peste platou. Dacă e debifat, platoul se vede doar dacă clipul prezentatorului e transparent.</span>
                </label>
              )}
            </div>
          </div>
        </Step>

        <Step n={5} icon={Film} title="Videoul" done={!!videoUrl}>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {(['16:9', '9:16'] as const).map(o => (
              <button key={o} onClick={() => setOrient(o)} className={'px-3 py-1.5 text-[12px] border ' + (orient === o ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>{o === '16:9' ? '16:9 · YouTube/FB' : '9:16 · Reels/TikTok'}</button>
            ))}
            <button onClick={genVideo} disabled={working || (hgConfigured === false && !falConfigured)} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {working ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {videoStatus}…</> : <><Film className="w-3.5 h-3.5" /> Generează buletinul</>}
            </button>
            {working && <button onClick={() => setVideoStatus('')} className="text-white/30 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>}
          </div>
          {working && <p className="text-[11px] text-white/40">{hgConfigured ? 'HeyGen' : 'SadTalker (fal)'} randează lipsync-ul — de obicei 1–4 minute. Poți lăsa pagina deschisă.</p>}
          {!hgConfigured && falConfigured && <p className="text-[10.5px] text-white/30 mb-2">Motorul liber livrează formatul portretului (pătrat/portret). 9:16/16:9 exacte sunt disponibile pe motorul premium.</p>}
          {videoUrl && (
            <div className="border border-white/[0.07] max-w-md">
              <video src={videoUrl} controls className="w-full" />
              <a href={videoUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 bg-[#111] text-white text-[12px] font-bold py-2.5 hover:bg-black">
                <Download className="w-3.5 h-3.5" /> Descarcă clipul brut
              </a>
            </div>
          )}
        </Step>

        {/* ── STEP 6 · BROADCAST ─────────────────────────────────────────── */}
        <Step n={6} icon={Clapperboard} title="Buletin TV — cadru brand-uit" done={!!bulletinUrl}>
          <p className="text-[12px] text-white/40 mb-3 leading-relaxed">
            Îmbracă clipul brut în formatul de emisie TT: intro brand-uit, fereastră de prezentator,
            burtiere pe fiecare știre, subtitrări arse (feed-urile rulează pe mut), ticker cu titlurile
            zilei și endcard cu CTA. Gratuit, în browser.
          </p>
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <label className="flex items-center gap-1.5 text-[12px] text-white/60 cursor-pointer">
              <input type="checkbox" checked={subsOn} onChange={e => setSubsOn(e.target.checked)} /> subtitrări arse
            </label>
            <select value={capMode} onChange={e => setCapMode(e.target.value as 'clasic' | 'karaoke')} disabled={!subsOn}
              className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 disabled:opacity-40">
              <option value="karaoke">karaoke · cuvânt cu cuvânt</option>
              <option value="clasic">clasic · pe replici</option>
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-white/60 cursor-pointer">
              <input type="checkbox" checked={tickerOn} onChange={e => setTickerOn(e.target.checked)} /> ticker cu titluri
            </label>
            <button onClick={composeBulletin} disabled={compositing || !videoUrl} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {compositing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Compun… {compPct}%</> : <><Clapperboard className="w-3.5 h-3.5" /> Compune buletinul TV</>}
            </button>
          </div>
          {compositing && <p className="text-[11px] text-white/40">Randare în timp real (~durata clipului + 6s). Ține fila deschisă și în prim-plan.</p>}
          <canvas ref={canvasRef} className="w-full max-w-md bg-black border border-white/[0.07]" style={{ display: compositing || bulletinUrl ? 'block' : 'none' }} />
          {bulletinUrl && (
            <div className="border border-white/[0.07] max-w-md mt-3">
              <video src={bulletinUrl} controls className="w-full" />
              <a href={bulletinUrl} download={`buletin-tt.${bulletinMime.includes('mp4') ? 'mp4' : 'webm'}`}
                className="flex items-center justify-center gap-1.5 bg-[#111] text-white text-[12px] font-bold py-2.5 hover:bg-black">
                <Download className="w-3.5 h-3.5" /> Descarcă buletinul {bulletinMime.includes('mp4') ? 'MP4' : 'WebM'}
              </a>
            </div>
          )}
        </Step>

        {/* ── STEP 7 · PUBLISHING PACK ───────────────────────────────────── */}
        <Step n={7} icon={Share2} title="Pachet de publicare" done={!!pack}>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button onClick={genCaptions} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {busy === 'captions' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Scrie caption-urile
            </button>
            <button onClick={makeThumbnail} disabled={!!busy || (!videoUrl && !bulletinUrl && !anchorImg && sel.size === 0)} className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/80 text-[12px] font-bold px-3 py-2 hover:border-brand-red/60 disabled:opacity-40">
              {busy === 'thumb' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />} Thumbnail PNG
            </button>
            <button onClick={downloadSrt} disabled={!cues.length} className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/80 text-[12px] font-bold px-3 py-2 hover:border-brand-red/60 disabled:opacity-40">
              <Download className="w-3.5 h-3.5" /> Subtitrări SRT
            </button>
          </div>
          {pack && (
            <div className="space-y-2">
              {([['Facebook', pack.facebook, packLinks.facebook], ['Instagram', pack.instagram, packLinks.instagram], ['TikTok', pack.tiktok, packLinks.tiktok], ['YouTube · titlu', pack.youtube_title, ''], ['YouTube · descriere', pack.youtube_description, packLinks.youtube]] as const).map(([label, text, link]) => text ? (
                <div key={label} className="bg-[#111] border border-white/[0.07] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10.5px] font-bold uppercase tracking-widest text-brand-red">{label}</span>
                    <button onClick={() => copy(String(text) + (link ? `\n${link}` : ''))} className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white"><Copy className="w-3 h-3" /> copiază</button>
                  </div>
                  <p className="text-[12.5px] text-white/85 whitespace-pre-wrap leading-relaxed">{text}{link ? <span className="block text-sky-300/80 mt-1">{link}</span> : null}</p>
                </div>
              ) : null)}
              {pack.hashtags?.length ? (
                <div className="bg-[#111] border border-white/[0.07] p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10.5px] font-bold uppercase tracking-widest text-brand-red">Hashtags</span>
                    <button onClick={() => copy((pack.hashtags || []).map(h => h.startsWith('#') ? h : '#' + h).join(' '))} className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white"><Copy className="w-3 h-3" /> copiază</button>
                  </div>
                  <p className="text-[12.5px] text-sky-300/80">{(pack.hashtags || []).map(h => h.startsWith('#') ? h : '#' + h).join(' ')}</p>
                </div>
              ) : null}
            </div>
          )}

          {/* Direct publishing */}
          <div className="mt-4 pt-4 border-t border-white/[0.07]">
            <p className="text-[10.5px] font-bold uppercase tracking-widest text-white/40 mb-2">Publicare directă {publishVideoUrl() ? '' : '· generează întâi videoul'}</p>
            <div className="flex items-center gap-2 flex-wrap">
              {([['facebook', 'Facebook · pagină'], ['instagram', 'Instagram · Reel'], ['youtube', 'YouTube']] as const).map(([k, label]) => (
                <button key={k} onClick={() => publishTo(k)}
                  disabled={!!pubBusy || !pub[k] || !publishVideoUrl()}
                  title={pub[k] ? '' : 'Neconfigurat — vezi README pentru chei'}
                  className={'flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 border disabled:opacity-40 ' + (pub[k] ? 'bg-brand-red text-white border-brand-red hover:bg-red-700' : 'bg-[#111] text-white/40 border-white/[0.07]')}>
                  {pubBusy === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />} {label}{!pub[k] && ' · neconfigurat'}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-white/30 mt-2">Publică {bulletinPublicUrl ? 'buletinul TV compus' : 'clipul brut (compune buletinul pentru versiunea brand-uită)'}. Caption-urile generate mai sus se atașează automat.</p>
            {(['facebook', 'instagram', 'youtube'] as const).map(k => pubMsg[k] ? (
              <p key={k} className={'text-[11.5px] mt-1.5 break-words ' + (pubMsg[k].startsWith('✓') ? 'text-green-400' : pubMsg[k].startsWith('✗') ? 'text-red-400' : 'text-white/50')}>{pubMsg[k]}</p>
            ) : null)}
          </div>
        </Step>

        {/* ── ARCHIVE ────────────────────────────────────────────────────── */}
        {past.length > 0 && (
          <div className="bg-[#1a1a1a] border border-white/[0.07]">
            <div className="px-5 py-3.5 border-b border-white/[0.07] flex items-center gap-3">
              <Archive className="w-4 h-4 text-white/50" />
              <h2 className="font-sans text-[13px] font-bold text-white uppercase tracking-widest">Buletine anterioare</h2>
            </div>
            <div className="divide-y divide-white/[0.05]">
              {past.map(b => (
                <div key={b.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] text-white/80">{new Date(b.created_at).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                    <p className="text-[11px] text-white/35 truncate">{(b.story_titles || []).slice(0, 3).join(' · ')}</p>
                  </div>
                  {(b.bulletin_video_url || b.anchor_video_url) && (
                    <a href={b.bulletin_video_url || b.anchor_video_url || '#'} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-brand-red hover:underline shrink-0">Deschide →</a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
