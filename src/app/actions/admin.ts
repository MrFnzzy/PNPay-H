"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { approveBatchRollover } from "@/lib/admin/batches";
import { deleteSubmission, reviewSubmission } from "@/lib/admin/review";
import { createBatchPlan, createSchedule, deleteObligation, trimExtraInstallments, updateObligation } from "@/lib/admin/schedules";
import { deleteStudentAccount } from "@/lib/accounts";
import { getStudentHeader } from "@/lib/admin/records";
import { requireRole } from "@/lib/auth/session";
import { processEmailQueue, retryAllFailedEmails, retryFailedEmail } from "@/lib/email/queue";
import { scheduleEmailDelivery } from "@/lib/email/schedule";
import { toSafeMessage, UserFacingError } from "@/lib/errors";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/payments/queries";

export interface AdminFormState {
  message?: string;
}

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");
const uuid = z.string().uuid();

/**
 * Review decision (LLD 9.2). Only submissionId, decision and remarks are read from the form; the reviewer is
 * ALWAYS the session administrator. A success redirect happens only after the transaction has committed.
 */
export async function reviewSubmissionAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await requireRole("admin");
  const submissionId = str(fd, "submissionId");
  let decision: string;
  try {
    const res = await reviewSubmission(admin.userId, { submissionId, decision: str(fd, "decision"), remarks: str(fd, "remarks") });
    decision = res.decision;
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  scheduleEmailDelivery(); // student result email; sent after the response, never blocks or fails the review
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(`/admin/submissions/${submissionId}?reviewed=${decision}`);
}

/** Only an admin student-record page may be used as a return target (never an arbitrary URL). */
const studentReturn = (v: string) => (/^\/admin\/students\/[0-9a-f-]{36}$/i.test(v) ? v : null);

