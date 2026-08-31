# tt-grade — the last divergence, closed

The audit named one thing still open in the preview-versus-renderer class:

> The worker applies a per-shot adaptive grade computed from each shot's
> measured mean; the preview does not. Faking it with a canvas filter would
> create a new divergence, so it is left honest.

It is no longer left. It is done properly, and it is the most visible of all the
divergences that have been fixed: **every film anyone watched was ungraded and
every file delivered was graded** — a colour difference on every frame of every
shot.

## Why it could not run in the browser before

The maths lived in `render-worker/src/grade.js`: CommonJS, next to ffmpeg
spawns, requiring node-canvas. It has moved to **`lib/timeline/grade.ts`**, and
the worker requires it back — the same pattern as the timeline module itself.
The worker's copies of `LOOKS`, `planGains`, `lutExpr`, `residual`,
`normaliseLook` and its own sRGB conversion are deleted.

## Why the browser reproduces it exactly rather than approximating it

`lutExpr` is: sRGB → linear → multiply by gain → clip → sRGB.

An SVG filter declared `color-interpolation-filters="linearRGB"` does the
sRGB↔linear conversion itself, and `<feFuncR type="linear" slope="g">` is the
multiply. Same three steps, same three gains. A CSS `filter: brightness()` would
have been the approximation — it works in sRGB and cannot express a per-channel
gain in linear light — and an approximation here would have been a new
divergence wearing the clothes of a fix.

**And the preview draws in two passes when a grade is active, because that is
what the renderer does.** The worker splits the layers so the grade lands on the
picture and not on the type; a graded caption is a caption in the wrong colour.
Reproducing the grade and breaking the titles would not have been parity.

## Verified against the real encoder, not against itself

The first version of this suite evaluated the ffmpeg expression with a
hand-rolled string rewrite. **It threw, and eighteen assertions were skipped
inside an `if` — the suite passed by not running.** That is the failure mode I
keep warning about, in my own test.

It now runs the actual encoder: an exact PNG in, `lutrgb` over it, the pixel read
back and compared with the arithmetic the browser applies.

```
rgb(128,96,160) · gains 0.94235 / 1.00593 / 1.19292
  ffmpeg   124, 96, 173
  browser  125, 96, 173      within one level
```

One level is ffmpeg's 256-entry integer table rounding, and the tolerance says
so. Four colour and gain combinations, including a near-black and a near-white.

## One more thing the suite caught

`residual` is exported from the shared index as `gradeResidual`, so the worker's
`require` destructured `undefined` and `gradeFilm` broke. My own assertion for
this was `'residual' in worker`, which **passes for a key whose value is
undefined** — the exact shape of a mis-spelled re-export. It slipped through and
was caught one suite later by `16-layers`. The assertion is now
`typeof worker[k] === 'function'`, for all six.

## Also in this drop

Dead code the earlier work left behind, removed rather than left to mislead:
`MOTION_NEGATIVE` (the combined list, dead since it was split per shot),
`wrap()` (the caption painter that used it is gone), and a redundant `gradeTick`
that duplicated `mediaTick`.

## Deploy

```
app/admin/studio/page.tsx
lib/timeline/grade.ts            ← new
lib/timeline/index.ts
render-worker/src/grade.js       ← needs a worker redeploy
_verification/*
```

No SQL. **The worker redeploy is not optional this time** — `grade.js` now
requires the shared module, so the worker must be rebuilt to have it.

## Verification

`30-grade-parity.cjs` → **44 assertions.** Full suite **494 assertions, 21
suites, 0 failures**, plus the end-to-end encode at 16/16, −15.2 LUFS.
`tsc` 0 errors, `eslint` 0 errors.

## What is left

The preview/renderer divergence class is now **empty**. What remains on the
audit is tenancy, seats, a public API and metering — a different project — and
the four notes on the film itself.

## After deploying

Open the project and scrub. The picture should now carry the kit's warm look,
and the captions and the end card should **not** — that split is the part worth
looking at, because getting it wrong is the obvious way to implement this.
