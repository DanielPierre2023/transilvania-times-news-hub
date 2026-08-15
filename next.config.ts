import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pageExtensions deliberately omitted — default ['tsx','ts','jsx','js']
  // src/pages/ was renamed to src/views/ so Next.js never scans it.
  // App Router in app/ works with standard file names.
  
  trailingSlash: true, // 👈 CRITICAL: Forces Next.js to match Netlify's URL structure

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zimpimoierpsocnmnizm.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        // Cover images for ~176 articles are hosted on Unsplash; next/image
        // must be allowed to optimize them or they fail to render.
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },

  // E9: apply security headers (incl. CSP) at the Next.js layer. The same
  // policy exists in netlify.toml, but those headers don't reliably reach
  // Next.js-rendered (SSR/ISR) responses — only static/CDN ones — so the CSP
  // was effectively not applied on most real page responses. This is a verbatim
  // port of the netlify.toml policy (already proven in production), so it adds
  // no new restrictions; it just makes them actually take effect.
  async headers() {
    const csp = [
      "default-src 'self' https://zimpimoierpsocnmnizm.supabase.co",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://tpc.googlesyndication.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://zimpimoierpsocnmnizm.supabase.co wss://zimpimoierpsocnmnizm.supabase.co https://pagead2.googlesyndication.com https://adservice.google.com",
      "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com",
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
}

export default nextConfig
