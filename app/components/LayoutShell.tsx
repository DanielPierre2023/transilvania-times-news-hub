'use client'

import { usePathname } from 'next/navigation'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'

interface LayoutShellProps {
  children: React.ReactNode
  breakingNews: string[]
}

export default function LayoutShell({ children, breakingNews }: LayoutShellProps) {
  const pathname = usePathname()
  const isAdmin = pathname.startsWith('/admin')

  if (isAdmin) {
    return <>{children}</>
  }

  return (
    <>
      <SiteHeader breakingNews={breakingNews} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  )
}
