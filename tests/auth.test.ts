import { eq, sql } from "drizzle-orm";
import { beforeEach, afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, schema } from "@/db";
import { failNextEmailForTests, memoryOutbox } from "@/lib/email";
import { createAdmin } from "@/lib/auth/admin-setup";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { hashToken } from "@/lib/auth/tokens";
import {
  authenticate,
  createSession,
  destroySession,
  getSessionUser,
  registerStudent,
  resendVerification,
  verifyEmailToken,
} from "@/lib/auth/service";
import { registerSchema } from "@/lib/validation";
import { lastTokenFromOutbox, resetDb, validRegistration } from "./helpers/db";

const { users, emailVerificationTokens, sessions, emailDeliveries } = schema;
const db = () => getDb();
const parse = (over: Record<string, unknown> = {}) => registerSchema.parse(validRegistration(over));

async function registerAndVerify(over: Record<string, unknown> = {}) {
  const r = await registerStudent(parse(over));
  await verifyEmailToken(lastTokenFromOutbox());
  return r;
}

const ADMIN = { fullName: "Miss Jean", email: "jean@example.com", password: "AdminPassw0rd!" };

beforeEach(resetDb);
afterAll(closeDb);

describe("Registration", () => {
  it("1. valid student registration succeeds", async () => {
    const r = await registerStudent(parse());
    expect(r.emailSent).toBe(true);
    const [u] = await db().select().from(users).where(eq(users.userId, r.userId));
    expect(u.email).toBe("juan@example.com");
    expect(u.studentId).toBe("2024-0001");
    expect(u.emailVerifiedAt).toBeNull();
    expect(u.isActive).toBe(true);
  });

  it("2. duplicate email is rejected", async () => {
    await registerStudent(parse());
    await expect(registerStudent(parse({ studentId: "2024-0002", email: "JUAN@example.com" }))).rejects.toMatchObject({ code: "duplicate", field: "email" });
  });

  it("3. duplicate student ID is rejected", async () => {
    await registerStudent(parse());
    await expect(registerStudent(parse({ email: "other@example.com", studentId: "2024-0001" }))).rejects.toMatchObject({ code: "duplicate", field: "studentId" });
  });

  it("3b. simultaneous registrations create only one account", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => registerStudent(parse())));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(users);
    expect(n).toBe(1);
  });

  it("4+5. role is always student; a submitted role=admin is ignored", async () => {
    const input = registerSchema.parse(validRegistration({ role: "admin", isActive: false, emailVerifiedAt: "2020-01-01" }));
    expect("role" in input).toBe(false);
    const r = await registerStudent(input);
    const [u] = await db().select().from(users).where(eq(users.userId, r.userId));
    expect(u.role).toBe("student");
    expect(u.emailVerifiedAt).toBeNull();
    expect(u.isActive).toBe(true);
  });

  it("6. password is stored as a salted scrypt hash, never plaintext", async () => {
    const r = await registerStudent(parse());
    const [u] = await db().select().from(users).where(eq(users.userId, r.userId));
    expect(u.passwordHash).not.toContain("Str0ngPassw0rd");
    expect(u.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Str0ngPassw0rd", u.passwordHash)).toBe(true);
    expect(await verifyPassword("wrong", u.passwordHash)).toBe(false);
    expect(await hashPassword("same")).not.toBe(await hashPassword("same")); // unique salts
  });

  it("validation: weak password, mismatch, bad email, missing fields", () => {
    expect(registerSchema.safeParse(validRegistration({ password: "short1A", confirmPassword: "short1A" })).success).toBe(false);
    expect(registerSchema.safeParse(validRegistration({ password: "alllowercase1", confirmPassword: "alllowercase1" })).success).toBe(false);
    expect(registerSchema.safeParse(validRegistration({ confirmPassword: "Different1Password" })).success).toBe(false);
    expect(registerSchema.safeParse(validRegistration({ email: "not-an-email" })).success).toBe(false);
    expect(registerSchema.safeParse(validRegistration({ fullName: "" })).success).toBe(false);
    expect(registerSchema.safeParse(validRegistration({ yearLevel: "" })).success).toBe(false);
    expect(registerSchema.safeParse(validRegistration({ studentId: "x y" })).success).toBe(false);
  });

  it("7. verification email is generated and recorded; raw token is not stored", async () => {
    await registerStudent(parse());
    const mail = memoryOutbox().at(-1)!;
    expect(mail.to).toBe("juan@example.com");
    expect(mail.text).toContain("/verify-email?token=");
    const token = lastTokenFromOutbox();
    const rows = await db().select().from(emailVerificationTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toBe(token);
    const [d] = await db().select().from(emailDeliveries);
    expect(d.status).toBe("sent");
    expect(JSON.stringify(d)).not.toContain(token);
  });

  it("email failure keeps the account, records the failure and allows resend", async () => {
    failNextEmailForTests();
    const r = await registerStudent(parse());
    expect(r.emailSent).toBe(false);
    const [d] = await db().select().from(emailDeliveries);
    expect(d.status).toBe("failed");
    expect(d.attempts).toBe(1);
    await resendVerification("juan@example.com");
    expect(memoryOutbox()).toHaveLength(1);
  });
});

