# What I fixed, and the 5 things left that need your hands

## DONE — already live, nothing for you to do

**Automation is switched back on.** I ticked both boxes in Setări and saved.
Confirmed in the database:

    scraper_enabled   = true
    processor_enabled = true
    auto_publish      = false     <- left OFF on purpose: processed articles
                                     stay as drafts for you to check
    updated_at        = 2026-08-23 16:00:53

They had been off since **29 May 2026**. That is why the scraper cron logged
`[cron] scraper disabled; exiting` twice a day and wrote nothing.

**Your processor is proven working.** I ran one article end to end from your
Scraper page — 44 seconds, draft created in both languages, queue went 67 -> 66.
Nothing in the pipeline is broken.

---

## WHY YOU STILL HAVE TO PASTE THINGS

I tried to deploy these four functions to Supabase directly. **A safety check in
my environment blocked me from deploying to your production project.** I could not
get around it and I am not going to try. So the code is here, verified, and the
paste is yours. I am sorry about that — it is a limit on me, not a shortcut.

---

## THE REAL BUG: the admin gate rejects your own cron jobs

`weather-alert` has returned **401 on all 12 cron runs** in the log window. It boots
normally every two hours and then denies itself. Here is why.

The inlined `requireAdmin()` gate authorises an internal caller like this:

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (serviceKey && token === serviceKey) return null;

A **string comparison**. Your `pg_cron` jobs send a service-role JWT that was
hard-coded into the job command when the job was created. When the project's
service-role key is rotated — or migrated to the new `sb_secret_...` key format —
that hard-coded token stops being equal to `SUPABASE_SERVICE_ROLE_KEY`. The
comparison fails, execution falls through to the "is this a logged-in admin?"
branch, `auth.getUser()` rejects a service-role token, and the function returns 401.

Every function using this gate has the same fault. It is silent: the cron job
itself reports `succeeded` (it queued the HTTP request fine), so nothing surfaces.

### The fix

Keep the fast exact-match, then add a second check that asks the token to *prove*
it is service-role by doing something only service-role can do:

    try {
      const { createClient: _cc } = await import(".../supabase-js@2");
      const _probe = _cc(Deno.env.get('SUPABASE_URL')!, token, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: _svcErr } = await _probe.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (!_svcErr) return null;
    } catch (_e) { /* not service-role - fall through to the admin-user check */ }

This is not a loosening. `auth.admin.listUsers` is a service-role-only endpoint and
GoTrue verifies the token's signature, so an anon key or a forged token still fails.
What it buys you is that the gate keeps working across key rotations instead of
silently killing every scheduled job.

Each of the three gated functions gets **exactly +17 lines, 0 removed**. All three
bundle-check with esbuild and pass a `tsc` scope check with 0 undefined identifiers.

---

## STEP 1 — paste four functions (Dashboard -> Edge Functions)

| # | function | what it does | keep verify_jwt |
|---|---|---|---|
| 1 | `weather-alert` | gate fix — stops the 401 on every cron run | **true** |
| 2 | `tt-process-scraped-article` | gate fix — needed now that the processor cron is on | false |
| 3 | `tt-newsletter-digest` | gate fix — same fault, weekly Monday job | **true** |
| 4 | `generate-voiceover` | the pause between news items | **true** |

Each file is at `supabase/functions/<name>/index.ts` in this archive. Do not change
the `verify_jwt` setting on any of them — the column above is what each one has today.

Functions 1–3 are the **live** source plus the 17-line fix and nothing else.
Function 4 is the pause version you already have in the commit archive.

## STEP 2 — re-activate the processor cron job

The processor's scheduled job is switched off at the database level as well, which
is a separate switch from the checkbox in Setări:

    jobid 12  tt-process-scraped-twice-daily  30 6,18 * * *  active = FALSE

Run this in the Supabase SQL editor (I only have read access, so I cannot):

    UPDATE cron.job SET active = true WHERE jobname = 'tt-process-scraped-twice-daily';

Do this **after** pasting `tt-process-scraped-article` in step 1. If you activate the
job while the old gate is still deployed, every scheduled run will 401 exactly the
way `weather-alert` has been doing.

---

## How to check it actually worked

`weather-alert` runs every two hours on the hour. After you deploy it, wait for the
next even hour and look at the function's logs in the Dashboard. You want to see
the function do real work instead of returning immediately. Before the fix the whole
run was three lines — `booted`, `Listening`, `shutdown` — with no output in between,
because the gate denied it before any of the code ran.

For the scraper: the next run is **18:00 UTC**. New rows should appear in
`scraped_articles`, and at 18:30 the processor should start turning them into drafts.

---

## One thing I have deliberately NOT done

The six *ungated* functions from the earlier `admin-gates.zip` — `tt-generate-article`,
`tt-scrape-rss`, `tt-rewrite-blog-post`, `tt-adsense-quality-check`,
`send-banner-pricing`, `tt-county-backfill`. **Do not deploy that archive.** It uses the
old string-comparison gate, which is the exact fault that has been killing
`weather-alert`. Deploying it would have taken down your scraper cron too.

I will rebuild that archive on top of this corrected gate once you confirm
`weather-alert` comes back green. That order matters: prove the fix on one function
that is already failing before applying it to six that are currently working.
