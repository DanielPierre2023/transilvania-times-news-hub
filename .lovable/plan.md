

## Plan: Breaking News Ticker, Search, SEO Metadata & SPA Redirect

### What's New (vs. already implemented)

The user's message contains several genuinely new features mixed with repeated specs. Here's what we'll actually build:

1. **Breaking News Ticker** — animated marquee bar above the header
2. **Search Toggle** — expandable search input in the header
3. **Fix `index.html` metadata** — remove duplicate titles/descriptions, update OG tags for Transilvania Times
4. **SPA redirect file** — `public/_redirects` for Netlify deployment

### What We'll Skip
- **Tailwind config changes** (custom breakpoints, colors) — already configured correctly
- **`index.css` changes** — already has dvh, smooth scroll, grayscale transitions
- **`content.json` / fetch approach** — already decided to keep TypeScript data module
- **`react-helmet-async` for per-page SEO** — would require a new dependency; the static `index.html` meta tags are sufficient for now
- **AdBanner** — no real AdSense ID available
- **Related Stories / Social Share** — significant new features not yet designed; can be added later

### Files to Change

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add breaking news ticker with marquee animation; add search toggle with input field |
| `src/index.css` | Add `@keyframes marquee` and `.animate-marquee` class |
| `index.html` | Remove duplicate `<title>` and `<meta description>`; update OG/Twitter tags to Transilvania Times branding |
| `public/_redirects` | Create with `/* /index.html 200` for Netlify SPA support |

### Implementation Details

**Breaking News Ticker**: A thin red bar at the very top with a `Zap` icon, "Breaking" label, and horizontally scrolling text using CSS `@keyframes marquee` animation. Content: hardcoded headline strings from the existing articles data.

**Search Toggle**: A search icon button next to "Support Us" that toggles a full-width input field below the header bar. Uses `useState` for open/close state. Filters are cosmetic for now (no backend search).

**index.html cleanup**: Keep only the Transilvania Times title and description, remove the Lovable defaults, update OG tags.

