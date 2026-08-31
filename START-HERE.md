# tt-captions — the captions you watch are now the captions you receive

## What was wrong

There were **three** caption painters in this app, and no two of them agreed.

| | family | weight | case | size on 9:16 | size on 16:9 | position | plate |
|---|---|---|---|---|---|---|---|
| preview (canvas) | Inter | 700 | UPPERCASE | **61 px** | **35 px** | 0.88 | rounded, `rgba(21,11,6,0.72)` |
| preview, karaoke | Inter | 700 | UPPERCASE | **69 px** | **39 px** | 0.88 | rounded |
| our worker (the file) | Inter | 600 | Mixed case | **49 px** | **49 px** | 0.76 | square, `rgba(0,0,0,0.55)` |
| hosted provider | Inter | 700 | Mixed case | **61 px** | **35 px** | 0.88 | rounded |

Read the size columns across. The preview sized captions off frame **height**,
so the same setting gave 61 px on a vertical master and 35 px on a horizontal
one — the caption changed size when you changed aspect, for no reason anyone
asked for. The file sized them off the **short edge**, which is the measurement
that keeps a caption the same visual weight in every aspect: 49 px in both.

On the 9:16 master you actually publish, the preview was showing captions **25%
larger** than the ones being delivered, drawn **230 px lower** (0.88 against
0.76 of a 1920-tall frame — the file clamps into the reels safe area, the
preview did not), in a heavier weight, in capitals the file never used.

That is the "the subtitles are too big" note from the first film. It was fixed
in the renderer months ago and left standing in the preview, so it stayed true
of the only thing anyone actually looks at.

## And karaoke was not real

`lib/timeline/draw.ts` ignored `source.words` entirely. The renderer drew plain
text. So *cuvânt cu cuvânt* was a mode you could select, watch working in the
preview, and never receive in a file. Not a mismatch — a feature that existed
only on screen.

## What this package does

**One painter.** The preview's subtitle code is deleted. Captions are now built
as real clips on the shared overlay timeline, styled by `captionStyle(kit,
subScale)` and clamped by `captionY(kit, SUB_POS[subPos])` — the same two
functions the worker calls. There is no longer a place for them to drift apart,
because there is no longer a second implementation to drift.

**Karaoke is implemented in the renderer.** `drawKaraoke` in the shared drawer:
word layout with wrapping, the word being spoken picked out in the kit accent,
words already spoken in the full caption colour, words not yet reached dimmed.
It reads `op.localFrame` — a compiled op now knows how far into its own clip it
is, which is what makes per-word timing possible at all.

**The hosted-provider export was the third painter, and it is fixed too.** When
the provider is not our worker, `buildCloudSpec` used to carry its own hard-coded
Inter 700, its own plate colour and an unclamped Y. It now reads the kit and
sizes off `Math.min(W, H)` like everything else.

## Deploy

Four files, no SQL.

```
app/admin/studio/page.tsx
lib/timeline/draw.ts
lib/timeline/compile.ts
lib/timeline/types.ts
```

The worker does not need a separate deploy for this — its Dockerfile compiles
`lib/timeline` from the repository at build time, which is exactly why that
arrangement exists. Redeploying the worker picks up `drawKaraoke` automatically.

## Verification

`_verification/22-captions-parity.cjs` → **18 assertions, all passing.** It reads
the page source with comments stripped, so a commented-out line cannot pass, and
it renders actual pixels for the karaoke half.

- nothing upper-cases a cue for drawing any more
- no caption font anywhere is sized off frame height
- the old karaoke painter and the word-grouping memo only it used are gone
- captions are built into the shared overlay timeline, styled by the kit,
  clamped into the safe area
- the shared drawer implements karaoke and `drawText` hands off to it when a
  clip carries word timings
- **rendered pixels**: at frame 3, 12 and 22 of a three-word line, the accent
  colour is present and the count of accent pixels *changes* — the highlight
  moves; already-spoken words are in the full caption colour; the identical clip
  with the word timings removed has **zero** accent pixels
- the hosted-provider spec takes the kit style, clamps Y, sizes off the short
  edge, and retains no hard-coded family, weight, colour or plate

## Full regression after the change

```
10-vision            35/35     17-sound             25/25
11-payload           35/35     18-fonts             15/15
12-inspect           30/30     19-wordmark          11/11
13-resample           8/8      20-reading           17/17
14-brand             45/45     21-browser-render    23/23
15-colour            10/10     22-captions-parity   18/18
16-layers            11/11
```

Plus a real end-to-end encode (250 frames, 1920×1080, 25 fps) — 16/16, delivered
at −15.2 LUFS / −7.7 dBTP with the music sitting 36.4 dB under the voice — and
the caption/loudness suite at 31/31. `tsc` 0 errors, `eslint app lib` 0 errors.

## What I would look at first after deploying

Turn subtitles on, set *cuvânt cu cuvânt*, and compare the preview against a
worker render of the same project. They should now be indistinguishable. If the
captions look **smaller than you remember**, that is correct — you were being
shown 61 px and delivered 49 px, and 49 px is the one the kit specifies. If you
want them larger, the *mărime* slider is the honest way to do it, and it will
now move both.
