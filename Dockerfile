# Tourwright: one image for every role. The command picks it: serve (API), worker, mcp, render <script>…
# Multi-arch (linux/amd64, linux/arm64): docker buildx build --platform linux/amd64,linux/arm64 .
FROM node:25-bookworm-slim

ARG PIPER_VERSION=2023.11.14-2
# Piper voices baked into the image (more: `tourwright install-voice <name>` at runtime, into the data volume)
ARG VOICES="es_MX-claude-high en_US-lessac-medium"
# Microsoft Edge neural voices (free, need internet). false = smaller image, offline voices only
ARG WITH_EDGE_TTS=true
ARG TARGETARCH

ENV NODE_ENV=production \
    TOURWRIGHT_HOME=/var/lib/tourwright \
    TOURWRIGHT_HOST=0.0.0.0 \
    TOURWRIGHT_TMP_DIR=/tmp \
    TOURWRIGHT_PIPER_VOICES=/opt/tourwright/voices \
    PLAYWRIGHT_BROWSERS_PATH=/opt/tourwright/browsers

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg xvfb ca-certificates curl tini \
 && if [ "$WITH_EDGE_TTS" = "true" ]; then apt-get install -y --no-install-recommends python3-venv; fi \
 && rm -rf /var/lib/apt/lists/*

RUN arch=$([ "$TARGETARCH" = "arm64" ] && echo aarch64 || echo x86_64) \
 && mkdir -p /opt/tourwright \
 && curl -fsSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${arch}.tar.gz" | tar xz -C /opt/tourwright \
 && ln -s /opt/tourwright/piper/piper /usr/local/bin/piper \
 && if [ "$WITH_EDGE_TTS" = "true" ]; then python3 -m venv /opt/tourwright/edge && /opt/tourwright/edge/bin/pip install --no-cache-dir edge-tts \
      && ln -s /opt/tourwright/edge/bin/edge-tts /usr/local/bin/edge-tts; fi

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
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
ENTRYPOINT ["tini", "--", "node", "/app/bin/tourwright.js"]
CMD ["serve", "--worker"]
