# tt-forge — the six remaining items

**Rebased onto `25124d9`.** Your `newsroom/page.tsx` is deliberately not in this
zip — your commit carries a render-clock fix my tree does not have.

**1795 assertions, 51 suites, 0 failures**, 115s. `npx next build` compiled
successfully in 36.6s. `tsc` and eslint clean, golden frames byte-identical,
all four migrations run against a real PostgreSQL twice.

**Two SQL files are new** (3 and 4). **The worker must be redeployed.**

---

## 1 · The campaign driver is no longer only a browser tab

`render-worker/src/campaign-poller.js`, **off unless you turn it on.**

It needs a Supabase service key in the worker's environment. That key bypasses
row level security entirely, so it is a decision, not a default: the poller does
nothing at all unless `CAMPAIGN_POLL`, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are all present, and it logs **which one is missing**
rather than being silently absent.

**Why it is small, and why that matters.** It does not build timelines. Each row
now carries its finished timeline, built once when the campaign is created, so a
driver only renders a document that already exists. The films the poller makes
are identical to the ones your tab makes — not because two builders agree, but
because there is one document. It also makes a campaign inspectable: a row that
produced a wrong film can be read.

It uses the same atomic claim, the same lease, the same attempt cap. A tab and
the worker can work one campaign at the same time without either doing a row
twice — which is the common case: start a campaign, close the laptop, the worker
finishes it. `59` asserts the poller and the browser agree exactly on what is
retryable and on the backoff, because two opinions means a row the tab gives up
on is retried forever by the worker and paid for every time.

**To turn it on**, on Railway:

```
CAMPAIGN_POLL=1
SUPABASE_URL=https://<your-project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
RENDER_WORKER_PUBLIC_URL=https://transilvania-times-news-hub-production.up.railway.app
```

The last one is not optional — without it a finished file exists at an address
nothing can reach, and the poller says so rather than returning a URL that 404s.

## 2 · `fullyGenerated` campaigns now generate

`lib/campaign/generate.ts`. Three things separate this from a loop that calls an
image model:

- **The row reaches the prompt.** A loop that sends the template's prompt
  unchanged makes the same picture every time and charges per row for it — the
  most expensive possible way to do nothing.
- **The budget is checked between pictures, not between rows.** A row with four
  shots can otherwise spend four times the per-row estimate before anything
  looks.
- **A refused picture does not lose the row.** One rejected image out of four is
  a film with a gap; failing the row throws away the three already paid for.

The estimate now comes from `costPerRow` reading the same draft the generator
walks, so the number you are shown and the number spent have one source. It used
to count the template's beats, which inflated every estimate by the shots the
campaign had already filled.

## 3 · Lipsync across a campaign

The driver generates a voice per row in `spokenName` and `fullyGenerated` modes
and lipsyncs through `generate-motion` — the same `{action:'lipsync', video_url,
audio_url, engine}` contract the Studio uses, read from the function rather than
remembered.

## 4 · Speaker labelling is no longer manual

Whisper does not diarise, and the usual answers are a second paid service or a
clustering model. **Neither is needed with a lapel on each speaker.** The person
talking is the one whose *own* microphone is loud; every other track hears them
across the room, quieter. That is a measurement your recording already contains —
and on this material it is more reliable than a diariser, which works from one
mixed track and has to infer what two tracks state outright.

Two details that make it usable rather than merely clever:

- **The measured alignment is applied to the envelopes first.** Attributing words
  with unaligned tracks picks whoever was loudest half a second later, which is
  the other speaker about as often as not.
- **A clear winner, or the previous speaker.** Bleed makes two tracks similar
  during a pause, and a bare argmax then flips speaker on individual words
  mid-sentence — nonsense in a transcript, and a camera cutting back and forth.

**And it tells you when it cannot.** Two omnidirectional mics on one table
separate almost nothing; the ratio is reported and, below 1.5×, the interface
says the attribution is unreliable rather than printing an authoritative-looking
transcript that is half wrong.

## 5 · Podcast clips are rendered, not just ranked

`lib/podcast/clip.ts`. A list of timecodes is not a deliverable — turning one
into a vertical with burned-in captions was still a manual job per clip, which is
exactly the work the tab was meant to remove.

- **The words are retimed to the clip.** A clip starting at 14:32 carries words
  timestamped at 14:32; paste them over without subtracting and every caption in
  every clip is fourteen minutes late — which looks like broken caption code and
  sends you looking in the wrong place.
- **The camera offset is added to the source in-point**, because the transcript
  clock and each camera's clock differ by the measured alignment.
- **Cues group by characters, not word count.** "și" and "întreprinderea" are one
  word each and nothing like the same width; a fixed count gives lines
  alternately half empty and overflowing, which is why burned-in captions usually
  look amateur.
- **The hook is what is actually said**, because writing a separate headline per
  clip is work nobody does.
- **Captions are on and not optional** — a clip is watched without sound.

## 6 · Tenancy, seats, metering

Migration 4. `studio_orgs`, `studio_org_members`, `studio_api_keys`,
`studio_usage`.

- **`org_id` is nullable everywhere**, and `studio_in_org()` returns true when it
  is null. Existing rows stay visible to existing admins, nothing is migrated,
  nothing breaks, and the column is there to build on. Tenancy added any other
  way is a migration that has to be right first time.
- **The ledger is append-only.** One row per chargeable event with what it cost —
  never a counter, because a counter cannot be audited, cannot be re-summed after
  a pricing bug, and cannot answer "what did that campaign actually cost". There
  is deliberately no UPDATE or DELETE policy: the only reason to edit a spend
  record is to make a bill look different.
- **API keys are stored as a hash**, with a prefix for identification. A table of
  live keys is a breach waiting for a backup to leak, and there is no legitimate
  reason to read a customer's key back.
- **`studio_org_can_spend()` checks before the work**, in SQL. A ceiling enforced
  afterwards is an invoice.

**What is still missing for selling it:** billing. Stripe, plans, invoices and
dunning need your account and your prices — the schema and the meter are ready
for them, and I will not invent your pricing.

---

## And the thing I said I would add

`/health` now reports **what the deployed code can do**:

```json
"features": { "speedRamps": true, "wipes": true, "gradeStyles": true,
              "masters": true, "animatedHtml": true, "campaignPoller": false }
```

Each flag is derived from the shared code actually loaded, not from a version
string somebody has to remember to bump. The gate thresholds only move when the
measurement moves, so a deploy that changed ramps, wipes or the grade left
`/health` identical — and the only way to tell was to pay for a render. Now
`curl /health` answers it.

---

## Deploy

```
1. Copy the folder over the repo, commit, push.        Netlify builds — tested.
2. Paste SQL 3 and 4 into Supabase, in order.          Tested on real Postgres.
3. Redeploy the render worker on Railway.              Required.
```

```
1.  20260901120000_studio_avatars_campaigns_podcast.sql   ← already run
2.  20260901180000_campaign_queue.sql                     ← already run
3.  20260901220000_queue_grants_and_indexes.sql           ← NEW
4.  20260902090000_campaign_timelines_and_org.sql         ← NEW
```

**No edge functions to deploy.** Nothing in `supabase/functions/` is in this zip;
every fix this round was on my side.

**Step 3 is required.** `grade.js` no longer uses `eq=` for contrast and
saturation, and `index.js` gained the health flags and the poller. Until the
worker is redeployed the render keeps the old YUV contrast while the preview
shows the new one — worse than before, not better.

After redeploying, `curl https://<worker>/health` should show
`"gradeStyles": true` and `"speedRamps": true`. That is now the answer to
"is the worker current?", and it costs nothing to check.
