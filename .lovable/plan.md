

## Plan: Mobile Optimization & Minor Refinements

The user's message contains CSS enhancements for mobile and an AdBanner component. Most of the content repeats previously-implemented specs. Here's what's actually new and worth implementing:

### Changes

**1. Update `src/index.css` — Add mobile optimizations**
- Add `overflow-x: hidden`, `scroll-behavior: smooth`, `-webkit-tap-highlight-color: transparent` to `html`
- Add `min-height: 100dvh` to `body` for iOS Safari address bar fix
- Add component-layer utility classes: `.article-thumb-transition` (grayscale hover/active), `.min-h-dynamic`, `.safe-p-bottom`

**2. Update `src/components/Footer.tsx` — Expand categories list**
- Add Sports, Showbiz, Health, Beauty to the Popular Categories list (currently only Politics, Technology, Education, Travel)

**3. Skip: AdBanner component**
- Requires a real Google AdSense publisher ID to function — no value adding a placeholder with `ca-pub-XXXXXXXXXXXXXXXX`
- Can be added later when the user has an actual AdSense account

**4. Skip: Footer restructure to 4 columns with inline newsletter**
- The current footer already has a separate Newsletter component above it — duplicating it inside the footer adds clutter
- The current 3-column layout with router Links is clean and functional

### Files to Change

| File | Change |
|------|--------|
| `src/index.css` | Add mobile-first optimizations (dvh, smooth scroll, tap highlight, utility classes) |
| `src/components/Footer.tsx` | Expand categories to full 8-category list |

