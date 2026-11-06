import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runPaymentReminders } from "@/lib/payments/reminders";
import { processEmailQueue } from "@/lib/email/queue";
import { cleanupUploads } from "@/lib/payments/submit";
import { ensureBatchRolloverProposals } from "@/lib/admin/batches";
import { runJob } from "@/lib/jobs";

const noStore = { "Cache-Control": "no-store" };
const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Scheduled-job authorization. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when the CRON_SECRET
 * environment variable exists. Returns null when the caller is authorized, otherwise the response to send.
 * Without CRON_SECRET configured the jobs refuse to run (fail closed). The secret is compared in constant time.
 */
export function authorizeCron(req: Request): NextResponse | null {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Scheduled jobs are not configured." }, { status: 503, headers: noStore });
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(digest(given), digest(secret))) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  return null;
}

export const jobs = {
  reminders: () => runJob("reminders", () => runPaymentReminders()),
  email: () => runJob("email", () => processEmailQueue({ limit: 50 })),
  cleanup: () => runJob("cleanup", () => cleanupUploads()),
  rollovers: () => runJob("batch_rollovers", () => ensureBatchRolloverProposals()),
};

export const jobResponse = (body: unknown, ok = true) => NextResponse.json(body, { status: ok ? 200 : 500, headers: noStore });
