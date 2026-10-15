export const OPERATION_PRESENCE_CHANNEL = "operation-dashboard-presence";

const VALID_ROLES = new Set(["operator", "admin"]);

export function usersFromPresenceState(presenceState) {
  const usersById = new Map();

  for (const presences of Object.values(presenceState || {})) {
    if (!Array.isArray(presences)) continue;

    for (const presence of presences) {
      const userId = typeof presence?.user_id === "string" ? presence.user_id : "";
      const username = typeof presence?.username === "string" ? presence.username : "";
      const role = typeof presence?.role === "string" ? presence.role : "";
      if (!userId || !username || !VALID_ROLES.has(role)) continue;

      usersById.set(userId, { user_id: userId, username, role });
    }
  }

  return [...usersById.values()].sort((first, second) =>
    first.username.localeCompare(second.username, "pt-BR"),
  );
}
