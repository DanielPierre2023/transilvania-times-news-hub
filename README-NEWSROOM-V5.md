# Newsroom v5 — the voice + timing fix

Three files. Deploy in this order.

```
1. FUNCTION   supabase/functions/generate-voiceover/index.ts   ← revert (do first)
2. FUNCTION   supabase/functions/newsroom-anchor/index.ts       ← + the normalize action
3. GITHUB     app/admin/newsroom/page.tsx                       ← + the cifre → litere button
```

---

# Your text is yours

**Nothing rewrites what you type.** Not the voice function, not the sectionizer,
nothing. That was the actual defect in the version that reached your air: the
rewrite sat *downstream* of the script box, so whatever you typed was silently
replaced on the way to the voice. You could not hand-fix anything.

Now the automatic conversion runs in exactly one place — on **freshly generated**
script, once, before it ever reaches you. From the moment it is in the box it is
yours. Type anything. It is spoken as written.

And when you *do* want digits converted, there is a button under the script box:

```
  [ cifre → litere ]   [ anulează ]
```

You press it, you see the result in the box, you edit it or undo it. It is
deterministic, costs nothing, and never runs on its own.

---

# What went wrong, and why

The compositor does not time lower-thirds by estimate. It takes a story's
opening words **as written** and finds them in the word timeline of the
**actual audio**:

```ts
const probe = norm(st.text).split(' ').slice(0, 5)   // words AS WRITTEN
```

That only works while the written script and the spoken audio are the same
words. I put the Romanian normaliser inside `generate-voiceover`, so the script
box said `139` while the audio said `o sută treizeci și nouă`. Every probe
missed, every headline anchored to the wrong second, and the bulletin drifted.

**The fix is architectural: convert once, at script time.** What the operator
reads, what the compositor times against, and what Ioana speaks are now one
text.

---

## 1 · `generate-voiceover` — reverted, byte for byte

This file is **identical to your pre-31-August production source**. Verified by
diff against `_ORIGINALS/`. It keeps the admin gate, `apply_lexicon()`,
`expandRoLegalRefs()`, the pauses and all seven engines. `roSpeech()` is gone.

Your lexicon stays exactly where it was — the front door for pronunciation,
editable without a deploy.

## 2 · `newsroom-anchor` — the normaliser moves here, corrected

### The numerals are now TTS-safe, not just grammatical

The voice engine breaks compound numerals at their morpheme seams —
`cinci|zeci`, `cinci|sprezece` — which is why you were hand-writing
`cinzecisisase`. Canonical Romanian would have reintroduced that on every
bulletin, and worse at scale: 50.000 is *cincizeci de mii*, 50.000.000 is
*cincizeci de milioane*. Bigger numbers make it **more** likely, not less.

So only the five-forms are contracted and joined, exactly as you proved on air:

Two separate rules, and I had them confused:

**JOINING applies to every tens compound.** The engine puts a seam at
`X | și | Y` wherever it occurs — 29 came out as *douăzeci și nouă* in three
pieces. Written as one token it flows:

```
21 douăzecișiunu     45 patruzecișicinci   74 șaptezecișipatru
29 douăzecișinouă    56 cinzecișișase      99 nouăzecișinouă
```

**CONTRACTION applies only to the five-forms**, which is the part you said to
keep narrow:

```
15 cinsprezece    50 cinzeci    50.000 cinzeci de mii    50.000.000 cinzeci de milioane
```

Round tens and teens are untouched — `douăzeci`, `treizeci`, `nouăsprezece`.
`TTS_TENS` and `TTS_JOIN_TENS` at the top of the file are the **one place to
tune**: contraction and joining are separate sets, so you can change either
without touching the other.

### The three bugs that reached your air, fixed

| | |
|---|---|
| `/\bm²\|mp\b/` fired on the **mp** inside *timp* → *"în timetri pătrați ce"* | every unit pattern is now a fully-bounded non-capturing group |
| `douăsprezece DE milioane`, `cinci DE milioane` | *de* before *mie/milion/miliard* now follows the same last-two-digits rule as any noun |
| `56%` → `cinzecișișase DE la sută` | `%` converts its own number; a number followed by a preposition is never counted |

Also: `%` reads as **la sută**, not *procente* — what an anchor actually says.

### The model no longer spells numbers

Your prompt told it to write legal references in letters. It generalised that
and produced `cinsprezece` and `cinzecișișase` itself — which is why `139`
stayed a digit while `56` did not. **Two converters disagreeing** was the real
disease. The prompt now demands digits everywhere, including law numbers, and
one deterministic converter owns the conversion.

Lower-thirds are deliberately **left as digits** — a caption is read by the eye,
and `o sută treizeci și nouă de lei` does not fit in 38 characters.

## 3 · `app/admin/newsroom/page.tsx` — the early graphics

Story 1 was clamped only at `0`, so its start was whatever the proportional
estimate said. That estimate is `words / total × duration`: it assumes a
constant speaking rate and knows nothing about the pause after the greeting. An
opening is read more slowly than the body and is followed by real silence, so
the estimate lands early **every time** — the first photo and headline came up
while you were still hearing *"Bună seara"*.

The greeting's **end** is now anchored on the real word timeline and becomes the
floor for story 1, plus the configured `pauseMs`. If the greeting cannot be
located it falls back to the old estimate plus the pause — never worse than
before. A bad match can never push story 1 past a fifth of the bulletin.

---

# Verified before shipping

```
node   your actual 31-Aug bulletin through the full chain
       written 2103 chars -> spoken 2237 (+6%), sign-off present
node   "în timp ce"                      -> unchanged  ✓ (was "în timetri pătrați ce")
node   56% / 15 sept / 50.000 / 50.000.000 -> cinzecișișase la sută, cinsprezece
                                              septembrie, cinzeci de mii,
                                              cinzeci de milioane  ✓
node   12.500.000 / 5.625.000            -> douăsprezece milioane cinci sute de
                                              mii / cinci milioane...  ✓
node   1 leu / 1 oră / 2 ore / 2 lei / 100 / 115 / 120 lei — agreement + "de"  ✓
diff   generate-voiceover vs your pre-31-Aug source — IDENTICAL
esbuild newsroom-anchor  OK
tsc     full repo, unfiltered — 0 errors
```

The one thing I have **not** been able to test is the audio itself. The numerals
above are your spellings, applied consistently; if any of them still breaks on a
different engine, `TTS_TENS` is one line.
