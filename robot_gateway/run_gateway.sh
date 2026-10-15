#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"
RUNTIME_ROOT="${GO2_RUNTIME_ROOT:-$PROJECT_ROOT}"
ROS_INSTALL="$RUNTIME_ROOT/go2_native_ws/unitree_ros2/cyclonedds_ws/install/setup.bash"

# build/install não são versionados. Durante a migração local, reutiliza o
# workspace compilado do projeto anterior sem voltar para o frontend antigo.
if [[ ! -f "$ROS_INSTALL" ]]; then
  LEGACY_RUNTIME_ROOT="$(cd "$PROJECT_ROOT/../Teleop_Go2" 2>/dev/null && pwd || true)"
  LEGACY_ROS_INSTALL="$LEGACY_RUNTIME_ROOT/go2_native_ws/unitree_ros2/cyclonedds_ws/install/setup.bash"
  if [[ -n "$LEGACY_RUNTIME_ROOT" && -f "$LEGACY_ROS_INSTALL" ]]; then
    RUNTIME_ROOT="$LEGACY_RUNTIME_ROOT"
    ROS_INSTALL="$LEGACY_ROS_INSTALL"
  else
    echo "[ERRO] Ambiente ROS compilado não encontrado." >&2
    echo "       Compile go2_native_ws ou informe GO2_RUNTIME_ROOT=/caminho/do/projeto." >&2
    exit 1
  fi
fi

set +u
source "$RUNTIME_ROOT/go2_native_ws/setup_go2.sh" >/dev/null
set -u

ROBOT_INTERFACE="${GO2_ROBOT_INTERFACE:-eth0}"
ROBOT_ADDRESS="${GO2_ROBOT_ADDRESS:-192.168.123.18/24}"
if [[ ! "$ROBOT_INTERFACE" =~ ^[[:alnum:]_.:-]+$ ]] \
  || [[ ! -d "/sys/class/net/$ROBOT_INTERFACE" ]]; then
  echo "[ERRO] Interface do Go2 inválida: $ROBOT_INTERFACE" >&2
  exit 1
fi
if [[ "$(cat "/sys/class/net/$ROBOT_INTERFACE/carrier" 2>/dev/null || true)" != "1" ]]; then
  echo "[ERRO] $ROBOT_INTERFACE está sem link físico com o Go2." >&2
  exit 1
fi
export GO2_CAMERA_INTERFACE="${GO2_CAMERA_INTERFACE:-$ROBOT_INTERFACE}"
export CYCLONEDDS_URI="<CycloneDDS><Domain><General><Interfaces><NetworkInterface name=\"$ROBOT_INTERFACE\" priority=\"default\" multicast=\"default\" /></Interfaces></General></Domain></CycloneDDS>"
echo "Ambiente Go2 ativo em $ROBOT_INTERFACE ($ROBOT_ADDRESS), CycloneDDS 0.10, domínio DDS 0."

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8081}"
gateway_pid=""

stop_process() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -INT "$pid" 2>/dev/null || true
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  # O painel desarma e envia StopMove durante o encerramento.
  stop_process "$gateway_pid"
  [[ -n "$gateway_pid" ]] && wait "$gateway_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Gateway local do Go2: http://$HOST:$PORT"
echo "Ambiente ROS compilado: $RUNTIME_ROOT"
echo "O FastAPI é a única camada que deve expor estes dados ao frontend."
echo "SLAM: LIO nativo usando /utlidar/cloud_deskewed + /utlidar/robot_odom + /utlidar/imu."

python3 "$ROOT/server.py" --host "$HOST" --port "$PORT" &
gateway_pid=$!

wait "$gateway_pid"
