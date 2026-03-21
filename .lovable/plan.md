

## Diagnosis

**The Index page (homepage) only shows hardcoded static articles from `src/data/articles.ts`.** It never queries Supabase `blog_posts`. Published DB articles only appear at `/blog` — they are completely invisible on the homepage.

Additionally, `ArticleCard` links to `/article/:slug` (static articles route), not `/blog/:slug` (DB articles route). So even if we render DB posts on the homepage, we need different link paths.

## Plan: Unified Homepage with DB Articles

### 1. Update `Index.tsx` — Fetch and display published blog posts

- Add a `useQuery` call to fetch the latest 6 published `blog_posts` from Supabase (ordered by `published_at desc`)
- Keep the static `featuredArticle` as the hero (top of page) — this is editorial/curated content
- Below the ad unit, in the "Latest Stories" section, show **DB blog posts first**, then static articles as fallback if no DB posts exist
- Each DB post card links to `/blog/:slug`, uses `toPublicMediaUrl()` for images, and shows translated category via `t(categoryI18nKey(post.category))`
- Show bilingual title/excerpt based on current language (`title_ro`/`title_en`)

### 2. Reuse the same card layout

Rather than forcing DB posts through the `ArticleCard` component (which expects static article props and links to `/article/`), render DB posts inline with the same visual pattern but linking to `/blog/:slug`. This matches how `Blog.tsx` and `Category.tsx` already render DB posts.

### Files

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add Supabase query for latest published blog_posts, render them in "Latest Stories" section alongside or replacing static articles |

