import Link from 'next/link'

export default function ArticleNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4 text-center">
      <h1 className="font-serif text-4xl font-bold text-foreground mb-4">
        Articol negăsit
      </h1>
      <p className="font-sans text-muted-foreground mb-8 max-w-md">
        Articolul pe care îl cauți nu există sau a fost eliminat.
      </p>
      <Link
        href="/"
        className="font-sans font-bold text-[12px] uppercase tracking-widest text-brand-red hover:underline"
      >
        ← Înapoi la pagina principală
      </Link>
    </div>
  )
}
