#!/usr/bin/env bash
set -Eeuo pipefail

WS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROS_SETUP="/opt/ros/foxy/setup.bash"
WORKSPACE_SETUP="$WS_ROOT/install/setup.bash"
FAST_LIO_CONFIG="$WS_ROOT/config/mid360.yaml"
RVIZ="${RVIZ:-true}"
LIVOX_INTERFACE="${LIVOX_INTERFACE:-eth1}"
LIVOX_HOST_IP="${LIVOX_HOST_IP:-192.168.123.171}"
LIVOX_IP="${LIVOX_IP:-192.168.123.120}"

# Fast DDS 2.1 (padrão do Foxy nesta imagem da Jetson) cresce sem limite de
# memória neste ambiente. O Cyclone DDS já está instalado e é estável aqui.
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_cyclonedds_cpp}"
export ROS_DOMAIN_ID="${ROS_DOMAIN_ID:-42}"

if [[ ! -r "$ROS_SETUP" ]]; then
  echo "[ERRO] ROS 2 Foxy não foi encontrado em $ROS_SETUP" >&2
  exit 1
fi

if [[ ! -r "$WORKSPACE_SETUP" ]]; then
  echo "[ERRO] Workspace ainda não compilado. Execute ./build.sh primeiro." >&2
  exit 1
fi

# ROS setup files reference variables that may be unset.
set +u
source "$ROS_SETUP"
source "$WORKSPACE_SETUP"
set -u

mkdir -p "$WS_ROOT/maps/pcd"

if [[ ! -e "/sys/class/net/$LIVOX_INTERFACE" ]]; then
  echo "[ERRO] Interface do LiDAR $LIVOX_INTERFACE não existe." >&2
  exit 2
fi

if [[ "$(cat "/sys/class/net/$LIVOX_INTERFACE/carrier" 2>/dev/null || echo 0)" != "1" ]]; then
  echo "[ERRO] $LIVOX_INTERFACE está sem link Ethernet (NO-CARRIER)." >&2
  echo "       Verifique a alimentação 9–27 V do MID-360, o cabo e os adaptadores." >&2
  exit 2
fi

if ! ip -4 addr show dev "$LIVOX_INTERFACE" | grep -q "inet ${LIVOX_HOST_IP}/"; then
  echo "[ERRO] $LIVOX_INTERFACE não possui o IP $LIVOX_HOST_IP." >&2
  echo "       Ative o perfil NetworkManager 'eth1'." >&2
  exit 2
fi

if ! ping -c 1 -W 1 -I "$LIVOX_HOST_IP" "$LIVOX_IP" >/dev/null 2>&1; then
  echo "[AVISO] O MID-360 não respondeu ao ping em $LIVOX_IP; o driver ainda tentará conectar."
fi

driver_pid=""
slam_pid=""

stop_process() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0

  kill -INT "$pid" 2>/dev/null || true
  for _ in {1..40}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done

  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done

  kill -KILL "$pid" 2>/dev/null || true
}

stop_stack() {
  trap - EXIT INT TERM
  stop_process "$slam_pid"
  stop_process "$driver_pid"
  [[ -n "$slam_pid" ]] && wait "$slam_pid" 2>/dev/null || true
  [[ -n "$driver_pid" ]] && wait "$driver_pid" 2>/dev/null || true
}
trap stop_stack EXIT INT TERM

echo "[1/2] Iniciando o driver do Livox MID-360..."
ros2 launch livox_ros_driver2 msg_MID360_launch.py &
driver_pid=$!
sleep 3

if ! kill -0 "$driver_pid" 2>/dev/null; then
  echo "[ERRO] O driver Livox encerrou durante a inicialização." >&2
  wait "$driver_pid"
fi

echo "[2/2] Iniciando FAST-LIO2 (RViz=$RVIZ)..."
ros2 launch fast_lio mapping_mid360.launch.py \
  config_path:="$FAST_LIO_CONFIG" \
  rviz:="$RVIZ" &
slam_pid=$!

echo "Mapeamento ativo. Mova o robô devagar e pressione Ctrl+C para salvar o PCD."
wait -n "$driver_pid" "$slam_pid"
