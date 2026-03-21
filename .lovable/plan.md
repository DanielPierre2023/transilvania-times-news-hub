

## Why the Layout Doesn't Match — Root Cause Analysis

### The Reference (Picture 1 — "The Featured Times")

The hero area is a **3-zone editorial spread across 12 columns**:

```text
┌──────────────┬────────────────────┬──────────────┐
│  Left Image  │  ■ WORLD           │  Right Image │
│  (grayscale  │  Large Serif Title │  (grayscale  │
│   ~4 cols)   │  • bullet summary  │   ~4 cols)   │
│              │  • bullet summary  │  ■ SPORTS    │
│              │  • bullet summary  │  Serif Title │
│              │     (~4 cols)      │              │
└──────────────┴────────────────────┴──────────────┘
── border-b ─────────────────────────────────────────
┌──────────┬──────────────────┬──────────────────────┐
│ ■ NEWS   │  Large Image     │  Ad Image            │
│ Title    │  (grayscale)     │                      │
│ 30 mins  │                  │                      │
│ excerpt  │                  │                      │
└──────────┴──────────────────┴──────────────────────┘
```

- **No border-4, no shadow-xl** on images
- **No "Most Read" sidebar** next to the hero
- Images are flush, borderless, grayscale
- Center column has bullet-point summaries with dotted separators
- Below: a 3-column section with text-left article + large image + ad

### The Current Implementation (Picture 2)

```text
┌────────────────────────────────┬──────────────────┐
│  Hero Image (border-4,shadow)  │  Most Read       │
│  ■ CATEGORY (top-left)         │  01 Title        │
│  Massive italic title          │  02 Title        │
│  Excerpt text                  │  03 Title        │
│  Author • Date                 │  04 Title        │
│           (8 cols)             │  05 Title (4col) │
└────────────────────────────────┴──────────────────┘
```

This is a completely different structural pattern. The code you've been providing describes a hero+sidebar 8/4 split, but the reference screenshot shows a 3-zone editorial spread with NO sidebar.

### What Needs to Change

The homepage hero must be rebuilt as a **3-column editorial spread** matching Picture 1 exactly:

1. **Hero section** — 3-zone layout (left image | center text+bullets | right image+title)
2. **Below hero** — 3-column section (text article | large image | ad slot)
3. **Most Read sidebar** — moves to a different location (below the hero sections, or removed from homepage entirely)
4. **No border-4/shadow-xl** on hero images — just clean grayscale images
5. **Newsletter** — footer only (per your answer), remove `<Newsletter />` from Index.tsx
6. **Category tag position** — stays as overlay on images (already correct)

### Implementation Plan

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Rebuild hero as 3-zone spread: `lg:grid-cols-3` with left image (col 1), center text with category+title+bullet summaries (col 2), right image+category+title (col 3). Below: 3-col section with text article + large image + ad. Remove `<Newsletter />`. Move MostRead below hero sections or remove. Remove `border-4 shadow-xl` from hero images. |
| `src/components/Footer.tsx` | No change — newsletter stays in footer 4th column |
| `src/components/ArticleCard.tsx` | No change — card pattern is correct |
| `src/components/MostReadSidebar.tsx` | No change — component itself is correct, just relocated |

### Hero Section Structure (Matching Reference Exactly)

```text
Section 1 — Editorial Spread:
  grid grid-cols-1 lg:grid-cols-12 border-b
  
  Col 1 (lg:col-span-4): 
    - Tall grayscale image, no border/shadow
    
  Col 2 (lg:col-span-4):
    - ■ CATEGORY label (red square + text)
    - Large serif title (text-3xl)
    - Bullet summaries with dotted border-b separators
    
  Col 3 (lg:col-span-4):
    - Grayscale image
    - ■ CATEGORY label
    - Serif title below image

Section 2 — Secondary Spread:
  grid grid-cols-1 lg:grid-cols-3 border-b
  
  Col 1: ■ CATEGORY + title + time + excerpt (text only, no image)
  Col 2: Large grayscale image
  Col 3: Ad unit (rectangle)
```

### Rest of Page (Below Hero Sections)

Stays as-is: 4-column article grid with vertical borders → category sections → View All → Footer (with newsletter in 4th column).

