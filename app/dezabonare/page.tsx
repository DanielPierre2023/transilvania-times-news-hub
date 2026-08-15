import { Suspense } from 'react'
import type { Metadata } from 'next'
import UnsubscribeClient from './UnsubscribeClient'

export const metadata: Metadata = {
  title: 'Dezabonare — Transilvania Times',
  robots: { index: false, follow: false },
}

export default function DezabonarePage() {
  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <Suspense fallback={null}>
        <UnsubscribeClient />
      </Suspense>
    </div>
  )
}
