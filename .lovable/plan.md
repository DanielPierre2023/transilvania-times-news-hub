

## Plan: Enterprise-Grade Homepage Rebuild + Visual Consistency Across All Public Pages

### Current State vs. Reference Design

The reference screenshots show a precise "broadsheet newspaper" layout with:
- **12-column hero grid**: large hero image (8 cols) + Most Read numbered sidebar (4 cols)
- **Category-grouped article sections**: each with a red label + horizontal rule, then a 4-column bordered card grid
- **Grayscale-to-color images** on hover — currently missing from `Index.tsx`
- **Red category overlay block** at bottom-left of card images
- **Thin vertical borders** between grid cards (newspaper column separators)
- **No standalone Newsletter** — it lives exclusively inside the Footer's 4th column (already correct)
- **Ad units** between category sections
- **Subcategory badges** visible on cards (e.g. "Regional" next to "Politics")

The current `Index.tsx` is a flat hero + 2-column list. No category grouping, no grayscale, no bordered grid, no sidebar next to hero.

### Subcategory Visual Treatment

Categories with subcategories need elegant visual distinction. The approach:
- **Card level**: Category label in the red block overlay + subcategory as a small pill/dot next to it (e.g. `■ POLITICS · Regional`)
- **Category section headers on homepage**: Show category name with a red rule. No subcategory tabs on homepage — those belong on the `/category/:name` page (already implemented with tabs)
- **Category page** already has subcategory filter tabs — keep and refine visually

### File Changes

#### 1. `src/pages/Index.tsx` — Full Rebuild

```text
┌──────────────────────────────────────────────────┐
│ Header                                           │
├───────────────────────────────┬──────────────────┤
│ HERO (lg:col-span-8)          │ Most Read (4col) │
│ Grayscale image, aspect-video │ Numbered list    │
│ ■ CATEGORY · Subcategory      │ Bold serif       │
│ Serif bold title              │                  │
│ Time ago                      │                  │
├───────────────────────────────┴──────────────────┤
│               Ad Unit (leaderboard)              │
├──────────────────────────────────────────────────┤
│ ■ TECHNOLOGY ────────────────────────────────── │
├──────────┬──────────┬──────────┬────────────────┤
│ Card 1   │ Card 2   │ Card 3   │ Card 4         │
│ (bordered, grayscale, red category overlay)      │
├──────────┴──────────┴──────────┴────────────────┤
│               Ad Unit (leaderboard)              │
├──────────────────────────────────────────────────┤
│ ■ POLITICS ──────────────────────────────────── │
│ ... 4-col grid ...                               │
├──────────────────────────────────────────────────┤
│           View All Articles →                    │
├──────────────────────────────────────────────────┤
│ Footer (newsletter in 4th column)                │
└──────────────────────────────────────────────────┘
```

- Fetch latest 20 published `blog_posts` from Supabase
- Group posts by category using `useMemo`
- Hero: first post, rendered in `lg:col-span-8` with grayscale image, red category overlay at bottom-left, subcategory dot, serif title, time
- Sidebar: `MostReadSidebar` in `lg:col-span-4`
- For each category group: render section header (red square + category name + `<hr>`) then a 4-column grid of cards
- Insert `<AdUnit type="leaderboard" />` between category sections (every 2 sections)
- Container: `max-w-7xl mx-auto border-x border-foreground/10`
- Fallback to static articles when no DB posts

#### 2. `src/components/ArticleCard.tsx` — Newspaper Card Redesign

Completely rework to match reference:
- **New prop**: `variant: 'hero' | 'grid'` (default `'grid'`), `linkPrefix` (default `/blog/`), `subcategory?: string`
- **Grid variant**: Vertical card, `aspect-[4/3]` image with `grayscale group-hover:grayscale-0 transition-all duration-700`, red category block at absolute bottom-left of image, subcategory as `· Subcategory` next to category label, serif bold title below, time at bottom, right border separator (`border-r border-foreground/10 last:border-r-0`)
- **Hero variant**: Large image same grayscale treatment, text below with category + subcategory + title + excerpt + time
- Remove excerpt and author from grid variant (reference doesn't show them)
- Accept both static and DB article data via props

#### 3. `src/components/MostReadSidebar.tsx` — Bold Border Treatment

- Fetch from DB instead of static: query top 5 published posts ordered by `published_at` (or views if available)
- Container: `border-2 border-foreground p-6 bg-background shadow-[10px_10px_0px_0px_rgba(88,41,19,0.05)]`
- Header: `font-serif italic font-bold text-2xl border-b-2 border-primary pb-2`
- Numbers: `text-3xl font-serif font-bold text-foreground/20 group-hover:text-primary`
- Show category dot + label next to each title
- Show subcategory if present

#### 4. `src/pages/Blog.tsx` — 4-Column Grid + Borders

- Change `lg:grid-cols-3` → `lg:grid-cols-4`
- Add vertical border separators between cards (same pattern as Category page)
- Add grayscale treatment (already present in Category, missing in Blog)
- Show subcategory badge on each card

#### 5. `src/pages/Category.tsx` — Visual Refinement

- Already has grayscale + 4-col grid — good
- Add vertical border separators between cards: wrap each card in a div with `border-r border-foreground/10 last:border-r-0`
- Subcategory tabs already present — refine styling to match newspaper aesthetic (underline active tab instead of pill)

#### 6. `src/pages/BlogPost.tsx` — Grayscale on Related Articles

- Related articles already have grayscale — confirmed correct
- No structural changes needed

#### 7. `src/index.css` — Card Separation Utility

Add a utility class for the bordered newspaper grid pattern:
```css
.newspaper-grid > * {
  @apply border-r border-foreground/10;
}
.newspaper-grid > *:last-child {
  @apply border-r-0;
}
```

### Complete File List

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Full rebuild: 12-col hero+sidebar, category-grouped sections, bordered 4-col grids, grayscale images, red overlays, subcategory badges |
| `src/components/ArticleCard.tsx` | Redesign: `variant` prop, grayscale, red category overlay, subcategory display, border separators, remove excerpt from grid |
| `src/components/MostReadSidebar.tsx` | DB-driven, bold border-2 container, shadow, refined hover states |
| `src/pages/Blog.tsx` | 4-col grid, border separators, subcategory badges |
| `src/pages/Category.tsx` | Add card border separators, refine subcategory tabs |
| `src/index.css` | Add `.newspaper-grid` utility for bordered column layout |

### Subcategory Visual Logic (All Pages)

- **Card**: `■ POLITICS · Regional` — red square, category in uppercase tracking-widest, subcategory in muted smaller text after dot separator
- **Category page header**: Category name large + subcategory tabs below
- **BlogPost**: Category + subcategory as linked breadcrumbs (already implemented)
- **Homepage sections**: Grouped by category only (not subcategory) — subcategory visible per card

