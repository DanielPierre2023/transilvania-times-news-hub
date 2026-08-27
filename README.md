# Fixes for transilvania-times-news-hub

Repo    : github.com/DanielPierre2023/transilvania-times-news-hub
Branch  : main   (base commit 3cc34b9)
Host    : Netlify — project `bespoke-unicorn-cefa67` → transilvaniatimes.com
Verified: `npx tsc --noEmit` passes on the patched files (exit 0)

Nothing here was deployed. Three files to copy over, then deploy yourself.

---------------------------------------------------------------------------
## BUG 1 — "Adaugă prezentator / Adaugă clip does nothing"
---------------------------------------------------------------------------

FILE: app/admin/newsroom/page.tsx

### Evidence

`app/admin/newsroom/page.tsx:240`

```js
async function uploadLibraryAsset(file, kind, name, isReal, personName) {
  if (!file) return                                                  // silent
  if (!name.trim()) { setError('Dă un nume asset-ului din bibliotecă.'); return }
```

The name field is MANDATORY. When it is empty the function returns at line 242
— before the storage upload and before the DB insert. That is why the browser
Network tab shows no request at all: nothing is ever sent.

It does call `setError(...)`. But the error banner is rendered at line 2137,
while the upload button is at line 2412 — 275 lines further down the page. When
you are scrolled to the presenter library, that banner is off-screen. So the
click produces no request, no console error, and no visible message.

Confirmed against the live site: no request to `newsroom_assets` or to
`supabase.co/storage` was ever made when the button was clicked.

### What changed (4 edits, 15 lines)

1. New state `libError` (line ~116).
2. Empty-name branch now sets `libError` as well as the global `error`.
3. `libError` renders INLINE, directly under the add row (line ~2424), where
   you are actually looking.
4. Clip picker `accept` widened:
       video/mp4,video/webm
   ->  video/mp4,video/webm,video/quicktime,video/x-matroska
   Stock footage is very often .mov — with the old list those files were greyed
   out in the Windows file picker and could not be selected at all.

### THE IMMEDIATE WORKAROUND — no deploy needed

Type a name into "Nume clip" / "Nume prezentator" FIRST, then click the button.
It works today, unchanged. The patch only makes the requirement visible.

---------------------------------------------------------------------------
## BUG 2 — blank bulletin preview, blocked video (CSP)
---------------------------------------------------------------------------

FILE: netlify.toml

### Evidence

Browser console, verbatim:

```
Loading media from 'blob:https://transilvaniatimes.com/fc1c8e4a-...' violates
the following Content Security Policy directive:
"default-src 'self' https://zimpimoierpsocnmnizm.supabase.co".
Note that 'media-src' was not explicitly set, so 'default-src' is used as a fallback.
```

Your CSP sets `img-src ... blob:` (so images work) but has NO `media-src` rule.
Video therefore falls back to `default-src`, which does not allow `blob:`.

Everything the Studio renders in the browser is a blob: URL, so:
  * the composed bulletin player is blank
  * `URL.createObjectURL(file)` previews of a picked video are blocked

NOTE: earlier I blamed this on my browser extension. That was wrong. It is your
own CSP, and it affects every visitor, not just me.

### What changed

Added to the CSP, nothing removed:

```
media-src   'self' data: blob: https://...supabase.co https://v3.fal.media https://fal.media;
worker-src  'self' blob:;
child-src   'self' blob:;
connect-src ... added: data: blob: https://queue.fal.run https://fal.run https://v3.fal.media https://fal.media
script-src  ... added: https://fundingchoicesmessages.google.com
```

* `media-src`  — the actual fix for blank video
* `worker-src` / `child-src blob:` — in-browser MP4 rendering uses blob workers
* `queue.fal.run` etc. in connect-src — the Studio polls fal directly from the
  browser; without it those calls are blocked
* `fundingchoicesmessages.google.com` — removes the recurring AdSense console
  error you saw (cosmetic)

---------------------------------------------------------------------------
## BUG 3 — 404 on every page load
---------------------------------------------------------------------------

FILE: app/admin/layout.tsx

### Evidence

```
app/admin/layout.tsx:42   { label: 'Mix editorial', href: '/admin/content-mix', icon: PieChart }
app/admin/content-mix/    DOES NOT EXIST
```

I checked every sidebar entry against the routes that actually exist. Sixteen
resolve; one does not:

```
OK    /admin/analytics      OK    /admin/newsletter     OK    /admin/sponsors
OK    /admin/articles       OK    /admin/newsroom       OK    /admin/studio
OK    /admin/checker        OK    /admin/scraper        OK    /admin/subscribers
OK    /admin/comments       OK    /admin/settings       OK    /admin/vizualuri
OK    /admin/dashboard      OK    /admin/social
OK    /admin/editor         OK    /admin/inbox
404!! /admin/content-mix
```

Next.js prefetches sidebar links, so it requests `/admin/content-mix?_rsc=...`
on every admin page load and gets 404. The page is simply missing.

### What changed

Removed that one nav entry, and removed the now-unused `PieChart` import (it
would otherwise trip the eslint no-unused-vars rule during build).

If you WANT that page, create `app/admin/content-mix/page.tsx` instead and put
the nav line back.

---------------------------------------------------------------------------
## DEPLOY
---------------------------------------------------------------------------

Copy these three files over the ones in your repo:

```
netlify.toml                     ->  netlify.toml
app/admin/layout.tsx             ->  app/admin/layout.tsx
app/admin/newsroom/page.tsx      ->  app/admin/newsroom/page.tsx
```

Commit, push to `main`. Netlify builds automatically.

## VERIFY AFTER DEPLOY

1. CSP is live — PowerShell:

```
curl.exe -sI https://transilvaniatimes.com/ | findstr /i "media-src"
```
   Prints a line -> fix is live.

2. Open /admin/newsroom with Ctrl+F5. The console 404 for `content-mix` is gone.

3. Click "Adaugă clip prezentator (MP4)" with the name box EMPTY.
   You should now see a red message under the row instead of silence.

4. Type a name, pick your .mp4 (or .mov — now accepted), and it uploads.

---------------------------------------------------------------------------
## NOT CHANGED — decide for yourself
---------------------------------------------------------------------------

* `.env` is committed and the repo is public. It contains only the Supabase
  project id and the PUBLISHABLE (anon) key, both public by design — so nothing
  is leaked. Still worth `git rm --cached .env`, since .gitignore already lists
  `*.env` and the file slipped in before that.

* Supabase edge functions currently deployed by me earlier today, which you may
  want to review or roll back in the dashboard:
      generate-motion  v11   (model raised to kling v2.5-turbo/pro — COSTS MORE
                              per clip than your original v2.1/standard; the
                              file I sent earlier reverts this)
      newsroom-anchor  v26   (sync_mode bounce -> loop; safe)
      el-diag          v2    (my diagnostic — DELETE IT)

* restore-presenters.sql in this folder re-links the presenter/clip rows that
  were lost. All the underlying files are still in storage. Run it only if you
  want the old assets back — if you are switching to stock footage, skip it.
