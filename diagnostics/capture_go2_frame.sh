#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INTERFACE="${GO2_INTERFACE:-eth0}"
GROUP="${GO2_CAMERA_GROUP:-230.1.1.1}"
PORT="${GO2_CAMERA_PORT:-1720}"
OUTPUT="${1:-$ROOT/go2_camera_frame.jpg}"
PART_PATTERN="${OUTPUT}.part-%05d.jpg"

rm -f "${OUTPUT}.part-"*.jpg

status=0
timeout --signal=INT 4s gst-launch-1.0 -e -q \
  udpsrc address="$GROUP" port="$PORT" multicast-iface="$INTERFACE" \
    caps='application/x-rtp,media=video,encoding-name=H264,clock-rate=90000' \
  ! rtph264depay \
  ! h264parse \
  ! avdec_h264 \
  ! videoconvert \
  ! jpegenc quality=90 \
  ! multifilesink location="$PART_PATTERN" max-files=1 \
  || status=$?

if [[ "$status" -ne 0 && "$status" -ne 124 ]]; then
  echo "Falha ao receber a câmera do Go2 (status $status)." >&2
  exit "$status"
fi

shopt -s nullglob
parts=("${OUTPUT}.part-"*.jpg)
if [[ "${#parts[@]}" -ne 1 ]]; then
  echo "Nenhum frame foi recebido da câmera do Go2." >&2
  exit 1
fi

mv "${parts[0]}" "$OUTPUT"

echo "Frame salvo em: $OUTPUT"
