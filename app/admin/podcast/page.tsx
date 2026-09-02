'use client'

// app/admin/podcast/page.tsx
//
// Podcast — its own page, and the reason is not tidiness.
//
// It was a tab on Producție, next to avatars, campaigns and screen capture. The
// other three are library work: you make a thing, and later some film uses it.
// A podcast is not that. A podcast is a SESSION — four files that disagree about
// what time it is, an alignment, a transcript, a cut list, an episode, and then
// a dozen verticals off the back of it — and every one of those steps depends on
// the one before it. Sharing a page with three unrelated surfaces meant that
// state sat inside a component that was also a campaign runner, and that the
// work with the most steps had the least room.
//
// WHAT THIS PAGE ADDS BEYOND MOVING THE CODE.
//
// Splitting it exposed that the workflow did not finish. It went: record →
// measure → a number. "38 tăieturi · 214.6s scoase" is a measurement, not an
// episode. There was no way to get the tightened recording out, and the clips
// panel produced a JSON file you then had to open in the Studio by hand — per
// clip. So the two ends are now closed:
//
//   THE EPISODE RENDERS. The cut list becomes a film and goes to the same
//   render worker everything else uses.
//
//   THE VERTICAL RENDERS. A ranked moment becomes an MP4 without a detour
//   through the Studio, and the JSON export stays for when you want to adjust
//   one by hand first.
//
// Both go through `rowTimeline` — the exact path campaigns use, already covered
// by assertions — rather than a second renderer that would start out agreeing
// with the first and stop within a week.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  Clapperboard, Download, Film, Loader2, Mic, Scissors, Trash2, Zap,
} from 'lucide-react'

import { Panel, Note, fmt, uid } from '../components/ProductionChrome'
import { buildClipProject } from '@/lib/podcast/clip'
import { buildEpisodeProject, keptRanges, keptSeconds } from '@/lib/podcast/episode'
import { TT_KIT } from '@/lib/brand/kit'
import {
  createRenderBody, isFailure, isFinished, rowTimeline, statusRenderBody,
} from '@/lib/campaign/build'
import {
  CHUNK_SECONDS, MAX_UPLOAD_BYTES, OVERLAP_SECONDS, encodeWav, monoSlice,
} from '@/lib/media/wav'
import {
  SEPARATION_MIN, SYNC_CONFIDENCE_MIN, alignOffset, assignSpeakers,
  chapters as findChapters, findClips, planChunks, planTighten, retime,
  secondsRemoved, separationOf, speakerCuts, stitch,
} from '@/lib/timeline'

interface Track {
  id: string; url: string; name: string
  kind: 'camera' | 'mic'; speaker: string
  offset?: number; confidence?: number
}

type Word = { word: string; start: number; end: number; speaker?: string }

/** Where a render is, in one word, for one thing being rendered. */
interface RenderState { job: string; state: string; url?: string; error?: string }

