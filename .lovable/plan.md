

## Plan: Admin Panel Phase 1 — Database, Auth, Login, Layout & Dashboard

### Current State
- Database is empty (no tables, no enums, no triggers)
- No admin pages exist (`src/pages/admin/` is empty)
- No `useAdmin` hook exists
- The uploaded `admin-schema.sql` contains the complete schema (17 tables, RLS policies, triggers, storage buckets)
- The project already uses i18n, bilingual articles data, and Transilvania Times branding

### Step 1: Database Migration

Run the full schema from the uploaded SQL file, **excluding** tables irrelevant to a news site (configurator_submissions, vip_remembered_ips, playground_usage, service_checklist_items, client_projects, client_project_checks). Also exclude storage bucket inserts (must be done via Storage UI).

Tables to create: `user_roles`, `profiles`, `blog_posts`, `blog_comments`, `contact_messages`, `contacts`, `newsletter_subscribers`, `newsletter_campaigns`, `site_analytics`, `section_views`, `rss_sources`, `scraped_articles`, `rewrite_jobs`, `chat_conversations`, `report_requests`, `site_settings`

Plus: `app_role` enum, `has_role()` function, `handle_new_user()` trigger, `sync_subscriber_to_contacts()` trigger, `update_updated_at()` triggers, and all RLS policies.

### Step 2: Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/useAdmin.ts` | Auth guard — checks session + `user_roles` for admin role |
| `src/pages/admin/AdminLogin.tsx` | Login form with Transilvania Times branding (serif masthead, primary red button, paper bg) |
| `src/pages/admin/AdminLayout.tsx` | Sidebar shell with espresso bg, red active states, mobile Sheet drawer, "Transilvania Times" branding, sign out button, `<Outlet />` |
| `src/pages/admin/Dashboard.tsx` | Placeholder dashboard with welcome card and stats placeholders |

### Step 3: Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add imports for admin pages; add `/admin/login` route and `/admin` route group with `AdminLayout` wrapping `Dashboard` |

### Branding Adaptations (ADDIS.Admin → Transilvania Times)

- Sidebar: `bg-foreground` (espresso dark) with white text
- Active nav: `bg-primary text-white` (brand red #ca2222)
- Hover: `hover:bg-primary/10`
- Login card: paper background with serif "Transilvania Times" masthead
- All CSS variables (`--blue`, `--ink`, `--slate`) replaced with Tailwind classes using existing brand tokens

### Nav Items (Phase 1)

Full navigation visible in sidebar but only Dashboard has a real page. Other items link to placeholder routes that show "Coming Soon" within the AdminLayout outlet. This prevents 404s while keeping the menu ready for future phases.

Nav items: Dashboard, Analytics, Blog Manager, AI Blog Editor, Comments, RSS Scraper, Newsletter, Subscribers, Contacts, Conversations, Reports, GEO Tools, Inbox, Settings

### Post-Implementation Setup

After implementation, the user must:
1. Create a user in Supabase Auth dashboard
2. Insert admin role via SQL Editor: `INSERT INTO user_roles (user_id, role) VALUES ('<uuid>', 'admin');`
3. Create storage buckets `blog-images` and `reports` via Storage UI
4. Navigate to `/admin/login` to sign in

