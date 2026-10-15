#!/usr/bin/env bash
set -Eeuo pipefail

WS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

set +u
source /opt/ros/foxy/setup.bash
set -u

cd "$WS_ROOT"
colcon build \
  --symlink-install \
  --cmake-args \
    -DROS_EDITION=ROS2 \
    -DCMAKE_BUILD_TYPE=Release
