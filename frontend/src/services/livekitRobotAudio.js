export const ROBOT_AUDIO_DATA_TOPIC = "go2.audio";

const AUDIO_MESSAGE_TTL_MS = 8_000;

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

export function createLiveKitRobotAudioTransport(room, userId) {
  if (!room || room.state !== "connected") {
    throw new Error("Canal de áudio do robô indisponível.");
  }
  if (!userId) {
    throw new Error("Sessão do operador inválida.");
  }

  const streamId = randomId();
  let sequence = 0;

  return async function publishAudioState(state, payload = {}) {
    const issuedAt = Date.now();
    const message = {
      type: ROBOT_AUDIO_DATA_TOPIC,
      version: 1,
      request_id: randomId(),
      stream_id: streamId,
      robot_id: "primary",
      user_id: userId,
      state,
      sequence,
      data: payload.data || "",
      issued_at: issuedAt,
      expires_at: issuedAt + AUDIO_MESSAGE_TTL_MS,
    };
    sequence += 1;

    if (state === "start") {
      message.mode = payload.mode === "call" ? "call" : "recording";
    } else if (state === "chunk") {
      message.clip_id = payload.clip_id;
      message.current_block_index = payload.current_block_index;
      message.total_block_number = payload.total_block_number;
    } else if (state === "stop") {
      message.immediate = payload.immediate === true;
    }

    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(message)),
      { reliable: true, topic: ROBOT_AUDIO_DATA_TOPIC },
    );
  };
}
