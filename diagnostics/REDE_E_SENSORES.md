# Diagnóstico local: Jetson, Go2, câmera e Livox MID-360

Levantamento realizado em 16/07/2026 na Jetson ARM64 com Ubuntu 20.04.

## Rede principal e Go2

| Item | Valor encontrado |
|---|---|
| Interface principal da Jetson | `eth0` — Realtek RTL8111/8168 PCIe |
| MAC da Jetson em `eth0` | `4c:bb:47:ab:c3:a8` |
| IP da Jetson em `eth0` | `192.168.123.18/24` |
| Gateway/roteador | `192.168.123.1` |
| Robô Go2 | `unitree.local` / `192.168.123.161` |
| MAC observado do Go2 | `7e:1d:75:60:f5:89` |
| Portas TCP abertas no Go2 | `80`, `8551`, `9991`, `10001` |

## Câmera frontal do Go2

A câmera foi recebida e decodificada com sucesso pela Jetson.

| Propriedade | Valor confirmado |
|---|---|
| Transporte | RTP/H.264 multicast |
| Grupo multicast | `230.1.1.1` |
| Porta UDP | `1720` |
| Interface receptora | `eth0` |
| Resolução | `1280×720` |
| Taxa | `30 fps` |
| Perfil | H.264 High, level 4 |
| RTSP detectado no robô | GStreamer RTSP Server em TCP `8551` |

Visualizar:

```bash
cd /home/unitree/Desktop/Teleop_Go2
./diagnostics/view_go2_camera.sh
```

Capturar um frame:

```bash
./diagnostics/capture_go2_frame.sh
```

Frame de validação: `diagnostics/go2_camera_frame.jpg`.

A própria Jetson não tem câmera USB/CSI ativa em `/dev/video*`. Existe apenas
o controlador NVIDIA Tegra CSI (`/dev/media0`), sem um sensor ligado a ele.

## Adaptador e MID-360

| Item | Valor encontrado/configurado |
|---|---|
| Interface do adaptador | `eth1` |
| Hardware | Realtek RTL8153 Gigabit Ethernet Adapter |
| Driver | `r8152` |
| Caminho USB | `usb1/1-3/1-3.2`, através de hub USB-C |
| Velocidade do barramento USB observada | USB 2.0, 480 Mbit/s |
| MAC | `00:e0:4c:68:00:1a` |
| IP auxiliar | `192.168.2.2/24` |
| IP usado pelo driver Livox | `192.168.123.171/32` |
| IP esperado do MID-360 | `192.168.123.120` |
| Rota dedicada | `192.168.123.120/32 dev eth1` |
| Rota padrão pelo adaptador | desativada |
| Persistência | perfil NetworkManager `eth1`, autoconnect habilitado |

### Estado físico atual

`eth1` apresenta `NO-CARRIER` / `Link detected: no`. Assim, nenhum pacote pode
chegar ao MID-360 e não é possível confirmar seu IP por software neste estado.

Também foi testado manualmente `100 Mb/s full duplex`, com autonegociação e
EEE desativados. O link permaneceu ausente e os contadores ficaram em zero
pacotes RX/TX. A autonegociação foi restaurada após o teste. Portanto, o
problema não é negociação de velocidade nem configuração IP.

Verificar fisicamente:

1. MID-360 energizado por alimentação DC separada de **9–27 V**;
2. LED/atividade do sensor e conversor;
3. conector de aviação completamente travado;
4. cabo RJ45 encaixado nos dois lados;
5. hub USB-C e adaptador RTL8153 firmes.

O MID-360 usa Ethernet 100BASE-TX, consome aproximadamente 6,5 W e **não deve
ser ligado a PoE no RJ45**. O cabo Ethernet/USB-C não substitui a alimentação
DC do sensor.

Quando o link físico estiver ativo, execute:

```bash
./diagnostics/check_sensors.sh
cd ../slam_ws
./run_mapping.sh
```

O mapa será salvo em `slam_ws/maps/pcd/scans.pcd` ao encerrar com `Ctrl+C`.

Referências de hardware:

- https://www.livoxtech.com/mid-360/specs
- https://livox-wiki-en.readthedocs.io/en/latest/tutorials/new_product/mid360/mid360.html
