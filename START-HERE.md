# tt-shotgate — the shot gate

Four things, in the order they broke the last two films.

---

## What was actually wrong (measured, not guessed)

**1. Every clip was generated with the anti-drift instruction thrown away.**

Studio's default engine was Kling **o3**. fal's published schema for o3 has no
`negative_prompt` field and no `cfg_scale` field — they do not exist. The edge
function knew this and dropped both before the request left us. So the list that
said *not night, not blue hour, do not change the time of day* was never sent to
the model on a single job. That is why a golden-hour still came back cold and
blue and no amount of prompt-writing fixed it.

Kling **v3** accepts both. That is the whole reason to move, and it is now the
default.

**2. The loop was killing the motion.**

`end_image_url` set to the same still tells the model the last frame must equal
the first. The cheapest way to obey that is to not move. Measured on the five
shots of the delivered film: **0.00 %/s of coherent camera movement, all five**,
with shimmer between 1.08 and 2.32 — pixels boiling while the picture goes
nowhere. The loop is right for an anchor plate that repeats behind a voiceover.
It is wrong for b-roll. It is now **off by default**.

**3. Every still was a draft enlarged to fill the frame.**

`generate-cover-image` rendered at 1024 on the long side — **576×1024** for a
vertical film whose master is 1080×1920 — using FLUX.1-schnell, the four-step
distilled model, tried first because it is free. And in campaign mode the size
was forced to 1024×576 *landscape* regardless of aspect, then cropped to
vertical: a usable 324×576, blown up 3.3×.

That is the whole of "the images are really shit". Not the prompts. Arithmetic.
Campaign stills now render at **twice the master** — 3840×2160, 2160×3840 —
through Seedream 4.5, which takes an explicit width and height. Article
thumbnails keep the cheap ladder; they are 400px on the page.

**4. The renderer was resampling badly.**

Now that stills arrive oversized, every draw is a reduction, and node-canvas
defaults to Cairo's `good` filter. Measured against ffmpeg's Lanczos as ground
truth on a ring chart, RMS error in grey levels out of 255:

| reduction | canvas default | `patternQuality='best'` |
|---|---|---|
| 3840×2160 → 1920×1080 | 8.87 | **6.57** |
| 3840×2160 → 1280×720 | 18.11 | **8.72** |

One property. 26% and 52% closer to a correct reduction.

*I also tried the intuitive fix — halve the image first, then draw. It measured
**14.26**, worse than doing nothing, because every intermediate resample
compounds error. The code that did it was written, measured, and deleted; the
numbers are kept in `_verification/13-resample.cjs` so nobody re-adds it.*

---

## The new thing: the shot gate

Every other generative tool in this market generates once, shows you the result
and lets you decide. This one **measures its own output**.

Consecutive frames are aligned by searching for the translation and scale that
best match them. What the alignment finds is **coherent motion** — the camera
moved. What is left over after aligning is **shimmer** — pixels changing while
the picture goes nowhere. Mean pixel difference cannot tell those apart; a slow
push and a dead boiling clip produce similar frame differences. Alignment
separates them.

Calibrated, measured (percent of frame width per second):

| | movement | shimmer |
|---|---|---|
| still image | 0.00 | 0.00 |
| slow 10% push over 4s | 6.80 | 0.24 |
| real pan across frame | 12.82 | 0.48 |
| **the five delivered Kling shots** | **0.00** | **1.08 – 2.32** |

All five would have been rejected automatically.

Studio now shoots **N takes** of each shot (default 2), sends them to the worker
with the still they were grown from, and the worker answers which are usable.
An accepted take goes on the timeline by itself. If none pass, the still stays
put and you are told in numbers what was wrong — you can still adopt a rejected
take with one click, but on the record, not by accident.

---

## Deploy, in this order

### 1 · Supabase secrets — DO THIS FIRST

`generate-cover-image` now uses fal for campaign stills. It needs the key:

- Edge Functions → **generate-cover-image** → Secrets → add
  **`FAL_KEY`** = the same value already on `generate-motion`.

Without it the function still works — it falls back to OpenAI at `high`
quality — but you do not get the master-resolution stills.

### 2 · Supabase functions (paste in the dashboard, deploy each)

| function | what changed |
|---|---|
| `generate-motion` | rewritten for Kling v3; per-model schema table; `takes`; returns the exact payload it sent |
| `generate-cover-image` | fal Seedream at master resolution for campaign stills; OpenAI at `high`; HF last; reports `provider` and `renderedAt` |
| `render-worker` | new `inspect` action |

### 3 · Repo (commit + push — Netlify and Railway both build from it)

```
app/admin/studio/page.tsx
render-worker/src/vision.js      (new)
render-worker/src/index.js
render-worker/src/draw.js
render-worker/src/sources.js
```

Railway rebuilds the worker from the push. Netlify rebuilds the site.
Nothing to run in SQL. No migration this time.

### 4 · Check it

- Studio → the engine bar now reads **motor / buclă / duble / cfg / lipsync**.
  `buclă` starts **off**. `duble` starts at **2**.
- Generate an image: the scene name should end in `· 3840x2160` (or 2160x3840).
  If it does not, `FAL_KEY` is missing from `generate-cover-image`.
- Animate it. The button counts through `trimit… / filmez 2 duble… / măsor
  dublele…`, then the scene shows `mișcare 4.2 %/s · fierbere 0.31/s`.
- A model with no negative prompt is now labelled **FĂRĂ negativ** in the
  dropdown and on the cost line. That is not decoration — it is the bug that
  cost two films.

---

## Cost, since the shape changed

Default is now v3 pro at **$0.112/s** (o3 standard was $0.084/s) and **2 takes**,
so a 5-second shot goes from $0.42 to **$1.12**. A five-shot film is about $5.60
of generation. `duble = 1` puts it back to one take. The 4K tier is $0.42/s and
is there for a hero shot, not a whole film.

`generate_audio` is now always sent as `false` — v3 defaults it **on**, which
would have been $0.168/s for audio your own voiceover covers up.

---

## Verification

321 assertions, all passing. `_verification/` holds the four new suites:

```
node _verification/10-vision.cjs      21  the measurement, on the calibration corpus
node _verification/11-payload.cjs     35  the exact payload per model, no fal key, no spend
node _verification/12-inspect.cjs     26  the /inspect route end to end
node _verification/13-resample.cjs     7  picture quality vs ffmpeg lanczos
```

`10` and `12` need the calibration clips; set `CAL_DIR` to point at them.
`npx tsc --noEmit` → 0 errors. `npx eslint app lib` → 0 errors, 41 warnings
(unchanged baseline).

---

## What I have NOT proven

I cannot call fal from here — the key lives in your Supabase secrets. So:

- The **resolution** fix is arithmetic and is certain.
- The **schema** fix is checked against fal's own published schemas and asserted
  in 11-payload, but the first live call is the first proof.
- Whether v3 with a negative prompt and no loop actually produces *good* footage
  is a question the gate now answers for you, per take, instead of me telling you
  it will. Shoot one shot with `duble = 3` and read the numbers.
