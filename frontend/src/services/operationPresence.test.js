import assert from "node:assert/strict";
import test from "node:test";

import { usersFromPresenceState } from "./operationPresence.js";

test("remove abas duplicadas pelo user_id", () => {
  const users = usersFromPresenceState({
    first: [
      { user_id: "user-1", username: "bianc", role: "operator" },
      { user_id: "user-1", username: "bianc", role: "operator" },
    ],
    second: [{ user_id: "user-2", username: "thain", role: "admin" }],
  });

  assert.deepEqual(users, [
    { user_id: "user-1", username: "bianc", role: "operator" },
    { user_id: "user-2", username: "thain", role: "admin" },
  ]);
});

test("ignora presenças inválidas e ordena por username", () => {
  const users = usersFromPresenceState({
    valid: [{ user_id: "2", username: "thain", role: "admin" }],
    another: [{ user_id: "1", username: "bianc", role: "operator" }],
    invalid: [{ user_id: "3", username: "guest", role: "viewer" }],
  });

  assert.deepEqual(users.map((user) => user.username), ["bianc", "thain"]);
});
