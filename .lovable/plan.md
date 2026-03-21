

## Plan: Fix Romanian SEO Tags + AI Image Caption

### Issue 1: SEO Tags Use Wrong Fields for Romanian

**Current** (line 89-92 in `BlogPost.tsx`): The SEO meta `title` uses `post.title_ro` but ignores `seo_title_ro`. The `summary` does check `seo_description_ro` but falls back to English `seo_description_en` before Romanian `summary_ro`.

**Fix**: Update the SEO `useEffect` to use proper Romanian SEO fields:
```
title = isRo 
  ? (post.seo_title_ro || post.title_ro || post.title_en) 
  : (post.seo_title_en || post.title_en)

description = isRo
  ? (post.seo_description_ro || post.summary_ro || post.excerpt_ro || post.summary_en)
  : (post.seo_description_en || post.summary_en || post.excerpt_en)
```

Also update `document.title` to use the SEO-optimized title.

### Issue 2: AI Image Caption

**Current** (line 263-265): The cover image has no caption.

**Fix**: Add a `<figcaption>` below the image with bilingual text:
- Romanian: "Imagine generată cu AI de redacție"
- English: "Image generated with AI by the editorial team"

Wrap the image + caption in a `<figure>` tag.

### Files

| File | Change |
|------|--------|
| `src/pages/BlogPost.tsx` | Fix SEO title/description to prefer `seo_title_ro`/`seo_description_ro` when in RO. Wrap cover image in `<figure>` with AI caption `<figcaption>`. |

