# render-worker/Dockerfile
#
# Build context is the REPOSITORY ROOT, not this folder — the worker compiles
# lib/timeline from the repo so the browser and the renderer can never read
# different versions of the timeline code.
#
# Railway: set the root directory to the repository root and point it at
# render-worker/Dockerfile (railway.json next to this file already does).

FROM node:20-bookworm-slim

# ffmpeg does the encoding, the audio graph and the loudness measurement.
# The rest are node-canvas's build and runtime dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      ca-certificates \
      build-essential \
      libcairo2-dev \
      libpango1.0-dev \
      libjpeg-dev \
      libgif-dev \
      librsvg2-dev \
      pkg-config \
      python3 \
      fonts-dejavu-core \
      fonts-liberation2 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not rebuild node-canvas.
COPY render-worker/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Compile the shared timeline module into dist/timeline.
COPY lib/timeline ./src-timeline
RUN npm install --no-save typescript@5 \
 && npx tsc ./src-timeline/*.ts \
      --outDir ./dist/timeline \
      --module commonjs --target es2020 --moduleResolution node \
      --skipLibCheck --strict \
 && rm -rf ./src-timeline ./node_modules/typescript

COPY render-worker/src ./src

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# An unauthenticated render endpoint is an open invitation to spend money, so
# the process refuses every request until RENDER_WORKER_TOKEN is set.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||8080)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.js"]
