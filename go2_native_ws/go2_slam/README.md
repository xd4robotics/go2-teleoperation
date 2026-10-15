# Mapeamento 3D com os sensores originais do Go2

O nó acumula a nuvem já corrigida pelo LIO nativo do robô,
`/utlidar/cloud_deskewed`, no frame fixo `odom`. O mapa filtrado é publicado em
`/go2_slam/map_cloud`, mostrado ao vivo no RViz e salvo em PCD binário.

## Operação

1. Posicione o Go2 ao lado de uma parede ou canto conhecido.
2. Mantenha uma pessoa junto ao robô e deixe o caminho livre.
3. Execute `./run_mapping.sh`.
4. Confira a nuvem na tela antes de armar o movimento.
5. Pressione `I` para armar. Use `W/X` para frente/trás, `A/D` para movimento
   lateral, `Q/E` para giro no próprio eixo e `S` para alternar a postura.
6. Percorra devagar o perímetro e volte ao ponto inicial.
7. Pressione `P` para salvar. `Esc` ou `Ctrl+C` faz um autosave e encerra.

O teleop é limitado a 0,22 m/s e 0,35 rad/s, cerca de 30% do perfil normal. Um
watchdog envia parada se os comandos deixarem de chegar por 0,25 segundo.

Nesta configuração são usados o LiDAR, o LIO e a IMU originais do Go2. Por isso
o desvio de obstáculos nativo não é desativado; a regra de desativá-lo só faria
sentido na arquitetura antiga com um segundo LiDAR superior.

Arquivos gerados ficam em `../maps/`:

- `mapa_go2_*.pcd`: nuvem 3D;
- `mapa_go2_*.json`: origem, limites, duração e quantidade de pontos.
