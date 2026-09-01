# tt-forge — the four, the authoring surface, and the four craft gaps

All four things from the HeyGen read, the one you asked about, and the four
things you asked for before committing: **animated graphics, transitions, music
that hits the cut, per-shot colour.**

**Nothing to delete. Copy the folder over the repo and commit. No SQL.**

**818 assertions, 31 suites, 0 failures**, 73s — run against a tree built from
your live `main` (`120ed48`) with this zip copied on top, not against my own
working copy. `npx next build` on that same tree: **compiled successfully**,
`/admin/studio` builds at 59.3 kB. An end-to-end render ran: 250 frames at
25 fps, 1920×1080, delivered at −15.2 LUFS.

> **Read section 2 first.** The HTML feature in the first cut of this zip did not
> work, I found out by running it in your browser, and it is rebuilt below.
> **Sections 8–11 are the four new ones.**

---

## 1 · The words are data now

`lib/prompts/library.ts`. The motion prompt, three negative lists and the house
style were TypeScript consts inside a three-thousand-line component. Which is why
the day a negative list was found telling a deliberately blue pre-dawn shot that
blue hour and a cold cast were *defects*, the fix was a code change, a build and
a deploy — for what is, in the end, copy. Nobody in marketing can edit a const.

- A **PROMPTURI** panel: every part editable, each with a note explaining what it
  is for and why it says what it says.
- Overrides travel **with the project**, like the kit — a film approved in March
  must still generate from March's direction language.
