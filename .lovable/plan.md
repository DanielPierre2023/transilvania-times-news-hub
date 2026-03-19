

## Plan: Ad Placeholders, GDPR Consent Banner & Terms Page

The user requests ad slots, GDPR consent, and a Terms & Conditions page. Since there's no real AdSense ID, we'll build placeholder ad components that are visually correct and ready for a real ID later. No external dependencies needed.

### Files to Create

| File | Purpose |
|------|---------|
| `src/components/AdUnit.tsx` | Reusable ad placeholder with leaderboard, sidebar, and infeed variants |
| `src/components/GDPRConsent.tsx` | Cookie consent banner with Accept All / Essential Only, persists to localStorage |
| `src/pages/TermsConditions.tsx` | Legal page with Terms & Conditions content |

### Files to Modify

| File | Change |
|------|--------|
| `src/pages/Article.tsx` | Add leaderboard ad above article, in-feed ad mid-article, sidebar ad below MostRead |
| `src/pages/Index.tsx` | Add leaderboard ad above latest stories |
| `src/pages/Category.tsx` | Inject in-feed ad after 2nd article card on mobile |
| `src/App.tsx` | Add `/terms` route, render `GDPRConsent` globally |
| `src/components/Footer.tsx` | Change "Accessibility" link to point to `/terms` |
| `src/index.css` | Add `slideUp` keyframe for consent banner animation |

### Implementation Details

**AdUnit** — Three variants via `type` prop: `leaderboard` (728x90), `sidebar` (300x600), `infeed` (responsive 250px height). Each shows a styled placeholder with "Advertisement" label. Checks `localStorage` for consent before rendering (shows blank placeholder if no consent). Ready to swap in real `adsbygoogle` tags when an ID is available.

**GDPRConsent** — Fixed bottom banner, appears after 1.5s delay if no `transilvania-consent` key in localStorage. Two buttons: "Accept All" (stores `all`) and "Essential Only" (stores `essential`). Uses brand colors and slide-up animation.

**TermsConditions** — Single-column reading layout matching article page style. Sections for Introduction, IP, Advertising/Data, User Conduct, and Contact. Header/Footer included.

**Article page ads** — Leaderboard above the grid, in-feed ad injected at the midpoint of article body paragraphs, sidebar ad below MostReadSidebar (sticky).

**Category page ads** — In-feed ad injected after the 2nd card on mobile (`md:hidden`).

