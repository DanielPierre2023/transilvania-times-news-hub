import { Link } from "react-router-dom";

const categories = ['Politics', 'Technology', 'Education', 'Sports', 'Showbiz', 'Health', 'Travel'];

const Header = () => (
  <header className="sticky top-0 z-50 bg-background">
    <div className="container mx-auto max-w-6xl px-4">
      <div className="flex items-center justify-between py-3 border-b border-foreground/20">
        <span className="text-sm text-clay font-sans">Thursday, March 19, 2026</span>
        <Link to="/" className="text-3xl md:text-4xl font-serif font-bold text-foreground tracking-tight hover:text-primary transition-colors">
          Transilvania Times
        </Link>
        <a
          href="#support"
          className="bg-primary text-primary-foreground px-4 py-1.5 text-sm font-sans font-semibold rounded hover:bg-action-orange transition-colors"
        >
          Support Us
        </a>
      </div>

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

export default Header;
