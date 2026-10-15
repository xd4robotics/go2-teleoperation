#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/setup_go2.sh"

if ! ip link show eth0 | grep -q "LOWER_UP"; then
  echo "[ERRO] eth0 está sem conexão com a rede do Go2." >&2
  exit 1
fi

mkdir -p "$ROOT/maps"

cleanup() {
  if [[ -n "${RVIZ_PID:-}" ]]; then
    kill "$RVIZ_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

rviz2 -d "$ROOT/config/go2_mapping.rviz" &
RVIZ_PID=$!

echo "RViz aberto. Use este terminal para o teleop lento e para salvar o mapa."
python3 "$ROOT/go2_slam/mapping_node.py" "$@"
