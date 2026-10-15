#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cmake -S "$ROOT/native_sensors" -B "$ROOT/native_sensors/build" \
  -DCMAKE_BUILD_TYPE=Release
cmake --build "$ROOT/native_sensors/build" --parallel "$(nproc)"

echo "Build concluído: $ROOT/native_sensors/build/go2_lidar_probe"
