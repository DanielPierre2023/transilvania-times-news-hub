# tt-camera — "they are too static" had a cause in the code

Supersedes **tt-captions**; if that zip is still unopened, this one contains it.

## The finding

Three of your five shots measure 0.51, 0.48 and 0.37 %/s. You called them
static. They are — and it was not the model's fault. `lib/timeline/migrate.ts`
read:

```ts
transform: scene.kind === 'image' ? kenBurns(scene.kb, duration) : IDENTITY_TRANSFORM,
```

**A camera move was only ever given to a scene of kind `image`.** Every shot in
this film is kind `video`. So no generated clip has ever had a camera move, in
any film, whatever was selected — and a film made entirely of generated clips
could not be anything but locked off.

The control was hidden too. In `page.tsx` the *static / zoom in / zoom out /
pan ← / pan →* select sat inside a `{sc.kind === 'image' && …}` branch, so it
was never even drawn beside a clip. You were not missing it. It was not there.

## And two more, found while fixing that

**The pan showed black.** A pan draws the picture oversized and slides it. The
spare picture each side is `(scale − 1) / 2`. The values were scale **1.08** —
overscan 0.04 — with a slide of **±0.06**. The slide is bigger than the
overscan, so at each end of the move the frame ran out of picture. Measured
through the real `fitRect`: **21.6 px of black down one edge** on a 1080-wide
master, at the start and again at the end, on every panning scene ever
rendered. It is now ±0.04 against scale 1.10, leaving 10.8 px in hand.

**The preview had its own camera, and it disagreed three ways at once.**

| | preview | renderer |
|---|---|---|
| static | scale **1.02** | scale **1.00** |
| zoom in | 1.02 → 1.12 | 1.00 → 1.12 |
| pan | ±0.06 at 1.10 → 10.8 px black | ±0.06 at 1.08 → 21.6 px black |

Every static shot you have ever previewed was framed 2% tighter than the one
delivered. The preview now evaluates the **same keyframe curves** and lays out
with the **same `fitRect`**, so there is no second camera left to drift.

## What you get

- a camera move can be given to **any** shot, clip or still
- the control is visible on every scene card, and lights amber when set
- **mișcare pe toate** in the timeline header puts a move on every shot that
  has none, cycling *zoom in → pan ← → zoom out → pan →* so four shots in a row
  do not drift the same way. Shots you have already set are left alone.
- **toate static** undoes it, and a counter reads `n din 5 static`
- the pan no longer bleeds
- preview and render use one camera

It costs nothing in sharpness, which is the part worth knowing: the sources are
2160×3840 into a 1080×1920 master, so even at the pan's 1.10 overscan the draw
is still a **1.85:1 reduction**. Nothing is being enlarged.

## One honest limit

The `mișcare %/s` figure on each take will **not** change. That number measures
the clip the model returned, before the timeline touches it — and the module's
own calibration says a zoom reads as `move 0.00`, because it aligns out scale
by design. A keyframed pan is real translation and would register, but the
figure you see is the *source's*, not the film's. The shots will stop being
static; the take badges will keep reporting what the model gave you. That is
the right behaviour — it is a diagnostic for dead generations, not a score for
the edit.

## Deploy

Six files, no SQL. Includes the caption-parity work from tt-captions.

```
app/admin/studio/page.tsx
lib/timeline/migrate.ts
lib/timeline/index.ts
lib/timeline/draw.ts
lib/timeline/compile.ts
lib/timeline/types.ts
```

The worker needs no separate change — its Dockerfile compiles `lib/timeline`
from the repo at build time. Redeploy it to pick this up.

## Verification

`_verification/23-motion.cjs` → **26 assertions, all passing.**

- a video scene with each of the four moves carries a move, and it is byte-for-byte the move a still gets
- `none` is still genuinely identity
- every frame of every move is walked through the real `fitRect`: **zero** pixels of frame showing, on all four moves
- the old values are re-run and confirmed to bleed by exactly the 21.6 px claimed, so this test would have caught it
- overscan is proved greater than throw
- a pan measures over 1 %/s — more than twice the 0.35 floor
- the preview's own painter, its 1.02 baseline and its 0.12 pan are gone; it calls `kenBurns` and `fitRect`
- the move control is no longer inside the image-only branch
- **mișcare pe toate** exists and skips shots that already move

Full suite after the change:

```
10-vision 35/35   14-brand  45/45   18-fonts    15/15   22-captions 18/18
11-payload 35/35  15-colour 10/10   19-wordmark 11/11   23-motion   26/26
12-inspect 30/30  16-layers 11/11   20-reading  17/17
13-resample 8/8   17-sound  25/25   21-browser  23/23
```

`tsc` 0 errors, `eslint app lib` 0 errors.
