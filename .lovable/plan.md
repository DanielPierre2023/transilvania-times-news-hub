

## Plan: Fix Secondary Spread Cards + Verify SEO

### Issue 1: Center Image Card Has No Title/Category Below It

Looking at your screenshot: the center column (large grayscale image) only has a tiny category overlay at the bottom but **no title or text below the image**. It's just a nameless image.

**Fix in `src/pages/Index.tsx`** (lines 219-239): Add a text block below the image with category label + serif title + time, matching the same pattern as the right column of the hero spread. The card becomes:

```
┌──────────────────────────┐
│  Large grayscale image   │
│  [■ CATEGORY overlay]    │
├──────────────────────────┤
│  ■ CATEGORY              │
│  Serif Title             │
│  MAR 21, 2026            │
└──────────────────────────┘
```

### Issue 2: Left Card Has No Thumbnail

The left column (text-only article) looks orphaned without any visual anchor. 

**Fix in `src/pages/Index.tsx`** (lines 192-217): Add a small grayscale thumbnail (`aspect-[4/3] w-full max-h-[180px]`) above the text content, with the same hover effect. The card becomes:

```
┌──────────────────────────┐
│  Small grayscale thumb   │
│  [■ CATEGORY overlay]    │
├──────────────────────────┤
│  ■ CATEGORY              │
│  Serif Title (text-2xl)  │
│  MAR 21, 2026            │
│  Excerpt text...         │
└──────────────────────────┘
```

### Issue 3: SEO Tags in Romanian

The code already correctly uses `seo_title_ro` → `title_ro` → `title_en` fallback chain. The fields exist in the database and the rewrite functions generate them. If SEO tags show English content for Romanian articles, it means those specific articles have null `seo_title_ro` AND null `title_ro` values. This is a **data issue**, not a code issue. 

However, to be safe, I will also check and ensure the `<html lang>` attribute and the `og:locale` tag update correctly when language switches.

### Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add title+category text block below center image. Add thumbnail image to left text-only card. |

