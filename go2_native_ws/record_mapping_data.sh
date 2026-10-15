#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$ROOT/setup_go2.sh"

OUTPUT="${1:-$ROOT/bags/go2_$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$(dirname "$OUTPUT")"

echo "Gravando LiDAR, IMU e odometria originais em: $OUTPUT"
echo "Encerre com Ctrl+C."
exec ros2 bag record -o "$OUTPUT" \
  /utlidar/cloud \
  /utlidar/imu \
  /utlidar/robot_odom \
  /utlidar/robot_pose \
  /lowstate
