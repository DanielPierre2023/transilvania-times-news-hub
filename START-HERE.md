# tt-browser-render (2) — the previous fix is not on the site

## First, the thing to check

I read the JavaScript the site is serving right now. It is the **tt-edit-loop**
build — it has `Randează v3`, `Niciun track` and the `siglă` control. It does
**not** contain `filmDur`, the `guides` flag, or the audio-clock loop.

So the grid and the missing end card are still there because **the fix has not
been deployed**, not because it did not work. If `tt-browser-render.zip` is
still sitting unopened, that is the whole story — this package supersedes it and
contains everything from it.

*How to confirm after deploying:* the big red button on the right should read
**“Randează montajul curent (cloud, MP4)”**. If it still says “Randează clipul”
in red, the build has not landed yet.

## Second — and this is on me either way

Even once it is deployed, the guide **still shows in the preview**. That is
correct: it is there to show you where TikTok's caption bar will cover the
frame. But a dashed rectangle sitting on the picture looks exactly like
something the film contains, which is why it has now been described twice — as
“a strange rectangle” and as “a grid”.

So it no longer looks like that. The safe area is now drawn the way an editor
draws it: **everything outside the box is dimmed**, with a thin line and a small
label reading `ZONĂ SIGURĂ · reels · nu apare în film`. Nothing in a film dims
its own edges, so it cannot be mistaken for content again. Untick **arată
ghidul** to remove it entirely.

## What is in this package

Everything from tt-browser-render, plus the mask:

- **the guide is not recorded** — the painter takes a `guides` flag; the preview
  passes true, the recorder passes false
- **the recording runs to the end of the film**, not the end of the shots, so
  the end card is captured (26s of shots + a 4s card = a 30s film; the recorder
  stopped at 26)
- **one clock** — the picture is drawn off the AudioContext clock the voice
  plays on, instead of wall-clock, so the captions stop sliding off the words
- **the deterministic cloud render is the primary button**, the real-time
  capture is secondary and says what it is
- **the guide is a dimmed mask**, labelled, unmistakable

## A shortcut while you wait

The cloud render already has all of this and always did — v3 rendered from the
worker has the end card, no guide, and perfect sync, because the worker draws
the timeline rather than capturing a screen. If you need a correct file today,
press the cloud button rather than the capture one.

## Deploy

One file, no SQL.

```
app/admin/studio/page.tsx
```

## Verification

`_verification/21-browser-render.cjs` → 23 assertions, reading the page source
with comments stripped so a commented-out line can never pass:

- the recorder asks for no guides; the preview still gets them
- the guide dims what falls outside the safe area instead of drawing a box on it
- it labels itself `nu apare în film`
- the old dashed-box style is gone entirely
- nothing anywhere still ends a capture at `totalDur`
- an end card past the last shot extends the film to 30s; one inside does not
- the capture loop reads `ac.currentTime` and no wall-clock remains in it
- the cloud button carries the primary style and the capture does not
