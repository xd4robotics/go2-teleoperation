#!/usr/bin/env node

import dgram from "node:dgram";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";

const livekitUrl = process.env.LIVEKIT_URL;
const token = process.env.GO2_AMBIENT_AUDIO_LIVEKIT_TOKEN;
const downlinkHost = process.env.GO2_AMBIENT_AUDIO_UDP_HOST || "127.0.0.1";
const downlinkPort = Number(process.env.GO2_AMBIENT_AUDIO_UDP_PORT || 5091);
const uplinkHost = process.env.GO2_OPERATOR_AUDIO_UDP_HOST || "127.0.0.1";
const uplinkPort = Number(process.env.GO2_OPERATOR_AUDIO_UDP_PORT || 5092);
const SAMPLE_RATE = 48_000;
const CHANNELS = 1;

if (!livekitUrl || !token) {
  throw new Error("LIVEKIT_URL e GO2_AMBIENT_AUDIO_LIVEKIT_TOKEN são obrigatórios");
}

const source = new AudioSource(SAMPLE_RATE, CHANNELS);
const track = LocalAudioTrack.createAudioTrack("go2-ambient-audio", source);
const room = new Room();
const socket = dgram.createSocket("udp4");
const operatorReaders = new Map();
let shuttingDown = false;
let roomReady = false;
let roomConnectPromise = null;
let latestRobotAudioAt = 0;
let audioWatchdog = null;
let drainingRobotAudio = false;
const robotAudioQueue = [];
const MAX_ROBOT_AUDIO_FRAMES = 10;

function bufferToInt16(message) {
  const samples = new Int16Array(message.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = message.readInt16LE(index * 2);
  }
  return samples;
}

function toAudioFrame(message) {
  const samples = bufferToInt16(message);
  return new AudioFrame(samples, SAMPLE_RATE, CHANNELS, samples.length);
}

async function forwardOperatorTrack(remoteTrack, publication, participant) {
  if (participant.identity.startsWith("go2-")) return;
  if (publication.kind !== TrackKind.KIND_AUDIO) return;
  if (publication.source !== TrackSource.SOURCE_MICROPHONE) return;

  const previous = operatorReaders.get(publication.sid);
  if (previous) await previous.cancel().catch(() => undefined);

  const stream = new AudioStream(remoteTrack, {
    sampleRate: SAMPLE_RATE,
    numChannels: CHANNELS,
  });
  const reader = stream.getReader();
  operatorReaders.set(publication.sid, reader);

  try {
    while (!shuttingDown) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = Buffer.from(
        value.data.buffer,
        value.data.byteOffset,
        value.data.byteLength,
      );
      socket.send(bytes, uplinkPort, uplinkHost);
    }
  } catch (error) {
    if (!shuttingDown) {
      console.error(`Falha no uplink de voz WebRTC: ${error.message}`);
    }
  } finally {
    if (operatorReaders.get(publication.sid) === reader) {
      operatorReaders.delete(publication.sid);
    }
    reader.releaseLock();
  }
}

async function connectRoomWhenRobotAudioIsReady() {
  if (roomReady) return;
  if (roomConnectPromise) return roomConnectPromise;

  roomConnectPromise = (async () => {
    await room.connect(livekitUrl, token, { autoSubscribe: true });
    await room.localParticipant.publishTrack(
      track,
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        // Preserva o ambiente mesmo em baixo volume e acrescenta redundância
        // contra perda de pacotes no sentido robô -> operador.
        dtx: false,
        red: true,
      }),
    );
    roomReady = true;
    console.log(
      "Microfone nativo DDS do GO2 confirmado e publicado na sala LiveKit.",
    );
  })().catch((error) => {
    console.error(`Falha ao publicar o intercomunicador: ${error.message}`);
    void shutdown(1);
    throw error;
  });

  return roomConnectPromise;
}

async function drainRobotAudio() {
  if (drainingRobotAudio || !roomReady || shuttingDown) return;
  drainingRobotAudio = true;
  try {
    while (robotAudioQueue.length && !shuttingDown) {
      const message = robotAudioQueue.shift();
      await source.captureFrame(toAudioFrame(message));
    }
  } catch (error) {
    if (!shuttingDown) {
      console.error(`Falha ao publicar áudio ambiente: ${error.message}`);
    }
  } finally {
    drainingRobotAudio = false;
    if (robotAudioQueue.length && !shuttingDown) {
      setImmediate(() => void drainRobotAudio());
    }
  }
}

socket.on("message", (message) => {
  latestRobotAudioAt = Date.now();
  robotAudioQueue.push(message);
  if (robotAudioQueue.length > MAX_ROBOT_AUDIO_FRAMES) {
    robotAudioQueue.shift();
  }
  void connectRoomWhenRobotAudioIsReady()
    .then(() => drainRobotAudio())
    .catch((error) => {
      if (!shuttingDown) {
        console.error(`Falha ao conectar áudio ambiente: ${error.message}`);
      }
    });
});
socket.on("error", (error) => {
  console.error(`Erro no transporte PCM local: ${error.message}`);
});

room.on(RoomEvent.TrackSubscribed, (remoteTrack, publication, participant) => {
  void forwardOperatorTrack(remoteTrack, publication, participant);
});
room.on(RoomEvent.TrackUnsubscribed, (_remoteTrack, publication) => {
  const reader = operatorReaders.get(publication.sid);
  if (reader) void reader.cancel().catch(() => undefined);
});
room.on(RoomEvent.Disconnected, (reason) => {
  console.error(`Ponte de áudio WebRTC desconectada: ${reason}`);
  void shutdown(1);
});

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (audioWatchdog) clearInterval(audioWatchdog);
  await Promise.all(
    [...operatorReaders.values()].map((reader) =>
      reader.cancel().catch(() => undefined),
    ),
  );
  operatorReaders.clear();
  await room.disconnect().catch(() => undefined);
  await new Promise((resolve) => socket.close(resolve)).catch(() => undefined);
  await dispose().catch(() => undefined);
  process.exit(exitCode);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

socket.bind(downlinkPort, downlinkHost);
audioWatchdog = setInterval(() => {
  if (
    roomReady &&
    latestRobotAudioAt &&
    Date.now() - latestRobotAudioAt > 3_000
  ) {
    console.error(
      "Áudio nativo do GO2 parou; removendo bridge indisponível do LiveKit.",
    );
    void shutdown(1);
  }
}, 1_000);
console.log("Aguardando o áudio nativo do GO2 antes de entrar no LiveKit.");
