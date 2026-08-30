# tt-wordmark — why the label came back, and why it was never in the film

## The answer

It is painted by the Studio's **preview** function, and it was never part of the
timeline.

```
app/admin/studio/page.tsx  ·  drawFrame(ctx, t)
    ctx.fillText(kit.name, wm.x * W, (wm.y + 0.03) * H)
    ctx.fillRect(...)                      // the crimson rule under it
```

That one function feeds two things: the live preview, and the **browser
recorder**. It does not feed the worker. So:

| where | wordmark |
|---|---|
| Studio preview | **yes** |
| “Randează clipul” (browser recording) | **yes, baked into the file** |
| worker render — the cloud button, and a version’s Randează | **no** |

I checked the delivered spot before answering: sampled the top-left of v1 at 1s,
8s and 15s. Clean picture, no mark. **The film you have does not contain it.**

It has been in that function since long before this month — the original was a
hard-coded `'Transilvania Times'` at 5% / 7% of the frame. In tt-brand I changed
it to read the name and the accent from the kit and left it in place, with a
comment saying "from the kit, so changing the kit changes the film." That comment
was wrong. It changed the preview. The film is drawn by the worker, which had
never heard of it.

So this is the same defect as the red/blue channel swap: the preview and the
render disagreeing about what the film is. That one made the file wrong. This one
makes the *preview* wrong — and makes the browser render disagree with the cloud
render, which is worse, because both are called "render".

## The fix

A standing masthead is a legitimate broadcast device, so it is kept — but as a
real thing rather than a painted one:

- **`kit.wordmark`**: `none` · `topLeft` · `bottomLeft`, in the kit, in the
  **Brand și titluri** panel under **siglă**.
- **Off by default**, including for the house kit. A client's spot should not
  carry a watermark nobody asked for, and the film you already have does not.
- When it is on, `lib/brand/templates.ts` emits it as **ordinary clips** — a text
  and a rule on the graphics track, spanning the film — so the preview and the
  file cannot disagree about it, it can be nudged like anything else, and it is
  excluded from the grade along with the rest of the type.
- The paint call is deleted.

## Deploy

Repo only, three files, no SQL.

```
lib/brand/kit.ts             the wordmark setting, defaulting to none
lib/brand/templates.ts       wordmark() → clips
app/admin/studio/page.tsx    the paint call removed, the control added
```

## Verification

`_verification/19-wordmark.cjs` → 11 assertions, and they check the fix from both
ends, because half a fix here is invisible:

- the preview no longer paints the name onto the canvas at all — asserted
  against the source with comments stripped, so a commented-out line cannot pass
- the house kit is off, and an old kit row with no such field resolves to off
- with it **on**, a real film is rendered and the pixels are read: the mark is
  present in the top-left of the **file**, and absent from the opposite corner
- with it **off**, the same corner of the same film is clean

432 → 443 assertions. `tsc` 0 errors, `eslint` 0 errors.
