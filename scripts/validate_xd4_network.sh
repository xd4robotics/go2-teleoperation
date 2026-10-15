#!/usr/bin/env bash
set -uo pipefail

result=0

echo "=== NetworkManager ==="
nmcli device status || result=1

echo
echo "=== Rotas IPv4 ==="
ip route || result=1

echo
echo "=== Internet por IP ==="
ping -c 3 -W 3 8.8.8.8 || result=1

echo
echo "=== Internet e DNS ==="
ping -c 3 -W 3 google.com || result=1

exit "$result"
