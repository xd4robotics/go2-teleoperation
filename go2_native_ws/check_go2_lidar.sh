#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_LIB="$ROOT/unitree_sdk2/thirdparty/lib/$(uname -m)"
PROBE="$ROOT/native_sensors/build/go2_lidar_probe"

if [[ ! -x "$PROBE" ]]; then
  echo "Receptor ainda não compilado; compilando agora..."
  "$ROOT/build_native_sensors.sh"
fi

if ! ip link show eth0 | grep -q "UP"; then
  echo "[ERRO] eth0 não está ativa."
  exit 1
fi

export LD_LIBRARY_PATH="$SDK_LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$PROBE" eth0 "${1:-12}"
