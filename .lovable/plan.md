

## CTO Audit: Transilvania Times — Full-Stack Analysis

### Critical Bugs

**1. Contact form doesn't save to database**
`Contact.tsx` only shows a toast on submit — it never calls `supabase.from('contact_messages').insert(...)`. Messages are lost.

**2. Newsletter forms (Footer + Newsletter component) don't save subscribers**
Neither the Footer newsletter input nor the standalone `Newsletter.tsx` component calls Supabase or the `confirm-newsletter` edge function. Emails entered are discarded.

**3. BlogEditor route mismatch**
`BlogManager.tsx` navigates to `/admin/blog/${post.id}` for editing, but `App.tsx` defines the route as `blog/:id`. This works. However, the `AdminLayout` nav links to `/admin/blog/new` for "AI Blog Editor" — but `BlogEditor` defaults `genEditor` to `'kara_newman'` which doesn't exist in the `ai-generate-article` edge function's `EDITORS` map (it has `daniel_dobos`, `marcus_webb`, etc.). **AI generation will silently fall back to the default editor** instead of using the selected one.

**4. BlogEditor editors list mismatches edge function editors**
`BlogEditor.tsx` defines editors as `kara_newman`, `andrei_pop` — names that don't exist in the deployed `ai-generate-article` edge function. The RssScraper has a different list too. These must be synchronized.

**5. Newsletter save uses wrong column name**
`Newsletter.tsx` line 55: inserts `{ content: contentHtml }` but the `newsletter_campaigns` table column is `content` — this actually works, but the edge function `send-newsletter` reads `campaign.content_html` which doesn't exist on the table. The function will send empty newsletter bodies.

### Functional Gaps

**6. No analytics tracking on the frontend**
There's no code that inserts rows into `site_analytics` or `section_views`. The Analytics dashboard queries these tables but they'll always be empty. Need a tracking hook that fires on page load.

**7. No public blog listing route**
The site has static articles at `/article/:slug` but no route to browse database-driven blog posts (e.g., `/blog` or `/blog/:slug`). Published blog posts exist only in the admin panel.

**8. Category pages only show static articles**
`Category.tsx` uses `getArticlesByCategory()` from the static `articles.ts` — it never queries `blog_posts` from Supabase. Categories like "World", "Business", "Culture", "Opinion" have zero static articles and will show all articles as fallback.

**9. Search only searches static articles**
`SearchResults.tsx` filters `articles` from `articles.ts` — database blog posts are invisible to search.

**10. ArticleSEO has hardcoded date**
`ArticleSEO.tsx` line 16: `datePublished: "2026-03-19T14:30:00+02:00"` — hardcoded instead of using `article.date`.

### Data Integrity Issues

**11. send-newsletter reads `campaign.content_html` but column is `content`**
The edge function will send blank emails because it accesses a property that doesn't exist on the DB row.

**12. generate-weekly-newsletter writes `content_html` and `sent_count` columns that don't exist**
The edge function inserts `content_html` and `sent_count` but the table has `content` and `recipient_count`.

**13. send-inbox-reply reads `msg.sender_name` / `msg.sender_email`**
The `contact_messages` table has `name` and `email` — the function accesses non-existent properties, causing replies to fail.

### Security Concerns

**14. Newsletter preview uses `dangerouslySetInnerHTML` without sanitization**
`Newsletter.tsx` line 172 renders arbitrary HTML from AI-generated content directly into the DOM. This is an XSS vector if any admin session is compromised.

**15. No rate limiting on public INSERT policies**
`contact_messages`, `newsletter_subscribers`, `blog_comments`, `site_analytics` all have `WITH CHECK (true)` INSERT policies for anon users. A bot could flood these tables.

### Consistency Issues

**16. `chat_conversations` table exists but no UI references it**
The table has RLS policies but nothing in the frontend uses it. Dead schema.

**17. `report_requests` table exists but no UI references it**
Same — orphaned table.

**18. `rewrite_jobs` has both `completed_at` and `finished_at` columns**
Redundant — the code only uses `finished_at`.

**19. Static article dates are hardcoded**
All static articles show "March 19, 2026" — `timeAgo` values like "1 hour ago" become stale immediately. These should compute dynamically.

### Proposed Fix Plan

| # | Priority | Fix |
|---|----------|-----|
| 1 | **P0** | Wire Contact form to insert into `contact_messages` |
| 2 | **P0** | Wire Footer/Newsletter to call `confirm-newsletter` edge function |
| 3 | **P0** | Fix edge functions: `send-newsletter`, `generate-weekly-newsletter`, `send-inbox-reply` column name mappings |
| 4 | **P0** | Sync BlogEditor + RssScraper editor lists with edge function EDITORS |
| 5 | **P1** | Add frontend analytics tracking hook (page views → `site_analytics`) |
| 6 | **P1** | Add public `/blog` listing page + `/blog/:slug` route for DB posts |
| 7 | **P1** | Merge DB blog posts into Category and Search pages |
| 8 | **P2** | Make ArticleSEO dates dynamic |
| 9 | **P2** | Clean up orphaned tables (`chat_conversations`, `report_requests`) |
| 10 | **P2** | Remove redundant `completed_at` from `rewrite_jobs` |
| 11 | **P2** | Sanitize HTML in newsletter preview |

### Files Affected

**Edge functions (column fixes):** `send-newsletter/index.ts`, `generate-weekly-newsletter/index.ts`, `send-inbox-reply/index.ts`
**Frontend (functional):** `Contact.tsx`, `Footer.tsx`, `Newsletter.tsx`, `BlogEditor.tsx`, `Category.tsx`, `SearchResults.tsx`, `ArticleSEO.tsx`
**New files:** Analytics tracking hook, public blog page
**Database migration:** Drop orphaned tables, drop `completed_at`

