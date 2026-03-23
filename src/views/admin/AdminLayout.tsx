import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdmin } from '@/hooks/useAdmin';
import { supabase } from '@/integrations/supabase/client';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  LayoutDashboard, BarChart3, FileText, Rss, Mail, Users,
  Inbox, Settings, LogOut, Newspaper, MessageCircle, Contact,
  Menu, Globe
} from 'lucide-react';

const navItems = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/admin/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/admin/blog', icon: FileText, label: 'Blog Manager', end: true },
  { to: '/admin/blog/new', icon: Newspaper, label: 'AI Blog Editor' },
  { to: '/admin/comments', icon: MessageCircle, label: 'Comments' },
  { to: '/admin/rss', icon: Rss, label: 'RSS Scraper' },
  { to: '/admin/newsletter', icon: Mail, label: 'Newsletter' },
  { to: '/admin/subscribers', icon: Users, label: 'Subscribers' },
  { to: '/admin/contacts', icon: Contact, label: 'Contacts' },
  { to: '/admin/geo', icon: Globe, label: 'GEO Tools' },
  { to: '/admin/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/admin/settings', icon: Settings, label: 'Settings' },
];

const SidebarNav = ({ onNavigate }: { onNavigate?: () => void }) => (
  <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
    {navItems.map(({ to, icon: Icon, label, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
            isActive
              ? 'bg-primary text-primary-foreground'
              : 'text-paper/70 hover:bg-primary/10 hover:text-paper'
          }`
        }
      >
        <Icon className="h-4 w-4 shrink-0" />
        {label}
      </NavLink>
    ))}
  </nav>
);

const AdminLayout = () => {
  const { loading, isAdmin } = useAdmin();
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <p className="text-muted-foreground animate-pulse">Loading…</p>
      </div>
    );
  }

  if (!isAdmin) return null;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/admin/login');
  };

  const sidebar = (
    <>
      <div className="p-4 border-b border-primary/20">
        <h1 className="font-serif text-lg font-bold italic text-paper">Transilvania Times</h1>
        <p className="text-[10px] uppercase tracking-widest text-paper/50 mt-1">Admin Panel</p>
      </div>
      <SidebarNav onNavigate={isMobile ? () => setSheetOpen(false) : undefined} />
      <div className="p-3 border-t border-primary/20">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-paper/70 hover:bg-destructive/20 hover:text-destructive transition-colors w-full"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <div className="min-h-screen bg-muted/30">
        <header className="sticky top-0 z-40 bg-foreground border-b border-primary/20 px-4 h-14 flex items-center justify-between">
          <h1 className="font-serif text-base font-bold italic text-paper">Transilvania Times</h1>
          <button onClick={() => setSheetOpen(true)} className="p-2 text-paper" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="left" className="w-72 p-0 bg-foreground border-r-0">
            <SheetTitle className="sr-only">Admin Navigation</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
        <main className="p-4">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-foreground flex flex-col fixed inset-y-0 left-0 z-30">
        {sidebar}
      </aside>
      <main className="flex-1 ml-64 bg-muted/30 min-h-screen">
        <div className="p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
