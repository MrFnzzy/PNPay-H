import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getEnv } from "@/lib/env";
import { UserFacingError, pgErrorInfo } from "@/lib/errors";
import { hit } from "@/lib/rate-limit";
import { getReceiptStorage } from "@/lib/storage";
import { manilaToday } from "./dates";
import { dispatchPaymentEvent } from "./events";
import { toCents } from "./money";
import { detectImage } from "./receipt-file";
import { deriveInstallmentStatus, isSubmittable, INSTALLMENT_LABEL } from "./status";
import { normalizeReference, submissionSchema } from "./validation";

const { paymentObligations: ob, paymentSubmissions: sub, receiptUploadIntents: intents, orphanedUploads } = schema;

export const UPLOAD_INTENT_TTL_MS = 15 * 60_000;
const INTENTS_PER_HOUR = 20;

const NOT_FOUND = () => new UserFacingError("That installment was not found.", "not_found", 404);

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type Reader = ReturnType<typeof getDb> | Tx;

/** Loads an installment ONLY if it belongs to this student, and checks it can still receive a receipt. */
async function loadEligibleObligation(db: Reader, studentId: string, obligationId: string, today: string, lock = false) {
  const q = db
    .select()
    .from(ob)
    .where(and(eq(ob.obligationId, obligationId), eq(ob.studentId, studentId)))
    .limit(1);
  const [o] = lock ? await q.for("update") : await q;
  if (!o) throw NOT_FOUND(); // same answer whether it does not exist or belongs to someone else
  const subs = await db
    .select({ status: sub.status, submittedAt: sub.submittedAt })
    .from(sub)
    .where(and(eq(sub.obligationId, o.obligationId), eq(sub.studentId, studentId)));
  const status = deriveInstallmentStatus(o.dueDate, today, subs);
  if (!isSubmittable(status)) {
    throw new UserFacingError(
      status === "paid" ? "This installment is already paid." : "A receipt for this installment is already awaiting review.",
      "not_eligible",
      409,
    );
  }
  return { obligation: o, status };
}

export interface UploadIntent {
  intentId: string;
  storageKey: string;
  expiresAt: Date;
  maxBytes: number;
}

/** Step 1 of a submission: the server authorizes ONE upload for ONE of this student's eligible installments. */
export async function createUploadIntent(studentId: string, obligationId: string, now = new Date()): Promise<UploadIntent> {
  if (!(await hit(`upload-intent:${studentId}`, INTENTS_PER_HOUR, 3600_000))) {
    throw new UserFacingError("Too many upload attempts. Please try again later.", "rate_limited", 429);
  }
  await loadEligibleObligation(getDb(), studentId, obligationId, manilaToday(now));
  // Server-generated key: student folder + random id, no user-supplied filename.
  const storageKey = `receipts/${studentId}/${randomUUID()}`;
  const expiresAt = new Date(now.getTime() + UPLOAD_INTENT_TTL_MS);
  const [row] = await getDb().insert(intents).values({ studentId, obligationId, storageKey, expiresAt }).returning({ intentId: intents.intentId });
  return { intentId: row.intentId, storageKey, expiresAt, maxBytes: getEnv().RECEIPT_MAX_BYTES };
}

/** Looks up a live intent owned by this student (used by the upload endpoints and by submission). */
export async function getLiveIntent(studentId: string, intentId: string, now = new Date()) {
  const [row] = await getDb()
    .select()
    .from(intents)
    .where(and(eq(intents.intentId, intentId), eq(intents.studentId, studentId), isNull(intents.consumedAt), gt(intents.expiresAt, now)));
  return row ?? null;
}

async function discardObject(key: string, reason: string, intentId: string) {
  const db = getDb();
  try {
    await getReceiptStorage().delete(key);
  } catch {
    // Could not delete now: record it so `npm run cleanup:uploads` retries.
    await db.insert(orphanedUploads).values({ storageKey: key, reason }).onConflictDoNothing().catch(() => console.error("[pnpay] could not record orphaned upload"));
  }
  // The object is gone (or queued for deletion): this intent can never be used again.
  await db.update(intents).set({ consumedAt: new Date() }).where(and(eq(intents.intentId, intentId), isNull(intents.consumedAt))).catch(() => undefined);
}

export interface SubmitResult {
  submissionId: string;
  status: "pending_review";
}

