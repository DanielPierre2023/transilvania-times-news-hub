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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://fundingchoicesmessages.google.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      // media-src was MISSING. Without it, <video>/<audio> fall back to
      // default-src, which has no blob: — so every blob: URL the Studio creates
      // was blocked: the composed-bulletin player rendered blank, and picking a
      // presenter clip could not be previewed. img-src already allowed blob:,
      // which is why images always worked and only video appeared broken.
      "media-src 'self' data: blob: https://zimpimoierpsocnmnizm.supabase.co https://v3.fal.media https://fal.media " +
        // The render worker serves finished masters from its own origin.
        "https://transilvania-times-news-hub-production.up.railway.app",
      // The Studio renders MP4 in the browser; that uses blob: workers.
      "worker-src 'self' blob:",
      "child-src 'self' blob:",
      "font-src 'self' data:",
      // api.open-meteo.com — WeatherWidget (the header temperature) fetches this
      // from the browser. Without it listed here CSP blocks the request, the
      // component's .catch() leaves temp === null, and `if (temp === null) return
      // null` hides the widget silently: no error banner, it simply never appears.
      // blob:/data: are needed to read a locally picked file back before upload.
      // queue.fal.run / fal.media — the Studio submits and polls fal directly
      // from the browser; without them those calls are blocked by CSP.
      "connect-src 'self' data: blob: https://zimpimoierpsocnmnizm.supabase.co wss://zimpimoierpsocnmnizm.supabase.co https://api.open-meteo.com https://queue.fal.run https://fal.run https://v3.fal.media https://fal.media " +
        "https://transilvania-times-news-hub-production.up.railway.app " +
        "https://pagead2.googlesyndication.com https://adservice.google.com",
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
