# tt-grade — the pass that was missing

**GitHub only.**

    render-worker/src/grade.js     new
    render-worker/src/render.js    modified — grades before the mux
    lib/timeline/types.ts          adds GradeSpec to the delivery spec
    lib/timeline/document.ts       grade is ON by default: warm, strength 0.85
    lib/timeline/index.ts          exports

Railway and Netlify both rebuild themselves.

---

## What it does

Colour is decided **once, over the assembled cut**, matching every shot to a
single look. Both failed films had five shots that each arrived a different
colour and nothing corrected them afterwards. A generative model will never
return a consistent look — the fix is not a better prompt, it is a deterministic
pass after assembly.

This one knows the **edit**. The timeline supplies the exact cut points, so each
shot is measured and corrected on its own instead of one average smeared across
the film. No consumer tool has that, because no consumer tool owns the timeline.

## Three implementation details that matter

**Linear light.** sRGB is gamma-encoded. Scaling a channel in gamma space skews
the midtones and desaturates — which is what a saturation slider does and why it
never looks like a grade. Everything here converts to linear, corrects, converts
back, baked into a single LUT expression per channel.

**Trimmed mean.** The statistic is the 10th–90th percentile by luminance.
Specular highlights and crushed blacks otherwise drag the estimate around.

**Frame count is sacred.** The first version cut the film into segments with
`trim` and glued it back with `concat`. It silently lost **two frames** at the
seams, because trim boundaries are times and times do not land on frames. The
frame-count check in the QC gate caught it. It now uses one unbroken chain of
`enable`-gated LUTs — nothing is re-timed, nothing is cut, and the output has
exactly as many frames as the input.

---

## Proven, not asserted

**On your actual failed film.** The prototype in `_verification/` ran on
`master_2.mp4`. Every shot came back from Kling with blue exceeding red by 42 to
64 points. After the grade, four of five shots are within a few points of
neutral-warm, and the film reads as one film instead of five.

**On deliberately mismatched shots.** One shot pushed hard blue, one pushed hard
orange, rendered through the real pipeline:

    mean distance to the look: 0.1708 -> 0.0650   (62% closer)

**And the honest limit.** Shot 4 of your film — the woman at night — has a red
channel averaging **0.0034 in linear light**. There is nothing there to recover.
Pushing it 2.6x only amplifies noise. So the grader does not pretend: it reports
those shots in `unrescuable`, and the answer for them is to regenerate, not to
grade harder.

That is the finding that shapes everything next: **QC and regenerate upstream,
grade downstream.** Neither alone is enough.

---

## Verified

    npx tsc --noEmit      exit 0
    npx eslint app lib    exit 0   (41 warnings, unchanged)

    225 assertions across eight suites, all passing:
      64 timeline · 17 loudness vs ffmpeg · 31 captions · 45 render spec
      16 real render · 12 grade · 29 worker API · 11 byte ranges

The grade suite proves the shot matching, that each shot moves toward the look,
that duration and frame count are untouched, that a neutral look on neutral
material is an exact identity, and that an unrescuable shot is reported rather
than faked.
