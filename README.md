# Go2 Teleoperation

Painel web para teleoperação do Unitree Go2 EDU com Jetson Orin NX.

## Recursos

- vídeo e áudio em tempo real;
- telemetria do robô;
- joysticks virtuais e controle USB;
- comandos de postura, velocidade e parada;
- obstacle avoidance;
- autenticação com Supabase;
- comunicação por LiveKit;
- integração com `unitree_sdk2` e CycloneDDS.

## Estrutura

```text
frontend/        Painel React e APIs da Vercel
backend/         API para operação local
robot_gateway/   Ponte entre LiveKit e o Go2
go2_native_ws/   SDK Unitree, ROS 2 e SLAM
supabase/        Banco, migrations e segurança
scripts/         Diagnóstico e configuração
```

## Configuração

Copie os arquivos de exemplo e preencha as credenciais locais:

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

Arquivos `.env`, tokens e chaves privadas não devem ser enviados ao GitHub.

## Executar

Na Jetson, para utilizar o painel publicado com LiveKit:

```bash
./run_vercel.sh
```

Para desenvolvimento local:

```bash
./run_web.sh
```

## Testes do frontend

```bash
cd frontend
npm ci
npm run lint
npm test
npm run build
```

## Rede do Go2

- `eth0`: comunicação interna com o controlador do Go2;
- `wlan0`: internet, SSH, Vercel e LiveKit;
- controlador do Go2: `192.168.123.161`.

Teste de conexão sem movimentar o robô:

```bash
ping -I eth0 -c 3 192.168.123.161
```

## Segurança

Teste movimentos somente em ambiente livre e supervisionado. O obstacle
avoidance auxilia a operação, mas não substitui os procedimentos de segurança.
