# tt-health — make the worker say which code it is running

Small, and it closes a hole that has cost real time twice.

## Why

Railway has served a stale build more than once in this project: a GitHub App
without access to the repo, auto-deploy switched off, a Redeploy that rebuilt
the same snapshot. Each time, `/health` answered `{"ok":true}` — because it was
up, and up is all it knew how to report. So the debugging went to the wrong
place.

`/health` now returns the **live gate thresholds**:

```json
{ "ok": true, "running": false, "queued": 0, "jobs": 0,
  "startedAt": "2026-08-30T…",
  "spec": { "minCoherentMotion": 0.35, "maxShimmerRatio": 1.8,
            "boilingRatio": 1.15, "maxChromaDistance": 0.45,
            "requireMotion": true } }
```

Those numbers change whenever the measurement changes, so they fingerprint the
deployed code without any build metadata to drift out of date. If `spec`
contains `maxShimmer` instead of `maxShimmerRatio`, Railway is still running
the build that rejected all three good takes.

No token needed — it is the same open endpoint as before, and it exposes only
thresholds, never a key or a job.

## Deploy

Repo only, one file plus its test.

```
render-worker/src/index.js
```

Then, once Railway has rebuilt:

    https://transilvania-times-news-hub-production.up.railway.app/health

and look for `maxShimmerRatio`.

## Verification

`_verification/12-inspect.cjs` → 30 assertions (was 26). Four new ones assert
health needs no token, names both live thresholds, and is the ratio gate rather
than the absolute-shimmer one.

## Also confirmed, live

The Studio frontend is deployed and serving the new bundle — the scene report
now reads `dubla 1 · 0.48 %/s · 1.01×`, movement then instability as a multiple
of that picture's own half-pixel floor.
