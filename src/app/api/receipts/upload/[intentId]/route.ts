import { z } from "zod";
import { NextResponse } from "next/server";
import { getApiStudent, jsonError, sameOrigin, unauthorized } from "@/lib/auth/api";
import { getEnv } from "@/lib/env";
import { detectImage } from "@/lib/payments/receipt-file";
import { getLiveIntent } from "@/lib/payments/submit";
import { getReceiptStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Server-mediated upload for the local/memory providers only (development and tests). Production uses Vercel Blob directly. */
export async function PUT(req: Request, ctx: { params: Promise<{ intentId: string }> }) {
  const env = getEnv();
  if (env.RECEIPT_STORAGE === "vercel-blob") return jsonError("Not found.", 404);
  if (!sameOrigin(req)) return jsonError("Forbidden.", 403);
  const user = await getApiStudent();
  if (!user) return unauthorized();
  const { intentId } = await ctx.params;
  if (!z.string().uuid().safeParse(intentId).success) return jsonError("Not found.", 404);
  const intent = await getLiveIntent(user.userId, intentId);
  if (!intent) return jsonError("Your upload session expired. Please select the receipt again.", 409);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > env.RECEIPT_MAX_BYTES) return jsonError("The receipt is too large.", 413);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return jsonError("The file is empty.", 422);
  if (bytes.length > env.RECEIPT_MAX_BYTES) return jsonError("The receipt is too large.", 413);
  const detected = detectImage(bytes);
  if (!detected) return jsonError("The receipt must be a PNG or JPEG image.", 415);
  try {
    await getReceiptStorage().put(intent.storageKey, bytes, detected.mime);
  } catch {
    return jsonError("The upload failed. Please try again.", 502);
  }
  return new NextResponse(null, { status: 204 });
}
