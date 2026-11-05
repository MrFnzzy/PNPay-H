import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getApiStudent, jsonError, sameOrigin } from "@/lib/auth/api";
import { getEnv } from "@/lib/env";
import { getLiveIntent } from "@/lib/payments/submit";

export const dynamic = "force-dynamic";

/**
 * Vercel Blob client-upload token endpoint (direct-to-storage; needed because Vercel functions cap request
 * bodies at ~4.5 MB). Authentication happens inside onBeforeGenerateToken, not at the top of the route.
 * NOT exercised against a live Blob store in the build sandbox (see TEST_RESULTS.md).
 */
export async function POST(req: Request) {
  if (getEnv().RECEIPT_STORAGE !== "vercel-blob") return jsonError("Not found.", 404);
  if (!sameOrigin(req)) return jsonError("Forbidden.", 403);
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return jsonError("Bad request.", 400);
  try {
    const result = await handleUpload({
      body,
      request: req,
      token: getEnv().BLOB_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const user = await getApiStudent();
        if (!user) throw new Error("not signed in");
        const intent = clientPayload ? await getLiveIntent(user.userId, clientPayload) : null;
        // The path must be exactly the server-generated key of this student's live intent.
        if (!intent || intent.storageKey !== pathname) throw new Error("upload not authorized");
        return {
          allowedContentTypes: ["image/png", "image/jpeg"],
          maximumSizeInBytes: getEnv().RECEIPT_MAX_BYTES,
          validUntil: Date.now() + 10 * 60_000,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: intent.intentId,
        };
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError("Upload could not be authorized.", 400);
  }
}
