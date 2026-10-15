import { timingSafeEqual } from "node:crypto";

import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";

const DEFAULT_ROOM_NAME = "go2-primary";
const MAX_POINT_COUNT = 1500;
const POINT_CLOUD_TOPIC = "go2.pointcloud";
const TELEMETRY_TOPIC = "go2.telemetry";

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function secretsMatch(expected, provided) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function normalizeBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString("utf8"));
  return body || {};
}

function finitePoints(input) {
  if (!Array.isArray(input)) return [];
  const count = Math.min(Math.floor(input.length / 3), MAX_POINT_COUNT);
  const points = new Float32Array(count * 3);
  let outputIndex = 0;
  for (let index = 0; index < count * 3; index += 3) {
    const x = Number(input[index]);
    const y = Number(input[index + 1]);
    const z = Number(input[index + 2]);
    if (![x, y, z].every(Number.isFinite)) continue;
    points[outputIndex] = x;
    points[outputIndex + 1] = y;
    points[outputIndex + 2] = z;
    outputIndex += 3;
  }
  return points.subarray(0, outputIndex);
}

export function encodePointCloud(points) {
  const pointCount = Math.floor(points.length / 3);
  const headerSize = 32;
  const buffer = new ArrayBuffer(headerSize + pointCount * 6);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  bytes.set([0x47, 0x4f, 0x32, 0x50], 0); // GO2P
  view.setUint8(4, 1);
  view.setUint8(5, 0);
  view.setUint16(6, pointCount, true);

  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < points.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], points[index + axis]);
      maximum[axis] = Math.max(maximum[axis], points[index + axis]);
    }
  }

  const scale = minimum.map((value, axis) => {
    const extent = maximum[axis] - value;
    return extent > 0 ? extent / 65535 : 1;
  });
  for (let axis = 0; axis < 3; axis += 1) {
    view.setFloat32(8 + axis * 4, minimum[axis], true);
    view.setFloat32(20 + axis * 4, scale[axis], true);
  }

  let offset = headerSize;
  for (let index = 0; index < points.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const quantized = Math.max(
        0,
        Math.min(65535, Math.round((points[index + axis] - minimum[axis]) / scale[axis])),
      );
      view.setUint16(offset, quantized, true);
      offset += 2;
    }
  }
  return bytes;
}

function liveKitApiUrl(websocketUrl) {
  return websocketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendError(response, 405, "Método não permitido.");
    return;
  }

  response.setHeader("Cache-Control", "no-store");
  const publisherKey = process.env.ROBOT_PUBLISHER_KEY;
  const providedKey = request.headers["x-robot-key"] || "";
  if (!publisherKey) {
    sendError(response, 503, "Publicação do robô ainda não configurada.");
    return;
  }
  if (!secretsMatch(publisherKey, providedKey)) {
    sendError(response, 401, "Chave de publicação do robô inválida.");
    return;
  }

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    sendError(response, 503, "LiveKit ainda não foi configurado na Vercel.");
    return;
  }

  try {
    const body = normalizeBody(request.body);
    const points = finitePoints(body.points);
    if (points.length < 3) {
      sendError(response, 400, "A nuvem de pontos está vazia ou inválida.");
      return;
    }

    const roomName = process.env.LIVEKIT_ROOM_NAME || DEFAULT_ROOM_NAME;
    const roomService = new RoomServiceClient(
      liveKitApiUrl(livekitUrl),
      apiKey,
      apiSecret,
    );
    await roomService.sendData(
      roomName,
      encodePointCloud(points),
      DataPacket_Kind.RELIABLE,
      { topic: POINT_CLOUD_TOPIC },
    );

    const telemetry = new TextEncoder().encode(JSON.stringify(body.status || {}));
    await roomService.sendData(
      roomName,
      telemetry,
      DataPacket_Kind.RELIABLE,
      { topic: TELEMETRY_TOPIC },
    );

    response.status(202).json({
      ok: true,
      room_name: roomName,
      point_count: points.length / 3,
    });
  } catch (error) {
    console.error("Falha ao publicar dados do robô no LiveKit.", error);
    sendError(response, 500, "Não foi possível publicar os dados do robô.");
  }
}
