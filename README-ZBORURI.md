# Zboruri — Airport Flight Board (Cluj / Târgu Mureș / Sibiu)

A Hermes-style live arrivals & departures board for the three Transylvanian
airports, integrated into the Next.js app. Zero data cost: the data comes from
the airports' own official public boards, collected by a Supabase Edge Function
on a 10-minute cron and served from a Supabase table.

## Architecture

```
airportcluj.ro ─┐
aeroportultransilvania.ro ─┼─►  Supabase Edge Function  flights-sync
sibiuairport.ro ─┘                (pg_cron every 10 min, upsert)
                                          │
                                          ▼
                              Supabase table  airport_flights   (RLS: public read)
                                          │  anon select
                                          ▼
                        Next.js  /zboruri  +  /en/zboruri   (SSR + 60s client refresh)
```

## Files (repo-relative — all complete, nothing to hand-edit)

**New**
- `lib/flights.ts` — shared types, airport metadata, status normalization, bilingual labels, date helpers
- `supabase/migrations/20260823120000_airport_flights.sql` — table + RLS + indexes
- `supabase/migrations/20260823120500_airport_flights_cron.sql` — pg_cron schedule (10 min)
- `supabase/functions/flights-sync/index.ts` — the scraper/sync function (Deno)
- `supabase/functions/flights-sync/parse.ts` — pure parsing logic (unit-tested)
- `supabase/functions/flights-sync/parse.samples.test.ts` — 24 parser tests (`bun parse.samples.test.ts`)
- `app/api/flights/route.ts` — public JSON feed for client auto-refresh
- `app/components/FlightBoard.tsx` — the interactive board (tabs, Plecări/Sosiri, Ieri/Azi/Mâine, filters, search, auto-refresh, RO/EN)
- `app/components/AirportsLogo.tsx` — inline-SVG section mark
- `app/zboruri/page.tsx` — RO page (SSR + JSON-LD)
- `app/en/zboruri/page.tsx` — EN page (SSR + JSON-LD)

**Modified**
- `app/components/LayoutShell.tsx` — added `Zboruri` / `Flights` to `NAV_LINKS`
- `supabase/config.toml` — added `[functions.flights-sync] verify_jwt = false`

## Deploy (you run these — nothing is auto-deployed)

1. **Database** — apply the two new migrations (Supabase SQL editor, or `supabase db push`).
   Before the cron migration, store the target + secret in Vault and set the function secret:

   ```sql
   -- run once in SQL editor, replacing the two placeholders
   select vault.create_secret(
     'https://zimpimoierpsocnmnizm.supabase.co/functions/v1/flights-sync',
     'flights_sync_url');
   select vault.create_secret('<LONG-RANDOM-STRING>', 'flights_sync_secret');
   ```
   ```bash
   supabase secrets set FLIGHTS_SYNC_SECRET='<LONG-RANDOM-STRING>'   # same value
   ```

2. **Edge Function** — `index.ts` is a single self-contained file (no sibling
   imports), so either path works:
   ```bash
   supabase functions deploy flights-sync
   ```
   …or paste `supabase/functions/flights-sync/index.ts` into the Supabase
   Dashboard → Edge Functions editor. (`parse.ts` and `parse.samples.test.ts`
   are dev-only — the local test harness — and are NOT needed to deploy.)

3. **Validate the parsers live (dry run — writes nothing):**
   ```bash
   curl -H "x-sync-secret: <LONG-RANDOM-STRING>" \
     "https://zimpimoierpsocnmnizm.supabase.co/functions/v1/flights-sync?test=1"
   ```
   You'll get per-source counts (e.g. `"SBZ:departure": { "count": 24 }`) plus 3-row
   samples. Confirm all six sources return rows and the sample fields look right.

4. **First populate** — trigger one real run (POST):
   ```bash
   curl -X POST -H "x-sync-secret: <LONG-RANDOM-STRING>" \
     "https://zimpimoierpsocnmnizm.supabase.co/functions/v1/flights-sync"
   ```
   After this the cron (from the migration) keeps it fresh every 10 minutes.

5. **Frontend** — commit + push; Netlify builds automatically. Visit `/zboruri`.

