import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  // Only lint the new Next.js App Router code in app/ and the shared lib/.
  // src/ contains the legacy Vite components being migrated in later steps.
  // They will be brought into compliance as each is ported to app/.
  //
  // render-worker/ is a separate Node service with its own runtime and module
  // system (CommonJS, no bundler, no JSX). Linting it with the Next.js config
  // reports every require() as an error and fails the site build for code that
  // is never shipped to the browser — the same reason netlify/ and supabase/
  // are excluded.
  {
    ignores: [
      'src/**',
      'netlify/**',
      'supabase/**',
      'render-worker/**',
      '.next/**',
      'node_modules/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]

export default eslintConfig
