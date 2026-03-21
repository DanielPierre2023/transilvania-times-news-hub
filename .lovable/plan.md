

## Plan: Exact Newspaper Layout Implementation

The provided code snippets will be adapted to the existing project's TypeScript/Tailwind token system (`foreground/10` instead of `espresso/10`, `primary` instead of `brandRed`, `background` instead of `paper`). The layout structure, class names, spacing, and visual rhythm will match exactly.

### Changes

#### 1. `src/pages/Index.tsx` — Full rewrite to match provided MainPage structure

Exact sequence:
1. Header
2. Global ad slot (`border-b border-foreground/10 py-6`)
3. `<main className="max-w-7xl mx-auto border-x border-foreground/10">`
4. Hero + Sidebar: `grid grid-cols-1 lg:grid-cols-12 border-b border-foreground/10`
   - Hero (`lg:col-span-8 p-6 lg:border-r border-foreground/10 group cursor-pointer`): grayscale `aspect-video` image with `border-4 border-background shadow-xl`, category overlay `absolute top-0 left-0 bg-primary`, massive serif italic title (`text-4xl md:text-7xl font-serif font-bold leading-[0.95] italic tracking-tighter`), excerpt below
   - Sidebar (`lg:col-span-4 p-6 bg-primary/5`): `<MostReadSidebar />`
5. 4-column grid (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 border-b border-foreground/10`): next 4 articles as `ArticleCard`, with `lg:border-r border-foreground/10` on all but last
6. `<Newsletter />` — inside `<main>`, not outside
7. Category sections: for each category group, render section header (red dot + category name) + 3-col grid of cards
8. `</main>`
9. Footer

Key difference from current: ad moves ABOVE main, hero gets `border-4 border-background shadow-xl` + `absolute top-0 left-0` category tag (not bottom), title becomes massive italic serif, Newsletter moves INSIDE main.

#### 2. `src/components/Newsletter.tsx` — Restyle to match provided code

Replace current dark `bg-foreground` generic block with:
- `bg-primary text-primary-foreground p-12 md:p-20 border-b border-foreground/10 flex flex-col items-center text-center`
- `max-w-xl` inner container
- Title: `font-serif text-4xl md:text-5xl font-bold italic`
- Description: `text-primary-foreground/80`
- Form: `flex flex-col md:flex-row gap-0 shadow-2xl overflow-hidden`
- Input: `bg-primary-foreground/10 border border-primary-foreground/30 text-primary-foreground placeholder:text-primary-foreground/50`
- Button: `bg-background text-primary px-10 py-5 font-bold uppercase text-[10px] tracking-[0.2em] hover:bg-foreground hover:text-background`

Keep existing subscribe logic intact.

#### 3. `src/components/ArticleCard.tsx` — Match provided card pattern

Grid variant changes:
- Container: `p-6 flex flex-col group cursor-pointer` (was `p-4`)
- Image: add `shadow-sm` to container
- Title: `text-xl` (was `text-lg`), add `group-hover:text-primary`
- Add optional summary display for "default" variant vs "simple" variant
- Keep existing `variant="hero"` for hero usage elsewhere
- Accept optional `className` prop for border control from parent

#### 4. `src/components/Footer.tsx` — Match max-w-7xl

Change `max-w-6xl` → `max-w-7xl` to align with homepage shell width.

### Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Full rewrite: ad above main, hero with massive italic title + top-left category + border-4 shadow, 4-col grid with border-r separators, Newsletter inside main, category sections after |
| `src/components/Newsletter.tsx` | Restyle: `bg-primary`, centered, italic serif 5xl title, shadow-2xl form row, white-on-red inputs |
| `src/components/ArticleCard.tsx` | Add `className` prop, increase padding to p-6, title to text-xl, add shadow-sm to image |
| `src/components/Footer.tsx` | Change max-w-6xl to max-w-7xl |

