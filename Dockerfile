# Tourwright: one image for every role. The command picks it: serve (API), worker, mcp, render <script>…
# Multi-arch (linux/amd64, linux/arm64): docker buildx build --platform linux/amd64,linux/arm64 .
FROM node:24-bookworm-slim

# Piper as the piper-tts package, kept loaded during a render (about 5x faster per sentence than the old
# standalone program). The same version as PIPER_TTS in src/install.js; a test keeps them equal
ARG PIPER_TTS=1.8.0
# Piper voices baked into the image (more: `tourwright install-voice <name>` at runtime, into the data volume)
ARG VOICES="es_MX-claude-high en_US-lessac-medium"
# Microsoft Edge neural voices (free, need internet). false = smaller image, offline voices only
ARG WITH_EDGE_TTS=true

ENV NODE_ENV=production \
    TOURWRIGHT_HOME=/var/lib/tourwright \
    TOURWRIGHT_PIPER_PYTHON=/opt/tourwright/venv/bin/python \
    TOURWRIGHT_HOST=0.0.0.0 \
    TOURWRIGHT_TMP_DIR=/tmp \
    TOURWRIGHT_PIPER_VOICES=/opt/tourwright/voices \
    PLAYWRIGHT_BROWSERS_PATH=/opt/tourwright/browsers \
    TOURWRIGHT_BROWSERS_PATH=/opt/tourwright/browsers

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg xvfb ca-certificates curl tini python3-venv \
 && rm -rf /var/lib/apt/lists/*

# One Python environment for the voices: Piper always, edge-tts unless WITH_EDGE_TTS=false
RUN python3 -m venv /opt/tourwright/venv \
 && /opt/tourwright/venv/bin/pip install --no-cache-dir "piper-tts==${PIPER_TTS}" $([ "$WITH_EDGE_TTS" = "true" ] && echo edge-tts) \
 && /opt/tourwright/venv/bin/pip uninstall -y -q pip setuptools \
 && if [ "$WITH_EDGE_TTS" = "true" ]; then ln -s /opt/tourwright/venv/bin/edge-tts /usr/local/bin/edge-tts; fi

WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts/docker-deps.js ./scripts/
# The image brings the Redis queue and Claude for `narrate`, optional for an npm install: everything is installed
# from the lockfile (NODE_ENV=production would skip devDependencies), they are kept, and the dev tools go
RUN npm ci --include=dev --no-audit --no-fund \
 && node scripts/docker-deps.js \
 && npm prune --no-audit --no-fund \
 && find node_modules -mindepth 1 -maxdepth 1 -type d -empty -delete \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

COPY bin ./bin
COPY src ./src
COPY docs ./docs
COPY schema ./schema
COPY examples ./examples

RUN for v in $VOICES; do node bin/tourwright.js install-voice "$v"; done \
 && mkdir -p /var/lib/tourwright && chown node:node /var/lib/tourwright

USER node
VOLUME /var/lib/tourwright
EXPOSE 4700
# The MCP Registry checks that this image belongs to the server it lists (server.json)
LABEL io.modelcontextprotocol.server.name="io.github.CXmiloxx/tourwright"
ENTRYPOINT ["tini", "--", "node", "/app/bin/tourwright.js"]
CMD ["serve", "--worker"]
