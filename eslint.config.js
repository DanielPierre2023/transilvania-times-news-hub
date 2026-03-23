import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

const eslintConfig = [
  // Only lint the new Next.js App Router code in app/.
  // src/ contains the legacy Vite components being migrated in later steps.
  // They will be brought into compliance as each is ported to app/.
  {
    ignores: [
      'src/**',
      'netlify/**',
      'supabase/**',
      '.next/**',
      'node_modules/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]

export default eslintConfig
