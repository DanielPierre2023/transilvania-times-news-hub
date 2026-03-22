import { createSupabaseServerClient } from '@/lib/supabase/server'

// Homepage: always server-rendered fresh (no cache)
export const revalidate = 0

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()

  const { data: articles, error } = await supabase
    .from('blog_posts')
    .select('id, title_ro, title_en, slug, category, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(12)

  if (error) {
    console.error('[Homepage] Supabase fetch error:', error.message)
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-12">
      {/*
        ── Step 1 scaffold — SSR proof of concept ──────────────────────────────
        This minimal render proves:
          1. Next.js 15 builds and deploys on Netlify
          2. Server-side Supabase data fetching works
          3. Both locale routes respond (/ = RO, /en = EN)
        Full UI (Header, Footer, article grid) is ported in Step 2.
      */}
      <h1 className="font-serif text-5xl font-bold text-foreground mb-2 tracking-tight">
        Transilvania Times
      </h1>
      <p className="text-muted-foreground font-sans text-xs uppercase tracking-widest mb-10">
        Phase 2 · Step 1 · SSR Scaffold — Next.js 15
      </p>

      {articles && articles.length > 0 ? (
        <div className="divide-y divide-border">
          {articles.map((article) => (
            <article key={article.id} className="py-5 group">
              <a href={`/blog/${article.slug}`} className="block">
                <span className="text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest">
                  {article.category}
                </span>
                <h2 className="font-serif text-xl font-semibold text-foreground group-hover:text-brand-red transition-colors mt-1">
                  {article.title_ro}
                </h2>
              </a>
            </article>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground font-sans">
          {error ? `Error: ${error.message}` : 'No articles found.'}
        </p>
      )}
    </main>
  )
}
