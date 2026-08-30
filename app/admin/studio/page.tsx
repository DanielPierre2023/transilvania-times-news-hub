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
// tt-timeline — real loudness measurement and caption sidecars.
import { checkCaptions, conformCues, extractCues, toSRT, toVTT } from '@/lib/timeline/captions'
import { formatLufs, measureAudioBuffer, planNormalisation } from '@/lib/timeline/loudness'
import type { LoudnessResult } from '@/lib/timeline/loudness'
import { migrateLegacyProject } from '@/lib/timeline/migrate'
import { describeLimitations, estimateCostUsd, readJobId, readJobStatus, toShotstackEdit } from '@/lib/timeline/render-spec'
import { framesToSeconds, formatTimecode } from '@/lib/timeline/time'
import { FPS } from '@/lib/timeline/time'
import { validate, addClip, emptyTrack } from '@/lib/timeline/document'
import { compileFrame } from '@/lib/timeline/compile'
import { drawFrame as drawCompiled } from '@/lib/timeline/draw'
import type { Timeline, Clip, TextStyle } from '@/lib/timeline/types'
// tt-brand — the kit and the typography it dictates.
import {
  KITS, SAFE_AREAS, TT_KIT, captionStyle, captionY, resolveKit, safeBox,
  type BrandKit, type SafeAreaName,
} from '@/lib/brand/kit'
import { endCard, lowerThird, titleCard, wordmark } from '@/lib/brand/templates'
import {
  Clapperboard, ImagePlus, Upload, Mic, Captions, Music, Film,
  Sparkles, Loader2, Play, Square, Trash2, ArrowUp, ArrowDown, Download, AlertCircle, Wand2,
  UserPlus, Zap, ShieldCheck, Save, FolderOpen, Type, Crop,
} from 'lucide-react'

type Aspect = '9:16' | '1:1' | '4:5' | '16:9'
type KB = 'none' | 'in' | 'out' | 'left' | 'right'
type SubPos = 'jos' | 'treime' | 'sus'
interface Take { url: string; score: number; accepted: boolean; why: string; move: number; ratio: number }
interface Scene {
  id: string; kind: 'image' | 'video'; url: string; name: string; duration: number; kb: KB
  motion?: 'idle' | 'working' | 'done'; sync?: 'idle' | 'working' | 'done'
  stage?: string            // what the take machine is doing right now
  still?: string            // the approved still a clip was grown from
  takes?: Take[]            // every take, measured
  verdict?: string          // said in one line, in the UI
}

// ── KLING ENGINE OPTIONS ────────────────────────────────────────────────────
// The same API the kling.ai website drives. Studio used three fields of it.
// Prices are audio-off, read from fal's model pages on 29 Aug 2026.
type MotionModel = { key: string; label: string; usdPerSecond: number; maxSeconds: number; endFrame: boolean; negative: boolean }
// Read from fal's own schemas, 30 Aug 2026. `negative` is not a nicety: o3 has
// no negative_prompt field at all, so on o3 the instruction that forbids the
// model turning a golden-hour still into a blue night is thrown away before the
// request leaves us. Every clip in the last two films was made that way.
const MOTION_MODELS: MotionModel[] = [
  { key: 'v3-pro',      label: 'v3 pro · $0.112/s · negative prompt',  usdPerSecond: 0.112, maxSeconds: 15, endFrame: true,  negative: true },
  { key: 'v3-4k',       label: 'v3 4K · $0.42/s · master 4K',          usdPerSecond: 0.42,  maxSeconds: 15, endFrame: true,  negative: true },
  { key: 'o3-standard', label: 'o3 standard · $0.084/s · FĂRĂ negativ', usdPerSecond: 0.084, maxSeconds: 15, endFrame: true,  negative: false },
  { key: 'o3-pro',      label: 'o3 pro · $0.112/s · FĂRĂ negativ',      usdPerSecond: 0.112, maxSeconds: 15, endFrame: true,  negative: false },
  { key: 'v2.1',        label: '2.1 vechi · $0.05/s',                   usdPerSecond: 0.05,  maxSeconds: 10, endFrame: false, negative: true },
]
const SYNC_ENGINES: { key: string; label: string }[] = [
  { key: 'latentsync', label: 'LatentSync · ~$0.20' },
  { key: 'sync-1.9',   label: 'sync 1.9 · $0.70/min' },
  { key: 'sync-v2',    label: 'sync v2 · $3.00/min' },
]
// Kept out of every clip unless you ask for it. Text and logos hallucinated
// into a marketing clip are the single most common reason to reshoot.
// The motion model re-renders the picture, and left to itself it drifts — a
// warm golden-hour still came back as a cold blue night. Asking the positive
// prompt to "preserve the colour grade" is not enough; the drift has to be
// named and forbidden here, where the model actually listens.
const MOTION_NEGATIVE = [
  'text, watermark, logo, subtitles, caption',
  'extra fingers, deformed hands, warped face, identity change',
  'cut, shot change, morphing background',
  // colour and lighting drift — the failure that cost a whole render
  'night, nighttime, moonlight, blue hour, twilight, dusk',
  'colour shift, color shift, changed lighting, changed time of day',
  'cold colour grade, blue cast, teal tint, desaturated, washed out',
  'season change, snow, rain added',
].join(', ')

// Sent as the positive prompt so the instruction to hold the grade travels with
// every job instead of relying on the edge function's generic default.
const MOTION_PROMPT =
  'Subtle cinematic motion only: a slow gentle camera drift and small natural movement ' +
  'in the scene — drifting haze, moving leaves, people walking softly. ' +
  'KEEP THE ORIGINAL PHOTOGRAPH EXACTLY: same composition, same colours, same warm ' +
  'lighting, same time of day. Do NOT change the time of day, do NOT make it night, ' +
  'do NOT cool or desaturate the colours. No cuts, no shot changes, no text.'
interface Cue { start: number; end: number; text: string }

// ── OVERLAYS ────────────────────────────────────────────────────────────────
// A title card, a name under a face, an end card. Stored as intent — kind, when,
// how long, what it says — and expanded into real clips by lib/brand/templates
// at build time. Storing the expansion instead would freeze every film against
// the version of the design it was made with; storing the intent means a fix to
// a template improves every project that has one.
type OverlayKind = 'title' | 'lower' | 'end'
interface Overlay {
  id: string
  kind: OverlayKind
  at: number          // seconds on the timeline
  dur: number         // seconds
  a: string           // title / name / heading
  b?: string          // kicker / role / line
  c?: string          // subtitle / — / url
}
// ── REVIEW ──────────────────────────────────────────────────────────────────
// studio_project_versions has held immutable snapshots and a
// draft/review/approved/rejected state machine since last week, with an
// immutability trigger on the timeline. Until now nothing in the interface
// touched it. Of the sixteen products surveyed this morning, only two have an
// approval workflow at all.
type VersionState = 'draft' | 'review' | 'approved' | 'rejected'
interface VersionRow {
  id: string; version: number; state: VersionState; label: string | null
  note: string | null; render_url: string | null; created_at: string
  note_count: number; open_notes: number
}
interface NoteRow {
  id: string; frame: number; body: string; resolved: boolean
  author_name: string | null; created_at: string
}
const STATE_LABEL: Record<VersionState, string> = {
  draft: 'ciornă', review: 'în revizuire', approved: 'aprobat', rejected: 'respins',
}
const STATE_TONE: Record<VersionState, string> = {
  draft: 'text-white/40 border-white/15',
  review: 'text-amber-300 border-amber-500/40',
  approved: 'text-emerald-300 border-emerald-500/40',
  rejected: 'text-red-300 border-red-500/40',
}

const OVERLAY_LABEL: Record<OverlayKind, string> = {
  title: 'Titlu', lower: 'Nume (burtieră)', end: 'Card final',
}

// ── SOUND DESIGN ────────────────────────────────────────────────────────────
// A cut with nothing under it sounds like a slideshow. These are synthesised by
// the worker from noise and a sine — no library to license, nothing to lose,
// and the same name and length always produce the same bytes, which the
// deterministic render depends on.
type SfxName = 'whoosh' | 'impact' | 'riser' | 'click'
interface Sfx { id: string; name: SfxName; at: number; gain: number }
const SFX_LABEL: Record<SfxName, string> = {
  whoosh: 'whoosh · tranziție', impact: 'impact · greutate',
  riser: 'riser · tensiune', click: 'click · apariție',
}
const SFX_SECONDS: Record<SfxName, number> = { whoosh: 0.6, impact: 0.5, riser: 1.5, click: 0.12 }
interface ElVoice { voice_id: string; name: string; category: string; provider?: 'elevenlabs' | 'minimax' }

// Master resolution. 720p was the only option and it is below every delivery
// spec a client will hand you — "1080p social cutdowns" was literally
// unservable. The old sizes are kept as the 720p tier so existing projects
// render exactly as before if you choose it.
type Master = '720' | '1080'

const MASTERS: Record<Master, Record<Aspect, [number, number]>> = {
  '720': { '9:16': [720, 1280], '1:1': [1000, 1000], '4:5': [864, 1080], '16:9': [1280, 720] },
  '1080': { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] },
}

const ASPECTS: Record<Aspect, [number, number]> = MASTERS['1080']

