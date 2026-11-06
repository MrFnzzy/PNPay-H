import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { assignBatchPlanToStudent } from "@/lib/admin/schedules";
import { getBatchOptions } from "@/lib/batch-window";
import { getDb, schema } from "@/db";
import { getEnv } from "@/lib/env";
import { UserFacingError, pgErrorInfo } from "@/lib/errors";
import { sendTrackedEmail } from "@/lib/email";
import { verificationEmail } from "@/lib/email/templates";
import { clearEvents, countEvents, hit, recordEvent } from "@/lib/rate-limit";
import type { RegisterInput } from "@/lib/validation";
import { getDummyHash, hashPassword, verifyPassword } from "./passwords";
import { generateToken, hashToken } from "./tokens";

const { users, emailVerificationTokens, sessions } = schema;

export type Role = "student" | "admin";

export const VERIFICATION_TTL_HOURS = 24;
export const SESSION_TTL_MS: Record<Role, number> = {
  student: 7 * 24 * 3600_000,
  admin: 8 * 3600_000,
};

const LOGIN_FAIL_MAX_PER_EMAIL = 5;
const LOGIN_FAIL_MAX_PER_IP = 20;
const LOGIN_WINDOW_MS = 15 * 60_000;
const RESEND_MAX_PER_EMAIL = 3;
const RESEND_MAX_PER_IP = 10;
const RESEND_WINDOW_MS = 60 * 60_000;
const REGISTER_MAX_PER_IP = 10;

