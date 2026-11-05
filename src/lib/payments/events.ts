import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { formatPeso } from "./money";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Columns that put a notification into the email queue (first attempt as soon as a worker runs). */
export const emailQueued = () => ({ emailPending: true, emailStatus: "queued" as const, emailNextAttemptAt: new Date() });

/**
 * Payment domain events. Handlers create in-app notifications inside the caller's transaction, so a
 * notification exists if and only if the change that caused it was saved. Rows with emailPending=true
 * (email_status='queued') are the queue consumed by the email worker (src/lib/email/queue.ts, Phase 4);
 * no email is sent from here, so a provider outage can never roll back or block a payment action.
 * Payment reminders are created by src/lib/payments/reminders.ts (same notification rows).
 */
export type PaymentEvent =
  | { type: "submission_received"; submissionId: string; studentId: string; studentName: string; obligationId: string; periodLabel: string; amountCents: number; isResubmission?: boolean }
  | { type: "submission_verified"; submissionId: string; studentId: string; obligationId: string; periodLabel: string }
  | { type: "correction_requested"; submissionId: string; studentId: string; obligationId: string; periodLabel: string }
  | { type: "submission_rejected"; submissionId: string; studentId: string; obligationId: string; periodLabel: string };

export async function dispatchPaymentEvent(tx: Tx, e: PaymentEvent): Promise<void> {
  const { notifications, users } = schema;
  const base = { submissionId: e.submissionId, obligationId: e.obligationId };
  switch (e.type) {
    case "submission_received": {
      await tx.insert(notifications).values({
        ...base,
        userId: e.studentId,
        type: "submission_received",
        title: "Receipt received",
        message: `Your receipt for ${e.periodLabel} was received and is pending review.`,
      });
      const [admin] = await tx.select({ userId: users.userId }).from(users).where(eq(users.role, "admin"));
      if (admin) {
        await tx.insert(notifications).values({
          ...base,
          userId: admin.userId,
          type: "submission_received",
          title: e.isResubmission ? "Corrected receipt resubmitted" : "New receipt to review",
          message: `${e.studentName} ${e.isResubmission ? "resubmitted a receipt" : "submitted a receipt"} for ${e.periodLabel} (${formatPeso(e.amountCents)}).`,
          ...emailQueued(),
        });
      } else {
        console.warn("[pnpay] no administrator account exists; admin notification skipped");
      }
      return;
    }
    case "submission_verified":
      await tx.insert(notifications).values({ ...base, userId: e.studentId, type: "submission_verified", title: "Payment verified", message: `Your payment for ${e.periodLabel} was verified.`, ...emailQueued() });
      return;
    case "correction_requested":
      await tx.insert(notifications).values({ ...base, userId: e.studentId, type: "correction_requested", title: "Correction requested", message: `Your receipt for ${e.periodLabel} needs a correction. Please submit it again.`, ...emailQueued() });
      return;
    case "submission_rejected":
      await tx.insert(notifications).values({ ...base, userId: e.studentId, type: "submission_rejected", title: "Receipt rejected", message: `Your receipt for ${e.periodLabel} was rejected. See the remarks and submit a new receipt.`, ...emailQueued() });
      return;
  }
}
