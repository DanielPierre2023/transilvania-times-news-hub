# Two defects the animated cut exposed

**GitHub only.**

    app/admin/studio/page.tsx      (Netlify rebuilds itself)
    render-worker/src/index.js     (Railway rebuilds itself — auto-deploy is on now)

---

## 1. The motion pass destroyed the grade

Five stills went to Kling warm and golden. The first came back a **cold blue
night**. Same composition, same road — completely different time of day.

The edge function's default prompt already said "preserve the composition and
color grade of the original photograph". Kling ignored it. What was missing is
the *negative* prompt, which is where these models actually listen, and it
listed only text, hands, faces and cuts — nothing about colour or time of day.

Now two things travel with every animation job:

* `MOTION_PROMPT` — sent explicitly instead of relying on the function's generic
  default: keep the same composition, colours, warm lighting and time of day; do
  not make it night; do not cool or desaturate.
* `MOTION_NEGATIVE` — extended with the actual failure mode:
  `night, nighttime, moonlight, blue hour, twilight, dusk, colour shift,
  changed lighting, changed time of day, cold colour grade, blue cast, teal
  tint, desaturated, washed out, season change`.

I cannot promise this fixes it — Kling is a model, not a compiler. That is why
the plan below re-animates **one** shot first.

## 2. The preview could not be scrubbed

The worker served the file with no byte-range support, so a browser could start
a video but every seek snapped back to zero. That is not a cosmetic problem: it
is exactly why I could only inspect frame one of a twenty-second clip.

Now implemented properly:

* `Accept-Ranges: bytes` on every response
* `206 Partial Content` with a correct `Content-Range`
* suffix ranges (`bytes=-500` = the LAST 500 bytes, a classic off-by-everything)
* open-ended ranges (`bytes=100-`) running to EOF
* `416` for a range past the end, and a clean fallback to the whole file on a
  malformed header

Disposition also changed from `attachment` to `inline`, so the master plays in a
browser tab instead of only downloading — which is what stopped me reviewing the
last render.

---

## Verified

    npx tsc --noEmit      exit 0
    npx eslint app lib    exit 0   (41 warnings, unchanged)

    11 new assertions on byte ranges — all passing, including the tail bytes of a
       suffix range matching the end of the full file
    29 worker API assertions — still passing, no regression
