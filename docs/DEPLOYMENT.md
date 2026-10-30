# Deployment and scaling

## How it fits together

```
 client / agent ──► API (N replicas) ──► queue (folder or Redis) ──► workers (M, any servers)
                         │                                              │
                         └──────────── storage (folder or S3) ◄─────────┘
```

- **API**: validates scripts, stores inputs, queues jobs, serves status and files. No rendering, little
  memory: 2 replicas cover thousands of requests per minute.
- **Workers**: each one takes jobs from the queue and renders each in its own child process (a crash or a
  hung browser never takes the worker down; the time limit kills it). Workers stop gracefully on SIGTERM:
  they finish what they are rendering.
- **Queue**: `local` (a folder: tickets claimed by atomic rename, dead workers' tickets recovered) or
  `redis` (BullMQ: retries with backoff, stalled-job recovery).
- **Storage**: `local` (the data folder) or `s3`.

## Sizing

One video being rendered ≈ one Chromium + one ffmpeg:

| Quality | CPU | RAM | Real time |
|---|---|---|---|
| `hd` 1280×720 | 1–2 cores | ~800 MB | ~1× the video length + encoding |
| `fullhd` 1920×1080 | 2–3 cores | ~1.2 GB | ~1.3× |
| slides | short bursts | ~400 MB | a fraction of the video length |

Browser walkthroughs record in real time: a 5-minute video takes about 5 minutes plus the off-camera waits.
Throughput grows linearly with workers. Slides do not record in real time.

Rules of thumb: `TOURWRIGHT_CONCURRENCY=1` per worker and more workers rather than more concurrency;
`TOURWRIGHT_FFMPEG_THREADS` = the CPUs you give each worker; `shm_size: 1gb` per worker container.
On virtual machines with a generic CPU model (`QEMU Virtual CPU`, no AVX2 passed through) x264 is several times
slower: set `TOURWRIGHT_PRESET=veryfast`, or expose the host CPU to the VM (`-cpu host`).

## Recipes

**Laptop or small VPS**

```bash
tourwright serve --worker                      # localhost only, no token needed
```

**One server, Docker**

```bash
cp .env.example .env && $EDITOR .env      # TOURWRIGHT_API_TOKENS, TOURWRIGHT_PUBLIC_URL
docker compose up -d --build
docker compose up -d --scale worker=4
```

Put a TLS reverse proxy (Caddy, nginx, Traefik) in front and set `TOURWRIGHT_PUBLISH=127.0.0.1:4700`.

**Several servers**

- One Redis reachable by all (managed Redis works; use a password and TLS: `rediss://`).
- One S3-compatible bucket (`TOURWRIGHT_S3_*`).
- API replicas behind your load balancer, all with the same `TOURWRIGHT_API_TOKENS` and `TOURWRIGHT_LINK_SECRET`.
- Workers anywhere — another datacenter, a GPU box, ARM servers — with the same Redis and bucket:

```bash
docker run -d --restart unless-stopped --shm-size 1g --env-file .env ghcr.io/cxmiloxx/tourwright worker
```

With the `local` queue, many servers can also share an NFS/EFS/CephFS folder as `TOURWRIGHT_DATA_DIR`.

**Kubernetes**: [`deploy/kubernetes/tourwright.yaml`](../deploy/kubernetes/tourwright.yaml). For autoscaling on queue
length, KEDA's Redis scaler on `bull:tourwright:wait`.

**Without Docker, as a service (systemd)**

```ini
# /etc/systemd/system/tourwright-worker@.service  →  systemctl enable --now tourwright-worker@{1..3}
[Unit]
Description=Tourwright worker %i
After=network-online.target
[Service]
User=tourwright
EnvironmentFile=/etc/tourwright.env
ExecStart=/usr/bin/node /opt/tourwright/bin/tourwright.js worker
Restart=always
KillSignal=SIGTERM
TimeoutStopSec=1800
[Install]
WantedBy=multi-user.target
```

## GPU and faster voices

Narration is synthesized once per sentence and cached across jobs (`TOURWRIGHT_CACHE_DIR`; share it between
workers on one server). For many voices at scale, run a GPU TTS server that speaks the OpenAI protocol
(Kokoro-FastAPI, LocalAI…) and point `TOURWRIGHT_OPENAI_TTS_URL` at it: workers stay CPU-only.

## Upgrades

Workers and API are stateless: roll them one by one. Jobs in progress finish on the old version.
