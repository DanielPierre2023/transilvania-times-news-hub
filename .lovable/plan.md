

## Diagnosis

The edge function is **working perfectly** — logs confirm images are generated via Hugging Face and stored in Supabase Storage successfully. The problem is the `toPublicMediaUrl()` function.

### Root Cause

`toPublicMediaUrl()` rewrites Supabase Storage URLs like:
```
https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/blog-images/covers/123.jpg
```
to:
```
/media/blog-images/covers/123.jpg
```

This `/media/*` path only works on **Netlify** (via the `_redirects` proxy rule). In the **Lovable preview** environment and any other non-Netlify context, the `/media/` path returns a 404, causing the "Failed to load" error.

### Fix

Update `src/lib/mediaUrl.ts` to only rewrite URLs when running on the production domain (transilvaniatimes.com). In development/preview, keep the original Supabase URL so images load directly.

```typescript
const SUPABASE_STORAGE_PREFIX = 'https://zimpimoierpsocnmnizm.supabase.co/storage/v1/object/public/';
const PRODUCTION_HOST = 'transilvaniatimes.com';

export function toPublicMediaUrl(url: string): string {
  if (!url) return url;
  if (!url.startsWith(SUPABASE_STORAGE_PREFIX)) return url;
  
  // Only rewrite on production (where Netlify proxy handles /media/*)
  if (typeof window !== 'undefined' && window.location.hostname !== PRODUCTION_HOST) {
    return url; // Keep original Supabase URL in dev/preview
  }
  
  return '/media/' + url.slice(SUPABASE_STORAGE_PREFIX.length);
}
```

### File to Modify

| File | Change |
|------|--------|
| `src/lib/mediaUrl.ts` | Add hostname check — only rewrite on production domain |

This is a one-line logic addition. Images will load correctly in both preview and production environments.

