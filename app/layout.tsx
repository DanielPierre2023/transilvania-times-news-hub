import type { Metadata } from 'next'
import { Lora, Inter } from 'next/font/google'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import './globals.css'

const lora = Lora({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-lora',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    template: '%s | Transilvania Times',
    default: 'Transilvania Times — Știri din inima Transilvaniei',
  },
  description: 'Jurnalism independent din inima Transilvaniei — politică, cultură, afaceri și altele.',
  metadataBase: new URL('https://transilvaniatimes.com'),
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Fetch breaking news server-side for the ticker
  const supabase = await createSupabaseServerClient()
  const { data: breaking } = await supabase
    .from('blog_posts')
    .select('title_ro')
    .eq('status', 'published')
    .eq('is_breaking', true)
    .order('published_at', { ascending: false })
    .limit(6)

  const breakingTitles = (breaking ?? [])
    .map(p => p.title_ro)
    .filter(Boolean) as string[]

  return (
    <html lang="ro" className={`${lora.variable} ${inter.variable}`}>
      <body className="bg-background text-foreground font-sans antialiased min-h-screen flex flex-col">
        <SiteHeader breakingNews={breakingTitles} />
        <main className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  )
}