## Two things to know

- **Cluj is schedule-only.** airportcluj.ro publishes the timetable but not live
  status, so CLJ rows show scheduled/estimated times with status `Programat`
  (charters flagged). Sibiu and Târgu Mureș carry true live status
  (`Decolat`, `Aterizat`, `Check-in`, `Întârziat`, …). This is a source limit,
  not a code limit.
- **Licensing is your call as publisher.** The board republishes the airports'
  factual flight data on a commercial publication. Low-risk (public bodies,
  factual data, aggregators already do it) but worth a courtesy note to each
  airport's comms office or a ToS check before it's public. The bot identifies
  itself with a descriptive User-Agent + contact and polls politely (10 min).

## Update — Hermes-exact pass

The board now mirrors hermesairports.com column-for-column:

- **Columns:** Airline (logo chip + name) · Flight · From/To · Time · **Status with the actual time inline** ("Decolat 06:12", "Aterizat", "Estimat 17:45", "Programat") · Share.
- **Rows grouped under date headings** ("Duminică, 23 august 2026").
- **"Live + 12h" toggle** (default, like Hermes) alongside Azi / Mâine.
- **Per-flight share** icons (X, Facebook, native share → WhatsApp/Viber fallback).
- **Airline logos:** rendered as coloured monogram chips keyed by IATA code (robust, no licensing/hosting risk). To use real logos instead, drop `public/airlines/{IATA}.svg` files and swap the `<span class="logo">` for an `<img>` in `FlightBoard.tsx` — the code is isolated to `FlightRowView`.
- **Distinct nav button:** `LayoutShell.tsx` now renders a red "Zboruri / Flights" pill with a pulsing live dot (desktop nav + top of mobile menu), not a plain link.

**New optional secrets** (health alert — emails you if any airport source returns 0 rows):

```bash
supabase secrets set RESEND_API_KEY='...'                 # you already use Resend
supabase secrets set FLIGHTS_ALERT_EMAIL='you@domain'
# optional: FLIGHTS_ALERT_FROM='Transilvania Times <alerts@transilvaniatimes.com>'
```

If unset, the alert silently no-ops — the POST response still lists any `deadSources`.

## Update — real airline logos + homepage widget

**New files**
- `app/components/AirlineLogo.tsx` — real carrier logo by IATA code, with automatic monogram fallback.
- `app/components/NextDeparturesWidget.tsx` — homepage teaser (next departures across all 3 airports → `/zboruri`).

**Modified**
- `app/components/FlightBoard.tsx` — rows now use `<AirlineLogo>`.
- `app/page.tsx` — renders `<NextDeparturesWidget />` right after `<CountyStrip />`.
- `lib/database.types.ts` — added the `airport_flights` table type (so the typed client + `next build` know it).

**Airline logos.** `AirlineLogo` loads `https://images.kiwi.com/airlines/64/{IATA}.png` and falls
back to the coloured monogram chip if the code isn't 2-letter IATA or the image fails. Your CSP
already allows this (`img-src … https:`). Two honest notes: (1) that CDN is a third-party logo host —
common practice for flight boards, but if you'd rather not hotlink, self-host by dropping
`public/airlines/{IATA}.png` files and setting `LOGO_CDN = '/airlines'` (one line in `AirlineLogo.tsx`);
(2) airline logos are trademarks — displaying them for flight information is standard nominative use,
but it's your call as publisher.

**Homepage widget** renders nothing until `airport_flights` has data, so it's safe to ship before the
first sync. It shows on the RO homepage; add `<NextDeparturesWidget lang="en" />` to `app/en/page.tsx`
if you want it on the EN homepage too.

## Update — SEO landing pages + disruption-to-news hook

**Per-airport SEO landing pages**
- `app/zboruri/[airport]/page.tsx` (RO) and `app/en/zboruri/[airport]/page.tsx` (EN) — routes
  `/zboruri/cluj`, `/zboruri/targu-mures`, `/zboruri/sibiu` (+ `/en/...`). Each has tailored intro
  copy, the board pre-focused on that airport, an FAQ section, **FAQPage + Airport JSON-LD**, and
  hreflang. Copy/FAQ live in the new `lib/airport-seo.ts`.
