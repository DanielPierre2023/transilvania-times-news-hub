import { createSupabaseServerClient } from '@/lib/supabase/server'

// Always server-render fresh — no CDN cache
export const revalidate = 0

interface ArticleRow {
  id: string
  title_ro: string | null
  slug: string
  category: string | null
  published_at: string | null
}

export default async function HomePage() {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, title_ro, slug, category, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(12)

  const articles = (data ?? []) as ArticleRow[]

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="font-serif text-5xl font-bold mb-2">
        Transilvania Times
      </h1>
      <p className="text-muted-foreground text-xs uppercase tracking-widest mb-10">
        Phase 2 · Step 1 · SSR Live — Next.js 15 on Netlify ✓
      </p>

      {error && (
        <p className="text-red-600 font-sans text-sm mb-6">
          Supabase error: {error.message}
        </p>
      )}

      {articles.length === 0 && !error && (
        <p className="text-muted-foreground">No published articles found.</p>
      )}

      <div className="divide-y divide-border">
        {articles.map((article) => (
          <div key={article.id} className="py-5">
            <span className="text-[10px] font-sans font-bold text-brand-red uppercase tracking-widest">
              {article.category}
            </span>
            <h2 className="font-serif text-xl font-semibold mt-1">
              <a href={`/blog/${article.slug}`} className="hover:text-brand-red transition-colors">
                {article.title_ro}
              </a>
            </h2>
          </div>
        ))}
      </div>
    </main>
  )
}
