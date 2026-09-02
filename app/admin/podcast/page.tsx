'use client'

// app/admin/podcast/page.tsx
//
// PODCAST — the editing station.
//
// WHY THIS PAGE WAS REWRITTEN.
//
// The previous version computed an edit and never showed it to anybody. It
// printed "38 tăieturi · 214.6s scoase" and gave you no way to see which 38,
// hear one, disagree with one, or make a thirty-ninth. Asked "how do I cut?",
// the only true answer was "you don't — it cuts, and you hope". That is not an
// editor; it is a report about an editor that does not exist.
//
// THE INTERFACE IS THE TRANSCRIPT.
//
// Speech is edited by reading, not by looking at a waveform. The unit a person
// reasons about is a sentence, so: the transcript is the timeline. Click a word
// to hear it. Drag across words and press Taie, and they leave the episode,
// struck through so you can see what you did and put it back. The automatic
// passes — fillers, long pauses — are the same kind of object as your own cuts,
// which is why you can overrule any one of them individually instead of taking
// the whole pass or none of it.
//
// Everything below produces `Cut[]`. `keptRanges` turns that into what survives
// and `buildEpisodeProject` turns that into a film, so the preview, the MP3, the
// video and the captions cannot disagree about where the cuts are — there is
// one cut list and they all read it.
//
// THE FIVE STAGES ARE NUMBERED AND THE LOCKS EXPLAIN THEMSELVES.
//
// The old page showed four panels of equal weight with no order and no hint of
// which came first. Stages here are numbered, the current one is open, and a
// locked one says WHY in a sentence rather than presenting a disabled button.
//
// WHAT THE PLAYER IS PLAYING, BECAUSE IT MATTERS.
//
// It plays the ORIGINAL recording, so a word's timestamp is where that word
// actually is in the file and a click seeks exactly. "Redă montajul" then skips
// the cut ranges live, which is a preview of the edit rather than a rendering of
// it. The finished episode is retimed by `buildEpisodeProject`; nothing here
// retimes the source, because a player fed retimed timestamps seeks to the
// wrong place in the original file and the error grows with every cut.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Check, Clapperboard, Download, FileAudio, FileText, Film, Loader2, Lock,
  Mic, Pause, Play, Redo2, Scissors, Sparkles, Trash2, Undo2, Wand2, Zap,
} from 'lucide-react'

import { Panel, Note, fmt, uid } from '../components/ProductionChrome'
import { buildClipProject, cuesFromWords } from '@/lib/podcast/clip'
import { buildEpisodeProject, keptRanges } from '@/lib/podcast/episode'
import {
  DEFAULT_SETTINGS, EMPTY_EDIT, addCut, asCuts, commit, cutAtWord, cutWordRange,
  editSummary, effectiveCuts, newHistory, paragraphs, redo, restore, undo,
  wordStatuses, type Edit, type History, type WordStatus,
} from '@/lib/podcast/edit'
import {
  chapterLines, chaptersJson, fullDescription, parseShowNotes, showNotesPrompt,
  transcriptText, transcriptWithTimecodes, timecode, type Chapter, type ShowNotes,
} from '@/lib/podcast/deliver'
import { TT_KIT } from '@/lib/brand/kit'
import {
  createRenderBody, isFailure, isFinished, rowTimeline, statusRenderBody,
} from '@/lib/campaign/build'
import {
  CHUNK_SECONDS, MAX_UPLOAD_BYTES, OVERLAP_SECONDS, encodeWav, monoSlice,
} from '@/lib/media/wav'
import {
  AUDIO_PRESETS, SEPARATION_MIN, SYNC_CONFIDENCE_MIN, alignOffset, assignSpeakers,
  chapters as findChapters, findClips, planChunks, retime,
  separationOf, speakerCuts, stitch, toSRT, toVTT, FPS,
} from '@/lib/timeline'

interface Track {
  id: string; url: string; name: string
  kind: 'camera' | 'mic'; speaker: string
  offset?: number; confidence?: number
  /** dB trim, so two lapels can be balanced against each other. */
  trimDb?: number
}

type Word = { word: string; start: number; end: number; speaker?: string }

interface RenderState { job: string; state: string; url?: string; error?: string }

type StageId = 1 | 2 | 3 | 4 | 5

const STAGES: { id: StageId; label: string; note: string }[] = [
  { id: 1, label: 'Piste', note: 'Fișierele și alinierea lor.' },
  { id: 2, label: 'Transcriere', note: 'Cuvintele, cu timpii lor.' },
  { id: 3, label: 'Montaj', note: 'Tai citind. Aici se face episodul.' },
  { id: 4, label: 'Sunet', note: 'Volum, procesare, muzică.' },
  { id: 5, label: 'Livrare', note: 'MP3, video, subtitrări, capitole, clipuri.' },
]

