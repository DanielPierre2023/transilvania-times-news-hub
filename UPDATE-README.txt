UPDATE — NO_INFO status (past flights without live data)
=========================================================

Extract this zip in the ROOT of the repo (transilvania-times-news-hub).
It overwrites 4 files at these exact paths:

  lib/flights.ts                                      <- adds the NO_INFO status ("Fara informatii")
  supabase/functions/flights-sync/index.ts            <- writes NO_INFO into the DB for stale flights
  supabase/functions/flights-sync/parse.ts            <- dev twin (delay derivation), keep in sync
  supabase/functions/flights-sync/parse.samples.test.ts  <- tests (44 pass)

Then two actions:

1) Commit + push (Netlify rebuilds the site):
     git add lib/flights.ts supabase/functions/flights-sync
     git commit -m "Flights: NO_INFO status for past flights without live data"
     git push

2) Redeploy the edge function:
     supabase functions deploy flights-sync --no-verify-jwt

After that, tell Claude "done" — he will trigger a sync and verify the
NO_INFO rows in the database.
