

## Plan: Replace "Most Read" with Rich 3-Column Editorial Block

### What the Reference Shows (image-33.png)

The section below the 4-column article grid is NOT a simple "Most Read" numbered list. It's a sophisticated 3-column editorial composition:

```text
┌─────────────────────┬─────────────────────────┬──────────────────────┐
│  Ad Unit (sidebar)  │  ■ TRAVEL               │  Avatar + Title      │
│  (scooter ad)       │  [img] Title             │  "Champions League"  │
│                     │        20 mins           │  20 mins ago         │
│                     │  ───────────────────     │                      │
│─────────────────────│  ■ LAW                   │  Avatar + Title      │
│ ■ SPORTS  ■ BEAUTY  │  [img] Title             │  "Who's next..."     │
│ Title     Title     │        20 mins           │  30 mins ago         │
│ 20 mins   20 mins   │  ───────────────────     │                      │
│                     │  ■ TECHNOLOGY            │  Avatar + Title      │
│ ■ TRAVEL  ■ LAW     │  [img] Title             │  "Earthquake..."     │
│ Title     Title     │        30 mins           │  20 mins ago         │
│ 20 mins   20 mins   │  ───────────────────     │                      │
│                     │  ■ SHOWBIZ               │ ┌──────────────────┐ │
│ ■ TECH    ■ SHOWBIZ │  [img] Title             │ │ SPONSOR          │ │
│ Title     Title     │        20 mins           │ │ Dark card with   │ │
│ 30 mins   20 mins   │                          │ │ image + title    │ │
│                     │                          │ └──────────────────┘ │
└─────────────────────┴─────────────────────────┴──────────────────────┘
```

**Left column (~4 cols)**: Ad unit on top, then a 2-column grid of text-only article snippets (no images — just colored category square + category name + title + time)

**Center column (~4 cols)**: Vertical stack of horizontal cards — small grayscale thumbnail on left + category label + serif title + time on right, separated by dotted borders

**Right column (~4 cols)**: Author avatar + title + time entries (like a trending feed), plus a large sponsored/ad card at the bottom with dark background, image, and title

### Implementation

#### 1. `src/pages/Index.tsx` — Replace "MOST READ SECTION" (lines 254-259)

Replace the current `MostReadSidebar` wrapper with a new 3-column `lg:grid-cols-12` section:

- **Left (col-span-4)**: `<AdUnit type="sidebar" />` on top, then a 2-column (`grid-cols-2`) grid of text-only article snippets from `restPosts`. Each snippet: colored category square + category name + serif title + time. No images.
- **Center (col-span-4)**: Vertical stack of horizontal mini-cards. Each card: `flex` row with a small grayscale image (`w-[120px] aspect-[4/3]`) on left + category label + title + time on right. Separated by `border-b border-dotted border-foreground/15`.
- **Right (col-span-4)**: Top portion shows 3-4 "trending" entries with a circular avatar placeholder + title + time. Bottom portion shows a sponsored ad card with dark `bg-foreground` background, an image, "SPONSOR" label, and a serif title.

All articles in this section are pulled from `allPosts` (posts not already used in the hero/grid sections). The data is already fetched — this is purely a layout change.

#### 2. `src/components/MostReadSidebar.tsx` — No deletion

Keep the component — it's still used on `BlogPost.tsx` and other pages. Just remove its import from `Index.tsx`.

### Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Replace lines 254-259 (MostRead section) with the 3-column editorial block. Remove `MostReadSidebar` import. Use posts from `restPosts` or allocate specific post slots for each column. |

### Data Allocation

Current flow: posts 0-1 (hero spread), 2-3 (secondary spread), 4-7 (4-col grid), 8+ (category sections).

New allocation for the editorial block — use posts 8-19 before category grouping:
- Posts 8-13: left column text snippets (6 articles, 2-col grid)
- Posts 14-18: center column horizontal cards (5 articles)
- Posts 19-21: right column trending entries (3 articles)
- Posts 22+: category sections (as before)

This requires fetching more posts (increase limit from 30 to 50) to have enough content for all sections.

