import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, X, Zap } from "lucide-react";

const categories = ['Politics', 'Technology', 'Education', 'Sports', 'Showbiz', 'Health', 'Beauty', 'Travel'];

const breakingHeadlines = [
  "Opposition Leader Calls for Early Elections Amid Growing Public Discontent",
  "Cluj-Napoca Startup Raises €12M in Series A Funding",
  "Babeș-Bolyai University Launches New Digital Humanities Program",
];

const Header = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-background">
      {/* Breaking News Ticker */}
      <div className="bg-primary text-primary-foreground overflow-hidden">
        <div className="container mx-auto max-w-6xl px-4 flex items-center gap-3 py-1.5">
          <span className="flex items-center gap-1 text-xs font-sans font-bold uppercase tracking-wider shrink-0">
            <Zap size={14} fill="currentColor" /> Breaking
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
        <div className="flex items-center justify-between py-3 border-b border-foreground/20">
          <span className="text-sm text-muted-foreground font-sans">Thursday, March 19, 2026</span>
          <Link to="/" className="text-3xl md:text-4xl font-serif font-bold text-foreground tracking-tight hover:text-primary transition-colors">
            Transilvania Times
          </Link>
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
              className="bg-primary text-primary-foreground px-4 py-1.5 text-sm font-sans font-semibold rounded hover:bg-accent transition-colors"
            >
              Support Us
            </a>
          </div>
        </div>

        {isSearchOpen && (
          <div className="py-3 border-b border-foreground/20">
            <input
              type="text"
              placeholder="Search articles..."
              autoFocus
              className="w-full bg-transparent border border-foreground/20 rounded px-4 py-2 text-sm font-sans placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        <nav className="border-b border-foreground/20">
          <ul className="flex items-center justify-center gap-6 py-2.5 overflow-x-auto">
            {categories.map((cat) => (
              <li key={cat}>
                <Link
                  to={`/category/${cat.toLowerCase()}`}
                  className="text-sm font-sans font-medium text-foreground hover:text-primary transition-colors whitespace-nowrap"
                >
                  {cat}
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
