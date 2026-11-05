"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { toSafeMessage } from "@/lib/errors";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/payments/queries";
import { submitReceipt } from "@/lib/payments/submit";

export interface SubmitState {
  message?: string;
}

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

/**
 * Receipt submission. Only the five fields below are read from the form. Any studentId, amount, status or
 * role in the request is ignored: identity comes from the session, the amount from the installment row.
 */
export async function submitReceiptAction(_prev: SubmitState, fd: FormData): Promise<SubmitState> {
  const user = await requireRole("student");
  let submissionId: string;
  try {
    const res = await submitReceipt(user.userId, user.fullName, {
      obligationId: str(fd, "obligationId"),
      intentId: str(fd, "intentId"),
      paymentDate: str(fd, "paymentDate"),
      paymentMethod: str(fd, "paymentMethod"),
      referenceNumber: str(fd, "referenceNumber"),
    });
    submissionId = res.submissionId;
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  scheduleEmailDelivery(); // admin "new receipt" email; sent after the response, never blocks or fails the submission
  revalidatePath("/student", "layout");
  redirect(`/student/history?submitted=${submissionId}`);
}

export async function markNotificationReadAction(fd: FormData): Promise<void> {
  const user = await requireRole("student");
  const id = z.string().uuid().safeParse(str(fd, "notificationId"));
  if (id.success) await markNotificationRead(user.userId, id.data); // scoped to the session student
  revalidatePath("/student", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireRole("student");
  await markAllNotificationsRead(user.userId);
  revalidatePath("/student", "layout");
}
