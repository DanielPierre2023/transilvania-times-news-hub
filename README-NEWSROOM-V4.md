# Newsroom v4 — deploy pack

Dashboard + GitHub web UI only. No terminal, no CLI.

## ⚠️ ORDER MATTERS — SQL FIRST

`app/api/track-page/route.ts` starts sending `utm_content` with **every pageview**.
PostgREST rejects an insert containing an unknown column, so if the column does not exist
yet you do not merely lose the attribution — **you lose the entire pageview**. Analytics
would go silent and nothing would say why.

```
1. SQL EDITOR   supabase/sql/03_ab_tracking_and_view.sql      ← run this first
2. GITHUB       commit the 6 frontend files
3. FUNCTIONS    deploy newsroom-anchor + tt-social-seo
```

---

## 1 · SQL — Dashboard → SQL Editor

`supabase/sql/03_ab_tracking_and_view.sql` → paste → Run. Idempotent, nothing dropped.

Expect:

| check | expected |
|---|---|
| utm_content column | `1 / 1` |
| A/B views | `bulletin_hook_performance, bulletin_hook_winner` |
| campaign index | `site_analytics_campaign_content_idx` |

## 2 · GitHub — commit these six

```
app/sitemap.ts                     (bulletins + build guard)
app/atom.xml/route.ts              (build guard)
app/rss.xml/route.ts               (build guard)
app/sitemap-news.xml/route.ts      (build guard)
app/components/PageTracker.tsx     (captures utm_content)
app/api/track-page/route.ts        (stores utm_content)
```

## 3 · Edge functions — paste → Deploy

```
supabase/functions/newsroom-anchor/index.ts
supabase/functions/tt-social-seo/index.ts
```

`generate-voiceover` is unchanged — leave it alone.

---

# What changed

## A · The Sonnet retirement — fixed properly, not patched

`claude-sonnet-4-5-20250929` retires **29 September 2026** and was hard-coded in **eight**
places in `newsroom-anchor` plus one in `tt-social-seo`. A hard-coded model id is an outage
with a calendar entry: the morning it retires, every call returns 404 and the newsroom stops.

Swapping nine strings would leave you in exactly the same position at the next retirement.
Instead both ids are now **single constants, overridable by a Supabase secret**:

```ts
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL')?.trim() || 'claude-sonnet-5';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL')?.trim() || 'gpt-4o-2024-11-20';
```

The next migration is **one secret edit** — no redeploy, no code review, no risk of missing
an occurrence. You do not have to set the secrets; without them the defaults apply.

**Why `claude-sonnet-5` and not a dated snapshot:** from the 4.6 generation onward Anthropic
dropped the dated suffix. The dateless id *is* the canonical pinned snapshot for that
release — its weights are never changed underneath you. This is a pin, not a floating alias.

**A cost detail that would have quietly corrupted your ledger:** Sonnet 5 is **$2 / $10** per
million tokens against Sonnet 4.5's **$3 / $15**. It is *cheaper*. Leaving the old constants
would have overstated every future row in `ai_spend_log` by ~50% — right after we finally
got the ledger working. Prices now live in one table with a `usdFor()` helper, and an
unrecognised model falls back to the Sonnet-5 rate rather than logging **$0**: an unpriced
call must never look like a free one.

Your script cost drops by roughly a third as a side effect.

## B · The build can no longer be killed by Supabase

You asked me to fix `/sitemap.xml`. I found the same one-line defect in **three more**
prerendered routes, so fixing only the one you named would have left the build just as
fragile — and I would have reported it green.

`createClient()` throws *synchronously* on a missing url, and an unguarded throw in a
prerendered route fails the entire Netlify build:

```
app/sitemap.ts               ← the one you named
app/atom.xml/route.ts        ← same defect
app/rss.xml/route.ts         ← same defect
app/sitemap-news.xml/route.ts ← same defect, twice (it builds two clients)
```

All four now check the env vars, degrade, and say so in the build log. The feeds return a
**valid empty document** rather than a 500 — an empty feed is a bad hour, a failed build is
a dead site. Every dynamic query is additionally wrapped, so a DNS or TLS failure costs you
URLs, never the deploy.

**Proven, not asserted.** The full `next build` was run against your repo twice:

```
Supabase pointed at an unreachable host   → ✓ Generating static pages (71/71)
Supabase env vars removed entirely        → ✓ Generating static pages (71/71)
```

The second case is the *exact* failure that killed your 31 August deploy. It now prints
five warnings and finishes green.

## C · Bulletins are in the main sitemap

`sitemap-news.xml` is a strict **48-hour window**. After two days a bulletin page was in no
sitemap at all, reachable only from the `/buletin` index.

That threw the asset away. A bulletin page carries `VideoObject` + `NewsArticle` schema and
is long-tail by nature — an edition covering Cluj or Turda keeps earning video impressions
for months. The news sitemap gets it indexed *fast*; the main sitemap keeps it indexed.

- Up to 500 published bulletins, newest first, with the poster as an image entry.
- `changeFrequency: 'monthly'`, not daily — a published bulletin does not change, and
  claiming otherwise burns crawl budget on unchanged pages.
- `/buletin/` itself added as a static entry at priority 0.8.

## D · The A/B is now actually measurable

**I was wrong when I told you "one SQL view closes it."** I checked before writing it:
`site_analytics` has **no `utm_content` column**, `PageTracker.tsx` never read the
parameter, and `app/api/track-page/route.ts` never forwarded it. `tt-social-seo` was
stamping `utm_content=hookA|hookB` onto every link and the value was being **thrown away on
arrival**. A view over nothing would have returned nothing.

Closing it took four changes, not one:

| | |
|---|---|
| `site_analytics.utm_content` column + partial index | SQL file |
| `PageTracker.tsx` reads `utm_content` | frontend |
| `track-page/route.ts` stores it | frontend |
| `bulletin_hook_performance` — campaign × source × variant | SQL file |
| `bulletin_hook_winner` — the one-line answer per bulletin | SQL file |

```sql
select * from public.bulletin_hook_winner order by campaign desc;
```

It reports **`esantion prea mic`** below 30 combined visits rather than declaring a winner
on noise — which is the difference between a metric you can act on and a number that
flatters whichever hook happened to go first.

Data only accumulates from the moment you deploy. The first bulletin gives you a row; a
fortnight gives you a pattern worth feeding back into the caption prompts.

---

# Verification run before shipping

```
next build vs your real repo, Supabase UNREACHABLE   ✓ 71/71 static pages
next build vs your real repo, env vars REMOVED       ✓ 71/71 static pages
tsc --noEmit -p tsconfig.json (full output)          0 errors
esbuild newsroom-anchor                              OK
esbuild tt-social-seo                                OK
hard-coded claude-sonnet-4-5 remaining in code       0  (only the price table + a comment)
```
