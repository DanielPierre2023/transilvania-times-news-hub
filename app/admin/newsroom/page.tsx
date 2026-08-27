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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Tv, Newspaper, FileText, Mic, User, Film, Loader2, Wand2, Upload,
  ShieldCheck, Download, AlertCircle, CheckCircle2, RefreshCw,
  Clapperboard, Share2, Copy, Image as ImageIcon, Archive,
} from 'lucide-react'

interface Post { id: string; title_ro: string | null; title_en: string | null; summary_ro: string | null; summary_en: string | null; published_at: string | null; category: string | null; cover_image: string | null }
interface ElVoice { voice_id: string; name: string; category: string; provider?: 'elevenlabs' | 'minimax' }
interface LibAsset { id: string; kind: 'presenter' | 'presenter_video' | 'studio'; name: string; url: string; is_real_person?: boolean; person_name?: string | null }
interface Avatar { avatar_id: string; avatar_name: string; preview_image_url: string }
interface Story { lower_third: string; text: string }
interface Sections { greeting: string; stories: Story[]; signoff: string }
interface Cue { start: number; end: number; text: string }
interface Word { word: string; start: number; end: number }
interface CaptionPack { facebook?: string; instagram?: string; tiktok?: string; youtube_title?: string; youtube_description?: string; hashtags?: string[] }
interface PastBulletin { id: string; created_at: string; story_titles: string[] | null; bulletin_video_url: string | null; anchor_video_url: string | null }

// Strip diacritics/punctuation for fuzzy cue↔story matching.
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

// ── Brand pronunciation: spoken vs written ──────────────────────────────────
// Romanian TTS engines read "Times" the Romanian way ("ti-mes"). The text SENT
// TO THE ENGINE gets a phonetic respelling of the English pronunciation; the
// script on screen, the captions, the lower-thirds and the SRT keep the
// correct spelling. Order matters: the domain is rewritten before the bare
// brand name so ".com" is spoken as "punct com".
const spokenText = (t: string) => t
  .replace(/transilvaniatimes\s*\.\s*com/gi, 'Transilvania Taims punct com')
  .replace(/transilvaniatimes/gi, 'Transilvania Taims')
  .replace(/transilvania\s+times/gi, 'Transilvania Taims')
// Whisper hears "Taims" in the audio and may transcribe it phonetically — the
// captions must show the correct spelling again.
const fixSpelling = (s: string) => s.replace(/\b(taims|tajms|taimz|thaims)\b/gi, 'Times')

const TONES = [
  { v: 'stiri', label: 'Știri · autoritar' },
  { v: 'calm', label: 'Calm · documentar' },
  { v: 'energic', label: 'Energic' },
]

