import "server-only";
import { after } from "next/server";
import { processEmailQueue } from "./queue";

/**
 * Called from server actions AFTER a payment change has been committed. Sends due emails once the response has gone
 * out (Next.js `after`), so the student/admin never waits for the email provider and a provider outage cannot affect
 * the payment action. Failures stay in the queue and are retried by the worker (cron, or the next action).
 * Serverless-safe: nothing depends on a long-running process.
 */
export function scheduleEmailDelivery(): void {
  try {
    after(async () => {
      try {
        await processEmailQueue({ limit: 10 });
      } catch (err) {
        console.error("[pnpay] background email delivery error:", err instanceof Error ? err.name : "unknown");
      }
    });
  } catch {
    // Not inside a request scope: the queue is still drained by the scheduled job.
  }
}
