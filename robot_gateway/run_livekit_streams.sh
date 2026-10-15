#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CAMERA_GROUP="${GO2_CAMERA_GROUP:-230.1.1.1}"
CAMERA_PORT="${GO2_CAMERA_PORT:-1720}"
CAMERA_INTERFACE="${GO2_CAMERA_INTERFACE:-eth0}"
ROOM_NAME="${LIVEKIT_ROOM_NAME:-go2-primary}"
VIDEO_TRANSPORT="${LIVEKIT_VIDEO_TRANSPORT:-direct}"
VIDEO_BITRATE="${LIVEKIT_VIDEO_BITRATE:-1500000}"
VIDEO_WIDTH="${LIVEKIT_VIDEO_WIDTH:-1280}"
VIDEO_HEIGHT="${LIVEKIT_VIDEO_HEIGHT:-720}"
VIDEO_FPS="${LIVEKIT_VIDEO_FPS:-30}"
VIDEO_IDR_INTERVAL="${LIVEKIT_VIDEO_IDR_INTERVAL:-15}"
VIDEO_VBV_SIZE="${LIVEKIT_VIDEO_VBV_SIZE:-$((VIDEO_BITRATE / VIDEO_FPS))}"
VIDEO_TCP_HOST="${LIVEKIT_VIDEO_TCP_HOST:-127.0.0.1}"
VIDEO_TCP_PORT="${LIVEKIT_VIDEO_TCP_PORT:-5010}"
data_pid=""
command_pid=""
ambient_bridge_pid=""
ambient_decoder_pid=""
ambient_publisher_pid=""
video_pipeline_pid=""
video_publisher_pid=""

command -v lk >/dev/null || {
  echo "[ERRO] LiveKit CLI (lk) não encontrado." >&2
  exit 1
}

LIVEKIT_CLI_CONFIG="${LIVEKIT_CLI_CONFIG:-$HOME/.livekit/cli-config.yaml}"
export LIVEKIT_PROJECT
LIVEKIT_PROJECT="${LIVEKIT_PROJECT:-$(
  awk '$1 == "default_project:" { print $2; exit }' "$LIVEKIT_CLI_CONFIG" 2>/dev/null
)}"
[[ -n "$LIVEKIT_PROJECT" ]] || {
  echo "[ERRO] Nenhum projeto padrão foi selecionado na CLI do LiveKit." >&2
  exit 1
}

stop_process() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || return 0
  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..30}; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  # Nenhum bridge pode prender o encerramento geral por tempo indefinido.
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  stop_process "$video_publisher_pid"
  stop_process "$video_pipeline_pid"
  stop_process "$ambient_bridge_pid"
  stop_process "$ambient_decoder_pid"
  stop_process "$ambient_publisher_pid"
  stop_process "$data_pid"
  stop_process "$command_pid"
  for pid in "$video_publisher_pid" "$video_pipeline_pid" "$data_pid" \
    "$command_pid" "$ambient_bridge_pid" "$ambient_decoder_pid" \
    "$ambient_publisher_pid"; do
    [[ -n "$pid" ]] && wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# Nuvem de pontos desativada por padrão: o uplink 4G fica dedicado ao vídeo
# e aos comandos. Reative com LIVEKIT_MAX_POINTS=1500 (ou outro valor 1-1500).
python3 "$ROOT/livekit_data_publisher.py" \
  --max-points "${LIVEKIT_MAX_POINTS:-0}" &
data_pid=$!
python3 "$ROOT/livekit_command_receiver.py" &
command_pid=$!

[[ -d "$ROOT/node_modules/@livekit/rtc-node" ]] || {
  echo "[ERRO] Dependências Node do áudio não instaladas." >&2
  echo "       Execute: npm --prefix robot_gateway ci" >&2
  exit 1
}

export LIVEKIT_URL
LIVEKIT_URL="${LIVEKIT_URL:-$(
  lk project list --json 2>/dev/null | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
project_name = sys.argv[1]
project = next(
    (item for item in payload if item.get("Name") == project_name),
    None,
)
print(project["URL"] if project else "")
' "$LIVEKIT_PROJECT"
)}"
[[ -n "$LIVEKIT_URL" ]] || {
  echo "[ERRO] Não foi possível resolver a URL do projeto LiveKit (lk project list)." >&2
  exit 1
}