// What we ask the image model for: twice the 1080p master on each side. The
// still is the only thing in the pipeline that cannot be improved later —
// grade, motion and captions all inherit whatever sharpness it had.
const MASTER_STILL: Record<Aspect, [number, number]> = {
  '16:9': [3840, 2160], '9:16': [2160, 3840], '1:1': [2560, 2560], '4:5': [2160, 2700],
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
// ── BIBLIOTECĂ DE PROMPTURI ─────────────────────────────────────────────────
// Rewritten 29 Aug 2026. The four presets that used to live here were one
// sentence each — a stock-photo brief. These are written the way the Ioana
// prompts were written for Kling, because those are the ones that produced
// usable frames: name the lens and the aperture, name where the light comes
// from and how hard it is, say what texture must survive, and RESERVE THE
// SPACE the text will later sit in.
//
// Three groups:
//   marketing  promo scenes for the paper's own social clips
//   anchors    the six presenters, ready to Animează + Lipsync
//   studios    the four empty sets
//
// The anchor prompts carry three lessons that were paid for in credits:
//   1. HEADROOM. The top of the head sits about one eighth down the frame.
//      Framed tighter, the on-air graphics band cuts the head off, and no
//      amount of compositing recovers it.
//   2. FACE SIZE. Roughly 40% of frame height. The lip-sync engine works at
//      256x256 internally; a smaller face is upsampled into a soft mouth.
//   3. MOUTH CLOSED. The A/B test settled it: a redub engine does better work
//      on a still mouth than on one already speaking different words.
//
// The identity paragraph inside each anchor prompt is repeated VERBATIM. That
// text, plus a reference image, is what keeps the same face across generations.
// Do not paraphrase it and do not "improve" it.
type LibCat = 'marketing' | 'anchors' | 'studios'
const LIB_CATS: { key: LibCat; label: string }[] = [
  { key: 'marketing', label: 'Marketing' },
  { key: 'anchors', label: 'Prezentatori' },
  { key: 'studios', label: 'Platouri' },
]
const IMG_PRESETS: { cat: LibCat; label: string; aspect: string; prompt: string }[] = [
  { cat: 'marketing', label: "Ardeal cinematic", aspect: "4:5", prompt: "Photorealistic landscape photograph of the Apuseni hills at first light, shot on a full-frame camera with an 85mm lens at f/5.6 from a low ridge, tripod, eye level. Layered ridgelines receding into cool blue haze, a single medieval Saxon church tower catching the first warm light on the middle ridge, thin valley mist below the treeline, hay meadows in the foreground with visible individual stems. Sun just above the far ridge, backlit, long soft shadows running toward camera, a faint lens bloom around the sun but no starburst. The UPPER THIRD of the frame is open sky, deliberately empty, so a headline can sit there. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Natural photographic grain, real atmospheric haze, sharp foreground detail. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Diaspora — dor de casă", aspect: "4:5", prompt: "Emotional documentary photograph, shot from inside a night train on a 35mm lens at f/2, handheld, available light only. A Romanian woman in her late twenties in a plain coat, seen three-quarters from behind and slightly above, forehead almost touching the window glass, looking out. Her reflection is visible in the glass, warm from the carriage lamp; beyond it the dark Transylvanian hills and scattered village lights streak past in a slow blur. Focus on the reflection, the landscape soft. Warm tungsten interior against cold blue exterior — the whole picture lives in that one contrast. Left third of the frame is dark window, kept clear for text. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Real skin texture, a little grain in the shadows, no beauty retouching. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Oraș ardelean", aspect: "1:1", prompt: "Street photograph of a Transylvanian town square in late afternoon, 35mm lens at f/4, chest height, one step back from the action. Pastel baroque facades in ochre, dusty rose and pale green, a tram wire crossing the sky, an old man carrying bread, two teenagers on the steps of a fountain, a woman crossing with a shopping bag — everyone mid-movement, nobody posed, nobody looking at the camera. Low sun raking across the facades from camera right, long shadows across the cobbles, one bright pool of light in the middle distance. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Photojournalistic, slightly imperfect framing, motion blur on one walking figure, visible grain. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Newsroom brand", aspect: "16:9", prompt: "Warm editorial still life on a dark oak desk, 50mm macro at f/2.8, three-quarter overhead, tripod. A folded broadsheet newspaper with a cream paper stock and a deep-crimson masthead band, the fold and fibre of the paper clearly visible; a brass desk lamp just out of frame casting a warm pool from camera left; a white ceramic cup of black coffee with steam catching the light; a pair of reading glasses folded on the paper; a fountain pen. Everything else falls into soft shadow. Shallow depth of field: the masthead band sharp, the far edge of the desk soft. RIGHT HALF of the frame is empty desk in shadow, reserved for a headline. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Real paper texture, dust visible in the lamp beam, honest grain. No readable text anywhere on the newspaper. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Breaking — urgență", aspect: "9:16", prompt: "Photojournalistic night scene, 35mm lens at f/2, handheld, shot from behind a low barrier. Wet asphalt reflecting blue and amber emergency lights, the silhouettes of two figures in high-visibility jackets in the middle distance, rain in the air catching the beams, a blurred vehicle light trail across the foreground. No faces identifiable, no number plates, no insignia. Cold blue key from the left, warm amber from the right, deep blacks. The UPPER HALF is dark sky and rain, held clear for a headline. Tense but restrained — a serious newspaper, not a tabloid. Real grain, some motion blur, no clean digital look. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Reportaj de teren", aspect: "4:5", prompt: "Documentary photograph of a journalist working, 50mm at f/2.8, eye level, one pace away, available light. A woman in her thirties in a plain jacket, notebook open in one hand, pen in the other, mid-sentence, listening rather than talking, half-turned away from camera toward someone out of frame. Behind her, an out-of-focus Romanian small-town street. Overcast soft light, no direct sun, low contrast. The picture is about attention, not glamour: no styling, hair a little untidy, real hands, a worn notebook. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Visible skin texture, honest grain. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Portret de comunitate", aspect: "4:5", prompt: "Environmental portrait, 85mm at f/2, eye level, tripod, natural window light from camera left at 45 degrees. An older Transylvanian craftsman or farmer in working clothes, seated, hands resting in his lap and clearly visible — weathered, specific, the hands as much the subject as the face. He looks directly into the lens, calm, neither smiling nor stern. Behind him his own workplace, softly out of focus and two stops darker. Every line and pore rendered honestly. No beauty retouching, no skin smoothing, no dramatic vignette. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Real photographic grain. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Economie și muncă", aspect: "16:9", prompt: "Industrial documentary photograph, 24mm at f/5.6, chest height, tripod, mixed available light. The interior of a working Romanian factory or workshop: a machine operator small in a large frame, sodium and daylight mixing, dust in the air, worn concrete floor, a wall of tools. Human scale against industrial scale — the person is the smallest thing in frame but the eye finds them. The LEFT THIRD is deliberately open floor, reserved for text. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Honest colour, no teal-orange, visible grain. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Sport local", aspect: "9:16", prompt: "Sports documentary photograph, 135mm at f/2.8, low angle from the touchline, 1/1000 shutter, floodlit evening. An amateur Romanian footballer mid-stride on a worn municipal pitch, grass and water kicked up, breath visible in cold air, the small crowd behind a chain-link fence thrown completely out of focus into bokeh. Hard floodlight from above and behind creating a rim on the shoulders, the face in softer fill. UPPER QUARTER of the frame is dark sky, held for a headline. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Frozen motion, real sweat, real mud, grain in the shadows. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Cultură și patrimoniu", aspect: "1:1", prompt: "Interior architectural photograph, 24mm tilt-shift at f/8, tripod, long exposure on available light only. The inside of a Transylvanian fortified church or wooden church: hand-hewn beams, whitewashed walls, one shaft of daylight from a high window falling across the floor, worn wooden pews, painted iconography soft in the shadow. Verticals perfectly straight. Deep shadow detail, highlights held. Nobody in frame. Space at the bottom of the frame, on the floor in shadow, reserved for text. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. Real dust in the light shaft, fine grain. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Card promo / abonament", aspect: "1:1", prompt: "Clean editorial product photograph, 50mm at f/8, flat overhead, soft even light from a large diffused source, no hard shadows. A single folded newspaper in cream stock with a deep-crimson masthead band, laid on a warm parchment-coloured surface, slightly off-centre to the LEFT. The entire RIGHT HALF is empty parchment surface — this is the space an offer will be typeset into, and it must stay completely clean. Subtle paper fibre and a soft natural shadow under the fold give it weight. Transilvania Times editorial grade: warm parchment and cream, one deep-crimson accent, gentle film grain, no HDR look, no over-saturation, blacks left slightly open. No props, no coffee, no clutter. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'marketing', label: "Selfie vertical / reel", aspect: "9:16", prompt: "Photorealistic vertical selfie photograph taken on a modern phone front camera at arm's length, slightly above eye level, handheld, natural window light. A Romanian woman in her mid-twenties in a plain top, sitting at a kitchen table at home, looking straight into the lens mid-sentence, warm and unpolished, a little asymmetric. Behind her a real lived-in kitchen thrown gently out of focus. FRAMING, EXACTLY: head and shoulders. The top of her head sits about one eighth of the way down the frame — clear space above it. Her face fills roughly forty percent of the frame height. Mouth closed and relaxed. Phone-camera look: slightly wide, mild lens distortion, natural skin with visible pores and no beauty filter. No text, no logos, no watermark, no captions, no on-screen graphics." },
  { cat: 'anchors', label: "Ioana Mureșan · Matinal", aspect: '16:9', prompt: "Photorealistic portrait of a FICTIONAL Romanian television news presenter who does not exist and must not resemble any real person. Seated at the anchor desk of a bright modern news studio with a full-height glass wall onto the Cheile Turzii gorge at sunrise, light oak slat panelling, a low white stone anchor desk with a warm brass edge strip and one deep-crimson base line.\n\nA woman of twenty-nine with warm honey-blonde hair falling just past the shoulder in a soft blunt cut, a centre parting, fine straight eyebrows, hazel eyes, a small straight nose and a wide mouth; light natural broadcast make-up with a matte finish, a faint constellation of freckles across the bridge of the nose; wearing a sage-green single-breasted blazer over a cream silk shell, one small gold stud in each ear, no necklace.\n\nFRAMING, EXACTLY: a broadcast medium close-up. The top of the head sits about ONE EIGHTH of the way down the frame — there must be clear empty space above the hair, because the on-air graphics band covers the top of the picture. The lower edge cuts at mid-chest. The face occupies roughly forty percent of the frame height. Eyes on the upper-third line. Seated at the anchor desk, framed slightly LEFT of centre, square to the lens, chin level. The RIGHT HALF of the frame stays clean and uncluttered, reserved for the news picture.\n\nShot on a full-frame camera, 85mm lens at f/2.8, eye level, LOCKED OFF on a tripod — no handheld, no drift. Background studio visible but thrown well out of focus, about two stops darker than the face. Soft warm key from camera left at 40 degrees, broad fill, gentle rim from camera right separating hair and shoulder from the background. No hard shadow anywhere on the lower face, jaw or neck. Hands out of frame or resting flat and low on the desk, never near the face. Hair fully clear of the mouth, jaw and eyes. No microphone, no earpiece cable, no lanyard. MOUTH CLOSED and relaxed, lips together but soft, jaw unclenched. Gaze straight into the lens. Visible skin texture and pores, fine flyaway hairs, real photographic grain — NOT retouched, NOT airbrushed. Sharp focus on the eyes and mouth. No text, no logos, no on-screen graphics." },
  { cat: 'anchors', label: "Ana Bercea · Seara", aspect: '16:9', prompt: "Photorealistic portrait of a FICTIONAL Romanian television news presenter who does not exist and must not resemble any real person. Seated at the anchor desk of a flagship evening news studio at blue hour with a curved panoramic window over Turda at night, dark walnut panelling, a monolithic smoked-glass anchor desk with a thin crimson light strip along its leading edge.\n\nA woman of thirty-five with dark chestnut hair drawn back into a low, precise chignon with no loose strands at the face, defined but unarched brows, deep brown eyes, high cheekbones and a defined jaw; polished evening broadcast make-up, matte, with a muted berry lip; wearing a structured navy blazer with a narrow notch lapel over a black high-neck top, a single small crimson enamel pin on the left lapel, no earrings.\n\nFRAMING, EXACTLY: a broadcast medium close-up. The top of the head sits about ONE EIGHTH of the way down the frame — there must be clear empty space above the hair, because the on-air graphics band covers the top of the picture. The lower edge cuts at mid-chest. The face occupies roughly forty percent of the frame height. Eyes on the upper-third line. Seated at the anchor desk, framed slightly LEFT of centre, square to the lens, chin level. The RIGHT HALF of the frame stays clean and uncluttered, reserved for the news picture.\n\nShot on a full-frame camera, 85mm lens at f/2.8, eye level, LOCKED OFF on a tripod — no handheld, no drift. Background studio visible but thrown well out of focus, about two stops darker than the face. Soft warm key from camera left at 40 degrees, broad fill, gentle rim from camera right separating hair and shoulder from the background. No hard shadow anywhere on the lower face, jaw or neck. Hands out of frame or resting flat and low on the desk, never near the face. Hair fully clear of the mouth, jaw and eyes. No microphone, no earpiece cable, no lanyard. MOUTH CLOSED and relaxed, lips together but soft, jaw unclenched. Gaze straight into the lens. Visible skin texture and pores, fine flyaway hairs, real photographic grain — NOT retouched, NOT airbrushed. Sharp focus on the eyes and mouth. No text, no logos, no on-screen graphics." },
  { cat: 'anchors', label: "Carmen Lupaș · weekend", aspect: '16:9', prompt: "Photorealistic portrait of a FICTIONAL Romanian television news presenter who does not exist and must not resemble any real person. Seated at the anchor desk of a modern news studio in late golden light with a glass wall onto the Cheile Turzii gorge, warm amber limestone beyond, light oak slat panelling and a white stone anchor desk.\n\nA woman of forty-two with dark brown hair in a sharp chin-length bob, a deep side parting, a visible streak of natural silver at the left temple, strong level brows, grey-green eyes and fine lines at the outer corners that read as experience rather than age; restrained matte make-up, a neutral lip; wearing a charcoal wool blazer with a fine notch lapel over a white poplin shirt open at the collar, no visible jewellery.\n\nFRAMING, EXACTLY: a broadcast medium close-up. The top of the head sits about ONE EIGHTH of the way down the frame — there must be clear empty space above the hair, because the on-air graphics band covers the top of the picture. The lower edge cuts at mid-chest. The face occupies roughly forty percent of the frame height. Eyes on the upper-third line. Seated at the anchor desk, framed slightly LEFT of centre, square to the lens, chin level. The RIGHT HALF of the frame stays clean and uncluttered, reserved for the news picture.\n\nShot on a full-frame camera, 85mm lens at f/2.8, eye level, LOCKED OFF on a tripod — no handheld, no drift. Background studio visible but thrown well out of focus, about two stops darker than the face. Soft warm key from camera left at 40 degrees, broad fill, gentle rim from camera right separating hair and shoulder from the background. No hard shadow anywhere on the lower face, jaw or neck. Hands out of frame or resting flat and low on the desk, never near the face. Hair fully clear of the mouth, jaw and eyes. No microphone, no earpiece cable, no lanyard. MOUTH CLOSED and relaxed, lips together but soft, jaw unclenched. Gaze straight into the lens. Visible skin texture and pores, fine flyaway hairs, real photographic grain — NOT retouched, NOT airbrushed. Sharp focus on the eyes and mouth. No text, no logos, no on-screen graphics." },
  { cat: 'anchors', label: "Radu Crișan · Matinal", aspect: '16:9', prompt: "Photorealistic portrait of a FICTIONAL Romanian television news presenter who does not exist and must not resemble any real person. Seated at the anchor desk of a bright modern news studio with a full-height glass wall onto the Cheile Turzii gorge at sunrise, light oak slat panelling, a low white stone anchor desk with a warm brass edge strip and one deep-crimson base line.\n\nA man of thirty-three with dark brown hair cut short and neatly swept back from a high forehead, a closely trimmed dark beard following the jaw line with the upper lip kept short and clear of the mouth, dark brown eyes, straight nose, an open and even-featured face; matte broadcast grooming with no shine on the forehead; wearing a mid-blue wool suit jacket over a white shirt with the collar open and no tie.\n\nFRAMING, EXACTLY: a broadcast medium close-up. The top of the head sits about ONE EIGHTH of the way down the frame — there must be clear empty space above the hair, because the on-air graphics band covers the top of the picture. The lower edge cuts at mid-chest. The face occupies roughly forty percent of the frame height. Eyes on the upper-third line. Seated at the anchor desk, framed slightly LEFT of centre, square to the lens, chin level. The RIGHT HALF of the frame stays clean and uncluttered, reserved for the news picture.\n\nShot on a full-frame camera, 85mm lens at f/2.8, eye level, LOCKED OFF on a tripod — no handheld, no drift. Background studio visible but thrown well out of focus, about two stops darker than the face. Soft warm key from camera left at 40 degrees, broad fill, gentle rim from camera right separating hair and shoulder from the background. No hard shadow anywhere on the lower face, jaw or neck. Hands out of frame or resting flat and low on the desk, never near the face. Hair fully clear of the mouth, jaw and eyes. No microphone, no earpiece cable, no lanyard. MOUTH CLOSED and relaxed, lips together but soft, jaw unclenched. Gaze straight into the lens. Visible skin texture and pores, fine flyaway hairs, real photographic grain — NOT retouched, NOT airbrushed. Sharp focus on the eyes and mouth. No text, no logos, no on-screen graphics." },
  { cat: 'anchors', label: "Tudor Almășan · Seara", aspect: '16:9', prompt: "Photorealistic portrait of a FICTIONAL Romanian television news presenter who does not exist and must not resemble any real person. Seated at the anchor desk of a flagship evening news studio at blue hour with a curved panoramic window over Turda at night, dark walnut panelling, a monolithic smoked-glass anchor desk with a thin crimson light strip along its leading edge.\n\nA man of forty-five, clean shaven, with thick salt-and-pepper hair cut short and combed to one side, heavier level brows, deep-set grey eyes, a broad forehead and a strong square jaw with a defined jaw line; matte grooming, no forehead shine; wearing a charcoal single-breasted suit over a white shirt and a narrow deep-crimson tie in a small knot.\n\nFRAMING, EXACTLY: a broadcast medium close-up. The top of the head sits about ONE EIGHTH of the way down the frame — there must be clear empty space above the hair, because the on-air graphics band covers the top of the picture. The lower edge cuts at mid-chest. The face occupies roughly forty percent of the frame height. Eyes on the upper-third line. Seated at the anchor desk, framed slightly LEFT of centre, square to the lens, chin level. The RIGHT HALF of the frame stays clean and uncluttered, reserved for the news picture.\n\nShot on a full-frame camera, 85mm lens at f/2.8, eye level, LOCKED OFF on a tripod — no handheld, no drift. Background studio visible but thrown well out of focus, about two stops darker than the face. Soft warm key from camera left at 40 degrees, broad fill, gentle rim from camera right separating hair and shoulder from the background. No hard shadow anywhere on the lower face, jaw or neck. Hands out of frame or resting flat and low on the desk, never near the face. Hair fully clear of the mouth, jaw and eyes. No microphone, no earpiece cable, no lanyard. MOUTH CLOSED and relaxed, lips together but soft, jaw unclenched. Gaze straight into the lens. Visible skin texture and pores, fine flyaway hairs, real photographic grain — NOT retouched, NOT airbrushed. Sharp focus on the eyes and mouth. No text, no logos, no on-screen graphics." },
  { cat: 'anchors', label: "Vlad Oltean · sport", aspect: '16:9', prompt: "Photorealistic portrait of a FICTIONAL Romanian television news presenter who does not exist and must not resemble any real person. Seated at the anchor desk of a modern news studio in late golden light with a glass wall onto the Cheile Turzii gorge, warm amber limestone beyond, light oak slat panelling and a white stone anchor desk.\n\nA man of twenty-eight, clean shaven, with short dark hair cut close at the sides and slightly longer on top, straight dark brows, dark eyes, a narrow face and a defined but slim jaw; matte grooming; wearing a slate-grey unstructured blazer over a plain dark crew-neck, no tie, no visible jewellery.\n\nFRAMING, EXACTLY: a broadcast medium close-up. The top of the head sits about ONE EIGHTH of the way down the frame — there must be clear empty space above the hair, because the on-air graphics band covers the top of the picture. The lower edge cuts at mid-chest. The face occupies roughly forty percent of the frame height. Eyes on the upper-third line. Seated at the anchor desk, framed slightly LEFT of centre, square to the lens, chin level. The RIGHT HALF of the frame stays clean and uncluttered, reserved for the news picture.\n\nShot on a full-frame camera, 85mm lens at f/2.8, eye level, LOCKED OFF on a tripod — no handheld, no drift. Background studio visible but thrown well out of focus, about two stops darker than the face. Soft warm key from camera left at 40 degrees, broad fill, gentle rim from camera right separating hair and shoulder from the background. No hard shadow anywhere on the lower face, jaw or neck. Hands out of frame or resting flat and low on the desk, never near the face. Hair fully clear of the mouth, jaw and eyes. No microphone, no earpiece cable, no lanyard. MOUTH CLOSED and relaxed, lips together but soft, jaw unclenched. Gaze straight into the lens. Visible skin texture and pores, fine flyaway hairs, real photographic grain — NOT retouched, NOT airbrushed. Sharp focus on the eyes and mouth. No text, no logos, no on-screen graphics." },
  { cat: 'studios', label: "Platou · Cheile Turzii zori", aspect: "16:9", prompt: "Photorealistic wide photograph of an EMPTY modern television news studio at first light, full-frame cinema camera, 35mm at f/4, eye level, locked off on a tripod. A low white stone anchor desk sits slightly LEFT of centre, its front face lit by a thin warm brass strip; the surface matte, not reflective. Behind it a full-height glass wall opens onto the Cheile Turzii gorge at sunrise: pale limestone cliffs catching the first gold, thin mist lying along the valley floor, a band of cool blue sky above the rim. The gorge is soft focus and about two stops darker than the desk, so it reads as depth rather than competing. Light oak vertical slat panelling on the left, brushed brass reveals, a single deep-crimson strip along the base of the desk, matte pale concrete floor. Soft warm key from camera left at 40 degrees, broad and diffused, cool ambient fill from the glass. No hard shadows. The RIGHT THIRD is deliberately clean and empty — no furniture, no props — reserved for graphics. Natural photographic grain. No people, no text, no logos, no screens showing content." },
  { cat: 'studios', label: "Platou · Turda noaptea", aspect: "16:9", prompt: "Photorealistic wide photograph of an EMPTY flagship evening news studio at blue hour, 35mm at f/4, eye level, locked off. A monolithic smoked-glass anchor desk slightly LEFT of centre, a thin crimson light strip along its leading edge — the only saturated colour in the room. Behind it a vast curved panoramic window over Turda at night: the warm-lit town hall clock tower, terracotta rooftops descending toward the river, scattered street lamps, the dark line of the hills against a deep indigo sky with the last cold light in the west. The city is soft bokeh, two and a half stops darker than the desk. Dark walnut panelling, blackened steel reveals, a polished dark floor with a low controlled sheen and no mirror reflections. Cool practical uplights wash the side walls. Soft warm key from camera left at 40 degrees, gentle cool rim from camera right, broad diffused fill, no hard shadows. The RIGHT THIRD stays clean and empty for graphics. Cinematic, photographic grain. No people, no text, no logos, no screens showing content." },
  { cat: 'studios', label: "Platou · Cheile Turzii, aur", aspect: "16:9", prompt: "Photorealistic wide photograph of an EMPTY modern news studio in late afternoon, 35mm at f/4, eye level, locked off. The same set as the dawn studio: low white stone anchor desk slightly LEFT of centre with a warm brass edge strip, full-height glass wall behind. Through the glass the Cheile Turzii gorge in low golden light — limestone walls warm amber, long shadows reaching across the valley floor, a few birds high against a clear sky. Background two stops under the desk, soft focus. Light oak vertical slat panelling, brushed brass reveals, one deep-crimson base strip, matte pale concrete floor. Warm low key from camera left at 35 degrees carrying the golden-hour quality into the room, broad diffused fill, no hard shadows. RIGHT THIRD clean and empty for graphics. Photographic grain, natural colour, sharp foreground. No people, no text, no logos, no screens showing content." },
  { cat: 'studios', label: "Platou · Turda, doi prezentatori", aspect: "16:9", prompt: "Photorealistic wide photograph of an EMPTY flagship evening news studio at blue hour, 28mm at f/4.5, eye level, locked off, framed wider than a single — the full desk and both side walls in frame. A long monolithic smoked-glass anchor desk runs across the lower third with a thin crimson light strip along its leading edge, wide enough for TWO presenter positions. Behind it the curved panoramic window over Turda at night: warm-lit clock tower, terracotta rooftops, street lamps, hills against deep indigo. City in soft bokeh, two and a half stops down. Dark walnut panelling, blackened steel reveals, polished dark floor with low controlled sheen. Cool practical uplights on the side walls. Soft warm key from camera left, cool rim from camera right, broad diffused fill, no hard shadows. Cinematic, photographic grain, sharp foreground. No people, no text, no logos, no screens showing content." },
]

const uid = () => Math.random().toString(36).slice(2, 10)
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function StudioPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), [])

  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [master, setMaster] = useState<Master>('1080')
  const [fpsOut, setFpsOut] = useState<25 | 30>(30)
  const [provider, setProvider] = useState<'worker' | 'shotstack' | 'creatomate'>('worker')
  // QC report from the owned worker: what the render actually delivered.
  const [workerQc, setWorkerQc] = useState<{ passed: boolean; checks: { name: string; ok: boolean; detail: string }[] } | null>(null)
  const [workerStats, setWorkerStats] = useState<{ seconds: number; renderSeconds: number } | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  // Brand kit: the answer to "which red, which face, where may type sit, what
  // are we mixing to" — given once instead of remembered per film.
  const [kit, setKit] = useState<BrandKit>(TT_KIT)
  const [kitList, setKitList] = useState<BrandKit[]>(KITS as BrandKit[])
  const [overlays, setOverlays] = useState<Overlay[]>([])
  const [showSafe, setShowSafe] = useState(true)
  const [sfx, setSfx] = useState<Sfx[]>([])
  // A synthesised low bed. Silence under a voice reads as an unfinished mix far
  // more often than it reads as restraint.
  const [musicBed, setMusicBed] = useState(false)
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [openVersion, setOpenVersion] = useState<string>('')
  const [notes, setNotes] = useState<NoteRow[]>([])
  const [noteText, setNoteText] = useState('')
  const [noteFrame, setNoteFrame] = useState(0)
  const [conformed, setConformed] = useState(false)
  const [imgPrompt, setImgPrompt] = useState('')
  const [imgAspect, setImgAspect] = useState('4:5')
  const [refImageUrl, setRefImageUrl] = useState('')   // reference photo -> image-to-image

  const [script, setScript] = useState('')
  const [voice] = useState('onyx')
  const [geminiVoice, setGeminiVoice] = useState('Charon')
  const [libCat, setLibCat] = useState<LibCat>('marketing')
  const [motionModel, setMotionModel] = useState('v3-pro')
  // OFF by default now, and this is the single most consequential default in
  // the file. `end_image_url` tells the model the last frame must equal the
  // first; the cheapest way to obey is to not move. Measured on the five shots
  // of the last delivered film: 0.00 %/s of coherent camera movement, every
  // one. Keep it for an anchor plate that must repeat; never for b-roll.
  const [motionLoop, setMotionLoop] = useState(false)  // start frame == end frame
  // How many takes of each shot to shoot before choosing. A film crew does not
  // print the first take either.
  const [takes, setTakes] = useState(2)
  // Kling's own default. Higher follows the prompt harder and drifts less from
  // the still; too high and the motion goes stiff.
  const [cfgScale, setCfgScale] = useState(0.5)
  const [syncEngine, setSyncEngine] = useState('latentsync')
  const [voUrl, setVoUrl] = useState('')
  const [voDur, setVoDur] = useState(0)
  // The script the CURRENT voice was read from, and the voice the CURRENT
  // subtitles were aligned to. Editing the text does not regenerate anything —
  // it cannot, that costs money — so without these two the film renders with
  // yesterday's voice under today's words and nothing says so.
  const [voScript, setVoScript] = useState('')
  const [cuesFor, setCuesFor] = useState('')

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
  // Measured programme loudness of the voiceover (BS.1770 / EBU R128).
  const [voLoudness, setVoLoudness] = useState<LoudnessResult | null>(null)

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

  const [W, H] = MASTERS[master][aspect]
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
    void refreshKits()
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
      // ASK FOR THE MASTER SIZE. Until today this call sent only the aspect,
      // and the edge function answered with 1024 on the long side — 576x1024
      // for a vertical film whose master is 1080x1920. Every still on screen
      // had therefore been enlarged 1.875x from a draft-grade generation, and
      // a Ken Burns push enlarged it further. Twice the master gives the render
      // something to downsample and the push somewhere to go.
      const big = MASTER_STILL[imgAspect as Aspect] || MASTER_STILL['16:9']
      const r = refImageUrl
        ? await invoke<{ publicUrl: string }>('generate-image-edit', { image_urls: [refImageUrl], prompt: imgPrompt.trim(), aspect: imgAspect })
        : await invoke<{ publicUrl: string; provider?: string; renderedAt?: string }>('generate-cover-image',
            { raw_prompt: imgPrompt.trim(), aspect: imgAspect, width: big[0], height: big[1] })
      const at = (r as { renderedAt?: string }).renderedAt
      setScenes(s => [...s, { id: uid(), kind: 'image', url: r.publicUrl, name: (refImageUrl ? 'Editată · ' : 'AI · ') + imgAspect + (at ? ` · ${at}` : ''), duration: 4, kb: 'in' }])
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
      setVoScript(script); setCuesFor('')
      void measureVoice(r.publicUrl)
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // Split a Whisper segment into short display cues (max 2 lines ≈ 42 chars/line)
  // so subtitles never blanket the frame.
  // Caption QC, recomputed only when something that affects captions changes.
  /**
   * What in the film is now out of date with what is on screen.
   *
   * Editing the script does not regenerate the voice, and regenerating the
   * voice does not re-time the subtitles — neither can happen automatically,
   * because both cost money and take a minute. Without saying so, the film
   * renders with the old voice under the new words and nothing anywhere
   * mentions it. That is not a hypothetical: it is what happened.
   */
  const stale = useMemo(() => {
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim()
    const voiceStale = !!voUrl && norm(voScript) !== norm(script)
    const cuesStale = !!voUrl && cues.length > 0 && cuesFor !== voUrl
    return { voiceStale, cuesStale, any: voiceStale || cuesStale }
  }, [voUrl, voScript, script, cues.length, cuesFor])

  const captionQc = useMemo(() => {
    if (!cues.length) return null
    const tl = migrateLegacyProject({ aspect, scenes, cues, words, capMode, subPos, subScale, subsOn: true })
    const extracted = extractCues(tl)
    return { problems: checkCaptions(extracted, tl.timebase.fps), count: extracted.length }
  }, [aspect, scenes, cues, words, capMode, subPos, subScale])

  /**
   * Make the subtitles readable, using the SAME rules that flagged them.
   *
   * The aligner times cues to the voice, and a voice can outrun the eye: this
   * film came back with five cues over seventeen characters a second, one at
   * twenty-two. Nobody reads that. The library already knew how to fix it —
   * extend into the gaps, honour the minimum duration AFTER moving the start,
   * close sub-two-frame gaps into hard cuts — and nothing in the interface
   * called it, so the checker could only ever complain.
   *
   * Frames in, frames out: the conform works on the frame-accurate timeline and
   * the result is converted back, rather than a second implementation of the
   * same rules in seconds.
   */
  function conformSubtitles() {
    if (!cues.length) return
    const fps = fpsOut === 25 ? FPS.pal : FPS.web
    const toFrames = (sec: number) => Math.round((sec * fps.n) / fps.d)
    const toSeconds = (f: number) => (f * fps.d) / fps.n
    const conformed = conformCues(
      cues.map(c => ({ start: toFrames(c.start), end: toFrames(c.end), text: c.text })),
      fps,
      undefined,
      // The slack is almost always at the END — the picture usually outlasts the
      // voice. Without this the last cue has nowhere to grow into, which is
      // exactly where the room is.
      { tailFrames: toFrames(totalDur) },
    )
    setCues(conformed.map(c => ({ start: toSeconds(c.start), end: toSeconds(c.end), text: c.text })))
    setConformed(true)
  }

  // Measures the voiceover's programme loudness so the number can be shown and
  // the export gain can be derived from it instead of guessed.
  async function measureVoice(url: string) {
    if (!url) { setVoLoudness(null); return }
    try {
      const ctx = new AudioContext()
      const buffer = await decode(ctx, url)
      setVoLoudness(measureAudioBuffer(buffer))
      void ctx.close()
    } catch { setVoLoudness(null) }
  }

  // Caption sidecars. The cue data always existed; it just never left the
  // canvas, so no delivery spec asking for subtitles could be met.
  // The project as a real timeline, at the chosen master size and frame rate.
  // Everything downstream — captions, the cloud render, the cost estimate —
  // reads this one object, so the preview and the export cannot drift apart.
  // ─── overlays ───────────────────────────────────────────────────────────
  const addOverlay = (kind: OverlayKind) => setOverlays(o => {
    const at = kind === 'end' ? Math.max(0, totalDur - 3) : kind === 'title' ? 0 : 1
    const seed: Overlay =
      kind === 'title' ? { id: uid(), kind, at, dur: 3, a: 'Titlul filmului', b: kit.name, c: '' }
      : kind === 'lower' ? { id: uid(), kind, at, dur: kit.lowerThirdSeconds, a: 'Nume Prenume', b: 'funcție' }
      : { id: uid(), kind, at, dur: 3, a: kit.name, b: 'Abonează-te', c: 'transilvaniatimes.com' }
    return [...o, seed]
  })
  const setOverlay = (id: string, patch: Partial<Overlay>) =>
    setOverlays(o => o.map(x => x.id === id ? { ...x, ...patch } : x))
  const delOverlay = (id: string) => setOverlays(o => o.filter(x => x.id !== id))

  const addSfx = (name: SfxName, at: number) =>
    setSfx(x => [...x, { id: uid(), name, at: Math.max(0, at), gain: name === 'impact' ? 0.5 : 0.35 }])
  const delSfx = (id: string) => setSfx(x => x.filter(s2 => s2.id !== id))

  /**
   * Put a sound on every cut.
   *
   * The cut list comes from the scene durations, so this stays right when a
   * scene is retimed — and it is the one edit that most reliably turns a
   * sequence of plates into something that reads as cut rather than assembled.
   */
  const sfxOnCuts = (name: SfxName) => {
    let t = 0
    const next: Sfx[] = []
    for (let i = 0; i < scenes.length - 1; i++) {
      t += scenes[i].duration
      // Land it slightly BEFORE the cut: a transition sound that starts on the
      // frame of the cut arrives late to the ear.
      next.push({ id: uid(), name, at: Math.max(0, t - SFX_SECONDS[name] * 0.55), gain: 0.35 })
    }
    setSfx(next)
  }

  /** Expands the overlay list into real clips at a given fps. */
  const overlayClips = useCallback((fps: { n: number; d: number }, filmFrames = 0): Clip[] => {
    const out: Clip[] = []
    if (kit.wordmark !== 'none' && filmFrames > 0) {
      out.push(...wordmark({ kit, fps, start: 0, frames: filmFrames }))
    }
    for (const o of overlays) {
      const start = Math.round((o.at * fps.n) / fps.d)
      const duration = Math.max(2, Math.round((o.dur * fps.n) / fps.d))
      const ctx = { kit, fps, start, duration }
      if (o.kind === 'title') out.push(...titleCard(ctx, { kicker: o.b || undefined, title: o.a, sub: o.c || undefined }))
      else if (o.kind === 'lower') out.push(...lowerThird(ctx, { name: o.a, role: o.b || undefined }))
      else out.push(...endCard(ctx, { title: o.a, line: o.b || undefined, url: o.c || undefined }))
    }
    return out
  }, [overlays, kit])

  // A timeline containing ONLY the overlays, so the preview can draw them with
  // the same compile-and-draw path the renderer uses. That is the whole reason
  // templates are ordinary clips: what you see here is what the file gets, with
  // no second implementation to drift.
  const overlayTl = useMemo<Timeline | null>(() => {
    const fps = fpsOut === 25 ? FPS.pal : FPS.web
    const filmFrames = Math.max(1, Math.round((totalDur * fps.n) / fps.d))
    const clips = overlayClips(fps, filmFrames)
    if (!clips.length) return null
    let tl = migrateLegacyProject({ aspect, scenes: [] }, { fps })
    tl = { ...tl, timebase: { ...tl.timebase, width: W, height: H } }
    const track = emptyTrack('video', 'Titluri', 20)
    tl = { ...tl, tracks: [track] }
    for (const c of clips) tl = addClip(tl, track.id, c)
    return { ...tl, duration: Math.max(1, ...clips.map(c => c.start + c.duration)) }
  }, [overlayClips, fpsOut, aspect, W, H, totalDur])

  function buildTimeline(forceCaptions = false): Timeline {
    const base = projectData() as Parameters<typeof migrateLegacyProject>[0]
    const fps = fpsOut === 25 ? FPS.pal : FPS.web
    let tl = migrateLegacyProject(
      forceCaptions ? { ...base, subsOn: true } : base,
      { fps },
    )
    tl = { ...tl, timebase: { ...tl.timebase, width: W, height: H } }

    // THE KIT IS AUTHORITATIVE. Captions take their face, size and colour from
    // it, and their vertical position is clamped into the safe area — which is
    // what stops a caption rendering underneath TikTok's own caption block,
    // where it is technically present and practically invisible.
    const capStyle: TextStyle = captionStyle(kit, subScale)
    const capY = captionY(kit, SUB_POS[subPos])
    tl = {
      ...tl,
      tracks: tl.tracks.map(track => track.z !== 10 || track.kind !== 'video' ? track : {
        ...track,
        clips: track.clips.map(c => c.source.kind !== 'text' ? c : {
          ...c,
          source: { ...c.source, style: { ...capStyle, ...(c.source.words ? { maxLines: 1 } : {}) } },
          transform: { ...c.transform, position: { x: 0.5, y: capY } },
        }),
      }),
      delivery: { ...tl.delivery, grade: kit.grade, loudness: kit.loudness },
    }

    // A synthesised bed, only when no real track was uploaded — an uploaded
    // track always wins, because someone chose it.
    if (musicBed && !musicUrl) {
      const mTrack = tl.tracks.find(t => t.kind === 'audio' && t.z === 1)
        || emptyTrack('audio', 'Muzică', 1)
      if (!tl.tracks.includes(mTrack)) tl = { ...tl, tracks: [...tl.tracks, mTrack] }
      const secs = Math.max(2, framesToSeconds(tl.duration, fps))
      tl = addClip(tl, mTrack.id, {
        id: uid(), name: 'Pat muzical',
        source: { kind: 'audio', url: `builtin:bed@${secs.toFixed(1)}` },
        start: 0, duration: tl.duration, sourceIn: 0,
        transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
        fit: 'contain',
        // Ducks under the voice like any music would.
        audio: { gain: 0.5, duckTarget: true },
        fadeIn: 0, fadeOut: 0, enabled: true,
      })
    }

    // Sound design on its own track, under the voice and beside the music.
    if (sfx.length) {
      const sTrack = emptyTrack('audio', 'Sunete', 2)
      tl = { ...tl, tracks: [...tl.tracks, sTrack] }
      for (const s2 of sfx) {
        tl = addClip(tl, sTrack.id, {
          id: uid(), name: SFX_LABEL[s2.name],
          source: { kind: 'audio', url: `builtin:${s2.name}` },
          start: Math.round((s2.at * fps.n) / fps.d),
          duration: Math.max(1, Math.round((SFX_SECONDS[s2.name] * fps.n) / fps.d)),
          sourceIn: 0,
          transform: { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, opacity: 1 },
          fit: 'contain',
          // Not a duck target: an accent that ducks under the voice is not an
          // accent. Not a duck source either — it must never pull the music down.
          audio: { gain: s2.gain },
          fadeIn: 0, fadeOut: 0, enabled: true,
        })
      }
    }

    // Titles ride ABOVE the captions: a title card's scrim is meant to cover
    // everything under it, including a caption that happens to be on screen.
    const extra = overlayClips(fps, tl.duration)
    if (extra.length) {
      const track = emptyTrack('video', 'Titluri', 20)
      tl = { ...tl, tracks: [...tl.tracks, track] }
      for (const c of extra) tl = addClip(tl, track.id, c)
      const end = Math.max(...extra.map(c => c.start + c.duration))
      if (end > tl.duration) tl = { ...tl, duration: end }
    }
    return tl
  }

  // A sidecar is independent of whether captions are burned into the picture,
  // so the burn-in switch is forced on here — otherwise turning off the overlay
  // would silently stop the .srt from containing anything.
  function captionTimeline() {
    return buildTimeline(true)
  }

  function downloadText(name: string, body: string, mime: string) {
    const blob = new Blob([body], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  function exportCaptions(kind: 'srt' | 'vtt') {
    try {
      const tl = captionTimeline()
      const extracted = extractCues(tl)
      if (!extracted.length) { setError('Nu există subtitrări de exportat.'); return }
      const base = (projName.trim() || 'subtitrari').replace(/[^\w-]+/g, '-').toLowerCase()
      if (kind === 'srt') downloadText(`${base}.srt`, toSRT(extracted, tl.timebase.fps), 'application/x-subrip')
      else downloadText(`${base}.vtt`, toVTT(extracted, tl.timebase.fps), 'text/vtt')
    } catch (e) { setError('Exportul subtitrărilor a eșuat: ' + (e as Error).message) }
  }

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
      setCues(splitCues(r.segments || [])); setCuesFor(voUrl); setConformed(false)
      setWords(r.words || [])
    } catch (e) { setError((e as Error).message) } finally { setBusy('') }
  }

  // ─── project persistence ────────────────────────────────────────────────
  function projectData() {
    return { aspect, master, fpsOut, provider, scenes, script, lang, tone, elVoiceId, geminiVoice, voice, voUrl, voDur, cues, words, capMode, subsOn, subPos, subScale, musicUrl, musicVol,
      // The kit travels WITH the project, not as a reference. A film approved in
      // March must still render in March's brand in September, and it would not
      // if it read a row somebody has since edited.
      brandKit: kit, overlays, sfx, musicBed }
  }
  // The library lives in the database so a kit can be edited without a deploy;
  // the built-in kits stay as a fallback so Studio works before the migration
  // has been run.
  const refreshKits = useCallback(async () => {
    try {
      const { data } = await db.from('studio_brand_kits').select('id, kit, is_default')
      if (!data || !data.length) return
      const loaded = data.map(r => resolveKit((r as { kit: Partial<BrandKit> }).kit))
      setKitList(loaded)
      const def = data.find(r => (r as { is_default?: boolean }).is_default)
      if (def) setKit(resolveKit((def as { kit: Partial<BrandKit> }).kit))
    } catch { /* migration not run yet — the built-in kits stand in */ }
  }, [db])

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
      setProjName(name); await refreshProjects(); await loadVersions(projId)
    } catch (e) { setError('Salvarea a eșuat (rulează tt-studio-projects.sql?): ' + (e as Error).message) } finally { setBusy('') }
  }
  // ─── review ─────────────────────────────────────────────────────────────
  // A note lands on a FRAME, and is shown as timecode, because "around eleven
  // seconds" is not a note anybody can act on.
  const formatTc = useCallback(
    (frame: number) => formatTimecode(frame, fpsOut === 25 ? FPS.pal : FPS.web),
    [fpsOut],
  )

  const loadVersions = useCallback(async (pid: string) => {
    if (!pid) { setVersions([]); return }
    try {
      const { data } = await db.from('studio_version_review')
        .select('id, version, state, label, note, render_url, created_at, note_count, open_notes')
        .eq('project_id', pid).order('version', { ascending: false }).limit(30)
      setVersions((data || []) as VersionRow[])
    } catch { /* migration not run yet */ }
  }, [db])

  const loadNotes = useCallback(async (vid: string) => {
    if (!vid) { setNotes([]); return }
    try {
      const { data } = await db.from('studio_version_comments')
        .select('id, frame, body, resolved, author_name, created_at')
        .eq('version_id', vid).order('frame', { ascending: true })
      setNotes((data || []) as NoteRow[])
    } catch { setNotes([]) }
  }, [db])

  /**
   * Snapshot the project as it stands and send it for review.
   *
   * The timeline goes in whole. A version is immutable — the database refuses
   * to let its timeline be edited after insert — so what was approved stays
   * exactly as it was approved, and can be re-rendered a year later byte for
   * byte. That is the promise the deterministic renderer exists to keep, and
   * this is the row that holds it.
   */
  async function submitVersion() {
    if (!projId) { setError('Salvează întâi proiectul — o versiune aparține unui proiect.'); return }
    setError(''); setBusy('version')
    try {
      const tl = buildTimeline()
      const problems = validate(tl).filter(p => p.severity === 'error')
      if (problems.length) throw new Error(problems.map(p => `${p.where}: ${p.message}`).join('; '))
      const { data, error: e } = await db.from('studio_project_versions')
        .insert({ project_id: projId, timeline: tl, state: 'review', label: projName || null })
        .select('id').single()
      if (e) throw new Error(e.message)
      await loadVersions(projId)
      if (data?.id) { setOpenVersion(String(data.id)); await loadNotes(String(data.id)) }
    } catch (e) { setError('Versiune: ' + (e as Error).message) } finally { setBusy('') }
  }

  async function setVersionState(id: string, state: VersionState) {
    setError('')
    try {
      const { error: e } = await db.from('studio_project_versions')
        .update({ state, reviewed_at: new Date().toISOString() }).eq('id', id)
      // The database refuses approval while a note is open. Say so plainly
      // rather than showing a Postgres error.
      if (e) throw new Error(/observații/.test(e.message) ? e.message : e.message)
      await loadVersions(projId)
    } catch (e) { setError((e as Error).message) }
  }

  async function addNote() {
    if (!openVersion || !noteText.trim()) return
    setError('')
    try {
      const { error: e } = await db.from('studio_version_comments')
        .insert({ version_id: openVersion, frame: Math.max(0, Math.round(noteFrame)), body: noteText.trim() })
      if (e) throw new Error(e.message)
      setNoteText(''); await loadNotes(openVersion); await loadVersions(projId)
    } catch (e) { setError('Observație: ' + (e as Error).message) }
  }

  async function resolveNote(id: string, resolved: boolean) {
    try {
      await db.from('studio_version_comments')
        .update({ resolved, resolved_at: resolved ? new Date().toISOString() : null }).eq('id', id)
      await loadNotes(openVersion); await loadVersions(projId)
    } catch (e) { setError((e as Error).message) }
  }

  /** Render the snapshot, not the current edit — the point of a version. */
  async function renderVersion(v: VersionRow) {
    setError(''); setBusy('rendering')
    try {
      const { data, error: e } = await db.from('studio_project_versions')
        .select('timeline').eq('id', v.id).single()
      if (e || !data) throw new Error(e?.message || 'versiune negăsită')
      await renderOnWorker(data.timeline as Timeline, v.id)
      await loadVersions(projId)
    } catch (e) { setError('Randare versiune: ' + (e as Error).message) } finally { setBusy('') }
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
      if (d.master === '720' || d.master === '1080') setMaster(d.master)
      if (d.fpsOut === 25 || d.fpsOut === 30) setFpsOut(d.fpsOut)
      if (d.provider === 'worker' || d.provider === 'shotstack' || d.provider === 'creatomate') setProvider(d.provider)
      if (Array.isArray(d.scenes)) setScenes(d.scenes as Scene[])
      if (typeof d.script === 'string') setScript(d.script)
      if (d.lang === 'ro' || d.lang === 'en') setLang(d.lang)
      if (typeof d.tone === 'string') setTone(d.tone)
      if (typeof d.elVoiceId === 'string') setElVoiceId(d.elVoiceId)
      if (typeof d.geminiVoice === 'string') setGeminiVoice(d.geminiVoice)
      if (typeof d.voUrl === 'string') { setVoUrl(d.voUrl); void measureVoice(d.voUrl) }
      if (typeof d.voDur === 'number') setVoDur(d.voDur)
      if (Array.isArray(d.cues)) setCues(d.cues as Cue[])
      setConformed(false)
      // A saved project's voice and cues belong together; treat them as current.
      setVoScript(typeof d.script === 'string' ? d.script : '')
      setCuesFor(typeof d.voUrl === 'string' ? d.voUrl : '')
      if (Array.isArray(d.words)) setWords(d.words as { word: string; start: number; end: number }[])
      if (d.capMode === 'clasic' || d.capMode === 'karaoke') setCapMode(d.capMode)
      if (typeof d.subsOn === 'boolean') setSubsOn(d.subsOn)
      if (typeof d.subPos === 'string') setSubPos(d.subPos as SubPos)
      if (typeof d.subScale === 'number') setSubScale(d.subScale)
      if (typeof d.musicUrl === 'string') setMusicUrl(d.musicUrl)
      if (typeof d.musicVol === 'number') setMusicVol(d.musicVol)
      // resolveKit fills anything the saved copy predates, so an old project
      // opens with the current defaults for fields it never had.
      setKit(resolveKit((d.brandKit as Partial<BrandKit>) || null))
      setOverlays(Array.isArray(d.overlays) ? (d.overlays as Overlay[]) : [])
      setSfx(Array.isArray(d.sfx) ? (d.sfx as Sfx[]) : [])
      setMusicBed(d.musicBed === true)
      setOpenVersion(''); setNotes([]); void loadVersions(String(data.id))
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

  // ─── image → video motion: the closed loop ──────────────────────────────
  //
  // WHAT THE REST OF THE MARKET DOES: generate one clip, show it to you, let
  // you decide. WHAT THIS DOES: shoot several takes, MEASURE each one against
  // the still it was grown from, and refuse the ones that failed.
  //
  // The measurement is not a vibe. Consecutive frames are aligned by searching
  // for the translation and scale that best match them. What the alignment
  // finds is coherent motion — the camera moved. What is left over after
  // aligning is shimmer — pixels changing while the picture goes nowhere.
  // Zero movement with high shimmer is a dead generation, and it is exactly
  // what the last two delivered films were made of, five shots out of five.
  //
  // A take that fails is not quietly used. The still stays on the timeline and
  // you are told, in numbers, what was wrong with the take.
  async function animateScene(id: string) {
    const sc = scenes.find(s => s.id === id)
    if (!sc || sc.kind !== 'image') return
    const still = sc.url
    setError('')
    const mark = (patch: Partial<Scene>) => setScenes(s => s.map(x => x.id === id ? { ...x, ...patch } : x))
    mark({ motion: 'working', stage: 'trimit', takes: undefined, verdict: undefined })

    try {
      const mm = MOTION_MODELS.find(m => m.key === motionModel) || MOTION_MODELS[0]
      const seconds = Math.max(3, Math.min(mm.maxSeconds, Math.round(sc.duration) || 5))
      const n = Math.max(1, Math.min(4, takes))

      const created = await invokeRaw('generate-motion', {
        action: 'create',
        image_url: still,
        model: mm.key,
        duration: seconds,
        takes: n,
        // The loop is opt-in now. See the comment on motionLoop.
        ...(motionLoop && mm.endFrame ? { end_image_url: still } : {}),
        prompt: MOTION_PROMPT,
        negative_prompt: MOTION_NEGATIVE,
        cfg_scale: cfgScale,
        generate_audio: false,
      })
      if (created.configured === false) throw new Error(String(created.message || 'FAL_KEY lipsește.'))
      if (created.error) throw new Error(String(created.error))

      const jobs: { status_url: string; response_url: string }[] =
        Array.isArray(created.jobs) && created.jobs.length
          ? created.jobs
          : [{ status_url: String(created.status_url || ''), response_url: String(created.response_url || '') }]
      if (!jobs[0]?.status_url) throw new Error('fal nu a returnat status_url')

      // Every take is polled in parallel — they render in parallel at fal, so
      // polling them one after another would triple the wait for nothing.
      mark({ stage: `filmez ${jobs.length} duble` })
      const urls = await Promise.all(jobs.map(async (jb) => {
        for (let i = 0; i < 75; i++) {
          await sleep(4000)
          const st = await invokeRaw('generate-motion', { action: 'poll', status_url: jb.status_url, response_url: jb.response_url })
          if (st.error) throw new Error(String(st.error))
          if (st.status === 'COMPLETED' && st.publicUrl) return String(st.publicUrl)
        }
        throw new Error('Animarea durează neobișnuit de mult — reîncearcă.')
      }))

      // ── the measurement ───────────────────────────────────────────────
      mark({ stage: 'măsor dublele' })
      let measured: Take[] = urls.map(u => ({ url: u, score: 0, accepted: true, why: 'nemăsurat', move: 0, ratio: 0 }))
      let judged = false
      try {
        const insp = await invokeRaw('render-worker', {
          action: 'inspect', clips: urls.map(u => ({ url: u })), referenceImage: still,
        })
        if (!insp.error && Array.isArray(insp.takes)) {
          judged = true
          measured = insp.takes.map((t: {
            url: string
            judgement?: { score?: number; accepted?: boolean; failed?: string[] }
            analysis?: { motion?: { coherentPercentPerSecond?: number; zoomPercentPerSecond?: number; shimmerRatio?: number } }
          }) => {
            const j = t.judgement || {}
            const m = t.analysis?.motion || {}
            return {
              url: t.url,
              score: Number(j.score || 0),
              accepted: !!j.accepted,
              why: (j.failed || []).join(' · ') || 'trece',
              move: Number(m.coherentPercentPerSecond || 0) + Number(m.zoomPercentPerSecond || 0),
              // Instability as a multiple of what a half-pixel misalignment
              // costs on THIS picture. Raw shimmer is not comparable between a
              // misty landscape and a plain studio wall; this is.
              ratio: Number(m.shimmerRatio || 0),
            }
          })
        }
      } catch { /* the worker is optional — an unmeasured take is still a take */ }

      measured = [...measured].sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.score - a.score)
      const winner = measured.find(t => t.accepted) || null

      if (!winner) {
        // Nothing usable. The still stays; you are told why, in numbers.
        mark({
          motion: 'idle', stage: undefined, still, takes: measured,
          verdict: `${measured.length} duble, niciuna bună — ${measured[0]?.why || 'respinse'}. Refilmează sau alege manual.`,
        })
        setError('Toate dublele au fost respinse la măsurare. Detaliile sunt pe scenă.')
        return
      }

      const v = await loadVideo(winner.url)
      mark({
        kind: 'video', url: winner.url, still,
        name: '🎞 ' + sc.name.replace(/^🎞 /, ''),
        duration: Math.min(30, Math.max(1, v.duration || sc.duration)),
        kb: 'none', motion: 'done', stage: undefined,
        takes: measured.length > 1 ? measured : undefined,
        verdict: judged
          ? `mișcare ${winner.move.toFixed(2)} %/s · stabilitate ${winner.ratio.toFixed(2)}×` +
            (measured.length > 1 ? ` · dubla ${measured.indexOf(winner) + 1} din ${measured.length}` : '')
          : undefined,
      })
    } catch (e) {
      setError('Animare: ' + (e as Error).message)
      setScenes(s => s.map(x => x.id === id ? { ...x, motion: 'idle', stage: undefined } : x))
    }
  }

  /** Adopt a take the measurement rejected, deliberately and on the record.
   *  NOT named useTake: a `use` prefix makes ESLint treat it as a React hook
   *  and forbid calling it from a click handler. */
  async function adoptTake(id: string, take: Take) {
    const sc = scenes.find(s => s.id === id)
    if (!sc) return
    try {
      const v = await loadVideo(take.url)
      setScenes(s => s.map(x => x.id === id ? {
        ...x, kind: 'video', url: take.url, still: x.still || x.url,
        name: '🎞 ' + x.name.replace(/^🎞 /, ''),
        duration: Math.min(30, Math.max(1, v.duration || x.duration)),
        kb: 'none', motion: 'done',
        verdict: take.accepted ? 'aleasă manual' : `aleasă manual, respinsă la măsurare (${take.why})`,
      } : x))
    } catch (e) { setError((e as Error).message) }
  }

  // ── LIPSYNC ───────────────────────────────────────────────────────────────
  // Studio already makes the clip and the voiceover; nothing joined them, which
  // is why a talking-head clip had to be built somewhere else. This is that
  // step. It replaces the scene's video with a version whose mouth matches the
  // generated voice.
  //
  // Two things decide whether the result is good, and neither is the engine:
  //   • the FACE must be large in frame. LatentSync works at 256x256 inside, so
  //     a face smaller than that gets upsampled into a soft mouth. A selfie or a
  //     medium close-up is fine; a wide shot is not.
  //   • the clip should be at least as long as the voiceover, or it repeats.
  async function lipsyncScene(id: string) {
    const sc = scenes.find(s => s.id === id)
    if (!sc || sc.kind !== 'video') return
    if (!voUrl) { setError('Generează întâi vocea — lipsync-ul are nevoie de audio.'); return }
    setError('')
    setScenes(s => s.map(x => x.id === id ? { ...x, sync: 'working' } : x))
    try {
      const created = await invokeRaw('generate-motion', {
        action: 'lipsync',
        video_url: sc.url,
        audio_url: voUrl,
        engine: syncEngine,
        seconds: Math.round(voDur || sc.duration || 10),
      })
      if (created.configured === false) throw new Error(String(created.message || 'FAL_KEY lipsește.'))
      if (created.error) throw new Error(String(created.error))
      const statusUrl = String(created.status_url || ''), responseUrl = String(created.response_url || '')
      if (!statusUrl) throw new Error('fal nu a returnat status_url')
      for (let i = 0; i < 90; i++) {
        await sleep(4000)
        const st = await invokeRaw('generate-motion', { action: 'poll', status_url: statusUrl, response_url: responseUrl })
        if (st.error) throw new Error(String(st.error))
        if (st.status === 'COMPLETED' && st.publicUrl) {
          const url = String(st.publicUrl)
          const v = await loadVideo(url)
          setScenes(s => s.map(x => x.id === id
            ? { ...x, url, name: '🗣 ' + x.name.replace(/^[🎞🗣] /, ''), duration: Math.min(180, Math.max(1, v.duration || x.duration)), sync: 'done' }
            : x))
          return
        }
      }
      throw new Error('Lipsync-ul durează neobișnuit de mult — reîncearcă.')
    } catch (e) {
      setError('Lipsync: ' + (e as Error).message)
      setScenes(s => s.map(x => x.id === id ? { ...x, sync: 'idle' } : x))
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
    // THE WORDMARK USED TO BE PAINTED HERE, and that was the bug.
    //
    // It was hard-coded into this function, which draws the preview AND feeds
    // the browser recorder — so it appeared in the preview and in a browser
    // render, and was absent from every worker render, because the worker draws
    // the timeline and the wordmark was never in it. Three outputs, two
    // different films, and no way to switch it off.
    //
    // It is now an ordinary pair of clips from lib/brand/templates, off by
    // default, and it arrives through the overlay path below like every other
    // piece of type. Preview and file cannot disagree about it any more.

    // TITLES, drawn through the SAME compile-and-draw path as the render.
    if (overlayTl) {
      const fps = fpsOut === 25 ? 25 : 30
      const f = Math.round(t * fps)
      if (f >= 0 && f < overlayTl.duration) {
        drawCompiled(ctx as unknown as Parameters<typeof drawCompiled>[0],
          compileFrame(overlayTl, f), W, H, () => null, { clear: false })
      }
    }

    // Safe area — a guide, never rendered into the file.
    if (showSafe && kit.safeArea !== 'none') {
      const b = safeBox(kit)
      ctx.save()
      ctx.strokeStyle = 'rgba(255,211,122,0.75)'
      ctx.setLineDash([Math.max(4, W * 0.008), Math.max(4, W * 0.008)])
      ctx.lineWidth = Math.max(1, W * 0.002)
      ctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H)
      ctx.restore()
    }
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
      const fps = fpsOut
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
      // Loudness, measured rather than estimated. The old code averaged RMS and
      // aimed at an arbitrary 0.12 — RMS is not loudness, it ignores how the ear
      // weights frequency and counts silence as programme. This measures gated
      // BS.1770 loudness and moves it to the target, refusing any gain that
      // would push the peak past the ceiling.
      const normGain = (b: AudioBuffer) => {
        try {
          const plan = planNormalisation(measureAudioBuffer(b), 'social')
          const g = plan.safeGain
          return Number.isFinite(g) && g > 0 ? Math.min(4, Math.max(0.25, g)) : 1
        } catch { return 1 }
      }
      let voSrc: AudioBufferSourceNode | null = null
      let muSrc: AudioBufferSourceNode | null = null
      if (voUrl) { const b = await decode(ac, voUrl); voSrc = ac.createBufferSource(); voSrc.buffer = b; const g = ac.createGain(); g.gain.value = normGain(b); voSrc.connect(g).connect(comp) }
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

  // Render on our own worker. The browser never sees the worker's token: it
  // calls an admin-gated edge function, which calls the worker. The finished
  // file comes back as a URL carrying a one-time key for that job alone.
  async function renderOnWorker(tl: Timeline, versionId?: string) {
    setWorkerQc(null); setWorkerStats(null)
    const created = await invokeRaw('render-worker', { action: 'create', timeline: tl })
    if (created.configured === false) {
      setCloud({ status: 'unconfigured', url: '', msg: String(created.message || '') }); return
    }
    if (created.error) {
      const problems = Array.isArray(created.problems)
        ? ' — ' + (created.problems as { where: string; message: string }[]).map(p => `${p.where}: ${p.message}`).join('; ')
        : ''
      setCloud({ status: 'error', url: '', msg: String(created.error) + problems }); return
    }
    const id = String(created.id || '')
    if (!id) { setCloud({ status: 'error', url: '', msg: 'Workerul nu a returnat un id.' }); return }

    // A three-minute bulletin takes about nine minutes, so allow well past that.
    for (let i = 0; i < 300; i++) {
      await sleep(4000)
      const st = await invokeRaw('render-worker', { action: 'status', job_id: id })
      if (st.error) { setCloud({ status: 'error', url: '', msg: String(st.error) }); return }

      const state = String(st.state || 'rendering')
      const pct = (st.progress as { percent?: number } | null)?.percent
      setCloud({
        status: state === 'queued' ? 'în așteptare' : state === 'rendering' ? 'rendering' : state,
        url: '',
        msg: typeof pct === 'number' ? `${Math.round(pct * 100)}%` : '',
      })

      if (state === 'failed') {
        setCloud({ status: 'failed', url: '', msg: String(st.error || 'Randare eșuată.') }); return
      }
      if (state.startsWith('done')) {
        setWorkerQc((st.qc as { passed: boolean; checks: { name: string; ok: boolean; detail: string }[] }) || null)
        if (typeof st.seconds === 'number' && typeof st.renderSeconds === 'number') {
          setWorkerStats({ seconds: st.seconds, renderSeconds: st.renderSeconds })
        }
        setCloud({ status: 'succeeded', url: String(st.downloadUrl || ''), msg: '' })
        // A version keeps the file and the QC report it was signed off against.
        if (versionId) {
          try {
            await db.from('studio_project_versions').update({
              render_url: String(st.downloadUrl || ''),
              qc_report: st.qc ?? null,
            }).eq('id', versionId)
          } catch { /* the render stands even if the stamp fails */ }
        }
        return
      }
    }
    setCloud({ status: 'timeout', url: '', msg: 'Randarea durează neobișnuit de mult.' })
  }

  async function renderCloud() {
    if (scenes.length === 0) { setError('Adaugă cel puțin o scenă.'); return }
    setError(''); setCloud({ status: 'creating', url: '', msg: '' })
    try {
      const tl = buildTimeline()
      const problems = validate(tl).filter(x => x.severity === 'error')
      if (problems.length) {
        setCloud({ status: 'error', url: '', msg: problems.map(x => `${x.where}: ${x.message}`).join(' · ') })
        return
      }
      // The owned worker takes the timeline itself — no spec translation, so
      // nothing is lost between what you previewed and what is rendered.
      if (provider === 'worker') return renderOnWorker(tl)

      const spec = provider === 'shotstack' ? toShotstackEdit(tl) : buildCloudSpec()
      const created = await invokeRaw('render-video', { spec, provider })
      if (created.configured === false) { setCloud({ status: 'unconfigured', url: '', msg: String(created.message || '') }); return }
      if (created.ok === false) { setCloud({ status: 'error', url: '', msg: 'Provider: ' + JSON.stringify(created.body).slice(0, 300) }); return }
      const id = readJobId(provider, created.body)
      if (!id) { setCloud({ status: 'error', url: '', msg: 'Fără id de la provider: ' + JSON.stringify(created.body).slice(0, 250) }); return }
      for (let i = 0; i < 120; i++) {
        await sleep(4000)
        const st = await invokeRaw('render-video', { poll_id: id, provider })
        const job = readJobStatus(provider, st.body)
        setCloud({ status: job.state, url: job.url || '', msg: '' })
        if (job.state === 'done' && job.url) { setCloud({ status: 'succeeded', url: job.url, msg: '' }); return }
        if (job.state === 'failed') { setCloud({ status: 'failed', url: '', msg: job.message || 'Randare eșuată la provider.' }); return }
      }
      setCloud({ status: 'timeout', url: '', msg: 'Durează neobișnuit de mult — verifică în contul providerului.' })
    } catch (e) {
      setCloud({ status: 'error', url: '', msg: (e as Error).message })
    }
  }


  // ─── UI ─────────────────────────────────────────────────────────────────
  const previewW = aspect === '16:9' ? 360 : aspect === '1:1' ? 300 : 236
  // What the hosted renderer will drop relative to the timeline. Said out loud,
  // because a motion curve quietly swapped for a preset is the kind of thing
  // that gets noticed after delivery rather than before.
  const cloudLimits = useMemo(
    () => (scenes.length && provider === 'shotstack' ? describeLimitations(buildTimeline()) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenes, provider, cues, subsOn, subPos, subScale, musicUrl, musicVol, voUrl, aspect, master, fpsOut],
  )

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
        <span className="w-px h-5 bg-white/10 mx-1" />
        <span className="font-sans text-[11px] uppercase tracking-widest text-white/40">Master</span>
        {(['1080', '720'] as Master[]).map(m => (
          <button key={m} onClick={() => setMaster(m)}
            className={'px-2.5 py-1.5 text-[12px] border ' + (master === m ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/60 border-white/[0.07]')}>
            {m}p
          </button>
        ))}
        <span className="font-sans text-[11px] uppercase tracking-widest text-white/40 ml-2">Cadre</span>
        {([30, 25] as const).map(f => (
          <button key={f} onClick={() => setFpsOut(f)} title={f === 25 ? 'TV / EBU' : 'social'}
            className={'px-2.5 py-1.5 text-[12px] border ' + (fpsOut === f ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/60 border-white/[0.07]')}>
            {f}
          </button>
        ))}
        <span className="font-mono text-[11px] text-white/30">{W}×{H}</span>
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
              {LIB_CATS.map(c => (
                <button key={c.key} onClick={() => setLibCat(c.key)}
                  className={'px-3 py-1.5 text-[11px] font-bold border ' + (libCat === c.key
                    ? 'bg-brand-red text-white border-brand-red'
                    : 'bg-[#111] text-white/50 border-white/[0.07] hover:border-white/20')}>
                  {c.label}
                  <span className="ml-1.5 opacity-50">{IMG_PRESETS.filter(p => p.cat === c.key).length}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {IMG_PRESETS.filter(p => p.cat === libCat).map(p => (
                <button key={p.label} onClick={() => { setImgPrompt(p.prompt); setImgAspect(p.aspect) }}
                  title={p.prompt.slice(0, 220) + '…'}
                  className="px-3 py-1.5 text-[11px] bg-[#111] border border-white/[0.07] text-white/70 hover:border-brand-red/60 text-left">
                  {p.label}<span className="ml-1.5 text-[10px] text-white/25">{p.aspect}</span>
                </button>
              ))}
            </div>
            {libCat === 'anchors' && (
              <p className="text-[10.5px] text-white/35 -mt-1 mb-2 leading-relaxed">
                Generează portretul → <span className="text-amber-300/80">Animează</span> (cu „buclă” bifat) → <span className="text-sky-300/80">Lipsync</span> peste voce.
                Cadrarea e deja corectă: spațiu deasupra capului pentru banda grafică, faţa la ~40% din înălţime pentru lipsync, gura închisă.
              </p>
            )}
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

          {/* ── BRAND & TITLURI ─────────────────────────────────────────
              The kit decides which red, which face, where type may sit and
              what the mix is delivered to — once, for every film. Titles are
              stored as intent and expanded into real clips at build time, so
              improving a template improves every project that uses one. */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                <Type className="w-3.5 h-3.5" /> Brand și titluri
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <select value={kit.id} onChange={e => setKit(kitList.find(k => k.id === e.target.value) || TT_KIT)}
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  {kitList.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
                <button onClick={() => setKit(kitList.find(k => k.id === kit.id) || TT_KIT)}
                  title="Adoptă kitul curent din bibliotecă. Un proiect salvat păstrează o COPIE a kitului de la momentul salvării — ca un film aprobat să se randeze la fel și peste un an. Asta e butonul care renunță la copia înghețată, deliberat."
                  className="text-[11px] px-2 py-1 border border-white/15 text-white/55 hover:border-white/35">
                  reîncarcă
                </button>
                <input type="color" value={kit.colour.accent} aria-label="Culoare accent"
                  onChange={e => setKit(k => ({ ...k, colour: { ...k.colour, accent: e.target.value } }))}
                  className="w-7 h-7 bg-black border border-white/10 p-0.5 cursor-pointer" />
                <span className="text-[10px] uppercase tracking-wider text-white/25">zonă sigură</span>
                <select value={kit.safeArea} onChange={e => setKit(k => ({ ...k, safeArea: e.target.value as SafeAreaName }))}
                  title="Unde e sigur să pui text. Pe TikTok, partea de jos e acoperită de descriere și butoane — un subtitlu la 88% din înălțime e acolo, dar nu se vede."
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  {Object.keys(SAFE_AREAS).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-white/50 cursor-pointer">
                  <input type="checkbox" checked={showSafe} onChange={e => setShowSafe(e.target.checked)} className="accent-amber-500" />
                  arată ghidul
                </label>
                <span className="text-[10px] uppercase tracking-wider text-white/25">siglă</span>
                <select value={kit.wordmark} onChange={e => setKit(k => ({ ...k, wordmark: e.target.value as BrandKit['wordmark'] }))}
                  title="O siglă permanentă în colț, pe toată durata filmului. Implicit oprită: până acum era desenată direct în previzualizare, deci apărea în previzualizare și în înregistrarea din browser, dar NU în randarea din worker."
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  <option value="none">fără</option>
                  <option value="topLeft">sus-stânga</option>
                  <option value="bottomLeft">jos-stânga</option>
                </select>
                <span className="text-[10px] uppercase tracking-wider text-white/25">mix</span>
                <select value={kit.loudness} onChange={e => setKit(k => ({ ...k, loudness: e.target.value as BrandKit['loudness'] }))}
                  title="Ținta de normalizare EBU R128. −16 LUFS pentru social, −23 pentru difuzare."
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  <option value="social">social · −16 LUFS</option>
                  <option value="broadcast">difuzare · −23 LUFS</option>
                  <option value="none">fără</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(['title', 'lower', 'end'] as OverlayKind[]).map(k => (
                <button key={k} onClick={() => addOverlay(k)}
                  className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/70 hover:border-white/25 text-[12px] font-bold px-3 py-1.5">
                  <Crop className="w-3.5 h-3.5" /> {OVERLAY_LABEL[k]}
                </button>
              ))}
              <span className="text-[11px] text-white/25">
                {overlays.length === 0 ? 'Fără titluri — filmul are doar subtitrări.' : `${overlays.length} pe cronologie`}
              </span>
            </div>

            {/* ── SUNETE ─────────────────────────────────────────────────
                Synthesised by the worker, not licensed. A cut with nothing
                under it sounds like a slideshow. */}
            <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-white/[0.07]">
              <span className="text-[10px] uppercase tracking-wider text-white/25">sunete</span>
              <button onClick={() => sfxOnCuts('whoosh')} disabled={scenes.length < 2}
                title="Pune un whoosh pe fiecare tăietură, puțin înaintea ei — un sunet care începe exact pe cadrul tăieturii ajunge târziu la ureche."
                className="text-[11px] px-2 py-1 border border-white/15 text-white/60 hover:border-white/35 disabled:opacity-40">
                whoosh pe tăieturi
              </button>
              {(['whoosh', 'impact', 'riser', 'click'] as SfxName[]).map(n => (
                <button key={n} onClick={() => addSfx(n, 0)}
                  className="text-[11px] px-2 py-1 border border-white/15 text-white/50 hover:border-white/35">+ {n}</button>
              ))}
              <label className="flex items-center gap-1 text-[11px] text-white/55 cursor-pointer"
                title="Un pat muzical jos, sintetizat: A grav, cvinta și octava, cu un partial ușor dezacordat ca sunetul să respire. Se estompează sub voce. Un track încărcat are întâietate.">
                <input type="checkbox" checked={musicBed} onChange={e => setMusicBed(e.target.checked)} className="accent-amber-500" />
                pat muzical{musicUrl ? ' (ai deja track)' : ''}
              </label>
              {sfx.length > 0 && <button onClick={() => setSfx([])} className="text-[11px] text-white/30 hover:text-red-400">golește</button>}
            </div>

            {sfx.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {sfx.map(s2 => (
                  <span key={s2.id} className="flex items-center gap-1.5 text-[10px] px-1.5 py-1 border border-white/12 text-white/55">
                    {s2.name}
                    <input type="number" min={0} step={0.1} value={s2.at}
                      onChange={e => setSfx(x => x.map(y => y.id === s2.id ? { ...y, at: Math.max(0, Number(e.target.value)) } : y))}
                      className="w-14 bg-black border border-white/10 text-white/80 text-[10px] px-1 py-0.5" />
                    <input type="number" min={0} max={1} step={0.05} value={s2.gain}
                      title="Nivel"
                      onChange={e => setSfx(x => x.map(y => y.id === s2.id ? { ...y, gain: Math.max(0, Math.min(1, Number(e.target.value))) } : y))}
                      className="w-12 bg-black border border-white/10 text-white/80 text-[10px] px-1 py-0.5" />
                    <button onClick={() => delSfx(s2.id)} className="text-white/25 hover:text-red-400">×</button>
                  </span>
                ))}
              </div>
            )}

            {overlays.length > 0 && (
              <div className="space-y-2 mt-3">
                {overlays.map(o => (
                  <div key={o.id} className="bg-[#111] border border-white/[0.07] p-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider text-amber-300/80 w-24">{OVERLAY_LABEL[o.kind]}</span>
                      <label className="text-[10px] text-white/30">la</label>
                      <input type="number" min={0} max={180} step={0.5} value={o.at}
                        onChange={e => setOverlay(o.id, { at: Math.max(0, Number(e.target.value)) })}
                        className="w-16 bg-black border border-white/10 text-white/80 text-[11px] px-1.5 py-1" />
                      <label className="text-[10px] text-white/30">durată</label>
                      <input type="number" min={1} max={20} step={0.5} value={o.dur}
                        onChange={e => setOverlay(o.id, { dur: Math.max(1, Number(e.target.value)) })}
                        className="w-16 bg-black border border-white/10 text-white/80 text-[11px] px-1.5 py-1" />
                      <button onClick={() => delOverlay(o.id)} className="ml-auto text-white/30 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                    </div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <input value={o.a} onChange={e => setOverlay(o.id, { a: e.target.value })}
                        placeholder={o.kind === 'lower' ? 'Nume' : 'Titlu'}
                        className="flex-1 min-w-[140px] bg-black border border-white/10 text-white/90 text-[12px] px-2 py-1" />
                      <input value={o.b || ''} onChange={e => setOverlay(o.id, { b: e.target.value })}
                        placeholder={o.kind === 'lower' ? 'funcție' : o.kind === 'title' ? 'supratitlu' : 'mesaj'}
                        className="flex-1 min-w-[120px] bg-black border border-white/10 text-white/70 text-[12px] px-2 py-1" />
                      {o.kind !== 'lower' && (
                        <input value={o.c || ''} onChange={e => setOverlay(o.id, { c: e.target.value })}
                          placeholder={o.kind === 'title' ? 'subtitlu' : 'adresă web'}
                          className="flex-1 min-w-[120px] bg-black border border-white/10 text-white/70 text-[12px] px-2 py-1" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── REVIZUIRE ȘI APROBARE ────────────────────────────────────
              A version is an immutable snapshot: the database refuses to let
              its timeline change after insert, and refuses to approve it while
              a note against it is still open. So "approved" means something,
              and an approved film re-renders a year later byte for byte. */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5" /> Revizuire și aprobare
              </p>
              <button onClick={submitVersion} disabled={busy === 'version' || !projId}
                title={projId ? 'Îngheață montajul actual ca versiune și trimite-l spre revizuire.' : 'Salvează întâi proiectul.'}
                className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/80 hover:border-white/25 disabled:opacity-40 text-[12px] font-bold px-3 py-1.5">
                {busy === 'version' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Trimite spre aprobare
              </button>
            </div>

            {!projId && <p className="text-[12px] text-white/30">Salvează proiectul ca să poți crea versiuni.</p>}
            {projId && versions.length === 0 && (
              <p className="text-[12px] text-white/30">Nicio versiune încă. Montajul curent nu este înghețat nicăieri.</p>
            )}

            <div className="space-y-2">
              {versions.map(v => (
                <div key={v.id} className="bg-[#111] border border-white/[0.07]">
                  <div className="flex items-center gap-2 p-2 flex-wrap">
                    <span className="font-sans text-[12px] text-white/80 w-8">v{v.version}</span>
                    <span className={'text-[10px] uppercase tracking-wider px-1.5 py-0.5 border ' + STATE_TONE[v.state]}>
                      {STATE_LABEL[v.state]}
                    </span>
                    <span className="text-[11px] text-white/30">{new Date(v.created_at).toLocaleString('ro-RO')}</span>
                    {v.open_notes > 0 && (
                      <span className="text-[10px] text-amber-300/80">{v.open_notes} observații deschise</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => { const next = openVersion === v.id ? '' : v.id; setOpenVersion(next); void loadNotes(next) }}
                        className="text-[11px] px-2 py-1 border border-white/15 text-white/60 hover:border-white/35">
                        {openVersion === v.id ? 'Ascunde' : 'Observații'}
                      </button>
                      {/* NOT the same word as the button on the right.
                          This one renders the frozen snapshot; that one renders
                          what is on screen. Both said "Randează", which is how
                          you edit the script, press render, and get the old
                          film back with no error anywhere. */}
                      <button onClick={() => renderVersion(v)} disabled={busy === 'rendering'}
                        title={`Randează instantaneul v${v.version} exact așa cum a fost înghețat — NU montajul curent. Pentru montajul curent folosește „Randează în cloud” din dreapta.`}
                        className="text-[11px] px-2 py-1 border border-white/15 text-white/60 hover:border-white/35 disabled:opacity-40">
                        Randează v{v.version}
                      </button>
                      {v.render_url && (
                        <a href={v.render_url} target="_blank" rel="noreferrer"
                          className="text-[11px] px-2 py-1 border border-sky-500/40 text-sky-300/90 hover:bg-sky-500/10">Fișier</a>
                      )}
                      {v.state !== 'approved' && (
                        <button onClick={() => setVersionState(v.id, 'approved')}
                          title={v.open_notes > 0 ? 'Nu se poate aproba cât timp sunt observații deschise.' : 'Aprobă această versiune.'}
                          className="text-[11px] px-2 py-1 border border-emerald-500/40 text-emerald-300/90 hover:bg-emerald-500/10">Aprobă</button>
                      )}
                      {v.state !== 'rejected' && (
                        <button onClick={() => setVersionState(v.id, 'rejected')}
                          className="text-[11px] px-2 py-1 border border-red-500/30 text-red-300/80 hover:bg-red-500/10">Respinge</button>
                      )}
                    </div>
                  </div>

                  {openVersion === v.id && (
                    <div className="border-t border-white/[0.07] p-2 space-y-2">
                      {notes.length === 0 && <p className="text-[11px] text-white/25">Nicio observație pe această versiune.</p>}
                      {notes.map(n => (
                        <div key={n.id} className="flex items-start gap-2">
                          <span className="font-sans text-[11px] text-amber-300/80 w-16 shrink-0 tabular-nums">
                            {formatTc(n.frame)}
                          </span>
                          <p className={'text-[12px] flex-1 ' + (n.resolved ? 'text-white/25 line-through' : 'text-white/75')}>{n.body}</p>
                          <button onClick={() => resolveNote(n.id, !n.resolved)}
                            className="text-[10px] px-1.5 py-0.5 border border-white/15 text-white/50 hover:border-white/35 shrink-0">
                            {n.resolved ? 'redeschide' : 'rezolvat'}
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-1">
                        <input type="number" min={0} value={noteFrame} onChange={e => setNoteFrame(Number(e.target.value))}
                          title="Cadrul la care se referă observația."
                          className="w-20 bg-black border border-white/10 text-white/80 text-[11px] px-1.5 py-1" />
                        <span className="text-[10px] text-white/25 w-16 tabular-nums">{formatTc(noteFrame)}</span>
                        <input value={noteText} onChange={e => setNoteText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') void addNote() }}
                          placeholder="Observație la acest cadru…"
                          className="flex-1 bg-black border border-white/10 text-white/90 text-[12px] px-2 py-1" />
                        <button onClick={addNote} disabled={!noteText.trim()}
                          className="text-[11px] px-2 py-1 border border-white/15 text-white/60 hover:border-white/35 disabled:opacity-40">Adaugă</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Timeline */}
          <div className="bg-[#1a1a1a] border border-white/[0.07] p-5">
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="font-sans text-[11px] font-bold uppercase tracking-widest text-white/40">Cronologie</p>
              {/* ── MOTOR VIDEO ────────────────────────────────────────────
                  The same Kling engine the kling.ai site runs, driven from
                  here. `buclă` sends the source still as BOTH the start and
                  the end frame, so the clip returns to its opening pose and
                  repeats with no visible seam — the reason this used to have
                  to be done on kling.ai. */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider text-white/25">motor</span>
                <select value={motionModel} onChange={e => setMotionModel(e.target.value)}
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  {MOTION_MODELS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[11px] text-white/50 cursor-pointer"
                  title="Trimite aceeași imagine ca prim ȘI ultim cadru. Bun pentru un plan de prezentator care se repetă; PROST pentru b-roll: modelul primește ordinul ca ultimul cadru să fie egal cu primul, iar cel mai ieftin mod de a-l respecta este să nu miște deloc.">
                  <input type="checkbox" checked={motionLoop} onChange={e => setMotionLoop(e.target.checked)}
                    className="accent-amber-500" />
                  buclă
                </label>
                <span className="text-white/15">·</span>
                <span className="text-[10px] uppercase tracking-wider text-white/25">duble</span>
                <select value={takes} onChange={e => setTakes(Number(e.target.value))}
                  title="Câte duble filmăm din fiecare plan înainte de a alege. Fiecare dublă este măsurată; se păstrează cea care trece."
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option>
                </select>
                <span className="text-[10px] uppercase tracking-wider text-white/25">cfg</span>
                <input type="number" min={0} max={1} step={0.05} value={cfgScale}
                  onChange={e => setCfgScale(Math.max(0, Math.min(1, Number(e.target.value))))}
                  title="Cât de literal urmează modelul promptul. 0.5 este implicit la Kling. Mai sus înseamnă mai puțină derivă de culoare, dar mișcare mai țeapănă. Doar v3 și 2.1 acceptă acest câmp."
                  className="w-14 bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1" />
                <span className="text-white/15">·</span>
                <span className="text-[10px] uppercase tracking-wider text-white/25">lipsync</span>
                <select value={syncEngine} onChange={e => setSyncEngine(e.target.value)}
                  className="bg-black border border-white/10 text-white/70 text-[11px] px-1.5 py-1">
                  {SYNC_ENGINES.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
            </div>
            {scenes.length === 0 && <p className="text-[13px] text-white/30 py-6 text-center">Nicio scenă încă. Generează sau încarcă mai sus.</p>}
            <div className="space-y-2">
              {scenes.map((sc, i) => (
                <div key={sc.id} className="bg-[#111] border border-white/[0.07]">
                <div className="flex items-center gap-3 p-2">
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
                          title="Transformă fotografia într-un clip cu mișcare reală (Kling, prin fal.ai)"
                          className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 border border-amber-500/40 text-amber-300/90 hover:bg-amber-500/10 disabled:opacity-60">
                          {sc.motion === 'working' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                          {sc.motion === 'working' ? (sc.stage ? sc.stage + '…' : 'Animez…') : 'Animează'}
                        </button>
                        {(() => {
                          const mm = MOTION_MODELS.find(m => m.key === motionModel) || MOTION_MODELS[0]
                          const secs = Math.max(3, Math.min(mm.maxSeconds, Math.round(sc.duration) || 5))
                          return <span className="text-[10px] text-white/30">
                            {secs}s × {takes} · ${(mm.usdPerSecond * secs * takes).toFixed(2)}
                            {motionLoop && mm.endFrame ? ' · buclă' : ''}
                            {!mm.negative && <span className="text-amber-400/70"> · fără negativ</span>}
                          </span>
                        })()}
                      </>}
                      {sc.kind === 'video' && <>
                        <span className="text-[11px] text-white/40">clip · {sc.duration.toFixed(1)}s (fără sunet)</span>
                        <button onClick={() => lipsyncScene(sc.id)} disabled={sc.sync === 'working' || !voUrl}
                          title={voUrl
                            ? 'Sincronizează buzele cu vocea generată. Merge doar dacă fața e mare în cadru.'
                            : 'Generează întâi vocea (mai jos) — lipsync-ul are nevoie de audio.'}
                          className="flex items-center gap-1 text-[11px] font-bold px-2 py-1 border border-sky-500/40 text-sky-300/90 hover:bg-sky-500/10 disabled:opacity-40">
                          {sc.sync === 'working' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                          {sc.sync === 'working' ? 'Sincronizez…' : sc.sync === 'done' ? 'Re-sincronizează' : 'Lipsync'}
                        </button>
                        {sc.sync === 'done' && <span className="text-[10px] text-emerald-400/70">buze sincronizate</span>}
                      </>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <button onClick={() => move(i, -1)} className="text-white/30 hover:text-white"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => move(i, 1)} className="text-white/30 hover:text-white"><ArrowDown className="w-3.5 h-3.5" /></button>
                  </div>
                  <button onClick={() => del(sc.id)} className="text-white/30 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>

                {/* ── RAPORTUL DUBLELOR ────────────────────────────────────
                    Numbers, not adjectives. `mișcare` is coherent camera
                    movement as a percentage of frame width per second;
                    `fierbere` is what is left over once the frames have been
                    aligned — pixels changing while the picture goes nowhere.
                    A shot with no movement and high boil is the failure this
                    whole layer exists to catch. */}
                {(sc.verdict || (sc.takes && sc.takes.length > 0)) && (
                  <div className="border-t border-white/[0.07] px-2 py-1.5">
                    {sc.verdict && (
                      <p className={'text-[10px] ' + (sc.motion === 'done' ? 'text-emerald-400/70' : 'text-amber-400/80')}>{sc.verdict}</p>
                    )}
                    {sc.takes && sc.takes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {sc.takes.map((t, ti) => (
                          <button key={t.url} onClick={() => adoptTake(sc.id, t)}
                            title={t.accepted ? 'Trece măsurarea. Click pentru a o folosi.' : `Respinsă: ${t.why}. Click pentru a o folosi oricum.`}
                            className={'text-[10px] px-1.5 py-0.5 border ' + (sc.url === t.url
                              ? 'border-emerald-500/60 text-emerald-300'
                              : t.accepted ? 'border-white/20 text-white/60 hover:border-white/40' : 'border-red-500/30 text-red-300/70 hover:border-red-500/60')}>
                            dubla {ti + 1} · {t.move.toFixed(2)} %/s · {t.ratio.toFixed(2)}×
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
              {voUrl && voLoudness && (() => {
                const plan = planNormalisation(voLoudness, 'social')
                const move = plan.gainDb
                return (
                  <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="text-white/40">Sonoritate</span>
                    <span className="font-mono text-white/80">{formatLufs(voLoudness.integrated)}</span>
                    <span className="text-white/25">·</span>
                    <span className="text-white/40">țintă {plan.target} LUFS</span>
                    <span className={'px-1.5 py-0.5 font-mono ' + (Math.abs(move) <= 1 ? 'bg-emerald-500/15 text-emerald-300/80' : 'bg-amber-500/15 text-amber-300/80')}>
                      {move >= 0 ? '+' : ''}{move.toFixed(1)} dB la export
                    </span>
                    {plan.wouldClip && (
                      <span className="px-1.5 py-0.5 bg-brand-red/20 text-brand-red">
                        limitat de vârf ({voLoudness.samplePeakDb.toFixed(1)} dBFS)
                      </span>
                    )}
                  </div>
                )
              })()}

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
              {captionQc && (() => {
                const errors = captionQc.problems.filter(x => x.severity === 'error')
                return (
                  <>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <button onClick={() => exportCaptions('srt')}
                        className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/80 text-[11px] font-bold px-2.5 py-1 hover:border-brand-red/60">
                        <Download className="w-3 h-3" /> .SRT
                      </button>
                      <button onClick={() => exportCaptions('vtt')}
                        className="flex items-center gap-1.5 bg-[#111] border border-white/[0.07] text-white/80 text-[11px] font-bold px-2.5 py-1 hover:border-brand-red/60">
                        <Download className="w-3 h-3" /> .VTT
                      </button>
                      <span className={'text-[11px] px-1.5 py-0.5 ' + (errors.length ? 'bg-brand-red/20 text-brand-red' : 'bg-emerald-500/15 text-emerald-300/80')}>
                        {errors.length ? `${errors.length} de corectat` : 'trec verificarea'}
                      </span>
                      {errors.length > 0 && (
                        <button onClick={conformSubtitles}
                          title="Întinde replicile în pauzele dintre ele până coboară sub 17 caractere pe secundă, respectă durata minimă și închide micro-pauzele. Nu schimbă textul."
                          className="flex items-center gap-1.5 bg-[#111] border border-amber-500/40 text-amber-300/90 text-[11px] font-bold px-2.5 py-1 hover:bg-amber-500/10">
                          <Wand2 className="w-3 h-3" /> Corectează
                        </button>
                      )}
                    </div>
                    {/* AFTER a conform, say WHY anything is left. Reading speed
                        is characters over time: a cue can be given more time
                        only if there is time beside it, and it cannot be made
                        slower by splitting, because that changes neither
                        figure. Where the voice itself delivers the line faster
                        than the limit, the only remaining lever is a shorter
                        line — and the conform never touches words. A button
                        that leaves errors behind without saying that reads as
                        broken. */}
                    {conformed && errors.some(x => /per second/.test(x.message)) && (
                      <p className="mt-2 text-[10.5px] text-white/45 leading-snug">
                        Replicile rămase sunt <b>rostite</b> mai repede de 17 caractere pe secundă.
                        Nu au unde să se lungească — vecinele lor sunt lipite. Singura corecție
                        rămasă e un text mai scurt sau o voce mai rară; sincronizarea nu mai poate
                        face nimic aici.
                      </p>
                    )}
                    {errors.length > 0 && (
                      <ul className="mt-2 space-y-1 max-h-24 overflow-y-auto">
                        {errors.slice(0, 6).map((x, i) => (
                          <li key={i} className="text-[10.5px] text-brand-red/80 leading-snug">
                            #{x.index + 1} — {x.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )
              })()}
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
              {/* SAY WHETHER A TRACK IS ACTUALLY THERE.
                  The only feedback used to be a volume slider quietly appearing,
                  so an upload that failed and an upload that worked looked
                  nearly identical — and "I uploaded a track but I cannot see if
                  it is uploaded" is a sentence that has now been said twice. */}
              {musicUrl ? (
                <div className="mt-2 border border-white/[0.07] bg-[#111] p-2">
                  <div className="flex items-center gap-2">
                    <Music className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
                    <span className="text-[11px] text-white/70 truncate flex-1" title={musicUrl}>
                      {decodeURIComponent(musicUrl.split('/').pop() || '')}
                    </span>
                    <button onClick={() => setMusicUrl('')} className="text-white/30 hover:text-red-400 shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <audio src={musicUrl} controls className="w-full mt-2 h-8" />
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[11px] text-white/40">volum</span>
                    <input type="range" min={0} max={0.6} step={0.02} value={musicVol}
                      onChange={e => setMusicVol(Number(e.target.value))} className="flex-1" />
                    <span className="text-[10px] text-white/30 w-8 text-right tabular-nums">{Math.round(musicVol * 100)}%</span>
                  </div>
                  <p className="text-[10px] text-white/35 mt-1.5 leading-snug">
                    Se atenuează automat sub voce (−18 dB) și se ridică la loc după. Un track încărcat
                    are întâietate față de patul muzical sintetizat.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-white/30 mt-2">
                  Niciun track. Filmul folosește patul sintetizat dacă e bifat, altfel doar vocea.
                </p>
              )}
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
            {stale.any && (
              <div className="mt-3 border border-amber-500/40 bg-amber-500/10 p-2">
                <p className="text-[11px] text-amber-200/90 leading-snug">
                  {stale.voiceStale && <><b>Textul s-a schimbat de la ultima voce.</b> Apasă „Generează voce”, altfel filmul se randează cu vocea veche.<br /></>}
                  {stale.cuesStale && <><b>Subtitrările sunt de la vocea anterioară.</b> Apasă „Auto din voce” ca să se re-sincronizeze.</>}
                </p>
              </div>
            )}
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
            {/* Cloud render — deterministic MP4 at the chosen master size */}
            <div className="mt-4 pt-4 border-t border-white/[0.07]">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-[11px] text-white/40">Serviciu</span>
                {([
                  { id: 'worker', label: 'Worker propriu' },
                  { id: 'shotstack', label: 'Shotstack' },
                  { id: 'creatomate', label: 'Creatomate' },
                ] as const).map(pv => (
                  <button key={pv.id} onClick={() => setProvider(pv.id)}
                    className={'px-2.5 py-1 text-[11px] border ' + (provider === pv.id ? 'bg-brand-red text-white border-brand-red' : 'bg-[#111] text-white/50 border-white/[0.07]')}>
                    {pv.label}
                  </button>
                ))}
                {scenes.length > 0 && (
                  <span className="ml-auto font-mono text-[11px] text-white/40">
                    {provider === 'worker'
                      // Railway bills per second: 4 vCPU + 8 GB is $0.222/hour,
                      // and the render takes roughly 3x the clip's own length.
                      ? `≈ $${((framesToSeconds(buildTimeline().duration, buildTimeline().timebase.fps) * 3 / 3600) * 0.222).toFixed(3)} calcul`
                      : `≈ $${estimateCostUsd(buildTimeline()).toFixed(2)}`}
                  </span>
                )}
              </div>
              {cloudLimits.length > 0 && (
                <div className="mb-2 border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-amber-300/70 mb-1">
                    Randarea în cloud nu poate reda tot
                  </p>
                  <ul className="space-y-0.5 max-h-24 overflow-y-auto">
                    {cloudLimits.slice(0, 5).map((l, i) => (
                      <li key={i} className="text-[10.5px] text-amber-200/60 leading-snug">{l.where} — {l.message}</li>
                    ))}
                    {cloudLimits.length > 5 && (
                      <li className="text-[10.5px] text-amber-200/40">…și încă {cloudLimits.length - 5}</li>
                    )}
                  </ul>
                </div>
              )}
              <button onClick={renderCloud} disabled={cloudBusy || scenes.length === 0}
                title="Randează ce e pe ecran acum, pe worker. Butonul „Randează vN” de la o versiune randează instantaneul acelei versiuni, nu montajul curent."
                className="w-full flex items-center justify-center gap-2 bg-[#111] border border-white/[0.07] text-white text-[12px] font-bold py-2.5 hover:border-brand-red/60 disabled:opacity-50">
                {cloudBusy ? <><Loader2 className="w-4 h-4 animate-spin" /> Cloud: {cloud.status}…</> : <><Film className="w-4 h-4" /> Randează montajul curent (cloud, MP4)</>}
              </button>
              {cloud.status === 'unconfigured' && (
                <p className="text-[11px] text-amber-300/80 mt-2 leading-relaxed">{cloud.msg}</p>
              )}
              {(cloud.status === 'error' || cloud.status === 'failed' || cloud.status === 'timeout') && cloud.msg && (
                <p className="text-[11px] text-red-400 mt-2 leading-relaxed break-words">{cloud.msg}</p>
              )}
              {provider === 'worker' && (
                <p className="text-[10.5px] text-white/35 mt-2 leading-relaxed">
                  Randare deterministă: aceeași cronologie dă exact același fișier.
                  Mișcarea pe cadre-cheie, atenuarea muzicii sub voce și normalizarea
                  EBU R128 se aplică integral. Durează aproximativ de trei ori lungimea clipului.
                </p>
              )}
              {workerQc && (
                <div className={'mt-3 border px-2.5 py-2 ' + (workerQc.passed ? 'border-emerald-500/25 bg-emerald-500/[0.06]' : 'border-brand-red/40 bg-brand-red/[0.06]')}>
                  <p className={'text-[10.5px] font-bold uppercase tracking-wider mb-1 ' + (workerQc.passed ? 'text-emerald-300/80' : 'text-brand-red')}>
                    {workerQc.passed ? 'Control tehnic trecut' : 'Control tehnic — de verificat'}
                    {workerStats && (
                      <span className="ml-2 font-mono font-normal normal-case tracking-normal text-white/35">
                        {workerStats.seconds.toFixed(1)}s randat în {workerStats.renderSeconds.toFixed(0)}s
                      </span>
                    )}
                  </p>
                  <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                    {workerQc.checks.map((c, i) => (
                      <li key={i} className={'text-[10.5px] leading-snug ' + (c.ok ? 'text-white/45' : 'text-brand-red')}>
                        {c.ok ? '✓' : '✕'} {c.name} — <span className="font-mono">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
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
