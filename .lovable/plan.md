
## Diagnosis

The failure is real and reproducible from the codebase analysis.

### Exact root cause
The generated image URL is using the wrong Pollinations endpoint in **two places**:

- `src/pages/admin/BlogEditor.tsx`
- `supabase/functions/process-rewrite-job/index.ts`

Current code builds URLs like:

```text
https://pollinations.ai/p/{prompt}?width=1200&height=630&model=flux&seed=...
```

But Pollinations’ current image API is exposed on endpoints like:

```text
https://image.pollinations.ai/prompt/{prompt}?width=1200&height=630&model=flux&seed=...
```

or the authenticated gateway variant on `gen.pollinations.ai`.

I also verified the current path pattern directly: `https://image.pollinations.ai/p/...` returns **Not Found**. That explains the “Failed to load” state in the editor.

## Secondary gaps I found

Even after fixing the URL, there are a couple of reliability issues:

1. **URL generation logic is duplicated**
   - one version in the frontend editor
   - one version in the edge function  
   This is risky because they can drift again.

2. **Preview state is not fully reset when the cover URL changes**
   - `coverError` / `coverLoading` are only controlled by button clicks and image events
   - when a cover comes from RSS or AI generation, the load state may not fully reflect the new image lifecycle

3. **No graceful fallback if Pollinations is temporarily slow**
   - the UI now shows an error, but the pipeline has no fallback image strategy if third-party generation is unavailable

## Feasibility

Yes — this is fully implementable and should work well while staying zero-cost.

Pollinations remains feasible for:
- automatic article cover generation
- regenerate-on-demand
- admin manual override

So the concept is valid. The failure is not conceptual; it is an implementation bug around the endpoint.

## Recommended implementation

### 1. Fix Pollinations URL generation everywhere
Update both generator call sites to the correct endpoint:

- `src/pages/admin/BlogEditor.tsx`
- `supabase/functions/process-rewrite-job/index.ts`

Use one consistent format:

```text
https://image.pollinations.ai/prompt/{encodedPrompt}?width=1200&height=630&model=flux&seed={seed}
```

### 2. Centralize the URL builder
Create a shared helper for:
- prompt construction
- prompt truncation/sanitization
- seed generation
- final URL formatting

Use the same logic in:
- Blog editor auto-generate
- RSS rewrite pipeline auto-generate
- regenerate action

This removes future mismatch risk.

### 3. Harden the BlogEditor preview lifecycle
In `BlogEditor.tsx`:
- reset `coverError` to `false` whenever `form.cover_image` changes
- set `coverLoading` to `true` whenever a new generated URL is assigned
- keep `onLoad` / `onError` handlers for visible state transitions

That makes:
- Generate
- Regenerate
- load-from-RSS
- load-from-AI  
all behave consistently.

### 4. Add resilient fallback behavior
If Pollinations fails:
- keep the URL visible
- show a clear message
- allow immediate regenerate
- preserve manual upload as the authoritative override

Optionally, if you want enterprise-grade resilience, we can later add:
- a local placeholder fallback
- optional second provider plug-in path (e.g. Hugging Face / Firecrawl-connected enrichment later)

### 5. Validate end-to-end flow
After the fix, verify these flows:

```text
AI article generation
→ auto-cover URL generated
→ preview loads in editor
→ save post
→ published article shows image

RSS rewrite job
→ process-rewrite-job assigns cover_image
→ open from_rss in BlogEditor
→ image preview loads
→ regenerate works
→ manual upload can replace it
```

## Files to update

| File | Change |
|------|--------|
| `src/pages/admin/BlogEditor.tsx` | Replace wrong Pollinations endpoint, reset image loading/error state on URL change, keep regenerate/manual override behavior |
| `supabase/functions/process-rewrite-job/index.ts` | Replace wrong Pollinations endpoint for auto-generated RSS cover images |
| Optional shared helper file | Centralize image prompt + URL generation logic so frontend/backend stay aligned |

## Bottom line

This is not a limitation of the zero-cost image strategy. The bug is that the current implementation points to the wrong Pollinations URL format. Once corrected, the feature is implementable and should work as intended. The right enterprise-grade fix is:

```text
correct endpoint
+ shared URL builder
+ reliable preview state handling
+ preserve regenerate/manual override
```