export async function deleteSubmissionAction(fd: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const submissionId = str(fd, "submissionId");
  const returnTo = studentReturn(str(fd, "returnTo"));
  try {
    await deleteSubmission(admin.userId, submissionId);
  } catch {
    redirect(returnTo ? `${returnTo}?deleteError=1` : `/admin/submissions/${submissionId}?deleteError=1`);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(returnTo ? `${returnTo}?deleted=1` : "/admin/records?deleted=1");
}

/** Removes one installment (and any receipts on it, verified included) straight from the student's record. */
export async function deleteInstallmentAction(fd: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const returnTo = studentReturn(str(fd, "returnTo"));
  if (!returnTo) redirect("/admin/schedules");
  try {
    await deleteObligation(admin.userId, str(fd, "obligationId"));
  } catch (err) {
    toSafeMessage(err);
    redirect(`${returnTo}?installmentError=${err instanceof UserFacingError && err.code === "upload_in_progress" ? "uploading" : "failed"}`);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(`${returnTo}?removed=1`);
}

/** Cuts a student who has more than 24 installments back to 24 (extras with receipts are left alone). */
export async function trimInstallmentsAction(fd: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const returnTo = studentReturn(str(fd, "returnTo"));
  if (!returnTo) redirect("/admin/students");
  let q: string;
  try {
    const r = await trimExtraInstallments(admin.userId, str(fd, "studentUserId"));
    q = `trimmed=${r.removed}&kept=${r.keptWithReceipts}`;
  } catch {
    redirect(`${returnTo}?installmentError=failed`);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(`${returnTo}?${q}`);
}

export async function approveBatchRolloverAction(fd: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const proposalId = str(fd, "proposalId");
  try {
    await approveBatchRollover(admin.userId, proposalId);
  } catch {
    redirect("/admin/notifications?rolloverError=1");
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect("/admin/notifications?rolloverApproved=1");
}

export async function createScheduleAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await requireRole("admin");
  let summary: string;
  try {
    const r = await createSchedule(admin.userId, {
      academicYear: str(fd, "academicYear"),
      periodLabel: str(fd, "periodLabel"),
      dueDate: str(fd, "dueDate"),
      amount: str(fd, "amount"),
      amountNote: str(fd, "amountNote"),
      scope: str(fd, "scope"),
      batch: str(fd, "batch") || undefined,
      studentCode: str(fd, "studentCode"),
    });
    summary = `created=${r.created}&skipped=${r.skippedDuplicates}&full=${r.skippedFull}`;
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(`/admin/schedules?${summary}`);
}

export async function createBatchPlanAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await requireRole("admin");
  let summary: string;
  try {
    const r = await createBatchPlan(admin.userId, {
      batch: str(fd, "batch"),
      firstDueDate: str(fd, "firstDueDate"),
      lastDueDate: str(fd, "lastDueDate"),
      amount: str(fd, "amount"),
      amountNote: str(fd, "amountNote"),
    });
    summary = `created=${r.created}&skipped=${r.skippedDuplicates}&full=${r.skippedFull}&plan=${r.months}`;
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(`/admin/schedules?${summary}`);
}

export async function updateObligationAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await requireRole("admin");
  const id = str(fd, "obligationId");
  try {
    await updateObligation(admin.userId, id, {
      academicYear: str(fd, "academicYear"),
      periodLabel: str(fd, "periodLabel"),
      dueDate: str(fd, "dueDate"),
      amount: str(fd, "amount"),
      amountNote: str(fd, "amountNote"),
    });
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect(`/admin/schedules/${id}?saved=1`);
}

export async function deleteObligationAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await requireRole("admin");
  try {
    await deleteObligation(admin.userId, str(fd, "obligationId"));
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/student", "layout");
  redirect("/admin/schedules?removed=1");
}

/** The administrator's own notifications (scoped to the session user, like the student's). */
export async function markAdminNotificationReadAction(fd: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const id = uuid.safeParse(str(fd, "notificationId"));
  if (id.success) await markNotificationRead(admin.userId, id.data);
  revalidatePath("/admin", "layout");
}

export async function markAllAdminNotificationsReadAction(): Promise<void> {
  const admin = await requireRole("admin");
  await markAllNotificationsRead(admin.userId);
  revalidatePath("/admin", "layout");
}

/* ---- email delivery troubleshooting (Phase 4). Each action: requireRole("admin"); the service re-checks the actor. ---- */

/** The page maps these fixed codes to messages; arbitrary text is never carried in the URL. */
function emailErrorCode(err: unknown): "not_failed" | "forbidden" | "failed" {
  toSafeMessage(err); // logs unexpected errors (name only)
  if (err instanceof UserFacingError && (err.code === "not_failed" || err.code === "forbidden")) return err.code;
  return "failed";
}

export async function retryEmailAction(fd: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const id = uuid.safeParse(str(fd, "notificationId"));
  if (!id.success) redirect("/admin/email?error=invalid");
  try {
    await retryFailedEmail(admin.userId, id.data);
  } catch (err) {
    redirect(`/admin/email?error=${emailErrorCode(err)}`);
  }
  scheduleEmailDelivery();
  revalidatePath("/admin/email");
  redirect("/admin/email?retried=1");
}

export async function retryAllFailedEmailsAction(): Promise<void> {
  const admin = await requireRole("admin");
  let n: number;
  try {
    n = await retryAllFailedEmails(admin.userId);
  } catch (err) {
    redirect(`/admin/email?error=${emailErrorCode(err)}`);
  }
  scheduleEmailDelivery();
  revalidatePath("/admin/email");
  redirect(`/admin/email?retried=${n}`);
}

export async function processEmailQueueNowAction(): Promise<void> {
  await requireRole("admin");
  const r = await processEmailQueue({ limit: 50 });
  revalidatePath("/admin/email");
  redirect(`/admin/email?processed=${r.claimed}&sent=${r.sent}&failed=${r.failed + r.retryScheduled}`);
}

/** Administrator deletes a student account. The admin must type the student's ID to confirm. */
export async function deleteStudentAction(_prev: AdminFormState, fd: FormData): Promise<AdminFormState> {
  const admin = await requireRole("admin");
  const id = str(fd, "studentUserId");
  try {
    const student = await getStudentHeader(id);
    if (!student) throw new UserFacingError("That student account was not found.", "not_found", 404);
    if (str(fd, "confirm").trim() !== student.studentId) throw new UserFacingError("Type the student's ID exactly to confirm the deletion.", "confirm_mismatch", 422);
    await deleteStudentAccount(admin.userId, id);
  } catch (err) {
    return { message: toSafeMessage(err) };
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/students?deleted=1");
}
