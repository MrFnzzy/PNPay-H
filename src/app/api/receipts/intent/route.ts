import { z } from "zod";
import { NextResponse } from "next/server";
import { getApiStudent, jsonError, sameOrigin, unauthorized } from "@/lib/auth/api";
import { getEnv } from "@/lib/env";
import { UserFacingError } from "@/lib/errors";
import { createUploadIntent } from "@/lib/payments/submit";

export const dynamic = "force-dynamic";

/** Issues a short-lived upload authorization for one of the signed-in student's eligible installments. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Forbidden.", 403);
  const user = await getApiStudent();
  if (!user) return unauthorized();
  const body = z.object({ obligationId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError("Select a valid installment.", 422);
  try {
    const intent = await createUploadIntent(user.userId, body.data.obligationId);
    return NextResponse.json(
      {
        intentId: intent.intentId,
        storageKey: intent.storageKey,
        maxBytes: intent.maxBytes,
        expiresAt: intent.expiresAt.toISOString(),
        mode: getEnv().RECEIPT_STORAGE === "vercel-blob" ? "blob" : "direct",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof UserFacingError) return jsonError(e.message, e.status);
    console.error("[pnpay] intent failed:", e instanceof Error ? e.name : "unknown");
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
