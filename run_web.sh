#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_ENV="$ROOT/frontend/.env.local"
BACKEND_ENV="$ROOT/backend/.env"

value_from() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
    END {
      sub(/\r$/, "", value)
      gsub(/^['\"']|['\"']$/, "", value)
      print value
    }
  ' "$file"
}

detect_ip() {
  local selected
  selected="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')"
  if [[ -z "$selected" ]]; then
    selected="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$selected"
}

"$ROOT/scripts/check_supabase.sh"

WEB_IP="${WEB_HOST_IP:-$(detect_ip)}"
[[ -n "$WEB_IP" ]] || {
  echo "[ERRO] Não foi possível descobrir o IPv4 da Jetson. Use WEB_HOST_IP=192.168.x.x ./run_web.sh" >&2
  exit 1
}

SUPABASE_URL="$(value_from "$FRONTEND_ENV" VITE_SUPABASE_URL)"
SUPABASE_KEY="$(value_from "$FRONTEND_ENV" VITE_SUPABASE_PUBLISHABLE_KEY)"
GATEWAY_KEY="$(value_from "$BACKEND_ENV" ROBOT_GATEWAY_API_KEY)"
GATEWAY_KEY="${GATEWAY_KEY:-go2-local-fastapi-gateway}"

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
else
  echo "O Docker precisa de permissão administrativa nesta Jetson."
  DOCKER=(sudo docker)
  "${DOCKER[@]}" info >/dev/null
fi

suffix="$$"
backend_container="go2-fastapi-$suffix"
frontend_container="go2-frontend-$suffix"
gateway_pid=""

cleanup() {
  trap - EXIT INT TERM
  echo
  echo "Encerrando painel integrado..."
  "${DOCKER[@]}" rm -f "$frontend_container" "$backend_container" >/dev/null 2>&1 || true
  if [[ -n "$gateway_pid" ]] && kill -0 "$gateway_pid" 2>/dev/null; then
    kill -INT "$gateway_pid" 2>/dev/null || true
    wait "$gateway_pid" 2>/dev/null || true
  fi
}

stop_on_signal() {
  cleanup
  exit 130
}

trap cleanup EXIT
trap stop_on_signal INT TERM

echo "Validando e construindo o backend FastAPI..."
"${DOCKER[@]}" build -t go2-integrated-backend:local "$ROOT/backend"

echo "Construindo o frontend React da Bianca para http://$WEB_IP:5173 ..."
"${DOCKER[@]}" build \
  --build-arg "VITE_SUPABASE_URL=$SUPABASE_URL" \
  --build-arg "VITE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_KEY" \
  --build-arg "VITE_API_URL=/" \
  --build-arg "VITE_LIVEKIT_ENABLED=false" \
  --build-arg "VITE_CAMERA_ENABLED=false" \
  -t go2-integrated-frontend:local \
  "$ROOT/frontend"

echo "Iniciando gateway ROS/SLAM local sem câmera e sem LiveKit..."
GO2_CAMERA_ENABLED=false ROBOT_GATEWAY_API_KEY="$GATEWAY_KEY" \
  "$ROOT/robot_gateway/run_gateway.sh" &
gateway_pid=$!

for _ in {1..40}; do
  if curl --silent --fail http://127.0.0.1:8081/health >/dev/null; then
    break
  fi
  kill -0 "$gateway_pid" 2>/dev/null || {
    echo "[ERRO] O gateway ROS encerrou durante a inicialização." >&2
    exit 1
  }
  sleep 0.25
done
curl --silent --fail http://127.0.0.1:8081/health >/dev/null || {
  echo "[ERRO] O gateway ROS não ficou pronto na porta 8081." >&2
  exit 1
}

"${DOCKER[@]}" run --rm --detach \
  --name "$backend_container" \
  --network host \
  --env-file "$BACKEND_ENV" \
  -e "CORS_ORIGINS=http://$WEB_IP:5173,http://localhost:5173,http://127.0.0.1:5173" \
  -e "ROBOT_GATEWAY_URL=http://127.0.0.1:8081" \
  -e "ROBOT_GATEWAY_API_KEY=$GATEWAY_KEY" \
  go2-integrated-backend:local >/dev/null

"${DOCKER[@]}" run --rm --detach \
  --name "$frontend_container" \
  --network host \
  go2-integrated-frontend:local >/dev/null

for _ in {1..80}; do
  if curl --silent --fail http://127.0.0.1:8000/health >/dev/null &&
     curl --silent --fail http://127.0.0.1:5173/health >/dev/null; then
    break
  fi
  sleep 0.25
done

curl --silent --fail http://127.0.0.1:8000/health >/dev/null || {
  "${DOCKER[@]}" logs "$backend_container" >&2 || true
  echo "[ERRO] O FastAPI não iniciou." >&2
  exit 1
}
curl --silent --fail http://127.0.0.1:5173/health >/dev/null || {
  "${DOCKER[@]}" logs "$frontend_container" >&2 || true
  echo "[ERRO] O frontend não iniciou." >&2
  exit 1
}

echo
echo "============================================================"
echo " Painel Go2:  http://$WEB_IP:5173"
echo " Áudio/microfone: abra http://localhost:5173 na Jetson"
echo " FastAPI:     http://$WEB_IP:8000/docs"
echo " Notebook:    use http://localhost:5173 via túnel SSH para áudio/gamepad"
echo " Supabase:    validado antes da inicialização"
echo " Para parar:  Ctrl+C"
echo "============================================================"
echo

while kill -0 "$gateway_pid" 2>/dev/null &&
      "${DOCKER[@]}" inspect -f '{{.State.Running}}' "$backend_container" 2>/dev/null | grep -q true &&
      "${DOCKER[@]}" inspect -f '{{.State.Running}}' "$frontend_container" 2>/dev/null | grep -q true; do
  sleep 1
done

echo "[ERRO] Um dos serviços encerrou inesperadamente." >&2
exit 1
