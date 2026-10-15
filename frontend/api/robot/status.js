import { RoomServiceClient } from "livekit-server-sdk";

const DEFAULT_ROOM_NAME = "go2-primary";

function liveKitApiUrl(websocketUrl) {
  return websocketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ error: "Método não permitido." });
    return;
  }
  response.setHeader("Cache-Control", "no-store");

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!livekitUrl || !apiKey || !apiSecret) {
    response.status(503).json({ error: "LiveKit não configurado." });
    return;
  }

  try {
    const roomName = process.env.LIVEKIT_ROOM_NAME || DEFAULT_ROOM_NAME;
    const service = new RoomServiceClient(
      liveKitApiUrl(livekitUrl),
      apiKey,
      apiSecret,
    );
    const participants = await service.listParticipants(roomName);
    const identities = new Set(participants.map(({ identity }) => identity));
    const gatewayConnected = identities.has("go2-command-gateway");
    const ddsConnected = identities.has("go2-ambient-audio");
    const cameraConnected = identities.has("go2-camera");
    const robotOnline = gatewayConnected && ddsConnected;

    response.status(200).json({
      robot_id: "primary",
      robot_online: robotOnline,
      network_online: robotOnline,
      sdk_connected: robotOnline,
      gateway_connected: gatewayConnected,
      camera_connected: cameraConnected,
      captured_at_ms: Date.now(),
    });
  } catch (error) {
    console.error("Falha ao consultar presença do Go2.", error);
    response.status(502).json({ error: "Não foi possível consultar o Go2." });
  }
}
