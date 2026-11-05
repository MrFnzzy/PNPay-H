import { eq, sql } from "drizzle-orm";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/db";
import { emailDeliveries } from "@/db/schema";
import { getEnv } from "@/lib/env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Recorded by the memory provider so tests can assert it; sent to Resend as the Idempotency-Key header. */
  idempotencyKey?: string;
}

/** Provider failure. `retryable` = a later attempt may succeed (network, timeout, 408/425/429/5xx). */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

/** In-memory outbox, only used when EMAIL_PROVIDER=memory (automated tests). */
const g = globalThis as unknown as { __pnpayOutbox?: OutgoingEmail[]; __pnpayFailNext?: boolean | "permanent" };
export const memoryOutbox = (): OutgoingEmail[] => (g.__pnpayOutbox ??= []);
/** Tests only: make the next memory-provider send fail (true = transient/retryable, "permanent" = not retryable). */
export function failNextEmailForTests(v: boolean | "permanent" = true) {
  g.__pnpayFailNext = v;
}

const RETRYABLE_HTTP = (status: number) => status === 408 || status === 425 || status === 429 || status >= 500;

/** Hands one message to the configured provider. Throws EmailSendError. Never logs the message. */
export async function sendViaProvider(msg: OutgoingEmail): Promise<void> {
  const env = getEnv();
  if (env.EMAIL_PROVIDER === "memory") {
    if (g.__pnpayFailNext) {
      const permanent = g.__pnpayFailNext === "permanent";
      g.__pnpayFailNext = false;
      throw new EmailSendError("simulated provider failure", !permanent);
    }
    memoryOutbox().push(msg);
    return;
  }
  if (env.EMAIL_PROVIDER === "file") {
    // Local development only: written to .dev-mail/, never to application logs.
    const dir = path.join(process.cwd(), ".dev-mail");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${Date.now()}-${msg.to.replace(/[^a-z0-9@.]/gi, "_")}.txt`), `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}`);
    return;
  }
  const headers: Record<string, string> = { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" };
  // Stable per notification (+ manual-retry round): if a worker crashes after the provider accepted the message,
  // the next attempt reuses the key and the provider does not send a second copy.
  if (msg.idempotencyKey) headers["Idempotency-Key"] = msg.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(env.RESEND_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new EmailSendError("email provider unreachable or timed out", true);
  }
  if (!res.ok) throw new EmailSendError(`email provider responded with HTTP ${res.status}`, RETRYABLE_HTTP(res.status));
}

export const redact = (s: string) => s.replace(/token=[^\s&"']+/gi, "token=[redacted]").slice(0, 500);

/**
 * Sends an email and records the attempt (queued -> sent/failed) in email_deliveries.
 * Never throws; returns whether the email was handed to the provider. Message bodies
 * (which contain raw tokens) are never stored or logged.
 */
export async function sendTrackedEmail(msg: OutgoingEmail, meta: { userId?: string; template: string }): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .insert(emailDeliveries)
    .values({ userId: meta.userId, toEmail: msg.to, template: meta.template })
    .returning({ id: emailDeliveries.deliveryId });
  try {
    await sendViaProvider(msg);
    await db
      .update(emailDeliveries)
      .set({ status: "sent", attempts: sql`${emailDeliveries.attempts} + 1`, sentAt: new Date(), lastError: null })
      .where(eq(emailDeliveries.deliveryId, row.id));
    return true;
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : "unknown error");
    console.error(`[pnpay] email delivery failed (template=${meta.template}): ${message}`);
    await db
      .update(emailDeliveries)
      .set({ status: "failed", attempts: sql`${emailDeliveries.attempts} + 1`, lastError: message })
      .where(eq(emailDeliveries.deliveryId, row.id));
    return false;
  }
}