// Hoisted to module scope — defining this inside the page component recreated it
// on every keystroke, remounting all children and making inputs lose focus.
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
  // ElevenLabs voice NAME or ID for the fal-hosted multilingual engine. Set this
  // to a Romanian voice (ElevenLabs Voice Library → filter Romanian, or your own
  // clone) — it is the only way to get speech without an English accent.
  // Ioana — the station's Romanian anchor voice (ElevenLabs, user's account).
  // A 20-char ID routes through the DIRECT ElevenLabs API, which needs
  // ELEVENLABS_API_KEY in the newsroom secrets. Overridable in Pas 3.
  const [elVoice, setElVoice] = useState('znn3xedzq0kO6JXbSRB6')
  const [voiceDiag, setVoiceDiag] = useState('')
  const [voiceUsed, setVoiceUsed] = useState('')
  // Lipsync cost tier: economic $0.70/min · bun $3 · pro ~$5 · premium $8
  const [quality, setQuality] = useState<'economic' | 'veed' | 'standard' | 'bun' | 'pro' | 'premium'>('economic')
  const [tone, setTone] = useState('stiri')
  // Pause between news items, in ms. TTS engines ignore blank lines, so without
  // this the anchor runs one story straight into the next. 700ms ≈ a real
  // newsreader's beat before the next item.
  const [pauseMs, setPauseMs] = useState(700)
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
  const [libVideos, setLibVideos] = useState<LibAsset[]>([])
  const [anchorVideo, setAnchorVideo] = useState('')  // presenter VIDEO clip -> pro lipsync
  const [libVideoName, setLibVideoName] = useState('')
  const [libError, setLibError] = useState('')
  const [monitorSide, setMonitorSide] = useState<'left' | 'right' | 'off' | 'green'>('right')
  // Directed presenter track: when the voiceover outlasts the presenter clip,
  // re-edit the clip to the voice length (cuts at story boundaries, alternating
  // punch-in) BEFORE lipsync — so the engine never loops the footage and the
  // anchor's gestures never visibly repeat.
  const [trackMode, setTrackMode] = useState(true)
  // Filmed outro (the anchor stands and leaves) appended after the signoff.
  const [outroVideo, setOutroVideo] = useState('')
  // Presenter placement over a studio (greenscreen mode): scale, position and a
  // "desk line" — the studio strip below it is re-drawn IN FRONT of the presenter,
  // so a bust sits naturally BEHIND the studio's desk instead of floating on it.
  const [presScale, setPresScale] = useState(0.85)
  const [presX, setPresX] = useState(0.5)
  const [presY, setPresY] = useState(0.06)
  const [deskLine, setDeskLine] = useState(0.74)
  const placementPreviewRef = useRef<HTMLCanvasElement>(null)
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
  const [bedOn, setBedOn] = useState(true)          // news bed under the voice
  const [bedLevel, setBedLevel] = useState(0.6)     // 0.35 discret · 0.6 normal · 0.9 prezent
  const [bulletinPublicUrl, setBulletinPublicUrl] = useState('')
  const [pub, setPub] = useState<{ facebook: boolean; instagram: boolean; youtube: boolean }>({ facebook: false, instagram: false, youtube: false })
  const [pubBusy, setPubBusy] = useState('')
  const [pubMsg, setPubMsg] = useState<Record<string, string>>({})
  const [compositing, setCompositing] = useState(false)
  const [compPct, setCompPct] = useState(0)
  const [compStage, setCompStage] = useState('')
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
      let msg = detail || e.message
      if (/TOP_UP|User is locked/i.test(msg)) {
        msg = 'Creditele fal.ai s-au terminat (cont blocat: TOP_UP). Deschide fal.ai → Billing → Add credits (preplătit, fără abonament; 10–20 $ ajung săptămâni), apoi apasă din nou butonul.'
      }
      throw new Error(`${fn}: ${msg}`)
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
        .select('id, title_ro, title_en, summary_ro, summary_en, published_at, category, cover_image')
        .eq('status', 'published')
        .gte('published_at', since)
        .order('published_at', { ascending: false })
        .limit(20)
      setPosts((data ?? []) as Post[])
      setSel(new Set(((data ?? []) as Post[]).slice(0, 5).map(p => p.id)))
      await loadElVoices()
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
    setLibVideos(rows.filter(r => r.kind === 'presenter_video'))
    setLibStudios(rows.filter(r => r.kind === 'studio'))
  }
  async function uploadLibraryAsset(file: File | undefined, kind: 'presenter' | 'presenter_video' | 'studio', name: string, isReal = false, personName = '') {
    if (!file) return
    if (!name.trim()) {
      // The global error banner renders ~250 lines above this control, so on a
      // scrolled page it is off-screen and the click looks like it did nothing.
      // Surface it where the user is actually looking, and scroll the banner in.
      setError('Dă un nume asset-ului din bibliotecă.')
      setLibError('Completează întâi câmpul de nume, apoi alege fișierul.')
      return
    }
    if (kind === 'presenter' && isReal && !personName.trim()) { setError('Pentru o persoană reală, completează numele și bifează consimțământul.'); return }
    setError(''); setLibError(''); setBusy('lib')
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
  async function saveGeneratedToLibrary(url: string, kind: 'presenter' | 'presenter_video' | 'studio', name: string) {
    try { await db.from('newsroom_assets').insert({ kind, name, url, is_real_person: false, person_name: null }); await refreshLibrary() } catch { /* table missing — still usable this session */ }
  }
  // Portrait -> idle presenter CLIP via Kling image-to-video (generate-motion).
  // The clip (breathing, blinks, mouth closed) becomes a first-class lipsync
  // source for the sync.so engine — the pro path, fully in-app.
  async function genPresenterClip() {
    if (!anchorImg) { setError('Alege sau generează întâi un portret de prezentator.'); return }
    setError(''); setBusy('genclip')
    try {
      const prompt = 'A professional news anchor at the desk, subtle natural idle motion only: gentle breathing, slight head movements, occasional blink, hands calmly resting, mouth stays CLOSED, no talking, no gestures toward the face. Locked-off camera, no zoom, no pan. Preserve the person, framing, lighting and background exactly. Seamless loop feel.'
      const r = await invokeRaw('generate-motion', { action: 'create', image_url: anchorImg, prompt, duration: '10' })
      if (r.error) throw new Error(String(r.error))
      const statusUrl = String(r.status_url || ''), responseUrl = String(r.response_url || '')
      for (let i = 0; i < 120; i++) {
        await sleep(5000)
        const st = await invokeRaw('generate-motion', { action: 'poll', status_url: statusUrl, response_url: responseUrl })
        if (st.error) throw new Error(String(st.error))
        if (String(st.status) === 'COMPLETED' && st.publicUrl) {
          const url = String(st.publicUrl)
          await saveGeneratedToLibrary(url, 'presenter_video', 'Clip AI — prezentator')
          setAnchorVideo(url)
          return
        }
      }
      throw new Error('Kling nu a terminat în 10 minute — reîncearcă.')
    } catch (e) { setError('Clip prezentator: ' + (e as Error).message) } finally { setBusy('') }
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

  async function genScript(): Promise<string | null> {
    const chosen = posts.filter(p => sel.has(p.id))
    if (chosen.length === 0) { setError('Selectează cel puțin o știre.'); return null }
    setError(''); setBusy('script')
    try {
      const articles = chosen.map(p => ({
        title: (lang === 'ro' ? p.title_ro : p.title_en) || p.title_ro || p.title_en || '',
        summary: (lang === 'ro' ? p.summary_ro : p.summary_en) || '',
      }))
      const r = await invokeRaw('newsroom-anchor', { action: 'script', language: lang, target_seconds: target, edition: edition || undefined, articles })
      if (r.error) throw new Error(String(r.error))
      const text = String(r.script || '')
      setScript(text); setScriptModel(String(r.model || ''))
      setSections((r.sections as Sections | null) || null)
      // The function reports how many of the selected stories actually made it
      // into the script. A shortfall used to be invisible — you only found out
      // by reading the finished bulletin.
      const note = String(r.coverage_note || r.note || '')
      if (note) setError(note)
      return text || null
    } catch (e) { setError((e as Error).message); return null } finally { setBusy('') }
  }

  // Loads the ElevenLabs voices from YOUR account. Kept separate so the UI can
  // re-run it after you add a voice in ElevenLabs, without reloading the page.
  async function loadElVoices() {
    setVoiceDiag('se încarcă…')
    try {
      const v = await invokeRaw('voice-lab', { action: 'list' })
      if (v.configured === true && Array.isArray(v.voices)) {
        const list = v.voices as ElVoice[]
        setElConfigured(true); setElVoices(list)
        if (list.length && !voiceId) setVoiceId(list[0].voice_id)
        setVoiceDiag(`${list.length} voci din contul tău ElevenLabs`)
      } else {
        setElConfigured(false); setElVoices([])
        // voice-lab returns a precise reason (wrong key format, revoked key,
        // rate limit). Never overwrite it with a guess.
        const reason = String(v.error || v.message || '').trim()
        setVoiceDiag(reason || 'ELEVENLABS_API_KEY lipsește din secretele Supabase — de aceea vezi doar voci englezești.')
      }
    } catch (e) {
      setElConfigured(false)
      setVoiceDiag('nu am putut citi vocile: ' + (e as Error).message)
    }
  }

  async function genVoice(scriptParam?: string): Promise<string | null> {
    const written = (scriptParam ?? script).trim()
    if (!written) { setError('Generează sau scrie scriptul mai întâi.'); return null }
    // The engine speaks the phonetic form of the brand ("Taims"); everything
    // shown on screen keeps the correct English spelling.
    const text = spokenText(written)
    setError(''); setBusy('voice')
    try {
      // Voice routing. The ACCENT problem: Gemini's voices (Aoede/Zephyr/…) are
      // English-first and read Romanian with a heavy English accent, and fal's
      // ElevenLabs default ("Sarah"/"George") is an English-recorded voice — same
      // result. Romanian only sounds native when the VOICE ITSELF is Romanian,
      // so elVoice is passed explicitly and the multilingual engine is forced.
      // An ElevenLabs voice ID (20 alphanumerics) belongs to YOUR ElevenLabs
      // account, so it only resolves through the DIRECT ElevenLabs API — fal's
      // hosted endpoint runs on fal's own account and only knows its premade
      // NAMED voices. Route accordingly; an explicit override always wins.
      const ev = elVoice.trim()
      const isVoiceId = /^[A-Za-z0-9]{20}$/.test(ev)
      // A cloned MiniMax voice selected in the dropdown (your own voice via fal,
      // no ElevenLabs) takes precedence and is delivered by fal/MiniMax only.
      const selVoice = elVoices.find(v => v.voice_id === voiceId)
      const body: Record<string, unknown> =
        selVoice?.provider === 'minimax'
          ? { text, provider: 'minimax', minimax_voice: voiceId, gender: 'f', tone, language: lang }
          : ev && isVoiceId
            ? { text, provider: 'elevenlabs', voice_id: ev, gender: 'f', tone, language: lang }
            : ev
              ? { text, provider: 'fal_elevenlabs', el_voice: ev, gender: 'f', tone, language: lang }
              : elConfigured
                ? { text, voice_id: voiceId, gender: 'f', tone, language: lang }
                : { text, gemini_voice: geminiVoice, gender: ['Kore', 'Leda', 'Zephyr', 'Aoede'].includes(geminiVoice) ? 'f' : 'm', tone, language: lang }
      // Pause between stories is engine-specific markup, built server-side so it
      // never appears in the script the user edits.
      body.pause_ms = pauseMs
      const r = await invokeRaw('generate-voiceover', body)
      if (r.error) throw new Error(String(r.error))
      const url = String(r.publicUrl || '')
      // Which engine ACTUALLY spoke matters: the dropdown may say "Aoede" while
      // the chain quietly used fal's English "Sarah". Show the truth.
      const prov = String(r.provider || '')
      const LABEL: Record<string, string> = {
        elevenlabs: 'ElevenLabs (contul tău) — voce românească ✓',
        google_tts: 'Google Cloud TTS — voce NATIV românească (ro-RO) ✓',
        fal_elevenlabs: 'ElevenLabs prin fal — voce premade, accent englezesc ⚠',
        gemini: 'Gemini — voce englezească, accent la română ⚠',
        openai: 'OpenAI — voce englezească, accent la română ⚠',
      }
      const gv = String(r.voice_used || '')
      setVoiceUsed(prov
        ? (LABEL[prov] || prov) + (gv ? ` · ${gv}` : '') + (r.note ? ` · ${String(r.note)}` : '')
        : '')
      setVoUrl(url)
      setCues([]); setWords([])   // a new voice invalidates any previous alignment
      return url || null
    } catch (e) { setError((e as Error).message); return null } finally { setBusy('') }
  }

  async function uploadPhoto(file?: File) {
    if (!file) return
    // Real-person faces always need the consent confirmation. A fully
    // AI-generated presenter (anchorIsReal = false) has no person to consent.
    if (anchorIsReal && (!photoConsent || !photoPerson.trim())) {
      setError('Completează persoana și bifează consimțământul înainte de a încărca fotografia unei persoane reale.'); return
    }
    setError(''); setBusy('photo')
    try {
      const path = `anchor-photos/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
      const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) throw new Error(upErr.message)
      const url = supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
      if (hgConfigured) {
        // An AI-generated presenter has no real person behind it, so there is
        // nobody to give consent; a real person's photo still requires it.
        const isFictional = !photoPerson.trim()
        const r = await invokeRaw('newsroom-anchor', isFictional
          ? { action: 'upload_photo', image_url: url, fictional: true }
          : { action: 'upload_photo', image_url: url, consent: { granted: true, person_name: photoPerson.trim() } })
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

  // Shared Whisper alignment (segments + word timings) for captions, story
  // timing and the directed presenter track. Runs once per voiceover; a new
  // voice clears the cache (see genVoice).
  async function ensureAlignment(voiceUrl: string): Promise<{ cueList: Cue[]; wordList: Word[] }> {
    let cueList = cues, wordList = words
    if ((cueList.length === 0 || wordList.length === 0) && voiceUrl) {
      try {
        const timeout = new Promise<Record<string, unknown>>((_r, rej) => setTimeout(() => rej(new Error('subtitle timeout')), 60000))
        const r = await Promise.race([invokeRaw('align-subtitles', { audio_url: voiceUrl, language: lang }), timeout])
        if (Array.isArray(r.segments)) { cueList = (r.segments as Cue[]).map(c => ({ ...c, text: fixSpelling(c.text) })); setCues(cueList) }
        if (Array.isArray(r.words)) { wordList = (r.words as Word[]).map(w => ({ ...w, word: fixSpelling(w.word) })); setWords(wordList) }
      } catch { /* alignment optional — timings fall back to proportional */ }
    }
    return { cueList, wordList }
  }

  function mediaDuration(url: string, kind: 'audio' | 'video'): Promise<number> {
    return new Promise(res => {
      const el = document.createElement(kind)
      let done = false
      const finish = (v: number) => { if (!done) { done = true; res(v) } }
      const timer = setTimeout(() => finish(0), 10000)
      el.preload = 'metadata'
      el.onloadedmetadata = () => { clearTimeout(timer); finish(Number.isFinite(el.duration) ? el.duration : 0) }
      el.onerror = () => { clearTimeout(timer); finish(0) }
      el.src = url
    })
  }

  // ── DIRECTED PRESENTER TRACK ────────────────────────────────────────────
  // A short filmed clip cannot carry a long bulletin: the lipsync engine loops
  // it, and the anchor's gestures repeat visibly every clip-length. Real TV
  // solves this in the control room — it CUTS at story boundaries and
  // alternates wide/tight camera framings. This builder does exactly that: it
  // re-edits the clip into a SILENT video precisely as long as the voiceover
  // (a cut at each story start, long stories subdivided, alternating punch-in,
  // varied source offsets so consecutive shots never open on the same
  // gesture), records it in the browser and uploads it as the lipsync input.
  // Free — the only cost is a real-time render (about the bulletin's length).
  async function buildPresenterTrack(voiceUrl: string, audioDur: number): Promise<string | null> {
    try {
      setVideoStatus('pistă regizată — pregătesc')
      const vv = document.createElement('video')
      vv.crossOrigin = 'anonymous'; vv.muted = true; vv.playsInline = true; vv.preload = 'auto'; vv.src = anchorVideo
      await new Promise<void>((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 12000); vv.onloadeddata = () => { clearTimeout(t); res() }; vv.onerror = () => { clearTimeout(t); rej(new Error('clip')) } })
      const clipDur = Number.isFinite(vv.duration) ? vv.duration : 0
      if (clipDur < 4) return null

      // Cut points: every story start (word-aligned to the voiceover), then
      // long spans subdivided so no span exceeds what the clip carries unlooped.
      const { cueList, wordList } = await ensureAlignment(voiceUrl)
      const storyStarts = storyTimes(audioDur, cueList, wordList).map(s => s.start)
      const cuts: number[] = [0]
      for (const s of storyStarts) if (s > cuts[cuts.length - 1] + 4 && s < audioDur - 3) cuts.push(s)
      const MAX_SPAN = Math.min(13, clipDur - 1.2)
      const fine: number[] = []
      for (let i = 0; i < cuts.length; i++) {
        const a = cuts[i], b = i + 1 < cuts.length ? cuts[i + 1] : audioDur
        fine.push(a)
        let pPos = a
        while (b - pPos > MAX_SPAN + 1.5) {
          pPos += MAX_SPAN - 1.5 + ((fine.length % 3) * 0.9)
          if (pPos < b - 2) fine.push(pPos); else break
        }
      }
      type Span = { at: number; end: number; off: number; zoom: number }
      const spans: Span[] = fine.map((at, i) => {
        const end = i + 1 < fine.length ? fine[i + 1] : audioDur
        const len = Math.min(end - at, clipDur - 0.3)
        const usable = Math.max(0.05, clipDur - len - 0.2)
        return { at, end, off: (i * 6.4) % usable, zoom: i % 2 ? 1.18 : 1 }
      })

      const W2 = 1280, H2 = 720
      const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2
      const cx2 = cv.getContext('2d')!
      const stream = cv.captureStream(25)
      let mime = 'video/mp4'
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp9'
      if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 })
      const chunks: BlobPart[] = []
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      const recDone = new Promise<Blob>(res => { rec.onstop = () => res(new Blob(chunks, { type: mime })) })

      const draw = (sp: Span) => {
        const vw = vv.videoWidth || 16, vh = vv.videoHeight || 9
        const cr = W2 / H2, vr = vw / vh
        let sw: number, sh: number
        if (vr > cr) { sh = vh; sw = vh * cr } else { sw = vw; sh = vw / cr }
        sw /= sp.zoom; sh /= sp.zoom
        // tight shots frame on the anchor (left of centre in the stock clip)
        let sxp = sp.zoom > 1 ? vw * 0.37 - sw * 0.45 : (vw - sw) / 2
        let syp = sp.zoom > 1 ? vh * 0.36 - sh * 0.38 : (vh - sh) / 2
        sxp = Math.max(0, Math.min(vw - sw, sxp)); syp = Math.max(0, Math.min(vh - sh, syp))
        cx2.drawImage(vv, sxp, syp, sw, sh, 0, 0, W2, H2)
      }
      const seekTo = (sp: Span) => { try { vv.currentTime = sp.off } catch { /* keep playing */ } }
      vv.onseeked = () => { vv.play().catch(() => {}) }

      rec.start(200)
      seekTo(spans[0]); vv.play().catch(() => {})
      const t0 = performance.now()
      let cur = 0
      await new Promise<void>(resolve => {
        const loop = () => {
          const t = (performance.now() - t0) / 1000
          while (cur + 1 < spans.length && t >= spans[cur + 1].at) { cur++; seekTo(spans[cur]) }
          draw(spans[cur])
          setVideoStatus(`pistă regizată ${Math.min(99, Math.round((t / audioDur) * 100))}%`)
          if (t >= audioDur) { resolve(); return }
          requestAnimationFrame(loop)
        }
        loop()
      })
      rec.stop()
      const blob = await recDone
      vv.pause()
      if (blob.size < 50000) return null
      setVideoStatus('pistă regizată — încarc')
      const ext = mime.includes('mp4') ? 'mp4' : 'webm'
      const path = `newsroom/presenter-track-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('studio-assets').upload(path, blob, { contentType: mime, upsert: false })
      if (upErr) return null
      return supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
    } catch { return null }
  }

  async function genVideo(voParam?: string): Promise<string | null> {
    const voice = voParam || voUrl
    if (!voice) { setError('Generează vocea mai întâi (pasul 3).'); return null }

    // ── Free-stack engine (fal / SadTalker) when HeyGen is absent ─────────
    if (!hgConfigured) {
      if (!falConfigured) { setError('Configurează FAL_KEY (credite preplătite, fără abonament) sau HEYGEN_API_KEY.'); return null }
      if (!anchorVideo && !anchorImg) { setError('Alege un clip de prezentator (recomandat) sau un portret (pasul 4).'); return null }
      setError(''); setVideoUrl(''); setVideoStatus('se trimite')
      try {
        // Video-to-video lipsync (sync.so) is the professional path: the clip keeps
        // its real studio, body language and lighting — only the mouth is resynced.
        // A photo-only anchor now uses Kling ai-avatar (engine 'avatar'), which
        // drives head motion/expression from the audio while preserving identity —
        // instead of SadTalker, which warped the face ("highly inaccurate").
        //
        // LOOP GUARD + DIRECTED TRACK: when the voiceover is LONGER than the
        // presenter clip, the engine would loop the footage and the anchor's
        // gestures would repeat visibly every clip-length. With the directed
        // track ON, the clip is first re-edited to the exact voice length
        // (cuts at story boundaries, alternating tight shot — control-room
        // grammar). With it OFF, we refuse to render a silently-looping
        // bulletin and say why.
        let lipsyncSrc = anchorVideo
        if (anchorVideo) {
          const audioDur = await mediaDuration(voice, 'audio')
          const clipDur = await mediaDuration(anchorVideo, 'video')
          if (audioDur > 0 && clipDur > 0 && audioDur > clipDur + 0.75) {
            if (trackMode) {
              const built = await buildPresenterTrack(voice, audioDur)
              if (!built) {
                setError('Pista regizată nu a putut fi construită (browserul a refuzat înregistrarea canvasului). Reîncearcă în Chrome — sau folosește un clip de prezentator cel puțin cât vocea.')
                setVideoStatus(''); return null
              }
              lipsyncSrc = built
            } else {
              setError(`Vocea (~${Math.round(audioDur)}s) este mai lungă decât clipul de prezentator (~${Math.round(clipDur)}s): motorul ar bucla clipul, iar mișcările prezentatorului s-ar repeta vizibil la fiecare ${Math.round(clipDur)}s. Bifează „Pistă regizată" la pasul 5 — sau folosește un clip mai lung.`)
              setVideoStatus(''); return null
            }
          }
          setVideoStatus('se trimite')
        }
        const r = await invokeRaw('newsroom-anchor', anchorVideo
          ? { action: 'generate_fal', engine: 'sync', video_url: lipsyncSrc, audio_url: voice, quality }
          : { action: 'generate_fal', engine: 'avatar', image_url: anchorImg, audio_url: voice })
        if (r.error) throw new Error(String(r.error))
        const statusUrl = String(r.status_url || ''), responseUrl = String(r.response_url || '')
        for (let i = 0; i < 150; i++) {
          await sleep(5000)
          const st = await invokeRaw('newsroom-anchor', { action: 'poll_fal', status_url: statusUrl, response_url: responseUrl })
          if (st.error) throw new Error(String(st.error))
          const s = String(st.status || '')
          setVideoStatus(s === 'IN_QUEUE' ? 'în coadă' : s === 'IN_PROGRESS' ? 'processing' : s)
          if (s === 'completed' && st.publicUrl) { const u = String(st.publicUrl); setVideoUrl(u); setVideoStatus('gata ✓'); return u }
        }
        throw new Error('Durează neobișnuit de mult — reîncearcă.')
      } catch (e) { setError((e as Error).message); setVideoStatus('') }
      return null
    }

    // ── HeyGen engine (premium) ───────────────────────────────────────────
    const character = mode === 'avatar'
      ? { type: 'avatar', avatar_id: avatarId }
      : { type: 'talking_photo', talking_photo_id: photoId }
    if (mode === 'avatar' && !avatarId) { setError('Alege un prezentator.'); return null }
    if (mode === 'photo' && !photoId) { setError('Încarcă fotografia prezentatorului.'); return null }
    const [width, height] = orient === '16:9' ? [1280, 720] : [720, 1280]
    setError(''); setVideoUrl(''); setVideoStatus('se trimite')
    try {
      // Pass the studio as HeyGen's NATIVE background — the avatar is composited
      // into it at source, correctly scaled in 16:9, instead of being keyed over
      // the studio afterwards (no green spill, no decapitated portrait).
      const r = await invokeRaw('newsroom-anchor', {
        action: 'generate', character, audio_url: voice, width, height,
        ...(studioBg ? { background_image_url: studioBg } : {}),
      })
      if (r.error) throw new Error(String(r.error))
      const videoId = String(r.video_id || '')
      for (let i = 0; i < 150; i++) {
        await sleep(5000)
        const st = await invokeRaw('newsroom-anchor', { action: 'status', video_id: videoId })
        if (st.error) throw new Error(String(st.error))
        const s = String(st.status || '')
        setVideoStatus(s)
        if (s === 'completed' && st.publicUrl) { const u = String(st.publicUrl); setVideoUrl(u); setVideoStatus('gata ✓'); return u }
        if (s === 'failed') throw new Error('HeyGen a eșuat: ' + String(st.error_detail || 'necunoscut'))
      }
      throw new Error('Durează neobișnuit de mult — verifică în contul HeyGen.')
    } catch (e) { setError((e as Error).message); setVideoStatus('') }
    return null
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
  // ── Defaults persistence: the studio/presenter/voice setup survives reloads,
  // so the daily flow is just: open page → Autopilot. ──────────────────────
  const defaultsLoaded = useRef(false)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tt_newsroom_defaults')
      if (raw) {
        const d = JSON.parse(raw)
        if (typeof d.anchorVideo === 'string') setAnchorVideo(d.anchorVideo)
        if (typeof d.anchorImg === 'string') setAnchorImg(d.anchorImg)
        if (typeof d.studioBg === 'string') setStudioBg(d.studioBg)
        if (typeof d.greenscreen === 'boolean') setGreenscreen(d.greenscreen)
        if (d.monitorSide === 'left' || d.monitorSide === 'right' || d.monitorSide === 'off' || d.monitorSide === 'green') setMonitorSide(d.monitorSide)
        if (typeof d.trackMode === 'boolean') setTrackMode(d.trackMode)
        if (typeof d.outroVideo === 'string') setOutroVideo(d.outroVideo)
        if (typeof d.geminiVoice === 'string') setGeminiVoice(d.geminiVoice)
        // Only restore a NON-EMPTY saved voice: an empty string saved before this
        // field existed would otherwise wipe the preset Romanian voice on load.
        if (typeof d.elVoice === 'string' && d.elVoice.trim()) setElVoice(d.elVoice)
        if (typeof d.quality === 'string') setQuality(d.quality as 'economic'|'veed'|'standard'|'bun'|'pro'|'premium')
        if (typeof d.tone === 'string') setTone(d.tone)
        if (typeof d.pauseMs === 'number' && d.pauseMs >= 0 && d.pauseMs <= 3000) setPauseMs(d.pauseMs)
        if (typeof d.presScale === 'number') setPresScale(d.presScale)
        if (typeof d.presX === 'number') setPresX(d.presX)
        if (typeof d.presY === 'number') setPresY(d.presY)
        if (typeof d.deskLine === 'number') setDeskLine(d.deskLine)
        if (typeof d.bedOn === 'boolean') setBedOn(d.bedOn)
        if (typeof d.bedLevel === 'number') setBedLevel(d.bedLevel)
        if (typeof d.subsOn === 'boolean') setSubsOn(d.subsOn)
        if (typeof d.tickerOn === 'boolean') setTickerOn(d.tickerOn)
        if (d.capMode === 'clasic' || d.capMode === 'karaoke') setCapMode(d.capMode)
        if (typeof d.voUrl === 'string' && d.voUrl) setVoUrl(d.voUrl)
        if (typeof d.videoUrl === 'string' && d.videoUrl) { setVideoUrl(d.videoUrl); setVideoStatus('gata ✓ (sesiunea anterioară)') }
      }
    } catch { /* defaults are best-effort */ }
    defaultsLoaded.current = true
  }, [])
  useEffect(() => {
    if (!defaultsLoaded.current) return
    try {
      localStorage.setItem('tt_newsroom_defaults', JSON.stringify({
        anchorVideo, anchorImg, studioBg, greenscreen, monitorSide, geminiVoice, elVoice, quality, tone, pauseMs,
        presScale, presX, presY, deskLine, bedOn, bedLevel, voUrl, videoUrl,
        subsOn, tickerOn, capMode, trackMode, outroVideo,
      }))
    } catch { /* ignore */ }
  }, [anchorVideo, anchorImg, studioBg, greenscreen, monitorSide, geminiVoice, elVoice, quality, tone, pauseMs, presScale, presX, presY, deskLine, bedOn, bedLevel, voUrl, videoUrl, subsOn, tickerOn, capMode, trackMode, outroVideo])

  // ── Live placement preview (Step 4): studio + keyed presenter + desk line ──
  const keyedFrameRef = useRef<{ key: string; cv: HTMLCanvasElement; ar: number } | null>(null)
  const getPresenterFrame = useCallback(async (): Promise<{ cv: HTMLCanvasElement; ar: number } | null> => {
    const srcKey = (anchorVideo || anchorImg) + (greenscreen ? '|key' : '|raw')
    if (!anchorVideo && !anchorImg) return null
    if (keyedFrameRef.current?.key === srcKey) return keyedFrameRef.current
    try {
      let src: CanvasImageSource, iw = 16, ih = 9
      if (anchorVideo) {
        const vv = document.createElement('video')
        vv.crossOrigin = 'anonymous'; vv.muted = true; vv.playsInline = true; vv.preload = 'auto'; vv.src = anchorVideo
        await new Promise<void>((res, rej) => { vv.onloadeddata = () => res(); vv.onerror = () => rej(new Error('video')); setTimeout(() => rej(new Error('timeout')), 8000) })
        vv.currentTime = Math.min(0.4, (vv.duration || 1) / 3)
        await new Promise<void>(res => { vv.onseeked = () => res(); setTimeout(res, 1500) })
        src = vv; iw = vv.videoWidth || 16; ih = vv.videoHeight || 9
      } else {
        const img = await loadImage(anchorImg, 6000)
        if (!img) return null
        src = img; iw = img.naturalWidth || 1; ih = img.naturalHeight || 1
      }
      const ar = iw / ih
      const cw = Math.min(640, iw), chh = Math.round(cw / ar)
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh
      const cx2 = cv.getContext('2d')!
      cx2.drawImage(src, 0, 0, cw, chh)
      if (greenscreen) {
        const id = cx2.getImageData(0, 0, cw, chh); const d = id.data
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2]
          if (g > 90 && g > r * 1.35 && g > b * 1.35) d[i + 3] = 0
        }
        cx2.putImageData(id, 0, 0)
      }
      const out = { key: srcKey, cv, ar }
      keyedFrameRef.current = out
      return out
    } catch { return null }
  }, [anchorVideo, anchorImg, greenscreen])
  useEffect(() => {
    if (!studioBg) return
    let alive = true
    ;(async () => {
      const canvas = placementPreviewRef.current; if (!canvas) return
      const PW = 480, PH = 270
      canvas.width = PW; canvas.height = PH
      const c2 = canvas.getContext('2d')!
      const studio = await loadImage(studioBg, 6000)
      const frame = await getPresenterFrame()
      if (!alive) return
      c2.fillStyle = '#05070c'; c2.fillRect(0, 0, PW, PH)
      const cover = (img: CanvasImageSource, iw: number, ih: number) => {
        const vr = iw / ih, cr = PW / PH; let dw: number, dh: number
        if (vr > cr) { dh = PH; dw = PH * vr } else { dw = PW; dh = PW / vr }
        c2.drawImage(img, (PW - dw) / 2, (PH - dh) / 2, dw, dh)
      }
      if (studio) cover(studio, studio.naturalWidth || 16, studio.naturalHeight || 9)
      if (frame) {
        if (greenscreen) {
          // keyed: full-frame cover placement (matches the compositor's keyed path)
          const dw = PW * presScale, dh = PH * presScale
          c2.drawImage(frame.cv, PW * presX - dw / 2, PH - dh + PH * presY, dw, dh)
        } else {
          // window mode: framed presenter at native aspect (matches portraitSrc path)
          const wh = PH * presScale, ww = wh * frame.ar
          const wx = PW * presX - ww / 2, wy = PH - wh + PH * presY
          c2.fillStyle = '#0a0d14'; c2.fillRect(wx - 3, wy - 3, ww + 6, wh + 6)
          c2.drawImage(frame.cv, wx, wy, ww, wh)
          c2.strokeStyle = 'rgba(255,255,255,0.25)'; c2.strokeRect(wx - 3, wy - 3, ww + 6, wh + 6)
        }
      }
      if (studio && deskLine < 0.99) {
        c2.save(); c2.beginPath(); c2.rect(0, PH * deskLine, PW, PH * (1 - deskLine)); c2.clip()
        cover(studio, studio.naturalWidth || 16, studio.naturalHeight || 9)
        c2.restore()
      }
      // desk-line indicator
      c2.strokeStyle = 'rgba(231,201,130,0.9)'; c2.setLineDash([6, 5]); c2.lineWidth = 1.5
      c2.beginPath(); c2.moveTo(0, PH * deskLine); c2.lineTo(PW, PH * deskLine); c2.stroke(); c2.setLineDash([])
    })()
    return () => { alive = false }
  }, [greenscreen, studioBg, anchorVideo, anchorImg, presScale, presX, presY, deskLine, getPresenterFrame])

  // ── AUTOPILOT — one click: script → voice → lipsync → broadcast compose ──
  const [autoStage, setAutoStage] = useState('')
  const [edition, setEdition] = useState<'morning' | 'evening' | ''>('')
  const [presetsAvail, setPresetsAvail] = useState<Record<string, boolean>>({})
  const [presetMsg, setPresetMsg] = useState('')
  // ── EDITION PRESETS (DB-backed): the whole setup bundled per daypart ────
  function presetPayload() {
    return {
      anchorVideo, anchorImg, studioBg, greenscreen, monitorSide, geminiVoice, tone,
      presScale, presX, presY, deskLine, bedOn, bedLevel, lang, target, capMode, subsOn, tickerOn,
      trackMode, outroVideo,
    }
  }
  function applyPresetPayload(d: Record<string, unknown>) {
    if (typeof d.anchorVideo === 'string') setAnchorVideo(d.anchorVideo)
    if (typeof d.anchorImg === 'string') setAnchorImg(d.anchorImg)
    if (typeof d.studioBg === 'string') setStudioBg(d.studioBg)
    if (typeof d.greenscreen === 'boolean') setGreenscreen(d.greenscreen)
    if (d.monitorSide === 'left' || d.monitorSide === 'right' || d.monitorSide === 'off' || d.monitorSide === 'green') setMonitorSide(d.monitorSide)
    if (typeof d.trackMode === 'boolean') setTrackMode(d.trackMode)
    if (typeof d.outroVideo === 'string') setOutroVideo(d.outroVideo)
    if (typeof d.geminiVoice === 'string') setGeminiVoice(d.geminiVoice)
    if (typeof d.elVoice === 'string' && d.elVoice.trim()) setElVoice(d.elVoice)
    if (typeof d.quality === 'string') setQuality(d.quality as 'economic' | 'veed' | 'standard' | 'bun' | 'pro' | 'premium')
    if (typeof d.tone === 'string') setTone(d.tone)
    if (typeof d.presScale === 'number') setPresScale(d.presScale)
    if (typeof d.presX === 'number') setPresX(d.presX)
    if (typeof d.presY === 'number') setPresY(d.presY)
    if (typeof d.deskLine === 'number') setDeskLine(d.deskLine)
    if (typeof d.bedOn === 'boolean') setBedOn(d.bedOn)
    if (typeof d.bedLevel === 'number') setBedLevel(d.bedLevel)
    if (d.lang === 'ro' || d.lang === 'en') setLang(d.lang)
    if (typeof d.target === 'number') setTarget(d.target)
    // DELIBERATELY NOT APPLIED: subsOn / tickerOn / capMode.
    // These are display choices the user makes per bulletin. Presets carry a
    // hardcoded `subsOn: true`, so applying them here silently switched burnt-in
    // subtitles back ON after the user had unticked the box — the video then
    // shipped with subtitles nobody asked for. A preset sets the STUDIO, the
    // anchor and the voice; it does not get to overrule the toggles.
  }
  async function loadEdition(kind: 'morning' | 'evening') {
    try {
      const { data } = await db.from('newsroom_presets').select('payload').eq('kind', kind).maybeSingle()
      if (data?.payload) { applyPresetPayload(data.payload as Record<string, unknown>); setEdition(kind); setPresetMsg('') }
      else setPresetMsg(kind === 'morning' ? 'Nu există încă ediția de dimineață — configurează și salveaz-o.' : 'Nu există încă ediția de seară — configurează și salveaz-o.')
    } catch { setPresetMsg('Rulează întâi sql/tt-newsroom-presets.sql.') }
  }
  async function saveEdition(kind: 'morning' | 'evening') {
    try {
      const { error: e } = await db.from('newsroom_presets')
        .upsert({ kind, name: kind === 'morning' ? 'Matinal TT' : 'Jurnalul de Seară', payload: presetPayload(), updated_at: new Date().toISOString() }, { onConflict: 'kind' })
      if (e) throw new Error(e.message)
      setPresetsAvail(a => ({ ...a, [kind]: true })); setEdition(kind)
      setPresetMsg(kind === 'morning' ? 'Ediția de dimineață salvată ✓' : 'Ediția de seară salvată ✓')
      setTimeout(() => setPresetMsg(''), 3500)
    } catch (e) { setPresetMsg('Salvare eșuată: ' + (e as Error).message) }
  }
  // Auto-daypart: on load, apply the preset matching the local hour (if it exists).
  useEffect(() => {
    ;(async () => {
      try {
        const { data } = await db.from('newsroom_presets').select('kind')
        const avail: Record<string, boolean> = {}
        for (const r of (data || []) as { kind: string }[]) avail[r.kind] = true
        setPresetsAvail(avail)
        const wanted: 'morning' | 'evening' = new Date().getHours() < 14 ? 'morning' : 'evening'
        if (avail[wanted]) await loadEdition(wanted)
        else if (avail[wanted === 'morning' ? 'evening' : 'morning']) await loadEdition(wanted === 'morning' ? 'evening' : 'morning')
      } catch { /* presets table not created yet */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── One-click AI edition setup: generates the studio + anchorwoman with AI,
  // saves them in the library, wires the voice, and stores the preset. ──────
  const [setupBusy, setSetupBusy] = useState('')
  const [setupStage, setSetupStage] = useState('')
  // ONE-CLICK EDITION — the guaranteed-correct 16:9 recipe. The presenter is
  // generated ALREADY SEATED IN HER STUDIO as a single 16:9 scene, that scene is
  // animated into an idle clip (Kling), and lipsync runs on the full clip
  // (sync v2). One asset, native 16:9 → cover-fills the frame perfectly. No
  // window boxes, no greenscreen, no placement needed. This is the same shape
  // as professional stock anchor footage.
  async function setupEdition(kind: 'morning' | 'evening') {
    if (!falConfigured) { setError('Configurarea automată necesită FAL_KEY (Kling + lipsync).'); return }
    setSetupBusy(kind); setError('')
    try {
      setSetupStage('generez scena 16:9…')
      const scenePrompt = kind === 'morning'
        ? 'Exquisite bright morning television news studio, 16:9 wide broadcast frame. A fictional female news anchor, age 29, natural blonde shoulder-length hair, sage-green blazer, seated at a white stone anchor desk slightly LEFT of centre, visible from mid-torso up with the desk edge along the lower frame, hands calmly folded on the desk, facing the camera directly, mouth closed and relaxed, warm friendly authority, her face clearly lit and unobstructed. Behind her a full glass wall opens onto Cheile Turzii gorge at sunrise — golden limestone cliffs, thin mist over the valley; light noble-wood paneling, brass and subtle crimson accents, soft warm key light, photorealistic, sharp focus, broadcast-grade composition with clean space on the right side of frame. No text, no logos, no watermark.'
        : 'Exquisite flagship evening television news studio at blue hour, 16:9 wide broadcast frame. A fictional female news anchor, age 35, chestnut hair in an elegant low chignon, structured navy blazer with a subtle crimson lapel pin, professional TV makeup, seated at a monolithic smoked-glass anchor desk slightly LEFT of centre, visible from mid-torso up with the desk edge along the lower frame, hands calmly folded, facing the camera directly, mouth closed and relaxed, composed authority, her face clearly lit and unobstructed. Behind her a vast curved panoramic window reveals the skyline of Turda, Romania — the warm-lit town hall clock tower, terracotta rooftops, Transylvanian hills at dusk; a thin crimson light strip along the desk edge, polished dark reflective floor, cinematic lighting, photorealistic, sharp focus, broadcast-grade composition with clean space on the right side of frame. No text, no logos, no watermark.'
      const sr = await invokeRaw('generate-cover-image', { raw_prompt: scenePrompt, aspect: '16:9' })
      if (sr.error) throw new Error(String(sr.error))
      const sceneUrl = String(sr.publicUrl || ''); if (!sceneUrl) throw new Error('scena nu s-a generat')

      setSetupStage('animez clipul (2–4 min)…')
      const idlePrompt = 'A professional news anchor at the desk, subtle natural idle motion only: gentle breathing, slight head movements, occasional blink, hands calmly resting, mouth stays CLOSED, no talking, no gestures toward the face. Locked-off camera, no zoom, no pan. Preserve the person, framing, lighting and background exactly. Seamless loop feel.'
      const mr = await invokeRaw('generate-motion', { action: 'create', image_url: sceneUrl, prompt: idlePrompt, duration: '10' })
      if (mr.error) throw new Error(String(mr.error))
      const statusUrl = String(mr.status_url || ''), responseUrl = String(mr.response_url || '')
      let clipUrl = ''
      for (let i = 0; i < 120; i++) {
        await sleep(5000)
        const st = await invokeRaw('generate-motion', { action: 'poll', status_url: statusUrl, response_url: responseUrl })
        if (st.error) throw new Error(String(st.error))
        if (String(st.status) === 'COMPLETED' && st.publicUrl) { clipUrl = String(st.publicUrl); break }
      }
      if (!clipUrl) throw new Error('Kling nu a terminat în 10 minute — reîncearcă.')

      setSetupStage('salvez ediția…')
      try {
        await db.from('newsroom_assets').insert([
          { kind: 'presenter_video', name: kind === 'morning' ? 'Ioana — Matinal (Cheile Turzii, 16:9)' : 'Ana — Seară (Panorama Turzii, 16:9)', url: clipUrl, is_real_person: false, person_name: null },
          { kind: 'presenter', name: kind === 'morning' ? 'Ioana — poster 16:9' : 'Ana — poster 16:9', url: sceneUrl, is_real_person: false, person_name: null },
        ])
        await refreshLibrary()
      } catch { /* library table missing — preset still carries the URLs */ }

      // Complete broadcast kit — deterministic. anchorVideo is 16:9 with the
      // studio IN the shot, so no separate studio / greenscreen / placement.
      const payload = {
        anchorVideo: clipUrl, anchorImg: sceneUrl, studioBg: '', greenscreen: false,
        geminiVoice: kind === 'morning' ? 'Aoede' : 'Zephyr', tone: 'stiri',
        presScale: 0.85, presX: 0.5, presY: 0.06, deskLine: 1,
        monitorSide: 'right' as const,             // clean right-side space is in the prompt
        bedOn: true, bedLevel: 0.6,
        tickerOn: true,
        subsOn: true, capMode: 'karaoke' as const,
        lang: 'ro' as const, target: 75,
      }
      const { error: e } = await db.from('newsroom_presets')
        .upsert({ kind, name: kind === 'morning' ? 'Matinal TT' : 'Jurnalul de Seară', payload, updated_at: new Date().toISOString() }, { onConflict: 'kind' })
      if (e) throw new Error(e.message)
      applyPresetPayload(payload); setEdition(kind); setPresetsAvail(a => ({ ...a, [kind]: true }))
      setPresetMsg(kind === 'morning' ? 'Matinal TT gata: Ioana în platoul Cheile Turzii — clip 16:9 + Aoede ✓' : 'Jurnalul de Seară gata: Ana în Panorama Turzii — clip 16:9 + Zephyr ✓')
      setTimeout(() => setPresetMsg(''), 8000)
    } catch (e) { setError('Configurare ediție: ' + (e as Error).message) } finally { setSetupBusy(''); setSetupStage('') }
  }

  async function deleteEdition(kind: 'morning' | 'evening') {
    const label = kind === 'morning' ? 'Matinal TT' : 'Jurnalul de Seară'
    if (!window.confirm(`Ștergi ediția „${label}”? Clipul și posterul rămân în bibliotecă (le poți șterge de acolo cu ✕); doar presetul dispare.`)) return
    try {
      const { error: e } = await db.from('newsroom_presets').delete().eq('kind', kind)
      if (e) throw new Error(e.message)
      setPresetsAvail(a => ({ ...a, [kind]: false }))
      if (edition === kind) setEdition('')
      setPresetMsg(`${label} ștearsă. Recreeaz-o oricând cu butonul AI sau cu „salvează setarea curentă”.`)
      setTimeout(() => setPresetMsg(''), 5000)
    } catch (e) { setPresetMsg('Ștergere eșuată: ' + (e as Error).message) }
  }

  async function autoBulletin() {
    // A bulletin does not require fresh articles. With no news selected but a
    // script written or pasted by hand at step 2, Autopilot uses THAT text
    // instead of generating one — otherwise a slow news day (or a special
    // edition written manually) locks the whole pipeline.
    const manualScript = script.trim()
    if (sel.size === 0 && !manualScript) {
      setError('Selectează cel puțin o știre — sau scrie/lipește un script la pasul 2 și Autopilot îl folosește pe acela.'); return
    }
    if (!anchorVideo && !anchorImg && !hgConfigured) { setError('Setează o dată prezentatorul (pasul 4) — apoi Autopilot îl refolosește zilnic.'); return }
    setError('')
    try {
      setAutoStage('script')
      // Fresh news selected → write from the news. Otherwise keep the manual text.
      const text = sel.size > 0 ? await genScript() : manualScript
      if (!text) throw new Error('scriptul a eșuat')
      setAutoStage('voice')
      const voice = await genVoice(text); if (!voice) throw new Error('vocea a eșuat')
      setAutoStage('anchor')
      const vid = await genVideo(voice); if (!vid) throw new Error('clipul prezentatorului a eșuat')
      setAutoStage('compose')
      await composeBulletin(vid, voice)
      setAutoStage('done')
    } catch (e) {
      if (!String((e as Error).message).includes('eșuat')) setError((e as Error).message)
      setAutoStage('')
    }
  }

  // Manual Step 5 path: render the anchor clip, then ALWAYS brand it. The raw
  // lipsync clip is an intermediate — it has NO ticker, NO article monitor, NO
  // TT branding and NO category chip; those live only in the composed bulletin.
  // Chaining compose here means the manual flow can never hand back a naked clip.
  async function genVideoAndCompose() {
    const vid = await genVideo()
    if (!vid) return
    await composeBulletin(vid)
  }

  // Estimated fal lipsync cost for the CURRENT script, shown before spending.
  // Romanian news delivery averages ~150 wpm; fal bills per minute of output.
  const estLipsyncCost = useMemo(() => {
    const RATES = { economic: 0.30, veed: 0.40, standard: 0.70, bun: 3.00, pro: 5.00, premium: 8.00 } as const
    const rate = RATES[quality]
    const words = script.trim() ? script.trim().split(/\s+/).length : 0
    const min = words > 0 ? words / 150 : (target || 75) / 60
    return { usd: min * rate, min, rate }
  }, [script, quality, target])

  // Story timing — when each lower-third / article image / category chip appears.
  //
  // The old version searched the WHOLE caption list for the first cue containing
  // a story's opening words. In a news bulletin the same phrases recur ("în
  // Turda", "primăria a anunțat"), so story 3 routinely matched a cue belonging
  // to story 1 and its picture appeared far too early. Two fixes:
  //   1. Anchor on real WORD timings from the aligner (not whole-cue text).
  //   2. Search only FORWARD of the previous story, inside a plausible window —
  //      a match can never jump backwards, and timings stay monotonic.
  function storyTimes(dur: number, cueList: Cue[], wordList: Word[] = []): { start: number; title: string; category?: string | null; cover?: string | null }[] {
    const selectedPosts = posts.filter(p => sel.has(p.id))
    if (!sections || !sections.stories.length) {
      return selectedPosts.map((p, i) => ({
        start: (dur / Math.max(1, selectedPosts.length)) * i,
        title: ((lang === 'ro' ? p.title_ro : p.title_en) || '').slice(0, 60),
        category: p.category,
        cover: p.cover_image,
      }))
    }
    const parts = [sections.greeting, ...sections.stories.map(s => s.text), sections.signoff].filter(Boolean)
    const wc = parts.map(p => p.split(/\s+/).length); const total = wc.reduce((a, b) => a + b, 0) || 1

    // Spoken-word timeline. Prefer real word timings; otherwise spread each cue's
    // words evenly across that cue's own span. Either way we get word→time.
    type TW = { w: string; t: number }
    const timeline: TW[] = []
    if (wordList.length) {
      for (const w of wordList) {
        const n = norm(w.word)
        if (n) timeline.push({ w: n, t: w.start })
      }
    } else {
      for (const c of cueList) {
        const ws = norm(c.text).split(' ').filter(Boolean)
        const span = Math.max(0.001, (c.end ?? c.start) - c.start)
        ws.forEach((w, k) => timeline.push({ w, t: c.start + (span * k) / Math.max(1, ws.length) }))
      }
    }

    const out: { start: number; title: string; category?: string | null; cover?: string | null }[] = []
    let acc = sections.greeting ? wc[0] : 0
    let prevIdx = 0      // no story may anchor before this word index
    let prevStart = 0    // …nor before this timestamp

    sections.stories.forEach((st, i) => {
      const est = (acc / total) * dur                       // proportional estimate
      let start = est
      const probe = norm(st.text).split(' ').filter(Boolean).slice(0, 5)

      if (timeline.length && probe.length >= 2) {
        // Expected position in the word timeline, with a tolerance window so a
        // slightly-off estimate still finds the true opening.
        const expected = Math.round((acc / total) * timeline.length)
        const slack = Math.max(25, Math.round(timeline.length * 0.18))
        const lo = Math.max(prevIdx, expected - slack)
        const hi = Math.min(timeline.length - probe.length, expected + slack)
        let bestIdx = -1, bestScore = 0
        for (let j = lo; j <= hi; j++) {
          let score = 0
          for (let k = 0; k < probe.length; k++) if (timeline[j + k]?.w === probe[k]) score++
          // require a solid match (most of the probe words, in order)
          if (score > bestScore && score >= Math.max(2, probe.length - 1)) { bestScore = score; bestIdx = j }
        }
        if (bestIdx >= 0) { start = timeline[bestIdx].t; prevIdx = bestIdx + 1 }
        else prevIdx = Math.max(prevIdx, Math.max(0, expected - slack))
      }

      // Monotonic + in-bounds: a story can never start before the previous one.
      start = Math.min(Math.max(start, i === 0 ? 0 : prevStart + 0.8), Math.max(0, dur - 0.5))
      prevStart = start
      out.push({ start, title: st.lower_third || `Știrea ${i + 1}`, category: selectedPosts[i]?.category, cover: selectedPosts[i]?.cover_image })
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

  async function composeBulletin(videoParam?: string, voParam?: string) {
    const vidUrl = videoParam || videoUrl
    const voiceUrl = voParam || voUrl
    if (!vidUrl) { setError('Generează întâi clipul cu prezentatorul (pasul 5).'); return }
    setError(''); setCompositing(true); setCompPct(0); setBulletinUrl('')
    try {
      // Anchor clip.
      const v = document.createElement('video')
      v.crossOrigin = 'anonymous'; v.playsInline = true; v.preload = 'auto'; v.src = vidUrl
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('Nu am putut încărca clipul (CORS?).')) })
      const dur = Math.min(300, Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 60)

      // Filmed outro: the anchor stands and leaves the studio, then the endcard.
      let ov: HTMLVideoElement | null = null
      let outroClipDur = 0
      if (outroVideo) {
        try {
          const el = document.createElement('video')
          el.crossOrigin = 'anonymous'; el.muted = true; el.playsInline = true; el.preload = 'auto'; el.src = outroVideo
          await new Promise<void>((res, rej) => { const tm = setTimeout(() => rej(new Error('timeout')), 8000); el.onloadeddata = () => { clearTimeout(tm); res() }; el.onerror = () => { clearTimeout(tm); rej(new Error('outro')) } })
          ov = el
          outroClipDur = Math.min(8, Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0)
        } catch { ov = null; outroClipDur = 0 }
      }

      // Captions + word timings from the voiceover (once) — shared with the
      // directed track builder, so story cuts and lower-thirds land together.
      setCompStage('aliniez subtitrările…')
      const { cueList, wordList } = await ensureAlignment(voiceUrl)
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
      const thirds = storyTimes(dur, cueList, wordList)
      // Preload article cover images for the in-studio monitor. Each has its own
      // timeout inside loadImage, so a slow/broken URL can never stall the compose.
      let monitorImgs: (HTMLImageElement | null)[] = []
      if (monitorSide !== 'off') {
        setCompStage('încarc imaginile pentru monitor…')
        monitorImgs = await Promise.all(thirds.map(th => th.cover ? loadImage(th.cover, 6000) : Promise.resolve(null)))
      }
      setCompStage('randez buletinul…')
      // Ticker headlines: selected articles first; with a hand-written script
      // and no articles, fall back to the script's own section headings, then to
      // a station line — the ticker (and the branded frame) must never go blank
      // just because there was no news feed to draw on.
      const tickerFromPosts = posts.filter(p => sel.has(p.id)).map(p => (lang === 'ro' ? p.title_ro : p.title_en) || '').filter(Boolean)
      const tickerFromScript = (sections?.stories || []).map(st => st.lower_third || '').filter(Boolean)
      const stationLine = lang === 'ro'
        ? ['TRANSILVANIA TIMES', 'ȘTIRILE ZILEI', 'TURDA ȘI ÎMPREJURIMI']
        : ['TRANSILVANIA TIMES', 'TODAY\u2019S NEWS', 'TURDA AND AROUND']
      const tickerParts = tickerFromPosts.length ? tickerFromPosts
        : tickerFromScript.length ? tickerFromScript
        : stationLine
      const tickerText = tickerParts.join('   •   ')

      const [W, H] = orient === '16:9' ? [1280, 720] : [720, 1280]
      const canvas = canvasRef.current!
      canvas.width = W; canvas.height = H
      const ctx = canvas.getContext('2d')!
      const total = INTRO + dur + outroClipDur + OUTRO
      const dateStr = new Date().toLocaleDateString(lang === 'ro' ? 'ro-RO' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      const clockBaseMs = Date.now()   // live-advancing clock baked into the ticker
      let studioImg: HTMLImageElement | null = null
      if (studioBg) { try { studioImg = await loadImage(studioBg) } catch { studioImg = null } }

      // Audio: anchor clip audio → loudness gain → compressor → recorder.
      const ac = new AudioContext()
      const src = ac.createMediaElementSource(v)
      const dest = ac.createMediaStreamDestination()
      const gain = ac.createGain()
      gain.gain.value = voiceUrl ? await measureVoiceGain(ac, voiceUrl) : 1
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
        // Place the presenter: scaled, positioned, bottom pushed below the desk line.
        const dw = W * presScale, dh = H * presScale
        const dx = W * presX - dw / 2
        const dy = H - dh + H * presY
        ctx.drawImage(okv, dx, dy, dw, dh)
        // Desk occlusion — the studio's foreground strip goes back on top, so the
        // desk sits IN FRONT of the presenter's bust.
        if (studioImg && deskLine < 0.99) {
          ctx.save(); ctx.beginPath(); ctx.rect(0, H * deskLine, W, H * (1 - deskLine)); ctx.clip()
          coverDraw(ctx, studioImg, studioImg.naturalWidth || 16, studioImg.naturalHeight || 9)
          ctx.restore()
        }
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

      // ── GREEN-MONITOR FILL ────────────────────────────────────────────────
      // The presenter clip contains a REAL studio screen filmed in chroma
      // green. Instead of overlaying a fake monitor, the story's cover image is
      // keyed INTO that physical screen: green pixels are auto-detected per
      // frame (the bounding box survives punch-in framing changes) and replaced
      // with the image; the anchor or anything passing in front of the screen
      // occludes it naturally, because only green pixels are touched.
      const brandCard = document.createElement('canvas')
      {
        brandCard.width = 640; brandCard.height = 360
        const b = brandCard.getContext('2d')!
        const bgG = b.createLinearGradient(0, 0, 0, 360)
        bgG.addColorStop(0, '#101827'); bgG.addColorStop(1, '#070b12')
        b.fillStyle = bgG; b.fillRect(0, 0, 640, 360)
        b.fillStyle = P.crimson; b.fillRect(0, 352, 640, 8)
        b.textAlign = 'center'; b.textBaseline = 'middle'
        b.fillStyle = P.cream; b.font = '800 44px Inter, sans-serif'
        b.fillText('TRANSILVANIA', 320, 148)
        b.fillStyle = P.crimson; b.font = '700 30px Inter, sans-serif'
        b.fillText('T I M E S', 320, 198)
        b.fillStyle = P.gold; b.font = '600 17px Inter, sans-serif'
        b.fillText('transilvaniatimes.com', 320, 248)
      }
      const gfScratch = document.createElement('canvas')
      const greenFill = (fill: CanvasImageSource, fw: number, fh: number) => {
        // Operates in place on okv (which holds the current full frame).
        try {
          const id = okx.getImageData(0, 0, W, H); const d = id.data
          let x0 = W, y0 = H, x1 = 0, y1 = 0, hits = 0
          for (let y = 0; y < H; y += 5) for (let x = 0; x < W; x += 5) {
            const i2 = (y * W + x) * 4; const r = d[i2], g = d[i2 + 1], b = d[i2 + 2]
            if (g > 90 && g > r * 1.35 && g > b * 1.35) { hits++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
          }
          if (hits < 30) return               // screen not visible in this framing
          x0 = Math.max(0, x0 - 6); y0 = Math.max(0, y0 - 6)
          x1 = Math.min(W - 1, x1 + 6); y1 = Math.min(H - 1, y1 + 6)
          const bw = x1 - x0 + 1, bh = y1 - y0 + 1
          gfScratch.width = bw; gfScratch.height = bh
          const sctx = gfScratch.getContext('2d')!
          const fr = fw / fh, br = bw / bh
          let dw: number, dh: number
          if (fr > br) { dh = bh; dw = bh * fr } else { dw = bw; dh = bw / fr }
          sctx.fillStyle = '#05070c'; sctx.fillRect(0, 0, bw, bh)
          sctx.drawImage(fill, (bw - dw) / 2, (bh - dh) / 2, dw, dh)
          const fid = sctx.getImageData(0, 0, bw, bh).data
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
            const i2 = (y * W + x) * 4
            const r = d[i2], g = d[i2 + 1], b = d[i2 + 2]
            const fi = ((y - y0) * bw + (x - x0)) * 4
            if (g > 90 && g > r * 1.35 && g > b * 1.35) { d[i2] = fid[fi]; d[i2 + 1] = fid[fi + 1]; d[i2 + 2] = fid[fi + 2] }
            else if (g > 80 && g > r * 1.18 && g > b * 1.18) {
              // soft edge: half-blend removes the green fringe without a hard rim
              d[i2] = (r + fid[fi]) >> 1; d[i2 + 1] = ((g >> 1) + fid[fi + 1]) >> 1; d[i2 + 2] = (b + fid[fi + 2]) >> 1
            }
          }
          okx.putImageData(id, 0, 0)
        } catch { /* tainted canvas — leave the frame as filmed */ }
      }

      // Shared broadcast chrome — scrims, brand bar, AI badge, ticker — drawn
      // on every live frame (bulletin content AND the filmed outro).
      const drawChrome = (t: number) => {
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
        const edLabel = edition === 'morning' ? 'MATINAL TT' : edition === 'evening' ? 'JURNALUL DE SEARĂ' : 'EDIȚIE AI'
        spaced(edLabel, `700 ${isWide ? 11 : 10}px Inter, sans-serif`, W - marginX - dW - 28, band / 2, 2)

        // 4) AI badge (glass pill, pulsing dot) — top-right under the bar
        {
          ctx.font = `600 ${11 * sc}px Inter, sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
          const label = lang === 'ro' ? 'GENERAT CU AI' : 'AI-GENERATED'
          const pad = 12 * sc, dot = 7 * sc
          const lw = ctx.measureText(label).width
          const pw = pad + dot + 7 * sc + lw + pad, ph = 24 * sc
          const px = (monitorSide === 'right' || monitorSide === 'green') ? marginX : W - marginX - pw, py = band + 14
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

      }

      const drawContent = (t: number) => {
        const vt = t - INTRO
        // 1) anchor layer — aspect-aware. A portrait/square presenter must NEVER
        // cover-fill a 16:9 frame (it decapitates the presenter and hides the
        // studio). Portrait sources render as a framed window over the studio.
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H)
        const srcAR = (v.videoWidth || 16) / (v.videoHeight || 9)
        const portraitSrc = srcAR < (W / H) * 0.85
        if (studioImg) coverDraw(ctx, studioImg, studioImg.naturalWidth || 16, studioImg.naturalHeight || 9)
        if (studioImg && greenscreen) drawAnchorKeyed()
        else if (portraitSrc) {
          if (!studioImg) {
            // no studio chosen → blurred, darkened self-backdrop (broadcast standard)
            ctx.save(); ctx.filter = 'blur(26px) brightness(0.45)'
            drawCoverFull(v); ctx.restore(); ctx.filter = 'none'
          }
          // presenter window: height set by the placement scale, position by sliders
          const wh = H * presScale, ww = wh * srcAR
          const wx = W * presX - ww / 2
          const wy = H - wh + H * presY
          ctx.save()
          ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 10
          ctx.fillStyle = '#0a0d14'; rr(ctx, wx - 6, wy - 6, ww + 12, wh + 12, 14); ctx.fill()
          ctx.restore()
          ctx.save(); rr(ctx, wx, wy, ww, wh, 10); ctx.clip()
          ctx.drawImage(v, wx, wy, ww, wh)
          ctx.restore()
          ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1
          rr(ctx, wx - 6, wy - 6, ww + 12, wh + 12, 14); ctx.stroke()
          // desk occlusion works here too
          if (studioImg && deskLine < 0.99) {
            ctx.save(); ctx.beginPath(); ctx.rect(0, H * deskLine, W, H * (1 - deskLine)); ctx.clip()
            coverDraw(ctx, studioImg, studioImg.naturalWidth || 16, studioImg.naturalHeight || 9)
            ctx.restore()
          }
        }
        else if (monitorSide === 'green') {
          // full-frame filmed studio; the story's image keyed into its green screen
          const curIdx = Math.max(0, thirds.reduce((k, th, j) => (vt >= th.start ? j : k), 0))
          okx.clearRect(0, 0, W, H)
          coverDraw(okx, v, v.videoWidth || 16, v.videoHeight || 9)
          const mImg = monitorImgs[curIdx]
          if (mImg) greenFill(mImg, mImg.naturalWidth || 16, mImg.naturalHeight || 9)
          else greenFill(brandCard, brandCard.width, brandCard.height)
          ctx.drawImage(okv, 0, 0)
        }
        else drawCoverFull(v)
        // 2-5) shared broadcast chrome (scrims, brand bar, AI badge, ticker)
        drawChrome(t)

        // 2b) in-studio monitor — the current story's article image on a framed
        // screen beside the presenter, with bezel, glare, and per-story crossfade
        if ((monitorSide === 'left' || monitorSide === 'right') && monitorImgs.length) {
          const curIdx = Math.max(0, thirds.reduce((k, th, j) => (vt >= th.start ? j : k), 0))
          const mImg = monitorImgs[curIdx]
          if (mImg) {
            const mw = isWide ? W * 0.285 : W * 0.42
            const mh = mw * 9 / 16
            const mx = monitorSide === 'left' ? marginX : W - marginX - mw
            const my = band + (isWide ? 38 : 30)
            const fade = Math.min(1, (vt - (thirds[curIdx]?.start || 0)) / 0.5)
            ctx.save(); ctx.globalAlpha = 0.55 + 0.45 * fade
            // drop shadow + bezel
            ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10
            ctx.fillStyle = '#0a0d14'; rr(ctx, mx - 8, my - 8, mw + 16, mh + 16, 12); ctx.fill()
            ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
            ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1
            rr(ctx, mx - 8, my - 8, mw + 16, mh + 16, 12); ctx.stroke()
            // screen
            ctx.save(); rr(ctx, mx, my, mw, mh, 6); ctx.clip()
            ctx.fillStyle = '#05070c'; ctx.fillRect(mx, my, mw, mh)
            const ir = (mImg.naturalWidth || 16) / (mImg.naturalHeight || 9), sr = mw / mh
            let dw2: number, dh2: number
            if (ir > sr) { dh2 = mh; dw2 = mh * ir } else { dw2 = mw; dh2 = mw / ir }
            ctx.drawImage(mImg, mx + (mw - dw2) / 2, my + (mh - dh2) / 2, dw2, dh2)
            // subtle moving glare so the screen reads as live glass
            ctx.globalCompositeOperation = 'lighter'
            const gx = mx + ((t * 0.05) % 1.4 - 0.2) * mw
            const gl = ctx.createLinearGradient(gx, my, gx + mw * 0.35, my + mh)
            gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,255,0.06)'); gl.addColorStop(1, 'rgba(255,255,255,0)')
            ctx.fillStyle = gl; ctx.fillRect(mx, my, mw, mh)
            ctx.restore()
            // crimson underline + station tag
            ctx.fillStyle = P.crimson; ctx.fillRect(mx - 8, my + mh + 8, mw + 16, 3)
            ctx.fillStyle = 'rgba(251,244,228,0.75)'; ctx.textAlign = monitorSide === 'left' ? 'left' : 'right'
            ctx.textBaseline = 'alphabetic'; ctx.font = `700 ${isWide ? 11 : 10}px Inter, sans-serif`
            spaced('TT · IMAGINEA ȘTIRII', `700 ${isWide ? 11 : 10}px Inter, sans-serif`, monitorSide === 'left' ? mx - 8 : mx + mw + 8 - 1, my + mh + 26, 1.5)
            ctx.restore(); ctx.textAlign = 'left'
          }
        }

        // 6) lower-third — crimson kicker tab over a glass headline bar, wipe-in.
        // Skipped entirely when there are no stories (a hand-written script with
        // no articles selected): an empty crimson bar with no headline in it
        // looks broken, whereas no bar at all reads as a clean full-frame shot.
        const cur = [...thirds].reverse().find(s => vt >= s.start) || thirds[0]
        // Geometry stays OUTSIDE the guard — the captions block below anchors to
        // tabY, so it must exist even when no lower-third is drawn.
        const idx = cur ? thirds.indexOf(cur) + 1 : 1
        const ltH = isWide ? 100 : 116
        const gapT = isWide ? 22 : 26
        const ltY = H - tick - gapT - ltH
        const barX = marginX, barW = W - marginX * 2
        const tabH = isWide ? 32 : 36, tabY = ltY - tabH + 3
        const hasStory = !!(cur && (cur.title || '').trim())
        if (hasStory) {
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
        }   // end lower-third (skipped when there is no story headline)

        // 7) captions above the lower-third — glass pill, active-word glow
        if (subsOn) {
          const cy0 = tabY - (isWide ? 26 : 30)
          if (capMode === 'karaoke' && karaoke.length) {
            const grp = karaoke.find(g => vt >= g.start && vt <= g.end + 0.12)
            if (grp) {
              // Mixed case, compact — reads like broadcast subtitles, not shouting.
              ctx.font = `600 ${isWide ? 21 : 22}px Inter, sans-serif`; ctx.textBaseline = 'middle'
              const gap = 8
              const widths = grp.ws.map(w => ctx.measureText(w.word).width)
              const totalW = widths.reduce((a, b) => a + b, 0) + gap * (grp.ws.length - 1)
              const lh = isWide ? 34 : 38
              glass(W / 2 - totalW / 2 - 20, cy0 - lh / 2, totalW + 40, lh, 8)
              let x = W / 2 - totalW / 2
              ctx.textAlign = 'left'
              grp.ws.forEach((w, i) => {
                const spoken = vt >= w.start
                const active = vt >= w.start && vt <= w.end
                if (active) { ctx.save(); ctx.shadowColor = 'rgba(231,201,130,0.9)'; ctx.shadowBlur = 16 }
                ctx.fillStyle = active ? P.gold : spoken ? '#FFFFFF' : 'rgba(255,255,255,.40)'
                ctx.fillText(w.word, x, cy0)
                if (active) ctx.restore()
                x += widths[i] + gap
              })
              ctx.textBaseline = 'alphabetic'
            }
          } else {
            const cue = cueList.find(c => vt >= c.start && vt <= c.end)
            if (cue) {
              ctx.font = `500 ${isWide ? 20 : 21}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
              const lines = wrapText(ctx, cue.text.trim(), W * 0.74).slice(0, 2)
              const lh = isWide ? 30 : 34
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
      // Filmed outro: the anchor wraps up and leaves the studio. The chrome
      // stays on air (real broadcasts hold the ticker through the goodbye);
      // captions and lower-thirds are gone; the studio screen shows the brand.
      const drawOutroLive = (t: number) => {
        ctx.fillStyle = '#05070c'; ctx.fillRect(0, 0, W, H)
        if (ov) {
          if (monitorSide === 'green') {
            okx.clearRect(0, 0, W, H)
            coverDraw(okx, ov, ov.videoWidth || 16, ov.videoHeight || 9)
            greenFill(brandCard, brandCard.width, brandCard.height)
            ctx.drawImage(okv, 0, 0)
          } else {
            coverDraw(ctx, ov, ov.videoWidth || 16, ov.videoHeight || 9)
          }
        }
        drawChrome(t)
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
        const a = Math.min(1, (t - INTRO - dur - outroClipDur) / 0.5)
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
      const acT0 = ac.currentTime + 0.1
      scheduleIntroSting(acT0)
      // News bed — a discreet broadcast underscore while the presenter talks:
      // warm low pad (A2+E3) + the classic newsroom pulse, ~14 dB under the
      // voice, fading in after the intro and dipping through the endcard.
      if (bedOn) {
        const bed = ac.createGain(); bed.gain.value = 0
        bed.connect(dest); bed.connect(ac.destination)
        const bT0 = acT0 + INTRO, bEnd = bT0 + dur + outroClipDur
        bed.gain.setValueAtTime(0, bT0)
        bed.gain.linearRampToValueAtTime(bedLevel, bT0 + 1.4)
        bed.gain.setValueAtTime(bedLevel, Math.max(bT0 + 1.4, bEnd - 1.0))
        bed.gain.linearRampToValueAtTime(bedLevel * 0.4, bEnd + 0.6)       // dip under the endcard
        bed.gain.setValueAtTime(bedLevel * 0.4, bEnd + Math.max(0, OUTRO - 1.4))
        bed.gain.linearRampToValueAtTime(0, bEnd + OUTRO - 0.15)
        // pad: two detuned A2 + a fifth (E3) through a lowpass, slow breathing LFO.
        // Levels raised ~2× from the first pass — the old bed measured ~-21 dB
        // under the voice and was inaudible in practice ("no background sound").
        // This sits it ~-14 dB under speech: a present broadcast underscore.
        const padLp = ac.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 460
        const padG = ac.createGain(); padG.gain.value = 0.30
        padLp.connect(padG); padG.connect(bed)
        ;[110, 110.6, 164.8].forEach((f, i) => {
          const o = ac.createOscillator(); o.type = i < 2 ? 'triangle' : 'sine'; o.frequency.value = f
          const g = ac.createGain(); g.gain.value = i < 2 ? 0.13 : 0.08
          o.connect(g); g.connect(padLp); o.start(bT0); o.stop(bEnd + OUTRO)
        })
        const lfo = ac.createOscillator(); lfo.frequency.value = 0.11
        const lfoG = ac.createGain(); lfoG.gain.value = 0.05
        lfo.connect(lfoG); lfoG.connect(padG.gain); lfo.start(bT0); lfo.stop(bEnd + OUTRO)
        // pulse: 2-second looped buffer with the news "tick" pattern (efficient — one node)
        const sr = ac.sampleRate
        const pb = ac.createBuffer(1, Math.floor(sr * 2), sr)
        const ch = pb.getChannelData(0)
        const pluck = (at: number, freq: number, amp: number, decay: number) => {
          const start = Math.floor(at * sr), len = Math.floor(decay * sr)
          for (let i = 0; i < len && start + i < ch.length; i++) {
            ch[start + i] += Math.sin(2 * Math.PI * freq * (i / sr)) * amp * Math.exp(-i / (sr * decay * 0.3))
          }
        }
        // Edition mood: morning = brighter, major-feel plucks; evening = the
        // sober default. Same rhythm, different color.
        const bf = edition === 'morning' ? [523.25, 784, 784, 784, 1046.5] : [440, 660, 660, 660, 880]
        pluck(0.0, bf[0], 0.16, 0.14)   // downbeat, lower
        pluck(0.5, bf[1], 0.10, 0.10)
        pluck(1.0, bf[2], 0.12, 0.10)
        pluck(1.5, bf[3], 0.10, 0.10)
        pluck(1.75, bf[4], 0.05, 0.07)  // light pickup into the next bar
        const pulse = ac.createBufferSource(); pulse.buffer = pb; pulse.loop = true
        const pulseG = ac.createGain(); pulseG.gain.value = 0.8
        const pulseHp = ac.createBiquadFilter(); pulseHp.type = 'highpass'; pulseHp.frequency.value = 300
        pulse.connect(pulseHp); pulseHp.connect(pulseG); pulseG.connect(bed)
        pulse.start(bT0); pulse.stop(bEnd + OUTRO)
      }
      const t0 = performance.now()
      let started = false
      let ovStarted = false
      await new Promise<void>(resolve => {
        const loop = () => {
          const t = (performance.now() - t0) / 1000
          setCompPct(Math.min(99, Math.round((t / total) * 100)))
          if (t < INTRO) drawIntro(t)
          else if (t < INTRO + dur) {
            if (!started) { started = true; ac.resume(); v.play().catch(() => {}) }
            drawContent(t)
          } else if (t < INTRO + dur + outroClipDur) {
            if (!ovStarted) { ovStarted = true; v.pause(); ov?.play().catch(() => {}) }
            drawOutroLive(t)
          } else { v.pause(); ov?.pause(); drawOutro(t) }
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
          anchor_video_url: vidUrl, bulletin_video_url: publicUrl || null, voice_url: voiceUrl, status: 'rendered',
        }).select('id').single()
        if (row?.id) setSavedId(String(row.id))
      } catch { /* archive optional */ }
    } catch (e) {
      setError('Compunerea a eșuat: ' + (e as Error).message)
    } finally { setCompositing(false); setCompStage('') }
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
  function loadImage(srcUrl: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
    return new Promise((res) => {
      const img = new Image(); img.crossOrigin = 'anonymous'
      let done = false
      const finish = (v: HTMLImageElement | null) => { if (done) return; done = true; res(v) }
      const timer = setTimeout(() => finish(null), timeoutMs)   // never let one slow URL stall a compose
      img.onload = () => { clearTimeout(timer); finish(img) }
      img.onerror = () => { clearTimeout(timer); finish(null) }
      img.src = srcUrl
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

      {/* ── AUTOPILOT — the two-click daily flow ─────────────────────────── */}
      <div className="mb-6 bg-gradient-to-r from-[#1c0f12] to-[#16161a] border border-brand-red/30 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="min-w-[240px]">
            <p className="font-sans text-[14px] font-bold text-white flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-brand-red" /> Buletin automat
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="inline-flex items-stretch">
                <button onClick={() => loadEdition('morning')}
                  className={'px-3 py-1.5 text-[12px] font-bold border ' + (edition === 'morning' ? 'bg-amber-400/20 border-amber-300/60 text-amber-200' : presetsAvail.morning ? 'bg-[#111] border-white/15 text-white/70 hover:border-amber-300/50' : 'bg-[#111] border-white/[0.07] text-white/30')}>
                  🌅 Matinal TT
                </button>
                {presetsAvail.morning && (
                  <button onClick={() => deleteEdition('morning')} title="Șterge ediția de dimineață"
                    className="px-1.5 border border-l-0 border-white/15 text-white/40 hover:text-red-400 hover:border-red-400/50 text-[11px]">✕</button>
                )}
              </span>
              <span className="inline-flex items-stretch">
                <button onClick={() => loadEdition('evening')}
                  className={'px-3 py-1.5 text-[12px] font-bold border ' + (edition === 'evening' ? 'bg-indigo-400/20 border-indigo-300/60 text-indigo-200' : presetsAvail.evening ? 'bg-[#111] border-white/15 text-white/70 hover:border-indigo-300/50' : 'bg-[#111] border-white/[0.07] text-white/30')}>
                  🌆 Jurnalul de Seară
                </button>
                {presetsAvail.evening && (
                  <button onClick={() => deleteEdition('evening')} title="Șterge ediția de seară"
                    className="px-1.5 border border-l-0 border-white/15 text-white/40 hover:text-red-400 hover:border-red-400/50 text-[11px]">✕</button>
                )}
              </span>
              <span className="text-[10.5px] text-white/30">salvează setarea curentă ca:</span>
              <button onClick={() => saveEdition('morning')} className="text-[10.5px] text-white/50 underline hover:text-amber-200">dimineață</button>
              <button onClick={() => saveEdition('evening')} className="text-[10.5px] text-white/50 underline hover:text-indigo-200">seară</button>
              <span className="text-[10.5px] text-white/30 ml-2">· creează automat cu AI:</span>
              <button onClick={() => setupEdition('morning')} disabled={!!setupBusy}
                className="flex items-center gap-1 text-[10.5px] font-bold text-amber-200/90 border border-amber-300/30 px-2 py-1 hover:border-amber-300/70 disabled:opacity-50">
                {setupBusy === 'morning' ? <Loader2 className="w-3 h-3 animate-spin" /> : '🌅'} dimineața · Aoede
              </button>
              <button onClick={() => setupEdition('evening')} disabled={!!setupBusy}
                className="flex items-center gap-1 text-[10.5px] font-bold text-indigo-200/90 border border-indigo-300/30 px-2 py-1 hover:border-indigo-300/70 disabled:opacity-50">
                {setupBusy === 'evening' ? <Loader2 className="w-3 h-3 animate-spin" /> : '🌆'} seara · Zephyr
              </button>
              {setupStage && <span className="text-[10.5px] text-amber-200/90">{setupStage}</span>}
              {presetMsg && <span className="text-[10.5px] text-sky-300/80">{presetMsg}</span>}
            </div>
            <p className="text-[12px] text-white/45 mt-1 max-w-xl">
              Un click face tot: scriptul din știrile selectate → vocea → prezentatorul → buletinul TV complet.
              Folosește setările salvate (prezentator, platou, voce) — le configurezi o singură dată în pasul 4.
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              {anchorVideo
                ? <video src={anchorVideo + '#t=0.1'} preload="metadata" muted playsInline className="w-10 h-10 object-cover border border-white/10" />
                : anchorImg
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img src={anchorImg} alt="Prezentator" className="w-10 h-10 object-cover border border-white/10" />
                  : <span className="text-[11px] text-amber-300/80">fără prezentator setat — pasul 4</span>}
              {studioBg && /* eslint-disable-next-line @next/next/no-img-element */
                <img src={studioBg} alt="Platou" className="w-16 h-10 object-cover border border-white/10" />}
              <span className="text-[11px] text-white/35">{sel.size} știri · voce {elConfigured ? 'ElevenLabs' : geminiVoice} · {tone}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <button onClick={autoBulletin} disabled={!!autoStage && autoStage !== 'done'}
              className="flex items-center gap-2 bg-brand-red text-white text-[13px] font-bold px-5 py-3 hover:bg-red-700 disabled:opacity-50">
              {autoStage && autoStage !== 'done' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
              {autoStage && autoStage !== 'done' ? 'Lucrez…' : 'Generează buletinul'}
            </button>
            {(autoStage || compositing) && (
              <div className="flex items-center gap-1.5 text-[10.5px]">
                {[['script', 'Script'], ['voice', 'Voce'], ['anchor', 'Prezentator'], ['compose', 'Buletin TV']].map(([k, label]) => {
                  const order = ['script', 'voice', 'anchor', 'compose', 'done']
                  const idx = order.indexOf(autoStage || 'script'), me = order.indexOf(k)
                  const doneStep = idx > me || autoStage === 'done'
                  const active = autoStage === k
                  return (
                    <span key={k} className={'px-2 py-0.5 border ' + (doneStep ? 'border-green-500/40 text-green-400' : active ? 'border-brand-red text-white' : 'border-white/10 text-white/30')}>
                      {doneStep ? '✓ ' : active ? '● ' : ''}{label}{active && k === 'compose' && compPct > 0 ? ` ${compPct}%` : ''}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>
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
              <option value={45}>~45s · 2-3 știri</option>
              <option value={75}>~75s · 4-5 știri</option>
              <option value={110}>~110s · 6-8 știri</option>
              <option value={150}>~2:30 · 9-11 știri</option>
              <option value={210}>~3:30 · 12-16 știri</option>
              <option value={300}>~5:00 · 17-20 știri</option>
            </select>
            <span className="text-[11px] text-white/40">{sel.size} selectate · ultimele 24h</span>
            {/* Each story needs ~25 spoken words to be worth airing; Romanian
                runs ~2.3 words/second. If the chosen duration cannot carry the
                selection, the model drops stories — so say so up front. */}
            {sel.size > 0 && Math.round(target * (lang === 'ro' ? 2.3 : 2.5)) < sel.size * 25 + 25 && (
              <span className="text-[11px] text-amber-300/90">
                ⚠ {sel.size} știri nu încap în {target}s — alege ~{Math.max(45, Math.ceil((sel.size * 25 + 25) / (lang === 'ro' ? 2.3 : 2.5) / 15) * 15)}s sau mai puține știri
              </span>
            )}
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
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <input value={elVoice} onChange={e => setElVoice(e.target.value)}
              placeholder="Voce românească — ID ElevenLabs (ex: znn3xed…) sau nume"
              title="Un ID de voce (20 de caractere) merge prin contul TĂU ElevenLabs și are nevoie de ELEVENLABS_API_KEY. Un nume de voce premade merge prin fal."
              className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 w-72" />
            <button onClick={loadElVoices} type="button"
              className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/60 text-[11.5px] px-2.5 py-1.5 hover:border-white/30">
              <RefreshCw className="w-3.5 h-3.5" /> reîncarcă vocile
            </button>
            {elVoice.trim()
              ? /^[A-Za-z0-9]{20}$/.test(elVoice.trim())
                ? <span className="text-[10.5px] text-green-400/85">ID de voce · contul tău ElevenLabs {elConfigured ? '✓ cheie detectată' : '⚠ ELEVENLABS_API_KEY lipsește'}</span>
                : <span className="text-[10.5px] text-sky-300/80">nume de voce · prin fal (~$0.10 / 1.000 caractere)</span>
              : <span className="text-[10.5px] text-amber-300/80">⚠ gol = voce englezească cu accent. Pune vocea românească aici.</span>}
          </div>
          {voiceDiag && (
            <p className={'text-[10.5px] mb-2 ' + (elConfigured ? 'text-white/40' : 'text-amber-300/85')}>
              {elConfigured ? '✓ ' : '⚠ '}{voiceDiag}
              {!elConfigured && <> · adaug-o în <b>Supabase → Project Settings → Edge Functions → Secrets</b>, apoi apasă „reîncarcă vocile”.</>}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {elConfigured ? (
              <>
                <select value={voiceId} onChange={e => setVoiceId(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 max-w-[180px]">
                  {elVoices.map(v => <option key={v.provider + ':' + v.voice_id} value={v.voice_id}>{v.category === 'cloned' ? '👤 ' : ''}{v.name}{v.provider === 'minimax' ? ' · fal' : ''}</option>)}
                </select>
                <select value={tone} onChange={e => setTone(e.target.value)} className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
                  {TONES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
              </>
            ) : (
              <>
                <select value={geminiVoice} onChange={e => setGeminiVoice(e.target.value)} disabled={!!elVoice.trim()}
                  className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 disabled:opacity-40">
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
                {elVoice.trim()
                  ? <span className="text-[10.5px] text-green-400/80">voce ElevenLabs „{elVoice.trim()}” prin fal · ~$0.10 / 1.000 caractere</span>
                  : <span className="text-[10.5px] text-amber-300/80">⚠ accent englezesc: vocile Gemini și cele implicite (Sarah/George) sunt înregistrate în engleză. Pune o voce <b>românească</b> în câmpul din stânga.</span>}
              </>
            )}
            <select value={pauseMs} onChange={e => setPauseMs(Number(e.target.value))}
              title="Pauză între știri. Motoarele TTS ignoră rândurile goale, așa că pauza se adaugă automat, per motor, la generare."
              className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5">
              {[
                { v: 0,    l: 'fără pauză între știri' },
                { v: 500,  l: 'pauză 0,5 s între știri' },
                { v: 700,  l: 'pauză 0,7 s între știri' },
                { v: 1000, l: 'pauză 1,0 s între știri' },
                { v: 1500, l: 'pauză 1,5 s între știri' },
              ].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <button onClick={() => genVoice()} disabled={!!busy} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {busy === 'voice' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />} Generează vocea
            </button>
          </div>
          {voiceUsed && (
            <p className={'text-[11px] mt-2 ' + (voiceUsed.includes('✓') ? 'text-green-400/85' : 'text-amber-300/85')}>
              motor folosit: {voiceUsed}
            </p>
          )}
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
                <p className="text-[12px] text-white/70 font-semibold">Clipuri de prezentator (recomandat — lipsync profesional)</p>
                <p className="text-[10.5px] text-white/35">Încarcă un clip MP4 cu prezentatorul în studio (ca cele de stoc). Motorul sincronizează DOAR buzele pe vocea generată — studioul, gesturile și lumina rămân reale. Calitate net superioară animării unei fotografii.</p>
                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto pr-1">
                  {anchorVideo === '' && libVideos.length === 0 && <p className="col-span-full text-[11.5px] text-white/30">Niciun clip salvat încă.</p>}
                  {libVideos.map(a => (
                    <div key={a.id} className="relative group">
                      <button onClick={() => { setAnchorVideo(anchorVideo === a.url ? '' : a.url) }}
                        className={'border overflow-hidden w-full ' + (anchorVideo === a.url ? 'border-brand-red' : 'border-white/[0.07] hover:border-white/30')}>
                        <video src={a.url + '#t=0.1'} preload="metadata" muted playsInline className="w-full aspect-square object-cover" />
                        <span className="block text-[9.5px] text-white/50 px-1 py-0.5 truncate">{a.name}</span>
                      </button>
                      <button onClick={() => deleteLibraryAsset(a.id)} title="Șterge"
                        className="absolute top-1 right-1 bg-black/70 text-white/80 hover:text-white text-[10px] w-5 h-5 rounded-full opacity-0 group-hover:opacity-100">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input value={libVideoName} onChange={e => setLibVideoName(e.target.value)} placeholder="Nume clip"
                    className="bg-[#111] border border-white/[0.07] text-white/90 text-[12px] px-2 py-1.5 w-44" />
                  <label className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 text-[12px] font-bold px-3 py-1.5 cursor-pointer hover:border-white/20 w-fit">
                    {busy === 'lib' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Adaugă clip prezentator (MP4)
                    <input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" hidden onChange={e => { uploadLibraryAsset(e.target.files?.[0], 'presenter_video', libVideoName); e.currentTarget.value = '' }} />
                  </label>
                  <button onClick={genPresenterClip} disabled={!!busy || !anchorImg} title={anchorImg ? 'Animă portretul selectat într-un clip idle de 10s (Kling)' : 'Alege întâi un portret mai jos'}
                    className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-1.5 hover:bg-red-700 disabled:opacity-40">
                    {busy === 'genclip' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Generează clip din portret (AI)
                  </button>
                  {anchorVideo && <span className="text-[11px] text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> clip selectat — se folosește lipsync video (sync.so)</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11.5px] text-white/55">Clip outro (finalul emisiei — prezentatorul se ridică și pleacă):</span>
                  <select value={outroVideo} onChange={e => setOutroVideo(e.target.value)}
                    className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1.5 max-w-[220px]">
                    <option value="">fără</option>
                    {libVideos.map(a => <option key={'o' + a.id} value={a.url}>{a.name}</option>)}
                  </select>
                  {outroVideo && <span className="text-[10.5px] text-green-400/80">se redă după semnătura de final, înaintea endcard-ului — cu ticker și branding active</span>}
                </div>
              </div>
            )}

            {!hgConfigured && (
              <div className="space-y-2">
                <p className="text-[12px] text-white/70 font-semibold">Prezentatori salvați (portrete — fallback)</p>
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
                {libError && <p className="text-[11.5px] text-brand-red">{libError}</p>}
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
              {studioBg && (
                <div className="border border-white/[0.07] p-3 space-y-3 max-w-xl">
                  <p className="text-[11px] uppercase tracking-wider text-white/40 font-bold">Așezarea prezentatorului în platou {greenscreen ? '· decupaj verde' : '· fereastră cadru'}</p>
                  <canvas ref={placementPreviewRef} className="w-full border border-white/[0.07] bg-black" />
                  <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-[11.5px] text-white/55">
                    <label className="flex items-center gap-2">mărime
                      <input type="range" min={0.4} max={1.3} step={0.01} value={presScale} onChange={e => setPresScale(Number(e.target.value))} className="flex-1 accent-red-600" />
                    </label>
                    <label className="flex items-center gap-2">stânga–dreapta
                      <input type="range" min={0.15} max={0.85} step={0.01} value={presX} onChange={e => setPresX(Number(e.target.value))} className="flex-1 accent-red-600" />
                    </label>
                    <label className="flex items-center gap-2">coborâre
                      <input type="range" min={-0.1} max={0.4} step={0.01} value={presY} onChange={e => setPresY(Number(e.target.value))} className="flex-1 accent-red-600" />
                    </label>
                    <label className="flex items-center gap-2">linia biroului
                      <input type="range" min={0.4} max={1} step={0.01} value={deskLine} onChange={e => setDeskLine(Number(e.target.value))} className="flex-1 accent-red-600" />
                    </label>
                  </div>
                  <p className="text-[10.5px] text-white/30 leading-snug">Linia punctată aurie = linia biroului: tot ce e sub ea din platou se desenează <b>peste</b> prezentator, deci bustul „stă” în spatele biroului. Trage prezentatorul în jos („coborâre”) până sub linie, ca marginea tăiată a bustului să fie ascunsă de birou. Setările se salvează automat.</p>
                </div>
              )}
            </div>
          </div>
        </Step>

        <Step n={5} icon={Film} title="Videoul" done={!!videoUrl}>
          {/* COST CONTROL — fal bills lipsync per minute of output and the tiers
              differ by >10×. The price is shown BEFORE spending, never after. */}
          <div className="border border-white/[0.07] bg-[#0d0d0f] p-3 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11.5px] text-white/55">motor lipsync:</span>
              {([
                ['economic', 'LatentSync', 0.30],
                ['veed', 'VEED', 0.40],
                ['standard', 'sync 1.9', 0.70],
                ['bun', 'sync v2', 3.00],
                ['premium', 'sync v3', 8.00],
              ] as const).map(([k, label, usd]) => (
                <button key={k} onClick={() => setQuality(k)}
                  className={'px-2.5 py-1.5 text-[11.5px] border ' + (quality === k ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07] hover:border-white/25')}>
                  {label} · ${usd.toFixed(2)}/min
                </button>
              ))}
            </div>
            <p className="text-[11px] text-amber-300/80 mt-2">
              Cost estimat pentru acest buletin: <b>${estLipsyncCost.usd.toFixed(2)}</b>{' '}
              (~{estLipsyncCost.min.toFixed(1)} min × ${estLipsyncCost.rate.toFixed(2)}/min).
              {quality !== 'economic' && <> Pe LatentSync ar costa ${(estLipsyncCost.min * 0.30).toFixed(2)}.</>}
            </p>
            <p className="text-[10.5px] text-white/35 mt-1">
              Toate acestea sunt motoare de <b>redub</b>: schimbă doar gura pe clipul tău. Niciunul nu inventează
              gesturi — naturalețea vine din clipul-sursă. Plătești în plus doar pentru acuratețea fonemelor.
            </p>
            {anchorVideo && (
              <label className="flex items-start gap-2 text-[11.5px] text-white/60 cursor-pointer mt-2 leading-snug">
                <input type="checkbox" checked={trackMode} onChange={e => setTrackMode(e.target.checked)} className="mt-0.5" />
                <span><b>Pistă regizată</b> (recomandat) — dacă vocea e mai lungă decât clipul, clipul e re-montat pe lungimea vocii <b>înainte</b> de lipsync: tăietură la fiecare știre + cadru strâns alternat, ca o regie TV reală. Fără bucle, fără gesturi repetate. Montajul rulează gratuit în browser, în timp real (~durata buletinului) — nu schimba fila cât apare „pistă regizată N%”.</span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {(['16:9', '9:16'] as const).map(o => (
              <button key={o} onClick={() => setOrient(o)} className={'px-3 py-1.5 text-[12px] border ' + (orient === o ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>{o === '16:9' ? '16:9 · YouTube/FB' : '9:16 · Reels/TikTok'}</button>
            ))}
            <button onClick={genVideoAndCompose} disabled={working || compositing || (hgConfigured === false && !falConfigured)} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {working ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {videoStatus}…</> : compositing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> brand-uiesc…</> : <><Film className="w-3.5 h-3.5" /> Generează buletinul finit</>}
            </button>
            <button onClick={() => genVideo()} disabled={working || compositing || (hgConfigured === false && !falConfigured)} title="Doar clipul brut, fără branding — pentru verificare" className="flex items-center gap-1.5 bg-[#111] text-white/50 text-[11.5px] px-2.5 py-2 border border-white/[0.07] hover:text-white/80 disabled:opacity-50">
              doar clip brut
            </button>
            {working && <button onClick={() => setVideoStatus('')} className="text-white/30 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>}
          </div>
          {working && <p className="text-[11px] text-white/40">{hgConfigured ? 'HeyGen' : anchorVideo ? 'Lipsync video (sync.so, fal)' : 'SadTalker (fal)'} randează lipsync-ul — de obicei 1–4 minute. Poți lăsa pagina deschisă.</p>}
          {!hgConfigured && falConfigured && <p className="text-[10.5px] text-white/30 mb-2">Motorul liber livrează formatul portretului (pătrat/portret). 9:16/16:9 exacte sunt disponibile pe motorul premium.</p>}
          {videoUrl && (
            <div className="border border-amber-500/30 max-w-md">
              <div className="bg-amber-500/10 text-amber-200/90 text-[11px] px-3 py-2 leading-snug">
                <b>Clip brut (intermediar).</b> Fără ticker, fără monitor cu imaginea știrii, fără branding Transilvania Times, fără categorie. Toate acestea se adaugă la <b>pasul 6 — „Compune buletinul TV”</b>. Nu publica acest clip ca atare.
              </div>
              <video src={videoUrl} controls preload="metadata" className="w-full" />
              <a href={videoUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-1.5 bg-[#111] text-white/60 text-[11.5px] py-2.5 hover:bg-black">
                <Download className="w-3.5 h-3.5" /> Descarcă clipul brut (fără branding)
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
            <label className="flex items-center gap-1.5 text-[11.5px] text-white/55 cursor-pointer">
              <input type="checkbox" checked={bedOn} onChange={e => setBedOn(e.target.checked)} /> fundal sonor
              <select value={String(bedLevel)} onChange={e => setBedLevel(Number(e.target.value))} disabled={!bedOn}
                className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-1.5 py-1">
                <option value="0.35">discret</option>
                <option value="0.6">normal</option>
                <option value="0.9">prezent</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11.5px] text-white/55">
              monitor imagine știre:
              <select value={monitorSide} onChange={e => setMonitorSide(e.target.value as 'left' | 'right' | 'off' | 'green')}
                className="bg-[#111] border border-white/[0.07] text-white/70 text-[12px] px-2 py-1">
                <option value="right">dreapta (suprapus)</option>
                <option value="left">stânga (suprapus)</option>
                <option value="green">ecranul verde din clip</option>
                <option value="off">fără</option>
              </select>
            </label>
            <button onClick={() => composeBulletin()} disabled={compositing || !videoUrl} className="flex items-center gap-1.5 bg-brand-red text-white text-[12px] font-bold px-3 py-2 hover:bg-red-700 disabled:opacity-50">
              {compositing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {compPct > 0 ? `Compun… ${compPct}%` : (compStage || 'pregătesc…')}</> : <><Clapperboard className="w-3.5 h-3.5" /> Compune buletinul TV</>}
            </button>
          </div>
          {compositing && <p className="text-[11px] text-amber-300/80">⚠ Randare în timp real — durează cât clipul finit. <b>Nu schimba fila și nu minimiza fereastra</b>, altfel browserul oprește randarea și pare blocată. Dacă procentul stă pe loc la 0%, o imagine de copertă se încarcă greu — pune monitorul pe „fără”.</p>}
          <canvas ref={canvasRef} className="w-full max-w-md bg-black border border-white/[0.07]" style={{ display: compositing || bulletinUrl ? 'block' : 'none' }} />
          {bulletinUrl && (
            <div className="border border-white/[0.07] max-w-md mt-3">
              <video src={bulletinUrl} controls preload="metadata" className="w-full" />
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
