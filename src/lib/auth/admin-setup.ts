import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { pgErrorInfo } from "@/lib/errors";
import { emailSchema, fullNameSchema, passwordSchema } from "@/lib/validation";
import { hashPassword } from "./passwords";

const adminSchema = z.object({ fullName: fullNameSchema, email: emailSchema, password: passwordSchema });

/**
 * Creates the single administrator (LLD 4.3). Only callable from the CLI script - there is
 * no route or action that reaches this function. The database also enforces "one admin"
 * with a partial unique index.
 */
export async function createAdmin(
  input: { fullName: string; email: string; password: string },
  opts: { resetPassword?: boolean } = {},
): Promise<{ action: "created" | "password_reset"; userId: string }> {
  const parsed = adminSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid admin details: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const { users } = schema;
  const db = getDb();
  const [existing] = await db.select({ userId: users.userId, email: users.email }).from(users).where(eq(users.role, "admin"));
  if (existing) {
    if (!opts.resetPassword) throw new Error("An administrator already exists. Use --reset-password to change its password.");
    if (existing.email !== parsed.data.email) throw new Error("ADMIN_EMAIL does not match the existing administrator.");
    await db.update(users).set({ passwordHash: await hashPassword(parsed.data.password) }).where(eq(users.userId, existing.userId));
    // Invalidate existing admin sessions after a password reset.
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, existing.userId));
    return { action: "password_reset", userId: existing.userId };
  }
  try {
    const [row] = await db
      .insert(users)
      .values({
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        passwordHash: await hashPassword(parsed.data.password),
        role: "admin",
        emailVerifiedAt: new Date(),
      })
      .returning({ userId: users.userId });
    return { action: "created", userId: row.userId };
  } catch (err) {
    if (pgErrorInfo(err).code === "23505") throw new Error("That email is already registered or an administrator already exists.");
    throw err;
  }
}
