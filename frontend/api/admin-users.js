const ALLOWED_ROLES = new Set(["operator", "admin"]);

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice("Bearer ".length).trim();
}

function serviceHeaders(serviceKey, extra = {}) {
  const headers = {
    apikey: serviceKey,
    "Content-Type": "application/json",
    ...extra,
  };
  if (!serviceKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${serviceKey}`;
  }
  return headers;
}

async function getAuthenticatedUser(supabaseUrl, publishableKey, accessToken) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

async function getProfile(supabaseUrl, serviceKey, userId) {
  const query = new URLSearchParams({
    select: "id,role",
    id: `eq.${userId}`,
    limit: "1",
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, {
    headers: serviceHeaders(serviceKey),
  });
  if (!response.ok) throw new Error("profile_lookup_failed");
  const profiles = await response.json();
  return profiles[0] || null;
}

async function createAuthUser(supabaseUrl, serviceKey, payload) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: payload.display_name
        ? { display_name: payload.display_name }
        : {},
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.error_code || result?.code;
    const message = String(result?.msg || result?.message || "").toLowerCase();
    if (
      ["email_exists", "user_already_exists"].includes(code) ||
      message.includes("already")
    ) {
      const error = new Error("user_exists");
      error.status = 409;
      throw error;
    }
    throw new Error("create_user_failed");
  }

  return result?.user || result;
}

async function updateProfile(supabaseUrl, serviceKey, userId, payload) {
  const query = new URLSearchParams({ id: `eq.${userId}` });
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, {
    method: "PATCH",
    headers: serviceHeaders(serviceKey, { Prefer: "return=representation" }),
    body: JSON.stringify({
      email: payload.email,
      display_name: payload.display_name || payload.email.split("@", 1)[0],
      role: payload.role,
    }),
  });
  if (!response.ok) throw new Error("profile_update_failed");
  const profiles = await response.json();
  if (!profiles[0]) throw new Error("profile_missing");
  return profiles[0];
}

async function deleteAuthUser(supabaseUrl, serviceKey, userId) {
  await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceKey),
  });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendError(response, 405, "Método não permitido.");
    return;
  }
  response.setHeader("Cache-Control", "no-store");

  const supabaseUrl = String(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
  ).replace(/\/$/, "");
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !publishableKey || !serviceKey) {
    sendError(response, 503, "Gestão de usuários não configurada na Vercel.");
    return;
  }

  const accessToken = getBearerToken(request);
  if (!accessToken) {
    sendError(response, 401, "Sessão necessária.");
    return;
  }

  const body = request.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.display_name || "").trim() || null;
  const role = String(body.role || "operator");
  if (!email.includes("@") || password.length < 8 || !ALLOWED_ROLES.has(role)) {
    sendError(response, 422, "Dados do novo usuário são inválidos.");
    return;
  }

  let createdUser = null;
  try {
    const currentUser = await getAuthenticatedUser(
      supabaseUrl,
      publishableKey,
      accessToken,
    );
    if (!currentUser?.id) {
      sendError(response, 401, "Sessão inválida.");
      return;
    }

    const currentProfile = await getProfile(
      supabaseUrl,
      serviceKey,
      currentUser.id,
    );
    if (currentProfile?.role !== "admin") {
      sendError(response, 403, "Apenas administradores podem gerenciar usuários.");
      return;
    }

    createdUser = await createAuthUser(supabaseUrl, serviceKey, {
      email,
      password,
      display_name: displayName,
    });
    if (!createdUser?.id) throw new Error("missing_user_id");

    const profile = await updateProfile(supabaseUrl, serviceKey, createdUser.id, {
      email,
      display_name: displayName,
      role,
    });
    response.status(201).json({
      id: createdUser.id,
      email,
      display_name: profile.display_name,
      role: profile.role,
    });
  } catch (error) {
    if (createdUser?.id) {
      await deleteAuthUser(supabaseUrl, serviceKey, createdUser.id).catch(() => {});
    }
    if (error?.status === 409 || error?.message === "user_exists") {
      sendError(response, 409, "Já existe um usuário com este e-mail.");
      return;
    }
    console.error("Falha ao criar usuário administrado.", error);
    sendError(response, 502, "O Supabase recusou a criação do usuário.");
  }
}
