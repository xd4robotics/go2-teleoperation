# SLAM 3D - Livox Mid-360 + Unitree Go2 + Jetson Orin
Documentacao completa do setup funcionando.

---

## Hardware

| Componente | Detalhe |
|---|---|
| LiDAR | Livox Mid-360 (com IMU integrada) |
| Robo | Unitree Go2 |
| Computador | Jetson Orin 100 TOPS |
| SO | Ubuntu 20.04 |
| ROS | ROS2 Foxy |

### Conexoes de rede
- `go2eth` — Go2 + modem AX2S (IP fixo: `192.168.123.170/24`)
- `eth2` — LiDAR via adaptador USB-Ethernet (`192.168.2.2` + `192.168.123.171/32`)
- `wlan0` — WiFi/internet (IP dinamico, unica interface com rota default)
- LiDAR Mid-360: `192.168.123.120` | Modem AX2S: `192.168.123.1`

**Importante:** os nomes `go2eth`/`eth2` sao fixados pelo **MAC** das placas
em `/etc/netplan/20-eth1.yaml` (copia versionada em `config/netplan-slam.yaml`).
A placa do Go2 usa o nome `go2eth` de proposito: nomes `eth0`/`eth1` sao
sorteados pelo kernel na enumeracao, e quando o USB do LiDAR enumerava
primeiro ele ocupava `eth0` e a placa do Go2 ficava sem IP (bug de boot
intermitente). Nenhuma placa cabeada usa DHCP nem gateway — internet so pelo
wlan0. Obs.: a interface grafica pode mostrar essas placas como
"desconectado/nao gerenciado" — e normal (elas sao gerenciadas pelo
systemd-networkd, nao pelo NetworkManager).

Se trocar uma placa fisica: atualizar o MAC em `config/netplan-slam.yaml`,
copiar para `/etc/netplan/20-eth1.yaml` e rodar `sudo netplan apply`.

---

## Estrutura de arquivos

```
~/slam_ws/
├── src/
│   ├── Livox-SDK2/                    # SDK C++ do LiDAR (compilado)
│   ├── livox_ros_driver2/             # Driver ROS2 do Mid-360
│   │   └── config/
│   │       └── MID360_config.json     # <<< CONFIG DE REDE DO LIDAR
│   └── fast_lio/                      # SLAM FAST-LIO2
│       ├── config/
│       │   └── mid360.yaml            # <<< CONFIG DO SLAM
│       └── launch/
│           └── mapping_mid360.launch.py
├── install/                           # Workspace compilado (colcon build)
├── maps/
│   └── pcd/                           # PCDs salvos automaticamente aqui
├── bags/                              # Rosbags gravados aqui
├── rviz/
│   └── slam_mid360.rviz               # Config do RViz2
├── web_viewer/
│   └── slam_server.py                 # Viewer web alternativo (porta 8080)
└── run_slam.sh                        # <<< SCRIPT PRINCIPAL - rode isso
```

---

## Acesso remoto (celular/PC via Wi-Fi do roteador)

O viewer web sobe **sozinho no boot** (servico systemd `slam-web`) escutando
em todas as redes na porta 8080. Qualquer dispositivo conectado ao Wi-Fi do
roteador (AX2S, ligado via RJ45 na rede do Go2) acessa:

```
http://192.168.123.170
```
(sem https e sem porta — o nginx local faz proxy da porta 80 para o viewer
na 8080; `http://192.168.123.170:8080` tambem funciona)

**Fluxo do operador (2 botoes, nada mais):**
1. `🚀 Ligar SLAM e Gravar` — com o robo parado; aguardar ~15s
2. Mapear andando com o robo
3. `🛑 Parar e Salvar Mapa` — salva o PCD cru e gera o PLY nivelado

Uma sessao de mapeamento em andamento sobrevive a reinicio do servidor web
(o novo servidor "adota" a sessao). O script antigo `run_slam_web.sh` esta
obsoleto — nao use; ele apenas mostra estas instrucoes.

Nao existe botao separado de "gravacao": o Ligar SLAM ja grava o mapa
completo. O log da execucao fica em `log/web_slam_run.log`.

