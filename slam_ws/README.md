# Exemplo MID-360 + FAST-LIO2

Este workspace foi reconstruído a partir das configurações recuperáveis de
`slam_ws.tar.xz`. O arquivo original está truncado e não contém o código-fonte
completo do FAST-LIO. Para tornar o exemplo compilável, foram usados:

- `livox_ros_driver2`, da Livox;
- o port ROS 2 do FAST-LIO usado pelo exemplo original;
- a calibração e os parâmetros do MID-360 recuperados do arquivo.

## Fluxo de dados

```text
MID-360
  ├─ /livox/lidar ─┐
  └─ /livox/imu ───┴─> FAST-LIO2
                         ├─ /cloud_registered (nuvem alinhada)
                         ├─ /Odometry (pose estimada)
                         ├─ /path (trajetória)
                         └─ maps/pcd/scans.pcd (mapa 3D)
```

## Configuração de rede

O exemplo está configurado para:

- computador/Jetson na interface dedicada `eth1`: `192.168.123.171`;
- MID-360: `192.168.123.120`.

Esses valores ficam em `src/livox_ros_driver2/config/MID360_config.json`.
Antes de ligar o mapeamento, o endereço do computador precisa existir em uma
interface Ethernet e o LiDAR deve responder na mesma rede.

O perfil persistente `eth1` também mantém `192.168.2.2/24`, não instala rota
padrão e direciona somente `192.168.123.120/32` para o adaptador USB.

## Compilar e executar

```bash
cd /home/unitree/Desktop/Teleop_Go2/slam_ws
chmod +x build.sh run_mapping.sh
./build.sh
./run_mapping.sh
```

Para executar sem RViz:

```bash
RVIZ=false ./run_mapping.sh
```

Finalize com `Ctrl+C`. O FAST-LIO grava o mapa em `maps/pcd/scans.pcd`.

O launcher usa `rmw_cyclonedds_cpp` por padrão. O Fast DDS fornecido nesta
instalação do Foxy apresentou crescimento anormal de memória durante os testes.

## Limite deste exemplo

O FAST-LIO fornece nuvem 3D e odometria, mas não realiza sozinho navegação
autônoma. Para navegar com Nav2 ainda serão necessários:

1. TF calibrado entre `body`, `base_link` e o sensor;
2. conversão/filtragem da nuvem 3D para um mapa ou costmap navegável;
3. localização persistente no mapa salvo;
4. ponte segura de `/cmd_vel` para o SDK do Go2;
5. watchdog, parada de emergência e limites de velocidade.

Os arquivos originais recuperados estão em `config/reference_from_archive/`.
