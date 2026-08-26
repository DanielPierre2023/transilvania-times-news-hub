# Studio AI upgrade — voice cloning (no ElevenLabs) + identity-preserving images

Enterprise fix for the two Studio/Newsroom problems, verified: `deno check` clean on
all four functions, `tsc` 0 errors and `eslint` 0 errors on both pages.

## What was broken (root causes, verified in the deployed source)

1. **"My cloned voice appears nowhere."** `voice-lab.clone` created the voice on
   ElevenLabs and persisted **nothing** in your own DB; the Studio/Newsroom voice
   lists read live from ElevenLabs `/v2/voices`. Your live account shows 25 voices,
   **all stock/library, zero clones** — the clone is not in the account the key
   belongs to, and the app had no independent record of it. Instant Voice Cloning
   also needs a paid ElevenLabs plan.

2. **"Uploaded a picture + prompt → highly inaccurate."** Nothing in the stack did
   image-to-image. Studio `genImage` sent only `{raw_prompt, aspect}` to
   `generate-cover-image` (gpt-image-1 `/v1/images/generations` — text-only); the
   uploaded photo was stored as a separate scene and never seen by the model. The
   Newsroom photo anchor used SadTalker, which warps the face.

## What this delivers

- **Subscription-free voice cloning** via `fal-ai/minimax/voice-clone` (RO-native,
  pay-per-use on your existing `FAL_KEY`, no ElevenLabs). Both engines kept equal.
- **`studio_voices` table** = the source of truth. Every clone (fal **and**
  ElevenLabs) is persisted, so a voice can never "disappear" again — the list reads
  your DB first, independent of any provider listing.
- **Identity-preserving image generation** via `generate-image-edit` (gpt-image-1
  `/v1/images/edits`, conditions on your uploaded photo). Studio gets a "Referință
  foto" control; with a reference attached, "Generează imagine" edits *that* photo.
- **Accurate photo anchor**: Newsroom photo-only anchors now default to Kling
  ai-avatar (audio-driven, preserves identity) instead of face-warping SadTalker.

## Files

```
supabase/migrations/20260826120000_studio_voices.sql   (new)
supabase/functions/voice-lab/index.ts                  (rewritten: fal clone + DB + provider list)
supabase/functions/generate-voiceover/index.ts         (MiniMax cloned-voice routing, no silent swap)
supabase/functions/generate-image-edit/index.ts        (new: gpt-image-1 image-to-image)
supabase/functions/newsroom-anchor/index.ts            (photo anchor default: avatar, not sadtalker)
app/admin/studio/page.tsx                              (voice merge, dual-engine clone, ref-photo gen)
app/admin/newsroom/page.tsx                            (MiniMax voice routing, avatar engine)
```

## Deploy order (you deploy & commit — nothing was pushed)

1. **Run the migration** (creates `studio_voices`, RLS on, service-role-only):
   `supabase/migrations/20260826120000_studio_voices.sql`

2. **Deploy the edge functions** (all use `FAL_KEY` / `OPENAI_API_KEY` /
   `SERVICE_ROLE`, already set — no new secrets):
   ```
   supabase functions deploy voice-lab
   supabase functions deploy generate-voiceover
   supabase functions deploy generate-image-edit
   supabase functions deploy newsroom-anchor
   ```
   Keep the current JWT setting: these are `verify_jwt: true` today, deploy the same.

3. **Commit the two frontend files** and let Netlify build:
   `app/admin/studio/page.tsx`, `app/admin/newsroom/page.tsx`

## How to use

- **Clone your voice (no subscription):** Studio → Voce → *Vocile mele · clonează
  vocea ta* → engine **fal · fără abonament** → name + person + consent + one clean
  sample ≥10s → *Clonează vocea (fal)*. It appears in the picker as `👤 … · fal`,
  is retained on fal, and is saved in `studio_voices`. Selecting it routes TTS
  through MiniMax with `language_boost: Romanian`.
- **Accurate image from a photo:** Studio → *Referință foto* (upload) → write a
  prompt describing the change → *Generează imagine*. Output conditions on your
  photo. Without a reference it stays text-to-image as before.

## Notes / honest caveats

- MiniMax voice-clone retains a voice only if it is used with a TTS call within 7
  days — `clone_fal` speaks one line immediately to lock it in.
- Kling ai-avatar (~$3.37/min) costs more than SadTalker but is the accuracy fix;
  `engine:'sadtalker'` is still reachable explicitly as the budget path.
- One pre-existing `deno check` type-looseness in `newsroom-anchor` (`parseSections`)
  was tightened (behaviour-neutral) so the delivered file checks clean.
- The `<img>` ESLint *warning* on the new reference thumbnail matches the existing
  `<img>` usage in these admin pages and does not block the build.