**Protecao contra queda de energia/bateria:** a cada 3 minutos o mapa
acumulado e salvo em disco (checkpoint via servico `/map_save`, ajustavel
com `MAP_CHECKPOINT_INTERVAL_S`). Se o robo desligar no meio, perde-se no
maximo os ultimos 3 minutos: na proxima inicializacao o mapa parcial e
recuperado automaticamente como `maps/pcd/scan_recovered_<data>.pcd` + PLY
nivelado.

Gerenciar o servico:
```bash
systemctl status slam-web      # estado
sudo systemctl restart slam-web
sudo journalctl -u slam-web -f # logs do servidor web
```
O arquivo do servico fica versionado em `config/slam-web.service`
(instalado em `/etc/systemd/system/`).

---

## Como usar

### 1. Ligar tudo (unico comando)
```bash
bash ~/slam_ws/run_slam.sh
```

Isso inicia em ordem:
1. Driver Livox Mid-360
2. Auto-nivelamento pela gravidade (~2s com o robo parado)
3. FAST-LIO2 SLAM
4. Rosbag (desativado por padrao; ver abaixo)
5. RViz2 ou viewer web

Variaveis uteis:
```bash
ENABLE_BAG=1 ./run_slam.sh    # grava rosbag dos dados crus (/livox/lidar + /livox/imu)
AUTO_LEVEL=0 ./run_slam.sh    # pula o auto-nivelamento (usa o world_level.json atual)
ENABLE_RVIZ=1 ./run_slam.sh   # abre RViz2
```

O rosbag fica **desativado por padrao** porque cada sessao gera varios GB
(a pasta `bags/` ja chegou a ~96 GB). Grave apenas quando precisar re-rodar
o SLAM offline — os topicos crus bastam para isso.

### 2. Mapear
- Mova o LiDAR pelo ambiente devagar
- A nuvem de pontos aparece em tempo real no RViz2
- PCDs sao salvos automaticamente a cada 50 frames em `~/slam_ws/maps/pcd/`

### 3. Parar e salvar
```
Ctrl+C no terminal
```
O PCD final e salvo automaticamente. Alem do PCD cru, o script gera um
`.ply` **nivelado, sem outliers e com voxel de 5 cm** (via
`tools/postprocess_map.py`) — e esse o arquivo para abrir no
CloudCompare/MeshLab. Para mais detalhe no PLY, reduza `--voxel` na
chamada dentro do `run_slam.sh` (ex.: `0.02`).

---

## Arquivos de saida

| Arquivo | Local | Descricao |
|---|---|---|
| PCD parciais | `~/slam_ws/maps/pcd/` | Nuvem de pontos (um arquivo a cada 50 frames) |
| Rosbag | `~/slam_ws/bags/<timestamp>/` | Dados brutos para reprojecao (so com `ENABLE_BAG=1`) |

Para ver o PCD no PC: abrir com **CloudCompare** ou **MeshLab**.

---

## Configs importantes

### Rede do LiDAR
Arquivo: `~/slam_ws/src/livox_ros_driver2/config/MID360_config.json`

```json
"host_net_info": {
    "cmd_data_ip": "192.168.2.2",   <- IP da Jetson na NIC dedicada do LiDAR
    ...
}
"lidar_configs": [
    { "ip": "192.168.2.1" }         <- IP do Mid-360
]
```

Se trocar de maquina: alterar o `host_net_info` para o IP da nova maquina
e confirmar o IP do LiDAR com `ping 192.168.2.1`.

### SLAM (FAST-LIO2)
Arquivo: `~/slam_ws/src/fast_lio/config/mid360.yaml`

- `lid_topic: /livox/lidar` — topico do LiDAR
- `imu_topic: /livox/imu` — IMU integrada do Mid-360 (nao usa IMU do Go2)
- `map_file_path: /home/unitree/slam_ws/maps/pcd/` — onde salva os PCDs
- `interval: 50` — salva PCD a cada 50 frames

### Angulo do LiDAR na cabeca do robo
Arquivo: `~/slam_ws/run_slam.sh`

O MID-360 tem IMU integrada. Portanto, a inclinacao fisica do conjunto no robo
nao deve ser colocada na extrinseca interna LiDAR↔IMU do FAST-LIO. Neste setup,
o ajuste correto e:
- nivelar o frame global em `map_level -> camera_init` quando o mundo todo aparece torto
- publicar um `tf` fixo do frame do SLAM (`body`) para o frame do robo (`base_link`)
- republicar a odometria corrigida em `/Odometry_base_link`
- salvar a calibracao em `config/robot_mount.json`

