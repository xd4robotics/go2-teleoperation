const TARGET_SAMPLE_RATE = 44_100;
// LiveKit aceita cerca de 15 KiB por pacote de dados. 12 KiB deixa margem
// para o envelope JSON e reduz uma gravação de 30 s de ~862 para ~295 blocos.
export const AUDIOHUB_BLOCK_SIZE = 12_000;

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function downsampleMono(samples, inputSampleRate, outputSampleRate = TARGET_SAMPLE_RATE) {
  if (inputSampleRate === outputSampleRate) return new Float32Array(samples);
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.floor(samples.length / ratio));
  const output = new Float32Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.max(start + 1, Math.floor((outputIndex + 1) * ratio));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end && inputIndex < samples.length; inputIndex += 1) {
      sum += samples[inputIndex];
    }
    output[outputIndex] = sum / Math.max(1, Math.min(end, samples.length) - start);
  }
  return output;
}

export function encodeMonoWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

export function bytesToBase64(bytes) {
  let binary = "";
  const blockSize = 0x2000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return window.btoa(binary);
}

export function splitAudioHubBlocks(base64Data) {
  const blocks = [];
  for (let offset = 0; offset < base64Data.length; offset += AUDIOHUB_BLOCK_SIZE) {
    blocks.push(base64Data.slice(offset, offset + AUDIOHUB_BLOCK_SIZE));
  }
  return blocks;
}
