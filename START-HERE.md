# tt-reading — the Corectează button did not correct the thing next to it

I pressed it on the real film to check, and nothing happened. Here is why, and
what it does now.

## The bug was mine, and it is a nasty shape

`conformCues` handled minimum duration, overlaps and flicker gaps. **Reading
speed was the one rule it did not implement.** I wired a button to it, labelled
it *Corectează*, and put it directly beside a warning reading *“5 de corectat —
over the 17 characters per second limit”*.

The button was not broken. It was solving a different problem next to the label
for this one, which is worse, because it looks fixed.

## What it does now

A reading-speed pass, written the way a subtitler works:

- A cue that is too fast is first given more time **at the end**, into the gap
  before the next cue. Holding a caption after the line has been spoken is free
  and nobody notices.
- Only if that is not enough does it take time **at the front**, and never more
  than half a second, because a caption that appears well before the words are
  said reads as a mistake.
- Nothing ever overlaps, nothing passes the seven-second ceiling, and the text
  is never touched — this changes timing, never words.
- The call now passes the **film duration** in. The slack is almost always at
  the end, because the picture outlasts the voice; without that the last cue had
  nowhere to grow into, which is exactly where the room was.

## And a limit I have to be straight about

Reading speed is characters over time. A cue can be given more time only if
there **is** time beside it, and it cannot be made slower by splitting, because
splitting changes neither figure.

On the delivered spot the first three lines sit 0.2 seconds apart and the voice
delivers sixty characters in two and a half seconds — 24 characters per second
of *speech*. No retiming fixes that. The only remaining levers are a shorter
line or a slower read, and this function touches neither.

So the promise is **strictly better, never worse, and honest about the rest**:
on the real cue list it fixes the ones with room and leaves three, and the panel
now says why in plain words instead of leaving a button that looks like it
failed.

*My first version of the test asserted “after conforming, nothing is too fast”.
That assertion was impossible to satisfy and I had to correct it — which is
recorded in the test file, because a test that demands the impossible gets
deleted by the next person rather than understood.*

## Deploy

Repo only, two files.

```
lib/timeline/captions.ts      the reading-speed pass
app/admin/studio/page.tsx     passes the film length; explains what is left
```

## Verification

`_verification/20-reading.cjs` → 17 assertions, run against the **actual cue
list from the delivered spot**:

- the number of too-fast cues strictly decreases
- no cue is made harder to read than it was
- every cue that had room beside it is now inside the limit
- the text is byte-identical afterwards
- nothing overlaps, nothing runs past the end of the film, nothing exceeds 7 s
- a cue with a neighbour hard against it is left alone and **still reported**,
  rather than the conform pretending it is fixed

The existing 31 caption assertions still pass unchanged.