- `app/components/FlightBoard.tsx` gained an `initialAirport` prop (default CLJ).
- `app/sitemap.ts` — the 8 flight URLs are added so they get indexed.

These target searches like "plecări aeroport Cluj" / "Cluj airport arrivals".

**Disruption → editor brief** (editor-in-the-loop; nothing auto-publishes)
- New migration `supabase/migrations/20260823121000_flight_disruptions.sql` — a service-only log table.
- `flights-sync` now detects newly **cancelled** flights and **delays ≥ 60 min**, records each once,
  and emails you a ready-to-run brief (RO) via Resend. It deliberately does **not** write into
  `blog_posts` / your pipeline — the editor decides what becomes an article, so your voices and
  editorial standards are untouched. Wiring the brief straight into `ai-generate-article` is a
  follow-up we can do once you're happy with the trigger.

New optional secret (falls back to `FLIGHTS_ALERT_EMAIL` if unset):

```bash
supabase secrets set FLIGHTS_NEWS_EMAIL='newsroom@transilvaniatimes.com'
```

Apply the new migration alongside the others; the disruption email reuses your existing Resend key.

## Cluj live status via AeroDataBox (RapidAPI) — current approach

OpenSky turned out to be a dead end for live boards (its airport endpoints refuse
recent windows: "You cannot access historical flights"), so Cluj live status now
comes from **AeroDataBox via RapidAPI**:

1. On rapidapi.com: search **AeroDataBox** → Pricing → subscribe (Basic = free,
   600 units — enough to validate; Pro $5 or Pro 2 $15 for production).
2. Copy your key: any AeroDataBox endpoint page → code snippet shows
   `X-RapidAPI-Key` — that string is your key.
3. `supabase secrets set AERODATABOX_KEY='<your X-RapidAPI-Key>'`
4. Redeploy: `supabase functions deploy flights-sync --no-verify-jwt`
5. Validate before paying: open
   `https://<PROJECT>.supabase.co/functions/v1/flights-sync?adxtest=1` with the
   `x-sync-secret` header → per-airport live-status report, writes nothing,
   costs 3 units.

The sync then makes ONE AeroDataBox call per run (rolling 12h window, Cluj only):
~4,300 units/month → the $5 Pro tier (6,000) covers it. Statuses stamped include
Check-in, Boarding, Gate closed, Departed, Arrived, Delayed, Cancelled — matched
onto the scraped schedule by flight number + date, so the board and UI are
unchanged. If no `AERODATABOX_KEY` is set, Cluj simply stays schedule-only.

## (superseded) Cluj live status via ADS-B (OpenSky) — free

Cluj's own site publishes only the timetable (no live status anywhere). To still
show real movement, `flights-sync` now queries OpenSky Network for actual
departures/landings at Cluj (LRCL) and matches them to the schedule by airline +
time, stamping **Decolat/Aterizat + the real time** onto matching flights.

- Free. Works anonymously (low rate limit); for the full limit use an OpenSky
  API client (OAuth2) and set two function secrets — the code exchanges them for
  a 30-min Bearer token automatically:
  ```bash
  supabase secrets set OPENSKY_CLIENT_ID='<your client id>'
  supabase secrets set OPENSKY_CLIENT_SECRET='<your client secret>'
  ```
  (Legacy `OPENSKY_USER`/`OPENSKY_PASS` are still accepted as a fallback.)
- Honest limits: **partial coverage** — only flights an ADS-B receiver catches get
  a status; and it can only ever show departed/landed/delay, never
  Check-in/Boarding/Gate (those aren't broadcast — no free source has them for Cluj).
- Sibiu and Târgu Mureș keep their own richer live status from their sites; ADS-B
  only fills Cluj.

## If a parser ever breaks

Each source is isolated — if one airport redesigns its page, that airport
returns 0 rows (visible in the `?test=1` output and the POST summary's
`sources` map) while the other two keep working. Re-run `?test=1` to see which,
then adjust that airport's column keywords in `parse.ts` (`mapRows`). The 24
sample tests in `parse.samples.test.ts` guard the mapping logic.
