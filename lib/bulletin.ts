// lib/bulletin.ts
//
// Shared helpers for the public bulletin pages (/buletin, /buletin/<slug>),
// the news sitemap and the Atom feed.
//
// WHY A BULLETIN NEEDS A PAGE AT ALL
//   Until 30 Aug 2026 a finished bulletin was a FILE: an MP4 in a storage
//   bucket, linked from the admin archive and from nowhere else. It had no
//   URL, so Google had nothing to index; it produced no video result, no
//   Discover surface, no Top Stories eligibility. Meanwhile every social
//   caption pointed at the homepage, which never mentioned the bulletin.
//   Giving each bulletin a real page with VideoObject + NewsArticle markup
//   is the single largest organic-reach change available in this codebase,
//   and it costs nothing per bulletin.
//
// The generated Supabase types (lib/database.types.ts) predate the
// newsroom_bulletins table, so this module owns its own row type and uses an
// untyped client. That is deliberate: inventing entries in a generated file
// would be a lie that the next `supabase gen types` silently deletes.

import { createClient } from '@supabase/supabase-js'

export const SITE_URL = 'https://transilvaniatimes.com'
export const BRAND = 'Transilvania Times'

export interface BulletinStory {
  title: string
  slug: string | null
  cover_image?: string | null
  category?: string | null
  published_at?: string | null
}

export interface BulletinSections {
  greeting?: string
  stories?: { lower_third?: string; text?: string; author?: string }[]
  signoff?: string
}

export interface Bulletin {
  id: string
  slug: string
  created_at: string
  published_at: string | null
  language: string | null
  edition: string | null
  script: string | null
  sections: BulletinSections | null
  story_titles: string[] | null
  story_slugs: string[] | null
  bulletin_video_url: string | null
  anchor_video_url: string | null
  poster_url: string | null
  duration_seconds: number | null
  status: string | null
}

/** Anon, cookie-free client. These pages are cached and must never depend on
 *  a session — the "public read published" RLS policy is what grants access. */
export function publicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
}

const SELECT =
  'id, slug, created_at, published_at, language, edition, script, sections, ' +
  'story_titles, story_slugs, bulletin_video_url, anchor_video_url, ' +
  'poster_url, duration_seconds, status'

export async function getBulletin(slug: string): Promise<Bulletin | null> {
  const db = publicClient()
  const { data, error } = await db
    .from('newsroom_bulletins')
    .select(SELECT)
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as Bulletin
}

export async function listBulletins(limit = 30): Promise<Bulletin[]> {
  const db = publicClient()
  const { data, error } = await db
    .from('newsroom_bulletins')
    .select(SELECT)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error || !Array.isArray(data)) return []
  return data as unknown as Bulletin[]
}

/**
 * Resolve the articles a bulletin was built from.
 *
 * story_slugs is written at compose time in the same order as story_titles,
 * so the normal path is an exact lookup. Bulletins archived before that column
 * existed have titles only — those fall back to matching on title_ro, which is
 * imperfect but strictly better than dropping the links entirely.
 */
export async function getBulletinStories(b: Bulletin): Promise<BulletinStory[]> {
  const titles = b.story_titles || []
  const slugs = (b.story_slugs || []).filter(Boolean)
  const db = publicClient()

  if (slugs.length) {
    const { data } = await db
      .from('blog_posts')
      .select('slug, title_ro, title_en, cover_image, category, published_at')
      .in('slug', slugs)
    const bySlug = new Map<string, Record<string, unknown>>(
      (data || []).map((r: Record<string, unknown>) => [String(r.slug), r] as [string, Record<string, unknown>]),
    )
    return slugs.map((s, i) => {
      const r = bySlug.get(s)
      return {
        slug: s,
        title: String(r?.title_ro || r?.title_en || titles[i] || ''),
        cover_image: (r?.cover_image as string) ?? null,
        category: (r?.category as string) ?? null,
        published_at: (r?.published_at as string) ?? null,
      }
    }).filter(s => s.title)
  }

  if (!titles.length) return []
  const { data } = await db
    .from('blog_posts')
    .select('slug, title_ro, cover_image, category, published_at')
    .in('title_ro', titles.filter(Boolean))
  const byTitle = new Map<string, Record<string, unknown>>(
    (data || []).map((r: Record<string, unknown>) => [String(r.title_ro), r] as [string, Record<string, unknown>]),
  )
  return titles.filter(Boolean).map(t => {
    const r = byTitle.get(t)
    return {
      title: t,
      slug: (r?.slug as string) ?? null,
      cover_image: (r?.cover_image as string) ?? null,
      category: (r?.category as string) ?? null,
      published_at: (r?.published_at as string) ?? null,
    }
  })
}

/** ISO 8601 duration for schema.org VideoObject: 214s -> "PT3M34S". */
export function isoDuration(seconds: number | null): string {
  const s = Math.max(0, Math.round(seconds || 0))
  return `PT${Math.floor(s / 60)}M${s % 60}S`
}

export function bulletinUrl(slug: string): string {
  return `${SITE_URL}/buletin/${slug}/`
}

/** The spoken transcript, reconstructed from the stored sections. This is real
 *  indexable text — a video page with no words on it ranks for nothing. */
export function transcriptOf(b: Bulletin): string[] {
  const s = b.sections
  if (s && Array.isArray(s.stories) && s.stories.length) {
    return [s.greeting || '', ...s.stories.map(x => x?.text || ''), s.signoff || ''].filter(Boolean)
  }
  return (b.script || '').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean)
}

export function bulletinTitle(b: Bulletin): string {
  const d = new Date(b.published_at || b.created_at)
  const date = d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })
  const edition =
    b.edition === 'morning' ? 'Matinal' :
    b.edition === 'evening' ? 'Jurnalul de Seară' : 'Buletinul zilei'
  return `${edition} — ${date}`
}

export function bulletinDescription(b: Bulletin, stories: BulletinStory[]): string {
  const lead = stories[0]?.title
  const rest = Math.max(0, stories.length - 1)
  if (lead) {
    return rest > 0
      ? `${lead} — și încă ${rest} subiecte în buletinul video Transilvania Times.`
      : `${lead} — buletinul video Transilvania Times.`
  }
  return `Buletinul video Transilvania Times, știrile zilei din Ardeal.`
}