/** Step 2: validate everything on the server, then create the submission. Success is returned only after it is saved. */
export async function submitReceipt(studentId: string, studentName: string, raw: Record<string, unknown>, now = new Date()): Promise<SubmitResult> {
  const today = manilaToday(now);
  const parsed = submissionSchema(today).safeParse(raw);
  if (!parsed.success) {
    throw new UserFacingError(parsed.error.issues[0]?.message ?? "Please check the form.", "invalid_input", 422);
  }
  const input = parsed.data;

  const intent = await getLiveIntent(studentId, input.intentId, now);
  if (!intent || intent.obligationId !== input.obligationId) {
    throw new UserFacingError("Your upload session expired. Please select the receipt again.", "intent_invalid", 409);
  }
  const key = intent.storageKey;
  const storage = getReceiptStorage();
  const maxBytes = getEnv().RECEIPT_MAX_BYTES;

  // ---- verify the uploaded object itself (never trust what the client says about it)
  let bytes: Buffer | null = null;
  try {
    const size = await storage.size(key);
    if (size === null) throw new UserFacingError("Your receipt upload did not complete. Please try again.", "upload_missing", 409);
    if (size > maxBytes) {
      await discardObject(key, "oversize", intent.intentId);
      throw new UserFacingError(`The receipt is too large. The limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`, "too_large", 413);
    }
    bytes = await storage.read(key);
    if (!bytes) throw new UserFacingError("Your receipt upload did not complete. Please try again.", "upload_missing", 409);
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    console.error("[pnpay] storage verification failed:", e instanceof Error ? e.name : "unknown");
    throw new UserFacingError("We could not check your receipt right now. Please try again.", "storage_unavailable", 503);
  }
  const detected = detectImage(bytes);
  if (!detected) {
    await discardObject(key, "invalid_type", intent.intentId);
    throw new UserFacingError("The receipt must be a PNG or JPEG image.", "invalid_file", 415);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const referenceNumber = input.referenceNumber ?? null;
  const referenceNormalized = referenceNumber ? normalizeReference(referenceNumber) : null;

  // ---- one transaction: re-check eligibility under a row lock, consume the intent, create the submission + notifications
  try {
    const result = await getDb().transaction(async (tx) => {
      const { obligation } = await loadEligibleObligation(tx, studentId, input.obligationId, today, true);
      const consumed = await tx
        .update(intents)
        .set({ consumedAt: now })
        .where(and(eq(intents.intentId, intent.intentId), isNull(intents.consumedAt)))
        .returning({ id: intents.intentId });
      if (consumed.length === 0) throw new UserFacingError("This upload was already used.", "intent_used", 409);

      // Link a replacement to the submission it follows (Needs Correction / Rejected).
      const [previous] = await tx
        .select({ id: sub.submissionId })
        .from(sub)
        .where(and(eq(sub.obligationId, obligation.obligationId), eq(sub.studentId, studentId)))
        .orderBy(sql`${sub.submittedAt} desc`)
        .limit(1);

      const [created] = await tx
        .insert(sub)
        .values({
          studentId, // from the session
          obligationId: obligation.obligationId,
          previousSubmissionId: previous?.id ?? null,
          amountSubmitted: obligation.amountDue, // from the installment, never from the client
          paymentDate: input.paymentDate,
          paymentMethod: input.paymentMethod,
          referenceNumber,
          referenceNormalized,
          receiptKey: key,
          receiptMime: detected.mime,
          receiptSize: bytes!.length,
          receiptSha256: sha256,
          status: "pending_review",
          submittedAt: now,
        })
        .returning({ submissionId: sub.submissionId });

      await dispatchPaymentEvent(tx, {
        type: "submission_received",
        submissionId: created.submissionId,
        studentId,
        studentName,
        obligationId: obligation.obligationId,
        periodLabel: obligation.periodLabel,
        amountCents: toCents(obligation.amountDue),
        isResubmission: Boolean(previous),
      });
      return created;
    });
    return { submissionId: result.submissionId, status: "pending_review" };
  } catch (e) {
    // Nothing was saved. Remove the now-unused object (or queue it for cleanup).
    await discardObject(key, "submission_failed", intent.intentId);
    if (e instanceof UserFacingError) throw e;
    const { code, constraint } = pgErrorInfo(e);
    if (code === "23505") {
      if (constraint === "payment_submissions_open_reference_key") throw new UserFacingError("That transaction reference was already submitted.", "duplicate_reference", 409);
      if (constraint === "payment_submissions_open_receipt_hash_key") throw new UserFacingError("This receipt image was already submitted.", "duplicate_receipt", 409);
      if (constraint === "payment_submissions_one_open_per_obligation") throw new UserFacingError("A receipt for this installment is already awaiting review or verified.", "not_eligible", 409);
    }
    console.error("[pnpay] submission save failed:", code ?? (e instanceof Error ? e.name : "unknown"));
    throw new UserFacingError("We could not save your submission. Please try again.", "save_failed", 500);
  }
}

/** Removes uploads that were authorized but never submitted, and retries failed deletions. Safe to run repeatedly. */
export async function cleanupUploads(now = new Date()): Promise<{ expiredIntents: number; orphansDeleted: number; orphansFailed: number }> {
  const db = getDb();
  const storage = getReceiptStorage();
  let expiredIntents = 0;
  const stale = await db
    .select({ intentId: intents.intentId, key: intents.storageKey })
    .from(intents)
    .where(and(isNull(intents.consumedAt), sql`${intents.expiresAt} <= ${now}`));
  for (const s of stale) {
    try {
      await storage.delete(s.key);
      await db.update(intents).set({ consumedAt: now }).where(eq(intents.intentId, s.intentId));
      expiredIntents++;
    } catch {
      await db.insert(orphanedUploads).values({ storageKey: s.key, reason: "expired_intent" }).onConflictDoNothing();
      await db.update(intents).set({ consumedAt: now }).where(eq(intents.intentId, s.intentId));
    }
  }
  let orphansDeleted = 0;
  let orphansFailed = 0;
  const orphans = await db.select().from(orphanedUploads).where(isNull(orphanedUploads.deletedAt));
  for (const o of orphans) {
    try {
      await storage.delete(o.storageKey);
      await db.update(orphanedUploads).set({ deletedAt: now, attempts: o.attempts + 1 }).where(eq(orphanedUploads.orphanId, o.orphanId));
      orphansDeleted++;
    } catch {
      await db.update(orphanedUploads).set({ attempts: o.attempts + 1 }).where(eq(orphanedUploads.orphanId, o.orphanId));
      orphansFailed++;
    }
  }
  return { expiredIntents, orphansDeleted, orphansFailed };
}

export { INSTALLMENT_LABEL };
