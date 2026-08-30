# tt-typeface — the film is made, and it found four things

The spot is rendered and sitting on **v1** of the project *Spot brand · Știrile
de aici* in Studio — open the version row and click **Fișier**. 30.00 seconds,
1080×1920, −16 LUFS, true peak under −1 dBFS, QC green.

This package is what building it exposed. Read the first item; it is the
important one.

---

## What the gate did

Five shots, two takes each, and it worked exactly as designed:

| shot | movement | stability | outcome |
|---|---|---|---|
| 1 · the gate at dawn | 3.56 %/s | 1.24× | kept take 1 of 2 |
| 2 · hospital corridor | 1.75 / 1.41 %/s | **2.36× / 2.87×** | **both rejected — reshot** |
| 2 · reshoot | 0.51 %/s | 0.65× | kept |
| 3 · the signature | 0.48 %/s | 0.87× | kept |
| 4 · the newsroom | **0.03 / 0.31 %/s** | — | **both rejected, under the movement floor — reshot** |
| 4 · reshoot | 5.31 %/s | 0.92× | kept |
| 5 · the town | 0.37 %/s | 1.06× | kept |

Four takes rejected, two shots reshot automatically, every shot on the timeline
passed. Nothing on the market does this.

Generation came to **$8.26** against the ~$6 I quoted. The whole overrun is the
two reshoots — which is the feature working, not a surprise, but you should have
the real number.

---

## 1 · The brand face did not exist. Every title was set in the fallback.

The kit named **Playfair Display**. fontconfig in the render worker had never
heard of it. Cairo substituted the default sans without an error, the render
reported success, and the QC report stayed green — because nothing measured it.

A missing typeface is the most invisible defect this pipeline can have. The text
is still there, still legible, still the right colour, just set in something
else. There is no exception to catch.

**Fixed three ways:**

- The worker image now installs **EB Garamond** and **Inter** from Debian — no
  download at build time, nothing to license.
- The Studio self-hosts EB Garamond (`public/fonts`, because the site's CSP is
  `font-src 'self' data:`), so the preview sets a title in the same face the
  file will get. Preview-lies-to-you is a failure this project has already paid
  for once.
- **QC now measures it.** Before a frame is drawn, every family the timeline
  asks for is set against a family that certainly does not exist. Identical
  advance widths mean the font did not resolve. The report says which face is
  missing and that the film was rendered in the fallback.

*One detail worth keeping:* the display weight is **400**, not 700. The freely
distributable EB Garamond **bold carries 128 glyphs and not one of ă â î ș ț** —
a bold Romanian title would have rendered with holes in it. The regular has
3080 and covers the language completely. I checked every serif on the machine
for Romanian coverage before choosing.

## 2 · The end card was a slide, not an end card

The name sat at 0.46 and the address on the safe edge at 0.80, leaving a hole
through the middle of the frame. Everything now hangs off one optical centre,
each element a known multiple of the type size below the last, and the block
sits slightly above true centre because type always looks low when it is
measured to the middle. Title size up from 0.075 to 0.088 of the short edge.

The tests for this were rewritten too. They had hard-coded the template's own
coordinates, so they broke the moment the layout improved — a test that only
restates the implementation. They now measure properties: there is ink above the
middle, there is an accent rule below it, the rule is centred, and **nothing is
stranded near the bottom edge** — which is the defect itself, asserted.

## 3 · The subtitles outran the eye, and the fix existed but had no button

Five of seven cues came back over seventeen characters per second, one at
twenty-two. Nobody reads that. `conformCues` has been in the library for days —
extend into the gaps, honour the minimum duration *after* moving the start,
close sub-two-frame gaps into hard cuts — and nothing in the interface called
it, so the checker could only ever complain.

**Corectează** now sits next to the warning. Frames in, frames out, using the
same rules that flagged them rather than a second implementation in seconds.

## 4 · The music bed from the last drop is in here too

`tt-bed` was never deployed, so the film has no bed under the voice. Its files
are included here; the checkbox is **pat muzical** next to the sound row.

---

## Deploy

Repo only, no SQL.

```
render-worker/Dockerfile          installs EB Garamond + Inter
render-worker/src/fonts.js  (new) the resolution probe
render-worker/src/render.js       checks fonts before drawing
render-worker/src/qc.js           reports it to a human
render-worker/src/index.js        passes it into the report
render-worker/src/sfx.js          the music bed
lib/brand/kit.ts                  real faces, weight 400, retuned scale
lib/brand/templates.ts            end-card vertical rhythm
app/globals.css                   @font-face for the preview
public/fonts/ebgaramond-400.woff2 (new, 173 KB)
app/admin/studio/page.tsx         Corectează, pat muzical
```

Railway rebuilds the image — this one changes the Dockerfile, so the build is
longer than usual.

## Verification

**432 assertions, all passing.**

```
node _verification/18-fonts.cjs   15   the probe, and that a missing face
                                       reaches the QC report a human reads
node _verification/14-brand.cjs   40   was 38; the end-card assertions are now
                                       property-based instead of restating the
                                       template's coordinates
node _verification/17-sound.cjs   25   the bed
```

## Then re-render

Once this is live: open v1, press **Corectează** on the subtitles, tick **pat
muzical**, submit v2 and render it. That version will be the first with the
right typeface, a readable subtitle track and something under the voice — and
it will be a clean before-and-after against v1, which is what the version table
is for.
