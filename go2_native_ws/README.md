# Sensores originais do Unitree Go2

Este workspace conecta a Jetson diretamente ao DDS nativo do Go2 pela `eth0`.
Ele usa o CycloneDDS 0.10.x exigido pelo firmware atual do robô e mantém o
workspace anterior do Livox MID-360 intacto.

## Validado nesta Jetson

- LiDAR original: `/utlidar/cloud`, `sensor_msgs/msg/PointCloud2`;
- frame da nuvem: `utlidar_lidar`;
- frequência medida: aproximadamente 15,3 Hz;
- campos: `x`, `y`, `z`, `intensity`, `ring` e `time`;
- odometria nativa: `/utlidar/robot_odom`;
- pose nativa: `/utlidar/robot_pose`;
- câmera frontal: RTP/H.264, 1280x720 a 30 FPS, multicast
  `230.1.1.1:1720` pela `eth0`.

O robô também anuncia os tópicos internos de SLAM `/uslam/*`, inclusive
`/uslam/cloud_map`, e os comandos `/api/slam_operate/*`. Eles serão usados na
etapa de criação/salvamento do mapa e navegação, depois da validação visual dos
sensores.

## Comandos

Visualizar LiDAR e câmera ao mesmo tempo:

```bash
cd ~/Desktop/Teleop_Go2/go2_native_ws
./view_go2_sensors.sh
```

Visualizar apenas o LiDAR:

```bash
./view_go2_lidar.sh
```

Testar o LiDAR sem abrir interface gráfica:

```bash
./check_go2_lidar.sh 12
```

Gravar dados crus para desenvolver/testar SLAM sem mover o robô toda vez:

```bash
./record_mapping_data.sh
```

Para usar comandos ROS 2 manualmente em outro terminal:

```bash
source ~/Desktop/Teleop_Go2/go2_native_ws/setup_go2.sh
ros2 topic list
```

Não misture este ambiente com o `slam_ws` do Livox no mesmo terminal.

## SLAM 3D LiDAR-inercial com o LiDAR original

O painel operacional usa a nuvem corrigida pelo LIO nativo
`/utlidar/cloud_deskewed`, a odometria `/utlidar/robot_odom` e a IMU
`/utlidar/imu`. Somente quadros estáveis passam pela seleção de quadros-chave e
pela deduplicação de um centróide por voxel, confirmado em pelo menos duas
observações, antes de serem exibidos ou salvos.

Para executar tudo junto:

```bash
cd ~/Desktop/Teleop_Go2/project_portal
./run_dashboard.sh
```

Levante o Go2, espere estabilizar e pressione **NOVO MAPA** antes de começar o
trajeto lento. O resultado PCD e os metadados JSON
ficam em `~/Desktop/Teleop_Go2/go2_native_ws/maps/`.

Por segurança, o painel escuta somente em `127.0.0.1` e inicia com o movimento
bloqueado.
