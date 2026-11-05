import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "./session";
import type { SessionUser } from "./service";

/** Route-handler auth: the student comes ONLY from the session cookie. Returns null if not a signed-in student. */
export async function getApiStudent(): Promise<SessionUser | null> {
  const u = await getCurrentUser();
  return u && u.role === "student" ? u : null;
}

export const unauthorized = () => NextResponse.json({ error: "Please sign in." }, { status: 401, headers: { "Cache-Control": "no-store" } });
export const jsonError = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** Defence in depth on top of SameSite=Lax: a browser-sent Origin must match this host. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; they still need the session cookie
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

/** Route-handler auth for the administrator. Role comes ONLY from the validated server-side session. */
export async function getApiAdmin(): Promise<SessionUser | null> {
  const u = await getCurrentUser();
  return u && u.role === "admin" ? u : null;
}