export function verificationLink(token: string): string {
  return `${getEnv().APP_BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
}

async function issueVerificationToken(userId: string): Promise<string> {
  const token = generateToken();
  const db = getDb();
  await db.transaction(async (tx) => {
    // Only one live token per user: remove older unused ones.
    await tx
      .delete(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt)));
    await tx.insert(emailVerificationTokens).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600_000),
    });
  });
  return token;
}

async function sendVerification(user: { userId: string; fullName: string; email: string }, token: string) {
  const mail = verificationEmail(user.fullName, verificationLink(token), VERIFICATION_TTL_HOURS);
  return sendTrackedEmail({ to: user.email, ...mail }, { userId: user.userId, template: "verify_email" });
}

/* ------------------------------------------------------------------ registration */

export interface RegisterResult {
  userId: string;
  emailSent: boolean;
}

export async function registerStudent(input: RegisterInput, ip = "unknown"): Promise<RegisterResult> {
  if (!(await hit(`register:ip:${ip}`, REGISTER_MAX_PER_IP, RESEND_WINDOW_MS))) {
    throw new UserFacingError("Too many registration attempts. Please try again later.", "rate_limited", 429);
  }
  if (!(await getBatchOptions()).includes(input.batch)) throw new UserFacingError("Select a valid yearly batch.", "invalid_batch", 422);
  const db = getDb();

  const dup = await db
    .select({ email: users.email, studentId: users.studentId })
    .from(users)
    .where(sql`${users.email} = ${input.email} OR ${users.studentId} = ${input.studentId}`);
  if (dup.some((d) => d.email === input.email)) throw new DuplicateError("email");
  if (dup.some((d) => d.studentId === input.studentId)) throw new DuplicateError("studentId");

  const passwordHash = await hashPassword(input.password);
  let userId: string;
  try {
    // One transaction: the account and the installments of its batch's saved plan are created together or not at all.
    userId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          fullName: input.fullName,
          studentId: input.studentId,
          email: input.email,
          passwordHash,
          course: input.course,
          batch: input.batch,
          role: "student", // always; never taken from the request
          emailVerifiedAt: null,
        })
        .returning({ userId: users.userId });
      await assignBatchPlanToStudent(tx, row.userId, input.batch);
      return row.userId;
    });
  } catch (err) {
    // Simultaneous requests: the unique indexes are the source of truth.
    const { code, constraint } = pgErrorInfo(err);
    if (code === "23505") throw new DuplicateError(constraint?.includes("student") ? "studentId" : "email");
    throw err;
  }

  const token = await issueVerificationToken(userId);
  const emailSent = await sendVerification({ userId, fullName: input.fullName, email: input.email }, token);
  return { userId, emailSent };
}

export class DuplicateError extends UserFacingError {
  constructor(public readonly field: "email" | "studentId") {
    super(
      field === "email" ? "An account with this email already exists." : "An account with this student ID already exists.",
      "duplicate",
      409,
    );
  }
}

/* ------------------------------------------------------------------ email verification */

export type VerifyOutcome = "verified" | "already_verified" | "expired" | "used" | "invalid";

export async function verifyEmailToken(rawToken: string): Promise<VerifyOutcome> {
  if (!rawToken || rawToken.length < 20 || rawToken.length > 200) return "invalid";
  const tokenHash = hashToken(rawToken);
  const db = getDb();

  return db.transaction(async (tx) => {
    // Atomic one-time consumption: only one concurrent request can flip used_at.
    const consumed = await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailVerificationTokens.tokenHash, tokenHash),
          isNull(emailVerificationTokens.usedAt),
          gt(emailVerificationTokens.expiresAt, new Date()),
        ),
      )
      .returning({ userId: emailVerificationTokens.userId });

    if (consumed.length === 1) {
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(and(eq(users.userId, consumed[0].userId), isNull(users.emailVerifiedAt)));
      return "verified" as const;
    }

    const [existing] = await tx
      .select({ usedAt: emailVerificationTokens.usedAt, expiresAt: emailVerificationTokens.expiresAt, verifiedAt: users.emailVerifiedAt })
      .from(emailVerificationTokens)
      .innerJoin(users, eq(users.userId, emailVerificationTokens.userId))
      .where(eq(emailVerificationTokens.tokenHash, tokenHash));
    if (!existing) return "invalid" as const;
    if (existing.usedAt) return existing.verifiedAt ? ("already_verified" as const) : ("used" as const);
    return "expired" as const;
  });
}

/**
 * Always resolves without revealing whether the email exists (prevents account enumeration).
 * Returns false only when rate-limited.
 */
export async function resendVerification(email: string, ip = "unknown"): Promise<{ limited: boolean }> {
  const okEmail = await hit(`resend:email:${email}`, RESEND_MAX_PER_EMAIL, RESEND_WINDOW_MS);
  const okIp = await hit(`resend:ip:${ip}`, RESEND_MAX_PER_IP, RESEND_WINDOW_MS);
  if (!okEmail || !okIp) return { limited: true };

  const [user] = await getDb()
    .select({ userId: users.userId, fullName: users.fullName, email: users.email, verified: users.emailVerifiedAt, active: users.isActive, role: users.role })
    .from(users)
    .where(eq(users.email, email));
  if (user && user.role === "student" && user.active && !user.verified) {
    const token = await issueVerificationToken(user.userId);
    await sendVerification(user, token);
  }
  return { limited: false };
}

/* ------------------------------------------------------------------ login */

export type LoginFailure = "invalid" | "unverified" | "rate_limited";
export type LoginResult =
  | { ok: true; userId: string; role: Role }
  | { ok: false; reason: LoginFailure };

/**
 * Shared credential check. The expected role is checked separately so a student
 * can never enter the admin portal and vice versa. Wrong-role attempts look
 * exactly like wrong-password attempts.
 */
export async function authenticate(email: string, password: string, expectedRole: Role, ip = "unknown"): Promise<LoginResult> {
  const emailKey = `login:email:${email}`;
  const ipKey = `login:ip:${ip}`;
  if ((await countEvents(emailKey, LOGIN_WINDOW_MS)) >= LOGIN_FAIL_MAX_PER_EMAIL || (await countEvents(ipKey, LOGIN_WINDOW_MS)) >= LOGIN_FAIL_MAX_PER_IP) {
    return { ok: false, reason: "rate_limited" };
  }

  const [user] = await getDb().select().from(users).where(eq(users.email, email));
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, await getDummyHash()), false);

  const fail = async (): Promise<LoginResult> => {
    await Promise.all([recordEvent(emailKey), recordEvent(ipKey)]);
    return { ok: false, reason: "invalid" };
  };

  if (!user || !passwordOk || !user.isActive || user.role !== expectedRole) return fail();
  if (user.role === "student" && !user.emailVerifiedAt) return { ok: false, reason: "unverified" };

  await clearEvents(emailKey);
  return { ok: true, userId: user.userId, role: user.role };
}

/* ------------------------------------------------------------------ sessions */

/**
 * Creates a brand-new session (new random token = session-fixation protection).
 * If the browser presented an old token, that session is destroyed (regeneration).
 */
export async function createSession(userId: string, role: Role, previousToken?: string): Promise<{ token: string; expiresAt: Date }> {
  const db = getDb();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS[role]);
  await db.transaction(async (tx) => {
    if (previousToken) await tx.delete(sessions).where(eq(sessions.tokenHash, hashToken(previousToken)));
    await tx.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
    await tx.delete(sessions).where(lt(sessions.expiresAt, new Date())); // housekeeping
  });
  return { token, expiresAt };
}

export interface SessionUser {
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  studentId: string | null;
  /** Unread notifications for this user, read in the same query as the session (no extra round trip for the badge). */
  unread: number;
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const [row] = await getDb()
    .select({
      userId: users.userId,
      fullName: users.fullName,
      email: users.email,
      role: users.role,
      studentId: users.studentId,
      isActive: users.isActive,
      verifiedAt: users.emailVerifiedAt,
      unread: sql<number>`(select count(*)::int from ${schema.notifications} where ${schema.notifications.userId} = ${users.userId} and ${schema.notifications.isRead} = false)`,
    })
    .from(sessions)
    .innerJoin(users, eq(users.userId, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())));
  if (!row || !row.isActive) return null;
  if (row.role === "student" && !row.verifiedAt) return null;
  const { isActive: _a, verifiedAt: _v, ...user } = row;
  return user;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Where a signed-in user of a given role belongs. */
export const homeFor = (role: Role) => (role === "admin" ? "/admin/dashboard" : "/student/dashboard");
