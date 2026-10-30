# Configuration

Order: built-in defaults < `tourwright.config.json` in the working directory (or the file in `TOURWRIGHT_CONFIG`)
< environment variables < command-line flags.

## Paths and binaries

| Variable | Default | |
|---|---|---|
| `TOURWRIGHT_HOME` | `~/.local/share/tourwright` (Windows: `%LOCALAPPDATA%\tourwright`) | Base folder. `tourwright install` puts everything here (programs, voices, a Python of its own and its virtual environment) and nothing on the system: deleting it uninstalls. If you move it, run `tourwright install` again to rebuild the Python environment |
| `TOURWRIGHT_DATA_DIR` | `$TOURWRIGHT_HOME/data` | Jobs, queue, saved sessions |
| `TOURWRIGHT_CACHE_DIR` | `$TOURWRIGHT_HOME/cache` | Voice cache (safe to delete) |
| `TOURWRIGHT_TMP_DIR` | `/dev/shm` if it exists | Work files of each render |
| `TOURWRIGHT_FFMPEG`, `TOURWRIGHT_FFPROBE` | from `PATH`, then `$TOURWRIGHT_HOME/bin` | |
| `TOURWRIGHT_XVFB` | `Xvfb` from `PATH` | Without it, capture is `screencast` |
| `TOURWRIGHT_CHROMIUM` | Playwright's Chromium | Another Chromium/Chrome binary |
| `TOURWRIGHT_BROWSERS_PATH` | Playwright default | Where Playwright's browsers are |
| `TOURWRIGHT_FFMPEG_THREADS` | min(4, CPUs) | Threads per ffmpeg |
| `TOURWRIGHT_PRESET` | `medium` | x264 preset of the final video: `ultrafast` … `veryslow`. `veryfast` encodes ~3× faster on weak or virtual CPUs, at a larger file |
| `TOURWRIGHT_NICE` | `10` | CPU priority of renders (0–19; also idle disk priority) |
| `TOURWRIGHT_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `TOURWRIGHT_LOG_FORMAT` | text | `json` for log collectors |

## Voices

| Variable | Default | |
|---|---|---|
| `TOURWRIGHT_VOICE` | `piper:es_MX-claude-high` | Default voice |
| `TOURWRIGHT_PIPER_BIN` | `piper` in `PATH`, `$TOURWRIGHT_HOME/piper/piper`, `$TOURWRIGHT_HOME/venv/bin/piper` | The `piper-tts` Python package works too |
| `TOURWRIGHT_PIPER_VOICES` | `$TOURWRIGHT_HOME/voices` | `.onnx` + `.onnx.json` models |
| `TOURWRIGHT_EDGE_TTS_BIN` | `edge-tts` in `PATH`, `$TOURWRIGHT_HOME/venv/bin/edge-tts` (Windows: `venv\Scripts`) | |
| `TOURWRIGHT_OPENAI_TTS_URL` | `https://api.openai.com` if `OPENAI_API_KEY` is set | Any `/v1/audio/speech` server |
| `TOURWRIGHT_OPENAI_TTS_KEY` | `OPENAI_API_KEY` | |
| `TOURWRIGHT_OPENAI_TTS_MODEL` | `tts-1` | |
| `TOURWRIGHT_TTS_COMMAND` | — | e.g. `my-tts --voice {voice} --out {out}` (text on stdin) |
| `TOURWRIGHT_TTS_PAUSE` | `0.5` | Seconds between sentences |
| `TOURWRIGHT_VOICE_POLISH` | `default` | Sound of the narration: `default`, `clean`, `warm`, `radio`, `podcast`, `none`, or a raw ffmpeg audio filter. A script's `audio.polish` (presets only) wins |

Aliases and a pronunciation dictionary for every script, in `tourwright.config.json`:

```json
{ "tts": {
    "aliases": { "narrator": "edge:es-CO-GonzaloNeural?rate=-10%" },
    "pronounce": { "SaaS": "sas", "Kubernetes": "cubernetes" } } }
```

## Plugins

| Variable | Default | |
|---|---|---|
| `TOURWRIGHT_PLUGINS` | — | Comma-separated modules that add actions, TTS engines and voices (`./plugins/x.js`, `tourwright-plugin-y`). Config key `plugins` |