export default function PodcastPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  const db = useMemo(() => supabase as unknown as SupabaseClient, [supabase])

  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')
  const [stage, setStage] = useState<StageId>(1)

  const upload = useCallback(async (file: Blob, name: string) => {
    const p = `podcast/${Date.now()}_${name}`
    const { error: e } = await supabase.storage.from('studio-assets')
      .upload(p, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (e) throw new Error(e.message)
    return supabase.storage.from('studio-assets').getPublicUrl(p).data.publicUrl
  }, [supabase])

  // ══ THE SESSION ══════════════════════════════════════════════════════════
  const [tracks, setTracks] = useState<Track[]>([])
  const [words, setWords] = useState<Word[]>([])
  const [podDur, setPodDur] = useState(0)
  const [separation, setSeparation] = useState(0)
  const [title, setTitle] = useState('')

  // ══ THE EDIT ═════════════════════════════════════════════════════════════
  //
  // One history, one present edit. Every mutation goes through `change` so undo
  // is not something that has to be remembered at each call site.
  const [history, setHistory] = useState<History>(() => newHistory(EMPTY_EDIT))
  const edit = history.present
  const change = useCallback((next: Edit) => setHistory(h => commit(h, next)), [])

  const cuts = useMemo(() => effectiveCuts(words, edit), [words, edit])
  const plainCuts = useMemo(() => asCuts(cuts), [cuts])
  const statuses = useMemo(() => wordStatuses(words, edit), [words, edit])
  const blocks = useMemo(() => paragraphs(words), [words])
  const summary = useMemo(() => editSummary(words, edit, podDur), [words, edit, podDur])
  const kept = useMemo(() => podDur > 0 ? keptRanges(plainCuts, podDur) : [], [plainCuts, podDur])
  const editedWords = useMemo(() => words.length ? retime(words, plainCuts) : [], [words, plainCuts])
  const chapterList: Chapter[] = useMemo(
    () => editedWords.length
      ? findChapters(editedWords).map(c => ({ start: c.start, title: String(c.text).slice(0, 70) }))
      : [],
    [editedWords])
  const socialClips = useMemo(
    () => editedWords.length ? findClips(editedWords, { want: 10 }) : [], [editedWords])
  const switches = useMemo(
    () => editedWords.length ? speakerCuts(editedWords) : [], [editedWords])
  const cameras = useMemo(() => tracks.filter(t => t.kind === 'camera'), [tracks])
  const speakers = useMemo(
    () => [...new Set(tracks.map(t => t.speaker).filter(Boolean))], [tracks])

  // ══ SOUND SETTINGS ═══════════════════════════════════════════════════════
  const [loudness, setLoudness] = useState<'podcast' | 'broadcast' | 'social' | 'none'>('podcast')
  const [voicePreset, setVoicePreset] = useState<string>('voice')
  const [musicUrl, setMusicUrl] = useState('')
  const [musicVol, setMusicVol] = useState(0.12)

  // ══ 1. TRACKS ════════════════════════════════════════════════════════════
  const envelopeOf = useCallback(async (url: string, hz = 100) => {
    const AC = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
    const ch = buf.getChannelData(0)
    const per = Math.max(1, Math.round(buf.sampleRate / hz))
    const out: number[] = []
    for (let i = 0; i + per <= ch.length; i += per) {
      let acc = 0
      for (let j = 0; j < per; j++) acc += ch[i + j] * ch[i + j]
      out.push(Math.sqrt(acc / per))
    }
    await ctx.close()
    return { env: out, seconds: buf.duration }
  }, [])

  const align = useCallback(async (list?: Track[]) => {
    const src = list ?? tracks
    if (src.length < 2) { setError('Alinierea are nevoie de cel puțin două piste.'); return src }
    setBusy('aliniere')
    try {
      const first = await envelopeOf(src[0].url)
      setPodDur(first.seconds)
      const next = [...src]
      next[0] = { ...next[0], offset: 0, confidence: 1 }
      for (let i = 1; i < src.length; i++) {
        setProgress(`aliniez pista ${i + 1}/${src.length}`)
        const other = await envelopeOf(src[i].url)
        const r = alignOffset(first.env, other.env, { hz: 100 })
        next[i] = { ...next[i], offset: r.shiftBBySeconds, confidence: r.confidence }
      }
      setTracks(next)
      return next
    } catch (err) { setError((err as Error).message); return src }
    finally { setBusy(''); setProgress('') }
  }, [tracks, envelopeOf])

  // ══ 2. TRANSCRIPT ════════════════════════════════════════════════════════
  const transcribe = useCallback(async (list?: Track[]) => {
    const src = list ?? tracks
    const mic = src.find(t => t.kind === 'mic') || src[0]
    if (!mic) { setError('Încarcă întâi cel puțin o pistă.'); return }
    setBusy('transcriere')
    try {
      const AC = window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AC()
      const decoded = await ctx.decodeAudioData(await (await fetch(mic.url)).arrayBuffer())
      const duration = decoded.duration
      setPodDur(duration)

      const plan = planChunks(duration, { chunkSeconds: CHUNK_SECONDS, overlapSeconds: OVERLAP_SECONDS })
      const parts: { chunk: typeof plan[number]; words: Word[] }[] = []

      for (const chunk of plan) {
        setProgress(`transcriu bucata ${chunk.index + 1}/${plan.length}`)
        const samples = monoSlice(decoded, chunk.start, chunk.start + chunk.seconds)
        const blob = encodeWav(samples)
        if (blob.size > MAX_UPLOAD_BYTES) {
          throw new Error(`bucata ${chunk.index + 1} are ${Math.round(blob.size / 1e6)} MB, ` +
            'peste limita serviciului de transcriere')
        }
        const url = await upload(blob, `chunk-${chunk.index}.wav`)
        // snake_case: the deployed function reads `audio_url`.
        const { data, error: e } = await db.functions.invoke('align-subtitles', {
          body: { audio_url: url, language: 'ro' },
        })
        if (e) throw new Error(e.message)
        const ws = ((data as { words?: { word: string; start: number; end: number }[] })?.words) || []
        parts.push({ chunk, words: ws.map(w => ({ ...w, speaker: mic.speaker })) })
      }

      let all = stitch(parts)

      // WHO IS SPEAKING, WITHOUT A DIARISER. With a lapel on each speaker the
      // person talking is the one whose OWN microphone is loud; every other
      // track hears them across the room, quieter.
      const mics = src.filter(t => t.kind === 'mic' && t.speaker)
      if (mics.length > 1) {
        setProgress('atribui vorbitorii')
        const HZ = 100
        const envelopes = []
        for (const m of mics) {
          const { env } = await envelopeOf(m.url, HZ)
          const shift = Math.round((m.offset ?? 0) * HZ)
          const aligned = shift === 0 ? env
            : shift > 0 ? [...Array(shift).fill(0), ...env]
              : env.slice(-shift)
          envelopes.push({ speaker: m.speaker, envelope: aligned })
        }
        all = assignSpeakers(all, envelopes, { hz: HZ })
        setSeparation(separationOf(all, envelopes, { hz: HZ }))
      }

      await ctx.close()
      setWords(all)
      // A fresh transcript means a fresh edit: manual cuts point at word
      // positions that no longer exist.
      setHistory(newHistory({ ...EMPTY_EDIT, settings: DEFAULT_SETTINGS }))
      setStage(3)
    } catch (err) { setError((err as Error).message) } finally { setBusy(''); setProgress('') }
  }, [tracks, db, upload, envelopeOf])

  // ══ 3. THE PLAYER ════════════════════════════════════════════════════════
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(0)
  /** Skip the cut ranges while playing, so the edit can be heard. */
  const [previewEdit, setPreviewEdit] = useState(true)

  const playerTrack = useMemo(
    () => cameras[0] ?? tracks.find(t => t.kind === 'mic') ?? tracks[0], [cameras, tracks])

  const seek = useCallback((t: number) => {
    const el = mediaRef.current
    if (!el) return
    el.currentTime = Math.max(0, t)
    setNow(t)
  }, [])

  const onTime = useCallback(() => {
    const el = mediaRef.current
    if (!el) return
    const t = el.currentTime
    if (previewEdit) {
      // Inside a cut? Jump to its end. This is the preview of the edit — the
      // player still holds the ORIGINAL file, so nothing here retimes anything.
      const hit = cuts.find(c => t >= c.from - 0.02 && t < c.to - 0.02)
      if (hit) { el.currentTime = hit.to; setNow(hit.to); return }
    }
    setNow(t)
  }, [cuts, previewEdit])

  const currentWord = useMemo(() => {
    if (!words.length) return -1
    // A linear scan is fine: an hour of speech is ~9000 words and this runs on
    // a timeupdate event, four times a second.
    for (let i = 0; i < words.length; i++) {
      if (now >= words[i].start - 0.05 && now <= words[i].end + 0.05) return i
    }
    return -1
  }, [now, words])

  // ══ 3. SELECTING AND CUTTING ═════════════════════════════════════════════
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const dragging = useRef(false)

  // Memoised because the cut handler and the keyboard listener both depend on
  // it: a fresh object every render would rebuild both on every mouse move
  // across the transcript, which is thousands of listener swaps a minute.
  const selRange = useMemo(
    () => sel ? { from: Math.min(sel.a, sel.b), to: Math.max(sel.a, sel.b) } : null,
    [sel])

  const cutSelection = useCallback(() => {
    if (!selRange) return
    change(addCut(edit, cutWordRange(words, selRange.from, selRange.to)))
    setSel(null)
  }, [selRange, edit, words, change])

  const onWordDown = (i: number) => (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const status = statuses[i]
    if (status !== 'kept') {
      // Clicking a removed word puts it back. One click, on the thing itself —
      // rather than hunting for the cut in a list somewhere else.
      const c = cutAtWord(words, edit, i)
      if (c) change(restore(edit, c))
      return
    }
    dragging.current = true
    setSel({ a: i, b: i })
  }
  const onWordEnter = (i: number) => () => {
    if (dragging.current) setSel(s => s ? { ...s, b: i } : { a: i, b: i })
  }
  useEffect(() => {
    const up = () => { dragging.current = false }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // Delete cuts, Escape clears, cmd/ctrl+Z undoes. An editor whose main gesture
  // is destructive needs undo on the key people already press.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selRange) {
        e.preventDefault(); cutSelection(); return
      }
      if (e.key === 'Escape') { setSel(null); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setHistory(h => e.shiftKey ? redo(h) : undo(h))
      }
      if (e.code === 'Space' && stage === 3) {
        e.preventDefault()
        const m = mediaRef.current
        if (m) { if (m.paused) { m.play(); setPlaying(true) } else { m.pause(); setPlaying(false) } }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selRange, cutSelection, stage])

  // ══ 4/5. PROJECTS ════════════════════════════════════════════════════════
  const sources = useCallback(() => (cameras.length ? cameras : tracks.slice(0, 1)).map(t => ({
    url: t.url, kind: 'video' as const, speaker: t.speaker, offsetSeconds: t.offset ?? 0,
  })), [cameras, tracks])

  const gainDbBySpeaker = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tracks) if (t.speaker && t.trimDb) out[t.speaker] = t.trimDb
    return out
  }, [tracks])

  const episodeProject = useCallback((opts: { captions?: boolean } = {}) => ({
    ...buildEpisodeProject({
      words, cuts: plainCuts, duration: podDur, sources: sources(),
      aspect: '16:9', title: title || undefined, captions: opts.captions ?? false,
      gainDbBySpeaker,
    }),
    // The bed and its ducking are handled by the migration: a music clip marked
    // duckTarget under scenes marked duckSource.
    ...(musicUrl ? { musicUrl, musicVol, musicBed: true } : {}),
    voiceFx: voicePreset === 'none' ? undefined : voicePreset,
  }), [words, plainCuts, podDur, sources, title, gainDbBySpeaker, musicUrl, musicVol, voicePreset])

  const clipProject = useCallback((c: { start: number; end: number }) => buildClipProject({
    start: c.start, end: c.end, words: editedWords, sources: sources(), aspect: '9:16',
  }), [editedWords, sources])

  // ══ RENDERING ════════════════════════════════════════════════════════════
  const [renders, setRenders] = useState<Record<string, RenderState>>({})
  const polling = useRef<Record<string, boolean>>({})

  const render = useCallback(async (
    key: string,
    project: Record<string, unknown>,
    opts: { master?: '1080' | '2160'; audioOnly?: boolean } = {},
  ) => {
    setRenders(r => ({ ...r, [key]: { job: '', state: 'trimit' } }))
    try {
      let timeline = rowTimeline({ ...project, brandKit: TT_KIT } as never, opts.master ?? '1080')
      // Delivery is patched onto the built timeline rather than smuggled through
      // the project, because `delivery` is a property of the DOCUMENT and the
      // project shape has no field for it. The worker reads exactly these keys.
      timeline = {
        ...timeline,
        delivery: {
          ...timeline.delivery,
          loudness,
          ...(opts.audioOnly ? { audioOnly: true } : {}),
          ...(title ? { tags: { title, artist: 'Transilvania Times' } } : {}),
        },
      } as typeof timeline
      const created = await db.functions.invoke('render-worker', { body: createRenderBody(timeline) })
      if (created.error) throw new Error(created.error.message)
      // `create` answers with the worker's job object; its id field is `id`, not
      // `job_id` (which is what the REQUEST uses). `status` answers with
      // `downloadUrl`, not `url`. Both wrong guesses render, cost money, finish,
      // and show nothing.
      const jobId = String((created.data as { id?: string })?.id ?? '')
      if (!jobId) {
        throw new Error((created.data as { error?: string })?.error
          || 'Worker-ul nu a returnat un id de job.')
      }
      setRenders(r => ({ ...r, [key]: { job: jobId, state: 'în lucru' } }))

      polling.current[key] = true
      const deadline = Date.now() + 60 * 60_000
      while (polling.current[key]) {
        if (Date.now() > deadline) {
          polling.current[key] = false
          setRenders(r => ({ ...r, [key]: { job: jobId, state: 'expirat',
            error: 'Nu a răspuns într-o oră. Jobul poate rula încă — id: ' + jobId } }))
          return
        }
        await new Promise(r => setTimeout(r, 4000))
        const st = await db.functions.invoke('render-worker', { body: statusRenderBody(jobId) })
        if (st.error) throw new Error(st.error.message)
        const s = st.data as { state?: string; downloadUrl?: string | null; error?: string } | null
        const state = String(s?.state ?? '')
        if (isFinished(state)) {
          polling.current[key] = false
          setRenders(r => ({
            ...r,
            [key]: isFailure(state) ? { job: jobId, state, error: s?.error || 'Randarea a eșuat.' }
              : s?.downloadUrl ? { job: jobId, state, url: s.downloadUrl }
                : { job: jobId, state, error: 'S-a terminat fără fișier.' },
          }))
          return
        }
        setRenders(r => ({ ...r, [key]: { job: jobId, state: state || 'în lucru' } }))
      }
    } catch (err) {
      setRenders(r => ({ ...r, [key]: { job: '', state: 'eroare', error: (err as Error).message } }))
    }
  }, [db, loudness, title])

  useEffect(() => () => { polling.current = {} }, [])

  // ══ SHOW NOTES ═══════════════════════════════════════════════════════════
  const [notes, setNotes] = useState<ShowNotes | null>(null)

  const makeNotes = useCallback(async () => {
    if (!editedWords.length) { setError('Transcrie întâi episodul.'); return }
    setBusy('note')
    try {
      const { data, error: e } = await db.functions.invoke('ai-blog-assistant', {
        body: {
          action: 'free_chat',
          content: transcriptText(editedWords).slice(0, 60000),
          prompt: showNotesPrompt({ minutes: summary.keptSeconds / 60, speakers }),
        },
      })
      if (e) throw new Error(e.message)
      const raw = String((data as { result?: string })?.result ?? '')
      if (!raw.trim()) throw new Error('Modelul a răspuns gol.')
      const parsed = parseShowNotes(raw)
      setNotes(parsed)
      if (!title && parsed.title) setTitle(parsed.title)
    } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }, [db, editedWords, summary.keptSeconds, speakers, title])

  // ══ DOWNLOADS ════════════════════════════════════════════════════════════
  const saveText = (name: string, text: string, mime = 'text/plain;charset=utf-8') => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: mime }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const slug = (title || 'episod').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const captionCues = useMemo(
    () => editedWords.length ? cuesFromWords(editedWords) : [], [editedWords])

  // ══ AUTOMATION ═══════════════════════════════════════════════════════════
  //
  // "Pregătește tot" runs the steps that need no judgement and then STOPS at
  // the edit. It deliberately does not render: an automatic cut list is a good
  // first draft and a bad final answer, and rendering before anyone has read it
  // spends money on a file that gets thrown away.
  const prepareAll = useCallback(async () => {
    if (!tracks.length) { setError('Încarcă întâi pistele.'); return }
    setBusy('automat')
    try {
      let list = tracks
      if (tracks.length >= 2 && tracks.some(t => t.offset === undefined)) {
        setProgress('1/3 aliniez pistele')
        list = (await align(tracks)) ?? tracks
      }
      setProgress('2/3 transcriu')
      await transcribe(list)
      setProgress('3/3 scriu materialele de publicare')
      await makeNotes()
      setStage(3)
    } catch (err) { setError((err as Error).message) } finally { setBusy(''); setProgress('') }
  }, [tracks, align, transcribe, makeNotes])

  // ── small pieces ─────────────────────────────────────────────────────────
  const RenderRow = ({ k }: { k: string }) => {
    const r = renders[k]
    if (!r) return null
    if (r.error) return <span className="text-[11px] text-red-300/90">{r.error}</span>
    if (r.url) return (
      <a href={r.url} target="_blank" rel="noreferrer"
        className="text-[11px] px-2 py-1 border border-emerald-500/40 text-emerald-300/90 hover:bg-emerald-500/10">
        descarcă
      </a>
    )
    return <span className="text-[11px] text-white/40 font-mono">{r.state}…</span>
  }

  const WORD_CLASS: Record<WordStatus, string> = {
    kept: 'text-white/80 hover:bg-white/10',
    filler: 'line-through text-amber-400/40 hover:text-amber-300/70',
    silence: 'line-through text-sky-400/35 hover:text-sky-300/70',
    manual: 'line-through text-red-400/45 hover:text-red-300/80',
  }

  const locked = (id: StageId): string => {
    if (id <= 2) return ''
    if (!words.length) return 'Transcrie episodul mai întâi — montajul se face pe cuvinte.'
    if (id === 5 && !podDur) return 'Nu știu încă durata înregistrării.'
    return ''
  }

  return (
    <div className="grid gap-5 pb-24">
      <header>
        <h1 className="font-serif text-[26px] text-white flex items-center gap-2">
          <Mic className="w-6 h-6 text-brand-red" /> Podcast
        </h1>
        <p className="mt-1 text-[12px] text-white/40 leading-relaxed max-w-[85ch]">
          Tai <span className="text-white/70">citind transcrierea</span>: selectezi cuvintele cu
          mouse-ul și apeși Taie. Ce e tăiat rămâne pe ecran, barat, și se pune înapoi cu un click.
          Restul — MP3 pentru feed, video pentru YouTube, subtitrări, capitole, descriere și clipuri
          verticale — iese din același montaj, deci nu pot fi în dezacord.
        </p>
        <nav className="mt-3 flex gap-2 text-[11px]">
          <a href="/admin/studio" className="px-2 py-1 border border-white/[0.07] text-white/50 hover:text-white">Studio</a>
          <a href="/admin/productie" className="px-2 py-1 border border-white/[0.07] text-white/50 hover:text-white">Producție</a>
        </nav>
      </header>

      {/* ══ THE RAIL ═════════════════════════════════════════════════════ */}
      <div className="flex gap-1 flex-wrap">
        {STAGES.map(s => {
          const why = locked(s.id)
          const done = (s.id === 1 && tracks.length > 0) ||
            (s.id === 2 && words.length > 0) ||
            (s.id === 3 && summary.removedSeconds > 0) ||
            (s.id === 5 && Object.values(renders).some(r => r.url))
          return (
            <button key={s.id} onClick={() => why ? setError(why) : setStage(s.id)} title={why || s.note}
              className={'px-3 py-2 text-[12px] border flex items-center gap-2 ' + (
                stage === s.id ? 'bg-brand-red text-white border-brand-red'
                  : why ? 'bg-[#111] text-white/25 border-white/[0.05]'
                    : 'bg-[#111] text-white/55 border-white/[0.07] hover:text-white/80')}>
              {why ? <Lock className="w-3 h-3" /> : done ? <Check className="w-3 h-3" /> : <span className="font-mono">{s.id}</span>}
              {s.label}
            </button>
          )
        })}
        <button onClick={prepareAll} disabled={!tracks.length || busy === 'automat'}
          className="ml-auto px-3 py-2 text-[12px] border border-sky-500/40 text-sky-300/90 hover:bg-sky-500/10 disabled:opacity-40 flex items-center gap-2">
          {busy === 'automat' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Pregătește tot automat
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 border border-red-500/30 bg-red-500/[0.06] text-red-200/90 text-[12px]">
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-white/40 hover:text-white">×</button>
        </div>
      )}
      {progress && <Note level="info">{progress}</Note>}

      {/* ══ 1. TRACKS ════════════════════════════════════════════════════ */}
      <div hidden={stage !== 1} className="grid gap-5">
        <Panel title="1 · Pistele"
          note="Două camere și două microfoane sunt patru fișiere care nu sunt de acord ce oră e — fiecare a pornit când a apăsat omul lui. Alinierea se măsoară, nu se presupune. Pune un nume de vorbitor pe fiecare microfon: din el vine atribuirea replicilor și tăierea între camere.">
          <div className="grid gap-2">
            {tracks.map(t => (
              <div key={t.id} className="flex gap-2 items-center flex-wrap text-[12px] border border-white/[0.07] p-2">
                {t.kind === 'mic' ? <Mic className="w-4 h-4 text-white/40" /> : <Clapperboard className="w-4 h-4 text-white/40" />}
                <span className="text-white/70">{t.name}</span>
                <select value={t.kind}
                  onChange={e => setTracks(l => l.map(x => x.id === t.id ? { ...x, kind: e.target.value as 'camera' | 'mic' } : x))}
                  className="bg-black border border-white/10 px-1.5 py-1 text-[11px]">
                  <option value="mic">microfon</option><option value="camera">cameră</option>
                </select>
                <input value={t.speaker} placeholder="vorbitor"
                  onChange={e => setTracks(l => l.map(x => x.id === t.id ? { ...x, speaker: e.target.value } : x))}
                  className="w-24 bg-black border border-white/10 px-1.5 py-1 text-[11px]" />
                {t.offset !== undefined && (
                  <span className={`font-mono text-[11px] ${
                    (t.confidence ?? 0) < SYNC_CONFIDENCE_MIN ? 'text-amber-300/90' : 'text-white/40'}`}>
                    {t.offset >= 0 ? '+' : ''}{t.offset.toFixed(3)}s
                    {(t.confidence ?? 0) < SYNC_CONFIDENCE_MIN
                      ? ' · nesigur, verifică manual'
                      : ` · sigur ${Math.round((t.confidence ?? 0) * 100)}%`}
                  </span>
                )}
                <button onClick={() => setTracks(l => l.filter(x => x.id !== t.id))}
                  className="ml-auto text-white/30 hover:text-white"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}

            <div className="flex gap-2 flex-wrap">
              <label className="px-3 py-2 text-[12px] border border-white/[0.07] text-white/60 cursor-pointer hover:text-white">
                + pistă
                <input type="file" accept="audio/*,video/*" multiple className="hidden"
                  onChange={async e => {
                    const fs = Array.from(e.target.files ?? []); if (!fs.length) return
                    setBusy('încarc')
                    try {
                      for (const f of fs) {
                        setProgress(`încarc ${f.name}`)
                        const url = await upload(f, f.name)
                        setTracks(l => [...l, {
                          id: uid(), url, name: f.name,
                          kind: f.type.startsWith('video') ? 'camera' : 'mic',
                          speaker: String.fromCharCode(65 + l.length),
                        }])
                      }
                    } catch (err) { setError((err as Error).message) }
                    finally { setBusy(''); setProgress('') }
                  }} />
              </label>
              <button onClick={() => align()} disabled={tracks.length < 2 || busy === 'aliniere'}
                className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/70 disabled:opacity-40">
                {busy === 'aliniere' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Aliniază pistele
              </button>
              <button onClick={() => setStage(2)} disabled={!tracks.length}
                className="flex items-center gap-2 px-3 py-2 text-[12px] border border-brand-red/50 text-white/80 hover:bg-brand-red/10 disabled:opacity-40">
                Mai departe →
              </button>
            </div>
            {podDur > 0 && <Note level="info">{fmt(podDur)} de înregistrare.</Note>}
            {!tracks.length && (
              <Note level="info">
                Începe aici: încarcă fișierele de la fiecare cameră și fiecare microfon.
                Dacă ai doar un fișier, e în regulă — restul funcționează la fel.
              </Note>
            )}
          </div>
        </Panel>
      </div>

      {/* ══ 2. TRANSCRIPT ════════════════════════════════════════════════ */}
      <div hidden={stage !== 2} className="grid gap-5">
        <Panel title="2 · Transcrierea"
          note="Se taie în bucăți aici, în browser, pentru că serviciul de transcriere refuză un fișier de peste 25 MB, iar o oră de podcast e mult peste. Marcajele de timp ale fiecărei bucăți sunt mutate înapoi în întreg, deci minutul 47 rămâne minutul 47.">
          <div className="grid gap-3 text-[12px]">
            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={() => transcribe()} disabled={!tracks.length || busy === 'transcriere'}
                className="flex items-center gap-2 px-3 py-2 border border-brand-red/50 text-white/80 hover:bg-brand-red/10 disabled:opacity-40">
                {busy === 'transcriere' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                Transcrie
              </button>
              {podDur > 0 && (
                <span className="text-white/40">
                  {fmt(podDur)} · {planChunks(podDur).length} bucăți
                </span>
              )}
            </div>
            {words.length > 0 && (
              <>
                <span className="text-white/50">
                  {words.length} cuvinte · {speakers.length || 1} vorbitor{speakers.length === 1 ? '' : 'i'}
                </span>
                {separation > 0 && (
                  <Note level={separation >= SEPARATION_MIN ? 'info' : 'warn'}>
                    {separation >= SEPARATION_MIN
                      ? `Microfoanele separă vorbitorii clar (raport ${separation.toFixed(1)}×). Atribuirea vine din măsurătoare, nu dintr-un model.`
                      : `Microfoanele nu separă vorbitorii (raport doar ${separation.toFixed(1)}×) — probabil două microfoane omnidirecționale pe aceeași masă. Atribuirea e nesigură; verific-o înainte de a publica.`}
                  </Note>
                )}
                <button onClick={() => setStage(3)}
                  className="w-fit px-3 py-2 border border-brand-red/50 text-white/80 hover:bg-brand-red/10">
                  Mergi la montaj →
                </button>
              </>
            )}
          </div>
        </Panel>
      </div>

      {/* ══ 3. THE EDITOR ════════════════════════════════════════════════ */}
      <div hidden={stage !== 3} className="grid gap-4">
        {/* the numbers, pinned above the transcript */}
        <div className="sticky top-0 z-20 bg-[#0d0d0d]/95 backdrop-blur border-b border-white/[0.07] py-3 grid gap-2">
          <div className="flex gap-3 items-center flex-wrap text-[12px]">
            <span className="font-mono text-white/70">
              {fmt(podDur)} → <span className="text-emerald-300/90">{fmt(summary.keptSeconds)}</span>
            </span>
            <span className="text-white/35">
              −{summary.removedSeconds.toFixed(1)}s · {summary.wordsRemoved} cuvinte ·
              {' '}{summary.fillerCuts} umpluturi, {summary.silenceCuts} tăceri, {summary.manualCuts} manuale
            </span>

            <span className="ml-auto flex gap-1 items-center">
              <button onClick={() => setHistory(undo)} disabled={!history.past.length} title="Ctrl+Z"
                className="px-2 py-1 border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-30">
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setHistory(redo)} disabled={!history.future.length} title="Ctrl+Shift+Z"
                className="px-2 py-1 border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-30">
                <Redo2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={cutSelection} disabled={!selRange}
                className="px-2 py-1 border border-red-500/40 text-red-200/90 hover:bg-red-500/10 disabled:opacity-30 flex items-center gap-1">
                <Scissors className="w-3.5 h-3.5" />
                Taie{selRange ? ` ${selRange.to - selRange.from + 1}` : ''}
              </button>
            </span>
          </div>

          <div className="flex gap-4 items-center flex-wrap text-[11px]">
            <label className="flex gap-1.5 items-center text-amber-300/70 cursor-pointer">
              <input type="checkbox" checked={edit.settings.removeFillers}
                onChange={e => change({ ...edit, settings: { ...edit.settings, removeFillers: e.target.checked } })} />
              scoate umpluturile
            </label>
            <label className="flex gap-1.5 items-center text-sky-300/70 cursor-pointer">
              <input type="checkbox" checked={edit.settings.removeSilences}
                onChange={e => change({ ...edit, settings: { ...edit.settings, removeSilences: e.target.checked } })} />
              scurtează tăcerile peste
            </label>
            <input type="range" min={0.4} max={2} step={0.1} value={edit.settings.maxGap}
              disabled={!edit.settings.removeSilences}
              onChange={e => change({ ...edit, settings: { ...edit.settings, maxGap: Number(e.target.value) } })}
              className="w-32" />
            <span className="font-mono text-white/50 w-10">{edit.settings.maxGap.toFixed(1)}s</span>
            <span className="text-white/25">lăsând {edit.settings.keepGap.toFixed(2)}s de respirație</span>
            <label className="flex gap-1.5 items-center text-white/50 cursor-pointer ml-auto">
              <input type="checkbox" checked={previewEdit} onChange={e => setPreviewEdit(e.target.checked)} />
              redă montajul (sare peste tăieturi)
            </label>
          </div>
        </div>

        {/* the player */}
        {playerTrack && (
          <div className="flex gap-3 items-center flex-wrap">
            <video ref={mediaRef} src={playerTrack.url} onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              className={'bg-black border border-white/[0.07] ' +
                (playerTrack.kind === 'camera' ? 'w-[280px] aspect-video' : 'w-[280px] h-12')} />
            <div className="grid gap-1 text-[11px]">
              <button onClick={() => {
                const m = mediaRef.current; if (!m) return
                if (m.paused) { m.play() } else { m.pause() }
              }}
                className="w-fit flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/70 hover:text-white">
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {playing ? 'Pauză' : 'Redă'} <span className="text-white/30">(spațiu)</span>
              </button>
              <span className="font-mono text-white/40">{timecode(now)} / {timecode(podDur)}</span>
              <span className="text-white/25 max-w-[30ch] leading-relaxed">
                Click pe un cuvânt ca să sari acolo. Trage peste mai multe și apasă Taie sau Delete.
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-4 text-[11px] text-white/30 flex-wrap">
          <span>Legendă:</span>
          <span className="text-white/80">păstrat</span>
          <span className="line-through text-amber-400/50">umplutură</span>
          <span className="line-through text-sky-400/45">tăcere</span>
          <span className="line-through text-red-400/55">tăiat de tine</span>
          <span>· click pe un cuvânt barat îl pune înapoi</span>
        </div>

        {/* the transcript */}
        <div className="border border-white/[0.07] bg-[#111] p-4 max-h-[62vh] overflow-y-auto grid gap-4 select-none">
          {blocks.length === 0 && <Note level="info">Nimic transcris încă.</Note>}
          {blocks.map((b, bi) => (
            <div key={bi} className="grid grid-cols-[auto_1fr] gap-3">
              <button onClick={() => seek(b.start)}
                className="font-mono text-[11px] text-white/25 hover:text-white/70 self-start pt-0.5">
                {timecode(b.start)}
              </button>
              <p className="text-[14px] leading-[1.9]">
                {b.speaker && (
                  <span className="mr-2 text-[11px] uppercase tracking-wider text-brand-red/80">
                    {b.speaker}
                  </span>
                )}
                {b.indices.map(i => {
                  const inSel = selRange && i >= selRange.from && i <= selRange.to
                  return (
                    <span key={i}
                      onMouseDown={onWordDown(i)}
                      onMouseEnter={onWordEnter(i)}
                      onDoubleClick={() => seek(words[i].start)}
                      className={'cursor-pointer px-[1px] rounded ' + WORD_CLASS[statuses[i]] +
                        (inSel ? ' bg-brand-red/40 text-white' : '') +
                        (i === currentWord ? ' bg-emerald-500/25' : '')}>
                      {words[i].word}{' '}
                    </span>
                  )
                })}
              </p>
            </div>
          ))}
        </div>

        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setStage(4)}
            className="px-3 py-2 text-[12px] border border-brand-red/50 text-white/80 hover:bg-brand-red/10">
            Mai departe la sunet →
          </button>
          <span className="text-[11px] text-white/30 self-center">
            {kept.length} bucăți în episod
          </span>
        </div>
      </div>

      {/* ══ 4. SOUND ═════════════════════════════════════════════════════ */}
      <div hidden={stage !== 4} className="grid gap-5">
        <Panel title="4 · Volumul episodului"
          note="Nu e o preferință: platformele normalizează la aproximativ −16 LUFS, iar un episod livrat la −23 sună mai încet decât tot ce e în jurul lui în aplicație. Măsurarea și corecția se fac la randare, în două treceri, pe mixul final.">
          <div className="grid gap-3 text-[12px]">
            <div className="flex gap-2 flex-wrap">
              {([
                ['podcast', '−16 LUFS · podcast', 'Ținta pentru feed și YouTube. Interval mai strâns, potrivit pentru vorbit.'],
                ['social', '−16 LUFS · social', 'Aceeași țintă, interval mai larg — pentru episoade cu multă muzică.'],
                ['broadcast', '−23 LUFS · EBU R128', 'Numai dacă episodul intră într-o emisiune de radio sau TV.'],
                ['none', 'fără normalizare', 'Doar dacă masterizezi în altă parte.'],
              ] as const).map(([k, label, note]) => (
                <button key={k} onClick={() => setLoudness(k)} title={note}
                  className={'px-3 py-2 border ' + (loudness === k
                    ? 'bg-brand-red text-white border-brand-red'
                    : 'bg-[#111] text-white/55 border-white/[0.07] hover:text-white/80')}>
                  {label}
                </button>
              ))}
            </div>
            <Note level="info">
              {loudness === 'none'
                ? 'Fișierul iese exact cât de tare e mixul. Verifică-l înainte de publicare.'
                : 'Se măsoară întâi mixul, apoi se aplică corecția cu valorile măsurate — o singură trecere de loudnorm e o ghicitoare care se corectează pe parcurs și lasă începutul episodului mai tare decât sfârșitul.'}
            </Note>
          </div>
        </Panel>

        <Panel title="Procesarea vocii"
          note="Se aplică la randare, pe pista de voce. Un filtru trece-sus scoate huruitul mesei și al aerului condiționat, care nu se aude la monitoare mici și e foarte prezent în căști.">
          <div className="flex gap-2 flex-wrap text-[12px]">
            {Object.entries(AUDIO_PRESETS).map(([k, p]) => (
              <button key={k} onClick={() => setVoicePreset(k)} title={p.note}
                className={'px-3 py-2 border ' + (voicePreset === k
                  ? 'bg-brand-red text-white border-brand-red'
                  : 'bg-[#111] text-white/55 border-white/[0.07] hover:text-white/80')}>
                {p.label}
              </button>
            ))}
          </div>
          {AUDIO_PRESETS[voicePreset] && (
            <p className="mt-3 text-[11px] text-white/35">{AUDIO_PRESETS[voicePreset].note}</p>
          )}
        </Panel>

        <Panel title="Echilibrul între vorbitori"
          note="Cu un lavalier pe fiecare, unul dintre ei e mereu cu trei-patru dB mai tare. E cel mai audibil defect al formatului și nu se poate corecta cu un singur volum pentru tot episodul, pentru că fiecare plan e un vorbitor.">
          <div className="grid gap-2 text-[12px]">
            {tracks.filter(t => t.speaker).map(t => (
              <div key={t.id} className="flex gap-3 items-center">
                <span className="w-28 text-white/60">{t.speaker} · {t.kind === 'mic' ? 'microfon' : 'cameră'}</span>
                <input type="range" min={-12} max={12} step={0.5} value={t.trimDb ?? 0}
                  onChange={e => setTracks(l => l.map(x => x.id === t.id
                    ? { ...x, trimDb: Number(e.target.value) } : x))}
                  className="w-48" />
                <span className="font-mono text-white/40 w-16">
                  {(t.trimDb ?? 0) > 0 ? '+' : ''}{(t.trimDb ?? 0).toFixed(1)} dB
                </span>
              </div>
            ))}
            {!tracks.some(t => t.speaker) && (
              <Note level="info">Pune nume de vorbitor pe piste, în pasul 1, ca să apară aici.</Note>
            )}
          </div>
        </Panel>

        <Panel title="Patul muzical"
          note="Se dă la o parte de sub voce printr-un sidechain real, nu printr-un volum fix: muzica scade când se vorbește și revine în pauze. Un pat la volum constant sub o conversație e cel mai sigur mod de a obosi ascultătorul fără ca el să știe de ce.">
          <div className="grid gap-3 text-[12px]">
            <div className="flex gap-2 flex-wrap items-center">
              <label className="px-3 py-2 border border-white/[0.07] text-white/60 cursor-pointer hover:text-white">
                {musicUrl ? 'schimbă muzica' : '+ muzică'}
                <input type="file" accept="audio/*" className="hidden"
                  onChange={async e => {
                    const f = e.target.files?.[0]; if (!f) return
                    setBusy('muzica')
                    try { setMusicUrl(await upload(f, f.name)) }
                    catch (err) { setError((err as Error).message) } finally { setBusy('') }
                  }} />
              </label>
              {musicUrl && (
                <>
                  <input type="range" min={0.02} max={0.4} step={0.01} value={musicVol}
                    onChange={e => setMusicVol(Number(e.target.value))} className="w-40" />
                  <span className="font-mono text-white/40">{Math.round(musicVol * 100)}%</span>
                  <button onClick={() => setMusicUrl('')} className="text-white/30 hover:text-white">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            {!musicUrl && <Note level="info">Fără muzică e o alegere validă pentru un interviu.</Note>}
          </div>
        </Panel>

        <button onClick={() => setStage(5)}
          className="w-fit px-3 py-2 text-[12px] border border-brand-red/50 text-white/80 hover:bg-brand-red/10">
          Mai departe la livrare →
        </button>
      </div>

      {/* ══ 5. DELIVERY ══════════════════════════════════════════════════ */}
      <div hidden={stage !== 5} className="grid gap-5">
        <Panel title="5 · Episodul"
          note="Toate ies din același montaj. MP3-ul e ce urcă în feed; video-ul e ce urcă pe YouTube; ambele trec prin același mixer și aceeași normalizare, deci sună identic.">
          <div className="grid gap-3 text-[12px]">
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Titlul episodului"
              className="w-full max-w-xl bg-black border border-white/10 px-2 py-1.5" />

            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={() => render('mp3', episodeProject() as unknown as Record<string, unknown>, { audioOnly: true })}
                disabled={!words.length}
                className="flex items-center gap-2 px-3 py-2 border border-brand-red/50 text-white/80 hover:bg-brand-red/10 disabled:opacity-40">
                <FileAudio className="w-4 h-4" /> MP3 pentru feed
              </button>
              <RenderRow k="mp3" />
            </div>

            <div className="flex gap-2 flex-wrap items-center">
              <button onClick={() => render('video', episodeProject() as unknown as Record<string, unknown>)}
                disabled={!words.length}
                className="flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/70 hover:text-white disabled:opacity-40">
                <Film className="w-4 h-4" /> Video 1080p
              </button>
              <button onClick={() => render('video4k', episodeProject() as unknown as Record<string, unknown>, { master: '2160' })}
                disabled={!words.length}
                className="flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                <Film className="w-4 h-4" /> 4K
              </button>
              <RenderRow k="video" />
              <RenderRow k="video4k" />
            </div>

            <div className="flex gap-2 flex-wrap">
              <button onClick={() => saveText(`${slug}.srt`, toSRT(captionCues, FPS.pal), 'application/x-subrip')}
                disabled={!captionCues.length}
                className="flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> .srt
              </button>
              <button onClick={() => saveText(`${slug}.vtt`, toVTT(captionCues, FPS.pal), 'text/vtt')}
                disabled={!captionCues.length}
                className="flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> .vtt
              </button>
              <button onClick={() => saveText(`${slug}-transcriere.txt`, transcriptWithTimecodes(editedWords))}
                disabled={!editedWords.length}
                className="flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                <FileText className="w-3.5 h-3.5" /> transcriere
              </button>
              <button onClick={() => saveText(`${slug}.json`,
                JSON.stringify(episodeProject(), null, 2), 'application/json')}
                disabled={!words.length}
                className="flex items-center gap-2 px-3 py-2 border border-white/[0.07] text-white/50 hover:text-white disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> proiect pentru Studio
              </button>
            </div>

            {episodeProject().warnings.map((w, i) => <Note key={i} level="warn">{w}</Note>)}
          </div>
        </Panel>

        <Panel title="Capitolele"
          note="YouTube ignoră întreaga listă dacă primul capitol nu e la 00:00 — nu doar primul, toată lista. Aici se adaugă unul automat, altfel un episod cu intro de 40 de secunde se publică fără nici un capitol și nimic nu spune de ce.">
          <div className="grid gap-2 text-[12px]">
            {chapterList.slice(0, 40).map((c, i) => (
              <div key={i} className="flex gap-3 border-l-2 border-white/10 pl-3 py-0.5">
                <span className="font-mono text-white/25 shrink-0">{timecode(c.start)}</span>
                <span className="text-white/55">{c.title}</span>
              </div>
            ))}
            {!chapterList.length && <Note level="info">Apar după transcriere.</Note>}
            <div className="flex gap-2 flex-wrap mt-2">
              <button onClick={() => saveText(`${slug}-capitole.txt`, chapterLines(chapterList))}
                disabled={!chapterList.length}
                className="px-3 py-1.5 text-[11px] border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                pentru descriere (text)
              </button>
              <button onClick={() => saveText(`${slug}-chapters.json`,
                JSON.stringify(chaptersJson(chapterList, { title }), null, 2), 'application/json')}
                disabled={!chapterList.length}
                className="px-3 py-1.5 text-[11px] border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                Podcasting 2.0 (json)
              </button>
              <span className="text-[11px] text-white/25 self-center">
                {switches.length} schimbări de cameră în montaj
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Titlu, descriere, note"
          note="Scrise din transcrierea MONTATĂ, nu din cea brută, ca să nu citeze o frază pe care ai tăiat-o. Verifică-le: un model care rezumă o oră de conversație greșește numele proprii mai des decât orice altceva.">
          <div className="grid gap-3 text-[12px]">
            <button onClick={makeNotes} disabled={!editedWords.length || busy === 'note'}
              className="w-fit flex items-center gap-2 px-3 py-2 border border-sky-500/40 text-sky-300/90 hover:bg-sky-500/10 disabled:opacity-40">
              {busy === 'note' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Scrie materialele
            </button>
            {notes && (
              <div className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-white/40 text-[11px]">Titlu</span>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    className="bg-black border border-white/10 px-2 py-1.5" />
                </label>
                {notes.subtitle && (
                  <p className="text-white/60 italic">{notes.subtitle}</p>
                )}
                <label className="grid gap-1">
                  <span className="text-white/40 text-[11px]">Descrierea, cu capitolele la coadă</span>
                  <textarea readOnly rows={10} value={fullDescription(notes, chapterList)}
                    className="bg-black border border-white/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed" />
                </label>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => navigator.clipboard?.writeText(fullDescription(notes, chapterList))}
                    className="px-3 py-1.5 text-[11px] border border-white/[0.07] text-white/60 hover:text-white">
                    copiază descrierea
                  </button>
                  <button onClick={() => saveText(`${slug}-descriere.txt`, fullDescription(notes, chapterList))}
                    className="px-3 py-1.5 text-[11px] border border-white/[0.07] text-white/60 hover:text-white">
                    salvează
                  </button>
                </div>
                {notes.keywords.length > 0 && (
                  <p className="text-white/40">Cuvinte cheie: {notes.keywords.join(' · ')}</p>
                )}
                {notes.quotes.length > 0 && (
                  <div className="grid gap-1">
                    <span className="text-white/40 text-[11px]">Citate propuse pentru promovare</span>
                    {notes.quotes.map((q, i) => (
                      <p key={i} className="text-white/55 border-l-2 border-brand-red/40 pl-3">„{q}”</p>
                    ))}
                  </div>
                )}
                <details className="text-[11px] text-white/30">
                  <summary className="cursor-pointer">răspunsul brut al modelului</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono">{notes.raw}</pre>
                </details>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Clipuri pentru social"
          note="Un clip nu e un fragment. Un fragment începe unde a început vorbitorul; un clip începe unde ar începe să îi pese celui care se uită. Timpii sunt din montaj, deci un moment pe care l-ai tăiat nu mai apare aici.">
          <div className="grid gap-2">
            {socialClips.map((c, i) => {
              const key = `clip-${i}`
              return (
                <div key={i} className="border border-white/[0.07] p-3 grid gap-1">
                  <span className="flex gap-3 items-baseline flex-wrap">
                    <button onClick={() => { setStage(3); seek(c.start) }}
                      className="font-mono text-[11px] text-white/30 hover:text-white/70">
                      {timecode(c.start)} – {timecode(c.end)} · {(c.end - c.start).toFixed(0)}s
                    </button>
                    <span className="font-mono text-[11px] text-amber-300/70">scor {c.score}</span>
                    <span className="ml-auto flex gap-2 items-center">
                      <RenderRow k={key} />
                      <button onClick={() => render(key, clipProject(c) as unknown as Record<string, unknown>)}
                        className="text-[11px] px-2 py-1 border border-brand-red/50 text-white/80 hover:bg-brand-red/10">
                        randează vertical
                      </button>
                      <button onClick={() => {
                        const p = clipProject(c)
                        saveText(`clip-${Math.round(c.start)}s.json`, JSON.stringify(p, null, 2), 'application/json')
                      }}
                        className="text-[11px] px-2 py-1 border border-white/[0.07] text-white/50 hover:text-white">
                        proiect
                      </button>
                    </span>
                  </span>
                  <span className="text-[12px] text-white/60 leading-relaxed">{c.text.slice(0, 220)}…</span>
                  <span className="text-[11px] text-white/30">{c.why}</span>
                </div>
              )
            })}
            {socialClips.length === 0 && <Note level="info">Nimic destul de lung pentru un clip încă.</Note>}
          </div>
        </Panel>
      </div>
    </div>
  )
}
