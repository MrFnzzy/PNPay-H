import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { createSession, destroySession, getSessionUser, homeFor, type Role, type SessionUser } from "./service";

export const SESSION_COOKIE = "pnpay_session";

function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: getEnv().NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Starts a fresh session and sets the cookie. Any previous session is destroyed. */
export async function startSession(userId: string, role: Role) {
  const jar = await cookies();
  const { token, expiresAt } = await createSession(userId, role, jar.get(SESSION_COOKIE)?.value);
  jar.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function endSession() {
  const jar = await cookies();
  await destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(new Date(0)), maxAge: 0 });
}

/** Current user for this request (validated against the database), or null. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return getSessionUser(jar.get(SESSION_COOKIE)?.value);
});

/**
 * Server-side guard. Call at the top of every protected page, layout and server action.
 * Unauthenticated -> that portal's login page. Wrong role -> that user's own home (never the other portal).
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(role === "admin" ? "/admin/login" : "/login");
  if (user.role !== role) redirect(homeFor(user.role));
  return user;
}