See [PLUGINS.md](PLUGINS.md). Plugins run as the server's own code: install only ones you trust.

## Look

```json
{ "theme": { "accent": "#D99A1E", "background": "#101820", "text": "#F6F2EA", "muted": "#5FB3A1",
  "gradient": "radial-gradient(ellipse at 30% 20%, #1D6B5F 0%, #1A2633 45%, #101820 100%)",
  "font": "Inter, system-ui, sans-serif", "logo": "/path/to/logo.svg" } }
```

A script's `theme` overrides the config's.

## Queue and workers

| Variable | Default | |
|---|---|---|
| `TOURWRIGHT_QUEUE` | `redis` if `TOURWRIGHT_REDIS_URL` is set, else `local` | |
| `TOURWRIGHT_REDIS_URL` | — | `redis://[:password@]host:6379` |
| `TOURWRIGHT_QUEUE_NAME` | `tourwright` | Namespace in Redis |
| `TOURWRIGHT_CONCURRENCY` | `1` | Videos at once per worker |
| `TOURWRIGHT_JOB_TIMEOUT` | `1800` | Seconds per video |
| `TOURWRIGHT_JOB_ATTEMPTS` | `2` | |
| `TOURWRIGHT_RETENTION_HOURS` | `72` | Finished jobs and files are deleted after this (0 = never) |

## Storage

| Variable | Default | |
|---|---|---|
| `TOURWRIGHT_STORAGE` | `s3` if `TOURWRIGHT_S3_BUCKET` is set, else `local` | |
| `TOURWRIGHT_S3_BUCKET`, `TOURWRIGHT_S3_REGION` | —, `us-east-1` | |
| `TOURWRIGHT_S3_ENDPOINT` | AWS | MinIO, R2 (`https://<account>.r2.cloudflarestorage.com`), B2… |
| `TOURWRIGHT_S3_ACCESS_KEY`, `TOURWRIGHT_S3_SECRET_KEY` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | |
| `TOURWRIGHT_S3_PUBLIC_ENDPOINT` | the endpoint | Address clients download from, when workers reach S3 by another (Docker, private network) |
| `TOURWRIGHT_S3_PATH_STYLE` | `true` | `false` for virtual-hosted buckets (AWS) |
| `TOURWRIGHT_S3_PREFIX` | `tourwright/` | |
| `TOURWRIGHT_S3_URL_EXPIRES` | `3600` | Presigned link lifetime |

## API

| Variable | Default | |
|---|---|---|
| `TOURWRIGHT_HOST`, `TOURWRIGHT_PORT` | `127.0.0.1`, `4700` | (`0.0.0.0` in Docker) |
| `TOURWRIGHT_API_TOKENS` | — | Required to listen beyond localhost |
| `TOURWRIGHT_PUBLIC_URL` | `http://host:port` | Base of download links |
| `TOURWRIGHT_LINK_SECRET` | derived from the tokens | Signs download links |
| `TOURWRIGHT_LINK_TTL` | `86400` | Seconds a download link works |
| `TOURWRIGHT_WEBHOOK_SECRET` | — | HMAC of webhook bodies |
| `TOURWRIGHT_MAX_BODY_MB` | `50` | |
| `TOURWRIGHT_ALLOW_SECRETS` | `false` | `${env:TOURWRIGHT_SECRET_*}` in API jobs |
| `TOURWRIGHT_ALLOWED_HOSTS` | — (any) | Hosts API jobs may open: `example.com,*.example.org` |
| `TOURWRIGHT_BLOCK_PRIVATE` | `false` (`true` in `.env.example`) | Block private networks and cloud metadata |

## MCP

| Variable | |
|---|---|
| `TOURWRIGHT_API_URL`, `TOURWRIGHT_API_TOKEN` | Remote mode: send jobs to that API |
| `TOURWRIGHT_MCP_WORKER=false` | Local mode without the embedded worker (another worker serves the queue) |
| `TOURWRIGHT_MCP_ALLOW_FILES=true` | Adds `tourwright_render_file` (scripts from disk, including JavaScript) |
