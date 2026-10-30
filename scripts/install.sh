#!/usr/bin/env bash
# Installs Tourwright's runtime pieces without root and without Docker (Linux and macOS). The work is done by
# `tourwright install`, which also runs on Windows (scripts/install.ps1); this script adds `npm install`.
#
#   ./scripts/install.sh                          # everything, default voices
#   VOICES="en_US-amy-medium" ./scripts/install.sh
#   WITH_EDGE_TTS=false ./scripts/install.sh      # skip the Microsoft Edge voices
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || { echo "Tourwright needs Node.js 20 or newer" >&2; exit 1; }

(cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)

args=()
[[ -n "${VOICES:-}" ]] && args+=(--voices "${VOICES// /,}")
[[ "${WITH_EDGE_TTS:-true}" == "false" ]] && args+=(--no-edge)
# ${args[@]+…}: bash 3.2 (macOS) treats an empty array as unset under `set -u`
node "$ROOT/bin/tourwright.js" install ${args[@]+"${args[@]}"}
