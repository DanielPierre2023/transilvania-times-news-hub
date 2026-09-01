// lib/timeline/storyboard.ts
//
// A film, written down.
//
// A project is a row in a database. Which means the only way to review a spot is
// to open the Studio, and the only way to hand one to a client, a lawyer or a
// colleague is to send them a video and hope they describe the change they want
// in words you can act on.
//
// A storyboard is the film as a document: every shot, what it does, what is said
// over it, what was measured about it. It reviews in a pull request, diffs when
// something changes, and survives the tool that made it.

import type { Timeline } from './types'
import { framesToSeconds } from './time'
import { extractCues } from './captions'

export interface StoryboardShot {
  readonly n: number
  readonly name: string
  readonly startSeconds: number
  readonly durationSeconds: number
  readonly kind: string
  readonly url?: string
  /** What the voice says while this shot is on screen. */
  readonly says: string
  /** Whatever the take machine measured, said plainly. */
  readonly measured?: string
  readonly direction?: string
}

export interface StoryboardMeta {
  readonly name: string
  readonly aspect: string
  readonly width: number
  readonly height: number
  readonly fps: string
  readonly durationSeconds: number
  readonly shots: number
  readonly loudness: string
  readonly grade: string
  readonly generatedAt: string
}

const two = (n: number) => n.toFixed(2)

export function buildStoryboard(
  tl: Timeline,
  opts: { name?: string; script?: string; shotNotes?: Record<string, { measured?: string; direction?: string }> } = {},
): { meta: StoryboardMeta; shots: StoryboardShot[] } {
  const fps = tl.timebase.fps
  const cues = extractCues(tl)
  const picture = tl.tracks.find(t => t.kind === 'video' && t.z === 0)
  const clips = [...(picture?.clips ?? [])].sort((a, b) => a.start - b.start)

  const shots: StoryboardShot[] = clips.map((c, i) => {
    const start = framesToSeconds(c.start, fps)
    const dur = framesToSeconds(c.duration, fps)
    // CUES ARE IN FRAMES, NOT SECONDS.
    //
    // `extractCues` returns the timeline's own unit, which is frames — a cue at
    // 0.3s comes back as 8 at 25fps. Comparing those against seconds put every
    // line on the wrong shot, silently and plausibly, which is exactly the kind
    // of unit error a document like this exists to make visible.
    //
    // A line that runs across a cut is listed on BOTH shots it is heard over,
    // rather than only on the one it began in.
    const startF = c.start
    const endF = c.start + c.duration
    const says = cues
      .filter(q => q.end > startF && q.start < endF)
      .map(q => q.text.trim())
      .join(' ')
    const note = opts.shotNotes?.[c.id] || {}
    return {
      n: i + 1,
      name: c.name || `Plan ${i + 1}`,
      startSeconds: start,
      durationSeconds: dur,
      kind: c.source.kind,
      url: 'url' in c.source ? c.source.url : undefined,
      says,
      measured: note.measured,
      direction: note.direction,
    }
  })

  const meta: StoryboardMeta = {
    name: opts.name || tl.name || 'Film',
    aspect: `${tl.timebase.width}:${tl.timebase.height}`,
    width: tl.timebase.width,
    height: tl.timebase.height,
    fps: `${fps.n}/${fps.d}`,
    durationSeconds: framesToSeconds(tl.duration, fps),
    shots: shots.length,
    loudness: tl.delivery?.loudness || 'social',
    grade: tl.delivery?.grade ? `${tl.delivery.grade.look} ${tl.delivery.grade.strength}` : 'none',
    generatedAt: new Date().toISOString(),
  }
  return { meta, shots }
}

/** The storyboard as markdown — the artefact a person actually reads. */
export function toMarkdown(
  board: { meta: StoryboardMeta; shots: StoryboardShot[] },
  script?: string,
): string {
  const { meta, shots } = board
  const out: string[] = []
  out.push(`# ${meta.name}`, '')
  out.push(`${meta.width}×${meta.height} · ${meta.durationSeconds.toFixed(1)}s · ` +
    `${(Number(meta.fps.split('/')[0]) / Number(meta.fps.split('/')[1])).toFixed(3)} fps · ` +
    `${shots.length} planuri · ${meta.loudness} · gradare ${meta.grade}`, '')

  if (script && script.trim()) {
    out.push('## Textul', '', script.trim(), '')
  }

  out.push('## Planurile', '')
  for (const s of shots) {
    out.push(`### ${s.n}. ${s.name}`, '')
    out.push(`\`${two(s.startSeconds)}s → ${two(s.startSeconds + s.durationSeconds)}s\`  ` +
      `· ${two(s.durationSeconds)}s · ${s.kind}`, '')
    if (s.says) out.push(`> ${s.says}`, '')
    if (s.direction) out.push(`**Regie.** ${s.direction}`, '')
    if (s.measured) out.push(`**Măsurat.** ${s.measured}`, '')
    if (s.url) out.push(`\`${s.url}\``, '')
  }

  out.push('---', '')
  out.push(`Generat ${meta.generatedAt} de Marketing Studio.`, '')
  return out.join('\n')
}
