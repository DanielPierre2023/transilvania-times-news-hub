'use client'

// app/admin/productie/page.tsx
//
// Producție — what a film is made FROM.
//
// WHY THIS IS A SEPARATE PAGE AND NOT MORE TABS IN THE STUDIO.
//
// The Studio page is three and a half thousand lines and edits ONE FILM. These
// surfaces are all upstream of that: they make the things a film is then
// assembled from. An avatar is used by many films; a campaign produces hundreds;
// a screen capture is footage. Folding them into the film editor would have
// meant a component that is sometimes a library manager and sometimes an editor,
// with one state blob covering both — which is how the Studio got to three and a
// half thousand lines in the first place.
//
// The three share a page because they share a bucket, a brand kit and an admin
// gate, and because in practice they are used in one sitting: pick the avatar,
// pick the template, run the campaign.
//
// PODCAST USED TO BE THE FOURTH TAB AND IS NOW ITS OWN PAGE.
//
// The other three are library work — you make a thing, and later some film uses
// it. A podcast is a SESSION: align, transcribe, cut, episode, then a dozen
// verticals, each step depending on the one before. It had the most steps and
// the least room, and its state sat inside a component that was also a campaign
// runner. It lives at /admin/podcast.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AlertCircle, Check, Loader2, Mic, Monitor, Pause,
  Play, Scissors, Trash2, Upload, UserRound, Zap,
} from 'lucide-react'

import { MAX_REFERENCES, campaignAdvice, checkAvatar, shotSpec, type Avatar, type AvatarMode } from '@/lib/avatars'
import { CATEGORY_LABEL, TEMPLATES, byCategory, seconds as templateSeconds, type FilmTemplate, type TemplateCategory } from '@/lib/templates/library'
import { MAX_ROWS, buildCampaign, buildDraft, isComplete } from '@/lib/templates/build'
import { CONFIRM_ABOVE_USD, MODES, estimateCampaign, gate, type PersonalisationMode } from '@/lib/templates/campaign'
import { parseRows, validateRows } from '@/lib/templates/merge'
import { DEFAULTS as QUEUE_DEFAULTS, type Job } from '@/lib/campaign/queue'
import { runCampaign, type Driver, type RunHandle } from '@/lib/campaign/runner'
import {
  createRenderBody, draftToProject, isFailure, isFinished, rowTimeline,
  statusRenderBody, type RowMedia,
} from '@/lib/campaign/build'
import { TT_KIT } from '@/lib/brand/kit'
import { costPerRow, generateRow, type GenerateHooks } from '@/lib/campaign/generate'
import { voiceSeconds } from '@/lib/media/duration'
import type { Progress } from '@/lib/campaign/queue'
import { DEVICE_FRAMES, cropKeys, deadAir, readability, skipPoints } from '@/lib/timeline'
// Panel, Note, fmt and uid are shared with the Podcast page so the two surfaces
// cannot drift apart a shade at a time.
import { Panel, Note, fmt, uid } from '../components/ProductionChrome'


type Tab = 'avatare' | 'campanii' | 'ecran'