Para nivelar a nuvem/chao no RViz e no viewer:
- arquivo: `config/world_level.json`
- RViz usa `map_level` como Fixed Frame
- o painel web "Nivelar mapa" ajusta esse frame ao vivo

**Auto-nivelamento (padrao):** o FAST-LIO usa a pose inicial do IMU como
frame global, sem alinhar com a gravidade — por isso o mapa nascia torto.
Agora, antes do SLAM subir, `tools/auto_level_from_imu.py` mede ~2s do
acelerometro (robo parado), calcula roll/pitch em relacao a gravidade e
grava em `config/world_level.json`. O mapa ja nasce nivelado; os sliders
do viewer servem para ajuste fino em cima disso. Se o robo estiver em
movimento na largada, o script recusa a medicao e mantem o config anterior.
Desativar com `AUTO_LEVEL=0`.

Configuracao atual no script:

```bash
PUBLISH_ROBOT_BASE_TF=1
PUBLISH_BASE_ODOM=1
BASE_ODOM_TOPIC=/Odometry_base_link
SLAM_BODY_FRAME=body
ROBOT_BASE_FRAME=base_link
ROBOT_BASE_ROLL_DEG=30.0
ROBOT_BASE_PITCH_DEG=0.0
```

Interpretacao:
- `ROBOT_BASE_ROLL_DEG=30.0` testa o caso em que o eixo efetivo da inclinacao cai em `roll`
- `ROBOT_BASE_PITCH_DEG=0.0` zera o teste anterior
- a odometria corrigida sai em `/Odometry_base_link`
- se o sentido ainda ficar invertido, troque para `-30.0`
- se o angulo real for em outro eixo, ajustar:
  - `ROBOT_BASE_ROLL_DEG`
  - `ROBOT_BASE_PITCH_DEG`
  - `ROBOT_BASE_YAW_DEG`

Observacao importante:
- o viewer web agora le `/Odometry_base_link`
- o painel de calibracao no viewer grava em `config/robot_mount.json`
- RViz e viewer usam a mesma calibracao durante a execucao

---

## Se precisar recompilar (nova maquina ou apos mudancas)

```bash
cd ~/slam_ws

# Recompilar Livox-SDK2 se necessario
cd src/Livox-SDK2 && mkdir -p build && cd build
cmake .. && make -j$(nproc) && sudo make install
cd ~/slam_ws

# Recompilar workspace ROS2
colcon build --symlink-install --cmake-args -DCMAKE_BUILD_TYPE=Release
source install/setup.bash
echo "source ~/slam_ws/install/setup.bash" >> ~/.bashrc
```

---

## Topicos ROS2 publicados

| Topico | Tipo | Descricao |
|---|---|---|
| `/livox/lidar` | PointCloud2 | Scan bruto do Mid-360 |
| `/livox/imu` | Imu | IMU do Mid-360 |
| `/cloud_registered` | PointCloud2 | Nuvem alinhada pelo SLAM |
| `/Odometry` | Odometry | Posicao estimada |
| `/path` | Path | Trajetoria percorrida |

---

## Problemas conhecidos e solucoes

**LiDAR nao conecta**
```bash
ping 192.168.2.1   # confirmar IP do LiDAR
ip addr show eth2  # ou eth3, confirmar IP 192.168.2.2 no adaptador USB
```

**Porta 8080 ou processo travado**
```bash
pkill -9 -f fastlio; pkill -9 -f livox_ros; pkill -9 -f slam_server
```

**PCD nao salva**
- Verificar se a pasta existe: `mkdir -p ~/slam_ws/maps/pcd`
- O Ctrl+C precisa esperar ~4 segundos para o FAST-LIO terminar de escrever

**RViz2 nao abre (sem display)**
- Rodar via NoMachine ou com DISPLAY configurado
- Alternativa: usar o viewer web em `http://localhost:8080` (rodar `slam_server.py` separado)

rd for unitree: 
unitree@ubuntu:~$ sudo ip route add default via 10.119.52.66 dev wlan0 metric 50 




