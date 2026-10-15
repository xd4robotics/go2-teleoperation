#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/setup_go2.sh"
exec ros2 service call /go2_slam/save_map std_srvs/srv/Trigger '{}'
