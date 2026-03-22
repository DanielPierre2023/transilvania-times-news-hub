import createMiddleware from 'next-intl/middleware'
import { routing } from './i18n/routing'

/**
 * next-intl locale detection and routing middleware.
 * Runs on every request except Next.js internals and static files.
 * - Detects locale from Accept-Language header and cookie
 * - Default locale (ro) has no URL prefix: transilvaniatimes.com/
 * - Secondary locale (en) has prefix: transilvaniatimes.com/en/
 */
export default createMiddleware(routing)

export const config = {
  matcher: [
    // Match all pathnames except Next.js internals and files with extensions
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
}