export GO2_AMBIENT_AUDIO_LIVEKIT_TOKEN
GO2_AMBIENT_AUDIO_LIVEKIT_TOKEN="$(
  lk --project "$LIVEKIT_PROJECT" --quiet token create \
    --join \
    --room "$ROOM_NAME" \
    --identity go2-ambient-audio \
    --allow-source microphone \
    --valid-for 24h \
    --token-only
)"

node "$ROOT/livekit_ambient_audio_publisher.mjs" &
ambient_publisher_pid=$!

# O Go2 já publica seu microfone nativo em DDS como Opus estéreo/48 kHz.
# O primeiro processo preserva cada quadro em um datagrama; o GStreamer
# decodifica e reduz para PCM mono, formato aceito pelo AudioSource do LiveKit.
gst-launch-1.0 -q \
  udpsrc address=127.0.0.1 port="${GO2_NATIVE_OPUS_UDP_PORT:-5093}" \
    caps="audio/x-opus,rate=(int)48000,channels=(int)2,channel-mapping-family=(int)0" \
  ! opusparse \
  ! opusdec plc=true use-inband-fec=true \
  ! audioconvert \
  ! audioresample \
  ! "audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=1" \
  ! udpsink host="${GO2_AMBIENT_AUDIO_UDP_HOST:-127.0.0.1}" \
    port="${GO2_AMBIENT_AUDIO_UDP_PORT:-5091}" sync=false async=false &
ambient_decoder_pid=$!

PROJECT_ROOT="$(cd "$ROOT/.." && pwd)"
GO2_SETUP="$PROJECT_ROOT/go2_native_ws/setup_go2.sh"
if [[ ! -f "$PROJECT_ROOT/go2_native_ws/unitree_ros2/cyclonedds_ws/install/setup.bash" ]]; then
  GO2_SETUP="$(cd "$PROJECT_ROOT/../Teleop_Go2" && pwd)/go2_native_ws/setup_go2.sh"
fi
(
  set +u
  source "$GO2_SETUP" >/dev/null
  set -u
  robot_interface="${GO2_ROBOT_INTERFACE:-eth0}"
  export CYCLONEDDS_URI="<CycloneDDS><Domain><General><Interfaces><NetworkInterface name=\"$robot_interface\" priority=\"default\" multicast=\"default\" /></Interfaces></General></Domain></CycloneDDS>"
  exec python3 "$ROOT/unitree_dds_audio_capture.py" \
    --port "${GO2_NATIVE_OPUS_UDP_PORT:-5093}"
) &
ambient_bridge_pid=$!

echo "Câmera: RTP/H264 $CAMERA_GROUP:$CAMERA_PORT ($CAMERA_INTERFACE) → LiveKit"
echo "Nuvem: gateway local → LiveKit CLI → sala go2-primary"
echo "Controle: painel Vercel → LiveKit → gateway local"
echo "Intercom: navegador → AudioHub e microfone nativo DDS → LiveKit"

