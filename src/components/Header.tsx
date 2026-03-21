import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import WeatherWidget from "./WeatherWidget";
import LangSwitcher from "./LangSwitcher";

const categoryKeys = [
  "cat_politics", "cat_world", "cat_technology", "cat_business",
  "cat_culture", "cat_opinion", "cat_travel", "cat_education",
  "cat_sports", "cat_health",
] as const;

const categorySlugs: Record<string, string> = {
  cat_politics: "politics",
  cat_world: "world",
  cat_technology: "technology",
  cat_business: "business",
  cat_culture: "culture",
  cat_opinion: "opinion",
  cat_travel: "travel",
  cat_education: "education",
  cat_sports: "sports",
  cat_health: "health",
};

const Header = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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

  const breakingHeadlines = [t("breaking_1"), t("breaking_2"), t("breaking_3")];

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
        {/* Top bar: date + lang + weather on left, search + support on right */}
        <div className="flex items-center justify-between py-2 border-b border-foreground/20">
          <div className="flex items-center">
            <LangSwitcher />
            <span className="hidden sm:inline text-sm text-muted-foreground font-sans">{useMemo(() => {
              const locale = i18n.language.startsWith('ro') ? 'ro-RO' : 'en-US';
              return new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
            }, [i18n.language])}</span>
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
              className="w-full bg-transparent border border-foreground/20 rounded px-4 py-2 text-sm font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        <nav className="border-b border-foreground/20">
          <ul className="flex items-center justify-center gap-6 py-2.5 overflow-x-auto">
            {categoryKeys.map((key) => (
              <li key={key}>
                <Link
                  to={`/category/${categorySlugs[key]}`}
                  className="text-sm font-sans font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap"
                >
                  {t(key)}
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
