# Frontend XD4 Robotics + Go2

Aplicação React/Vite importada do `ProjetoOracleFrontBanco` e conectada ao
FastAPI deste repositório. Ela contém login Supabase, gestão de usuários restrita
a administradores, rota protegida, câmera do Go2, nuvem 3D, localização, mapa e
teleoperação.

## Configuração

```bash
cp .env.example .env.local
```

Preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. O script raiz
`run_web.sh` define `VITE_API_URL` automaticamente com o IP da Jetson durante o
build Docker.

Nenhuma secret/service-role pode ser adicionada neste diretório.

O login não oferece cadastro público. Usuários com `profiles.role = 'admin'`
veem a opção **Usuários** no cabeçalho e podem criar acessos comuns ou
administrativos por meio do backend.

## LiveKit na Vercel

A base do receptor WebRTC e da Vercel Function que emite tokens está descrita
em [`LIVEKIT.md`](LIVEKIT.md). O recurso permanece desativado por padrão para
preservar a câmera atual até a Jetson começar a publicar na sala LiveKit.

## Desenvolvimento isolado

```bash
npm ci
npm run dev -- --host 0.0.0.0
```

Para iniciar o sistema completo, use `./run_web.sh` na raiz do repositório.

## Controle USB (PS4, PS5 e Xbox)

O painel usa a Gamepad API nativa do navegador. Como essa API só é liberada
em contexto seguro, no notebook abra um túnel SSH para a Jetson:

```bash
ssh -N -L 5173:127.0.0.1:5173 unitree@IP_DA_JETSON
```

Na Vercel, basta abrir o painel HTTPS, conectar o controle por cabo e pressionar
qualquer botão ou manche. O painel seleciona **Controle USB** automaticamente e,
ao retirar o cabo, reativa **Botões**. A pessoa ainda pode escolher Botões com o
controle conectado. Toda troca para o movimento e o USB só é liberado depois
que os manches voltam ao centro. Chrome, Edge e Firefox atuais normalizam controles
PS4/PS5/Xbox/Switch conhecidos; o painel adapta automaticamente também o layout
DirectInput comum de Logitech, 8BitDo e controles USB genéricos. Não há
instalação ou calibração manual. O túnel acima só é necessário no desenvolvimento
local.

O painel possui duas camadas de compatibilidade. A Gamepad API detecta
automaticamente controles padrão e DirectInput. Se um clone ou controle incomum
não aparecer, clique em **Controle USB** e selecione o dispositivo na janela do
Chrome ou Edge. Esse fallback usa WebHID, lê o descritor do próprio aparelho e
mapeia eixos, segundo manche, direcional e botões. A permissão é solicitada uma
vez; nas conexões seguintes o dispositivo autorizado é reaberto automaticamente.
Firefox não oferece WebHID e permanece limitado à Gamepad API.

- Manche esquerdo: frente/ré e deslocamento lateral.
- Manche direito horizontal: giro.
- Direcional: frente/ré e giro.
- `START`/`Options`: habilita o canal de controle.
- `L2 + B`/Círculo: damping de emergência.
- `L2 + X`/Quadrado: recuperar e levantar (RecoveryStand oficial).
- `L2 + A`/Cruz: alternar entre levantar e deitar.
- `X`/Quadrado: ligar anticolisão.
- `Y`/Triângulo por 3 segundos: desligar anticolisão.

Ao soltar os manches, desconectar o cabo, trocar de aba ou perder o foco, o
painel envia parada ao robô. A velocidade continua limitada pelo percentual
selecionado no painel. A curva progressiva produz `0,20 m/s` em 20%, `1,25 m/s`
em 50% e mantém em 100% o máximo publicado do Go2 EDU, de aproximadamente 5 m/s
em condições de laboratório. O transporte remoto é normalizado em `−1…1` para
que nenhum nível intermediário sature. O firmware pode aplicar limites
adicionais conforme o modo de movimento e o ambiente.
