const API_URL =
  (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
const DEFAULT_ROBOT_ID = "primary";
const USE_VERCEL_FUNCTIONS = import.meta.env.VITE_LIVEKIT_ENABLED === "true";

const DEFAULT_TIMEOUT_MS = 10_000;

const STATUS_FALLBACK_MESSAGES = {
  401: "Sessão expirada. Entre novamente para continuar.",
  403: "Você não tem permissão para esta operação.",
  404: "Recurso não encontrado no backend.",
  409: "O robô recusou a operação no estado atual.",
  429: "Muitas requisições. Aguarde alguns segundos.",
  502: "O robô não respondeu ao comando.",
  503: "A conexão com o robô está indisponível.",
  504: "O robô demorou para responder.",
};

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function statusErrorMessage(status, payload) {
  return (
    payload?.detail ||
    payload?.error ||
    STATUS_FALLBACK_MESSAGES[status] ||
    "Não foi possível concluir a operação."
  );
}

async function fetchWithTimeout(url, options, timeoutMs, offlineMessage) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError(
        "O servidor demorou para responder. Verifique a conexão.",
        0,
      );
    }
    throw new ApiError(offlineMessage, 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function apiRequest(path, { accessToken, ...options } = {}) {
  const responseType = options.responseType || "json";
  delete options.responseType;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  delete options.timeoutMs;
  const headers = new Headers(options.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetchWithTimeout(
    `${API_URL}${path}`,
    { ...options, headers },
    timeoutMs,
    "API indisponível. Verifique se o backend está em execução.",
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(
      statusErrorMessage(response.status, payload),
      response.status,
    );
  }

  if (response.status === 204) return null;
  if (responseType === "blob") return response.blob();
  try {
    return await response.json();
  } catch {
    throw new ApiError("O backend retornou uma resposta inválida.", response.status);
  }
}

export function recordLoginEvent(accessToken) {
  return apiRequest("/api/auth/login-events", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ source: "web" }),
  });
}

export function getCurrentUser(accessToken) {
  return apiRequest("/api/auth/me", { accessToken });
}

export function createManagedUser(accessToken, user) {
  if (USE_VERCEL_FUNCTIONS) {
    return sameOriginRequest("/api/admin-users", {
      method: "POST",
      accessToken,
      body: JSON.stringify(user),
    });
  }
  return apiRequest("/api/auth/users", {
    method: "POST",
    accessToken,
    body: JSON.stringify(user),
  });
}

async function sameOriginRequest(path, { accessToken, ...options } = {}) {
  const headers = new Headers(options.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetchWithTimeout(
    path,
    { ...options, headers },
    DEFAULT_TIMEOUT_MS,
    "A função da Vercel está indisponível.",
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      statusErrorMessage(response.status, payload),
      response.status,
    );
  }
  return payload;
}

export function getRobotStatus(accessToken) {
  // Em produção, a presença do gateway vem da Function no mesmo domínio do
  // painel. VITE_API_URL aponta para o backend administrativo e não conhece
  // os participantes do LiveKit.
  if (USE_VERCEL_FUNCTIONS) {
    return sameOriginRequest("/api/robot/status", { accessToken });
  }
  return apiRequest("/api/robot/status", { accessToken, timeoutMs: 5_000 });
}

export function sendRobotCommand(accessToken, command, payload = {}) {
  if (USE_VERCEL_FUNCTIONS) {
    return sameOriginRequest("/api/robot/commands", {
      method: "POST",
      accessToken,
      body: JSON.stringify({ command, robot_id: DEFAULT_ROBOT_ID, payload }),
    });
  }
  return apiRequest("/api/robot/commands", {
    method: "POST",
    accessToken,
    body: JSON.stringify({
      command,
      robot_id: DEFAULT_ROBOT_ID,
      payload,
    }),
  });
}

export function getRobotMap(accessToken) {
  return apiRequest("/api/robot/map/points", { accessToken, timeoutMs: 5_000 });
}

export function getRobotCameraFrame(accessToken) {
  return apiRequest("/api/robot/camera/frame", {
    accessToken,
    responseType: "blob",
    cache: "no-store",
    timeoutMs: 5_000,
  });
}

export function sendRobotAudio(accessToken, payload) {
  return apiRequest("/api/robot/audio/megaphone", {
    method: "POST",
    accessToken,
    body: JSON.stringify(payload),
    timeoutMs: 5_000,
  });
}

export function requestOracleAnalysis(accessToken) {
  return apiRequest("/api/oracle/analyses", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ robot_id: DEFAULT_ROBOT_ID }),
  });
}
