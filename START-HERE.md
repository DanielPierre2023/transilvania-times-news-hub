# tt-kit-drift — v2 rendered, and the font guard caught its first real failure

## v2 is up, and it is better

Rendered from the version snapshot. QC:

```
✓ resolution matches the master — 1080×1920
✓ frame count is exact — 900, expected 900
✓ duration matches the timeline — 30.00s
✓ loudness within 1 LU of -16 LUFS — -15.8 LUFS
✓ true peak under -1 dBFS — -1.8 dBFS
✕ every typeface the film asks for exists here
    missing: Playfair Display 700 — rendered in the fallback face
```

Subtitles went from **five** cues over the reading-speed limit to **one**, and
that one sits exactly on 17.0. The bed is under the voice. The end card now
holds together as one block instead of leaving a hole through the middle.

And the typeface is still wrong — which is the interesting part, because
**nothing told us that before today; the check I shipped this morning did.**

## Why it was still wrong

The migration that created the kit library seeded the house kit by copying every
value out of `lib/brand/kit.ts` into a `jsonb_build_object`: the display face,
the type scale, the grade, the loudness.

Four hours later the code changed — the display face moved to one the renderer
actually has, and the weight from 700 to 400 because the free bold has no
Romanian diacritics. **The SQL row did not move, because nothing tells it to.**
The row is loaded over the code defaults, so the stale value won, and the film
came back set in the fallback face.

Two copies of the same truth, four hours apart. That is not a bug in either
copy; it is a bug in having two.

## The fix

**The kit row holds overrides, not a copy.** `resolveKit()` already fills every
absent field from the house default, so an empty object means "whatever the code
says today". A row now stores only what somebody deliberately changed, and the
code is the single source of truth for the rest. There is nothing left to drift.

The migration sets the seeded row to `{}` — and only that row: it is guarded so
a kit anyone has hand-edited is left alone.

**A saved project is a different question, and I did not touch it.** A project
carries a *full frozen copy* of the kit, on purpose: an approved film must
render next year exactly as it was approved. Silently rewriting that is exactly
what the frozen copy exists to prevent. So Studio gains a **reîncarcă** button
beside the kit instead — adopting the current brand is now something a person
does deliberately, once, on a project that is still being edited.

## Deploy

**1 · SQL**

```
supabase/migrations/20260830160000_studio_brand_kit_inherit.sql
```

**2 · Repo**

```
app/admin/studio/page.tsx     the reîncarcă control
```

## Then, for v3

Open the project → press **reîncarcă** next to the kit → submit v3 → render.
That render should come back with the typeface line green, and the end card set
in EB Garamond for the first time.

## Verification

`_verification/14-brand.cjs` → 45 assertions, five of them new and all about
this failure:

- an empty kit row resolves to a complete, current kit
- it follows the code, so it cannot go stale
- a row that *does* override something keeps that override
- while inheriting everything it does not mention
- **a frozen project kit keeps its old face rather than being silently updated**
  — the behaviour that is correct and was mistaken for the bug

---

*Unrelated, but you should know:* while loading the Studio just now the site
served Netlify's **“This edge function has crashed — edge function invocation
failed”** page once, then recovered on reload and has been fine since. That
smells like a cold start during the deploy swap rather than a fault in the code,
but it was the live site, so it is worth a look at the edge-function logs if it
happens again.
