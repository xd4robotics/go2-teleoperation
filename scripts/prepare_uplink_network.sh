#!/usr/bin/env bash
set -Eeuo pipefail

UPLINK_CONNECTION="${GO2_UPLINK_CONNECTION:-XD4 Local}"
UPLINK_INTERFACE="${GO2_UPLINK_INTERFACE:-wlan0}"
ROBOT_INTERFACE="${GO2_ROBOT_INTERFACE:-auto}"
ROBOT_ADDRESS="${GO2_ROBOT_ADDRESS:-192.168.123.18/24}"
ROBOT_HOST="${GO2_ROBOT_HOST:-192.168.123.161}"
NETWORK_RUNTIME_FILE="${GO2_NETWORK_RUNTIME_FILE:-/run/oracle-go2-teleoperation/network.env}"
PRIMARY_SSID="${GO2_UPLINK_SSID:-xd4 main}"
FALLBACK_CONNECTION="${GO2_FALLBACK_CONNECTION:-Bianca}"
FALLBACK_SSID="${GO2_FALLBACK_SSID:-Bianca}"
FALLBACK_PASSWORD="${GO2_FALLBACK_PASSWORD:-}"

nmcli radio wifi on

# XD4 continua sendo a rede preferencial. O perfil Bianca fica habilitado com
# prioridade menor para assumir a wlan0 quando XD4 nao estiver disponivel.
primary_profile_exists=true
if nmcli connection show "$UPLINK_CONNECTION" >/dev/null 2>&1; then
  nmcli connection modify "$UPLINK_CONNECTION" \
    connection.autoconnect yes \
    connection.autoconnect-priority 100 \
    connection.interface-name "$UPLINK_INTERFACE" \
    ipv4.never-default no \
    ipv4.route-metric 20 \
    ipv6.never-default no \
    ipv6.route-metric 20
else
  primary_profile_exists=false
  echo "[AVISO] Perfil '$UPLINK_CONNECTION' ainda não existe; usando o fallback disponível." >&2
fi

fallback_profile_exists=true
if ! nmcli connection show "$FALLBACK_CONNECTION" >/dev/null 2>&1; then
  fallback_profile_exists=false
  if [[ -n "$FALLBACK_PASSWORD" ]]; then
    nmcli connection add \
      type wifi \
      ifname "$UPLINK_INTERFACE" \
      con-name "$FALLBACK_CONNECTION" \
      ssid "$FALLBACK_SSID"
    fallback_profile_exists=true
  fi
fi

if [[ "$fallback_profile_exists" == true ]]; then
  nmcli connection modify "$FALLBACK_CONNECTION" \
    connection.autoconnect yes \
    connection.autoconnect-priority 50 \
    connection.interface-name "$UPLINK_INTERFACE" \
    802-11-wireless.ssid "$FALLBACK_SSID" \
    ipv4.method auto \
    ipv4.never-default no \
    ipv4.route-metric 30 \
    ipv6.never-default no \
    ipv6.route-metric 30

  if [[ -n "$FALLBACK_PASSWORD" ]]; then
    nmcli connection modify "$FALLBACK_CONNECTION" \
      802-11-wireless-security.key-mgmt wpa-psk \
      802-11-wireless-security.psk "$FALLBACK_PASSWORD"
  fi
fi

ssid_is_visible() {
  local wanted_ssid="$1"
  local visible_ssid

  while IFS= read -r visible_ssid; do
    [[ "$visible_ssid" == "$wanted_ssid" ]] && return 0
  done < <(nmcli -g SSID device wifi list ifname "$UPLINK_INTERFACE" 2>/dev/null || true)

  return 1
}

# Atualiza a lista antes da escolha. Se o scan falhar, a ausencia de XD4 ainda
# leva ao fallback; o restart do servico tentara novamente caso nenhuma rede
# esteja acessivel naquele instante.
nmcli --wait 15 device wifi rescan ifname "$UPLINK_INTERFACE" 2>/dev/null || true
active_connection="$(nmcli -g GENERAL.CONNECTION device show "$UPLINK_INTERFACE" 2>/dev/null || true)"
active_state="$(nmcli -g GENERAL.STATE device show "$UPLINK_INTERFACE" 2>/dev/null || true)"

# Durante o boot o scan pode ainda estar vazio, embora o NetworkManager já
# tenha associado a wlan0. Preservar a conexão ativa evita uma troca indevida
# para o fallback e permite que DHCP termine normalmente.
if [[ -n "$active_connection" && "$active_connection" != "--" \
  && "$active_state" == 100* ]]; then
  selected_connection="$active_connection"
elif [[ "$primary_profile_exists" == true ]] && ssid_is_visible "$PRIMARY_SSID"; then
  selected_connection="$UPLINK_CONNECTION"
elif [[ "$fallback_profile_exists" == true ]]; then
  selected_connection="$FALLBACK_CONNECTION"
else
  echo "[ERRO] XD4 indisponivel e o perfil de fallback nao esta configurado." >&2
  echo "Defina GO2_FALLBACK_PASSWORD no arquivo de ambiente do servico." >&2
  exit 1
