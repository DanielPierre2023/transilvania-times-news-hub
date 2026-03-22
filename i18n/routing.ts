import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['ro', 'en'] as const,
  defaultLocale: 'ro',
  // 'as-needed': /ro prefix is hidden (canonical), /en is shown
  localePrefix: 'as-needed',
})

export type Locale = (typeof routing.locales)[number]
