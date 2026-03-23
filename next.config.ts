import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pageExtensions deliberately omitted — default ['tsx','ts','jsx','js']
  // src/pages/ was renamed to src/views/ so Next.js never scans it.
  // App Router in app/ works with standard file names.
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

export default nextConfig
