

## Problem: Cover Image Not Visible

Two issues:

1. **Tiny thumbnail**: The preview is `w-8 h-8` (32×32px) — practically invisible even when loaded
2. **Pollinations loading delay**: Pollinations.ai generates images on first request (10-30 seconds). The tiny `<img>` may appear blank during generation with no loading feedback

### Fix (`src/pages/admin/BlogEditor.tsx`)

1. **Enlarge the preview**: Replace `w-8 h-8` with a proper card-sized preview (~`w-full h-48` or similar) below the buttons
2. **Add loading state**: Show a skeleton/spinner overlay while the image loads (`onLoad`/`onError` handlers)
3. **Show the URL**: Display the truncated cover URL as text so admin knows it's set even before the image renders
4. **Error fallback**: If image fails to load, show a retry message with the "Regenerate" button

### File to Modify

| File | Change |
|------|--------|
| `src/pages/admin/BlogEditor.tsx` | Replace tiny `w-8 h-8` thumbnail with a full-width preview card below the metadata row. Add `onLoad`/`onError` state for loading feedback. |

