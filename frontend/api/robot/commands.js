import { randomUUID, timingSafeEqual } from "node:crypto";

import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";

import { verifySupabaseUser } from "../../lib/serverAuth.js";

const ROOM_NAME = "go2-primary";
const COMMAND_TOPIC = "go2.command";
const ALLOWED_COMMANDS = new Set([
  "diagnostic_ping",
  "move_analog", "forward", "backward", "rotate_left", "rotate_right",
  "stand_up", "stand_down", "recovery_stand", "arm", "disarm",
  "set_speed", "set_obstacle_avoidance", "damping", "reset_map",
  "save_map", "calibrate_docking_station", "start_docking",
  "cancel_docking", "stop", "emergency_stop",
]);

function apiUrl(url) {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function bearerToken(request) {
  const authorization = request.headers.authorization || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

function robotKeyMatches(provided) {
  const expected = process.env.ROBOT_PUBLISHER_KEY || "";
  if (!expected || !provided) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Método não permitido." });
    return;
  }

  const body = typeof request.body === "string"
    ? JSON.parse(request.body)
    : (request.body || {});
  const command = String(body.command || "");
  if (!ALLOWED_COMMANDS.has(command)) {
    response.status(400).json({ error: "Comando não permitido." });
    return;
  }

  const user = await verifySupabaseUser(bearerToken(request));
  const robotDiagnostic = command === "diagnostic_ping"
    && robotKeyMatches(request.headers["x-robot-key"] || "");
  if (!user?.id && !robotDiagnostic) {
    response.status(401).json({ error: "Sessão inválida." });
    return;
  }

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    response.status(503).json({ error: "LiveKit não configurado." });
    return;
  }

  const now = Date.now();
  const message = new TextEncoder().encode(JSON.stringify({
    type: "go2.command",
    version: 1,
    request_id: randomUUID(),
    robot_id: "primary",
    user_id: user?.id || "00000000-0000-4000-8000-000000000001",
    command,
    payload: body.payload || {},
    issued_at: now,
    expires_at: now + 5_000,
    server_relay: true,
  }));

  try {
    const service = new RoomServiceClient(apiUrl(livekitUrl), apiKey, apiSecret);
    await service.sendData(
      process.env.LIVEKIT_ROOM_NAME || ROOM_NAME,
      message,
      DataPacket_Kind.RELIABLE,
      { topic: COMMAND_TOPIC },
    );
    response.status(202).json({ status: "accepted", command, transport: "livekit-server" });
  } catch (error) {
    console.error("Falha no relay de comando do Go2.", error);
    response.status(502).json({ error: "Canal de controle indisponível." });
  }
}
