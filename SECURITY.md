# Security

Tourwright runs a real browser on your server and opens the pages a script asks for. Treat a script as you
would treat a URL someone asks your server to visit.

## What protects an API job

- **No code**: the API and MCP accept only declarative scripts. JavaScript scripts run only from the CLI or
  `tourwright_render_file`, which are for trusted local use.
- **Files**: a job can only read its own assets (no `..`, no absolute paths). Remote images are refused.
- **Network**: only `http(s)`. `TOURWRIGHT_ALLOWED_HOSTS` limits which hosts can be opened;
  `TOURWRIGHT_BLOCK_PRIVATE=true` blocks private ranges, loopback, link-local and cloud metadata
  (169.254.169.254) by resolving every host. `hosts` (origin remapping) is not available to API jobs.
  Slides' HTML is drawn with the network off.
- **Secrets**: `${env:TOURWRIGHT_SECRET_*}` is off for API jobs unless `TOURWRIGHT_ALLOW_SECRETS=true` — any client
  that can submit a script could type a secret into a page it controls.
- **Tenancy**: each API token sees only its jobs, files and saved sessions.
- **Links**: download links are HMAC-signed per job and file, and expire.
- **Processes**: each render runs in its own process with a time limit, low priority and, in Docker, as a
  non-root user.

## What it does not do

The request guard is enforced inside the browser; a redirect or DNS rebinding could still reach an internal
address in edge cases. **For untrusted clients, also isolate the workers at the network level**: run them
in a network (Docker network, Kubernetes NetworkPolicy, firewall) that can reach the internet but not your
internal services or the cloud metadata endpoint.

## Reporting

Report vulnerabilities privately through the repository's security advisories, not public issues.
