import { z } from "zod";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { jsonError, unauthorized } from "@/lib/auth/api";
import { getReceiptForAdmin } from "@/lib/admin/review";
import { getOwnedReceipt } from "@/lib/payments/queries";
import { getReceiptStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Secure receipt retrieval - the ONLY way a receipt is ever served (no public or signed URLs exist).
 *  - student: only their own submission (student_id = session user is part of the query); another student's id is the same 404 as an unknown id.
 *  - admin (Phase 3, D-029): any submission, because reviewing is the administrator's job.
 * The role comes from the server-side session, never from the request. Nothing is cacheable.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ submissionId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { submissionId } = await ctx.params;
  if (!z.string().uuid().safeParse(submissionId).success) return jsonError("Not found.", 404);
  const receipt = user.role === "admin" ? await getReceiptForAdmin(submissionId) : await getOwnedReceipt(user.userId, submissionId);
  if (!receipt) return jsonError("Not found.", 404);
  let bytes: Buffer | null;
  try {
    bytes = await getReceiptStorage().read(receipt.key);
  } catch {
    return jsonError("The receipt is temporarily unavailable.", 502);
  }
  if (!bytes) return jsonError("Not found.", 404);
  const ext = receipt.mime === "image/png" ? "png" : "jpg";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": receipt.mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="receipt-${submissionId.slice(0, 8)}.${ext}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
