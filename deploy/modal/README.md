# Rendering on Modal

Not a replacement renderer. `render-worker/src` is copied in and called as-is,
so the timeline, the grade, the loudness chain and the QC are the same code that
runs today. This directory is deployment.

## What it fixes that the Railway box cannot

| | one box | spawned functions |
|---|---|---|
| two people rendering | one waits | two containers |
| idle cost | always on | zero |
| a finished film | local disk, 7 days | volume, until deleted |
| long renders | fine | 15-minute ceiling, far past what we need |
| a crash | one retry, same box | retried on a fresh container |

## Deploy

```
pip install modal
modal token new
modal secret create tt-render RENDER_WORKER_TOKEN=<the same token the edge function uses>
cd deploy/modal && modal deploy app.py
```

Point `RENDER_WORKER_URL` at the printed `web` endpoint. The edge function's
contract is unchanged: `POST /jobs` returns a call id, `GET /jobs/{id}` polls,
`GET /file/{name}?key=…` serves — with `&download=1` for an attachment.

## The one piece still to write

`render-worker/src/cli.js` — a thin entry point that reads a timeline JSON, calls
`renderTimeline`, writes `qc.json` beside the output and exits non-zero on
failure. Everything it needs is already exported; it is an afternoon, and it is
deliberately left until someone decides to move, so that a template nobody
deploys does not rot pretending to be finished.
