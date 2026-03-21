import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, X, Zap, Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import WeatherWidget from "./WeatherWidget";
import LangSwitcher from "./LangSwitcher";
import { NAV_CATEGORIES } from "@/lib/categories";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";

const Header = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const dateStr = useMemo(() => {
    const locale = i18n.language.startsWith('ro') ? 'ro-RO' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date());
  }, [i18n.language]);

  const handleSearchSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setIsSearchOpen(false);
      setSearchQuery("");
    }
  };

  const { data: breakingPosts } = useQuery({
    queryKey: ['breaking_news'],
    queryFn: async () => {
      const { data } = await supabase
        .from('blog_posts')
        .select('title_en, title_ro')
        .eq('is_breaking', true)
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .limit(5);
      return data || [];
    },
    staleTime: 60_000,
  });

  const breakingHeadlines = useMemo(() => {
    const isRo = i18n.language.startsWith('ro');
    if (breakingPosts && breakingPosts.length > 0) {
      return breakingPosts.map((p: any) => (isRo ? p.title_ro : p.title_en) || p.title_en);
    }
    return [t("breaking_1"), t("breaking_2"), t("breaking_3")];
  }, [breakingPosts, i18n.language, t]);

  return (
    <header className="sticky top-0 z-50 bg-background">
      {/* Breaking News Ticker */}
      <div className="bg-primary text-primary-foreground overflow-hidden">
        <div className="container mx-auto max-w-6xl px-4 flex items-center gap-3 py-1.5">
          <span className="flex items-center gap-1 text-xs font-sans font-bold uppercase tracking-wider shrink-0">
            <Zap size={14} fill="currentColor" /> {t("breaking")}
          </span>
          <div className="overflow-hidden flex-1">
            <span className="animate-marquee text-sm font-sans">
              {breakingHeadlines.join(" • ")}
              {" • "}
              {breakingHeadlines.join(" • ")}
            </span>
          </div>
        </div>
      </div>

      <div className="container mx-auto max-w-6xl px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between py-2 border-b border-foreground/20">
          <div className="flex items-center">
            {/* Mobile hamburger — top bar, CNN/CBS style */}
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <button
                  className="md:hidden p-2 mr-1 rounded hover:bg-foreground/5 transition-colors"
                  aria-label="Open menu"
                >
                  <Menu size={20} />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] bg-background">
                <SheetTitle className="font-serif font-bold text-lg mb-6">
                  {t("categories", "Categories")}
                </SheetTitle>
                <nav>
                  <ul className="flex flex-col gap-1">
                    {NAV_CATEGORIES.map(({ slug, i18nKey }) => (
                      <li key={slug}>
                        <Link
                          to={`/category/${slug}`}
                          onClick={() => setMenuOpen(false)}
                          className="block py-3 px-3 text-sm font-sans font-medium text-foreground hover:text-primary hover:bg-primary/5 transition-colors border-b border-foreground/5"
                        >
                          {t(i18nKey)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              </SheetContent>
            </Sheet>
            <LangSwitcher />
            <span className="hidden sm:inline text-sm text-muted-foreground font-sans">{dateStr}</span>
            <WeatherWidget />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              className="p-2 rounded-full hover:bg-foreground/5 transition-colors"
              aria-label={isSearchOpen ? "Close search" : "Open search"}
            >
              {isSearchOpen ? <X size={20} /> : <Search size={20} />}
            </button>
            <a
              href="#support"
              className="hidden sm:inline-block bg-primary text-primary-foreground px-4 py-1.5 text-sm font-sans font-semibold rounded hover:bg-accent transition-colors"
            >
              {t("support_us")}
            </a>
          </div>
        </div>

        {/* Masthead */}
        <div className="py-3 text-center border-b border-foreground/20">
          <Link to="/" className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold text-foreground tracking-tight hover:text-primary transition-colors">
            Transilvania Times
          </Link>
        </div>

        {isSearchOpen && (
          <div className="py-3 border-b border-foreground/20">
            <input
              type="text"
              placeholder={t("search_placeholder")}
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchSubmit}
              className="w-full bg-transparent border border-foreground/20 rounded px-4 py-2 text-base font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Desktop nav */}
        <nav className="border-b border-foreground/20 hidden md:block">
          <ul className="flex items-center justify-center gap-6 py-2.5">
            {NAV_CATEGORIES.map(({ slug, i18nKey }) => (
              <li key={slug}>
                <Link
                  to={`/category/${slug}`}
                  className="text-sm font-sans font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap"
                >
                  {t(i18nKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

      </div>
    </header>
  );
};

export default Header;
