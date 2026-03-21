

## Plan: Add Hugging Face API Key + Reliable Image Generation

### Step 1: Store Secret Securely

The Hugging Face API key (`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`) must be added as a **Supabase Edge Function secret** named `HUGGING_FACE_API_KEY`. You'll need to add it in:

**Supabase Dashboard → Settings → Edge Functions → Secrets**

I will guide you through this after the plan is approved.

### Step 2: Create `generate-cover-image` Edge Function

A new server-side function that:
1. Receives `{ title, excerpt, seed? }` from the frontend
2. Calls **Hugging Face Inference API** (`stabilityai/stable-diffusion-xl-base-1.0` or `black-forest-labs/FLUX.1-schnell`) with a constructed editorial prompt
3. Receives the binary image response
4. Uploads the image to the existing `blog-images` Supabase Storage bucket
5. Returns the **stable public Supabase URL** — no dependency on third-party hotlinking

This means images are stored permanently on your own infrastructure.

**Fallback chain**: Hugging Face → Pollinations (anonymous, best-effort) → return error with clear message

### Step 3: Update `BlogEditor.tsx`

Replace the current client-side `generatePollinationsUrl()` with an async call to the edge function:

- "Generate" and "Regenerate" buttons call `supabase.functions.invoke('generate-cover-image', ...)`
- Show loading spinner while the function runs (10-20 seconds typical)
- Show success only after a real stored URL is returned
- Manual upload still overrides everything

### Step 4: Update `process-rewrite-job` Edge Function

Replace the Pollinations URL construction with a call to the same `generate-cover-image` function. If image generation fails, the article rewrite still succeeds — image status is simply marked as missing.

### Files

| File | Change |
|------|--------|
| `supabase/functions/generate-cover-image/index.ts` | **New** — HF inference → Supabase Storage upload → return public URL |
| `src/pages/admin/BlogEditor.tsx` | Replace `generatePollinationsUrl` with edge function call, real loading state |
| `supabase/functions/process-rewrite-job/index.ts` | Call `generate-cover-image` instead of constructing Pollinations URL |

### Image Generation Flow

```text
Admin clicks "Generate"
  → Edge Function: generate-cover-image
    → Hugging Face API (stabilityai/SDXL or FLUX.1)
    → Binary image returned
    → Upload to Supabase Storage (blog-images bucket)
    → Return public URL
  → BlogEditor sets cover_image = stable Supabase URL
  → Preview loads immediately (image already exists)
```

### Why This Works

- **No hotlinking**: Images live in your own Supabase Storage
- **Instant preview**: The URL points to an already-uploaded file
- **Reliable**: HF Inference API with your own key = authenticated, rate-limited, stable
- **Zero ongoing cost**: HF free tier provides ~30k inference requests/month
- **Fallback**: If HF is down, falls back to Pollinations anonymous endpoint