export default function ProductiePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])
  // lib/database.types.ts is generated and does not know this round's tables
  // until it is regenerated. Same escape hatch the Studio already uses for the
  // brand-kit tables, kept identical so there is one pattern rather than two.
  const db = useMemo(() => supabase as unknown as SupabaseClient, [supabase])
  const [tab, setTab] = useState<Tab>('avatare')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const upload = useCallback(async (file: Blob, name: string) => {
    const path = `productie/${Date.now()}_${name}`
    const { error: e } = await supabase.storage.from('studio-assets')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (e) throw new Error(e.message)
    return supabase.storage.from('studio-assets').getPublicUrl(path).data.publicUrl
  }, [supabase])

  // ══ AVATARS ══════════════════════════════════════════════════════════════
  const [avatars, setAvatars] = useState<Avatar[]>([])
  const [avId, setAvId] = useState<string>('')
  const [shotPrompt, setShotPrompt] = useState('')
  const [shotUrl, setShotUrl] = useState('')
  const avatar = avatars.find(a => a.id === avId)

  useEffect(() => {
    ;(async () => {
      const { data } = await db.from('studio_avatars')
        .select('*').order('updated_at', { ascending: false })
      if (!data) return
      setAvatars((data as Record<string, unknown>[]).map(r => ({
        id: String(r.id), name: String(r.name ?? ''), heroUrl: String(r.hero_url ?? ''),
        referenceUrls: Array.isArray(r.reference_urls) ? (r.reference_urls as string[]) : [],
        basePrompt: String(r.base_prompt ?? ''),
        voiceId: (r.voice_id as string) || undefined,
        voiceProvider: (r.voice_provider as 'elevenlabs' | 'minimax') || undefined,
        look: (r.look as 'warm' | 'cold' | 'none') || 'warm',
        aspect: String(r.aspect ?? '16:9'),
        notes: (r.notes as string) || undefined,
      })))
    })().catch(() => { /* an empty library is a fine starting state */ })
  }, [db])

  const saveAvatar = useCallback(async (a: Avatar) => {
    setBusy('avatar')
    try {
      const { error: e } = await db.from('studio_avatars').upsert({
        id: a.id, name: a.name, hero_url: a.heroUrl, reference_urls: a.referenceUrls,
        base_prompt: a.basePrompt, voice_id: a.voiceId ?? null,
        voice_provider: a.voiceProvider ?? null, look: a.look ?? 'warm',
        aspect: a.aspect ?? '16:9', notes: a.notes ?? null,
      })
      if (e) throw new Error(e.message)
      setAvatars(l => l.some(x => x.id === a.id) ? l.map(x => x.id === a.id ? a : x) : [a, ...l])
    } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }, [db])

  // ══ CAMPAIGNS ════════════════════════════════════════════════════════════
  const [cat, setCat] = useState<TemplateCategory>('sales')
  const [tplId, setTplId] = useState<string>(TEMPLATES[0].id)
  const template = TEMPLATES.find(t => t.id === tplId) as FilmTemplate
  const [slotValues, setSlotValues] = useState<Record<string, string>>({})
  const [pasted, setPasted] = useState('')
  const [mode, setMode] = useState<PersonalisationMode>('textOnly')
  const [ceiling, setCeiling] = useState(25)
  const [confirmed, setConfirmed] = useState(false)

  const sheet = useMemo(() => parseRows(pasted), [pasted])
  const issues = useMemo(
    () => template.merge ? validateRows(sheet.rows, [template.script ?? ''], template.merge) : [],
    [sheet.rows, template])
  const draft = useMemo(() => buildDraft(template, slotValues), [template, slotValues])
  const estimate = useMemo(() => {
    const one = sheet.rows[0] ? buildDraft(template, slotValues, sheet.rows[0]) : draft
    // THE ESTIMATE COUNTS WHAT THE LOOP WILL ACTUALLY GENERATE.
    //
    // It used to count the template's beats without a picture slot, which is
    // close and not the same: a beat whose slot the campaign has already filled
    // costs nothing, and counting it inflated every fully-generated estimate.
    // `costPerRow` reads the same draft the generator will walk, so the number
    // shown and the number spent come from one source.
    const picturesPerFilm = Math.round(costPerRow(one) / 0.04)
    return estimateCampaign(template, mode, sheet.rows.length, {
      scriptChars: one.script.length,
      picturesPerFilm,
      motionSecondsPerFilm: 0,
    })
  }, [template, mode, sheet.rows, slotValues, draft])
  const g = useMemo(() => gate(estimate, ceiling), [estimate, ceiling])
  const avatarWarnings = avatar ? campaignAdvice(avatar, 'hero', sheet.rows.length) : []

  useEffect(() => { setConfirmed(false) }, [tplId, mode, pasted, ceiling])

  // ── the queue ────────────────────────────────────────────────────────────
  const [campaignId, setCampaignId] = useState('')
  // One voice for the whole campaign, in text-only mode. Generated once and
  // reused, which is the entire reason that mode costs cents instead of dollars.
  const [sharedVoiceUrl, setSharedVoiceUrl] = useState('')
  const [sharedVoiceSeconds, setSharedVoiceSeconds] = useState(0)
  const kit = TT_KIT
  const [runProgress, setRunProgress] = useState<Progress | null>(null)
  const [runHalt, setRunHalt] = useState('')
  const [runLog, setRunLog] = useState<string[]>([])
  const runRef = useRef<RunHandle | null>(null)
  const [running, setRunning] = useState(false)

  const log = useCallback((line: string) =>
    setRunLog(l => [`${new Date().toLocaleTimeString()} · ${line}`, ...l].slice(0, 60)), [])

  /**
   * Everything the loop touches, against Supabase.
   *
   * The claim goes through the database function rather than a select followed
   * by an update, because two of those interleave and both take the same row —
   * two films, twice the money, and the second result overwrites the first so
   * nothing looks wrong afterwards. See the migration.
   */
  const makeDriver = useCallback((id: string, drafts: ReturnType<typeof buildDraft>[]): Driver => {
    const driverId = `browser-${uid()}`
    return {
      async claim() {
        const { data, error: e } = await db.rpc('claim_campaign_job', {
          p_campaign: id, p_driver: driverId,
          p_lease_ms: QUEUE_DEFAULTS.leaseMs, p_max_attempts: QUEUE_DEFAULTS.maxAttempts,
        })
        if (e) throw new Error(e.message)
        const row = Array.isArray(data) ? data[0] : null
        return row ? { rowIndex: row.row_index as number, attempts: row.attempts as number } : null
      },
      /**
       * Render one row.
       *
       * THIS BUILDS A TIMELINE AND POSTS THE SHAPE THE FUNCTION ACTUALLY
       * PARSES. The first version invented `{ draft, aspect, master }`; the
       * deployed function's contract is `{ action: 'create', timeline }` and it
       * answers anything else with "timeline is required", so every row of
       * every campaign would have failed on the first thing anybody tried.
       * An edge function takes JSON and JSON accepts any shape, so nothing
       * would have caught it before you did.
       */
      async render(rowIndex, signal) {
        const draft = drafts[rowIndex]
        if (!draft) throw new Error(`invalid row ${rowIndex}`)

        // A spoken name needs its own voice line; text-only reuses one for the
        // whole campaign, which is what makes it cost cents rather than dollars.
        let media: RowMedia = { voiceUrl: sharedVoiceUrl, voiceSeconds: sharedVoiceSeconds }
        if (mode !== 'textOnly' && draft.script) {
          const v = await db.functions.invoke('generate-voiceover', {
            body: { text: draft.script, voice_id: avatar?.voiceId, language: 'ro' },
          })
          if (v.error) throw new Error(v.error.message)
          const vd = v.data as { publicUrl?: string; url?: string; seconds?: number }
          const voiceUrl = vd?.publicUrl || vd?.url
          if (!voiceUrl) throw new Error('voice generation returned no file')
          // MEASURED, NOT READ OFF THE RESPONSE. generate-voiceover returns no
          // duration at all, so reading one gave `undefined` — a voice clip of
          // zero length on every film, silently.
          media = { voiceUrl, voiceSeconds: await voiceSeconds(voiceUrl, draft.script) }
        }

        // FULLY GENERATED: the pictures are made for THIS row.
        //
        // Priced and gated for weeks before it was built, because a few hundred
        // rows is a few hundred dollars. The budget is checked between
        // pictures, not between rows — a row with four shots can otherwise
        // spend four times the per-row estimate before anything looks.
        let rowDraft = draft
        if (mode === 'fullyGenerated') {
          const genHooks: GenerateHooks = {
            image: async (prompt, aspect) => {
              const r = await db.functions.invoke('generate-cover-image', {
                body: { raw_prompt: prompt, aspect },
              })
              if (r.error) throw new Error(r.error.message)
              const d = r.data as { publicUrl?: string; error?: string }
              if (d?.error) throw new Error(d.error)
              if (!d?.publicUrl) throw new Error('image generation returned no file')
              return d.publicUrl
            },
            meter: async (kind, usd, meta) => {
              await db.from('studio_usage').insert({
                kind, usd, campaign_id: id, row_index: rowIndex, meta: meta ?? null,
              })
            },
            canSpend: async (usd) => {
              const { data } = await db.from('studio_campaigns')
                .select('spent_usd, ceiling_usd').eq('id', id).maybeSingle()
              const row = data as { spent_usd?: number; ceiling_usd?: number } | null
              if (!row) return true
              return Number(row.spent_usd ?? 0) + usd <= Number(row.ceiling_usd ?? ceiling)
            },
          }
          const gen = await generateRow(draft, sheet.rows[rowIndex] ?? {}, genHooks,
            { fields: template.merge ?? [] })
          rowDraft = gen.draft
          if (gen.haltedOnBudget) throw new Error('budget exhausted mid-row')
          if (signal.aborted) throw new Error('aborted')
        }

        const project = draftToProject(rowDraft, media, {
          kit, master: '1080', fpsOut: 25,
          subsOn: !!media.voiceUrl, voiceFx: 'voice', musicFx: 'none',
        })
        const timeline = rowTimeline(project, '1080')

        // The timeline is written back onto the row, so a poller or a rerun
        // renders exactly this and not a rebuild of it.
        await db.from('studio_campaign_jobs')
          .update({ timeline }).eq('campaign_id', id).eq('row_index', rowIndex)

        const created = await db.functions.invoke('render-worker', {
          body: createRenderBody(timeline),
        })
        if (created.error) throw new Error(created.error.message)
        const jobId = (created.data as { id?: string })?.id
        if (!jobId) throw new Error((created.data as { error?: string })?.error || 'render did not start')

        // Poll. The lease is ten minutes, so this cannot outlive its own claim.
        const deadline = Date.now() + QUEUE_DEFAULTS.leaseMs - 30_000
        while (Date.now() < deadline) {
          if (signal.aborted) throw new Error('aborted')
          await new Promise(r => setTimeout(r, 4_000))
          const st = await db.functions.invoke('render-worker', { body: statusRenderBody(jobId) })
          if (st.error) throw new Error(st.error.message)
          const job = st.data as { state?: string; downloadUrl?: string; error?: string }
          const state = String(job?.state || '')
          if (!isFinished(state)) continue
          if (isFailure(state)) throw new Error(job?.error || `render ${state}`)
          if (!job?.downloadUrl) throw new Error('render finished with no file')
          return { url: job.downloadUrl, costUsd: estimate.usdPerRow }
        }
        throw new Error('timeout waiting for the render')
      },
      async finish(rowIndex, result) {
        const { error: e } = await db.rpc('finish_campaign_job', {
          p_campaign: id, p_row: rowIndex, p_url: result.url, p_cost: result.costUsd,
        })
        if (e) throw new Error(e.message)
      },
      async fail(rowIndex, message, retryAt, exhausted) {
        await db.rpc('fail_campaign_job', {
          p_campaign: id, p_row: rowIndex, p_error: message.slice(0, 500),
          p_retry_at: retryAt ? new Date(retryAt).toISOString() : null,
          p_exhaust: exhausted, p_max_attempts: QUEUE_DEFAULTS.maxAttempts,
        })
      },
      async release(rowIndex) {
        await db.rpc('release_campaign_job', { p_campaign: id, p_row: rowIndex })
      },
      async load() {
        const { data } = await db.from('studio_campaign_jobs')
          .select('row_index, state, attempts, lease_until, not_before, cost_usd, error')
          .eq('campaign_id', id)
        return ((data ?? []) as Record<string, unknown>[]).map(r => ({
          rowIndex: Number(r.row_index),
          state: String(r.state) as Job['state'],
          attempts: Number(r.attempts ?? 0),
          leaseUntil: r.lease_until ? Date.parse(String(r.lease_until)) : null,
          notBefore: r.not_before ? Date.parse(String(r.not_before)) : undefined,
          costUsd: Number(r.cost_usd ?? 0),
          error: (r.error as string) || undefined,
        }))
      },
    }
  }, [db, estimate.usdPerRow, mode, avatar, kit, sharedVoiceUrl, sharedVoiceSeconds])

  const startRun = useCallback(async () => {
    setError(''); setRunHalt(''); setRunLog([])
    const built = buildCampaign(template, slotValues, sheet.rows)
    const id = campaignId || uid()
    setBusy('campanie')
    try {
      const { error: e } = await db.from('studio_campaigns').upsert({
        id, name: `${template.name} · ${new Date().toLocaleDateString()}`,
        template_id: template.id, mode, avatar_id: avatar?.id ?? null,
        slot_values: slotValues, rows: sheet.rows,
        estimate_usd: estimate.usd, ceiling_usd: ceiling,
        run_state: 'running', started_at: new Date().toISOString(),
      })
      if (e) throw new Error(e.message)

      // EACH ROW CARRIES ITS OWN FINISHED TIMELINE.
      //
      // Built once, here, and stored. After this a driver — this tab, or the
      // poller on the render worker — only has to render a document that
      // already exists. The films a poller makes are then identical to the ones
      // this tab makes, not because two builders agree but because there is one
      // document. It also makes a campaign inspectable: a row that produced a
      // wrong film can be read.
      //
      // Only text-only campaigns can have their timelines built up front —
      // the other modes generate media per row, at render time.
      const upfront = mode === 'textOnly'
      await db.from('studio_campaign_jobs').upsert(
        built.drafts.map((d, i) => {
          const base: Record<string, unknown> = { campaign_id: id, row_index: i, state: 'pending' }
          if (upfront) {
            try {
              const project = draftToProject(d,
                { voiceUrl: sharedVoiceUrl, voiceSeconds: sharedVoiceSeconds },
                { kit, master: '1080', fpsOut: 25, subsOn: !!sharedVoiceUrl, voiceFx: 'voice', musicFx: 'none' })
              base.timeline = rowTimeline(project, '1080')
            } catch { /* a row that will not build is caught at render time */ }
          }
          return base
        }),
        // Rows are inserted once and left alone on a resume: the primary key
        // stops a row being queued twice, and re-inserting would reset the
        // attempts of rows that already succeeded.
        { onConflict: 'campaign_id,row_index', ignoreDuplicates: true })

      setCampaignId(id)
      setRunning(true)
      log(`${built.drafts.length} rânduri în coadă${built.skipped ? ` (${built.skipped} peste plafon)` : ''}`)

      const handle = runCampaign(makeDriver(id, built.drafts),
        { ...QUEUE_DEFAULTS, ceilingUsd: ceiling }, {
          onProgress: setRunProgress,
          onRowStart: i => log(`rândul ${i + 1} · pornit`),
          onRowDone: i => log(`rândul ${i + 1} · gata`),
          onRowFail: (i, err, willRetry) =>
            log(`rândul ${i + 1} · ${willRetry ? 'eșec, se reia' : 'eșec definitiv'} — ${err.slice(0, 90)}`),
          onHalt: (reason, message) => { setRunHalt(message); log(message); void reason },
        })
      runRef.current = handle
      const { reason } = await handle.done
      await db.from('studio_campaigns').update({
        run_state: reason === 'complete' ? 'done' : 'halted',
        halt_reason: reason, finished_at: new Date().toISOString(),
      }).eq('id', id)
    } catch (err) { setError((err as Error).message) }
    finally { setRunning(false); setBusy(''); runRef.current = null }
  }, [db, template, slotValues, sheet.rows, mode, avatar, estimate.usd, ceiling, campaignId, log, makeDriver])

  // A tab closed mid-run must not strand rows behind a ten-minute lease.
  useEffect(() => {
    const give = () => runRef.current?.abort()
    window.addEventListener('beforeunload', give)
    return () => { window.removeEventListener('beforeunload', give); give() }
  }, [])

  // ══ SCREEN ═══════════════════════════════════════════════════════════════
  const [screenUrl, setScreenUrl] = useState('')
  const [screenSize, setScreenSize] = useState({ width: 2560, height: 1440 })
  const [screenTarget, setScreenTarget] = useState<'16:9' | '9:16' | '1:1'>('16:9')
  const [device, setDevice] = useState('none')
  const [focuses, setFocuses] = useState<{ at: number; x: number; y: number; zoom: number; label?: string }[]>([])
  const recRef = useRef<MediaRecorder | null>(null)
  const [recording, setRecording] = useState(false)
  const [dead, setDead] = useState<{ from: number; to: number }[]>([])
  const [screenDur, setScreenDur] = useState(0)

  const targetSize = screenTarget === '16:9' ? { w: 1920, h: 1080 }
    : screenTarget === '9:16' ? { w: 1080, h: 1920 } : { w: 1080, h: 1080 }
  const read = readability(screenSize, targetSize, 1)

  const startCapture = useCallback(async () => {
    setError('')
    try {
      const media = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: { video: boolean; audio: boolean }): Promise<MediaStream>
      }
      const stream = await media.getDisplayMedia({ video: true, audio: true })
      const track = stream.getVideoTracks()[0]
      const s = track.getSettings()
      if (s.width && s.height) setScreenSize({ width: s.width, height: s.height })

      const chunks: Blob[] = []
      const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm']
        .find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRecording(false)
        setBusy('încarc')
        try {
          const blob = new Blob(chunks, { type: mime })
          setScreenUrl(await upload(blob, `screen.${mime.includes('mp4') ? 'mp4' : 'webm'}`))
        } catch (err) { setError((err as Error).message) } finally { setBusy('') }
      }
      // The user stopping the share from Chrome's own bar must also stop us,
      // or the recorder keeps running against a dead track and produces a file
      // that ends where the sharing did with no way to tell.
      track.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop() })
      rec.start(1000)
      recRef.current = rec
      setRecording(true)
    } catch (err) { setError((err as Error).message) }
  }, [upload])

  /**
   * Find the stretches where the screen did not change.
   *
   * Sampled at 4 Hz into a 64-wide canvas rather than at full rate and full
   * size: what is being measured is "did anything happen", and a thumbnail
   * answers that as well as a 4K frame while being about two thousand times
   * cheaper. Anything finer would make the browser tab unusable for a minute
   * on a ten-minute recording and tell us nothing more.
   */
  const analyseScreen = useCallback(async () => {
    if (!screenUrl) return
    setBusy('analiză')
    try {
      const v = document.createElement('video')
      v.src = screenUrl
      v.muted = true
      v.crossOrigin = 'anonymous'
      await new Promise<void>((res, rej) => {
        v.onloadedmetadata = () => res()
        v.onerror = () => rej(new Error('Nu pot citi înregistrarea.'))
      })
      const duration = v.duration
      setScreenDur(duration)
      if (v.videoWidth) setScreenSize({ width: v.videoWidth, height: v.videoHeight })

      const HZ = 4
      const W = 64
      const H = Math.max(1, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * W))
      const c = document.createElement('canvas')
      c.width = W; c.height = H
      const cx = c.getContext('2d', { willReadFrequently: true })
      if (!cx) throw new Error('Canvas indisponibil.')

      const changes: number[] = []
      let previous: Uint8ClampedArray | null = null
      for (let t = 0; t < duration; t += 1 / HZ) {
        await new Promise<void>(res => { v.onseeked = () => res(); v.currentTime = t })
        cx.drawImage(v, 0, 0, W, H)
        const d = cx.getImageData(0, 0, W, H).data
        if (previous) {
          let acc = 0
          for (let i = 0; i < d.length; i += 4) acc += Math.abs(d[i] - previous[i])
          changes.push(acc / (d.length / 4) / 255)
        } else changes.push(1)
        previous = new Uint8ClampedArray(d)
      }
      setDead(deadAir(changes, HZ))
    } catch (err) { setError((err as Error).message) } finally { setBusy('') }
  }, [screenUrl])

  // ── render ───────────────────────────────────────────────────────────────
  const TABS: [Tab, string, string][] = [
    ['avatare', 'Avatare', 'Aceeași persoană, de fiecare dată.'],
    ['campanii', 'Șabloane și campanii', 'Un film pornit dintr-un șablon. Sau o mie.'],
    ['ecran', 'Ecran', 'Capturi de ecran care se pot urmări.'],
  ]

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      <div className="px-6 py-5 border-b border-white/[0.07] flex items-baseline gap-4 flex-wrap">
        <h1 className="font-display text-[22px]">Producție</h1>
        <span className="text-[12px] text-white/40">
          Ce se face ÎNAINTE de montaj: oameni, șabloane, înregistrări.
        </span>
      </div>

      <div className="px-6 pt-4 flex gap-1 flex-wrap">
        {TABS.map(([k, label, note]) => (
          <button key={k} onClick={() => setTab(k)} title={note}
            className={'px-3 py-2 text-[12px] border ' + (tab === k
              ? 'bg-brand-red text-white border-brand-red'
              : 'bg-[#111] text-white/55 border-white/[0.07] hover:text-white/80')}>
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-6 mt-4 flex items-start gap-2 px-3 py-2 border border-red-500/30 bg-red-500/[0.06] text-red-200/90 text-[12px]">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto text-white/40 hover:text-white">×</button>
        </div>
      )}

      <div className="p-6 grid gap-5 max-w-[1200px]">

        {/* ══ AVATARS ═════════════════════════════════════════════════════ */}
        <div hidden={tab !== 'avatare'} className="grid gap-5">
          <Panel title="Avatare"
            note="Un avatar salvat este o persoană, nu o descriere. Fără el, „Ioana” generată în martie și „Ioana” generată în iunie sunt două femei diferite cu aceeași funcție.">
            <div className="flex gap-2 flex-wrap">
              {avatars.map(a => (
                <button key={a.id} onClick={() => setAvId(a.id)}
                  className={'flex items-center gap-2 px-3 py-2 text-[12px] border ' + (avId === a.id
                    ? 'border-brand-red text-white' : 'border-white/[0.07] text-white/60')}>
                  {a.heroUrl
                    ? <img src={a.heroUrl} alt="" className="w-6 h-6 object-cover" />
                    : <UserRound className="w-4 h-4" />}
                  {a.name}
                </button>
              ))}
              <button
                onClick={() => {
                  const a: Avatar = { id: uid(), name: 'Avatar nou', heroUrl: '', referenceUrls: [], basePrompt: '' }
                  setAvatars(l => [a, ...l]); setAvId(a.id)
                }}
                className="px-3 py-2 text-[12px] border border-white/[0.07] text-white/50 hover:text-white">
                + adaugă
              </button>
            </div>
          </Panel>

          {avatar && (
            <Panel title={avatar.name} note="Cadrul fix este singurul lucru identic garantat. Restul e foarte apropiat.">
              <div className="grid gap-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-widest text-white/35">Nume</span>
                    <input value={avatar.name}
                      onChange={e => setAvatars(l => l.map(x => x.id === avatar.id ? { ...x, name: e.target.value } : x))}
                      className="bg-black border border-white/10 px-2 py-1.5 text-[13px]" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] uppercase tracking-widest text-white/35">Vocea fixată</span>
                    <input value={avatar.voiceId ?? ''} placeholder="voice_id"
                      onChange={e => setAvatars(l => l.map(x => x.id === avatar.id ? { ...x, voiceId: e.target.value || undefined } : x))}
                      className="bg-black border border-white/10 px-2 py-1.5 text-[13px] font-mono" />
                  </label>
                </div>

                <label className="grid gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-white/35">Descrierea persoanei</span>
                  <textarea value={avatar.basePrompt} rows={3}
                    onChange={e => setAvatars(l => l.map(x => x.id === avatar.id ? { ...x, basePrompt: e.target.value } : x))}
                    className="bg-black border border-white/10 px-2 py-1.5 text-[12px] leading-relaxed" />
                  <span className="text-[11px] text-white/30">
                    Se trimite împreună cu referințele când generezi un cadru nou.
                  </span>
                </label>

                <div className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-white/35">
                    Cadrul fix{avatar.heroUrl ? '' : ' — lipsește'}
                  </span>
                  <div className="flex gap-3 items-start flex-wrap">
                    {avatar.heroUrl && <img src={avatar.heroUrl} alt="" className="w-32 border border-white/10" />}
                    <label className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/60 cursor-pointer hover:text-white">
                      <Upload className="w-4 h-4" /> {avatar.heroUrl ? 'înlocuiește' : 'încarcă'}
                      <input type="file" accept="image/*" className="hidden"
                        onChange={async e => {
                          const f = e.target.files?.[0]; if (!f) return
                          setBusy('hero')
                          try {
                            const url = await upload(f, f.name)
                            setAvatars(l => l.map(x => x.id === avatar.id ? { ...x, heroUrl: url } : x))
                          } catch (err) { setError((err as Error).message) } finally { setBusy('') }
                        }} />
                    </label>
                  </div>
                </div>

                <div className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-white/35">
                    Referințe ({avatar.referenceUrls.length}/{MAX_REFERENCES})
                  </span>
                  <div className="flex gap-2 flex-wrap items-center">
                    {avatar.referenceUrls.map(u => (
                      <span key={u} className="relative">
                        <img src={u} alt="" className="w-16 h-16 object-cover border border-white/10" />
                        <button
                          onClick={() => setAvatars(l => l.map(x => x.id === avatar.id
                            ? { ...x, referenceUrls: x.referenceUrls.filter(r => r !== u) } : x))}
                          className="absolute -top-2 -right-2 bg-black border border-white/20 w-5 h-5 text-[11px]">×</button>
                      </span>
                    ))}
                    <label className="px-3 py-2 text-[12px] border border-white/[0.07] text-white/50 cursor-pointer hover:text-white">
                      + referință
                      <input type="file" accept="image/*" multiple className="hidden"
                        onChange={async e => {
                          const fs = Array.from(e.target.files ?? []); if (!fs.length) return
                          setBusy('refs')
                          try {
                            const urls = await Promise.all(fs.map(f => upload(f, f.name)))
                            setAvatars(l => l.map(x => x.id === avatar.id
                              ? { ...x, referenceUrls: [...x.referenceUrls, ...urls].slice(0, MAX_REFERENCES) } : x))
                          } catch (err) { setError((err as Error).message) } finally { setBusy('') }
                        }} />
                    </label>
                  </div>
                </div>

                {checkAvatar(avatar).map((i, n) => (
                  <Note key={n} level={i.level === 'error' ? 'error' : 'warn'}>{i.message}</Note>
                ))}

                <div className="grid gap-2 sm:grid-cols-2">
                  {(['hero', 'reference'] as AvatarMode[]).map(m => {
                    const spec = shotSpec(avatar, m)
                    return (
                      <div key={m} className="border border-white/[0.07] bg-black/30 p-3 grid gap-1">
                        <span className="font-sans text-[12px] text-white/80">
                          {m === 'hero' ? 'Cadru fix' : 'Cadru nou, din referințe'}
                        </span>
                        <span className="text-[11px] text-white/45 leading-relaxed">{spec.identityNote}</span>
                      </div>
                    )
                  })}
                </div>

                {/* GENERATING A NEW SHOT OF THIS PERSON.
                    The reference mode was described in the interface and there
                    was no way to actually do it — the note explained a
                    capability nobody could reach. gpt-image-1 takes up to 16
                    reference images; shotSpec assembles them and the base
                    description, and this sends them. */}
                <div className="grid gap-2 border border-white/[0.07] bg-black/30 p-3">
                  <span className="text-[11px] uppercase tracking-widest text-white/35">
                    Generează un cadru nou cu aceeași persoană
                  </span>
                  <textarea value={shotPrompt} rows={2}
                    onChange={e => setShotPrompt(e.target.value)}
                    placeholder="Ce e diferit în acest cadru: încadrarea, decorul, ținuta. Persoana rămâne aceeași."
                    className="bg-black border border-white/10 px-2 py-1.5 text-[12px] leading-relaxed" />
                  <div className="flex gap-2 items-center flex-wrap">
                    <button
                      disabled={!avatar.heroUrl || !shotPrompt.trim() || busy === 'cadru'}
                      onClick={async () => {
                        setBusy('cadru'); setError('')
                        try {
                          const spec = shotSpec(avatar, 'reference', shotPrompt.trim())
                          const r = await db.functions.invoke('generate-image-edit', {
                            body: {
                              image_urls: spec.referenceUrls,
                              prompt: spec.prompt,
                              aspect: avatar.aspect ?? '16:9',
                            },
                          })
                          if (r.error) throw new Error(r.error.message)
                          const d = r.data as { publicUrl?: string; error?: string }
                          if (d?.error) throw new Error(d.error)
                          if (!d?.publicUrl) throw new Error('generarea nu a returnat o imagine')
                          setShotUrl(d.publicUrl)
                        } catch (err) { setError((err as Error).message) } finally { setBusy('') }
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-[12px] border border-amber-500/40 text-amber-300/90 disabled:opacity-40">
                      {busy === 'cadru' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Generează cadrul
                    </button>
                    <span className="text-[11px] text-white/30">
                      Se condiționează pe {shotSpec(avatar, 'reference').referenceUrls?.length ?? 0} referințe.
                    </span>
                  </div>
                  {shotUrl && (
                    <div className="flex gap-3 items-start flex-wrap">
                      <img src={shotUrl} alt="" className="w-40 border border-white/10" />
                      <div className="grid gap-2">
                        <button
                          onClick={() => setAvatars(l => l.map(x => x.id === avatar.id
                            ? { ...x, referenceUrls: [...x.referenceUrls, shotUrl].slice(0, MAX_REFERENCES) } : x))}
                          className="px-3 py-1.5 text-[12px] border border-white/[0.07] text-white/70">
                          Adaugă la referințe
                        </button>
                        <button
                          onClick={() => setAvatars(l => l.map(x => x.id === avatar.id
                            ? { ...x, heroUrl: shotUrl } : x))}
                          title="Devine cadrul identic garantat. Filmele generate până acum nu se schimbă."
                          className="px-3 py-1.5 text-[12px] border border-white/[0.07] text-white/70">
                          Fă-l cadrul fix
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => saveAvatar(avatar)} disabled={busy === 'avatar'}
                    className="flex items-center gap-2 px-4 py-2 text-[12px] font-bold bg-brand-red text-white disabled:opacity-50">
                    {busy === 'avatar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Salvează avatarul
                  </button>
                  {/* THERE WAS NO WAY TO REMOVE ONE. Found by testing the live
                      environment: a test avatar was created and could not be
                      deleted from the interface. A library you can only add to
                      fills up with mistakes. */}
                  <button
                    onClick={async () => {
                      if (!confirm(`Ștergi „${avatar.name}”? Filmele deja randate nu se schimbă.`)) return
                      setBusy('avatar'); setError('')
                      try {
                        const { error: e } = await db.from('studio_avatars').delete().eq('id', avatar.id)
                        if (e) throw new Error(e.message)
                        setAvatars(l => l.filter(x => x.id !== avatar.id))
                        setAvId('')
                      } catch (err) { setError((err as Error).message) } finally { setBusy('') }
                    }}
                    title="Șterge avatarul din bibliotecă. Filmele randate cu el rămân neatinse."
                    className="flex items-center gap-2 px-3 py-2 text-[12px] border border-red-500/40 text-red-300/90 disabled:opacity-50">
                    <Trash2 className="w-4 h-4" /> Șterge
                  </button>
                </div>
              </div>
            </Panel>
          )}
        </div>

        {/* ══ CAMPAIGNS ═══════════════════════════════════════════════════ */}
        <div hidden={tab !== 'campanii'} className="grid gap-5">
          <Panel title="Șabloane"
            note="Un film pornit de la zero cere să știi cât ține un bumper, unde stă cererea și câte planuri are o lansare. Astea sunt deciziile care separă un film care funcționează de unul care doar se randează.">
            <div className="flex gap-1 flex-wrap mb-3">
              {(Object.keys(CATEGORY_LABEL) as TemplateCategory[]).map(c => (
                <button key={c} onClick={() => { setCat(c); const f = byCategory(c)[0]; if (f) { setTplId(f.id); setSlotValues({}) } }}
                  className={'px-3 py-1.5 text-[12px] border ' + (cat === c
                    ? 'bg-white/10 text-white border-white/20' : 'border-white/[0.07] text-white/50')}>
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            <div className="grid gap-2">
              {byCategory(cat).map(t => (
                <button key={t.id} onClick={() => { setTplId(t.id); setSlotValues({}) }}
                  className={'text-left p-3 border ' + (tplId === t.id
                    ? 'border-brand-red bg-brand-red/[0.06]' : 'border-white/[0.07] hover:border-white/20')}>
                  <span className="flex items-baseline gap-2 flex-wrap">
                    <b className="font-sans text-[13px]">{t.name}</b>
                    <span className="text-[11px] text-white/35 font-mono">
                      {t.aspect} · {templateSeconds(t)}s · {t.beats.length} planuri
                      {t.bulk ? ' · pentru liste' : ''}
                    </span>
                  </span>
                  <span className="block mt-1 text-[12px] text-white/45 leading-relaxed">{t.note}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title={`${template.name} — ce trebuie completat`}
            note="Fiecare plan are o sarcină. Sarcina e partea pe care nimeni nu o are; conținutul se completează ușor.">
            <div className="grid gap-3">
              {template.slots.map(s => (
                <label key={s.key} className="grid gap-1">
                  <span className="text-[11px] uppercase tracking-widest text-white/35">
                    {s.label}{s.required && <span className="text-brand-red"> ·</span>}
                    {s.maxChars && (
                      <span className={`ml-2 font-mono normal-case tracking-normal ${
                        (slotValues[s.key]?.length ?? 0) > s.maxChars ? 'text-red-400' : 'text-white/25'}`}>
                        {slotValues[s.key]?.length ?? 0}/{s.maxChars}
                      </span>
                    )}
                  </span>
                  <input value={slotValues[s.key] ?? ''} placeholder={s.example ?? ''}
                    onChange={e => setSlotValues(v => ({ ...v, [s.key]: e.target.value }))}
                    className="bg-black border border-white/10 px-2 py-1.5 text-[13px]" />
                  <span className="text-[11px] text-white/30">{s.hint}</span>
                </label>
              ))}

              <div className="grid gap-1 mt-2">
                <span className="text-[11px] uppercase tracking-widest text-white/35">Planurile</span>
                {template.beats.map((b, i) => (
                  <div key={i} className="flex gap-3 items-baseline text-[12px] border-l-2 border-white/10 pl-3 py-1">
                    <span className="font-mono text-white/25 shrink-0">{b.seconds}s</span>
                    <span className="text-white/50 leading-relaxed">{b.job}</span>
                  </div>
                ))}
              </div>

              {draft.missing.length > 0
                ? <Note level="warn">Mai lipsesc: {draft.missing.join(', ')}.</Note>
                : <Note level="info">Șablonul e complet — {draft.seconds}s, {draft.scenes.length} planuri.</Note>}
            </div>
          </Panel>

          {template.bulk && (
            <Panel title="Campanie — un film pe rând"
              note="Lipește lista din Excel. Prima linie sunt capetele de coloană; numele coloanelor trebuie să fie cele din text.">
              <div className="grid gap-3">
                <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={5}
                  placeholder={'prenume\tfirma\tmotiv\nAna\tAcme\tlinia nouă'}
                  className="bg-black border border-white/10 px-2 py-1.5 text-[12px] font-mono" />

                <div className="flex gap-3 items-center flex-wrap text-[12px]">
                  <span className="text-white/40">{sheet.rows.length} rânduri</span>
                  {sheet.headers.length > 0 && (
                    <span className="text-white/30 font-mono">{sheet.headers.join(' · ')}</span>
                  )}
                  {sheet.rows.length > MAX_ROWS && (
                    <span className="text-amber-300/90">se rulează primele {MAX_ROWS}</span>
                  )}
                </div>

                {issues.length > 0 && (
                  <Note level="warn">
                    {issues.slice(0, 4).map(i => i.message).join(' ')}
                    {issues.length > 4 && ` (+${issues.length - 4} altele)`}
                  </Note>
                )}

                {/* ONE VOICE FOR THE WHOLE CAMPAIGN, in text-only mode.
                    Without this the campaign renders silent films — the driver
                    has nothing to put on the voice track. Generated once and
                    reused, which is exactly why that mode costs cents. */}
                {mode === 'textOnly' && (
                  <div className="grid gap-2 border border-white/[0.07] bg-black/30 p-3">
                    <span className="text-[11px] uppercase tracking-widest text-white/35">
                      Vocea comună
                    </span>
                    <span className="text-[12px] text-white/45 leading-relaxed">
                      În modul „doar textul pe ecran” toate filmele folosesc aceeași voce.
                      Se generează o dată, aici, și se refolosește pentru fiecare rând.
                    </span>
                    <div className="flex gap-2 items-center flex-wrap">
                      <button
                        disabled={!template.script || busy === 'voce'}
                        onClick={async () => {
                          setBusy('voce'); setError('')
                          try {
                            const base = buildDraft(template, slotValues, sheet.rows[0] ?? {})
                            const v = await db.functions.invoke('generate-voiceover', {
                              body: { text: base.script, voice_id: avatar?.voiceId, language: 'ro' },
                            })
                            if (v.error) throw new Error(v.error.message)
                            const vd = v.data as { publicUrl?: string; url?: string; seconds?: number }
                            const u = vd?.publicUrl || vd?.url
                            if (!u) throw new Error('generarea vocii nu a returnat un fișier')
                            setSharedVoiceUrl(u)
                            setSharedVoiceSeconds(await voiceSeconds(u, base.script))
                          } catch (err) { setError((err as Error).message) } finally { setBusy('') }
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/70 disabled:opacity-40">
                        {busy === 'voce' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                        {sharedVoiceUrl ? 'Regenerează vocea' : 'Generează vocea'}
                      </button>
                      {sharedVoiceUrl
                        ? <audio src={sharedVoiceUrl} controls className="h-8" />
                        : <span className="text-[11px] text-amber-300/80">
                            Fără ea, filmele ies fără sunet.
                          </span>}
                    </div>
                  </div>
                )}

                <div className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-widest text-white/35">Cât de personal</span>
                  {(Object.keys(MODES) as PersonalisationMode[]).map(m => (
                    <label key={m} className={'flex gap-3 items-start p-3 border cursor-pointer ' + (mode === m
                      ? 'border-brand-red bg-brand-red/[0.06]' : 'border-white/[0.07]')}>
                      <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
                      <span>
                        <b className="font-sans text-[12px]">{MODES[m].label}</b>
                        <span className="block text-[12px] text-white/45 leading-relaxed">{MODES[m].note}</span>
                        <span className="block text-[11px] text-white/25 mt-0.5">
                          se regenerează pentru fiecare rând: {MODES[m].regenerates}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                {avatarWarnings.map((w, i) => (
                  <Note key={i} level={w.level === 'error' ? 'error' : 'warn'}>{w.message}</Note>
                ))}

                <div className="border border-white/[0.07] bg-black/30 p-4 grid gap-2">
                  <span className="flex items-baseline gap-3 flex-wrap">
                    <b className="font-sans text-[15px]">${estimate.usd.toFixed(2)}</b>
                    <span className="text-[12px] text-white/40">
                      pentru {estimate.rows} filme · ${estimate.usdPerRow.toFixed(4)} pe film
                    </span>
                    <span className="text-[12px] text-white/40">
                      · randare ≈ {estimate.renderMinutes < 90
                        ? `${estimate.renderMinutes} min` : `${Math.round(estimate.renderMinutes / 60)} ore`}
                    </span>
                  </span>
                  {estimate.breakdown.map((b, i) => (
                    <span key={i} className="flex justify-between text-[11px] text-white/35 font-mono">
                      <span>{b.what}</span><span>${b.usd.toFixed(4)}</span>
                    </span>
                  ))}
                  {estimate.warnings.map((w, i) => <Note key={i} level="warn">{w}</Note>)}

                  <label className="flex items-center gap-2 text-[12px] text-white/50 mt-1">
                    Plafon
                    <input type="number" min={1} step={1} value={ceiling}
                      onChange={e => setCeiling(Math.max(1, Number(e.target.value)))}
                      className="w-20 bg-black border border-white/10 px-2 py-1 text-[12px] font-mono" />
                    $ — peste asta campania nu pornește deloc.
                  </label>

                  {!g.allowed && <Note level="error">{g.reason}</Note>}
                  {g.allowed && g.needsConfirmation && !confirmed && (
                    <label className="flex items-center gap-2 text-[12px] text-amber-200/90">
                      <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                      Am văzut suma: {g.reason}
                    </label>
                  )}

                  <div className="flex gap-2 flex-wrap items-center">
                    <button
                      disabled={running || !g.allowed || (g.needsConfirmation && !confirmed) || !isComplete(draft) || sheet.rows.length === 0}
                      onClick={startRun}
                      className="flex items-center gap-2 px-4 py-2 text-[12px] font-bold bg-brand-red text-white disabled:opacity-40">
                      {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      {campaignId && !running ? 'Reia campania' : 'Pornește campania'}
                    </button>
                    {running && (
                      <>
                        <button onClick={() => { runRef.current?.stop(); log('se oprește după filmele în curs') }}
                          title="Termină filmele începute, apoi se oprește. Rândurile neîncepute rămân în coadă."
                          className="flex items-center gap-2 px-3 py-2 text-[12px] border border-white/[0.07] text-white/70">
                          <Pause className="w-4 h-4" /> Oprește frumos
                        </button>
                        <button onClick={() => { runRef.current?.abort(); log('abandonat — rândurile se eliberează') }}
                          title="Abandonează imediat. Rândurile în curs se eliberează și pot fi reluate."
                          className="flex items-center gap-2 px-3 py-2 text-[12px] border border-red-500/40 text-red-300/90">
                          <Scissors className="w-4 h-4" /> Abandonează
                        </button>
                      </>
                    )}
                  </div>
                  <span className="text-[11px] text-white/25">
                    Peste ${CONFIRM_ABOVE_USD} campania cere o confirmare în plus.
                    Reluarea rulează doar rândurile neterminate — cele plătite nu se refac.
                  </span>

                  {/* THE RUN. Everything here is read from the rows rather than
                      from what the runner believes, so two drivers on the same
                      campaign — a second tab, a server poller — converge. */}
                  {runProgress && (
                    <div className="border border-white/[0.07] bg-black/40 p-3 grid gap-2 mt-1">
                      <div className="h-1.5 bg-white/[0.07]">
                        <div className="h-full bg-brand-red transition-all"
                          style={{ width: `${runProgress.percent}%` }} />
                      </div>
                      <span className="flex gap-3 flex-wrap text-[12px] tabular-nums">
                        <b className="font-sans">{runProgress.percent}%</b>
                        <span className="text-white/50">{runProgress.done} gata</span>
                        {runProgress.running > 0 && <span className="text-amber-300/90">{runProgress.running} în lucru</span>}
                        {runProgress.failed > 0 && <span className="text-red-300/90">{runProgress.failed} eșuate</span>}
                        <span className="text-white/35">{runProgress.pending} în așteptare</span>
                        <span className="ml-auto text-white/60">
                          cheltuit ${runProgress.spend.spentUsd.toFixed(2)} / ${ceiling.toFixed(2)}
                        </span>
                      </span>
                      <span className="flex gap-3 flex-wrap text-[11px] text-white/30 tabular-nums">
                        {runProgress.spend.perRowUsd > 0 && (
                          <span>măsurat ${runProgress.spend.perRowUsd.toFixed(4)}/film
                            {' · '}proiectat ${runProgress.spend.projectedUsd.toFixed(2)}</span>
                        )}
                        {runProgress.etaMs !== null && (
                          <span>rămân ≈ {runProgress.etaMs < 90_000
                            ? `${Math.round(runProgress.etaMs / 1000)}s`
                            : `${Math.round(runProgress.etaMs / 60_000)} min`}</span>
                        )}
                      </span>
                      {runHalt && <Note level={/Gata/.test(runHalt) ? 'info' : 'warn'}>{runHalt}</Note>}
                      {runLog.length > 0 && (
                        <div className="max-h-40 overflow-y-auto grid gap-0.5 mt-1">
                          {runLog.map((l, i) => (
                            <span key={i} className="font-mono text-[11px] text-white/30">{l}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          )}
        </div>

        {/* ══ SCREEN ══════════════════════════════════════════════════════ */}
        <div hidden={tab !== 'ecran'} className="grid gap-5">
          <Panel title="Înregistrare de ecran"
            note="Jumătatea care lipsea din orice demo de software. Ce face o captură urmăribilă nu e captura, ci încadrarea: o apropiere care urmărește partea folosită.">
            <div className="grid gap-3">
              <div className="flex gap-2 flex-wrap">
                {!recording ? (
                  <button onClick={startCapture}
                    className="flex items-center gap-2 px-4 py-2 text-[12px] font-bold bg-brand-red text-white">
                    <Monitor className="w-4 h-4" /> Începe înregistrarea
                  </button>
                ) : (
                  <button onClick={() => recRef.current?.stop()}
                    className="flex items-center gap-2 px-4 py-2 text-[12px] font-bold border border-red-500/50 text-red-300">
                    <Scissors className="w-4 h-4" /> Oprește
                  </button>
                )}
                <label className="px-3 py-2 text-[12px] border border-white/[0.07] text-white/60 cursor-pointer hover:text-white">
                  sau încarcă un fișier
                  <input type="file" accept="video/*" className="hidden"
                    onChange={async e => {
                      const f = e.target.files?.[0]; if (!f) return
                      setBusy('încarc')
                      try { setScreenUrl(await upload(f, f.name)) }
                      catch (err) { setError((err as Error).message) } finally { setBusy('') }
                    }} />
                </label>
                {busy === 'încarc' && <span className="flex items-center gap-2 text-[12px] text-white/40"><Loader2 className="w-4 h-4 animate-spin" /> se încarcă</span>}
              </div>

              <div className="flex gap-3 items-center flex-wrap text-[12px]">
                <span className="text-white/35">Ecran</span>
                <input type="number" value={screenSize.width} onChange={e => setScreenSize(s => ({ ...s, width: Number(e.target.value) }))}
                  className="w-20 bg-black border border-white/10 px-2 py-1 font-mono" />
                <span className="text-white/25">×</span>
                <input type="number" value={screenSize.height} onChange={e => setScreenSize(s => ({ ...s, height: Number(e.target.value) }))}
                  className="w-20 bg-black border border-white/10 px-2 py-1 font-mono" />
                <span className="text-white/35 ml-2">Livrare</span>
                {(['16:9', '9:16', '1:1'] as const).map(a => (
                  <button key={a} onClick={() => setScreenTarget(a)}
                    className={'px-2 py-1 border ' + (screenTarget === a
                      ? 'bg-white/10 text-white border-white/20' : 'border-white/[0.07] text-white/50')}>{a}</button>
                ))}
              </div>

              <Note level={read.ok ? 'info' : 'warn'}>{read.note}</Note>

              <div className="flex gap-2 flex-wrap items-center text-[12px]">
                <span className="text-white/35">Ramă</span>
                {Object.entries(DEVICE_FRAMES).map(([k, v]) => (
                  <button key={k} onClick={() => setDevice(k)} title={v.note}
                    className={'px-2 py-1 border ' + (device === k
                      ? 'bg-white/10 text-white border-white/20' : 'border-white/[0.07] text-white/50')}>{v.label}</button>
                ))}
              </div>
              <span className="text-[11px] text-white/30">{DEVICE_FRAMES[device]?.note}</span>

              {screenUrl && (
                <>
                  <video src={screenUrl} controls className="max-w-full border border-white/10" />
                  <div className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-widest text-white/35">Timp mort</span>
                    <div className="flex gap-2 flex-wrap items-center">
                      <button onClick={analyseScreen} disabled={busy === 'analiză'}
                        className="flex items-center gap-2 px-3 py-1.5 text-[12px] border border-white/[0.07] text-white/70 disabled:opacity-40">
                        {busy === 'analiză' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                        Caută încărcări și pauze
                      </button>
                      {screenDur > 0 && <span className="text-[12px] text-white/35">{fmt(screenDur)} înregistrare</span>}
                    </div>
                    {dead.length > 0 && (
                      <>
                        <div className="grid gap-1 text-[12px]">
                          {dead.map((d, i) => (
                            <span key={i} className="font-mono text-white/40">
                              {fmt(d.from)} – {fmt(d.to)} · {(d.to - d.from).toFixed(1)}s
                            </span>
                          ))}
                        </div>
                        <Note level="info">
                          {dead.reduce((n, d) => n + (d.to - d.from), 0).toFixed(1)}s de timp mort,
                          trecut la viteză mare în {skipPoints(dead, 25).length} puncte de viteză —
                          nu tăiat. O tăietură peste un cursor de încărcare arată ca o înregistrare
                          stricată; aceleași secunde rulate de șase ori mai repede arată ca un montaj.
                        </Note>
                      </>
                    )}
                    {dead.length === 0 && screenDur > 0 && (
                      <Note level="info">Nicio pauză destul de lungă. Pauzele scurte rămân — acolo citește omul ce tocmai a apărut.</Note>
                    )}
                  </div>

                  <div className="grid gap-2">
                    <span className="text-[11px] uppercase tracking-widest text-white/35">Apropieri</span>
                    {focuses.map((f, i) => (
                      <div key={i} className="flex gap-2 items-center flex-wrap text-[12px] border border-white/[0.07] p-2">
                        <span className="font-mono text-white/30">{f.at.toFixed(1)}s</span>
                        {(['x', 'y', 'zoom'] as const).map(k => (
                          <label key={k} className="flex items-center gap-1 text-white/40">
                            {k}
                            <input type="range" min={k === 'zoom' ? 0.28 : 0} max={1} step={0.02} value={f[k]}
                              onChange={e => setFocuses(l => l.map((x, n) => n === i ? { ...x, [k]: Number(e.target.value) } : x))}
                              className="w-20 accent-amber-500" />
                            <span className="font-mono text-white/25 w-8">{f[k].toFixed(2)}</span>
                          </label>
                        ))}
                        <button onClick={() => setFocuses(l => l.filter((_, n) => n !== i))}
                          className="ml-auto text-white/30 hover:text-white"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    ))}
                    <button onClick={() => setFocuses(l => [...l, { at: l.length * 5, x: 0.5, y: 0.5, zoom: 0.5 }])}
                      className="justify-self-start px-3 py-1.5 text-[12px] border border-white/[0.07] text-white/60">
                      + apropiere
                    </button>
                    {focuses.length > 0 && (
                      <Note level="info">
                        {cropKeys(focuses, targetSize, screenSize, 25).length} chei de încadrare —
                        planul stă nemișcat până începe mișcarea, altfel o apropiere pusă la 0:12
                        ar începe de fapt din prima secundă.
                      </Note>
                    )}
                  </div>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}
