# tt-brand — the brand kit, the titles, and a bug worth the whole session

Phase 1 of the plan, minus the legal phase you struck out. Plus one thing I
found while checking my own work that changes how you should read every film
this tool has ever produced.

---

## READ THIS FIRST — red and blue were swapped in every render

The worker draws frames on a canvas and pipes raw pixels to ffmpeg. node-canvas
hands back Cairo's native ARGB32, which on a little-endian machine is **B, G, R,
A** in memory. The pipe told ffmpeg `rgba`.

Measured, before and after, on a `#CA2222` rectangle:

| | R | G | B |
|---|---|---|---|
| what it should be | 202 | 34 | 34 |
| what came out | **33** | 33 | **202** |
| after the fix | 201 | 31 | 32 |

Every frame of every render. The browser preview never had it — that draws
straight to a visible canvas — so **the preview looked right and the file did
not**, which is the worst shape a bug can take.

This is the real reason a warm golden-hour still arrived on screen cold and
blue. When I measured the delivered film and found B−R of +60, +39 and +49
across its shots, I read that as the generation model drifting and built a
negative prompt and a shot-matching grade to fight it. The model was fine. It
was one word in one ffmpeg argument, and I had been measuring my own bug.

The fix is `bgra`. `_verification/15-colour.cjs` renders four real swatches
through the real encoder and asserts both that they land on the right colour
*and* that they are not the red/blue swap, so this cannot come back quietly.

**Re-render anything you still care about.** Every existing master is wrong.

---

## What the film can now contain

Until today a Studio film had exactly one piece of typography in it: the
subtitle. There was no title card, no name under a face, no end card — not
because they were unimplemented but because there was nowhere to express them.

### The kit

One object answers, once and for every film: which red, which two faces, the
type scale, the house grade, the delivery loudness, and **where type is allowed
to sit**. It lives in `studio_brand_kits` so it can be edited without a deploy,
and a **copy travels with each project** — a film approved in March must still
render in March's brand in September, and it would not if it read a row somebody
has since edited. Same reasoning as the immutable version snapshots.

### Safe areas

A caption pinned at 88% of frame height sits underneath TikTok's own caption
block: present in the file, invisible to the viewer. Caption position is now
clamped into the safe box, and the preview draws the guide. Broadcast is the
EBU-style 5% inset; the social figures are house defaults measured off the apps'
own overlays, which is exactly why they are editable rather than hard-coded.

### Three templates

`Titlu`, `Nume (burtieră)`, `Card final` — see the two sample frames in this
folder, straight out of the encoder.

They are **not** a new thing the renderer understands. Each is a function that
returns ordinary clips: rectangles and text, with keyframes. That choice is the
whole design — the preview and the render already draw rectangles and text, so a
title card previews exactly as it renders with no second implementation; every
element stays selectable and trimmable afterwards, because it is a real clip;
and "nudge that up twenty pixels" is possible, which is the note that arrives on
every job.

Stored as **intent** — kind, when, how long, what it says — and expanded at build
time, so improving a template improves every project that already uses one.

### One drawing implementation

The worker had its own `draw.js` and the Studio preview had its own canvas code,
agreeing only by luck. Letter-spaced kickers, three-line titles and rules with a
real thickness would have had to be written twice. `lib/timeline/draw.ts` is now
the single implementation, compiled into the worker's `dist/timeline` alongside
the rest of the module. `compile.ts` was always described as "the seam that
makes the renderer replaceable"; this is the other half of it.

Two capabilities came with it that the old code could not do at all:
**letter spacing** (done by hand, because node-canvas has no `ctx.letterSpacing`
and Chrome does — doing it manually means a kicker is tracked identically in the
preview and in the file) and **shapes with a size**, without which a rule under a
title could only ever be a full frame scaled uniformly.

---

## Deploy, in this order

**1 · SQL** — Supabase SQL editor:

```
supabase/migrations/20260830120000_studio_brand_kits.sql
```

Idempotent. Creates the kit library, adds two columns to `studio_projects`, and
seeds the Transilvania Times kit as the default.

**2 · Repo** — commit and push; Netlify and Railway both build from it.

```
lib/brand/kit.ts                 (new)  the kit, safe areas, caption rules
lib/brand/templates.ts           (new)  title card, lower third, end card
lib/timeline/draw.ts             (new)  the one drawing implementation
lib/timeline/types.ts                   letterSpacing, maxLines, shadow, shape size
lib/timeline/compile.ts                 sized shapes
lib/timeline/index.ts                   exports draw
render-worker/src/render.js             ★ the bgra fix
render-worker/src/draw.js               now delegates to the shared module
app/admin/studio/page.tsx               the Brand și titluri panel
```

**3 · Check** — Studio gains a **Brand și titluri** panel above the timeline:
kit, accent colour, safe area, guide toggle, mix target, and three buttons. Add
a title, scrub the preview: what you see is what the file gets, through the same
compile-and-draw path.

---

## Verification

**377 assertions, all passing.** New this round:

```
node _verification/14-brand.cjs    38   the templates, checked by DRAWING them
                                        and reading the pixels back — including
                                        that a rule grows from its left edge
                                        rather than stretching from its centre
node _verification/15-colour.cjs   10   four swatches through the real encoder
node _verification/13-resample.cjs  8   now also asserts the worker delegates
                                        rather than keeping a second copy
```

`tsc --noEmit` → 0 errors. `eslint app lib` → 0 errors, 41 warnings (unchanged
baseline).

---

## Known, and next

**The grade currently applies to the graphics as well as the picture.** Look at
the sample title card: the type is warm cream rather than white, because the
house look is applied over the whole composite after the fact. Broadcast
practice is to grade the picture and lay graphics on top ungraded, or your brand
red is not your brand red. Fixing it properly means rendering the graphics as a
separate pass with alpha and compositing after the grade — about forty lines in
the worker, and the first thing in the next drop rather than a rushed change at
the end of this one.

Then the rest of phase 1: the approval screen over the versions table that
already exists in the database, and the sound-design layer.
