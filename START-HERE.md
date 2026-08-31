# tt-level — the five weak axes, built

Supersedes **tt-download** (which superseded tt-direction). This one zip contains
all of it.

Every claim below has an assertion behind it. **445 assertions, 20 suites, 0
failures**, and from this drop onward they run on every push.

---

## 1 · Release discipline — 2.0 → 4.0

345 assertions ran only when a human typed their names. Now:

- **`_verification/run-all.cjs`** — one runner, one exit code. It knows which
  suites need ffmpeg and node-canvas, **skips** them on a machine without those
  and says so, and `--strict` turns a skip into a failure. A suite that crashes
  counts as failed rather than as zero, which a naive tally would have missed.
- **A `studio` job in CI** — ffmpeg plus the node-canvas build chain (the same
  list the worker's Dockerfile installs, deliberately kept in step), the worker's
  own deps, a build of the shared timeline, then `run-all --strict`.
- Separate from the `build` job on purpose: a broken lockfile should still fail
  in seconds rather than after a two-minute apt install.
- `npm run verify` locally.

Building `lib/timeline` in CI is a check in itself — if the shared module stops
compiling under the worker's stricter settings, CI says so before Railway does.

## 2 · The critical one — the preview had its own painter

Ten faults this month were one bug reported ten times. The preview reimplemented
what the renderer does, so the two disagreed about channel order, the wordmark,
the safe-area guide, film length, the clock, caption size, caption case,
karaoke, and the camera in three separate ways.

**The preview now compiles the same timeline `buildTimeline()` hands the
renderer, and draws it with the same `drawFrame`.** The painter no longer knows
what a scene is. Deleted, not deprecated: `activeSceneAt`, the overlay-only
timeline, and every camera helper the preview used to import — 2.6 KB of second
implementation, gone.

**And it found an eleventh.** The preview started *every* video at film time
zero, so a five-second clip belonging at 0:20 had finished fifteen seconds
before its cut and was drawn as a frozen last frame. Shots two onward played as
stills. The film looked static in the preview no matter what the footage did —
which is a large part of why "they are too static" was said about clips
measuring 3.34 and 3.88 %/s. Each video is now driven from its own clip's local
frame. **The browser recorder had the identical fault and is fixed with it.**

## 3 · Editing interface — 1.5 → 3.5

- **Undo and redo**, Ctrl+Z / Ctrl+Shift+Z, and it never steals the shortcut
  from a text field. A slider drag coalesces into **one** step, not eighty.
  Every mutator names its step, so the tooltip says what Ctrl+Z will undo.
  Scope is stated rather than implied: shots, titles, sounds and cues — the four
  lists where an edit destroys something. Not the voice, kit or format, because
  Ctrl+Z occasionally changing the aspect ratio is worse than no undo.
- **A playhead**, with timecode. Possible only because the painter compiles any
  frame now instead of hunting for "the active scene".
- **Trim** — duration on every shot, not only stills, plus an **in-point**. The
  migration hard-coded `sourceIn: 0`, so shortening a clip could only ever throw
  away the end; there was no way to drop a bad first second of a take.
- **Cut at the playhead** — the first half keeps the in-point, the second starts
  where the first ended. Refuses to make a sliver under half a second.

`splitClip`, `trimClip` and `moveClip` had been in the document, tested, since it
was written. This is the interface catching up with the engine.

## 4 · Reliability & scale — 1.5 → 3.5

- **Renders survive a restart.** The job index is a single JSON file written
  atomically beside the work directories, debounced so progress ticks do not
  thrash the disk, and rehydrated on boot. A row whose file has gone is *not*
  restored — that would hand out a key resolving to nothing, which is the bug.
- **Concurrency is a number, not a boolean.** `RENDER_CONCURRENCY`, default 2.
  ffmpeg already uses every core, so two is enough to stop one person blocking
  another without making both slower.
- **One retry**, and only for failures worth retrying — a killed ffmpeg, a
  timed-out source, a 502. A timeline the validator would reject is not retried,
  because spending another three minutes reaching the same answer helps nobody.
- **Retention 6 hours → 7 days.** Six hours was defensible when a restart
  destroyed everything anyway.
- `/health` reports concurrency, in-flight count and retention.

The suite for this **starts a real worker, plants a finished job, kills the
process with SIGKILL, starts a new one, and asks for the file.** It also checks
that a wrong key is still refused and that an orphaned row is not restored.

## 5 · Campaign output — 0.5 → 3.5

**`lib/timeline/retarget.ts`** — one film, every format, one press.

Picture clips need no arithmetic at all: `fit: 'cover'` already fills whatever
frame it is given. That is the dividend of owning a real timeline document.

Type is where a naive reframe looks amateur, so two things are handled:

- **Position.** A caption at y = 0.76 sits above TikTok's caption bar in 9:16 and
  in the wrong place entirely in 16:9. Every text position — including every
  keyframe of an animated one — is re-clamped into the safe area of the format
  it is **going to**.
- **Measure.** `maxWidth` is a fraction of frame WIDTH; font size is a fraction
  of the SHORT edge. Carry 0.86 into 16:9 unchanged and the caption becomes one
  90-character line. The box is rescaled to hold the measure constant in ems:
  0.86 → **0.484** going vertical to wide, verified against the arithmetic.
- **Size is deliberately untouched** — it is already short-edge relative, so a
  0.045 caption is the same apparent size in every format. "Correcting" it would
  break the one thing that already worked.

Audio, timing, markers and delivery are untouched: same voice, same cuts, same
loudness target. **Randează toate formatele** does 9:16, 4:5, 1:1 and 16:9,
validating each before it is paid for.

## 6 · Creative direction — 2.5 → 4.0

The per-shot work from tt-direction is now **exposed in the interface**: a
direction line per shot ("the shutter goes on rising, the light sweeps across
the floor") and a light selector — warm / cold / do not hold — so the grade
instruction is sent in the direction the shot actually runs. A cold pre-dawn
shot is no longer told that blue hour is a defect.

---

## Deploy

```
app/admin/studio/page.tsx
lib/timeline/history.ts          ← new
lib/timeline/retarget.ts         ← new
lib/timeline/animate.ts
lib/timeline/migrate.ts
lib/timeline/index.ts
lib/timeline/draw.ts
lib/timeline/compile.ts
lib/timeline/types.ts
render-worker/src/index.js       ← needs a worker redeploy
.github/workflows/ci.yml
package.json
_verification/*                  ← 4 new suites + the runner
```

No SQL. The worker redeploy is what turns on durability and concurrency; the
Studio half works without it.

## Verification

```
10-vision        35   18-fonts          15   26-one-path       22
11-payload       35   19-wordmark       11   27-editing        29
12-inspect       30   20-reading        17   28-durability     20
13-resample       8   21-browser-render 23   29-variants       28
14-brand         45   22-captions       19
15-colour        10   23-motion         26        445 assertions
16-layers        11   24-direction      18        20 suites
17-sound         25   25-download       18        0 failures
```

Plus the end-to-end encode: 250 frames at 1920×1080, 16/16, −15.2 LUFS, music
36.4 dB under the voice. `tsc` 0 errors, `eslint app lib` 0 errors.

**Two suites had assertions replaced rather than fixed**, and the reason is in
the code: `22` asserted captions were built into an overlay-only timeline, and
`23` asserted the preview evaluated the renderer's curves. Both were true of the
previous step and are now too weak — there is no overlay-only timeline, and the
preview does not evaluate a camera at all because it compiles the renderer's
frames. Asserting the old property would have failed against better code.

## What is still open

- **The grade is the last real divergence.** The worker applies a per-shot
  adaptive grade computed from each shot's measured mean; the preview does not.
  Faking it with a canvas filter would create a new divergence, so it is left
  honest. The fix is to move `planGains` out of the worker into `lib/timeline`
  and measure one frame per shot in the browser — the same shape as everything
  else here.
- **Tenancy, API and metering** are untouched. That is the SaaS axis, and it is
  a different project from this one.
