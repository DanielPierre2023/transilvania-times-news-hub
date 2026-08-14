import Link from 'next/link'
import { headers } from 'next/headers'

// Renders for any route that calls notFound() (missing articles, authors,
// categories — see PART D1 of the CTO audit) as well as any genuinely
// unmatched URL. Next.js automatically serves this with a real HTTP 404
// status, replacing the soft-404 "not found" text that used to render
// inline at 200 OK on article/author/category pages.
//
// Bilingual: middleware.ts stamps x-pathname on every response (see
// app/layout.tsx for the same pattern), so this can tell an /en/* 404 from
// a /* (Romanian) one without a separate app/en/not-found.tsx.
export default async function NotFound() {
  const pathname = (await headers()).get('x-pathname') ?? '/'
  const isEn = pathname.startsWith('/en')

  const copy = isEn
    ? {
        eyebrow: '404 Error',
        title: 'Page not found',
        body: 'The page you’re looking for doesn’t exist, was moved, or was removed.',
        home: 'Homepage',
        homeHref: '/en',
        search: 'Search articles',
      }
    : {
        eyebrow: 'Eroare 404',
        title: 'Pagina nu a fost găsită',
        body: 'Pagina căutată nu există, a fost mutată sau a fost eliminată.',
        home: 'Pagina principală',
        homeHref: '/',
        search: 'Caută articole',
      }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-24 text-center">
      <p className="text-[11px] font-sans font-bold uppercase tracking-widest text-brand-red mb-3">
        {copy.eyebrow}
      </p>
      <h1 className="font-serif text-4xl md:text-5xl font-bold text-foreground mb-4">
        {copy.title}
      </h1>
      <p className="font-sans text-muted-foreground mb-10 max-w-md mx-auto">
        {copy.body}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link
          href={copy.homeHref}
          className="text-[12px] font-sans font-bold uppercase tracking-widest bg-brand-red text-white px-5 py-3 hover:bg-espresso transition-colors"
        >
          {copy.home}
        </Link>
        <Link
          href="/cautare"
          className="text-[12px] font-sans font-bold uppercase tracking-widest border border-foreground/20 text-muted-foreground px-5 py-3 hover:border-brand-red hover:text-brand-red transition-colors"
        >
          {copy.search}
        </Link>
      </div>
    </div>
  )
}
