#!/usr/bin/env bash

GO2_WS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GO2_SETUP_RESTORE_NOUNSET=false
if [[ "$-" == *u* ]]; then
  GO2_SETUP_RESTORE_NOUNSET=true
  set +u
fi

source /opt/ros/foxy/setup.bash
source "$GO2_WS_ROOT/unitree_ros2/cyclonedds_ws/install/setup.bash"

if [[ "$GO2_SETUP_RESTORE_NOUNSET" == true ]]; then
  set -u
fi
unset GO2_SETUP_RESTORE_NOUNSET

export RMW_IMPLEMENTATION=rmw_cyclonedds_cpp
export ROS_DOMAIN_ID=0
GO2_INTERFACE="${GO2_ROBOT_INTERFACE:-eth0}"
GO2_ADDRESS="${GO2_ROBOT_ADDRESS:-192.168.123.18/24}"
if [[ ! "$GO2_INTERFACE" =~ ^[[:alnum:]_.:-]+$ ]] \
  || [[ ! -d "/sys/class/net/$GO2_INTERFACE" ]]; then
  echo "[ERRO] Interface do Go2 inválida: $GO2_INTERFACE" >&2
  return 1 2>/dev/null || exit 1
fi
export CYCLONEDDS_URI="<CycloneDDS><Domain><General><Interfaces><NetworkInterface name=\"$GO2_INTERFACE\" priority=\"default\" multicast=\"default\" /></Interfaces></General></Domain></CycloneDDS>"

echo "Ambiente Go2 ativo em $GO2_INTERFACE ($GO2_ADDRESS), CycloneDDS 0.10, domínio DDS 0."
