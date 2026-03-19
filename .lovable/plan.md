

## Plan: Add Category Page & Full Article Page

### What We're Building
1. **Full Article Page** (`/article/:slug`) — large hero image, metadata header, structured body content, "Go Back" button
2. **Category Page** (`/category/:name`) — 4-column responsive grid of article cards with grayscale-to-color hover effect
3. **Updated routing and navigation** — wire header category links and article cards to navigate between pages

### Implementation Steps

**1. Create article data file (`src/data/articles.ts`)**
- Centralize all article data (title, slug, category, author, date, excerpt, body paragraphs, image) so it can be shared across pages
- Include the featured article and the 4 existing articles, plus body content for the full article view

**2. Create Full Article page (`src/pages/Article.tsx`)**
- Route: `/article/:slug`
- Layout: ad banner area (optional), category label with red square accent, large serif title, author/date metadata row, full-width hero image, body paragraphs with `<h2>` subheadings, "Go Back to Homepage" button
- Uses the espresso/clay/brandRed color tokens per spec

**3. Create Category page (`src/pages/Category.tsx`)**
- Route: `/category/:name`
- Category header with border-bottom
- 4-column grid (`lg:grid-cols-4 md:grid-cols-2 grid-cols-1`, 24px gap)
- Article cards with grayscale-to-color image hover effect and scale transition
- Filter articles by category from the shared data

**4. Update ArticleCard component**
- Wrap cards in `<Link to={/article/${slug}>}` for navigation
- Add optional grayscale hover effect for category page variant

**5. Update Header navigation**
- Change category `<a>` tags to `<Link to={/category/${name}>}` using react-router-dom

**6. Update App.tsx routes**
- Add `/article/:slug` → `Article`
- Add `/category/:name` → `Category`

### Technical Details
- All navigation uses `react-router-dom` `<Link>` components
- Article lookup by slug using `.find()` on the centralized data array
- Category filtering is case-insensitive match on the `category` field
- Responsive grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6`
- Image hover: `grayscale group-hover:grayscale-0 group-hover:scale-105 transition-all duration-700`

