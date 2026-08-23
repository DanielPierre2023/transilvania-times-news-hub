# Line-by-line audit — 23 Aug, 18:26 UTC

I verified every item against the actual live source (Supabase deployed content,
GitHub HEAD `bd6dfb5`, the running website, and the database), not against
assumptions. Two subagents fetched each deployed edge function and compared it
byte-for-byte (SHA-256) to the intended source. Here is exactly what is done and
what is not.

## ✅ DONE — verified, no action needed

### Supabase edge functions — all deployed correct, byte-verified
Every deployed function was fetched and SHA-256-matched against its intended source.
All identical, all carrying their fix:

| function | live version | fix confirmed in deployed bytes |
|---|---|---|
| generate-voiceover | 16 | pause_ms, ssmlWithBreaks, textWithMinimaxPauses, textWithTagPauses |
| weather-alert | 9 | gate `listUsers` probe **and** feed User-Agent + `*/*` (406 fix) |
| tt-newsletter-digest | 17 | gate `listUsers` probe |
| tt-process-scraped-article | 97 | gate `listUsers` probe |
| tt-generate-article | 54 | gate (requireAdmin + listUsers + call site) |
| tt-scrape-rss | 24 | gate |
| tt-rewrite-blog-post | 22 | gate |
| tt-adsense-quality-check | 13 | gate |
| send-banner-pricing | 8 | gate |
| tt-county-backfill | 8 | gate |

`verify_jwt` preserved correctly on every one (none flipped by accident).

### Database + cron — verified live
- `automation_settings`: scraper_enabled = **true**, processor_enabled = **true**, auto_publish = false.
- cron jobid 11 (scrape) **active**, jobid 12 (process) **active**, jobid 18 (weather) **active**.

### The gate fix is not just deployed — it is PROVEN
The 18:00 UTC weather-alert cron run returned no 401 (it reached the function body).
The service-role probe accepts your real cron token. The 24-hour 401 loop is over.

### Frontend — all committed on HEAD `bd6dfb5`
Grep-verified on the committed HEAD: pause_ms + the pause dropdown; all 4 cover call
sites now `generate-cover-image` with **zero** `tt-generate-cover`; `api.open-meteo.com`
in both next.config.ts and netlify.toml; `Europe/Bucharest` in LayoutShell,
RelatedArticles, CommentSection, ArticleLangToggle; `suppressHydrationWarning` in
LayoutShell; the Zboruri flights button intact.

### Weather widget — live
The header shows the live temperature (21°C at check time); CSP allows open-meteo.

### `_shared/requireAdmin.ts` — committed
The shared gate helper now carries the `listUsers` fix in the repo. Done.

---

## ⛔ NOT DONE — two items, neither breaking production

### 1. The hydration #418 fix is committed but NOT deployed to the live site

This is the real one. Facts, not assumption:
- Your current GitHub HEAD `bd6dfb5` (committed 18:00 UTC) contains the hydration fix.
- The **live Netlify deploy** (deploy `6a8b3dd7`, published **18:38 UTC**) is built from
  commit **`f206cfdb`** — a DIFFERENT commit, not your current HEAD, and not in the
  branch history I can fetch.
- There is **no Netlify deploy of `bd6dfb5`.** The live JS bundle hash
  (`4bd1b696…`) has not changed in hours, and the homepage still throws React #418.

So the fix exists in your repo but the website is running older code. **Nothing to
edit — you need to trigger a fresh Netlify build of the current HEAD:**

  Netlify → your site → **Deploys** → **Trigger deploy** → **Clear cache and deploy site**

After it goes green, hard-reload the homepage. The #418 should be gone. I could not
confirm the fix's live *effect* yet precisely because it has never run in a browser —
the fix targets the known cause (the unpinned `new Date().toLocaleDateString`), and I
will re-check the console the moment it deploys if you want.

Why the newest commit didn't auto-deploy is worth a glance: your recent commits are
GitHub "Add files via upload" folder uploads (there are several "Delete … directory"
commits in the log), and one of those may have landed without triggering Netlify, or
a build failed silently. The manual trigger above sidesteps it.

### 2. GitHub is behind production on 7 edge functions (repo ≠ deployed)

Production is CORRECT — this is only about your repo matching what's live, for
disaster recovery. The committed copies of these 7 do **not** contain what is
deployed:

- The **6 gated functions** (tt-generate-article, tt-scrape-rss, tt-rewrite-blog-post,
  tt-adsense-quality-check, send-banner-pricing, tt-county-backfill): deployed WITH the
  gate, but the repo still holds the ungated source. Diff: repo is missing 77 lines.
- **weather-alert**: deployed v9 WITH the feed-406 fix, but the repo holds the
  gate-only version. Diff: repo is missing the 14-line feed fix.

The `supabase/functions/` folder in this zip contains the 7 files **exactly as
deployed** (each SHA-matched to production). Commit them so the repo matches live:

    git add supabase/functions/
    git commit -m "Sync repo with deployed edge functions: admin gates + weather-alert feed fix"

---

## Bottom line

Production — Supabase functions, database, cron, the proven gate, the widget — is
fully done and verified. The only thing a visitor still sees wrong is #418, and that
is one Netlify redeploy away because the site is running an older commit than your
HEAD. The edge-function repo drift is bookkeeping, not a live problem.