if [[ "$VIDEO_TRANSPORT" == "direct" ]]; then
  echo "Vídeo: WebRTC direto, ${VIDEO_WIDTH}x${VIDEO_HEIGHT}, ${VIDEO_BITRATE} bps"
  gst-launch-1.0 -q -e \
    udpsrc address="$CAMERA_GROUP" port="$CAMERA_PORT" multicast-iface="$CAMERA_INTERFACE" \
      caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" \
    ! rtph264depay \
    ! h264parse \
    ! nvv4l2decoder \
    ! nvvidconv \
    ! "video/x-raw(memory:NVMM),format=NV12,width=$VIDEO_WIDTH,height=$VIDEO_HEIGHT" \
    ! nvv4l2h264enc bitrate="$VIDEO_BITRATE" control-rate=1 \
        iframeinterval="$VIDEO_IDR_INTERVAL" idrinterval="$VIDEO_IDR_INTERVAL" \
        insert-sps-pps=true maxperf-enable=true num-B-Frames=0 \
        vbv-size="$VIDEO_VBV_SIZE" \
    ! h264parse config-interval=-1 \
    ! "video/x-h264,stream-format=byte-stream,alignment=au" \
    ! tcpserversink host="$VIDEO_TCP_HOST" port="$VIDEO_TCP_PORT" \
        sync=false async=false sync-method=latest-keyframe \
        unit-format=buffers units-max=30 units-soft-max=15 recover-policy=keyframe &
  video_pipeline_pid=$!

  sleep 1
  kill -0 "$video_pipeline_pid" 2>/dev/null || {
    wait "$video_pipeline_pid" || true
    echo "[ERRO] O pipeline H.264 direto não iniciou." >&2
    exit 1
  }

  lk --project "$LIVEKIT_PROJECT" --quiet room join \
    --identity go2-camera \
    --publish "h264://$VIDEO_TCP_HOST:$VIDEO_TCP_PORT" \
    --fps "$VIDEO_FPS" \
    --exit-after-publish \
    "$ROOM_NAME" >/dev/null 2>&1 &
  video_publisher_pid=$!

  while kill -0 "$video_pipeline_pid" 2>/dev/null &&
    kill -0 "$video_publisher_pid" 2>/dev/null &&
    kill -0 "$ambient_bridge_pid" 2>/dev/null &&
    kill -0 "$ambient_decoder_pid" 2>/dev/null &&
    kill -0 "$ambient_publisher_pid" 2>/dev/null; do
    sleep 1
  done
  echo "[ERRO] A publicação WebRTC direta da câmera foi interrompida." >&2
  exit 1
fi

if [[ "$VIDEO_TRANSPORT" != "rtmp" ]]; then
  echo "[ERRO] LIVEKIT_VIDEO_TRANSPORT deve ser 'direct' ou 'rtmp'." >&2
  exit 1
fi

: "${LIVEKIT_INGRESS_URL:?Defina LIVEKIT_INGRESS_URL com a URL RTMP do Ingress}"
: "${LIVEKIT_STREAM_KEY:?Defina LIVEKIT_STREAM_KEY com a chave do Ingress}"
FFMPEG_BIN="${FFMPEG_BIN:-$(command -v ffmpeg || true)}"
if [[ -z "$FFMPEG_BIN" && -x /home/unitree/.local/bin/ffmpeg ]]; then
  FFMPEG_BIN=/home/unitree/.local/bin/ffmpeg
fi
if [[ -z "$FFMPEG_BIN" ]]; then
  echo "[ERRO] FFmpeg não encontrado. Instale com: sudo apt install -y ffmpeg" >&2
  exit 1
fi
PUBLISH_URL="${LIVEKIT_INGRESS_URL%/}/${LIVEKIT_STREAM_KEY}"
echo "Vídeo: fallback RTMP/TCP para $ROOM_NAME"

gst-launch-1.0 -q -e \
  udpsrc address="$CAMERA_GROUP" port="$CAMERA_PORT" multicast-iface="$CAMERA_INTERFACE" \
    caps="application/x-rtp,media=video,encoding-name=H264,clock-rate=90000" \
  ! rtph264depay \
  ! h264parse \
  ! nvv4l2decoder \
  ! nvvidconv \
  ! "video/x-raw(memory:NVMM),format=NV12,width=$VIDEO_WIDTH,height=$VIDEO_HEIGHT" \
  ! nvv4l2h264enc bitrate="$VIDEO_BITRATE" control-rate=1 \
      iframeinterval="$VIDEO_IDR_INTERVAL" idrinterval="$VIDEO_IDR_INTERVAL" \
      insert-sps-pps=true maxperf-enable=true num-B-Frames=0 \
      vbv-size="$VIDEO_VBV_SIZE" \
  ! h264parse config-interval=-1 \
  ! "video/x-h264,stream-format=avc,alignment=au" \
  ! flvmux streamable=true \
  ! fdsink fd=1 \
  | "$FFMPEG_BIN" -hide_banner -loglevel warning -fflags nobuffer \
      -f flv -i pipe:0 -map 0:v:0 -c:v copy -an \
      -rw_timeout "${LIVEKIT_RTMP_TIMEOUT_US:-15000000}" \
      -f flv "$PUBLISH_URL"