export default function PodcastPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  // Same escape hatch the Studio and Producție use: lib/database.types.ts is
  // generated and does not know this round's tables until it is regenerated.
  const db = useMemo(() => supabase as unknown as SupabaseClient, [supabase])

  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState('')

  const upload = useCallback(async (file: Blob, name: string) => {
    const path = `podcast/${Date.now()}_${name}`
    const { error: e } = await supabase.storage.from('studio-assets')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (e) throw new Error(e.message)
    return supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
  }, [supabase])

  // ══ THE SESSION ══════════════════════════════════════════════════════════
  const [tracks, setTracks] = useState<Track[]>([])
  const [words, setWords] = useState<Word[]>([])
  const [podDur, setPodDur] = useState(0)
  const [separation, setSeparation] = useState(0)
  const [title, setTitle] = useState('')

  const cuts = useMemo(() => words.length ? planTighten(words) : [], [words])
  const tightened = useMemo(() => words.length ? retime(words, cuts) : [], [words, cuts])
  const clips = useMemo(() => tightened.length ? findClips(tightened, { want: 10 }) : [], [tightened])
  const chapterList = useMemo(() => tightened.length ? findChapters(tightened) : [], [tightened])
  const switches = useMemo(() => tightened.length ? speakerCuts(tightened) : [], [tightened])
  const kept = useMemo(() => podDur > 0 ? keptRanges(cuts, podDur) : [], [cuts, podDur])
  const cameras = useMemo(() => tracks.filter(t => t.kind === 'camera'), [tracks])

  // ══ ALIGNMENT ════════════════════════════════════════════════════════════
  //
  // Four files that started when four different people pressed record. The
  // offset between them is MEASURED from the loudness envelopes, and the
  // confidence is reported rather than hidden, because a wrong alignment looks
  // exactly like a right one until you watch the film.
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

  const align = useCallback(async () => {
    if (tracks.length < 2) { setError('Alinierea are nevoie de cel puțin două piste.'); return }
    setBusy('aliniere')
    try {
      const first = await envelopeOf(tracks[0].url)
      setPodDur(first.seconds)
      const next = [...tracks]
      next[0] = { ...next[0], offset: 0, confidence: 1 }
      for (let i = 1; i < tracks.length; i++) {
        setProgress(`aliniez pista ${i + 1}/${tracks.length}`)
        const other = await envelopeOf(tracks[i].url)
        const r = alignOffset(first.env, other.env, { hz: 100 })
        next[i] = { ...next[i], offset: r.shiftBBySeconds, confidence: r.confidence }
      }
      setTracks(next)
    } catch (err) { setError((err as Error).message) } finally { setBusy(''); setProgress('') }
  }, [tracks, envelopeOf])

  // ══ TRANSCRIPT ═══════════════════════════════════════════════════════════
  //
  // The split happens HERE, in the browser, because the browser has the decoded
  // audio and a Deno function has no ffmpeg to cut with. An hour sent whole is
  // refused for being over 25 MB.
  const transcribe = useCallback(async () => {
    const mic = tracks.find(t => t.kind === 'mic') || tracks[0]
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

      // Each chunk's timestamps start again at zero; stitch shifts them into the
      // whole recording and drops the repeated head.
      let all = stitch(parts)

      // WHO IS SPEAKING, WITHOUT A DIARISER. With a lapel on each speaker the
      // person talking is the one whose OWN microphone is loud; every other
      // track hears them across the room, quieter. That is a measurement the
      // recording already contains.
      const mics = tracks.filter(t => t.kind === 'mic' && t.speaker)
      if (mics.length > 1) {
        setProgress('atribui vorbitorii')
        const HZ = 100
        const envelopes = []
        for (const m of mics) {
          const { env } = await envelopeOf(m.url, HZ)
          // The measured offset is applied HERE. Attributing words with
          // unaligned envelopes picks whoever was loudest half a second later.
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
    } catch (err) { setError((err as Error).message) } finally { setBusy(''); setProgress('') }
  }, [tracks, db, upload, envelopeOf])

  // ══ RENDERING ════════════════════════════════════════════════════════════
  //
  // One function for the episode and for every clip, because they are the same
  // kind of object and rendering them two ways is how the two stop matching.
  const [renders, setRenders] = useState<Record<string, RenderState>>({})
  const polling = useRef<Record<string, boolean>>({})

  const render = useCallback(async (
    key: string,
    project: Record<string, unknown>,
    master: '1080' | '2160' = '1080',
  ) => {
    setRenders(r => ({ ...r, [key]: { job: '', state: 'trimit' } }))
    try {
      const timeline = rowTimeline({ ...project, brandKit: TT_KIT } as never, master)
      const created = await db.functions.invoke('render-worker', { body: createRenderBody(timeline) })
      if (created.error) throw new Error(created.error.message)
      // THE FIELD NAMES ARE THE DEPLOYED FUNCTION'S, NOT PLAUSIBLE ONES.
      //
      // `create` answers with the worker's job object spread into the envelope,
      // whose id field is `id` — not `job_id`, which is what the REQUEST uses.
      // `status` answers with `downloadUrl` — not `url`. Both wrong guesses
      // fail silently: the render runs, costs money, finishes, and the page
      // shows nothing. Read from supabase/functions/render-worker/index.ts.
      const jobId = String((created.data as { id?: string })?.id ?? '')
      if (!jobId) {
        throw new Error((created.data as { error?: string })?.error
          || 'Worker-ul nu a returnat un id de job.')
      }
      setRenders(r => ({ ...r, [key]: { job: jobId, state: 'în lucru' } }))

      polling.current[key] = true
      // A poll, not a socket: the worker is a queue and a queue answers when
      // asked. Every terminal state stops it, including the failures — a poll
      // that only stops on success runs until the tab is closed. The deadline
      // is the second stop: a worker that dies mid-job never answers 'failed'.
      const deadline = Date.now() + 40 * 60_000
      while (polling.current[key]) {
        if (Date.now() > deadline) {
          polling.current[key] = false
          setRenders(r => ({ ...r, [key]: { job: jobId, state: 'expirat',
            error: 'Randarea nu a răspuns în 40 de minute. Jobul poate rula încă — id: ' + jobId } }))
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
            [key]: isFailure(state)
              ? { job: jobId, state, error: s?.error || 'Randarea a eșuat.' }
              : s?.downloadUrl
                ? { job: jobId, state, url: s.downloadUrl }
                : { job: jobId, state, error: 'Randarea s-a terminat fără fișier.' },
          }))
          return
        }
        setRenders(r => ({ ...r, [key]: { job: jobId, state: state || 'în lucru' } }))
      }
    } catch (err) {
      setRenders(r => ({ ...r, [key]: { job: '', state: 'eroare', error: (err as Error).message } }))
    }
  }, [db])

  useEffect(() => () => { polling.current = {} }, [])

  const episodeProject = useCallback((captions: boolean) => buildEpisodeProject({
    words, cuts, duration: podDur,
    sources: (cameras.length ? cameras : tracks.slice(0, 1)).map(t => ({
      url: t.url, kind: 'video' as const, speaker: t.speaker, offsetSeconds: t.offset ?? 0,
    })),
    aspect: '16:9', title: title || undefined, captions,
  }), [words, cuts, podDur, cameras, tracks, title])

  const clipProject = useCallback((c: { start: number; end: number }) => buildClipProject({
    start: c.start, end: c.end, words: tightened,
    sources: (cameras.length ? cameras : tracks.slice(0, 1)).map(t => ({
      url: t.url, kind: 'video' as const, speaker: t.speaker, offsetSeconds: t.offset ?? 0,
    })),
    aspect: '9:16',
  }), [tightened, cameras, tracks])

  const download = (obj: unknown, name: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
    a.download = name
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── render ───────────────────────────────────────────────────────────────
  const RenderRow = ({ k }: { k: string }) => {
    const r = renders[k]
    if (!r) return null
    if (r.error) return <Note level="error">{r.error}</Note>
    if (r.url) return (
      <a href={r.url} target="_blank" rel="noreferrer"
        className="text-[11px] px-2 py-1 border border-emerald-500/40 text-emerald-300/90 hover:bg-emerald-500/10">
        descarcă MP4
      </a>
    )
    return <span className="text-[11px] text-white/40 font-mono">{r.state}…</span>
  }

  return (
    <div className="grid gap-5">
      <header>
        <h1 className="font-serif text-[26px] text-white flex items-center gap-2">
          <Mic className="w-6 h-6 text-brand-red" /> Podcast
        </h1>
        <p className="mt-1 text-[12px] text-white/40 leading-relaxed max-w-[80ch]">
          Înregistrare → aliniere → transcriere → episod tăiat pentru publicare → clipuri verticale
          pentru social. Fiecare pas se măsoară, nu se presupune: alinierea are un scor de încredere,
          atribuirea vorbitorilor are un raport de separare, iar episodul și clipurile ies ca fișiere,
          nu ca cifre.
        </p>
        <nav className="mt-3 flex gap-2 text-[11px]">
          <a href="/admin/studio" className="px-2 py-1 border border-white/[0.07] text-white/50 hover:text-white">Studio</a>
          <a href="/admin/productie" className="px-2 py-1 border border-white/[0.07] text-white/50 hover:text-white">Producție</a>
        </nav>
      </header>

      {error && <Note level="error">{error}</Note>}
      {progress && <Note level="info">{progress}</Note>}

      {/* ══ TRACKS ═══════════════════════════════════════════════════════ */}
      <Panel title="Pistele"
        note="Două camere și două microfoane sunt patru fișiere care nu sunt de acord ce oră e — fiecare a pornit când a apăsat omul lui. Alinierea se măsoară, nu se presupune.">
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
                      const url = await upload(f, f.name)
                      setTracks(l => [...l, {
                        id: uid(), url, name: f.name,
                        kind: f.type.startsWith('video') ? 'camera' : 'mic',
                        speaker: String.fromCharCode(65 + l.length),
                      }])
                    }
                  } catch (err) { setError((err as Error).message) } finally { setBusy('') }
                }} />
            </label>
            <button onClick={align} disabled={tracks.length < 2 || busy === 'aliniere'}
              className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/70 disabled:opacity-40">
              {busy === 'aliniere' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Aliniază pistele
            </button>
            <button onClick={transcribe} disabled={!tracks.length || busy === 'transcriere'}
              className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/70 disabled:opacity-40">
              {busy === 'transcriere' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
              Transcrie
            </button>
          </div>
          {podDur > 0 && (
            <Note level="info">
              {fmt(podDur)} de înregistrare · se transcrie în {planChunks(podDur).length} bucăți,
              fiecare cu marcajele de timp mutate în întreg.
            </Note>
          )}
        </div>
      </Panel>

      {words.length > 0 && (
        <>
          {/* ══ THE EPISODE ═══════════════════════════════════════════════ */}
          <Panel title="Episodul pentru publicare"
            note="Tăcerile lungi se scurtează, nu se închid: o conversație fără aer sună ca doi oameni care se întrerup. Un „deci” în mijlocul frazei rămâne — e un cuvânt care ține fraza. Rezultatul e un fișier, nu o cifră.">
            <div className="grid gap-3 text-[12px]">
              <span className="text-white/50">
                {cuts.length} tăieturi · {secondsRemoved(cuts).toFixed(1)}s scoase din {fmt(podDur)}
                {' · '}rămân <span className="text-white/80">{fmt(keptSeconds(kept))}</span> în {kept.length} bucăți
              </span>
              <span className="text-white/30">
                {cuts.filter(c => c.reason === 'filler').length} umpluturi ·
                {' '}{cuts.filter(c => c.reason === 'silence').length} tăceri
              </span>

              <input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Titlul episodului (opțional, apare pe primul plan)"
                className="w-full max-w-md bg-black border border-white/10 px-2 py-1.5 text-[12px]" />

              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={() => render('episode', episodeProject(false) as unknown as Record<string, unknown>)}
                  disabled={!podDur || !!renders.episode?.state && !renders.episode?.url && !renders.episode?.error}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] border border-brand-red/50 text-white/80 hover:bg-brand-red/10 disabled:opacity-40">
                  <Film className="w-4 h-4" /> Randează episodul
                </button>
                <button
                  onClick={() => render('episode-4k', episodeProject(false) as unknown as Record<string, unknown>, '2160')}
                  disabled={!podDur}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                  <Film className="w-4 h-4" /> 4K
                </button>
                <button
                  onClick={() => download(episodeProject(false), 'episod.json')}
                  disabled={!podDur}
                  className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                  <Download className="w-4 h-4" /> Proiect pentru Studio
                </button>
                <RenderRow k="episode" />
                <RenderRow k="episode-4k" />
              </div>

              {episodeProject(false).warnings.map((w, i) => <Note key={i} level="warn">{w}</Note>)}

              <Note level="info">
                Transcrierea se recalculează odată cu sunetul — altfel fiecare subtitrare
                din episod ar rămâne în urmă cu exact cât s-a scos înaintea ei.
              </Note>
            </div>
          </Panel>

          {/* ══ CHAPTERS ══════════════════════════════════════════════════ */}
          <Panel title="Capitole și schimbări de cameră"
            note="Un punct de plecare pe care îl redenumești, ceea ce e mult mai util decât niciun capitol.">
            <div className="grid gap-1 text-[12px]">
              {chapterList.map((c, i) => (
                <div key={i} className="flex gap-3 border-l-2 border-white/10 pl-3 py-1">
                  <span className="font-mono text-white/25 shrink-0">{fmt(c.start)}</span>
                  <span className="text-white/55">{c.text}…</span>
                </div>
              ))}
              <span className="text-white/30 mt-2">
                {switches.length} schimbări de cameră — o intervenție de un cuvânt nu mută camera.
              </span>
              <button
                onClick={() => download(
                  chapterList.map(c => `${fmt(c.start)} ${c.text}`).join('\n'), 'capitole.json')}
                disabled={!chapterList.length}
                className="mt-2 w-fit flex items-center gap-2 px-3 py-1.5 text-[11px] border border-white/[0.07] text-white/60 hover:text-white disabled:opacity-40">
                <Download className="w-3.5 h-3.5" /> Capitolele
              </button>
            </div>
          </Panel>

          {/* ══ SOCIAL CLIPS ══════════════════════════════════════════════ */}
          <Panel title="Clipuri pentru social"
            note="Un clip nu e un fragment. Un fragment începe unde a început vorbitorul; un clip începe unde ar începe să îi pese celui care se uită.">
            <div className="grid gap-2">
              {separation > 0 && (
                <Note level={separation >= SEPARATION_MIN ? 'info' : 'warn'}>
                  {separation >= SEPARATION_MIN
                    ? `Microfoanele separă vorbitorii clar (raport ${separation.toFixed(1)}×). ` +
                      'Atribuirea vine din măsurătoare, nu dintr-un model.'
                    : `Microfoanele nu separă vorbitorii (raport doar ${separation.toFixed(1)}×) — ` +
                      'probabil două microfoane omnidirecționale pe aceeași masă. Atribuirea e ' +
                      'nesigură; verific-o înainte de a publica.'}
                </Note>
              )}
              {clips.map((c, i) => {
                const key = `clip-${i}`
                return (
                  <div key={i} className="border border-white/[0.07] p-3 grid gap-1">
                    <span className="flex gap-3 items-baseline flex-wrap">
                      <span className="font-mono text-[11px] text-white/30">
                        {fmt(c.start)} – {fmt(c.end)} · {(c.end - c.start).toFixed(0)}s
                      </span>
                      <span className="font-mono text-[11px] text-amber-300/70">scor {c.score}</span>
                      <span className="ml-auto flex gap-2 items-center">
                        <RenderRow k={key} />
                        {/* A LIST OF TIMECODES IS NOT A DELIVERABLE — and neither
                            is a JSON file you then have to open by hand, per
                            clip, which is exactly the work this page removes. */}
                        <button
                          onClick={() => render(key, clipProject(c) as unknown as Record<string, unknown>)}
                          className="text-[11px] px-2 py-1 border border-brand-red/50 text-white/80 hover:bg-brand-red/10">
                          randează vertical
                        </button>
                        <button
                          onClick={() => {
                            const p = clipProject(c)
                            download(p, `clip-${Math.round(c.start)}s.json`)
                            setError(p.warnings.length
                              ? `Clip pregătit, cu observații: ${p.warnings.join(' ')}`
                              : `Clip pregătit: ${p.scenes.length} ${p.scenes.length === 1 ? 'plan' : 'planuri'}, ` +
                                `${p.cues.length} subtitrări, ${p.seconds.toFixed(1)}s.`)
                          }}
                          className="text-[11px] px-2 py-1 border border-white/[0.07] text-white/50 hover:text-white">
                          <Scissors className="w-3 h-3 inline mr-1" />proiect
                        </button>
                      </span>
                    </span>
                    <span className="text-[12px] text-white/60 leading-relaxed">{c.text.slice(0, 220)}…</span>
                    <span className="text-[11px] text-white/30">{c.why}</span>
                  </div>
                )
              })}
              {clips.length === 0 && <Note level="info">Nimic destul de lung pentru un clip încă.</Note>}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
