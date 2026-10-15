import test from "node:test";
import assert from "node:assert/strict";

import {
  createLiveKitRobotAudioTransport,
  ROBOT_AUDIO_DATA_TOPIC,
} from "./livekitRobotAudio.js";

test("publishes an authenticated WAV session through reliable LiveKit data", async () => {
  const packets = [];
  const room = {
    state: "connected",
    localParticipant: {
      async publishData(bytes, options) {
        packets.push({
          message: JSON.parse(new TextDecoder().decode(bytes)),
          options,
        });
      },
    },
  };
  const userId = "2639ea99-4d29-4b0b-9a74-2639c8b786fd";
  const publish = createLiveKitRobotAudioTransport(room, userId);

  await publish("start", { mode: "call" });
  await publish("chunk", {
    data: "UklGRgAAAABXQVZF",
    clip_id: "bca5a73b-b5e3-4f20-bf70-846a777159d4",
    current_block_index: 1,
    total_block_number: 1,
  });
  await publish("stop", { immediate: true });

  assert.deepEqual(packets.map(({ message }) => message.state), [
    "start",
    "chunk",
    "stop",
  ]);
  assert.deepEqual(packets.map(({ message }) => message.sequence), [0, 1, 2]);
  assert.ok(packets.every(({ message }) => message.stream_id === packets[0].message.stream_id));
  assert.ok(packets.every(({ message }) => message.user_id === userId));
  assert.ok(packets.every(({ options }) => (
    options.reliable === true && options.topic === ROBOT_AUDIO_DATA_TOPIC
  )));
  assert.equal(packets[0].message.mode, "call");
  assert.equal(packets.at(-1).message.immediate, true);
});
