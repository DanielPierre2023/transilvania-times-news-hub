import type { Metadata } from 'next'
import { Lora, Inter } from 'next/font/google'
import Script from 'next/script'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import LayoutShell from './components/LayoutShell'
import { CookieConsentProvider } from './components/CookieConsentContext'
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
  description: 'Jurnalism independent din inima Transilvaniei.',
  metadataBase: new URL('https://transilvaniatimes.com'),
  icons: {
    icon: [
      { url: '/assets/favicons/favicon-32x32.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/assets/favicons/favicon-32x32.svg',
    apple: '/assets/logos/transilvania-times-favicon-symbol.svg',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createSupabaseServerClient()
  const { data: breaking } = await supabase
    .from('blog_posts')
    .select('title_ro')
    .eq('status', 'published')
    .eq('is_breaking', true)
    .order('published_at', { ascending: false })
    .limit(6)

  const breakingTitles = ((breaking ?? []) as { title_ro: string | null }[])
    .map(p => p.title_ro)
    .filter((t): t is string => Boolean(t))

  return (
    <html lang="ro" className={`${lora.variable} ${inter.variable}`}>
      <head>
        {/* Google AdSense — loads only after GDPR consent (handled by AdUnit component) */}
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5809590003717527"
          crossOrigin="anonymous"
          strategy="lazyOnload"
        />
      </head>
      <body className="bg-background text-foreground font-sans antialiased min-h-screen flex flex-col">
        <CookieConsentProvider>
          <LayoutShell breakingNews={breakingTitles}>
            {children}
          </LayoutShell>
        </CookieConsentProvider>
      </body>
    </html>
  )
}
