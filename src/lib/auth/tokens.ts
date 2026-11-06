import { createHmac, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

/** 256-bit random URL-safe token (sent to the user, never stored). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** HMAC-SHA256 of the token keyed by AUTH_SECRET. Only this value is stored in the database. */
export function hashToken(token: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET).update(token).digest("hex");
}
