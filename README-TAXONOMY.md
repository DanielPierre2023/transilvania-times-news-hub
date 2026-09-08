# Transilvania Times — new categories: Administrație + Infrastructură

Adds two top-level categories — **Administrație** (`administration`) and
**Infrastructură** (`infrastructure`) — as real sections: nav, category pages,
homepage grouping, sitemap, feeds, article labels, and the admin selectors. Plus
a reviewable reclassification that moves existing stories into them.

**No database migration.** `blog_posts.category` is plain `text` with no
constraint, so new values just work. This is repo files + one SQL backfill + one
one-line edit to a deployed function.

---

## ⚠ Read first — relationship to the Phase 1 delivery

Eight files here are also edited by the Phase 1 (AdSense) zip. **These versions
contain BOTH changes** (Phase 1 + the new categories), so they *supersede* the
Phase 1 zip's copies of the same files. Commit order that always works:

1. Commit the Phase 1 zip.
2. Commit this zip — for the eight shared files below, let these overwrite.

The eight shared files (Phase 1 changes are already included in them here):

- `app/components/ArticleCard.tsx`
- `app/components/LayoutShell.tsx`
- `app/page.tsx`
- `app/en/page.tsx`
- `app/blog/[slug]/page.tsx`
- `app/en/blog/[slug]/page.tsx`
- `app/categorie/[category]/page.tsx`
- `app/sitemap.ts`

If you have NOT deployed Phase 1 yet, that's fine — these eight already carry the
Phase 1 edits too, so committing this zip alone still ships both. (The Phase 1
zip's other files — the 8 new trust pages, `judet`, `cautare` — are not in this
zip and still need to come from the Phase 1 zip.)

The whole combined set was typechecked together (`tsc --noEmit`, 0 errors).

---

## Part 1 — Repo files to commit (17)

**New canonical module (1):**

- `lib/categories.ts` — single source of truth for the category slugs + RO/EN
  labels. `sitemap.ts` now imports from it. (The per-view label maps below still
  keep their own copies for now — migrating them all to this module is the
  recommended follow-up; see the end.)

**Category surfaced everywhere it's rendered or listed (16):**

- Nav (desktop + mobile) — `app/components/LayoutShell.tsx`
- Card labels — `app/components/ArticleCard.tsx` (RO + EN)
- Article-page labels — `app/blog/[slug]/page.tsx`, `app/en/blog/[slug]/page.tsx`
- Homepage labels — `app/page.tsx`, `app/en/page.tsx` (sections group dynamically,
  so the two new ones appear automatically once articles carry the category)
- Category page — `app/categorie/[category]/page.tsx`
- Sitemap — `app/sitemap.ts` (now driven by `lib/categories.ts`)
- Feeds / other labels — `app/rss.xml/route.ts`, `app/buletin/[slug]/page.tsx`,
  `app/autor/[slug]/page.tsx`, `app/despre/page.tsx`
- Admin selectors — `app/admin/editor/page.tsx`,
  `app/admin/components/ArticleEditor.tsx`, `app/admin/scraper/page.tsx`,
  `app/admin/corector/page.tsx`

URLs: `/categorie/administration/` and `/categorie/infrastructure/`. RO labels
Administrație / Infrastructură; EN labels Administration / Infrastructure. In the
nav they sit right after Politică.

---

## Part 2 — One deployed-function edit (Supabase dashboard)

For **scraped** articles set to *auto-detect* to be filed into the new sections,
`tt-process-scraped-article` needs the two slugs in its allow-list. It's a 313 KB
function you deploy by hand, and the change is a single line, so do it in the
dashboard editor rather than redeploying a huge file. Find:

```
const VALID_CATEGORIES    = ['news','politics','technology','business','culture','travel','education','sports','health','opinion']
```

and replace with:

```
const VALID_CATEGORIES    = ['news','politics','technology','business','culture','travel','education','sports','health','opinion','administration','infrastructure']
```

That one array feeds both the Gemini classification prompt and the validation
guard, so nothing else in the function needs to change. **Optional:** to route
these beats to a specific writer, add to the `EDITOR_BY_CATEGORY` map:
`administration: 'andrei_popescu', infrastructure: 'andrei_popescu',` — without
it they route to the default editor, which is fine.

Nothing else in the pipeline needs touching: `tt-generate-article` takes the
category from the admin dropdown (now updated), and `tt-rewrite-blog-post`
preserves the existing category.

---

## Part 3 — Reclassification SQL (run in Supabase)

`sql/03-reclassify-categories.sql` — preview-then-apply, like the Phase 1
backfills. Only touches the news + politics pool.

- **STEP 1** preview, **STEP 2** apply **Tier 1** (headline or tag is about the
  beat, high precision): **33 → infrastructure, 40 → administration.** Verified
  against the live DB.
- **STEP 3** optional **Tier 2** review list (body-only mentions, lower
  precision) — you cherry-pick by slug with the template provided; nothing runs
  automatically.
- **STEP 4** optional — the single stray `community` article (preview + a
  one-line move if you want it in a real category).

Infrastructure takes precedence over administration on overlap. Every row shows
old → new before anything changes.

---

## Expected result

Two new sections appear in the nav and sitemap, and after the SQL they launch
populated (~73 real stories) instead of empty. New articles file into them going
forward — manually via the admin dropdown, or automatically for scraped sources
once the one-line function edit is in. Cleaner topic clusters and internal
linking, which is exactly the structure AdSense and Search reward for a regional
publisher.

## Notes / follow-ups (not blocking)

- The category **label maps are still duplicated** across ~10 view files. This
  delivery adds the two entries to each and introduces `lib/categories.ts` as the
  canonical source (sitemap already uses it). Migrating the remaining label maps
  to import from `lib/categories.ts` is a clean follow-up — I deliberately kept it
  out of this pass to avoid a site-wide refactor right before the AdSense review.
- `app/components/SiteFooter.tsx` and `SiteHeader.tsx` still list the old 10
  categories but are **not imported anywhere** (dead/legacy) — left untouched. If
  you ever wire them back in, add the two categories there too.
- No schema migration, and no full edge-function file shipped (only the one-line
  dashboard edit above).