describe("Email verification", () => {
  it("8. valid token verifies the email", async () => {
    const r = await registerStudent(parse());
    expect(await verifyEmailToken(lastTokenFromOutbox())).toBe("verified");
    const [u] = await db().select().from(users).where(eq(users.userId, r.userId));
    expect(u.emailVerifiedAt).not.toBeNull();
  });

  it("9. expired token fails", async () => {
    await registerStudent(parse());
    await db().update(emailVerificationTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyEmailToken(lastTokenFromOutbox())).toBe("expired");
    const [u] = await db().select().from(users);
    expect(u.emailVerifiedAt).toBeNull();
  });

  it("10. used token cannot be reused", async () => {
    await registerStudent(parse());
    const t = lastTokenFromOutbox();
    expect(await verifyEmailToken(t)).toBe("verified");
    expect(await verifyEmailToken(t)).toBe("already_verified");
  });

  it("10b. concurrent use of one token succeeds exactly once", async () => {
    await registerStudent(parse());
    const t = lastTokenFromOutbox();
    const out = await Promise.all([1, 2, 3, 4].map(() => verifyEmailToken(t)));
    expect(out.filter((o) => o === "verified")).toHaveLength(1);
  });

  it("invalid / garbage / tampered tokens are rejected", async () => {
    await registerStudent(parse());
    const t = lastTokenFromOutbox();
    expect(await verifyEmailToken("")).toBe("invalid");
    expect(await verifyEmailToken("a".repeat(43))).toBe("invalid");
    expect(await verifyEmailToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe("invalid");
    expect(await verifyEmailToken("x".repeat(500))).toBe("invalid");
  });

  it("resend issues a new token, invalidates the old one, and does not reveal unknown emails", async () => {
    await registerStudent(parse());
    const oldToken = lastTokenFromOutbox();
    expect(await resendVerification("juan@example.com")).toEqual({ limited: false });
    const newToken = lastTokenFromOutbox();
    expect(newToken).not.toBe(oldToken);
    expect(await verifyEmailToken(oldToken)).toBe("invalid");
    expect(await verifyEmailToken(newToken)).toBe("verified");
    const before = memoryOutbox().length;
    expect(await resendVerification("nobody@example.com")).toEqual({ limited: false });
    expect(memoryOutbox()).toHaveLength(before); // nothing sent, same response
  });

  it("resend is rate limited per email", async () => {
    await registerStudent(parse());
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await resendVerification("juan@example.com")).limited);
    expect(results.slice(0, 3)).toEqual([false, false, false]);
    expect(results.slice(3)).toEqual([true, true]);
  });

  it("resend does nothing for an already verified student", async () => {
    await registerAndVerify();
    const before = memoryOutbox().length;
    await resendVerification("juan@example.com");
    expect(memoryOutbox()).toHaveLength(before);
  });
});

