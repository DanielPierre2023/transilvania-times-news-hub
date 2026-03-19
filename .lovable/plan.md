

## Plan: Bilingual i18n (Romanian & English)

Add `i18next` and `react-i18next` for instant language switching across the entire site. All UI strings, article content, categories, legal pages, and date formatting will support both `en` and `ro`.

### Dependencies to Add

`i18next`, `react-i18next`, `i18next-browser-languagedetector`

### Files to Create

| File | Purpose |
|------|---------|
| `src/i18n.ts` | i18n config with EN/RO translation resources for all UI strings (header, footer, GDPR, newsletter, contact, legal pages, categories, date) |
| `src/components/LangSwitcher.tsx` | RO / EN toggle buttons styled with brand colors, placed in the Header |

### Files to Modify

| File | Change |
|------|--------|
| `src/main.tsx` | Import `./i18n` to initialize i18next |
| `src/data/articles.ts` | Extend `Article` interface to hold bilingual fields: `title`, `category`, `excerpt`, and `body` become `{ en: string; ro: string }` objects (or `{ en: string[]; ro: string[] }` for body). Author, slug, image stay as-is. |
| `src/components/Header.tsx` | Add `LangSwitcher` next to date; use `useTranslation` for "Breaking", "Support Us", search placeholder, category names, and formatted date |
| `src/components/Footer.tsx` | Use `useTranslation` for all static strings and category names |
| `src/components/GDPRConsent.tsx` | Use `useTranslation` for banner text and button labels |
| `src/components/Newsletter.tsx` | Use `useTranslation` for heading, description, placeholder, button |
| `src/components/MostReadSidebar.tsx` | Use `useTranslation` for "Most Read" heading; access bilingual article fields via current language |
| `src/components/ArticleCard.tsx` | Read bilingual title/category/excerpt via current language |
| `src/components/ArticleSEO.tsx` | Use current language for JSON-LD fields; add `hreflang` link tags |
| `src/pages/Article.tsx` | Read bilingual article fields; pass current language through |
| `src/pages/Index.tsx` | Read bilingual fields for featured article and grid |
| `src/pages/Category.tsx` | Match category by current language; display bilingual fields |
| `src/pages/SearchResults.tsx` | Search against current-language text |
| `src/pages/Contact.tsx` | Use `useTranslation` for all labels and form text |
| `src/pages/TermsConditions.tsx` | Use `useTranslation` for all section titles and body text |
| `src/pages/PrivacyPolicy.tsx` | Use `useTranslation` for all section titles and body text |

### Implementation Details

**i18n config** — Resources object with `en.translation` and `ro.translation` keys covering: header strings (breaking, support, search placeholder, day/month names), footer strings, GDPR banner, newsletter, contact page labels, full Terms & Conditions sections, full Privacy Policy sections, and category names mapping (`Politics` ↔ `Politică`, etc.).

**Article data** — Each article's `title`, `category`, `excerpt`, `body`, and `subheadings` become bilingual objects. A helper `useArticleT(article)` or inline `article.title[i18n.language]` pattern extracts the correct language. Romanian translations provided for all 5 existing articles.

**LangSwitcher** — Two small buttons (RO | EN) with active state indicated by `text-primary border-b border-primary`. Positioned in the header bar between the date and the masthead.

**Date formatting** — The header date switches between English ("Thursday, March 19, 2026") and Romanian ("Joi, 19 Martie 2026") based on the current language.

**SEO hreflang** — `ArticleSEO` injects `<link rel="alternate" hreflang="ro">` and `<link rel="alternate" hreflang="en">` tags alongside the JSON-LD.

**Breaking news ticker** — Headlines stored in translation resources for both languages.

### Technical Notes

- `i18next-browser-languagedetector` auto-detects browser language on first visit
- `fallbackLng: 'en'` ensures English is default
- No page reload needed — React re-renders on language change
- All existing component styling preserved; only string content changes

