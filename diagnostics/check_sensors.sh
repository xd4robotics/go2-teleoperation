#!/usr/bin/env bash
set -u

echo "=== Interfaces e endereços ==="
ip -br link
ip -br -4 addr
ip route

echo
echo "=== Adaptador USB do MID-360 ==="
ethtool eth1 2>/dev/null | grep -E 'Speed:|Duplex:|Link detected:' || true
nmcli -f GENERAL.DEVICE,GENERAL.STATE,WIRED-PROPERTIES.CARRIER,IP4 device show eth1 2>/dev/null || true

echo
echo "=== MID-360 esperado em 192.168.123.120 ==="
ip route get 192.168.123.120 2>/dev/null || true
ping -c 1 -W 1 -I 192.168.123.171 192.168.123.120 || true

echo
echo "=== Go2 e câmera ==="
getent hosts unitree.local || true
timeout 3 bash -c '</dev/tcp/192.168.123.161/8551' 2>/dev/null \
  && echo "RTSP 8551: acessível" || echo "RTSP 8551: indisponível"

echo
echo "=== Câmeras conectadas diretamente à Jetson ==="
v4l2-ctl --list-devices 2>&1 || true
