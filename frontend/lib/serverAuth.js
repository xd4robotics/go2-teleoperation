/* global process */
import { createLocalJWKSet, jwtVerify } from "jose";

import publicJwks from "./supabase-jwks.json" with { type: "json" };

const localJwks = createLocalJWKSet(publicJwks);

export async function verifySupabaseUser(accessToken) {
  const baseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "")
    .replace(/\/$/, "");
  if (!baseUrl || !accessToken) return null;

  try {
    const { payload } = await jwtVerify(accessToken, localJwks, {
      issuer: `${baseUrl}/auth/v1`,
      audience: "authenticated",
    });
    if (!payload.sub) return null;
    return { id: payload.sub, email: payload.email || "" };
  } catch (error) {
    console.error("JWT Supabase recusado.", error?.code || error?.message);
    return null;
  }
}
