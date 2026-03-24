

## Restore Vite Preview Layer

### What's wrong
The Lovable preview requires a `build:dev` script and Vite dependencies, but the Next.js migration removed them. Additionally, `src/App.tsx` imports from `src/pages/` which no longer exists (files moved to `src/views/`).

### Changes

**1. Update `package.json`** -- add missing scripts and dependencies

- Add scripts: `"build:dev": "vite build --mode development"` and `"dev:vite": "vite"`
- Add dependencies: `react-router-dom`, `react-i18next`, `i18next`, `i18next-browser-languagedetector`
- Add devDependencies: `vite`, `@vitejs/plugin-react-swc`, `lovable-tagger`

**2. Create 24 barrel files in `src/pages/`** that re-export from `src/views/`

Each file is a single line, e.g. `export { default } from "@/views/Index";`

Files to create:
- `src/pages/Index.tsx` -- `src/pages/Article.tsx` -- `src/pages/Category.tsx`
- `src/pages/SearchResults.tsx` -- `src/pages/Blog.tsx` -- `src/pages/BlogPost.tsx`
- `src/pages/TermsConditions.tsx` -- `src/pages/PrivacyPolicy.tsx` -- `src/pages/Contact.tsx`
- `src/pages/NotFound.tsx`
- `src/pages/admin/AdminLogin.tsx` -- `src/pages/admin/AdminLayout.tsx`
- `src/pages/admin/Dashboard.tsx` -- `src/pages/admin/BlogManager.tsx`
- `src/pages/admin/BlogEditor.tsx` -- `src/pages/admin/Analytics.tsx`
- `src/pages/admin/CommentsManager.tsx` -- `src/pages/admin/ContactsPage.tsx`
- `src/pages/admin/GeoToolsPage.tsx` -- `src/pages/admin/InboxPage.tsx`
- `src/pages/admin/Newsletter.tsx` -- `src/pages/admin/RssScraper.tsx`
- `src/pages/admin/Subscribers.tsx` -- `src/pages/admin/SettingsPage.tsx`

### Impact
- Zero changes to production Next.js app, Supabase, or Netlify deployment
- Only restores the Vite-based preview that Lovable needs

