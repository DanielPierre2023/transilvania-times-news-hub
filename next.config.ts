import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  // Restrict Pages Router to files ending in .page.tsx / .page.ts only.
  // This prevents Next.js from treating src/pages/*.tsx (Vite components)
  // as Pages Router entries. App Router (app/) is unaffected by this setting.
  pageExtensions: ['page.tsx', 'page.ts', 'page.jsx', 'page.js'],

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zimpimoierpsocnmnizm.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
}

export default withNextIntl(nextConfig)
