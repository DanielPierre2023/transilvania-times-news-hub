# Caption size — a real defect, not a taste preference

**GitHub only.**

    render-worker/src/draw.js       (Railway rebuilds itself)
    lib/timeline/render-spec.ts     (Netlify rebuilds itself)

## The bug

Caption type was sized as a fraction of the frame **height**. In a vertical
frame the height is the LONG edge, so the same setting produced wildly
different type depending on orientation:

    9:16  (1080×1920)   0.045 × 1920 = 86px   — 8.0% of the frame WIDTH
    16:9  (1920×1080)   0.045 × 1080 = 49px   — 2.5% of the frame WIDTH

More than three times larger, relative to the frame, in vertical — which is
exactly the format where burned-in captions matter most. Your previous renderer
used 0.032, so on top of the wrong basis I also set the constant 40% higher
than what you already had.

That is why the captions in the reel read as a meme slab rather than a brand
film.

## The fix

Type now scales off the **short edge**, which is orientation-invariant:

    9:16   86px  ->  49px
    4:5    61px  ->  49px
    16:9   49px  ->  49px

Padding moved to the same basis. The `Mărime` slider still works on top, so
100% is now a sane baseline instead of already being oversized.

## Verified

    npx tsc --noEmit      exit 0
    npx eslint app lib    exit 0   (41 warnings, unchanged)
    157 assertions across the four library suites — all passing
    a real 1080p render produced and measured — 16 checks passing
