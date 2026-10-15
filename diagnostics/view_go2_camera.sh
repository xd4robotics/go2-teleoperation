#!/usr/bin/env bash
set -Eeuo pipefail

INTERFACE="${GO2_INTERFACE:-eth0}"
GROUP="${GO2_CAMERA_GROUP:-230.1.1.1}"
PORT="${GO2_CAMERA_PORT:-1720}"

exec gst-launch-1.0 -e \
  udpsrc address="$GROUP" port="$PORT" multicast-iface="$INTERFACE" \
    caps='application/x-rtp,media=video,encoding-name=H264,clock-rate=90000' \
  ! rtph264depay \
  ! h264parse \
  ! avdec_h264 \
  ! videoconvert \
  ! autovideosink sync=false
