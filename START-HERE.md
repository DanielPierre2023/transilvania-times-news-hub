# tt-browser-render — three faults, one cause

All three come from the same fact: **“Randează clipul” records the preview
canvas, live, in real time.** It is not a renderer; it is a screen capture of
the editor.

## The strange rectangle

That is the **safe-area guide** — the dashed amber box that shows where TikTok's
own caption bar will cover your frame. It is drawn by the preview painter, and
the preview painter is what the recorder captures. So the editor's guide was
being burned into the film.

I wrote the comment on that code myself: *“Safe area — a guide, never rendered
into the file.”* True of the worker, false of the recorder. Same shape as the
wordmark last time, found the same way — by someone watching their own film.

The painter now takes a `guides` flag. The preview passes true, the recorder
passes false.

## The missing branding

The recording stopped at **26 seconds** — the length of the five shots. The end
card sits at 26 for 4, so the film is **30**. The last thing recorded was the
final shot cutting to black, and the branding was never reached.

The worker never had this: it renders `tl.duration`, which already includes the
overlays. There is now a `filmDur` that does the same for the browser, and the
preview uses it too — so you can watch the end card instead of only rendering it.

## The subtitles drifting off the words

The picture was drawn on `performance.now()` while the voice played on the
AudioContext's clock. Two clocks, and a real-time capture: at 1080×1920 the
browser drops frames under load, wall-clock keeps running, and the picture
slides away from the sound. What you see is the text arriving late.

The loop now reads its time from **the same clock the voice is playing on**.
That cannot un-drop a frame, but it stops the error accumulating — a late frame
is drawn at the time it is actually shown, so words and captions stay together.

## And a change of emphasis

The real-time capture was the big red button and the deterministic render was a
grey one underneath. That is backwards, and it is why these three faults were
found in a delivery rather than in a draft.

**Randează montajul curent (cloud)** is now the primary action. *Randează
clipul* is secondary, with a line under it saying what it is: free, instant, and
liable to drift under load — a draft, not a master. It also notes that the
synthesised music bed exists only in the cloud render, because the browser has
no way to make it.

## Deploy

One file, no SQL.

```
app/admin/studio/page.tsx
```

## Verification

`_verification/21-browser-render.cjs` → 20 assertions. The Studio page is a
React component and cannot be imported into a test, so these read its **source
with comments stripped** — a commented-out line can never pass — plus the film-
length arithmetic, which is pure:

- the guide is drawn only when guides are on, the recorder asks for none
- the recording stops at the film, not the scenes, and nothing anywhere still
  ends a capture at `totalDur`
- an end card past the last shot extends the film to 30s; one inside it does not
- the recorder reads `ac.currentTime`, and no wall-clock remains in that loop
- the cloud render carries the primary style and the capture does not

---

*If it still drifts after this:* the remaining cause is genuinely the machine —
a real-time capture of a 1080×1920 canvas is heavy, and nothing in the browser
can guarantee it. That is the argument for the cloud render, which draws frame
by frame with no clock at all.
