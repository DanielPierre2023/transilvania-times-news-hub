'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import {
  LayoutDashboard, FileText, Rss, MessageSquare,
  Mail, Users, Inbox, Settings, LogOut, Menu, X,
  ChevronRight, Newspaper, PenLine, BarChart2, Share2
} from 'lucide-react'

const NAV = [
  { label: 'Dashboard',   href: '/admin/dashboard',  icon: LayoutDashboard },
  { label: 'Editor AI',   href: '/admin/editor',      icon: PenLine },
  { label: 'Social Media',    href: '/admin/social',      icon: Share2 },
  { label: 'Articole',    href: '/admin/articles',    icon: FileText },
  { label: 'Scraper RSS', href: '/admin/scraper',     icon: Rss },
  { label: 'Comentarii',  href: '/admin/comments',    icon: MessageSquare },
  { label: 'Newsletter',  href: '/admin/newsletter',  icon: Mail },
  { label: 'Abonați',     href: '/admin/subscribers', icon: Users },
  { label: 'Publicitate', href: '/admin/sponsors',    icon: BarChart2 },
  { label: 'Inbox',       href: '/admin/inbox',       icon: Inbox },
  { label: 'Setări',      href: '/admin/settings',    icon: Settings },
  { label: 'Observabilitate', href: '/admin/analytics', icon: BarChart2 },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userEmail, setUserEmail] = useState('')

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUserEmail(data.user.email || '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/admin/login')
    router.refresh()
  }

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/10">
        <Link href="/" target="_blank" className="flex items-center gap-2 group">
          <Newspaper className="w-5 h-5 text-brand-red" />
          <div>
            <p className="font-serif text-sm font-bold text-white leading-tight">Transilvania Times</p>
            <p className="font-sans text-[10px] text-white/40 uppercase tracking-widest">Admin Panel</p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const Icon = item.icon
          const active = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={
                'flex items-center gap-3 px-3 py-2.5 font-sans text-[13px] transition-colors ' +
                (active
                  ? 'bg-brand-red text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.05]')
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
              {active && <ChevronRight className="w-3 h-3 ml-auto" />}
            </Link>
          )
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-3 py-4 border-t border-white/10">
        <div className="px-3 mb-3">
          <p className="font-sans text-[11px] text-white/30 uppercase tracking-widest mb-0.5">Autentificat ca</p>
          <p className="font-sans text-[12px] text-white/70 truncate">{userEmail}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 font-sans text-[13px] text-white/60 hover:text-white hover:bg-white/[0.05] transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Deconectare
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-[#161616] border-r border-white/10 fixed left-0 top-0 h-full z-30">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-56 bg-[#161616] border-r border-white/10 flex flex-col h-full z-50">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 text-white/40 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 lg:pl-56 min-w-0">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#161616] border-b border-white/10">
          <button onClick={() => setSidebarOpen(true)} className="text-white/60 hover:text-white">
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-serif text-sm font-bold text-white">Admin</span>
        </div>

        <div className="p-6 lg:p-8 min-h-screen">
          {children}
        </div>
      </div>
    </div>
  )
}
