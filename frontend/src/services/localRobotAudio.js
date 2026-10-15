import { sendRobotAudio } from "./api.js";
import {
  bytesToBase64,
  downsampleMono,
  encodeMonoWav,
  splitAudioHubBlocks,
} from "./localRobotAudioCodec.js";
import { createLiveKitRobotAudioTransport } from "./livekitRobotAudio.js";

const STREAM_CLIP_SECONDS = 0.32;
const LIVEKIT_AUDIO_BLOCK_INTERVAL_MS = 55;
const CALL_VOICE_RMS_THRESHOLD = 0.008;
const CALL_VOICE_PEAK_THRESHOLD = 0.03;
const CALL_VOICE_HANGOVER_CLIPS = 3;
const CALL_LISTEN_RESUME_DELAY_MS = 650;

function randomId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function joinSamples(chunks, sampleCount) {
  const samples = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

export async function startLocalRobotAudio(
  accessToken,
  mediaStreamTrack,
  {
    room = null,
    userId = "",
    voiceActivated = false,
    onVoiceActivity = null,
  } = {},
) {
  if ((!accessToken && !room) || !mediaStreamTrack) {
    throw new Error("Microfone ou sessão inválida.");
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Este navegador não suporta captura de áudio local.");
  }

  const publishAudio = room
    ? createLiveKitRobotAudioTransport(room, userId)
    : async (action, payload = {}) => sendRobotAudio(accessToken, {
      action,
      ...payload,
    });

  const audioMode = voiceActivated ? "call" : "recording";
  await publishAudio("start", { mode: audioMode });
  const keepAliveId = room
    ? window.setInterval(() => {
      void publishAudio("start", { mode: audioMode }).catch(() => undefined);
    }, 5_000)
    : null;

  const context = new AudioContextClass({ latencyHint: "interactive" });
  await context.resume();
  const source = context.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silentOutput = context.createGain();
  silentOutput.gain.value = 0;
  source.connect(processor);
  processor.connect(silentOutput);
  silentOutput.connect(context.destination);

  const clipSamples = Math.round(context.sampleRate * STREAM_CLIP_SECONDS);
  let pendingChunks = [];
  let pendingSamples = 0;
  let uploadQueue = Promise.resolve();
  let stopped = false;
  let voiceActivityVersion = 0;
  let listenResumeTimer = null;
  let listenPendingTimer = null;
  let bufferedSilence = null;
  let voiceHangoverClips = 0;
  let abortUploads = false;

  function containsVoice(recording) {
    if (!voiceActivated) return true;
    let squareSum = 0;
    let peak = 0;
    for (const sample of recording) {
      const absolute = Math.abs(sample);
      squareSum += sample * sample;
      if (absolute > peak) peak = absolute;
    }
    const rms = Math.sqrt(squareSum / Math.max(1, recording.length));
    return rms >= CALL_VOICE_RMS_THRESHOLD || peak >= CALL_VOICE_PEAK_THRESHOLD;
  }

  function markVoiceActive() {
    voiceActivityVersion += 1;
    if (listenResumeTimer !== null) {
      window.clearTimeout(listenResumeTimer);
      listenResumeTimer = null;
    }
    if (listenPendingTimer !== null) {
      window.clearTimeout(listenPendingTimer);
      listenPendingTimer = null;
    }
    onVoiceActivity?.(true);
    return voiceActivityVersion;
  }

  function scheduleListenResume(version) {
    if (!voiceActivated) return;
    if (listenResumeTimer !== null) window.clearTimeout(listenResumeTimer);
    if (listenPendingTimer !== null) window.clearTimeout(listenPendingTimer);
    const reconnectAt = Date.now() + CALL_LISTEN_RESUME_DELAY_MS;
    // Evita piscar entre trechos consecutivos. O popup só aparece quando a
    // pausa realmente dura o suficiente para iniciar a volta à escuta.
    listenPendingTimer = window.setTimeout(() => {
      listenPendingTimer = null;
      if (version === voiceActivityVersion && !stopped) {
        onVoiceActivity?.(false, {
          pending: true,
          reconnectAt,
        });
      }
    }, 180);
    listenResumeTimer = window.setTimeout(() => {
      listenResumeTimer = null;
      if (version === voiceActivityVersion && !stopped) {
        onVoiceActivity?.(false, { pending: false, reconnectAt });
      }
    }, CALL_LISTEN_RESUME_DELAY_MS);
  }

  async function uploadClip(recording) {
    if (abortUploads) return;
    const activityVersion = markVoiceActive();
    const downsampled = downsampleMono(recording, context.sampleRate);
    const data = bytesToBase64(encodeMonoWav(downsampled));
    const blocks = splitAudioHubBlocks(data);
    const clipId = randomId();
    for (let index = 0; index < blocks.length; index += 1) {
      if (abortUploads) return;
      await publishAudio("chunk", {
        data: blocks[index],
        clip_id: clipId,
        current_block_index: index + 1,
        total_block_number: blocks.length,
      });
      if (room && index + 1 < blocks.length) {
        // O AudioHub consome um bloco DDS a cada ~40 ms. O pequeno intervalo
        // preserva a ordem sem acumular latência na fila confiável do LiveKit.
        await new Promise((resolve) => {
          window.setTimeout(resolve, LIVEKIT_AUDIO_BLOCK_INTERVAL_MS);
        });
      }
    }
    scheduleListenResume(activityVersion);
  }

  function queuePendingClip() {
    if (pendingSamples === 0) return;
    let recording = joinSamples(pendingChunks, pendingSamples);
    pendingChunks = [];
    pendingSamples = 0;

    if (voiceActivated) {
      if (containsVoice(recording)) {
        voiceHangoverClips = CALL_VOICE_HANGOVER_CLIPS;
        if (bufferedSilence) {
          recording = joinSamples(
            [bufferedSilence, recording],
            bufferedSilence.length + recording.length,
          );
          bufferedSilence = null;
        }
      } else if (voiceHangoverClips > 0) {
        voiceHangoverClips -= 1;
      } else {
        // Guarda um trecho anterior à fala para não perder a primeira sílaba.
        // Silêncio mais antigo é substituído e nunca enviado ao AudioHub.
        bufferedSilence = recording;
        return;
      }
    }

    uploadQueue = uploadQueue.then(() => uploadClip(recording));
  }

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const next = event.inputBuffer.getChannelData(0);
    pendingChunks.push(new Float32Array(next));
    pendingSamples += next.length;
    if (pendingSamples >= clipSamples) queuePendingClip();
  };

  return async () => {
    if (stopped) return;
    stopped = true;
    abortUploads = voiceActivated;
    voiceActivityVersion += 1;
    if (listenResumeTimer !== null) {
      window.clearTimeout(listenResumeTimer);
      listenResumeTimer = null;
    }
    if (listenPendingTimer !== null) {
      window.clearTimeout(listenPendingTimer);
      listenPendingTimer = null;
    }
    onVoiceActivity?.(false);
    if (keepAliveId !== null) window.clearInterval(keepAliveId);
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silentOutput.disconnect();
    const closeContext = context.close();

    if (voiceActivated) {
      // Em chamada, o clique em encerrar precisa devolver imediatamente o
      // áudio do aparelho e tirar o robô do modo megafone. Trechos ainda na
      // fila são descartados em vez de atrasarem o comando de saída.
      pendingChunks = [];
      pendingSamples = 0;
      bufferedSilence = null;
      void uploadQueue.catch(() => undefined);
      try {
        await publishAudio("stop", { immediate: true });
      } finally {
        await closeContext.catch(() => undefined);
      }
      return;
    }

    try {
      queuePendingClip();
      await uploadQueue;
    } finally {
      try {
        await publishAudio("stop", {
          immediate: false,
        });
      } finally {
        await closeContext.catch(() => undefined);
      }
    }
  };
}
