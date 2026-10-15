import { randomUUID } from "node:crypto";

import { AccessToken, TrackSource } from "livekit-server-sdk";

import { verifySupabaseUser } from "../lib/serverAuth.js";

const DEFAULT_ROOM_NAME = "go2-primary";
const PROJECT_LIVEKIT_URL = "wss://go2-primary-c15bstc0.livekit.cloud";
const TOKEN_TTL = "10m";

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice("Bearer ".length).trim();
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendError(response, 405, "Método não permitido.");
    return;
  }

  response.setHeader("Cache-Control", "no-store");

  // Este painel pertence a uma unica sala LiveKit. Nao devolva ao navegador
  // uma URL antiga/acidentalmente configurada na Vercel, pois o JWT seria
  // valido para as chaves atuais mas tentaria entrar em outro projeto.
  const livekitUrl = PROJECT_LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    sendError(response, 503, "LiveKit ainda não foi configurado na Vercel.");
    return;
  }

  const accessToken = getBearerToken(request);
  if (!accessToken) {
    sendError(response, 401, "Sessão necessária.");
    return;
  }

  try {
    const user = await verifySupabaseUser(accessToken);
    if (!user?.id) {
      sendError(response, 401, "Sessão inválida.");
      return;
    }

    const roomName = process.env.LIVEKIT_ROOM_NAME || DEFAULT_ROOM_NAME;
    const participantIdentity = `${user.id}-${randomUUID().slice(0, 8)}`;
    const token = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: user.email || "Operador XD4",
      metadata: JSON.stringify({ user_id: user.id }),
      ttl: TOKEN_TTL,
    });
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canPublishData: true,
    });

    response.status(201).json({
      server_url: livekitUrl,
      participant_token: await token.toJwt(),
    });
  } catch (error) {
    console.error("Falha ao emitir token do LiveKit.", error);
    sendError(response, 500, "Não foi possível conectar ao LiveKit.");
  }
}
