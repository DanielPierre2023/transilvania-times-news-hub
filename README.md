# tt-social-card-cream

The new **cream** social card you approved. Retires the red speech-bubble card and
replaces it with the Independent-style layout: **4:5 portrait, full-bleed photo on
top, a solid cream band below** with the headline in Lora, a **red rubric chip**
mapped to the article's category, the **logo in the top-right corner**, the
**domain inside the band**, and a **slanted red "ULTIMA ORĂ" flag** for breaking
news only.

The manual generator and the auto-post fan-out draw the **identical** card — it's
one renderer.

---

## What to commit

| File (repo-relative) | Change |
|---|---|
| `lib/social/card.ts` | **Rewritten** to the cream template. New `renderCard(options)` signature (options object), a **4:5 `portrait`** format that is now the default, content-sized band, rubric chip, Lora headline, footer (wordmark + domain over a hairline), logo badge top-right, slanted breaking flag. `band: 'cream' \| 'navy'` — cream is the default; **navy is kept in reserve** if you ever want it (e.g. breaking). |
| `lib/social/share.ts` | Auto-post now renders the **4:5 cream** card and passes the article's **category** as the rubric (adds `category` to the article read). This is the multi-platform fan-out `share.ts` **with the new card wired in** — commit this version; it supersedes the one from `tt-social-fanout-pack`. |
| `app/admin/social/page.tsx` | Passes the selected article's **category** as the rubric, defaults the format picker to **4:5**, and calls the new `renderCard(options)`. |

**Unchanged, keep as-is:** `app/admin/components/ArticleEditor.tsx` and
`app/admin/articles/page.tsx` from the fan-out pack are **not** touched here.

### Apply

Just **commit the 3 files.** Netlify builds them.

- **No SQL** — the card reads the existing `blog_posts.category` column (already there).
- **No function deploys** — this is purely the client-side renderer.

---

## How it behaves

- **Rubric chip = the article's category, uppercased** (LOCAL, ECONOMIE, POLITICĂ, METEO…). No category → no chip (the card still renders cleanly). If you ever want prettier or shorter labels for specific categories, that's a one-line map — say the word.
- **Format:** auto-posts render **4:5 (1080×1350)** — ~25% more feed space than the old square. The manual generator still offers 1:1, 9:16 and 1200×630; the renderer adapts the band to any of them (4:5 / 1:1 / 9:16 are the ones it's tuned for).
- **The band hugs its content** — a 2-line headline gives a shorter band and a taller photo; a 3–4-line headline grows the band and shrinks the photo (down to a floor), and the headline auto-shrinks a touch if it would crowd the photo. No clipping.
- **Logo:** loads your real `/assets/logos/logo-transilvania-times.png` onto a small white chip in the top-right, sized to fit any aspect. If that asset ever fails to load, it falls back to a compact red **TT** chip (never a wide wordmark) so the card never breaks.
- **Breaking:** the slanted red **ULTIMA ORĂ** flag shows **only** when the article is flagged breaking.
- **Domain** rides in the band footer on every card — your brand travels on every screenshot and repost.

---

## Verified here

- `tsc --noEmit` (your `tsconfig.json`, TS 5.8.3, full `npm install`) — **0 errors, project-wide**.
- `eslint` on all 3 files — **0 problems**.
- **Visual:** the real `card.ts` was bundled and rendered headless (not a CSS mock) across Local / Economie / Ultima oră — band sizing, rubric chip, Lora headline, footer and breaking flag all correct. (Preview sent in chat; the "TT" badge there is the fallback — your real logo shows live.)

## After you commit

Open `/admin/social`, pick an article, and hit **Generează imagine** — you'll see
the real card with your real logo. From then on every auto-post uses it too.
Nothing else to change.
