export const CATEGORIES = [
  'news', 'politics', 'technology', 'business', 'culture',
  'travel', 'education', 'sports', 'health', 'opinion',
] as const;

export type Category = typeof CATEGORIES[number];

export const SUBCATEGORIES = ['regional', 'national', 'international'] as const;

export type Subcategory = typeof SUBCATEGORIES[number];

/** i18n key for a category slug */
export const categoryI18nKey = (slug: string) => `cat_${slug}`;

/** i18n key for a subcategory slug */
export const subcategoryI18nKey = (slug: string) => `subcat_${slug}`;

/** Maps for normalizing LLM output to valid category slugs */
const CATEGORY_ALIASES: Record<string, string> = {
  tech: 'technology',
  sport: 'sports',
  economia: 'business',
  economie: 'business',
  politica: 'politics',
  politică: 'politics',
  știri: 'news',
  stiri: 'news',
  lume: 'news',
  world: 'news',
  tehnologie: 'technology',
  afaceri: 'business',
  cultură: 'culture',
  cultura: 'culture',
  opinie: 'opinion',
  călătorii: 'travel',
  calatorii: 'travel',
  educație: 'education',
  educatie: 'education',
  sănătate: 'health',
  sanatate: 'health',
  international: 'news',
  finance: 'business',
  money: 'business',
  science: 'technology',
  entertainment: 'culture',
  lifestyle: 'culture',
  showbiz: 'culture',
  global: 'news',
};

const SUBCATEGORY_ALIASES: Record<string, string> = {
  local: 'regional',
  transilvania: 'regional',
  transylvania: 'regional',
  romania: 'national',
  global: 'international',
  mondial: 'international',
  extern: 'international',
};

export function normalizeCategory(raw: string): Category {
  const lower = raw.trim().toLowerCase();
  const mapped = CATEGORY_ALIASES[lower];
  if (mapped && CATEGORIES.includes(mapped as Category)) return mapped as Category;
  if (CATEGORIES.includes(lower as Category)) return lower as Category;
  return 'news';
}

export function normalizeSubcategory(raw: string): Subcategory {
  const lower = raw.trim().toLowerCase();
  const mapped = SUBCATEGORY_ALIASES[lower];
  if (mapped && SUBCATEGORIES.includes(mapped as Subcategory)) return mapped as Subcategory;
  if (SUBCATEGORIES.includes(lower as Subcategory)) return lower as Subcategory;
  return 'international';
}

/** Navigation-ready category list with i18n keys and slugs */
export const NAV_CATEGORIES = CATEGORIES.map(slug => ({
  slug,
  i18nKey: categoryI18nKey(slug),
}));
