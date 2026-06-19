// app/layout.tsx
//
// B6: Added RSS and Atom feed discovery links in <head>.
// Browsers, feed readers, and Google Discover auto-detect these.
//
// Fix (June 19, 2026):
//   - lang attribute on <html> is now dynamic: "en" for /en/* routes, "ro"
//     for everything else. Previously hardcoded as "ro", which meant Google
//     and screen readers saw all EN pages declared as Romanian.
//   - Reads x-pathname header set by middleware.ts (see that file).

import type { Metadata } from 'next'
import { Lora, Inter } from 'next/font/google'
import { headers } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import LayoutShell from './components/LayoutShell'
import { CookieConsentProvider } from './components/CookieConsentContext'
import './globals.css'
import { Suspense } from 'react'
import PageTracker from './components/PageTracker'

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
  // Determine page language from the current pathname (set by middleware.ts).
  // /en/* routes get lang="en"; everything else stays lang="ro".
  const headersList = await headers()
  const pathname    = headersList.get('x-pathname') ?? '/'
  const htmlLang    = pathname.startsWith('/en') ? 'en' : 'ro'

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
    <html lang={htmlLang} className={`${lora.variable} ${inter.variable}`}>
      <head>
        {/* Google AdSense verification */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5809590003717527"
          crossOrigin="anonymous"
        />
        {/* B6: RSS + Atom feed discovery — auto-detected by browsers, Feedly, Google */}
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Transilvania Times — RSS (Română)"
          href="https://transilvaniatimes.com/rss.xml"
        />
        <link
          rel="alternate"
          type="application/atom+xml"
          title="Transilvania Times — Atom Feed"
          href="https://transilvaniatimes.com/atom.xml"
        />
      </head>
      <body className="bg-background text-foreground font-sans antialiased min-h-screen flex flex-col">
        <CookieConsentProvider>
          <LayoutShell breakingNews={breakingTitles}>
            {children}
          </LayoutShell>
        </CookieConsentProvider>
        <Suspense fallback={null}>
          <PageTracker />
        </Suspense>
      </body>
    </html>
  )
}