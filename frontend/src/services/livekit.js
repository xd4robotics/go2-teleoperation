const TOKEN_ENDPOINT =
  import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT || "/api/livekit-token";

export const isLiveKitEnabled =
  import.meta.env.VITE_LIVEKIT_ENABLED === "true";

const TOKEN_TIMEOUT_MS = 30_000;

export async function getLiveKitConnection(accessToken) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ room_name: "go2-primary" }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("A conexão com a operação demorou para responder.", {
        cause: error,
      });
    }
    throw new Error("Servidor da operação indisponível. Verifique a internet.", {
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || "Não foi possível iniciar a conexão com o robô.");
  }
  if (!payload?.server_url || !payload?.participant_token) {
    throw new Error("O servidor retornou uma resposta inválida.");
  }

  return {
    serverUrl: payload.server_url,
    participantToken: payload.participant_token,
  };
}
