#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/setup_go2.sh"

if ! ip link show eth0 | grep -q "LOWER_UP"; then
  echo "[ERRO] eth0 está sem conexão com a rede do Go2." >&2
  exit 1
fi

exec rviz2 -d "$ROOT/config/go2_lidar.rviz"
