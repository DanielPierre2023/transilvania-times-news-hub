// ============================================================================
// Transilvania Times — Route Middleware
// ============================================================================
//
// PURPOSE
//   1. (All routes) Sets x-pathname response header so app/layout.tsx can
//      read the current pathname server-side and set lang="en" on /en/* routes
//      instead of the hardcoded lang="ro". Without this, every EN page is
//      declared as Romanian to Google and screen readers.
//
//   2. (Admin routes only) Gates everything under /admin/* behind a valid
//      Supabase session, with the single exception of /admin/login.
//
// WHY THIS VERSION
//   The previous middleware redirected /admin/login back to /admin/login when
//   no session was present, producing ERR_TOO_MANY_REDIRECTS for any user with
//   cleared cookies. Two structural problems caused it:
//
//   1. No exemption for the login route.
//   2. Strict equality against `/admin/login` would have missed the trailing-
//      slash form `/admin/login/` that Netlify produces during redirect
//      normalisation, so even adding a naive check would still loop.
//
//   This file fixes both, and also:
//     - Verifies the JWT with Supabase Auth (getUser) instead of trusting the
//       cookie blindly (getSession), so banned/expired users are caught.
//     - Falls through to the login redirect rather than crashing if Supabase
//       Auth is briefly unreachable.
//     - Preserves the user's intended destination in `?next=<pathname>` so a
//       successful login sends them back where they were trying to go.
//
// ============================================================================

import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { CookieOptions } from '@supabase/ssr'

// ----------------------------------------------------------------------------
// Public admin routes — reachable without an authenticated session.
//
// IMPORTANT: any new public admin route (e.g. /admin/forgot-password,
// /admin/reset-password, /admin/magic-link) MUST be added here, otherwise
// the middleware will trap users in the same loop this file exists to fix.
// ----------------------------------------------------------------------------
const PUBLIC_ADMIN_ROUTES = new Set<string>([
  '/admin/login',
])

function stripTrailingSlash(path: string): string {
  // Netlify and Next.js can each add or strip a trailing slash during URL
  // normalisation. Normalising to the no-trailing-slash form keeps comparison
  // robust regardless of which side touched the request.
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function isPublicAdminRoute(pathname: string): boolean {
  return PUBLIC_ADMIN_ROUTES.has(stripTrailingSlash(pathname))
}

// ----------------------------------------------------------------------------
// Middleware entry point
// ----------------------------------------------------------------------------
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Non-admin routes ──────────────────────────────────────────────────────
  // Just stamp x-pathname and pass through. No auth check, no Supabase call.
  if (!pathname.startsWith('/admin')) {
    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    return response
  }

  // ── Admin routes ──────────────────────────────────────────────────────────

  // Public routes must short-circuit BEFORE any cookie reading or Supabase
  // network call. If they didn't, an unauthenticated visit to /admin/login
  // would itself trigger the auth check, fail, redirect back to /admin/login,
  // and the browser would abort with ERR_TOO_MANY_REDIRECTS.
  if (isPublicAdminRoute(pathname)) {
    const response = NextResponse.next()
    response.headers.set('x-pathname', pathname)
    return response
  }

  // Mutable response holder — Supabase's setAll() callback may replace it
  // with a fresh NextResponse carrying refreshed auth cookies.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          // First sync the cookies onto the incoming request so any later
          // code in this same middleware run reading getAll() observes the
          // refreshed values.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          // Then create a new response carrying those cookies back to the
          // browser, so the refresh sticks.
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() makes a network call to Supabase Auth to validate the JWT.
  // This catches three classes of bad session that getSession() would miss:
  //   - JWT signature invalid (rotated keys, tampered cookie)
  //   - User has been banned since the token was issued
  //   - User has been deleted since the token was issued
  // Cost: one round-trip per /admin/* request. Acceptable for an admin panel.
  let userId: string | null = null
  try {
    const { data, error } = await supabase.auth.getUser()
    if (!error && data.user) userId = data.user.id
  } catch {
    // Network failure talking to Supabase Auth. We deliberately do NOT let
    // the request through — defaulting to "deny on doubt" is the right call
    // for admin routes, even at the cost of a false negative if Supabase is
    // down. The user can retry once the connection recovers.
    userId = null
  }

  if (!userId) {
    const loginUrl = new URL('/admin/login', request.url)
    // Carry the originally-requested path so the login page can return the
    // user there after a successful sign-in. Skip this for the bare /admin
    // and /admin/ entry points — the default post-login target is the
    // dashboard, which is where those would have routed to anyway.
    const normalised = stripTrailingSlash(pathname)
    if (normalised !== '/admin') {
      loginUrl.searchParams.set('next', pathname)
    }
    return NextResponse.redirect(loginUrl)
  }

  // Stamp x-pathname on authenticated admin responses too.
  response.headers.set('x-pathname', pathname)
  return response
}

// ----------------------------------------------------------------------------
// Matcher
//
// Expanded from /admin/:path* to cover all page routes so x-pathname is
// available everywhere layout.tsx needs it. Static assets and Next.js
// internals are excluded to avoid unnecessary middleware overhead.
//
// Admin auth logic is enforced INSIDE the middleware function above, not via
// the matcher — keeping it in code means the same exemption logic also applies
// to any future internal redirect that ends up hitting the matcher.
// ----------------------------------------------------------------------------
export const config = {
  matcher: [
    // Exclude Next.js internals, static assets, and API routes.
    // API routes don't need x-pathname and don't need admin auth checks;
    // they handle their own auth internally.
    '/((?!_next/static|_next/image|assets|favicon|api/).*)',
  ],
}