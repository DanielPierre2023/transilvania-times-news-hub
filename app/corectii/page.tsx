import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'

// Corrections index — fulfils the promise made on /standarde-editoriale
// ("Corecturile de substanță ... sunt marcate vizibil la sfârșitul
// articolului cu data corecției și natura modificării") with an actual page
// listing every corrected article, not just a per-article notice.
//
// Fault-tolerant by design: correction_note/corrected_at only exist once
// tt-g5-corrections.sql has been run (see that file). Until then, this page
// renders its "no corrections" empty state instead of crashing — it does
// NOT gate on the columns existing.

export const revalidate = 300

const SITE_URL = 'https://transilvaniatimes.com'

export const metadata: Metadata = {
  title: 'Corecții — Transilvania Times',
  description: 'Istoricul corecturilor de substanță aduse articolelor publicate pe Transilvania Times.',
  alternates: { canonical: `${SITE_URL}/corectii/` },
}

interface CorrectedPost {
  id: string
  slug: string
  title_ro: string | null
  category: string | null
  correction_note: string
  corrected_at: string
  published_at: string | null
}

export default async function CorrectionsPage() {
  const supabase = await createSupabaseServerClient()

  let posts: CorrectedPost[] = []
  try {
    const { data } = await supabase
      .from('blog_posts')
      .select('id, slug, title_ro, category, correction_note, corrected_at, published_at')
      .eq('status', 'published')
      .not('correction_note', 'is', null)
      .not('corrected_at', 'is', null)
      .order('corrected_at', { ascending: false })
      .limit(100)
    posts = (data ?? []) as unknown as CorrectedPost[]
  } catch {
    // correction_note/corrected_at don't exist yet — render the empty state.
    posts = []
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-14">
      <div className="border-b-2 border-brand-red mb-8 pb-4">
        <p className="text-[11px] font-sans font-bold uppercase tracking-widest text-muted-foreground mb-1">
          Transparență editorială
        </p>
        <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground">
          Corecții
        </h1>
        <p className="font-sans text-sm text-muted-foreground mt-3 leading-relaxed">
          Conform{' '}
          <Link href="/standarde-editoriale/" className="text-brand-red hover:underline">
            standardelor noastre editoriale
          </Link>
          , orice corectură de substanță — cifre greșite, nume incorect, context lipsă — este
          marcată vizibil, cu data și natura modificării. Această pagină listează toate corecturile
          aduse articolelor publicate.
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="font-sans text-sm text-muted-foreground py-12 text-center">
          Nu există corecturi înregistrate momentan.
        </p>
      ) : (
        <div className="space-y-6">
          {posts.map(post => (
            <article key={post.id} className="border-b border-foreground/10 pb-6">
              <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-brand-red mb-1">
                <time dateTime={post.corrected_at}>
                  {new Date(post.corrected_at).toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' })}
                </time>
              </p>
              <Link
                href={`/blog/${post.slug}/`}
                className="font-serif text-xl font-bold text-foreground hover:text-brand-red transition-colors block mb-2"
              >
                {post.title_ro}
              </Link>
              <p className="font-sans text-sm text-foreground/80 leading-relaxed">
                {post.correction_note}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
