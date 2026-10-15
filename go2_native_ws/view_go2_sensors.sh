#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAMERA="$ROOT/../diagnostics/view_go2_camera.sh"

cleanup() {
  if [[ -n "${CAMERA_PID:-}" ]]; then
    kill "$CAMERA_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

"$CAMERA" &
CAMERA_PID=$!
"$ROOT/view_go2_lidar.sh"
