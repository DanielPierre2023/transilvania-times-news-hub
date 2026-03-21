

## Plan: Hide Supabase URLs on Frontend Display Layer

### Problem
Generated cover images stored in Supabase Storage expose the project URL (`zimpimoierpsocnmnizm.supabase.co`) publicly in `<img>` tags, page source, and SEO metadata.

### Solution
Create a simple utility function that rewrites Supabase Storage URLs to use a Netlify proxy path. The actual storage stays in Supabase — we just mask the URL on the frontend.

### 1. Add Netlify Proxy Rule (`public/_redirects`)

```text
/media/*  https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/:splat  200
```

This makes `https://transilvaniatimes.com/media/blog-images/covers/123.jpg` proxy transparently to Supabase Storage. The `200` status means it's a rewrite (proxy), not a redirect — the browser never sees the Supabase URL.

### 2. Create URL Rewriter Utility (`src/lib/mediaUrl.ts`)

```typescript
export function toPublicMediaUrl(supabaseUrl: string): string {
  if (!supabaseUrl) return supabaseUrl;
  const storagePrefix = 'https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/';
  if (supabaseUrl.startsWith(storagePrefix)) {
    return '/media/' + supabaseUrl.slice(storagePrefix.length);
  }
  return supabaseUrl;
}
```

### 3. Apply in Frontend Components

Use `toPublicMediaUrl()` wherever cover images are rendered:
- `BlogEditor.tsx` (preview thumbnail)
- `ArticleCard.tsx` (blog listing)
- `BlogPost.tsx` / `Article.tsx` (article detail page)
- `ArticleSEO.tsx` (og:image meta tag)

The edge functions (`generate-cover-image`, `process-rewrite-job`) continue storing the raw Supabase URL in the database — no backend changes needed.

### Files

| File | Change |
|------|--------|
| `public/_redirects` | Add `/media/*` proxy to Supabase Storage |
| `src/lib/mediaUrl.ts` | **New** — URL rewriter utility |
| `src/pages/admin/BlogEditor.tsx` | Wrap cover preview with `toPublicMediaUrl()` |
| `src/components/ArticleCard.tsx` | Wrap image src |
| `src/pages/BlogPost.tsx` | Wrap image src |
| `src/pages/Article.tsx` | Wrap image src |
| `src/components/ArticleSEO.tsx` | Wrap og:image URL |

### Result
- Database stores: `https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/blog-images/covers/123.jpg`
- Browser sees: `https://transilvaniatimes.com/media/blog-images/covers/123.jpg`
- Supabase project ID never appears in page source, network tab, or SEO metadata

