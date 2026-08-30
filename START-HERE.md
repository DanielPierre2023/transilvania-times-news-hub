# tt-edit-loop — why the change did not come out, and three fixes so it cannot happen again

## The short answer

**Almost certainly you pressed “Randează” on the version row.** That button
renders the *frozen snapshot* of that version — deliberately, so an approved
film re-renders identically a year later. It ignores everything you have just
edited, and it said the same word as the button that renders your edits.

To render what is on screen, use the button on the right: **“Randează montajul
curent”**. Version rows now say **“Randează v3”** so the two can never be
confused again.

There is a second reason it may not have changed, and it applies even if you
used the right button: **editing the script does not regenerate the voice.**
Nothing can do that automatically — it costs money and takes a minute — so the
film renders with the previous audio and, until now, nothing said so.

## The procedure

**To change what the voice says**

1. Edit the text in **Voce (voiceover)**.
2. Press **Generează voce**. Wait for the player to appear — the length and the
   LUFS reading underneath both change when it is new.
3. Press **Auto din voce** in **Subtitrări** — the old subtitles are timed to
   the old audio and will drift otherwise.
4. Press **Corectează** if it flags reading speed.
5. **Salvează**, then **Trimite spre aprobare** → renders as a new version.

**To add a background track**

1. **Muzică → Încarcă track**.
2. The panel now shows the file name, a player and a volume slider. If you do
   not see those three things, the upload did not happen.
3. Volume defaults to 18%. It ducks automatically to −18 dB under the voice and
   comes back up after.
4. An uploaded track takes priority over the synthesised **pat muzical**; untick
   that or leave it, either is fine.

**Then render**

- **Randează montajul curent** (right-hand side) → renders what is on screen.
- **Randează v3** (version row) → renders that frozen snapshot instead.
- Or **Trimite spre aprobare** first, which freezes a new version, then render it.

## What I changed so this stops biting

**1 · The two buttons no longer share a name.** The version row says *Randează
v3*; the cloud button says *Randează montajul curent*. Both carry a tooltip
saying which is which. Same word for two different things is how you edit a
script, press render, and get the old film back with no error anywhere.

**2 · The music panel says whether a track is attached.** File name, an audio
player, a remove button, the volume as a number, and a line explaining the
ducking. Previously the only sign of a successful upload was a volume slider
quietly appearing, so a failed upload and a successful one looked nearly the
same — and *“I uploaded a track but I cannot see if it is uploaded”* is a
sentence that has now been said twice in this project.

**3 · The film says when it is out of date with itself.** A banner above the
render button appears when:

- the script has changed since the voice was generated, or
- the subtitles were aligned to a previous voice.

It names which, and what to press. Neither can be fixed automatically — both
cost a call — so the only honest option is to say so before you spend a render
finding out.

## Deploy

One file, no SQL.

```
app/admin/studio/page.tsx
```

`tsc` 0 errors, `eslint` 0 errors, 41 warnings (unchanged).

---

*A note on v3 itself:* it is already rendered and green, including the typeface
check. If you re-record the voice, the shots do not need regenerating — they
cost nothing to reuse. Only the voice, the subtitles and the render change, so a
new version is about a minute of worker time and no fal spend at all.
