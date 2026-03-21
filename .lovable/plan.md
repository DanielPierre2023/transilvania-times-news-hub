

## Plan: Align Categories & Add Dynamic Date

### Problem 1: Category Mismatch

**Frontend (Header/Footer)**: `politics`, `technology`, `education`, `sports`, `showbiz`, `health`, `beauty`, `travel`

**Backend (BlogEditor + ai-generate-article)**: `politics`, `world`, `technology`, `business`, `culture`, `opinion`

**Static articles (articles.ts)**: `Travel`, `Politics`, `Technology`, `Education`

These three systems use different category sets. The blog system and AI generators won't produce articles matching the frontend navigation categories (no `world`, `business`, `culture`, `opinion` in header; no `sports`, `showbiz`, `health`, `beauty` in backend).

**Fix**: Unify to a single master list that covers both editorial and blog needs:
`politics`, `world`, `technology`, `business`, `culture`, `opinion`, `travel`, `education`, `sports`, `health`

Drop `showbiz` and `beauty` (niche for a news site), add the backend categories to the frontend.

### Problem 2: Hardcoded Date

The header date `"Thursday, March 19, 2026"` is a static i18n string. It should be computed dynamically.

**Fix**: Replace the `date_full` translation key usage in `Header.tsx` with a `useMemo` that formats `new Date()` using `Intl.DateTimeFormat` for both EN and RO locales.

### Files to Modify

| File | Change |
|------|--------|
| `src/i18n.ts` | Update category keys to include `cat_world`, `cat_business`, `cat_culture`, `cat_opinion`. Remove `cat_showbiz`, `cat_beauty`. Remove hardcoded `date_full` keys. |
| `src/components/Header.tsx` | Update `categoryKeys` and `categorySlugs` to match new list. Replace `t("date_full")` with dynamic `Intl.DateTimeFormat` output based on current language. |
| `src/components/Footer.tsx` | Update imported `categoryKeys`/`categorySlugs` to match (if shared) or update inline. |
| `src/pages/admin/BlogEditor.tsx` | Update `CATEGORIES` to match the unified list. |
| `supabase/functions/ai-generate-article/index.ts` | Update `CATEGORIES` to match. |

### Dynamic Date Implementation

```tsx
const dateStr = useMemo(() => {
  const now = new Date();
  const locale = i18n.language.startsWith('ro') ? 'ro-RO' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  }).format(now);
}, [i18n.language]);
```

This replaces the static `t("date_full")` call in the header.