describe("Login", () => {
  it("11. unverified student cannot log in (and no session is created)", async () => {
    await registerStudent(parse());
    expect(await authenticate("juan@example.com", "Str0ngPassw0rd", "student")).toEqual({ ok: false, reason: "unverified" });
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it("unverified status is not revealed with a wrong password", async () => {
    await registerStudent(parse());
    expect(await authenticate("juan@example.com", "WrongPassw0rd", "student")).toEqual({ ok: false, reason: "invalid" });
  });

  it("12. verified student can log in and gets a working session", async () => {
    await registerAndVerify();
    const res = await authenticate("juan@example.com", "Str0ngPassw0rd", "student");
    expect(res).toMatchObject({ ok: true, role: "student" });
    if (!res.ok) throw new Error();
    const { token } = await createSession(res.userId, res.role);
    expect(await getSessionUser(token)).toMatchObject({ email: "juan@example.com", role: "student" });
  });

  it("13. invalid credentials are rejected with one generic reason", async () => {
    await registerAndVerify();
    expect(await authenticate("juan@example.com", "WrongPassw0rd", "student")).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate("ghost@example.com", "Str0ngPassw0rd", "student")).toEqual({ ok: false, reason: "invalid" });
  });

  it("login is rate limited after repeated failures, even with the right password afterwards", async () => {
    await registerAndVerify();
    for (let i = 0; i < 5; i++) await authenticate("juan@example.com", "WrongPassw0rd", "student");
    expect(await authenticate("juan@example.com", "Str0ngPassw0rd", "student")).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("deactivated students cannot log in or use an existing session", async () => {
    const r = await registerAndVerify();
    const res = await authenticate("juan@example.com", "Str0ngPassw0rd", "student");
    if (!res.ok) throw new Error();
    const { token } = await createSession(res.userId, res.role);
    await db().update(users).set({ isActive: false }).where(eq(users.userId, r.userId));
    expect(await getSessionUser(token)).toBeNull();
    expect((await authenticate("juan@example.com", "Str0ngPassw0rd", "student")).ok).toBe(false);
  });
});

describe("Admin and role separation", () => {
  it("15. admin can log in after controlled setup, via the admin portal only", async () => {
    await createAdmin(ADMIN);
    const [a] = await db().select().from(users).where(eq(users.role, "admin"));
    expect(a.emailVerifiedAt).not.toBeNull();
    expect(a.studentId).toBeNull();
    expect(await authenticate(ADMIN.email, ADMIN.password, "admin")).toMatchObject({ ok: true, role: "admin" });
    expect(await authenticate(ADMIN.email, ADMIN.password, "student")).toEqual({ ok: false, reason: "invalid" });
  });

  it("14. a student cannot authenticate to the admin portal and a student session never has the admin role", async () => {
    await registerAndVerify();
    expect(await authenticate("juan@example.com", "Str0ngPassw0rd", "admin")).toEqual({ ok: false, reason: "invalid" });
    const res = await authenticate("juan@example.com", "Str0ngPassw0rd", "student");
    if (!res.ok) throw new Error();
    const { token } = await createSession(res.userId, res.role);
    expect((await getSessionUser(token))?.role).toBe("student");
  });

  it("role escalation: the database rejects a second admin and an unverified-style admin shortcut", async () => {
    await createAdmin(ADMIN);
    await expect(createAdmin({ ...ADMIN, email: "second@example.com" })).rejects.toThrow(/already exists/);
    // Even a direct insert (e.g. via a bug) cannot create a second admin:
    await expect(
      db().insert(users).values({ fullName: "Evil", email: "evil@example.com", passwordHash: "x", role: "admin" }),
    ).rejects.toThrow();
    // ...and cannot create a student without a student ID.
    await expect(db().insert(users).values({ fullName: "NoId", email: "noid@example.com", passwordHash: "x", role: "student" })).rejects.toThrow();
  });

  it("admin setup supports password reset, invalidating old sessions", async () => {
    const { userId } = await createAdmin(ADMIN);
    const { token } = await createSession(userId, "admin");
    await createAdmin({ ...ADMIN, password: "NewAdminPassw0rd" }, { resetPassword: true });
    expect(await getSessionUser(token)).toBeNull();
    expect(await authenticate(ADMIN.email, "NewAdminPassw0rd", "admin")).toMatchObject({ ok: true });
    expect((await authenticate(ADMIN.email, ADMIN.password, "admin")).ok).toBe(false);
  });

  it("admin setup rejects weak passwords", async () => {
    await expect(createAdmin({ ...ADMIN, password: "weak" })).rejects.toThrow(/Invalid admin details/);
  });
});

describe("Sessions", () => {
  it("16. logout invalidates the session", async () => {
    const { userId } = await createAdmin(ADMIN);
    const { token } = await createSession(userId, "admin");
    expect(await getSessionUser(token)).not.toBeNull();
    await destroySession(token);
    expect(await getSessionUser(token)).toBeNull();
    expect(await db().select().from(sessions)).toHaveLength(0);
  });

  it("sessions expire", async () => {
    const { userId } = await createAdmin(ADMIN);
    const { token } = await createSession(userId, "admin");
    await db().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await getSessionUser(token)).toBeNull();
  });

  it("login regenerates the session: the old token dies and a new one is issued", async () => {
    const { userId } = await createAdmin(ADMIN);
    const first = await createSession(userId, "admin");
    const second = await createSession(userId, "admin", first.token);
    expect(second.token).not.toBe(first.token);
    expect(await getSessionUser(first.token)).toBeNull();
    expect(await getSessionUser(second.token)).not.toBeNull();
  });

  it("only a hash of the session token is stored; forged tokens fail", async () => {
    const { userId } = await createAdmin(ADMIN);
    const { token } = await createSession(userId, "admin");
    const [row] = await db().select().from(sessions);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toBe(token);
    expect(await getSessionUser("forged-token")).toBeNull();
    expect(await getSessionUser(undefined)).toBeNull();
  });

  it("a session for a student who is not verified is rejected", async () => {
    const r = await registerStudent(parse());
    const { token } = await createSession(r.userId, "student"); // simulate a bug creating one anyway
    expect(await getSessionUser(token)).toBeNull();
  });
});

describe("Schema", () => {
  it("payment_obligations: FK, unique student+period, positive amount", async () => {
    const r = await registerStudent(parse());
    const row = { studentId: r.userId, academicYear: "2026-2027", periodLabel: "October 2026", amountDue: "500.00", dueDate: "2026-10-05" };
    await db().insert(schema.paymentObligations).values(row);
    await expect(db().insert(schema.paymentObligations).values(row)).rejects.toThrow(); // duplicate period
    await expect(db().insert(schema.paymentObligations).values({ ...row, periodLabel: "Nov", amountDue: "0" })).rejects.toThrow();
    await expect(
      db().insert(schema.paymentObligations).values({ ...row, periodLabel: "Dec", studentId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(); // FK
  });
});
