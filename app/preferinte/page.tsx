import { Suspense } from 'react'
import type { Metadata } from 'next'
import PreferencesClient from './PreferencesClient'

export const metadata: Metadata = {
  title: 'Preferințe newsletter — Transilvania Times',
  robots: { index: false, follow: false },
}

export default function PreferintePage() {
  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <Suspense fallback={null}>
        <PreferencesClient />
      </Suspense>
    </div>
  )
}
