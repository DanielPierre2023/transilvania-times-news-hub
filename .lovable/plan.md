

## Plan: Auto-Generate Cover Images via Pollinations.ai

### What Changes

**1. RSS Pipeline (`process-rewrite-job/index.ts`)**

After the quality gate saves the rewritten article, auto-generate a Pollinations.ai cover image URL from the English title + excerpt and save it to `scraped_articles`. Every rewritten article gets a cover image automatically — zero cost, zero delay.

Add after the `scraped_articles.update()` block:
```typescript
const seed = Math.floor(Math.random() * 100000);
const imgSubject = `${parsed.title_en} ${parsed.excerpt_en || ''}`.substring(0, 120);
const imgPrompt = `Professional news photography, high-detail, editorial style, regarding: ${imgSubject}`;
const coverUrl = `https://pollinations.ai/p/${encodeURIComponent(imgPrompt)}?width=1200&height=630&model=flux&seed=${seed}`;
```

This URL is saved alongside the other fields in the `scraped_articles` update. Note: `scraped_articles` doesn't have a `cover_image` column yet — we need a migration.

**2. BlogEditor (`BlogEditor.tsx`)**

- Add a `generateCoverImage()` function that builds a Pollinations URL from `form.title_en` + `form.excerpt_en`
- Add **"✨ Generate Cover"** button next to "Upload Cover"
- Add **"🔄 Regenerate"** button (visible when cover already exists) — generates a new image with a different seed
- Auto-generate cover when AI article generation completes (after `ai-generate-article` returns)
- Auto-generate cover when loading from RSS (`from_rss`) if no cover exists yet
- Admin can always overwrite with manual upload or regenerate

**3. Database Migration**

Add `cover_image text` column to `scraped_articles` table so the pipeline can store the generated URL.

### Files to Modify

| File | Change |
|------|--------|
| **Migration** | Add `cover_image text` to `scraped_articles` |
| `supabase/functions/process-rewrite-job/index.ts` | Auto-generate Pollinations URL after rewrite, save to `cover_image` |
| `src/pages/admin/BlogEditor.tsx` | Add "Generate Cover" + "Regenerate" buttons. Auto-generate on AI creation and RSS load. |

### UI Layout (BlogEditor cover section)

```text
Current:  [Upload Cover] [thumbnail]
After:    [Upload Cover] [✨ Generate] [🔄 Regenerate] [thumbnail]
```

- "Generate" visible when no cover exists
- "Regenerate" visible when cover already exists (new random seed = new image)
- Manual upload always overrides the generated image
- Thumbnail preview updates instantly

### Auto-Generation Triggers

1. **RSS pipeline**: Every rewritten article gets a cover automatically
2. **AI article generation**: After `ai-generate-article` returns, auto-set cover
3. **RSS load in editor**: When opening `from_rss`, if cover is empty, auto-generate
4. **Manual**: Admin clicks "Generate" or "Regenerate" anytime

