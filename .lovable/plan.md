

## Plan: Fix Crash + Mobile Layout + Subcategory Consistency

### 1. Fix Runtime Error — `src/pages/Index.tsx`

**Root cause**: `getSummary(heroMain)` is called inside `useMemo` (line 67) unconditionally, but `heroMain` can be `null` when posts haven't loaded yet. The `useMemo` runs before the null-check guard at line 86.

**Fix**: Add null guard in `getSummary`, `getTitle`, `getExcerpt` helpers:
```ts
const getSummary = (post: any) => {
  if (!post) return "";
  return isRo ? post.summary_ro || post.summary_en : post.summary_en;
};
```
Same pattern for `getTitle` and `getExcerpt`.

### 2. Mobile Hamburger Menu for Categories — `src/components/Header.tsx`

Currently the nav bar shows all 10 categories in a horizontally scrollable list. On a 390px viewport this is unusable.

**Change**: On mobile (`sm` and below), replace the horizontal category list with a hamburger menu icon that opens a `Sheet` (slide-in drawer) containing the full category list as vertical links.

- Import `Sheet`, `SheetContent`, `SheetTrigger`, `SheetTitle` from `@/components/ui/sheet`
- Import `Menu` from `lucide-react`
- Add state `const [menuOpen, setMenuOpen] = useState(false)`
- Desktop (`hidden md:flex`): keep existing horizontal `<ul>` nav
- Mobile (`md:hidden`): show a `<Menu>` hamburger button that opens a `Sheet` with vertical category links
- Each category link closes the sheet on click

### 3. iOS Font Readability — `src/index.css`

Add `-webkit-text-size-adjust: 100%` to `html` to prevent iOS Safari from inflating font sizes. Add `font-smoothing` properties for consistent rendering across Android/iOS:

```css
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Also set a minimum `font-size: 16px` on inputs to prevent iOS zoom on focus (already likely handled, but verify).

### 4. Subcategory Consistency on Category Page

The subcategory tabs show on ALL categories, but not all categories have meaningful subcategories. The subcategories (regional/national/international) are geographic scopes that apply to categories like news, politics, sports, etc.

**Fix**: The tabs already work correctly — they filter by subcategory column. The issue is purely that the same 3 tabs show even for categories where subcategories may not exist in the data. This is acceptable behavior (tabs will show empty results). No structural change needed — the current implementation is consistent.

### 5. Mobile Layout Fixes — `src/pages/Index.tsx`

The 3-zone hero spread doesn't stack well on mobile. Fix:
- Hero section: On mobile, stack vertically (already `grid-cols-1` default). Ensure left image has `aspect-video` on mobile instead of full-height.
- Editorial block: On mobile, each column stacks full-width (already `grid-cols-1` default). Ensure padding is consistent.
- Reduce hero title size on mobile: `text-2xl sm:text-3xl md:text-4xl lg:text-5xl`

### 6. Console Warning Fix — `LangSwitcher` and `WeatherWidget`

Both components get a "cannot be given refs" warning. Wrap them with `React.forwardRef` or wrap the usage sites. Quick fix: the Header passes no refs — this warning comes from Tooltip wrapping. Add `forwardRef` to both components.

### Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add null guards to `getTitle`/`getExcerpt`/`getSummary`. Responsive hero title sizes. Mobile padding adjustments. |
| `src/components/Header.tsx` | Add hamburger menu with Sheet for mobile categories. Keep horizontal nav for `md+`. |
| `src/index.css` | Add `-webkit-text-size-adjust: 100%` and font smoothing for iOS/Android consistency. |
| `src/components/LangSwitcher.tsx` | Wrap with `forwardRef` to fix console warning. |
| `src/components/WeatherWidget.tsx` | Wrap with `forwardRef` to fix console warning. |