- Parts you *don't* override stay bound to the library and improve with it.
- The house style ("middle third, empty lower fifth for captions, no invented
  lettering") is now appended from one place instead of retyped into every
  prompt and quietly lost on a tired evening. Toggle: **stil casă**.

`31-prompts.cjs` — 37 assertions, including the one that matters:
**a cold shot is never told blue hour is a defect.**

## 2 · HTML compositions — the authoring surface

`lib/timeline/html.ts` and a **COMPOZIȚIE HTML** panel. Write HTML and CSS, watch
it render, put it on the timeline.

**The design decision worth reading, and the correction.**

The plan was to rasterise in the page through an SVG `foreignObject`: the browser
lays out real CSS, hands back pixels, and no Chrome is needed in the worker. I
shipped that in the first cut of this zip. **It does not work**, and I found out
by running the shipped code in your Chrome rather than by trusting 33 green
assertions:

```
plain <svg><rect/><text/>      drawImage → getImageData → 24000 px, toBlob ok
the same svg + foreignObject   drawImage ok, getImageData → SecurityError
```

Chrome **taints a canvas** the moment an SVG carrying a `foreignObject` is drawn
on it. A composition can be *displayed* and never *read back* — which kills
`toBlob`, which kills rasterisation. No Node test could have found it: Node has
no such rule and no `foreignObject` at all.

So Chrome does the layout **in the worker** — a `POST /raster` route, one browser
reused, a fresh context per composition. The property that mattered is untouched:
neither the preview nor the renderer lays out HTML at draw time, and both draw
the same PNG. There is still exactly one engine deciding what a composition looks
like; it simply lives on the other side of the wire. The editor preview is an
`<img>` of the same markup — display, which is allowed.

**Nothing loads from the network during layout.** A composition that fetches
makes the render depend on when it ran, and lets markup drive requests from a
server. Blocked at the route level, and the editor's linter says so first.

- Anything CSS can express: gradient meshes, `mix-blend-mode`, backdrop filters,
  masks, layered SVG, a lower third that reflows around a long name.
- Rasterised at **2× master**, so a push has somewhere to go.
- A **linter that refuses what `foreignObject` cannot do** before you spend a
  render on it: remote URLs (an SVG loaded as an image has no network — it looks
  perfect while you edit and returns blank in the film), `@import`, unclosed
  `<br>`, bare `&`. Script is a warning, not an error: it simply will not run.
- A **stamp** on the markup, so editing a block without re-rasterising is caught
  and said out loud rather than silently shipping the old bitmap.
- An unrasterised block **stops the render** instead of leaving a hole where the
  lower third was.

**The honest limit:** the block does not animate by itself. Motion comes from the
timeline, like every other clip. Per-frame HTML would need Chrome in the worker;
the source keeps its markup so that door stays open.

`32-html-composition.cjs` — **45 assertions**, and they are not pattern matches:
Chrome is launched, the shipped sample composition is laid out, and the pixels
counted. **72 distinct red tones** in the gradient — the thing node-canvas
cannot draw and the whole reason the feature exists. Plus: the corner is
transparent, the same markup rasterises byte-identically twice (or a golden frame
containing a composition could never be stable), an absurd size is refused, and a
remote `<img>` is blocked while the rest of the block still draws.

## 3 · doctor · lint · snapshot · check

`tools/tt.cjs`, and `npm run doctor / lint:film / snapshot / check`. In CI too.

**Snapshot is the one that earns its keep.** There were 494 assertions before
this and **not one looked at a pixel of a finished frame.** Everything was
structural. A change that draws the caption two points smaller passes all of
them *and* passes render QC, because the file is still 900 frames at −16 LUFS.
The film validates and no longer looks the same.

Two things went wrong writing it, and both are in the code:

- **The first tolerance was useless.** mean ≤ 0.6 and 0.4% moved sounded careful;
  a deliberate 3% type-size change — a fortieth of the 61-vs-49-pixel caption bug
  this project actually shipped — sailed straight through. Now 0.005 / 0.03%,
  calibrated against a measured regression rather than guessed.
- **The first test knob moved nothing.** I perturbed line-height and measured
  exactly zero, because the fixture caption is a single line. A knob that moves
  no pixels is the same failure as a tolerance that ignores them.

So `33-golden.cjs` does not merely check the references exist. **It perturbs the
drawing maths and asserts the comparator sees it** — and asserts the margin, so
the gate is not sitting on the threshold. It also pins down why a tight gate is
not flaky: font size rounds to whole pixels, so a change too small to move the
rounded size renders byte-identically. There is no continuum of tiny diffs.

`doctor` checks node, ffmpeg, node-canvas, the compiled timeline and **the
typefaces** — because a missing face was found at render time once, after every
title in every film had quietly been set in the fallback.

## 4 · A storyboard beside every film

`lib/timeline/storyboard.ts` and a **Storyboard (.md + .json)** button. Every
shot, its timing, what is said over it, what was measured, what it was directed
to do. It reviews in a pull request, diffs between versions, and outlives the
tool.

A unit bug it caught on itself: `extractCues` returns **frames**, not seconds, so
the first version put every line on the wrong shot — silently and plausibly.
Fixed, and the comment says why. A line that runs across a cut is listed on both
shots it is heard over.

## 5 · The audio chain

`lib/timeline/audio.ts`. What existed was R128 normalisation and a −18 dB duck:
a good mastering stage and **no processing at all**. A voice recorded in a room
still sounded like a room; a music bed still fought the voice in the same
frequencies instead of making space for it.

Nine processors — highpass, lowpass, EQ, gate, compressor, saturation, delay,
reverb, limiter — plus **automation envelopes** (`eval=frame`, so a fade is a
fade and not a level change). Five presets that sound like something, each with a
note saying what it is for. `Pat muzical · sub voce` is the one worth reading:
it takes the voice's band *out of the music* rather than turning the music down
until it disappears. That is the difference between ducked music and music under
a voice.

**The order is not alphabetical**, and getting it wrong is audible:
`highpass → gate → EQ → compressor → saturation → delay → reverb → limiter`.
Gate before compressor, or the compressor lifts the noise floor between words
and the gate then chops a signal that is no longer quiet. Limiter last, always.
Two limiters collapse to one and the lower ceiling wins.

**`35-audio-chain.cjs` — 54 assertions, and not one reads a filter string.**
Every processor is run through ffmpeg over a signal built to expose it, and the
measurement has to move the way the processor claims. A compressor that does not
narrow the gap between loud and quiet is not a compressor, however well its
parameters are spelled.

And one it caught after I had already written this section: **the chain was
built, compiled and wired into the worker, and there was no way to choose one.**
A processor nobody can switch on is the same as no processor, and it is the easy
thing to miss — everything compiles, every test passes, and the feature does not
exist for the person using the tool. There is now a **procesare** selector on
both the voice and the music panel, showing the chain in order and the note
explaining why the preset exists, saved with the project.

Four more it caught, in me:

- **A real bug.** `aecho`'s `out_gain` scales the *whole* output, dry signal
  included — my reverb made the source **1.0 dB quieter** instead of adding a
  tail. An effect that attenuates the thing it is meant to add to is a bug with
  a pleasant name.
- **The wrong instrument, twice.** I read astats' own "Noise floor" and "Dynamic
  range" figures. A gate that works removes the floor entirely, so astats stops
  reporting one and the field comes back `null`; a compressor with makeup gain
  *raises* the floor. Neither told me anything. Measured loud-window against
  quiet-window instead, which is what those processors actually do.
- **A probe too quiet to test anything.** ffmpeg's `sine` runs at −18 dBFS, not
  full scale, and `amix` divides by its input count. The signal peaked at −21.6
  dBFS — below the −20 dB threshold of the voice preset's own compressor, which
  therefore never engaged. **The preset was fine and everything passed**, which
  is the flattering direction for a test to fail in.
- **The wrong window.** My reverb tail check started at 0.55s; the taps land
  0.44–0.50s. It measured +1.6 dB and concluded there was no reverb.

## 6 · Tabs

**Compune · Aspect · Sunet · Livrare.** The page had become a scroll — ten panels
in one column, ordered by the sequence the features were built in rather than the
order the work happens in.

Panels **hide rather than unmount**, so a half-typed prompt, a scroll position
and an open composition survive a trip to another tab. That is the difference
between tabs and four pages. The preview stays pinned beside all four, because
the film is the point of every one.

`36-tabs.cjs` asserts every panel belongs to a tab — the specific way a refactor
like this loses a feature — and that no hidden panel carries a `flex` or `grid`
utility, which would override `[hidden]` and leave it on screen in every tab.

It also caught a flaw in my own test tooling: the comment-stripped copy of the
source, which exists so a commented-out line cannot pass an assertion, is the
wrong input for *counting* things. The block-comment regex is non-greedy across
newlines and a JSX comment above a panel swallowed one of the eight guards. It
reported 7 where the file had 8.

## 7 · Modal, as a template rather than a claim

`deploy/modal/`. The render code is **not rewritten** — `render-worker/src` is
copied in and called as-is.

| | one box | spawned functions |
|---|---|---|
| two people rendering | one waits | two containers |
| idle cost | always on | zero |
| a finished film | local disk, 7 days | volume |
| a crash | one retry, same box | fresh container |

One piece is deliberately unwritten and named in the README: `src/cli.js`, the
thin entry point. It is an afternoon, and leaving it means a template nobody has
deployed does not rot pretending to be finished.

---

# The four craft gaps

These are the four I named as the difference between "a tool that assembles a
film" and "a tool a colourist or an editor would not laugh at". They share a
principle worth stating once: **none of them added a drawing mode.** Every one is
either a transform over the timeline the renderer already draws, or a number the
painter already multiplies by. That is why the golden frames still match and why
the preview and the render still agree — there is still exactly one engine.

## 8 · Animated graphics

`lib/timeline/html.ts`, `render-worker/src/raster.js`, control **animație** on
the composition panel.

Section 2 shipped HTML compositions as **static bitmaps moved by the timeline**,
and said so as an honest limit: no text animating on per word, no mask reveal, no
logo that draws itself. That limit is gone.

**The mechanism, and why it is not a custom animation system.** You write
ordinary CSS `@keyframes` and `animation`. Before each frame the rasteriser
pauses every animation on the page through the Web Animations API and sets its
`currentTime`:

```js
for (const a of document.getAnimations()) { a.pause(); a.currentTime = t }
```

That respects authored delays and easing **exactly** — a staggered reveal
staggers, a `cubic-bezier` stays cubic — and it is deterministic: the same markup
rasterised twice is **byte-identical**, which is the property a golden frame
containing a composition depends on. There is no interpolation of mine anywhere
in it. The browser that lays out your CSS is the same browser that decides where
the animation is at 0.44s.

**Only the moving part is rasterised, and then it holds.** A lower third is a
reveal and then a hold; rasterising four static seconds at 25 fps would be a
hundred PNGs for one second of movement. So you say how long the movement lasts
— **max 3 seconds, 60 frames** — and `frameUrlAt()` holds the last frame for the
rest of the clip. Both engines call that one function, so the preview and the
render can't disagree about which frame is on screen. A different timeline fps
still picks the right source frame.

**The linter learned something a test could not have told me.** I built a
staggered word reveal, measured it, and the words *popped* instead of fading in:

> With `animation-delay`, an element shows its **normal** styles until the delay
> elapses — not the `from` keyframe. A word that is meant to be invisible for
> 300 ms is fully visible for 300 ms and then starts fading in from opaque.

`animation-fill-mode: backwards` (or `both`) holds the opening state. The linter
now warns on a delay without one, because it is invisible in a single still and
obvious in motion — the worst combination for something you check by looking at
a frame.

`37-animated-compositions.cjs` — **31 assertions**, Chrome launched, pixels
counted: the stagger is verified *in pixels* (word 1 present while word 3 is
not), two runs are byte-identical, and the frame budget is enforced rather than
documented.

## 9 · Transitions

`lib/timeline/transitions.ts`, a selector on every shot after the first.

**A cross-dissolve is not a new drawing mode.** The compiler already draws clips
in order and blends them by opacity, and every clip already has `fadeIn` and
`fadeOut`. A dissolve is two clips overlapping while one ramps down and the other
ramps up. Everything needed existed; nothing arranged it. So `applyTransitions`
is a **pure timeline transform** and the renderer never learns it happened —
which is why this cost no worker changes and cannot break the golden frames.

| | what it does | what it costs |
|---|---|---|
| tăietură | cut | — |
| fondu | cross-dissolve | **eats duration** |
| prin negru / alb / culoarea mărcii | dip | **free** |

**The cost is the thing people get wrong, so the tool says it out loud.** Two
5-second shots with a 12-frame dissolve occupy **9.5 seconds**, not 10, because
the shots overlap. Measured: a 150-frame film becomes 138 with one 12-frame
dissolve, exactly. A dip inserts a colour clip on a new track (z=5 — above
picture, below type at z=10) and costs nothing. `framesLostTo()` tells the UI the
number before you render, and the tooltip on the selector states it in Romanian.

Two guards worth knowing:

- **`MIN_DISSOLVE = 3`.** Below three frames a dissolve is not a dissolve, it is
  a soft cut with a flicker.
- **Never more than a third of the shorter shot.** A 12-frame dissolve between
  two 10-frame shots would consume both. It is clamped rather than refused,
  because refusing a value someone typed is worse than honouring the intent.

`38-transitions.cjs` — **27 assertions**, and they draw real frames. The pixel at
the middle of a dissolve is asserted to be **a genuine blend** — neither shot's
colour, between the two on every channel — rather than merely "the function ran".

## 10 · Music that hits the cut

`lib/timeline/beats.ts`, buttons **caută bătăile** and **potrivește tăieturile**.

Spectral-flux onset detection, autocorrelation tempo, then a least-squares beat
grid. `snapToBeats` moves each cut to the nearest beat **if it is within 0.25s**
— a cut far from any beat is left alone, because an editor who put a cut there
meant it.

**This is the one I got wrong twice, and both mistakes are in the file.**

- **The octave error.** A periodic signal correlates at *multiples* of its
  period — every other click still lines up — and on a real click track the
  double lag scores *higher* than the true one. Measured at 120 BPM: lag 86
  scored **233** against the true lag 43's **148**. Two attempts reported
  **60.1 for 120** and **69.8 for 140**: exactly halved, and plausible enough to
  ship. Fixed by explicitly testing sub-multiples (÷2, ÷3) and taking the fastest
  one still scoring 35% of the peak, with a log-space prior toward 120 BPM.
- **The estimator that looks more correct and is worse.** Dividing the
  autocorrelation by the overlap (`length − lag`) is the unbiased estimator and
  it is the wrong tool here: it scales up long lags, where few samples overlap
  and noise dominates. The biased one — divide by the full length — is used
  **on purpose**, and the comment says so, so nobody helpfully fixes it back.

**Then a drift I would not have caught by ear.** The tempo was right to 2.5 BPM,
which sounds fine and is **0.21 seconds of drift over 10 seconds** — a cut that
lands visibly late by the end of a 30-second promo. Two least-squares refinement
passes over the grid took the error from **2.5 BPM to 0.09**: 120 BPM read as
117.5 before, **120.09** after.

`39-beats.cjs` — **24 assertions** against ground truth ffmpeg builds, not
judgement. **11 tempos from 70 to 175 BPM, every one within 4 BPM**, plus jitter,
plus silence returning nothing rather than inventing a tempo.

## 11 · Per-shot colour

`lib/timeline/grade.ts`, a selector and two sliders on every shot.

The adaptive grade is right nearly always and wrong exactly when a shot is
**meant** to sit apart — a memory, a night exterior, one cold frame in a warm
film. There was no way to say so. Now: a look, a strength, and a
temperature/tint trim, per shot, saved with the project.

- **No override is byte-for-byte the automatic grade.** Asserted, because the
  risk in a feature like this is that it quietly changes the films that don't use
  it.
- **`look: 'none'` still takes the trim.** "Do not grade this" and "do not touch
  this" are different requests.
- **±1 is about ±12%.** Deliberately gentle: the slider cannot make a shot
  unusable, and a per-shot trim that can ruin a shot gets switched off by the
  team and never used.
- Preview and worker compute it with **the same exported function**, and the
  suite asserts they agree exactly rather than approximately.

**And the one this nearly repeated.** Section 5 ends with the audio chain being
built, compiled, wired into the worker and *unreachable* — no way to choose a
preset. Writing this section I found `temperature` and `tint` in exactly that
state: computed by the library, honoured by the preview, honoured by the worker,
covered by tests, **and with no control anywhere in the Studio.** Everything
compiled and everything passed. The sliders exist now, and
`40-shot-grade.cjs` has six assertions that fail if the control is removed —
including that a slider returned to zero clears the override rather than leaving
an empty one behind. I checked those six fail by removing the control and
watching them fail, which is the only way to know a test is a test.

**31 assertions.** `trimGains(1, 0)` = `[1.12, 1, 0.88]` — warmer is more red and
less blue, and the suite asserts the direction, not just that a number changed.

---

## Tested against your repo, not against mine

The earlier cut of this zip was verified on a clone that turned out to be **45
commits behind your `main`**. That is my mistake and it is the kind that costs
money: had any of those commits touched the Studio page, this zip's 3,545-line
`page.tsx` would have overwritten your work silently.

So everything was re-run on a tree assembled from `origin/main` at `120ed48`
with this zip copied over it:

| | result |
|---|---|
| `npx next build` (what Netlify runs) | **compiled successfully**, 28.2s |
| `/admin/studio` route | builds, 59.3 kB · 230 kB first load |
| `npx tsc --noEmit` | clean |
| eslint | clean — 1 pre-existing `<img>` warning, not from this zip |
| `_verification/run-all.cjs` | **818 assertions, 31 suites, 0 failed** |
| `node tools/tt.cjs check` | all good |
| end-to-end render | 250 frames, 1920×1080, −15.2 LUFS |

And the diff against your live `main`: **14 files changed, 13 new, nothing of
yours removed.** Every one of the 96 deleted lines in `page.tsx` is my own
earlier code being moved into `lib/prompts/library.ts` or wrapped in a tab
panel. No script is dropped from `package.json`.

**`_verification/24-motion-direction.cjs` is rewritten, not deleted.** The
earlier note told you to delete it by hand. That was wrong twice: a manual
delete is a step that can be fumbled mid-commit, and deleting a suite deletes
the memory of why the code is shaped the way it is. It now asserts the same two
faults against `lib/prompts/library.ts`, which owns those words after the
refactor — 17 assertions, including the one the refactor could really have
broken: that the right words still reach the motion job for the right shot.

## Deploy

Copy the folder over the repo — every path in the zip is the path in the repo.

```
app/admin/studio/page.tsx      ← tabs, prompts, compositions, transitions,
                                 beats, per-shot colour, audio presets
lib/prompts/library.ts         ← new
lib/timeline/html.ts           ← new  · + animation
lib/timeline/storyboard.ts     ← new
lib/timeline/audio.ts          ← new
lib/timeline/beats.ts          ← new
lib/timeline/transitions.ts    ← new
lib/timeline/{types,index,compile,draw,grade,migrate}.ts
render-worker/src/render.js    ← needs a worker redeploy
render-worker/src/raster.js    ← new  · + animation frames
render-worker/src/audio.js
render-worker/src/index.js
render-worker/src/grade.js
render-worker/Dockerfile       ← adds chromium
render-worker/package.json     ← adds playwright
tools/tt.cjs                   ← new
_verification/*.cjs            ← 26, 30, 31-40
_verification/golden/*.png     ← new, 66 kB
.github/workflows/ci.yml       package.json
deploy/modal/*                 ← new, not wired up
```

**No SQL.** Nothing in this zip touches the database — the project schema
already carries the whole timeline document, so per-shot grades, transitions and
compositions save with the project without a migration. Nothing to run in the
SQL editor this round.

**The worker redeploy is not optional** — for HTML compositions the image now
installs chromium and the route that uses it, and animated compositions and
per-shot colour are read by `render.js`. `/health` reports `chromium: true` when
it is there; the Studio says so plainly when it is not.

## About selling this

The four pieces here are the ones that make it sellable, and not by accident.
A tool is a product when somebody who did not build it can **edit its language**
(1), **make it look like their brand without a developer** (2), **know it still
works** (3), and **show a client what they are approving** (4). Tenancy, seats
and metering are the remaining axis, and they are a different project — I have
not rescored them.
