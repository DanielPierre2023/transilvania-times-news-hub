

## Plan: Reorder Categories — News First, Remove World, Opinion Last

### Changes

**1. `src/lib/categories.ts`** — Reorder master list and update aliases

Current order: `politics, world, technology, business, culture, opinion, travel, education, sports, health, news`

New order: `news, politics, technology, business, culture, travel, education, sports, health, opinion`

- **Remove `world`** entirely from CATEGORIES (articles that were "world" will map to "news" via aliases)
- **Move `news` to first position**
- **Move `opinion` to last position**
- Update `CATEGORY_ALIASES`: map `world`, `lume`, `international`, `global` → `news` (instead of `world`)
- Fallback in `normalizeCategory()` already returns `'news'` — correct

**2. `supabase/functions/process-rewrite-job/index.ts`** — Update Desk 1 classification

- Remove `world` from `VALID_CATEGORIES` list (line 104)
- Remove `world` from the Gemini classification prompt (line 81)
- Update `CAT_ALIASES`: `world` → `news`

**3. `supabase/functions/ai-generate-article/index.ts`** — Update article generation

- Remove `world` from local `CATEGORIES` array (line 50)
- Reorder to match: `news, politics, technology, business, culture, travel, education, sports, health, opinion`

**4. `src/i18n.ts`** — Remove `cat_world` translations

- Remove `cat_world: "World"` (EN) and `cat_world: "Lume"` (RO)
- Keep all other translations as-is (they're already present)

**5. No DB migration needed** — existing `blog_posts` or `scraped_articles` with `category = 'world'` will display via i18n fallback. New articles won't get `world` anymore. Optionally update existing `world` rows to `news` but not strictly required.

### Navbar Result

```text
News | Politics | Technology | Business | Culture | Travel | Education | Sports | Health | Opinion
```

### Files

| File | Change |
|------|--------|
| `src/lib/categories.ts` | Remove `world`, reorder (news first, opinion last), update aliases |
| `supabase/functions/process-rewrite-job/index.ts` | Remove `world` from classification prompt + valid list |
| `supabase/functions/ai-generate-article/index.ts` | Remove `world` from CATEGORIES, reorder |
| `src/i18n.ts` | Remove `cat_world` / `cat_lume` translations |

