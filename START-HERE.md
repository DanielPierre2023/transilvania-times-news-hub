# tt-shotgate-2 — what the live shot told us

Ran the verification shot on the live Studio: one still, then three takes of it
on v3 pro with the loop off. Here is everything it showed, including the part
where the gate was wrong.

---

## 1 · The still fix works, and it is not subtle

`AI · 9:16 · 2160×3840`. Seedream fired at twice the master, through the
project-wide `FAL_KEY`. The picture came back with real atmospheric depth —
haze lying in the valley, low sun raking the poplars, lichen legible on the
foreground fence posts, the crimson roof exactly where the brand accent was
asked for. Compare with what the pipeline produced before: 576×1024 from
FLUX-schnell, enlarged 1.875× before a frame was rendered.

Nothing to change here.

## 2 · The loop was the thing killing the motion — confirmed

| | movement |
|---|---|
| five shots of the delivered film, o3 + loop | **0.00 %/s**, all five |
| three takes, v3 + no loop | **0.48, 2.57, 0.60 %/s** |

Take 2 came back with a genuine 2.5 %/s push. The colour check passed on all
three — the negative prompt held the golden hour, which is the field o3 does
not have and silently dropped.

## 3 · And then the gate rejected all three good takes

Raw shimmer on those takes: 12.7, 12.2, 15.0. The ceiling was 2.5. All three
were auto-rejected, and they should not have been.

**The threshold was calibrated on the wrong thing — my error.** Alignment is
integer-pixel, so a camera drifting half a pixel leaves residual *everywhere*,
in proportion to how much fine detail the picture holds. A smooth synthetic
test clip has almost none. A golden-hour photograph of grass, haze and lichen
has a great deal. The corpus I calibrated on sat at 0.24–0.48; real footage of
a real landscape sits at 12–15. Nothing was wrong with the footage. The metric
had no scale.

### The fix: measure instability against the picture's own floor

Shift each frame against **itself** by half a pixel and measure what that alone
costs. Real change is then read as a multiple of it — a number that means the
same thing on a misty landscape and on a plain studio wall.

| | movement | instability |
|---|---|---|
| synthetic still | 0.00 | 0.000 |
| synthetic pan with zoom | 19.58 | 0.061 |
| synthetic slow push | 3.45 | 0.098 |
| **real v3 take 2** | **2.57** | **0.988** |
| **real v3 take 1** | **0.48** | **1.009** |
| **real v3 take 3** | **0.60** | **1.216** |
| take 2 + 6% per-frame noise | 2.58 | 1.112 |
| take 2 + 12% | 2.59 | 1.213 |
| take 2 + 25% | 2.61 | 1.310 |

All three real takes now pass. Clean footage of any subject lands near 1.0.

## 4 · Three more defects the same investigation turned up

**The movement figures I published were clipped.** The alignment window was
14 px and both calibration clips moved further than that between samples, so
the search hit its own edge and reported the edge. "Slow push 6.80, real pan
12.82" were never measurements — they were the window. The window is now 24 px,
and a run that still reaches it sets `clipped`, so a lower bound can never
again be mistaken for a measurement.

**The metric was not invariant to its own sampling.** Aligning two frames a
second and a half apart leaves large residual however clean the shot is,
because a global translation and zoom cannot explain that much of a real scene.
The same pan clip measured 0.30 at six samples and 2.26 at four. Comparisons
now happen at a **fixed 0.4 s spacing**; the sample count only decides how many
places in the clip get measured. The same clip now reads 0.060 / 0.060 / 0.061
at three, four and six samples.

**Slow moves rounded away to nothing.** Integer alignment reported the same
take as 0.00 %/s at one sample width and 1.89 %/s at another — the shot had not
changed, only the rounding. The shift is now refined to sub-pixel accuracy
against the error surface, and zoom compensation resamples bilinearly instead
of nearest-neighbour.

## 5 · What I deliberately did NOT do

There is no sample of **real generative boiling** in the corpus — only added
white noise, which is a weak proxy: it inflates the per-picture floor almost as
fast as it inflates the residual, compressing the very separation it is meant
to show.

So the standalone ceiling is set at **1.8 — a catastrophe limit, not a fine
judgement.** The sharp check is the combined one: *no camera movement AND
unusual instability*, which is exactly the shape of the five shots in the
delivered film. And ranking does the rest — between two takes that both pass,
the calmer one scores higher and wins, which is the entire point of shooting
three.

Tighten `maxShimmerRatio` when the pipeline finally produces a genuinely
boiling take and we can measure one.

---

## Deploy

Repo only. No Supabase functions changed, no secrets, no SQL.

```
render-worker/src/vision.js      (rewritten measurement core)
app/admin/studio/page.tsx        (reads and shows the ratio, not raw shimmer)
```

Railway rebuilds the worker; Netlify rebuilds the site. Reload the Studio tab
afterwards — the verification project is unsaved and a reload discards it.

The scene report now reads:

    dubla 1 · 0.48 %/s · 1.01×    dubla 2 · 2.57 %/s · 0.99×    dubla 3 · 0.60 %/s · 1.22×

Movement per second, then instability as a multiple of that picture's own
half-pixel floor. Around 1.0 is clean footage, whatever the subject.

## Verification

327 assertions, all passing.

```
node _verification/10-vision.cjs     35   was 21 — the ratio, the sub-pixel
                                          refinement, the sampling invariance
                                          and the rank-between-passing-takes
                                          rule are all asserted now
node _verification/11-payload.cjs    35
node _verification/12-inspect.cjs    26
node _verification/13-resample.cjs    7
```

`npx tsc --noEmit` → 0 errors. `npx eslint app lib` → 0 errors, 41 warnings
(unchanged baseline).

## What this cost

$0.04 for the still, $1.01 for three 3-second takes. $1.05 total, and it bought
four defects — one of them mine, in the gate itself, which would have rejected
every good shot the tool ever made.
