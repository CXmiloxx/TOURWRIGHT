# HTTP API

`tourwright serve` (add `--worker` to render in the same process). JSON in, JSON out. Stateless: run as many
replicas as you need behind a load balancer.

## Auth

`Authorization: Bearer <token>`, one of `TOURWRIGHT_API_TOKENS` (comma-separated). Every token is its own
tenant: it only sees, downloads and deletes its own jobs, and has its own saved browser sessions.
Without tokens the API only listens on localhost (`TOURWRIGHT_API_INSECURE=true` overrides; don't).

## Endpoints

| Method | Path | |
|---|---|---|
| `GET` | `/health` | `{ ok, queue: { queued, running } }`, no auth |
| `GET` | `/v1/voices` | Voices and engines on the workers' image |
| `GET` | `/v1/schema` | JSON Schema of scripts |
| `POST` | `/v1/validate` | `{ script }` → `{ ok: true }` or `{ ok: false, errors: [...] }` |
| `POST` | `/v1/jobs` | Queue a render → `202` with the job |
| `GET` | `/v1/jobs?limit=50&status=done` | The caller's jobs, newest first |
| `GET` | `/v1/jobs/:id` | Status, progress, error or result |
| `GET` | `/v1/jobs/:id/files/:file` | A result file (`video.mp4`, `video.srt`, `video.vtt`, `video.jpg`, `video.json`). Supports `Range`. With S3 storage: `302` to a presigned URL |
| `DELETE` | `/v1/jobs/:id` | Delete a finished job and its files → `204` |

## Create a job

```http
POST /v1/jobs
{
  "script": { "type": "slides", "slides": [{ "image": "chart.png", "say": "{{quarter}}: sales went up." }] },
  "vars": { "quarter": "Q3" },
  "assets": { "chart.png": "<base64>" },
  "options": { "voice": "lessac", "quality": "fullhd" },
  "webhook": "https://my.app/hooks/tourwright"
}
```

- `script`: a script object, or YAML/JSON text (`"format": "json"` for JSON text). JavaScript scripts are
  not accepted through the API.
- `assets`: files the script refers to by name (images, music, uploads), base64. Names: letters, digits,
  `. _ -`. Total body up to `TOURWRIGHT_MAX_BODY_MB` (50 MB).
- `vars`: values for the script's `{{variables}}`, over its own `vars`. One script, one video per set of values.
  `POST /v1/validate` takes them too.
- `options`: `voice`, `quality`, `width`, `height`, `capture`, `dryRun` override the script.
- `webhook`: called when the job ends.

## Job

```json
{
  "id": "mvv46slt-7a3435fa10",
  "status": "done",
  "kind": "slides",
  "title": "Quarterly results",
  "progress": { "stage": "done" },
  "attempts": 1,
  "createdAt": "2026-10-30T15:15:49.462Z",
  "startedAt": "2026-10-30T15:15:50.365Z",
  "finishedAt": "2026-10-30T15:16:11.834Z",
  "result": {
    "duration": 8.045,
    "files": { "video": "video.mp4", "srt": "video.srt", "vtt": "video.vtt", "thumbnail": "video.jpg", "manifest": "video.json" },
    "links": { "video": "https://tourwright.example.com/v1/jobs/…/files/video.mp4?exp=…&sig=…" },
    "chapters": [{ "title": "Q3 2026", "start": 0, "end": 8.045 }],
    "captions": [{ "text": "Sales went up.", "start": 0, "end": 3.5 }]
  }
}
```

`status`: `queued` → `running` → `done` | `failed` (`error` says why). A failure caused by the script
(bad selector, invalid voice, blocked host) is not retried; anything else is retried up to
`TOURWRIGHT_JOB_ATTEMPTS` times. `progress.stage`: `setup`, `recording`, `voice`, `drawing`, `encoding`.

`links` open without the token until they expire (`TOURWRIGHT_LINK_TTL`, 24 h): share them with people.
They are signed with `TOURWRIGHT_LINK_SECRET` and built on `TOURWRIGHT_PUBLIC_URL`.

## Webhooks

`POST` to the job's `webhook` with `{ "event": "job.done" | "job.failed", "job": { … } }`. With
`TOURWRIGHT_WEBHOOK_SECRET`, header `x-tourwright-signature: sha256=<hex HMAC-SHA256 of the raw body>`.

## Errors

`{ "error": "message", "code": "…" }` with `400` `invalid` (invalid input), `401` `unauthorized`, `403` `forbidden`, `404` `not_found`, `409` `conflict` (deleting a running job), `413` `too_large`,
`413` (body too large), `500`.
