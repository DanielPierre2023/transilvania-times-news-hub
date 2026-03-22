import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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

export default nextConfig
