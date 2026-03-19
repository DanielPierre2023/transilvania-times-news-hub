

## Plan: Full Feature Implementation — Sidebar, Weather, Search Page, SEO/JSON-LD

All six features implemented together. Nothing skipped.

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/MostReadSidebar.tsx` | Ranked trending stories sidebar using existing `articles` data |
| `src/components/WeatherWidget.tsx` | Live Cluj-Napoca temperature via Open-Meteo API (free, no key) |
| `src/pages/SearchResults.tsx` | Dedicated search results page filtering the `articles` array by query param |
| `src/components/ArticleSEO.tsx` | JSON-LD structured data injected via `useEffect` — no extra dependency |

### Files to Modify

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Add `WeatherWidget` next to date; wire search input to navigate to `/search?q=...` on Enter |
| `src/pages/Article.tsx` | Add 2-column layout (`lg:col-span-8` + `lg:col-span-4`) with `MostReadSidebar`; add `ArticleSEO` component |
| `src/App.tsx` | Add `/search` route pointing to `SearchResults` page |

### Implementation Details

**MostReadSidebar** — Imports `articles` array, takes top 4, renders each with rank number (01-04), category marker, title as a `<Link>` to `/article/:slug`, and timeAgo.

**WeatherWidget** — `useEffect` fetches `api.open-meteo.com/v1/forecast?latitude=46.77&longitude=23.62&current_weather=true`. Displays temperature + Sun/Cloud icon. City name hidden on mobile (`hidden sm:inline`).

**SearchResults** — Reads `q` from `useSearchParams`, filters `articles` array by matching title, category, or body text. Displays results using `ArticleCard` in a 2-column grid with `MostReadSidebar` alongside. Shows "No results" state when empty.

**ArticleSEO** — Uses `useEffect` to inject/update a `<script type="application/ld+json">` tag in `document.head` with NewsArticle schema (headline, author, datePublished, image, publisher). Cleans up on unmount. Zero dependencies added.

**Header search wiring** — The existing search input gets an `onKeyDown` handler: on Enter, navigates to `/search?q={value}` using `useNavigate`.

**Article page layout** — Wraps article header + body + image in `lg:col-span-8`, adds `MostReadSidebar` in `lg:col-span-4`. On mobile, sidebar stacks below the article content.

