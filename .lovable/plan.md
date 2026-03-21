

## Plan: Move Hamburger to Top Bar + Fix Category Subcategory Tabs on Mobile

### Two Issues

1. **Hamburger menu is below the masthead** — user wants it in the top bar (next to RO/EN and weather), like CNN/CBS where the menu icon is always at the very top.

2. **Subcategory tabs on Category page use `overflow-x-auto` horizontal scroll** — ugly scrollbar visible on mobile. Needs a proper solution.

### Changes

#### 1. `src/components/Header.tsx` — Move hamburger to top bar

Current layout (mobile):
```
[RO EN] [Weather]        [Search]
      Transilvania Times
[☰ Categories]  ← hamburger is here, below masthead
```

New layout (mobile):
```
[☰] [RO EN] [Weather]   [Search]
      Transilvania Times
```

- Move the `Sheet` + hamburger trigger INTO the top bar div (line 82), as the first element in the left flex group — visible only on `md:hidden`
- Remove the entire separate "Mobile hamburger nav" div (lines 142-175)
- The hamburger icon sits at the far left of the top bar on mobile, before the language switcher

#### 2. `src/pages/Category.tsx` — Replace horizontal scroll tabs with dropdown on mobile

CNN/CBS approach: On mobile, subcategory filters become a **dropdown select** instead of horizontal tabs. On desktop, keep the underline tabs.

- Wrap current tab links in `hidden md:flex` so they only show on desktop
- Add a `md:hidden` block with a styled `<select>` dropdown for subcategories
- On change, navigate to `/category/${name}/${value}` or `/category/${name}` for "all"
- No ugly scrollbar, clean mobile UX

### Files

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Move hamburger into top bar (before LangSwitcher, `md:hidden`). Remove separate mobile nav section. |
| `src/pages/Category.tsx` | Add mobile dropdown for subcategory filtering (`md:hidden`). Hide horizontal tabs on mobile (`hidden md:flex`). |

