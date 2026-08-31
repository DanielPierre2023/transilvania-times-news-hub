# tt-scrub — the playhead was drawing a black rectangle

Small, and found by testing the deploy rather than by reading it.

## What I checked

tt-level is live. I probed the served bundle cache-busted: `Cap de citire`,
`nu fixa lumina`, `toate formatele`, `Feed vertical` all present. The worker is
live too, and says so in its own words — `/health` now reports
`concurrency: 2` and `retention: 604800000`, which is seven days. Both of those
fields exist only in the new code, and `running` is a number rather than a
boolean, so the durability work is genuinely deployed.

Then I opened the real project and scrubbed the new playhead, sampling the
canvas at six positions:

```
t=2s    10 non-black pixels of 4080     mean 0
t=7s    10                               mean 0
t=12s   10                               mean 0
t=18s   10                               mean 0
t=24s   10                               mean 0
t=28s   4080                             mean 194   ← the end card
```

## The fault, and it was mine

Media was only ever fetched by `preloadAll()`, which runs when you press
Preview. That was fine when the canvas stayed blank until then. The moment there
is a scrubber it is a defect: parking on shot three drew the captions and the
titles over nothing at all. The ten non-black pixels are the safe-area guide.

Frame 28 proves the rest of the work is sound — the end card is drawn entirely
from compiled ops and it paints perfectly. The picture was missing, not the
pipeline.

## The fix

A frame that asks for a source the cache does not have now starts fetching it —
once per URL, tracked in a ref so a redraw storm cannot queue the same file
forty times — and redraws when it lands. A dead URL is caught and dropped rather
than wedging the painter: a broken link in the library is the library's problem,
not the canvas's.

## Deploy

One file, no SQL.

```
app/admin/studio/page.tsx
```

## Verification

`26-one-path.cjs` grew five assertions and is now 27:

- a frame that wants a source it has not got fetches it
- exactly once per url
- redraws when it lands
- a dead url does not wedge the painter
- the parked frame redraws on new media

Full suite **450 assertions, 20 suites, 0 failures**.

## After deploying

Drag the playhead without pressing Preview. Every position should show a
picture. If a shot takes a moment to appear the first time, that is the fetch —
it is cached from then on.