fi

if [[ "$active_connection" != "$selected_connection" ]]; then
  nmcli --wait 30 connection up "$selected_connection" ifname "$UPLINK_INTERFACE"
fi

uplink_gateway=""
for _ in {1..30}; do
  uplink_gateway="$(
    nmcli -g IP4.GATEWAY device show "$UPLINK_INTERFACE" | head -n 1
  )"
  [[ -n "$uplink_gateway" ]] && break
  sleep 1
done
[[ -n "$uplink_gateway" ]] || {
  echo "[ERRO] A conexao '$selected_connection' nao recebeu gateway IPv4." >&2
  exit 1
}

interface_has_carrier() {
  local interface="$1"
  [[ -r "/sys/class/net/$interface/carrier" ]] \
    && [[ "$(<"/sys/class/net/$interface/carrier")" == "1" ]]
}

probe_robot_interface() {
  local interface="$1"
  local address_added=false

  [[ "$interface" != "$UPLINK_INTERFACE" ]] || return 1
  [[ "$interface" =~ ^(eth|en)[[:alnum:]_.:-]*$ ]] || return 1
  interface_has_carrier "$interface" || return 1

  ip link set "$interface" up
  if ! ip -o -4 address show dev "$interface" \
    | awk '{print $4}' | grep -Fxq "$ROBOT_ADDRESS"; then
    ip -4 address replace "$ROBOT_ADDRESS" dev "$interface"
    address_added=true
  fi

  if ping -I "$interface" -c 1 -W 1 "$ROBOT_HOST" >/dev/null 2>&1; then
    return 0
  fi

  # O controlador pode bloquear ICMP ou terminar o boot depois da Jetson.
  # Carrier + endereço correto bastam para iniciar CycloneDDS; o gateway só
  # libera movimento quando os estados nativos realmente forem descobertos.
  echo "[AVISO] $ROBOT_HOST ainda não respondeu; iniciando DDS em $interface e aguardando os tópicos nativos." >&2
  return 0

  if [[ "$address_added" == true ]]; then
    ip -4 address del "$ROBOT_ADDRESS" dev "$interface" 2>/dev/null || true
  fi
  return 1
}

robot_candidates=()
if [[ "$ROBOT_INTERFACE" != "auto" ]]; then
  robot_candidates+=("$ROBOT_INTERFACE")
fi
for interface_path in /sys/class/net/eth* /sys/class/net/en*; do
  [[ -e "$interface_path" ]] || continue
  candidate="${interface_path##*/}"
  [[ " ${robot_candidates[*]} " == *" $candidate "* ]] \
    || robot_candidates+=("$candidate")
done

selected_robot_interface=""
for candidate in "${robot_candidates[@]}"; do
  if probe_robot_interface "$candidate"; then
    selected_robot_interface="$candidate"
    break
  fi
done

[[ -n "$selected_robot_interface" ]] || {
  echo "[ERRO] Nenhuma Ethernet com acesso ao Go2 ($ROBOT_HOST) foi encontrada." >&2
  echo "       Confirme o cabo e a energia do robô; interfaces testadas: ${robot_candidates[*]}." >&2
  exit 1
}
ROBOT_INTERFACE="$selected_robot_interface"

robot_connection="$(
  nmcli -g GENERAL.CONNECTION device show "$ROBOT_INTERFACE" 2>/dev/null \
    || true
)"
if [[ -n "$robot_connection" && "$robot_connection" != "--" ]]; then
  nmcli connection modify "$robot_connection" \
    ipv4.never-default yes \
    ipv4.route-metric 600 \
    ipv6.never-default yes \
    ipv6.route-metric 600
fi

while ip -4 route show default dev "$ROBOT_INTERFACE" \
  | grep -q '^default'; do
  ip -4 route del default dev "$ROBOT_INTERFACE"
done

ip -4 route replace default via "$uplink_gateway" \
  dev "$UPLINK_INTERFACE" metric 20

selected_route="$(ip -4 route get 8.8.8.8)"
[[ "$selected_route" == *"dev $UPLINK_INTERFACE"* ]] || {
  echo "[ERRO] A rota default nao selecionou $UPLINK_INTERFACE." >&2
  exit 1
}

install -d -m 0755 "$(dirname "$NETWORK_RUNTIME_FILE")"
runtime_temporary="${NETWORK_RUNTIME_FILE}.tmp"
printf 'export GO2_ROBOT_INTERFACE=%q\nexport GO2_CAMERA_INTERFACE=%q\n' \
  "$ROBOT_INTERFACE" "$ROBOT_INTERFACE" >"$runtime_temporary"
chmod 0644 "$runtime_temporary"
mv -f "$runtime_temporary" "$NETWORK_RUNTIME_FILE"

echo "Internet: '$selected_connection' em $UPLINK_INTERFACE; Go2 local em $ROBOT_INTERFACE ($ROBOT_ADDRESS) sem rota default."
