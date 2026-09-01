# deploy/modal/app.py
#
# The render worker as serverless functions.
#
# WHY THIS EXISTS ALONGSIDE THE RAILWAY WORKER RATHER THAN INSTEAD OF IT.
#
# The current worker is one process on one box. It was made to survive restarts
# and run two jobs at once, which was the right patch — but the shape is still
# "a machine that is always on, doing nothing most of the time, and blocking the
# second person when it is busy". A render is a burst: three minutes of every
# core, then nothing for an hour.
#
# Spawned functions fit that exactly. Each render is its own container, so two
# people never queue behind each other; containers scale to zero, so an idle
# newsroom costs nothing; and the 15-minute function limit is far past the
# three-times-realtime a three-minute film needs, while the web endpoint returns
# immediately with a call id instead of holding a request open.
#
# THE RENDER CODE IS NOT REWRITTEN. `render-worker/src` is copied in and called
# as-is, so the timeline, the grade, the loudness chain and the QC are the same
# code that runs today. This file is deployment, not a second renderer — the
# whole project has been about not having two of those.

import os
import modal

app = modal.App("tt-render")

# Chrome and ffmpeg are baked in at build time. Downloading either per request
# would spend more time fetching than rendering.
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install(
        "ffmpeg", "ca-certificates", "build-essential",
        "libcairo2-dev", "libpango1.0-dev", "libjpeg-dev", "libgif-dev",
        "librsvg2-dev", "pkg-config",
        # The same faces the Dockerfile installs. A brand face that exists only
        # as a string in a JSON document is theatre, and this is where it stops
        # being one for the serverless path too.
        "fonts-dejavu-core", "fonts-liberation2", "fonts-ebgaramond", "fonts-inter",
        "curl",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "fc-cache -f",
    )
    .add_local_dir("../../render-worker", "/app/render-worker", copy=True)
    .add_local_dir("../../lib/timeline", "/app/lib-timeline", copy=True)
    .run_commands(
        "cd /app/render-worker && npm install --omit=dev --no-audit --no-fund",
        # Compile the shared timeline exactly as the Dockerfile does, so the
        # browser and this renderer cannot be running different versions of it.
        "cd /app/render-worker && npm install --no-save typescript@5 && "
        "npx tsc /app/lib-timeline/*.ts --outDir dist/timeline --module commonjs "
        "--target es2020 --moduleResolution node --skipLibCheck --strict",
    )
)

# Finished films outlive the container that made them. This is the same problem
# the in-memory job Map had — a restart destroyed every download link — solved by
# the platform instead of by a JSON index on a local disk.
volume = modal.Volume.from_name("tt-renders", create_if_missing=True)
OUT = "/renders"


@app.function(
    image=image,
    volumes={OUT: volume},
    timeout=900,          # 15 minutes: a three-minute film renders in about nine
    cpu=4.0,
    memory=8192,
    retries=modal.Retries(max_retries=1, backoff_coefficient=1.0),
)
def render(timeline: dict, job_id: str) -> dict:
    """One film. Its own container, its own cores, nobody else's queue."""
    import json, subprocess, pathlib

    work = pathlib.Path(f"/tmp/{job_id}")
    work.mkdir(parents=True, exist_ok=True)
    spec = work / "timeline.json"
    spec.write_text(json.dumps(timeline))
    out = pathlib.Path(OUT) / f"{job_id}.mp4"

    # The worker's own entry point, called as a script. Not reimplemented.
    proc = subprocess.run(
        ["node", "/app/render-worker/src/cli.js", str(spec), str(out)],
        capture_output=True, text=True, timeout=880,
        env={**os.environ, "TIMELINE_DIST": "/app/render-worker/dist/timeline/index.js"},
    )
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr[-4000:]}

    volume.commit()
    qc_path = work / "qc.json"
    qc = json.loads(qc_path.read_text()) if qc_path.exists() else None
    return {"ok": True, "file": f"{job_id}.mp4", "bytes": out.stat().st_size, "qc": qc}


@app.function(image=image, volumes={OUT: volume}, timeout=60)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Header
    from fastapi.responses import FileResponse, JSONResponse
    import secrets, hmac, pathlib

    api = FastAPI()
    TOKEN = os.environ.get("RENDER_WORKER_TOKEN", "")

    def authorised(header: str | None) -> bool:
        # Fail closed. An unset secret is not an open door — the same rule the
        # Node worker follows, for the same reason.
        if not TOKEN:
            return False
        supplied = (header or "").removeprefix("Bearer ").strip()
        return hmac.compare_digest(supplied, TOKEN)

    @api.post("/jobs")
    async def create(body: dict, authorization: str | None = Header(default=None)):
        if not authorised(authorization):
            raise HTTPException(401, "Unauthorized")
        timeline = body.get("timeline")
        if not isinstance(timeline, dict):
            raise HTTPException(400, "timeline missing")
        job_id = secrets.token_hex(12)
        # Spawn, do not call: the request returns now and the render runs for as
        # long as it needs, rather than the browser holding a socket open for
        # nine minutes and a proxy closing it at sixty seconds.
        handle = render.spawn(timeline, job_id)
        return {"id": job_id, "call_id": handle.object_id}

    @api.get("/jobs/{call_id}")
    async def poll(call_id: str, authorization: str | None = Header(default=None)):
        if not authorised(authorization):
            raise HTTPException(401, "Unauthorized")
        handle = modal.FunctionCall.from_id(call_id)
        try:
            result = handle.get(timeout=0)
        except TimeoutError:
            return {"state": "rendering"}
        return {"state": "done" if result.get("ok") else "failed", **result}

    @api.get("/file/{name}")
    async def file(name: str, key: str = "", download: str = ""):
        if not key or not hmac.compare_digest(key, TOKEN):
            raise HTTPException(401, "Unauthorized")
        p = pathlib.Path(OUT) / pathlib.Path(name).name
        if not p.exists():
            return JSONResponse({"error": "gone"}, status_code=404)
        # inline for review, attachment when asked — the header that made a
        # download button do nothing for a week.
        disp = "attachment" if download in ("1", "true") else "inline"
        return FileResponse(p, media_type="video/mp4",
                            headers={"Content-Disposition": f'{disp}; filename="{p.name}"'})

    return api
