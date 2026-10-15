import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  AUDIOHUB_BLOCK_SIZE,
  downsampleMono,
  encodeMonoWav,
  splitAudioHubBlocks,
} from "./localRobotAudioCodec.js";

test("encodes a valid mono PCM WAV block accepted by the Go2 AudioHub", () => {
  const wav = encodeMonoWav(new Float32Array(14_112), 44_100);
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), "RIFF");
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString(), "WAVE");
  const blocks = splitAudioHubBlocks(Buffer.from(wav).toString("base64"));
  assert.ok(blocks.length > 1);
  assert.ok(blocks.every((block) => block.length <= AUDIOHUB_BLOCK_SIZE));
});

test("downsamples 48 kHz mono to 16 kHz", () => {
  const output = downsampleMono(new Float32Array(960), 48_000, 16_000);
  assert.equal(output.length, 320);
});
