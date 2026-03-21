

## Plan: Structured Competitor Analysis Results UI

### Problem
The competitor analysis returns structured JSON with clear fields (`positioning`, `vsEnterprise`, `vsBoutique`, `vsNiche`, `recommendedApproach`, `estimatedROI`) but displays it as raw `<pre>` text — unreadable for admins.

### Solution
Replace the raw JSON dump with a well-designed card layout that renders each section visually:

### File to Modify

**`src/pages/admin/geo/CompetitorTab.tsx`**

Replace the `<pre>` block with structured sections:

- **Positioning** — blockquote-style card with the positioning statement
- **vs Enterprise / vs Boutique / vs Niche** — three side-by-side cards, each with a title and bullet list (using check icons)
- **Recommended Approach** — highlighted callout card
- **Estimated ROI** — badge or accent card with the ROI projection
- **Fallback** — if the response doesn't match expected structure (e.g. has `raw` key), show the raw text as before

Uses existing UI components: `Card`, `Badge`, plus `Target`, `Building2`, `BookOpen`, `TrendingUp`, `Lightbulb` icons from lucide-react. No new dependencies.

